import * as path from 'path';
import { Page } from 'puppeteer';
import { BrowserLaunchOptions, BrowserManager } from './browser-manager';
import { CookieManager } from './cookie-manager';
import { SessionManager, Session } from './session-manager';
import { ErrorSnapshotter } from './error-snapshotter';
import { FingerprintManager } from './fingerprint-manager';
import * as dataExtractor from './data-extractor';
import { ProfileInfo } from './data-extractor';
import { NavigationService } from './navigation-service';
import { RateLimitManager } from './rate-limit-manager';
import { PerformanceMonitor, PerformanceStats } from './performance-monitor';
import eventBusInstance, { ScraperEventBus } from './event-bus';
import * as fileUtils from '../utils/fileutils';
import { RunContext } from '../utils/fileutils';
import * as markdownUtils from '../utils/markdown';
import { Tweet } from '../utils/markdown';
import * as exportUtils from '../utils/export';
import * as screenshotUtils from '../utils/screenshot';
import * as constants from '../config/constants';

const throttle = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export interface ScraperEngineOptions {
    headless?: boolean;
    browserOptions?: BrowserLaunchOptions;
    sessionId?: string;
    eventBus?: ScraperEventBus;
}

export interface ScrapeTimelineConfig {
    username?: string;
    limit?: number;
    mode?: 'timeline' | 'search';
    searchQuery?: string;
    runContext?: RunContext;
    saveMarkdown?: boolean;
    saveScreenshots?: boolean;
    exportCsv?: boolean;
    exportJson?: boolean;
    outputDir?: string;
    tab?: 'likes' | 'replies';
    withReplies?: boolean;
    stopAtTweetId?: string; // Stop scraping when this tweet ID is encountered
    sinceTimestamp?: number; // Stop scraping if tweet is older than this timestamp (ms)
    collectProfileInfo?: boolean;
}

export interface ScrapeTimelineResult {
    success: boolean;
    tweets: Tweet[];
    runContext?: RunContext;
    profile?: ProfileInfo | null;
    error?: string;
    performance?: PerformanceStats;
}

export interface ScrapeThreadOptions {
    tweetUrl: string;
    maxReplies?: number;
    runContext?: RunContext;
    saveMarkdown?: boolean;
    exportCsv?: boolean;
    exportJson?: boolean;
    outputDir?: string;
    headless?: boolean;
    sessionId?: string;
}

export interface ScrapeThreadResult {
    success: boolean;
    tweets: Tweet[];
    originalTweet?: Tweet | null;
    replies?: Tweet[];
    runContext?: RunContext;
    error?: string;
    performance?: PerformanceStats;
}

export class ScraperEngine {
    private eventBus: ScraperEventBus;
    private navigationService: NavigationService;
    private rateLimitManager: RateLimitManager;
    private sessionManager: SessionManager;
    private errorSnapshotter: ErrorSnapshotter;
    private fingerprintManager: FingerprintManager;
    private performanceMonitor: PerformanceMonitor;
    private lastPerformanceEmit: number = 0;
    private currentSession: Session | null = null;
    private browserManager: BrowserManager | null;
    private page: Page | null;
    private stopSignal: boolean;
    private shouldStopFunction?: () => boolean;
    private browserOptions: BrowserLaunchOptions;
    private preferredSessionId?: string;

    constructor(shouldStopFunction?: () => boolean, options: ScraperEngineOptions = {}) {
        this.eventBus = options.eventBus || eventBusInstance;
        this.navigationService = new NavigationService(this.eventBus);
        this.sessionManager = new SessionManager(undefined, this.eventBus);
        this.rateLimitManager = new RateLimitManager(this.sessionManager, this.eventBus);
        this.errorSnapshotter = new ErrorSnapshotter();
        this.fingerprintManager = new FingerprintManager();
        this.performanceMonitor = new PerformanceMonitor();
        this.browserManager = null;
        this.page = null;
        this.stopSignal = false;
        this.shouldStopFunction = shouldStopFunction;
        this.browserOptions = {
            headless: options.headless ?? true,
            ...(options.browserOptions || {})
        };
        this.preferredSessionId = options.sessionId;
    }

