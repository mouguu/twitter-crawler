import * as path from 'path';
import { Page } from 'puppeteer';
import { BrowserLaunchOptions, BrowserManager } from './browser-manager';
import { CookieManager } from './cookie-manager';
import { SessionManager, Session } from './session-manager';
import { RequestQueue } from './request-queue'; // Import RequestQueue
import { ErrorSnapshotter } from './error-snapshotter';
import { FingerprintManager } from './fingerprint-manager';
import * as dataExtractor from './data-extractor';
import { ProfileInfo } from './data-extractor';
import { NavigationService } from './navigation-service';
import { RateLimitManager } from './rate-limit-manager';
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
}

export interface ScrapeThreadResult {
    success: boolean;
    tweets: Tweet[];
    originalTweet?: Tweet | null;
    replies?: Tweet[];
    runContext?: RunContext;
    error?: string;
}

export class ScraperEngine {
    private eventBus: ScraperEventBus;
    private navigationService: NavigationService;
    private rateLimitManager: RateLimitManager;
    private sessionManager: SessionManager;
    private requestQueue: RequestQueue; // Add RequestQueue
    private errorSnapshotter: ErrorSnapshotter;
    private fingerprintManager: FingerprintManager;
    private currentSession: Session | null = null;
    private browserManager: BrowserManager | null;
    private page: Page | null;
    private stopSignal: boolean;
    private shouldStopFunction?: () => boolean;
    private browserOptions: BrowserLaunchOptions;

    constructor(shouldStopFunction?: () => boolean, options: ScraperEngineOptions = {}) {
        this.eventBus = eventBusInstance;
        this.navigationService = new NavigationService(this.eventBus);
        this.rateLimitManager = new RateLimitManager(this.eventBus);
        this.sessionManager = new SessionManager();
        this.requestQueue = new RequestQueue(); // Initialize RequestQueue
        this.errorSnapshotter = new ErrorSnapshotter();
        this.fingerprintManager = new FingerprintManager();
        this.browserManager = null;
        this.page = null;
        this.stopSignal = false;
        this.shouldStopFunction = shouldStopFunction;
        this.browserOptions = {
            headless: options.headless ?? true,
            ...(options.browserOptions || {})
        };
    }

    setStopSignal(value: boolean): void {
        this.stopSignal = value;
    }

    async init(): Promise<void> {
        this.browserManager = new BrowserManager();
        await this.browserManager.init(this.browserOptions);
        // We do NOT create the page here anymore. 
        // The page is created in loadCookies() to ensure it's tied to a session and fingerprint.

        // Initialize Managers
        await this.sessionManager.init();
        // RequestQueue auto-loads state in constructor

        this.eventBus.emitLog('Browser launched and configured');
    }

    async loadCookies(): Promise<boolean> {
        if (!this.browserManager) {
            this.eventBus.emitError(new Error('BrowserManager not initialized'));
            return false;
        }

        if (!this.page) {
            // Get current session (cookie file)
            this.currentSession = this.sessionManager.getSession();
            if (!this.currentSession) {
                this.eventBus.emitError(new Error('No active sessions available'));
                return false;
            }
            this.eventBus.emitLog(`Using session: ${path.basename(this.currentSession.filePath)}`, 'info');

            // Create page
            const page = await this.browserManager.newPage();
            this.page = page;

            // Inject Fingerprint
            // We use the cookie file name as the session ID to ensure the same account gets the same fingerprint
            const sessionId = path.basename(this.currentSession.filePath);
            this.eventBus.emitLog(`Injecting fingerprint for session: ${sessionId}`, 'info');
            await this.fingerprintManager.injectFingerprint(page, sessionId);

            // Load cookies
            await this.browserManager.loadCookies(page, this.currentSession.filePath);
            this.eventBus.emitLog(`Loaded session: ${this.currentSession.id}`);
            return true;
        }

        // 1. Try to get a session from SessionManager
        this.currentSession = this.sessionManager.getSession();

        if (this.currentSession) {
            try {
                await this.sessionManager.injectSession(this.page, this.currentSession);
                this.eventBus.emitLog(`Loaded session: ${this.currentSession.id}`);
                return true;
            } catch (error: any) {
                this.eventBus.emitError(new Error(`Failed to inject session ${this.currentSession.id}: ${error.message}`));
                this.sessionManager.markBad(this.currentSession.id);
                return false;
            }
        }

        // 2. Fallback to legacy single-file loading (env.json or cookies/twitter-cookies.json)
        // This ensures backward compatibility if no multi-session files are found
        try {
            const cookieManager = new CookieManager();
            const cookieInfo = await cookieManager.loadAndInject(this.page);
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
        while (!navigationSuccess && attempts < 3) {
            try {
                await this.navigationService.navigateToUrl(this.page, targetUrl);
                await this.navigationService.waitForTweets(this.page);
                navigationSuccess = true;
            } catch (error: any) {
                if (this.rateLimitManager.isRateLimitError(error)) {
                    const rotated = await this.rateLimitManager.handleRateLimit(this.page, attempts, error);
                    if (!rotated) throw error;
                } else {
                    throw error;
                }
            }
            attempts++;
        }

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
            const tweetsOnPage = await dataExtractor.extractTweetsFromPage(this.page);
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

                // If 2 consecutive attempts with no new tweets, assume we've reached the end
                if (noNewTweetsConsecutiveAttempts >= 2) {
                    this.eventBus.emitLog(`No new tweets detected after 2 attempts. Collected ${collectedTweets.length} tweets (target was ${limit}). Finishing...`);
                    break;
                }
            } else {
                noNewTweetsConsecutiveAttempts = 0;
            }

            // Scroll
            // Use very short timeouts when no new tweets to speed up detection
            const scrollTimeout = noNewTweetsConsecutiveAttempts > 0 ? 1000 : constants.WAIT_FOR_NEW_TWEETS_TIMEOUT;
            const domWaitTimeout = noNewTweetsConsecutiveAttempts > 0 ? 500 : 2000;

            await dataExtractor.scrollToBottomSmart(this.page, scrollTimeout);
            await dataExtractor.waitForNewTweets(this.page, tweetsOnPage.length, domWaitTimeout);
        }

        // Save Results
        if (collectedTweets.length > 0) {
            if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(collectedTweets, runContext);
            if (exportCsv) await exportUtils.exportToCsv(collectedTweets, runContext);
            if (exportJson) await exportUtils.exportToJson(collectedTweets, runContext);
            if (saveScreenshots) await screenshotUtils.takeScreenshotsOfTweets(this.page, collectedTweets, { runContext });
        }

        return { success: true, tweets: collectedTweets, runContext, profile: profileInfo };
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
