import * as path from 'path';
import { Page } from 'puppeteer';
import { BrowserLaunchOptions, BrowserManager, ProxyConfig } from './browser-manager';
import { BrowserPool, BrowserPoolOptions, getBrowserPool } from './browser-pool';
import { CookieManager } from './cookie-manager';
import { SessionManager, Session } from './session-manager';
import { ProxyManager } from './proxy-manager';
import { ErrorSnapshotter } from './error-snapshotter';
import { FingerprintManager } from './fingerprint-manager';
import * as dataExtractor from './data-extractor';
import { NavigationService } from './navigation-service';
import { RateLimitManager } from './rate-limit-manager';
import { PerformanceMonitor, PerformanceStats } from './performance-monitor';
import eventBusInstance, { ScraperEventBus } from './event-bus';
import { ProgressManager } from './progress-manager';
import { createDefaultDependencies, ScraperDependencies } from './scraper-dependencies';
import { DateUtils, RunContext } from '../utils';
import * as fileUtils from '../utils';
import * as markdownUtils from '../utils';
import * as exportUtils from '../utils';
import * as screenshotUtils from '../utils';
import * as constants from '../config/constants';
import { getThreadDetailWaitTime, validateScrapeConfig } from '../config/constants';
import { XApiClient } from './x-api';
import { ScraperErrors, ScraperError, ErrorCode, ErrorClassifier } from './errors';
import { runTimelineApi } from './timeline-api-runner';
import { runTimelineDom } from './timeline-dom-runner';
// import { runTimelineDateChunks } from './timeline-date-chunker'; // Moved to dynamic import to avoid circular dependency
import { TweetRepository } from './db/tweet-repo';
// Legacy thread runners moved to archive/deprecated/
// import { ThreadGraphqlRunner } from './thread-graphql-runner';
// import { ThreadDomRunner } from './thread-dom-runner';
import type { Tweet, ProfileInfo, TweetResult, TweetDetailResult } from '../types/tweet-definitions';
import {
    normalizeRawTweet,
    parseTweetFromApiResult,
    extractInstructionsFromResponse,
    parseTweetsFromInstructions,
    extractNextCursor,
    parseTweetDetailResponse
} from '../types/tweet-definitions';
export type {
    ScrapeTimelineConfig,
    ScrapeTimelineResult,
    ScrapeThreadOptions,
    ScrapeThreadResult,
    ScraperEngineOptions
} from './scraper-engine.types';
import type {
    ScrapeTimelineConfig,
    ScrapeTimelineResult,
    ScrapeThreadOptions,
    ScrapeThreadResult,
    ScraperEngineOptions
} from './scraper-engine.types';