    setStopSignal(value: boolean): void {
        this.stopSignal = value;
    }

    private async ensurePage(): Promise<Page> {
        if (!this.browserManager) {
            throw new Error('BrowserManager not initialized');
        }
        if (!this.page) {
            this.page = await this.browserManager.newPage(this.browserOptions);
        }
        return this.page;
    }

    private async applySession(session: Session, options: { refreshFingerprint?: boolean; clearExistingCookies?: boolean } = {}): Promise<void> {
        if (!this.page) {
            throw new Error('Page not initialized');
        }

        const sessionId = path.basename(session.filePath);
        if (options.refreshFingerprint !== false) {
            await this.fingerprintManager.injectFingerprint(this.page, sessionId);
        }

        await this.sessionManager.injectSession(this.page, session, options.clearExistingCookies !== false);
        this.currentSession = session;
        this.eventBus.emitLog(`Loaded session: ${session.id}${session.username ? ` (${session.username})` : ''}`);
    }

    private emitPerformanceUpdate(force: boolean = false): void {
        const now = Date.now();
        if (!force && now - this.lastPerformanceEmit < 1000) {
            return;
        }

        this.lastPerformanceEmit = now;
        try {
            const stats = this.performanceMonitor.getStats();
            this.eventBus.emitPerformance({ stats });
        } catch (error: any) {
            this.eventBus.emitLog(`Performance emit failed: ${error.message}`, 'warn');
        }
    }

    async init(): Promise<void> {
        this.browserManager = new BrowserManager();
        await this.browserManager.init(this.browserOptions);
        // We do NOT create the page here anymore. 
        // The page is created in loadCookies() to ensure it's tied to a session and fingerprint.

        // Initialize Managers
        await this.sessionManager.init();

        this.eventBus.emitLog('Browser launched and configured');
    }

    async loadCookies(): Promise<boolean> {
        if (!this.browserManager) {
            this.eventBus.emitError(new Error('BrowserManager not initialized'));
            return false;
        }

        try {
            await this.ensurePage();
        } catch (error: any) {
            this.eventBus.emitError(new Error(`Failed to create page: ${error.message}`));
            return false;
        }

        // 1. Try to get a session from SessionManager
        const nextSession = this.sessionManager.getNextSession(this.preferredSessionId);

        if (nextSession) {
            try {
                await this.applySession(nextSession, { refreshFingerprint: true, clearExistingCookies: true });
                return true;
            } catch (error: any) {
                this.eventBus.emitError(new Error(`Failed to inject session ${nextSession.id}: ${error.message}`));
                this.sessionManager.markBad(nextSession.id);
                return false;
            }
        }

        // 2. Fallback to legacy single-file loading (env.json or cookies/twitter-cookies.json)
        // This ensures backward compatibility if no multi-session files are found
        try {
            const cookieManager = new CookieManager();
            const cookieInfo = await cookieManager.loadAndInject(this.page!);
            const fallbackSessionId = cookieInfo.source ? path.basename(cookieInfo.source) : 'legacy-cookies';

            await this.fingerprintManager.injectFingerprint(this.page!, fallbackSessionId);
            this.currentSession = {
                id: fallbackSessionId,
                cookies: cookieInfo.cookies,
                usageCount: 0,
                errorCount: 0,
                isRetired: false,
                filePath: cookieInfo.source || fallbackSessionId,
                username: cookieInfo.username
            };
            this.eventBus.emitLog(`Loaded legacy cookies from ${cookieInfo.source}`);
            return true;
        } catch (error: any) {
            this.eventBus.emitError(new Error(`Cookie error: ${error.message}`));
            return false;
        }
    }

