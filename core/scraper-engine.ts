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
import { validateScrapeConfig } from '../config/constants';
import { XApiClient } from './x-api';
import { ScraperErrors, ScraperError, ErrorCode, ErrorClassifier } from './errors';
import { runTimelineApi } from './timeline-api-runner';
import { runTimelineDom } from './timeline-dom-runner';
import { runTimelineDateChunks } from './timeline-date-chunker';
import {
    Tweet,
    ProfileInfo,
    RawTweetData,
    normalizeRawTweet,
    parseTweetFromApiResult,
    extractInstructionsFromResponse,
    parseTweetsFromInstructions,
    extractNextCursor,
    parseTweetDetailResponse
} from '../types';
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
    /** 是否为纯 API 模式（不启动浏览器） */
    private apiOnlyMode: boolean;
    /** 是否允许自动轮换 session（由前端传入） */
    private enableRotation: boolean = true;
    /** 浏览器池（可选，如果提供则复用浏览器实例） */
    public browserPool?: BrowserPool;
    /** 当前使用的浏览器实例（用于池管理） */
    private pooledBrowser: any = null;

    private xApiClient: XApiClient | null = null;

    // 便捷访问器
    public get navigationService() { return this.deps.navigationService; }
    public get rateLimitManager() { return this.deps.rateLimitManager; }
    public get sessionManager() { return this.deps.sessionManager; }
    public get proxyManager() { return this.deps.proxyManager; }
    public get errorSnapshotter() { return this.deps.errorSnapshotter; }
    public get fingerprintManager() { return this.deps.fingerprintManager; }
    public get performanceMonitor() { return this.deps.performanceMonitor; }
    public get progressManager() { return this.deps.progressManager; }
    /** 获取依赖（用于并行处理时共享依赖） */
    public get dependencies() { return this.deps; }

    /**
     * 检查是否为 API 模式（不启动浏览器）
     */
    private isApiOnlyMode(): boolean {
        return this.apiOnlyMode;
    }

    /**
     * 检查是否为 Puppeteer 模式（需要浏览器）
     */
    private isPuppeteerMode(): boolean {
        return !this.apiOnlyMode;
    }

    /**
     * 确保 API 客户端已初始化
     */
    public ensureApiClient(): XApiClient {
        if (!this.xApiClient) {
            throw ScraperErrors.apiClientNotInitialized();
        }
        return this.xApiClient;
    }

    /**
     * 确保浏览器页面已初始化
     */
    private async ensureBrowserPage(): Promise<Page> {
        if (this.apiOnlyMode) {
            throw ScraperErrors.browserNotInitialized();
        }
        return await this.ensurePage();
    }

    constructor(shouldStopFunction?: () => boolean, options: ScraperEngineOptions = {}) {
        this.eventBus = options.eventBus || eventBusInstance;
        
        // 使用依赖注入，解耦依赖创建
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
        
        // 初始化浏览器池（可选功能，默认关闭）
        // 仅在明确提供 browserPoolOptions 或 browserPool 时启用
        // 对于大多数单任务场景，不需要浏览器池，每次创建新浏览器即可
        if (options.browserPool) {
            this.browserPool = options.browserPool;
            this.eventBus.emitLog('[BrowserPool] Using provided browser pool instance', 'info');
        } else if (options.browserPoolOptions && !this.apiOnlyMode) {
            this.browserPool = getBrowserPool(options.browserPoolOptions);
            this.eventBus.emitLog('[BrowserPool] Browser pool enabled with options', 'info');
        }
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
        // API-only mode: 只更新 API 客户端，不操作浏览器
        if (this.isApiOnlyMode()) {
            this.currentSession = session;
            this.xApiClient = new XApiClient(session.cookies);
            this.eventBus.emitLog(`[API-only] Switched to session: ${session.id}${session.username ? ` (${session.username})` : ''}`);
            return;
        }

        // 浏览器模式：需要 page
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
        } catch (error: any) {
            this.eventBus.emitLog(`Performance emit failed: ${error.message}`, 'warn');
        }
    }

    async init(): Promise<void> {
        // Initialize ProxyManager (可选功能，默认不使用代理)
        // 如果没有代理文件，会自动跳过，不影响正常使用
        await this.proxyManager.init();

        // Initialize SessionManager - 解耦：传递 CookieManager 或让 SessionManager 自己创建
        await this.sessionManager.init();

        // 纯 API 模式：不启动浏览器
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
        // 纯 API 模式：只加载 cookies 初始化 API 客户端
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
                // 使用浏览器池获取浏览器实例
                const browser = await this.browserPool.acquire();
                this.pooledBrowser = browser;
                this.browserManager = new BrowserManager();
                this.browserManager.initFromBrowser(browser);
                this.eventBus.emitLog('Browser acquired from pool');
            } else {
                // 传统方式：创建新浏览器
                this.browserManager = new BrowserManager();
                await this.browserManager.init(this.browserOptions);
                this.eventBus.emitLog('Browser launched and configured');
            }
        }

        // 5. Ensure page is created
        try {
            await this.ensurePage();
        } catch (error: any) {
            this.eventBus.emitError(new Error(`Failed to create page: ${error.message}`));
            return false;
        }

        // 6. Apply session to page
        try {
            await this.applySession(nextSession, {
                refreshFingerprint: true,
                clearExistingCookies: true
            });
            return true;
        } catch (error: any) {
            this.eventBus.emitError(new Error(`Failed to inject session ${nextSession.id}: ${error.message}`));
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
                // 忽略页面关闭错误
            }
            this.page = null;
        }
        
        if (this.browserManager) {
            if (this.browserPool && this.pooledBrowser) {
                // 如果使用浏览器池，释放浏览器
                this.browserPool.release(this.pooledBrowser);
                this.pooledBrowser = null;
            } else {
                // 传统方式：关闭浏览器
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
            // 如果之前使用了池，先释放
            if (this.pooledBrowser) {
                this.browserPool.release(this.pooledBrowser);
                this.pooledBrowser = null;
            }
            // 从池中获取新浏览器
            const browser = await this.browserPool.acquire();
            this.pooledBrowser = browser;
            this.browserManager = new BrowserManager();
            this.browserManager.initFromBrowser(browser);
            this.eventBus.emitLog('Browser re-acquired from pool');
        } else {
            // 传统方式：创建新浏览器
            this.browserManager = new BrowserManager();
            await this.browserManager.init(this.browserOptions);
        }
        
        // 5. Create page and inject session
        await this.ensurePage();
        await this.applySession(session, { refreshFingerprint: true, clearExistingCookies: true });
        
        this.eventBus.emitLog(`Browser restarted successfully with session ${session.id}`);
    }

    /**
     * 纯 API 模式下加载 cookies
     * 只初始化 API 客户端，不涉及浏览器操作
     */
    private async loadCookiesApiOnly(enableRotation: boolean = true): Promise<boolean> {
        // 1. 尝试从 SessionManager 获取 session
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
        } catch (error: any) {
            this.eventBus.emitError(new Error(`[API-only] Cookie error: ${error.message}`));
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

        // 使用日期分块的条件：
        // 1. 有dateRange且是search模式
        // 2. 或者enableDeepSearch为true且是search模式（会自动生成dateRange）
        if (config.mode === 'search' && config.searchQuery && config.dateRange) {
            // 日期分块模式：如果配置了并行chunks，自动启用浏览器池（如果还没有启用）
            if (config.parallelChunks && config.parallelChunks > 1 && !this.browserPool) {
                // 自动启用浏览器池以支持并行处理
                const maxPoolSize = Math.min(config.parallelChunks, 3); // 最多3个并发，避免触发限流
                this.browserPool = getBrowserPool({
                    maxSize: maxPoolSize,
                    minSize: 1,
                    browserOptions: this.browserOptions
                });
                this.eventBus.emitLog(`[BrowserPool] Auto-enabled browser pool (size: ${maxPoolSize}) for parallel chunk processing`, 'info');
            }
            return runTimelineDateChunks(this, config);
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
                } catch (fallbackError: any) {
                    this.eventBus.emitLog(`DOM fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`, 'error');
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

        // 验证模式组合：如果 apiOnly 为 true，不能使用 puppeteer 模式
        if (scrapeMode === 'puppeteer' && this.isApiOnlyMode()) {
            throw ScraperErrors.invalidConfiguration(
                'Cannot use puppeteer mode when apiOnly is true. Set apiOnly to false or use graphql mode.',
                { scrapeMode, apiOnly: true }
            );
        }

        // 如果是 puppeteer 模式，使用 DOM 爬取
        if (scrapeMode === 'puppeteer') {
            return this.scrapeThreadDom(options);
        }

        // GraphQL API 模式
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

        // 验证配置
        if (options.maxReplies !== undefined) {
            if (typeof options.maxReplies !== 'number' || options.maxReplies < 1) {
                return {
                    success: false,
                    tweets: [],
                    error: `Invalid maxReplies: must be a positive number, got ${options.maxReplies}`
                };
            }
            if (options.maxReplies > 10000) {
                return {
                    success: false,
                    tweets: [],
                    error: `Invalid maxReplies: must be <= 10000, got ${options.maxReplies}`
                };
            }
        }

        this.performanceMonitor.reset();
        this.performanceMonitor.setMode('graphql');
        this.performanceMonitor.start();
        this.emitPerformanceUpdate(true);

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
                identifier: `thread-${username}`,
                baseOutputDir: options.outputDir
            });
            this.eventBus.emitLog(`Created new run context for thread: ${runContext.runId}`);
        }

        let originalTweet: Tweet | null = null;
        const allReplies: Tweet[] = [];
        const scrapedReplyIds = new Set<string>();
        let cursor: string | undefined;

        try {
            this.eventBus.emitLog(`Fetching thread for tweet ${tweetId}...`);

            // 首次请求获取主推文和初始回复
            const apiStartTime = Date.now();
            this.performanceMonitor.startPhase('api-fetch-thread');
            const apiClient = this.ensureApiClient();
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

            // 添加回复
            for (const reply of [...parsed.conversationTweets, ...parsed.replies]) {
                if (!scrapedReplyIds.has(reply.id)) {
                    allReplies.push(reply);
                    scrapedReplyIds.add(reply.id);
                }
            }

            cursor = parsed.nextCursor;

            this.eventBus.emitLog(`Initial fetch: ${allReplies.length} replies found`);

            // 分页获取更多回复
            while (allReplies.length < maxReplies && cursor) {
                if (this.stopSignal || (this.shouldStopFunction && this.shouldStopFunction())) {
                    this.eventBus.emitLog('Manual stop signal received.');
                    break;
                }

                // 激进策略：最小延迟
                const waitTime = 200 + Math.random() * 300;  // 200-500ms（之前是1500-2500ms）
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
                    if (allReplies.length >= maxReplies) break;
                    if (!scrapedReplyIds.has(reply.id)) {
                        allReplies.push(reply);
                        scrapedReplyIds.add(reply.id);
                        addedCount++;
                    }
                }

                this.eventBus.emitLog(`Fetched ${addedCount} more replies. Total: ${allReplies.length}`);

                this.eventBus.emitProgress({
                    current: allReplies.length,
                    target: maxReplies,
                    action: 'fetching replies'
                });

                if (!moreParsed.nextCursor || moreParsed.nextCursor === cursor) {
                    this.eventBus.emitLog('Reached end of replies.');
                    break;
                }
                cursor = moreParsed.nextCursor;
            }

            const allTweets = originalTweet ? [originalTweet, ...allReplies] : allReplies;

            // Save
            this.performanceMonitor.startPhase('save-results');
            if (allTweets.length > 0) {
                if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
                if (exportCsv) await exportUtils.exportToCsv(allTweets, runContext);
                if (exportJson) await exportUtils.exportToJson(allTweets, runContext);
            }
            this.performanceMonitor.endPhase();

            if (this.currentSession) {
                this.sessionManager.markGood(this.currentSession.id);
            }

            this.performanceMonitor.stop();
            this.emitPerformanceUpdate(true);
            this.eventBus.emitLog(this.performanceMonitor.getReport());

            return {
                success: true,
                tweets: allTweets,
                originalTweet,
                replies: allReplies,
                runContext,
                performance: this.performanceMonitor.getStats()
            };

        } catch (error: any) {
            this.performanceMonitor.stop();
            this.eventBus.emitError(new Error(`Thread scraping (GraphQL) failed: ${error.message}`));
            return { success: false, tweets: [], error: error.message };
        }
    }

    /**
     * 使用 Puppeteer DOM 爬取推文串（原有逻辑）
     */
    private async scrapeThreadDom(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
        // Ensure page is available for DOM operations.
        if (!this.page) {
            await this.ensurePage();
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
                identifier: `thread-${username}`,
                baseOutputDir: options.outputDir
            });
            this.eventBus.emitLog(`Created new run context for thread: ${runContext.runId}`);
        }

        let originalTweet: Tweet | null = null;
        const allReplies: Tweet[] = [];
        const scrapedReplyIds = new Set<string>();

        try {
            // Navigate
            await this.navigationService.navigateToUrl(this.page!, tweetUrl);
            await this.navigationService.waitForTweets(this.page!);

            // Extract Original Tweet
            let tweetsOnPage = await dataExtractor.extractTweetsFromPage(this.page!);
            if (tweetsOnPage.length > 0) {
                originalTweet = tweetsOnPage.find(t => t.id === tweetId || t.url.includes(tweetId)) || tweetsOnPage[0];

                tweetsOnPage.forEach(tweet => {
                    if (tweet.id !== originalTweet?.id && !scrapedReplyIds.has(tweet.id)) {
                        allReplies.push(tweet as Tweet);
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
                await dataExtractor.scrollToBottomSmart(this.page!, constants.WAIT_FOR_NEW_TWEETS_TIMEOUT);
                // Double check DOM update
                await dataExtractor.waitForNewTweets(this.page!, tweetsOnPage.length, 2000);

                const newTweets = await dataExtractor.extractTweetsFromPage(this.page!);
                for (const tweet of newTweets) {
                    if (allReplies.length >= maxReplies) break;
                    if (tweet.id === originalTweet?.id) continue;
                    if (!scrapedReplyIds.has(tweet.id)) {
                        allReplies.push(tweet as Tweet);
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
            this.eventBus.emitError(new Error(`Thread scraping (DOM) failed: ${error.message}`));
            return { success: false, tweets: [], error: error.message };
        }
    }

    async close(): Promise<void> {
        if (this.browserManager) {
            if (this.browserPool && this.pooledBrowser) {
                // 如果使用浏览器池，释放浏览器而不是关闭
                // 先关闭页面
                if (this.page) {
                    try {
                        await this.page.close();
                    } catch (error) {
                        // 忽略页面关闭错误
                    }
                    this.page = null;
                }
                // 释放浏览器回池中
                this.browserPool.release(this.pooledBrowser);
                this.pooledBrowser = null;
                this.browserManager = null;
                this.eventBus.emitLog('Browser released to pool');
            } else {
                // 传统方式：关闭浏览器
                await this.browserManager.close();
            }
        }
    }
}