const throttle = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class ScraperEngine {
    public readonly eventBus: ScraperEventBus;
    private deps: ScraperDependencies;
    private lastPerformanceEmit: number = 0;
    private currentSession: Session | null = null;
    private browserManager: BrowserManager | null;
    private page: Page | null;
    private stopSignal: boolean;
    private shouldStopFunction?: () => boolean;
    private browserOptions: BrowserLaunchOptions;
    private preferredSessionId?: string;
    /** Whether to use API-only mode (no browser launch) */
    private apiOnlyMode: boolean;
    /** Whether to allow automatic session rotation (passed from frontend) */
    private enableRotation: boolean = true;
    /** Browser pool (optional, reuses browser instances if provided) */
    public browserPool?: BrowserPool;
    /** Current browser instance (for pool management) */
    private pooledBrowser: import('puppeteer').Browser | null = null;
    /** Linked BullMQ Job ID */
    private jobId?: string;

    private xApiClient: XApiClient | null = null;

    // Accessors
    public get navigationService() { return this.deps.navigationService; }
    public get rateLimitManager() { return this.deps.rateLimitManager; }
    public get sessionManager() { return this.deps.sessionManager; }
    public get proxyManager() { return this.deps.proxyManager; }
    public get errorSnapshotter() { return this.deps.errorSnapshotter; }
    public get fingerprintManager() { return this.deps.fingerprintManager; }
    public get performanceMonitor() { return this.deps.performanceMonitor; }
    public get progressManager() { return this.deps.progressManager; }
    /** Get dependencies (shared for parallel processing) */
    public get dependencies() { return this.deps; }

    /**
     * Check if in API-only mode (no browser launch)
     */
    private isApiOnlyMode(): boolean {
        return this.apiOnlyMode;
    }

    /**
     * Check if in Puppeteer mode (requires browser)
     */
    private isPuppeteerMode(): boolean {
        return !this.apiOnlyMode;
    }

    /**
     * Ensure API client is initialized
     */
    public ensureApiClient(): XApiClient {
        if (!this.xApiClient) {
            throw ScraperErrors.apiClientNotInitialized();
        }
        return this.xApiClient;
    }

    /**
     * Ensure browser page is initialized
     */
    private async ensureBrowserPage(): Promise<Page> {
        if (this.apiOnlyMode) {
            throw ScraperErrors.browserNotInitialized();
        }
        return await this.ensurePage();
    }

    constructor(shouldStopFunction?: () => boolean, options: ScraperEngineOptions = {}) {
        this.eventBus = options.eventBus || eventBusInstance;
        
        // Use dependency injection to decouple dependency creation
        this.deps = options.dependencies || createDefaultDependencies(
            this.eventBus,
            './cookies',
            './data/progress'
        );
        
        this.browserManager = null;
        this.page = null;
        this.stopSignal = false;
        this.shouldStopFunction = shouldStopFunction;
        this.browserOptions = {
            headless: options.headless ?? true,
            ...(options.browserOptions || {})
        };
        this.preferredSessionId = options.sessionId;
        this.apiOnlyMode = options.apiOnly ?? false;
        
        // Initialize browser pool (optional, default off)
        // Only enabled if browserPoolOptions or browserPool is explicitly provided
        // For most single-task scenarios, browser pool is not needed, create new browser each time
        if (options.browserPool) {
            this.browserPool = options.browserPool;
            this.eventBus.emitLog('[BrowserPool] Using provided browser pool instance', 'info');
        } else if (options.browserPoolOptions && !this.apiOnlyMode) {
            this.browserPool = getBrowserPool(options.browserPoolOptions);
            this.eventBus.emitLog('[BrowserPool] Browser pool enabled with options', 'info');
        }
        
        this.jobId = options.jobId;
    }

    setStopSignal(value: boolean): void {
        this.stopSignal = value;
    }

    getPageInstance(): Page | null {
        return this.page;
    }

    getCurrentSession(): Session | null {
        return this.currentSession;
    }

    shouldStop(): boolean {
        return this.stopSignal || (this.shouldStopFunction && this.shouldStopFunction()) || false;
    }

    isRotationEnabled(): boolean {
        return this.enableRotation;
    }

    public async ensurePage(): Promise<Page> {
        if (!this.browserManager) {
            throw ScraperErrors.browserNotInitialized();
        }
        if (!this.page) {
            this.page = await this.browserManager.newPage(this.browserOptions);
        }
        return this.page;
    }

    public async applySession(session: Session, options: { refreshFingerprint?: boolean; clearExistingCookies?: boolean } = {}): Promise<void> {
        // API-only mode: only update API client, no browser operations
        if (this.isApiOnlyMode()) {
            this.currentSession = session;
            this.xApiClient = new XApiClient(session.cookies);
            this.eventBus.emitLog(`[API-only] Switched to session: ${session.id}${session.username ? ` (${session.username})` : ''}`);
            return;
        }

        // Browser mode: requires page
        if (!this.page) {
            throw ScraperErrors.pageNotAvailable();
        }

        const sessionId = path.basename(session.filePath);
        if (options.refreshFingerprint !== false) {
            await this.fingerprintManager.injectFingerprint(this.page, sessionId);
        }

        await this.sessionManager.injectSession(this.page, session, options.clearExistingCookies !== false);
        this.currentSession = session;

        // Initialize API Client with session cookies
        this.xApiClient = new XApiClient(session.cookies);

        this.eventBus.emitLog(`Loaded session: ${session.id}${session.username ? ` (${session.username})` : ''}`);
    }

    public emitPerformanceUpdate(force: boolean = false): void {
        const now = Date.now();
        if (!force && now - this.lastPerformanceEmit < 1000) {
            return;
        }

        this.lastPerformanceEmit = now;
        try {
            const stats = this.performanceMonitor.getStats();
            this.eventBus.emitPerformance({ stats });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.eventBus.emitLog(`Performance emit failed: ${message}`, 'warn');
        }
    }

    async init(): Promise<void> {
        // Initialize ProxyManager (optional, default no proxy)
        // If no proxy file, it will be skipped automatically
        await this.proxyManager.init();

        // Initialize SessionManager - Decoupled: pass CookieManager or let SessionManager create it
        await this.sessionManager.init();

        // API-only mode: do not launch browser
        if (this.apiOnlyMode) {
            this.eventBus.emitLog('API-only mode: Browser not launched');
            return;
        }

        // Note: Browser launch is now delayed until loadCookies() to allow proxy configuration
        this.eventBus.emitLog('SessionManager and ProxyManager initialized');
    }

    async loadCookies(enableRotation: boolean = true): Promise<boolean> {
        // Persist the toggle for downstream logic (API empty-response handling, error handling)
        this.enableRotation = enableRotation !== false;

        // Configure RateLimitManager
        if (this.rateLimitManager) {
            this.rateLimitManager.setEnableRotation(this.enableRotation);
            // Surface the toggle to the UI logs for clarity
            this.eventBus.emitLog(
                this.enableRotation
                    ? 'Auto-rotation enabled: will switch sessions on rate limits.'
                    : 'Auto-rotation disabled: will stay on the current session and stop on rate limits.',
                this.enableRotation ? 'info' : 'warn'
            );
        } else {
            console.error('[ScraperEngine] WARNING: rateLimitManager is null!');
        }
        // API-only mode: only load cookies to initialize API client
        if (this.apiOnlyMode) {
            return this.loadCookiesApiOnly(this.enableRotation);
        }

        // 1. Get the next session first
        const nextSession = this.sessionManager.getNextSession(this.preferredSessionId);

        if (!nextSession) {
            this.eventBus.emitError(new Error('No session available'));
            return false;
        }

        // 2. Get proxy for this session
        let proxyConfig: ProxyConfig | undefined;
        if (this.proxyManager.hasProxies()) {
            const proxy = this.proxyManager.getProxyForSession(nextSession.id);
            if (proxy) {
                proxyConfig = {
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username,
                    password: proxy.password
                };
                this.eventBus.emitLog(`[ProxyManager] Binding session ${nextSession.id} → proxy ${proxy.host}:${proxy.port}`);
            }
        }

        // 3. Update browser options with proxy
        this.browserOptions.proxy = proxyConfig;

        // 4. NOW launch browser with proxy config (if not already launched)
        if (!this.browserManager) {
            if (this.browserPool) {
                // Acquire browser instance from pool
                const browser = await this.browserPool.acquire();
                this.pooledBrowser = browser;
                this.browserManager = new BrowserManager();
                this.browserManager.initFromBrowser(browser);
                this.eventBus.emitLog('Browser acquired from pool');
            } else {
                // Traditional way: create new browser
                this.browserManager = new BrowserManager();
                await this.browserManager.init(this.browserOptions);
                this.eventBus.emitLog('Browser launched and configured');
            }
        }

        // 5. Ensure page is created
        try {
            await this.ensurePage();
        } catch (error: unknown) {
            const scraperError = ErrorClassifier.classify(error);
            this.eventBus.emitError(new Error(`Failed to create page: ${scraperError.message}`));
            return false;
        }

        // 6. Apply session to page
        try {
            await this.applySession(nextSession, {
                refreshFingerprint: true,
                clearExistingCookies: true
            });
            return true;
        } catch (error: unknown) {
            const scraperError = ErrorClassifier.classify(error);
            this.eventBus.emitError(new Error(`Failed to inject session ${nextSession.id}: ${scraperError.message}`));
            this.sessionManager.markBad(nextSession.id);
            return false;
        }
    }


    /**
     * Restart browser with a specific session and its assigned proxy
     */
    public async restartBrowserWithSession(session: Session): Promise<void> {
        this.eventBus.emitLog(`Restarting browser for session ${session.id}...`);

        // 1. Close current browser/page
        if (this.page) {
            try {
                await this.page.close();
            } catch (error) {
                // Ignore page close errors
            }
            this.page = null;
        }
        
        if (this.browserManager) {
            if (this.browserPool && this.pooledBrowser) {
                // If using browser pool, release browser
                this.browserPool.release(this.pooledBrowser);
                this.pooledBrowser = null;
            } else {
                // Traditional way: close browser
                await this.browserManager.close();
            }
            this.browserManager = null;
        }

        // 2. Get proxy for the new session
        let proxyConfig: ProxyConfig | undefined;
        if (this.proxyManager.hasProxies()) {
            const proxy = this.proxyManager.getProxyForSession(session.id);
            if (proxy) {
                proxyConfig = {
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username,
                    password: proxy.password
                };
                this.eventBus.emitLog(`[ProxyManager] Switching to proxy ${proxy.host}:${proxy.port} for session ${session.id}`);
            }
        }

        // 3. Update browser options
        this.browserOptions.proxy = proxyConfig;

        // 4. Re-initialize browser
        if (this.browserPool) {
            // If pool was used before, release first
            if (this.pooledBrowser) {
                this.browserPool.release(this.pooledBrowser);
                this.pooledBrowser = null;
            }
            // Acquire new browser from pool
            const browser = await this.browserPool.acquire();
            this.pooledBrowser = browser;
            this.browserManager = new BrowserManager();
            this.browserManager.initFromBrowser(browser);
            this.eventBus.emitLog('Browser re-acquired from pool');
        } else {
            // Traditional way: create new browser
            this.browserManager = new BrowserManager();
            await this.browserManager.init(this.browserOptions);
        }
        
        // 5. Create page and inject session
        await this.ensurePage();
        await this.applySession(session, { refreshFingerprint: true, clearExistingCookies: true });
        
        this.eventBus.emitLog(`Browser restarted successfully with session ${session.id}`);
    }

    /**
     * Load cookies in API-only mode
     * Only initializes API client, no browser operations
     */
    private async loadCookiesApiOnly(enableRotation: boolean = true): Promise<boolean> {
        // 1. Try to get session from SessionManager
        const nextSession = this.sessionManager.getNextSession(this.preferredSessionId);

        if (nextSession) {
            this.currentSession = nextSession;
            this.xApiClient = new XApiClient(nextSession.cookies);
            this.eventBus.emitLog(`[API-only] Loaded session: ${nextSession.id}${nextSession.username ? ` (${nextSession.username})` : ''}`);
            return true;
        }

        // 2. Fallback to CookieManager
        try {
            const cookieManager = new CookieManager({ enableRotation });
            const cookieInfo = await cookieManager.load();
            const fallbackSessionId = cookieInfo.source ? path.basename(cookieInfo.source) : 'legacy-cookies';

            this.currentSession = {
                id: fallbackSessionId,
                cookies: cookieInfo.cookies,
                usageCount: 0,
                errorCount: 0,
                consecutiveFailures: 0,
                isRetired: false,
                filePath: cookieInfo.source || fallbackSessionId,
                username: cookieInfo.username
            };

            this.xApiClient = new XApiClient(cookieInfo.cookies);
            this.eventBus.emitLog(`[API-only] Loaded cookies from ${cookieInfo.source}`);
            return true;
        } catch (error: unknown) {
            const scraperError = ErrorClassifier.classify(error);
            this.eventBus.emitError(new Error(`[API-only] Cookie error: ${scraperError.message}`));
            return false;
        }
    }

    async scrapeTimeline(config: ScrapeTimelineConfig): Promise<ScrapeTimelineResult> {
        validateScrapeConfig({
            limit: config.limit,
            username: config.username,
            searchQuery: config.searchQuery,
            mode: config.mode,
            scrapeMode: config.scrapeMode
        });

        const scrapeMode = config.scrapeMode || 'graphql';

        if ((scrapeMode === 'puppeteer' || scrapeMode === 'mixed') && this.isApiOnlyMode()) {
            throw ScraperErrors.invalidConfiguration(
                'Cannot use puppeteer/mixed mode when apiOnly is true. Set apiOnly to false or use graphql mode.',
                { scrapeMode, apiOnly: true }
            );
        }

        // Date chunking conditions:
        // 1. Has dateRange and is search mode
        // 2. Or enableDeepSearch is true and is search mode (will auto-generate dateRange)
        if (config.mode === 'search' && config.searchQuery && config.dateRange) {
            // Auto-enable browser pool to support parallel processing
            if (config.parallelChunks && config.parallelChunks > 1 && !this.browserPool) {
                // Auto-enable browser pool to support parallel processing
                const maxPoolSize = Math.min(config.parallelChunks, 3); // Max 3 concurrent to avoid rate limits
                this.browserPool = getBrowserPool({
                    maxSize: maxPoolSize,
                    minSize: 1,
                    browserOptions: this.browserOptions
                });
                this.eventBus.emitLog(`[BrowserPool] Auto-enabled browser pool (size: ${maxPoolSize}) for parallel chunk processing`, 'info');
            }
            const { runTimelineDateChunks } = await import('./timeline-date-chunker');
            return runTimelineDateChunks(this, config);
        }

        // Ensure config has jobId if engine has it
        if (this.jobId && !config.jobId) {
            config.jobId = this.jobId;
        }

        if (scrapeMode === 'puppeteer') {
            return runTimelineDom(this, config);
        }

        try {
            this.ensureApiClient();
        } catch (error) {
            return {
                success: false,
                tweets: [],
                error: error instanceof ScraperError ? error.message : 'API Client not initialized'
            };
        }

        this.performanceMonitor.reset();
        this.performanceMonitor.setMode('graphql');
        this.performanceMonitor.start();
        this.emitPerformanceUpdate(true);

        const {
            saveMarkdown = true,
            exportCsv = false,
            exportJson = false
        } = config;

        let result = await runTimelineApi(this, config);
        result.tweets = result.tweets || [];

        if (scrapeMode === 'mixed') {
            const totalTarget = config.limit ?? result.tweets.length;
            if (result.tweets.length < totalTarget) {
                try {
                    const remainingLimit = totalTarget - result.tweets.length;
                    this.eventBus.emitLog(`GraphQL chain stopped at ${result.tweets.length}/${totalTarget}. Falling back to DOM to continue...`, 'info');

                    const domResult = await runTimelineDom(this, {
                        ...config,
                        runContext: result.runContext,
                        scrapeMode: 'puppeteer',
                        limit: remainingLimit,
                        progressBase: result.tweets.length,
                        progressTarget: totalTarget,
                        saveMarkdown: false,
                        saveScreenshots: false,
                        exportCsv: false,
                        exportJson: false
                    });

                    if (domResult.success && domResult.tweets?.length) {
                        const uniqueIds = new Set(result.tweets.map(t => t.id));
                        const addedTweets: Tweet[] = [];
                        for (const tweet of domResult.tweets) {
                            if (!uniqueIds.has(tweet.id) && result.tweets.length < totalTarget) {
                                result.tweets.push(tweet);
                                uniqueIds.add(tweet.id);
                                addedTweets.push(tweet);
                            }
                        }

                        if (addedTweets.length > 0) {
                            this.eventBus.emitLog(`DOM fallback added ${addedTweets.length} new tweets. Total: ${result.tweets.length}`);
                            this.eventBus.emitProgress({
                                current: result.tweets.length,
                                target: totalTarget,
                                action: 'scraping (mixed-summary)'
                            });
                        } else {
                            this.eventBus.emitLog('DOM fallback did not add tweets.', 'warn');
                        }
                    } else {
                        this.eventBus.emitLog(`DOM fallback did not add tweets (success=${domResult.success}).`, 'warn');
                    }
                } catch (fallbackError: unknown) {
                    const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                    this.eventBus.emitLog(`DOM fallback failed: ${message}`, 'error');
                }
            }
        }

        let runContext = result.runContext;
        if (!runContext) {
            const identifier = config.username || config.searchQuery || 'unknown';
            runContext = await fileUtils.createRunContext({
                platform: 'x',
                identifier,
                baseOutputDir: config.outputDir
            });
            result.runContext = runContext;
        }

        this.performanceMonitor.startPhase('save-results');
        if (result.tweets.length > 0 && runContext) {
            if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(result.tweets, runContext);
            if (exportCsv) await exportUtils.exportToCsv(result.tweets, runContext);
            if (exportJson) await exportUtils.exportToJson(result.tweets, runContext);
        }

        // Save to DB if jobId is present
        if (this.jobId && result.tweets.length > 0) {
            this.eventBus.emitLog(`Saving ${result.tweets.length} tweets to database...`);
            try {
                const savedCount = await TweetRepository.saveTweets({
                    tweets: result.tweets,
                    jobId: this.jobId
                });
                this.eventBus.emitLog(`Saved ${savedCount} tweets to database.`);
            } catch (error: any) {
                this.eventBus.emitLog(`Failed to save tweets to DB: ${error.message}`, 'error');
            }
        }

        this.performanceMonitor.endPhase();

        const activeSession = this.getCurrentSession();
        if (activeSession) {
            this.sessionManager.markGood(activeSession.id);
        }

        this.performanceMonitor.stop();
        this.emitPerformanceUpdate(true);
        this.eventBus.emitLog(this.performanceMonitor.getReport());

        this.progressManager.completeScraping();
        result.success = result.tweets.length > 0;
        return {
            ...result,
            performance: this.performanceMonitor.getStats()
        };
    }
    async scrapeThread(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
        const scrapeMode = options.scrapeMode || 'graphql';

        // Validate mode combination: if apiOnly is true, cannot use puppeteer mode
        if (scrapeMode === 'puppeteer' && this.isApiOnlyMode()) {
            throw ScraperErrors.invalidConfiguration(
                'Cannot use puppeteer mode when apiOnly is true. Set apiOnly to false or use graphql mode.',
                { scrapeMode, apiOnly: true }
            );
        }

        // If puppeteer mode, use DOM scraping
        if (scrapeMode === 'puppeteer') {
            return this.scrapeThreadDom(options);
        }

        // GraphQL API mode
        return this.scrapeThreadGraphql(options);
    }

    /**
     * 使用 GraphQL API 爬取推文串
     */
    private async scrapeThreadGraphql(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
        try {
            this.ensureApiClient();
        } catch (error) {
            return {
                success: false,
                tweets: [],
                error: error instanceof ScraperError ? error.message : 'API Client not initialized'
            };
        }

        const {
            tweetUrl,
            maxReplies = 100,
            saveMarkdown = true,
            exportCsv = false,
            exportJson = false,
            outputDir
        } = options;
        let { runContext } = options;

        if (!tweetUrl || !tweetUrl.includes('/status/')) {
            return { success: false, tweets: [], error: 'Invalid tweet URL' };
        }

        const parsedUrl = this.parseTweetUrl(tweetUrl);
        if (!parsedUrl) {
            return { success: false, tweets: [], error: 'Could not parse tweet URL' };
        }
        const { username, tweetId } = parsedUrl;

        // Initialize runContext if missing
        if (!runContext) {
            runContext = await fileUtils.createRunContext({
                platform: 'x',
                identifier: `thread-${username}`,
                baseOutputDir: outputDir
            });
            this.eventBus.emitLog(`Created new run context for thread: ${runContext.runId}`);
        }

        this.performanceMonitor.reset();
        this.performanceMonitor.setMode('graphql');
        this.performanceMonitor.start();
        this.emitPerformanceUpdate(true);

        // Track progress (thread replies only; original tweet + replies = total)
        this.progressManager.startScraping('thread', tweetId, maxReplies, false, undefined, this.jobId || options.jobId);

        const apiClient = this.ensureApiClient();
        let originalTweet: Tweet | null = null;
        const replies: Tweet[] = [];
        const scrapedReplyIds = new Set<string>();
        let cursor: string | undefined;

        try {
            this.eventBus.emitLog(`Fetching thread for tweet ${tweetId}...`);

            const apiStartTime = Date.now();
            this.performanceMonitor.startPhase('api-fetch-thread');
            const response = await apiClient.getTweetDetail(tweetId);
            const apiLatency = Date.now() - apiStartTime;
            this.performanceMonitor.endPhase();
            this.performanceMonitor.recordApiRequest(apiLatency, false);

            this.performanceMonitor.startPhase('parse-thread-response');
            const parsed = parseTweetDetailResponse(response, tweetId);
            const parseTime = Date.now() - apiStartTime - apiLatency;
            this.performanceMonitor.endPhase();
            this.performanceMonitor.recordApiParse(parseTime);

            originalTweet = parsed.originalTweet;

            for (const reply of [...parsed.conversationTweets, ...parsed.replies]) {
                if (!scrapedReplyIds.has(reply.id)) {
                    replies.push(reply);
                    scrapedReplyIds.add(reply.id);
                }
            }

            cursor = parsed.nextCursor;
            this.performanceMonitor.recordTweets(replies.length + (originalTweet ? 1 : 0));
            this.eventBus.emitProgress({
                current: replies.length,
                target: maxReplies,
                action: 'fetching replies'
            });
            this.progressManager.updateProgress(replies.length, undefined, cursor);

            // Fetch more replies with pagination
            let consecutiveEmptyFetches = 0;
            const MAX_CONSECUTIVE_EMPTY_FETCHES = 3;

            while (replies.length < maxReplies && cursor) {
                if (this.shouldStop()) {
                    this.eventBus.emitLog('Manual stop signal received.');
                    break;
                }

                const waitTime = getThreadDetailWaitTime();
                await throttle(waitTime);

                const moreApiStartTime = Date.now();
                this.performanceMonitor.startPhase('api-fetch-more-replies');
                const moreResponse = await apiClient.getTweetDetail(tweetId, cursor);
                const moreApiLatency = Date.now() - moreApiStartTime;
                this.performanceMonitor.endPhase();
                this.performanceMonitor.recordApiRequest(moreApiLatency, false);

                const moreParsed = parseTweetDetailResponse(moreResponse, tweetId);

                let addedCount = 0;
                for (const reply of [...moreParsed.conversationTweets, ...moreParsed.replies]) {
                    if (replies.length >= maxReplies) break;
                    if (!scrapedReplyIds.has(reply.id)) {
                        replies.push(reply);
                        scrapedReplyIds.add(reply.id);
                        addedCount++;
                    }
                }

                this.performanceMonitor.recordTweets(replies.length + (originalTweet ? 1 : 0));
                this.eventBus.emitLog(`Fetched ${addedCount} more replies. Total: ${replies.length}`);
                this.eventBus.emitProgress({
                    current: replies.length,
                    target: maxReplies,
                    action: 'fetching replies'
                });
                this.progressManager.updateProgress(replies.length, undefined, moreParsed.nextCursor);

                if (addedCount === 0) {
                    consecutiveEmptyFetches++;
                    if (consecutiveEmptyFetches >= MAX_CONSECUTIVE_EMPTY_FETCHES) {
                        this.eventBus.emitLog(`No new replies found after ${MAX_CONSECUTIVE_EMPTY_FETCHES} attempts. Stopping.`);
                        break;
                    }
                } else {
                    consecutiveEmptyFetches = 0;
                }

                if (!moreParsed.nextCursor || moreParsed.nextCursor === cursor) {
                    this.eventBus.emitLog('Reached end of replies.');
                    break;
                }
                cursor = moreParsed.nextCursor;
            }

            const allTweets = originalTweet ? [originalTweet, ...replies] : replies;

            this.performanceMonitor.startPhase('save-results');
            if (allTweets.length > 0 && runContext) {
                if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
                if (exportCsv) await exportUtils.exportToCsv(allTweets, runContext);
                if (exportJson) await exportUtils.exportToJson(allTweets, runContext);
            }

            // Save to DB if jobId is present
            if (this.jobId && allTweets.length > 0) {
                this.eventBus.emitLog(`Saving ${allTweets.length} tweets to database...`);
                try {
                    const savedCount = await TweetRepository.saveTweets({
                        tweets: allTweets,
                        jobId: this.jobId
                    });
                    this.eventBus.emitLog(`Saved ${savedCount} tweets to database.`);
                } catch (error: any) {
                    this.eventBus.emitLog(`Failed to save tweets to DB: ${error.message}`, 'error');
                }
            }

            this.performanceMonitor.endPhase();

            const activeSession = this.getCurrentSession();
            if (activeSession) {
                this.sessionManager.markGood(activeSession.id);
            }

            this.performanceMonitor.stop();
            this.emitPerformanceUpdate(true);
            this.eventBus.emitLog(this.performanceMonitor.getReport());
            this.progressManager.completeScraping();

            return {
                success: true,
                tweets: allTweets,
                originalTweet,
                replies,
                runContext,
                performance: this.performanceMonitor.getStats()
            };
        } catch (error: unknown) {
            const scraperError = ErrorClassifier.classify(error);
            this.performanceMonitor.stop();
            this.eventBus.emitError(scraperError);
            return {
                success: false,
                tweets: [],
                error: scraperError.getUserMessage(),
                code: scraperError.code,
                retryable: scraperError.retryable
            };
        }
    }

    /**
     * 使用 Puppeteer DOM 爬取推文串（原有逻辑）
     */
    private async scrapeThreadDom(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
        const {
            tweetUrl,
            maxReplies = 100,
            saveMarkdown = true,
            exportCsv = false,
            exportJson = false,
            outputDir
        } = options;
        let { runContext } = options;

        if (!tweetUrl || !tweetUrl.includes('/status/')) {
            return { success: false, tweets: [], error: 'Invalid tweet URL' };
        }

        const parsedUrl = this.parseTweetUrl(tweetUrl);
        if (!parsedUrl) {
            return { success: false, tweets: [], error: 'Could not parse tweet URL' };
        }
        const { username, tweetId } = parsedUrl;

        // Ensure page is available for DOM operations.
        const page = await this.ensureBrowserPage();

        // Initialize runContext if missing
        if (!runContext) {
            runContext = await fileUtils.createRunContext({
                platform: 'x',
                identifier: `thread-${username}`,
                baseOutputDir: outputDir
            });
            this.eventBus.emitLog(`Created new run context for thread: ${runContext.runId}`);
        }

        this.performanceMonitor.reset();
        this.performanceMonitor.setMode('puppeteer');
        this.performanceMonitor.start();
        this.emitPerformanceUpdate(true);

        this.progressManager.startScraping('thread', tweetId, maxReplies);

        const replies: Tweet[] = [];
        const scrapedReplyIds = new Set<string>();
        let originalTweet: Tweet | null = null;

        const extractAndProcessTweets = async (): Promise<number> => {
            this.performanceMonitor.startPhase('extract-thread');
            const tweetsOnPage = await dataExtractor.extractTweetsFromPage(page);
            this.performanceMonitor.endPhase();

            let added = 0;
            if (tweetsOnPage.length > 0) {
                if (!originalTweet) {
                    originalTweet = tweetsOnPage.find(t => t.id === tweetId || t.url.includes(tweetId)) || tweetsOnPage[0];
                }

                for (const tweet of tweetsOnPage) {
                    if (originalTweet && tweet.id === originalTweet.id) continue;
                    if (!scrapedReplyIds.has(tweet.id) && replies.length < maxReplies) {
                        replies.push(tweet as Tweet);
                        scrapedReplyIds.add(tweet.id);
                        added++;
                    }
                }
            }

            this.performanceMonitor.recordTweets(replies.length + (originalTweet ? 1 : 0));
            this.eventBus.emitProgress({
                current: replies.length,
                target: maxReplies,
                action: 'fetching replies'
            });
            this.progressManager.updateProgress(replies.length, originalTweet?.id);
            return added;
        };

        try {
            // Navigate to tweet page and wait for tweets to render
            this.performanceMonitor.startPhase('navigation');
            await this.navigationService.navigateToUrl(page, tweetUrl);
            await this.navigationService.waitForTweets(page, { timeout: 12000, maxRetries: 1 });
            this.performanceMonitor.endPhase();

            // Initial extraction
            await extractAndProcessTweets();

            // Scroll to gather more replies
            let scrollAttempts = 0;
            let consecutiveNoNew = 0;
            const maxScrollAttempts = Math.max(50, Math.ceil(maxReplies / 5));
            const maxNoNew = constants.MAX_CONSECUTIVE_NO_NEW_TWEETS;

            while (replies.length < maxReplies && scrollAttempts < maxScrollAttempts && consecutiveNoNew < maxNoNew) {
                if (this.shouldStop()) {
                    this.eventBus.emitLog('Manual stop signal received.');
                    break;
                }

                scrollAttempts++;
                this.performanceMonitor.startPhase('scroll-thread');
                await dataExtractor.scrollToBottomSmart(page, constants.WAIT_FOR_NEW_TWEETS_TIMEOUT);
                this.performanceMonitor.endPhase();

                await dataExtractor.waitForNewTweets(page, replies.length + (originalTweet ? 1 : 0), 2000);
                const added = await extractAndProcessTweets();

                if (added === 0) {
                    consecutiveNoNew++;
                } else {
                    consecutiveNoNew = 0;
                }
            }

            const allTweets = originalTweet ? [originalTweet, ...replies] : replies;

            this.performanceMonitor.startPhase('save-results');
            if (allTweets.length > 0 && runContext) {
                if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
                if (exportCsv) await exportUtils.exportToCsv(allTweets, runContext);
                if (exportJson) await exportUtils.exportToJson(allTweets, runContext);
            }

            // Save to DB if jobId is present
            if (this.jobId && allTweets.length > 0) {
                this.eventBus.emitLog(`Saving ${allTweets.length} tweets to database...`);
                try {
                    const savedCount = await TweetRepository.saveTweets({
                        tweets: allTweets,
                        jobId: this.jobId
                    });
                    this.eventBus.emitLog(`Saved ${savedCount} tweets to database.`);
                } catch (error: any) {
                    this.eventBus.emitLog(`Failed to save tweets to DB: ${error.message}`, 'error');
                }
            }

            this.performanceMonitor.endPhase();

            const activeSession = this.getCurrentSession();
            if (activeSession) {
                this.sessionManager.markGood(activeSession.id);
            }

            this.performanceMonitor.stop();
            this.emitPerformanceUpdate(true);
            this.eventBus.emitLog(this.performanceMonitor.getReport());
            this.progressManager.completeScraping();

            return {
                success: true,
                tweets: allTweets,
                originalTweet,
                replies,
                runContext,
                performance: this.performanceMonitor.getStats()
            };
        } catch (error: unknown) {
            const scraperError = ErrorClassifier.classify(error);
            this.performanceMonitor.stop();
            this.eventBus.emitError(new Error(`Thread scraping (DOM) failed: ${scraperError.message}`));
            return {
                success: false,
                tweets: [],
                error: scraperError.getUserMessage(),
                code: scraperError.code,
                retryable: scraperError.retryable
            };
        }
    }

    private parseTweetUrl(tweetUrl: string): { username: string; tweetId: string } | null {
        const match = tweetUrl.match(/(?:x|twitter)\.com\/([^\/]+)\/status\/(\d+)/i);
        if (!match) return null;
        return {
            username: match[1],
            tweetId: match[2]
        };
    }

    async close(): Promise<void> {
        if (this.browserManager) {
            if (this.browserPool && this.pooledBrowser) {
                // If using browser pool, release browser instead of closing
                // Close page first
                if (this.page) {
                    try {
                        await this.page.close();
                    } catch (error) {
                        // Ignore page close error
                    }
                    this.page = null;
                }
                // Release browser back to pool
                this.browserPool.release(this.pooledBrowser);
                this.pooledBrowser = null;
                this.browserManager = null;
                this.eventBus.emitLog('Browser released to pool');
            } else {
                // Traditional way: close browser
                await this.browserManager.close();
            }
        }
    }
}