    async scrapeTimeline(config: ScrapeTimelineConfig): Promise<ScrapeTimelineResult> {
        if (!this.page) {
            return { success: false, tweets: [], error: 'Page not initialized' };
        }

        // Start performance monitoring
        this.performanceMonitor.reset();
        this.performanceMonitor.start();
        this.emitPerformanceUpdate(true);

        let {
            username, limit = 50, mode = 'timeline', searchQuery,
            runContext, saveMarkdown = true, saveScreenshots = false,
            exportCsv = false, exportJson = false
        } = config;

        // Initialize runContext if missing
        if (!runContext) {
            const identifier = username || searchQuery || 'unknown';
            runContext = await fileUtils.createRunContext({
                platform: 'x',
                identifier,
                baseOutputDir: config.outputDir
            });
            this.eventBus.emitLog(`Created new run context: ${runContext.runId}`);
        }

        const collectedTweets: Tweet[] = [];
        const scrapedUrls = new Set<string>();

        // Determine Target URL
        let targetUrl = 'https://x.com/home';
        if (mode === 'search' && searchQuery) {
            const encodedQuery = encodeURIComponent(searchQuery);
            targetUrl = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;
        } else if (username) {
            if (config.tab === 'likes') {
                targetUrl = `https://x.com/${username}/likes`;
            } else if (config.withReplies || config.tab === 'replies') {
                targetUrl = `https://x.com/${username}/with_replies`;
            } else {
                targetUrl = `https://x.com/${username}`;
            }
        }

        // Navigation with Retry & Rate Limit Handling
        let navigationSuccess = false;
        let attempts = 0;
        this.performanceMonitor.startPhase('navigation');
        while (!navigationSuccess && attempts < 3) {
            try {
                await this.navigationService.navigateToUrl(this.page, targetUrl);
                await this.navigationService.waitForTweets(this.page);
                navigationSuccess = true;
            } catch (error: any) {
                if (this.rateLimitManager.isRateLimitError(error)) {
                    this.performanceMonitor.recordRateLimit();
                    const rotatedSession = await this.rateLimitManager.handleRateLimit(this.page, attempts, error, this.currentSession?.id);
                    if (!rotatedSession) throw error;

                    this.performanceMonitor.recordSessionSwitch();
                    await this.applySession(rotatedSession, { refreshFingerprint: true, clearExistingCookies: true });
                    // Reset attempts after rotating to give the new session full retry budget
                    attempts = 0;
                    continue;
                } else {
                    throw error;
                }
            }
            attempts++;
        }
        this.performanceMonitor.endPhase();
        this.emitPerformanceUpdate();

        // Scraping Loop
        let scrollAttempts = 0;
        const maxScrollAttempts = Math.max(50, Math.ceil(limit / 5));
        let noNewTweetsConsecutiveAttempts = 0;
        let profileInfo: ProfileInfo | null = null;

        if (config.collectProfileInfo) {
            try {
                profileInfo = await dataExtractor.extractProfileInfo(this.page);
            } catch (error: any) {
                this.eventBus.emitLog(`Failed to extract profile info: ${error.message}`, 'warn');
            }
        }

        while (collectedTweets.length < limit && scrollAttempts < maxScrollAttempts) {
            if (this.stopSignal || (this.shouldStopFunction && this.shouldStopFunction())) {
                this.eventBus.emitLog('Manual stop signal received.');
                break;
            }

            scrollAttempts++;
            
            // Extract tweets
            this.performanceMonitor.startPhase('extraction');
            const tweetsOnPage = await dataExtractor.extractTweetsFromPage(this.page);
            this.performanceMonitor.endPhase();
            
            let addedInAttempt = 0;

            for (const tweet of tweetsOnPage) {
                // Check stop condition (Incremental Scraping)
                if (config.stopAtTweetId && tweet.id === config.stopAtTweetId) {
                    this.eventBus.emitLog(`Reached last scraped tweet ID: ${tweet.id}. Stopping.`);
                    // Stop the outer loop as well
                    scrollAttempts = maxScrollAttempts;
                    break;
                }

                // Check time condition (Lookback Period)
                if (config.sinceTimestamp) {
                    const tweetTime = new Date(tweet.time).getTime();
                    if (!isNaN(tweetTime) && tweetTime < config.sinceTimestamp) {
                        this.eventBus.emitLog(`Reached time limit: ${tweet.time}. Stopping.`);
                        scrollAttempts = maxScrollAttempts;
                        break;
                    }
                }

                if (collectedTweets.length < limit && !scrapedUrls.has(tweet.url)) {
                    collectedTweets.push(tweet);
                    scrapedUrls.add(tweet.url);
                    addedInAttempt++;
                }
            }

            // Emit Progress
            this.eventBus.emitProgress({
                current: collectedTweets.length,
                target: limit,
                action: 'scraping'
            });

            if (addedInAttempt === 0) {
                noNewTweetsConsecutiveAttempts++;

                // After 3 consecutive attempts with no new tweets, try session rotation
                if (noNewTweetsConsecutiveAttempts >= 3) {
                    // Check if we have other sessions to try
                    const nextSession = this.sessionManager.getNextSession(undefined, this.currentSession?.id);
                    
                    if (nextSession && nextSession.id !== this.currentSession?.id) {
                        this.eventBus.emitLog(`No new tweets after ${noNewTweetsConsecutiveAttempts} attempts. Rotating to session: ${nextSession.id}`, 'warn');
                        
                        // Mark current session as potentially rate-limited
                        if (this.currentSession) {
                            this.sessionManager.markBad(this.currentSession.id, 'soft-rate-limit');
                        }
                        
                        this.performanceMonitor.recordSessionSwitch();
                        this.performanceMonitor.recordRateLimit();
                        
                        // Switch session
                        try {
                            this.performanceMonitor.startPhase('session-switch');
                            await this.sessionManager.injectSession(this.page!, nextSession);
                            await this.fingerprintManager.injectFingerprint(this.page!, nextSession.id);
                            this.currentSession = nextSession;
                            
                            // Re-navigate to the page
                            await this.navigationService.navigateToUrl(this.page!, targetUrl);
                            await this.navigationService.waitForTweets(this.page!);
                            this.performanceMonitor.endPhase();
                            this.emitPerformanceUpdate();
                            
                            noNewTweetsConsecutiveAttempts = 0;
                            this.eventBus.emitLog(`Switched to session ${nextSession.id}, continuing scrape...`);
                            continue;
                        } catch (switchError: any) {
                            this.performanceMonitor.endPhase();
                            this.eventBus.emitLog(`Failed to switch session: ${switchError.message}`, 'error');
                        }
                    }
                    
                    // No more sessions or switch failed, stop
                    this.eventBus.emitLog(`No new tweets detected after ${noNewTweetsConsecutiveAttempts} attempts. Collected ${collectedTweets.length} tweets (target was ${limit}). Finishing...`);
                    break;
                }
            } else {
                noNewTweetsConsecutiveAttempts = 0;
            }

            // Scroll
            this.performanceMonitor.startPhase('scroll');
            this.performanceMonitor.recordScroll();
            const scrollTimeout = noNewTweetsConsecutiveAttempts > 0 ? 1000 : constants.WAIT_FOR_NEW_TWEETS_TIMEOUT;
            const domWaitTimeout = noNewTweetsConsecutiveAttempts > 0 ? 500 : 1500;

            await dataExtractor.scrollToBottomSmart(this.page, scrollTimeout);
            await dataExtractor.waitForNewTweets(this.page, tweetsOnPage.length, domWaitTimeout);
            this.performanceMonitor.endPhase();
            
            // Update tweet count for performance tracking
            this.performanceMonitor.recordTweets(collectedTweets.length);
            this.emitPerformanceUpdate();
        }

        // Save Results
        this.performanceMonitor.startPhase('save-results');
        if (collectedTweets.length > 0) {
            if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(collectedTweets, runContext);
            if (exportCsv) await exportUtils.exportToCsv(collectedTweets, runContext);
            if (exportJson) await exportUtils.exportToJson(collectedTweets, runContext);
            if (saveScreenshots) await screenshotUtils.takeScreenshotsOfTweets(this.page, collectedTweets, { runContext });
        }
        this.performanceMonitor.endPhase();

        if (this.currentSession) {
            this.sessionManager.markGood(this.currentSession.id);
        }

        // Stop performance monitoring and get report
        this.performanceMonitor.stop();
        this.emitPerformanceUpdate(true);
        const performanceStats = this.performanceMonitor.getStats();
        
        // Log performance report
        this.eventBus.emitLog(this.performanceMonitor.getReport());

        return { success: true, tweets: collectedTweets, runContext, profile: profileInfo, performance: performanceStats };
    }

    async scrapeThread(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
        if (!this.page) {
            return { success: false, tweets: [], error: 'Page not initialized' };
        }

        let { tweetUrl, maxReplies = 100, runContext, saveMarkdown = true, exportCsv = false, exportJson = false } = options;

        if (!tweetUrl || !tweetUrl.includes('/status/')) {
            return { success: false, tweets: [], error: 'Invalid tweet URL' };
        }

        // Extract ID and Username
        const urlMatch = tweetUrl.match(/x\.com\/([^\/]+)\/status\/(\d+)/);
        if (!urlMatch) {
            return { success: false, tweets: [], error: 'Could not parse tweet URL' };
        }
        const username = urlMatch[1];
        const tweetId = urlMatch[2];

        // Initialize runContext if missing
        if (!runContext) {
            runContext = await fileUtils.createRunContext({
                platform: 'x',
                identifier: username,
                baseOutputDir: options.outputDir
            });
            this.eventBus.emitLog(`Created new run context for thread: ${runContext.runId}`);
        }

        let originalTweet: Tweet | null = null;
        const allReplies: Tweet[] = [];
        const scrapedReplyIds = new Set<string>();

        try {
            // Navigate
            await this.navigationService.navigateToUrl(this.page, tweetUrl);
            await this.navigationService.waitForTweets(this.page);

            // Extract Original Tweet
            let tweetsOnPage = await dataExtractor.extractTweetsFromPage(this.page);
            if (tweetsOnPage.length > 0) {
                originalTweet = tweetsOnPage.find(t => t.id === tweetId || t.url.includes(tweetId)) || tweetsOnPage[0];

                tweetsOnPage.forEach(tweet => {
                    if (tweet.id !== originalTweet?.id && !scrapedReplyIds.has(tweet.id)) {
                        allReplies.push(tweet);
                        scrapedReplyIds.add(tweet.id);
                    }
                });
            }

            // Scroll for replies
            let scrollAttempts = 0;
            const maxScrollAttempts = Math.max(50, Math.ceil(maxReplies / 5));

            while (allReplies.length < maxReplies && scrollAttempts < maxScrollAttempts) {
                if (this.stopSignal || (this.shouldStopFunction && this.shouldStopFunction())) break;

                scrollAttempts++;
                // Smart Scroll (Mimicking Crawlee)
                await dataExtractor.scrollToBottomSmart(this.page, constants.WAIT_FOR_NEW_TWEETS_TIMEOUT);
                // Double check DOM update
                await dataExtractor.waitForNewTweets(this.page, tweetsOnPage.length, 2000);

                const newTweets = await dataExtractor.extractTweetsFromPage(this.page);
                for (const tweet of newTweets) {
                    if (allReplies.length >= maxReplies) break;
                    if (tweet.id === originalTweet?.id) continue;
                    if (!scrapedReplyIds.has(tweet.id)) {
                        allReplies.push(tweet);
                        scrapedReplyIds.add(tweet.id);
                    }
                }
            }

            const allTweets = originalTweet ? [originalTweet, ...allReplies] : allReplies;

            // Save
            if (allTweets.length > 0) {
                if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
                if (exportCsv) await exportUtils.exportToCsv(allTweets, runContext);
                if (exportJson) await exportUtils.exportToJson(allTweets, runContext);
            }

            if (this.currentSession) {
                this.sessionManager.markGood(this.currentSession.id);
            }

            return {
                success: true,
                tweets: allTweets,
                originalTweet,
                replies: allReplies,
                runContext
            };

        } catch (error: any) {
            this.eventBus.emitError(new Error(`Thread scraping failed: ${error.message}`));
            return { success: false, tweets: [], error: error.message };
        }
    }

    async close(): Promise<void> {
        if (this.browserManager) {
            await this.browserManager.close();
        }
    }
}
