import * as path from 'path';
import { Page } from 'puppeteer';
import { BrowserLaunchOptions, BrowserManager } from './browser-manager';
import { CookieManager } from './cookie-manager';
import { SessionManager, Session } from './session-manager';
import { ErrorSnapshotter } from './error-snapshotter';
import { FingerprintManager } from './fingerprint-manager';
import * as dataExtractor from './data-extractor';
import { NavigationService } from './navigation-service';
import { RateLimitManager } from './rate-limit-manager';
import { PerformanceMonitor, PerformanceStats } from './performance-monitor';
import eventBusInstance, { ScraperEventBus } from './event-bus';
import * as fileUtils from '../utils/fileutils';
import { RunContext } from '../utils/fileutils';
import * as markdownUtils from '../utils/markdown';
import * as exportUtils from '../utils/export';
import * as screenshotUtils from '../utils/screenshot';
import * as constants from '../config/constants';
import { validateScrapeConfig } from '../config/constants';
import { XApiClient } from './x-api';
import { ScraperErrors, ScraperError } from './errors';
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
} from '../types/tweet';

const throttle = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export interface ScraperEngineOptions {
    headless?: boolean;
    browserOptions?: BrowserLaunchOptions;
    sessionId?: string;
    eventBus?: ScraperEventBus;
    /** 
     * 如果为 true，只初始化 API 客户端，不启动浏览器
     * 适用于纯 GraphQL API 模式，节省资源
     */
    apiOnly?: boolean;
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
    /** 爬取模式: 'graphql' 使用 API (默认), 'puppeteer' 使用 DOM */
    scrapeMode?: 'graphql' | 'puppeteer';
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
    /** 爬取模式: 'graphql' 使用 API (默认), 'puppeteer' 使用 DOM */
    scrapeMode?: 'graphql' | 'puppeteer';
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
    /** 是否为纯 API 模式（不启动浏览器） */
    private apiOnlyMode: boolean;

    private xApiClient: XApiClient | null = null;

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
    private ensureApiClient(): XApiClient {
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
        this.apiOnlyMode = options.apiOnly ?? false;
    }

    setStopSignal(value: boolean): void {
        this.stopSignal = value;
    }

    private async ensurePage(): Promise<Page> {
        if (!this.browserManager) {
            throw ScraperErrors.browserNotInitialized();
        }
        if (!this.page) {
            this.page = await this.browserManager.newPage(this.browserOptions);
        }
        return this.page;
    }

    private async applySession(session: Session, options: { refreshFingerprint?: boolean; clearExistingCookies?: boolean } = {}): Promise<void> {
        // API-only 模式：只更新 API 客户端，不操作浏览器
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
        // Initialize SessionManager (needed for both modes)
        await this.sessionManager.init();

        // 纯 API 模式：不启动浏览器
        if (this.apiOnlyMode) {
            this.eventBus.emitLog('API-only mode: Browser not launched');
            return;
        }

        // 浏览器模式：启动 Puppeteer
        this.browserManager = new BrowserManager();
        await this.browserManager.init(this.browserOptions);
        // We do NOT create the page here anymore. 
        // The page is created in loadCookies() to ensure it's tied to a session and fingerprint.

        this.eventBus.emitLog('Browser launched and configured');
    }

    async loadCookies(): Promise<boolean> {
        // 纯 API 模式：只加载 cookies 初始化 API 客户端
        if (this.apiOnlyMode) {
            return this.loadCookiesApiOnly();
        }

        // 浏览器模式：需要 BrowserManager
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
            
            // Initialize API Client with fallback cookies
            this.xApiClient = new XApiClient(cookieInfo.cookies);
            
            this.eventBus.emitLog(`Loaded legacy cookies from ${cookieInfo.source}`);
            return true;
        } catch (error: any) {
            this.eventBus.emitError(new Error(`Cookie error: ${error.message}`));
            return false;
        }
    }

    /**
     * 纯 API 模式下加载 cookies
     * 只初始化 API 客户端，不涉及浏览器操作
     */
    private async loadCookiesApiOnly(): Promise<boolean> {
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
            const cookieManager = new CookieManager();
            const cookieInfo = await cookieManager.load();
            const fallbackSessionId = cookieInfo.source ? path.basename(cookieInfo.source) : 'legacy-cookies';

            this.currentSession = {
                id: fallbackSessionId,
                cookies: cookieInfo.cookies,
                usageCount: 0,
                errorCount: 0,
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
        // 验证配置
        validateScrapeConfig({
            limit: config.limit,
            username: config.username,
            searchQuery: config.searchQuery,
            mode: config.mode,
            scrapeMode: config.scrapeMode
        });

        const scrapeMode = config.scrapeMode || 'graphql';
        
        // 验证模式组合：如果 apiOnly 为 true，不能使用 puppeteer 模式
        if (scrapeMode === 'puppeteer' && this.isApiOnlyMode()) {
            throw ScraperErrors.invalidConfiguration(
                'Cannot use puppeteer mode when apiOnly is true. Set apiOnly to false or use graphql mode.',
                { scrapeMode, apiOnly: true }
            );
        }
        
        // 如果是 puppeteer 模式，使用 DOM 爬取
        if (scrapeMode === 'puppeteer') {
            return this.scrapeTimelineDom(config);
        }
        
        // GraphQL API 模式
        try {
            this.ensureApiClient();
        } catch (error) {
            return { 
                success: false, 
                tweets: [], 
                error: error instanceof ScraperError ? error.message : 'API Client not initialized' 
            };
        }

        // Start performance monitoring
        this.performanceMonitor.reset();
        this.performanceMonitor.setMode('graphql');
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
        const scrapedIds = new Set<string>();
        let cursor: string | undefined;
        let userId: string | null = null;

        // Resolve User ID if needed
        if (mode === 'timeline' && username) {
            try {
                this.eventBus.emitLog(`Resolving user ID for ${username}...`);
                const apiClient = this.ensureApiClient();
                userId = await apiClient.getUserByScreenName(username);
                if (!userId) {
                    throw ScraperErrors.userNotFound(username);
                }
                this.eventBus.emitLog(`Resolved user ID: ${userId}`);
            } catch (error: any) {
                const errorMessage = error instanceof ScraperError 
                    ? error.message 
                    : `Failed to resolve user: ${error.message}`;
                return { success: false, tweets: [], error: errorMessage };
            }
        }

        let consecutiveErrors = 0;
        let consecutiveEmptyResponses = 0;  // 跟踪连续空响应次数（有游标但无tweets）
        const attemptedSessions = new Set<string>();
        if (this.currentSession) attemptedSessions.add(this.currentSession.id);
        
        // 智能判断系统：区分真实时间线末尾 vs API限制
        const cursorHistory: Array<{ cursor: string; sessionId: string; hasTweets: boolean }> = [];  // 游标历史
        const emptyCursorSessions = new Map<string, Set<string>>();  // 记录哪些session在哪些游标位置返回空

        while (collectedTweets.length < limit) {
            if (this.stopSignal || (this.shouldStopFunction && this.shouldStopFunction())) {
                this.eventBus.emitLog('Manual stop signal received.');
                break;
            }

            try {
                const apiClient = this.ensureApiClient();
                let response: any;
                
                // 记录 API 请求开始时间
                const apiStartTime = Date.now();
                this.performanceMonitor.startPhase(mode === 'search' ? 'api-search' : 'api-fetch-tweets');
                
                if (mode === 'search' && searchQuery) {
                    this.eventBus.emitLog(`Fetching search results for "${searchQuery}"...`);
                    response = await apiClient.searchTweets(searchQuery, 20, cursor);
                } else if (userId) {
                    this.eventBus.emitLog(`Fetching tweets for user ${username}...`);
                    response = await apiClient.getUserTweets(userId, 40, cursor);
                } else {
                    throw ScraperErrors.invalidConfiguration('Invalid configuration: missing username or search query');
                }
                
                // 记录 API 请求延迟
                const apiLatency = Date.now() - apiStartTime;
                this.performanceMonitor.endPhase();
                this.performanceMonitor.recordApiRequest(apiLatency, false);
                
                // 记录解析时间
                this.performanceMonitor.startPhase('parse-api-response');
                const { tweets, nextCursor } = this.parseApiResponse(response);
                const parseTime = Date.now() - apiStartTime - apiLatency;
                this.performanceMonitor.endPhase();
                this.performanceMonitor.recordApiParse(parseTime);

                // 调试日志：显示游标信息
                if (!nextCursor || nextCursor === cursor) {
                    if (tweets.length === 0) {
                        this.eventBus.emitLog(`[DEBUG] API returned ${tweets.length} tweets, no cursor (prev cursor: ${cursor ? 'exists' : 'none'})`);
                    } else {
                        this.eventBus.emitLog(`[DEBUG] API returned ${tweets.length} tweets, no new cursor (prev cursor: ${cursor ? 'exists' : 'none'}) - likely last page`);
                    }
                } else {
                    this.eventBus.emitLog(`[DEBUG] API returned ${tweets.length} tweets, new cursor exists`);
                }

                // 检查是否有游标（即使tweets为空，也可能有游标，说明还有更多数据）
                if (!nextCursor || nextCursor === cursor) {
                    // 没有游标，说明到达了时间线末尾
                    if (tweets.length === 0) {
                        this.eventBus.emitLog(`No more tweets found. Reached end of timeline. (Collected: ${collectedTweets.length}/${limit})`);
                        break;
                    }
                    // 有tweets但没有游标，说明这是最后一页
                    this.eventBus.emitLog(`Reached end of timeline (last page). (Collected: ${collectedTweets.length}/${limit})`);
                    // 继续处理这一页的tweets，然后退出
                } else if (tweets.length === 0) {
                    // 有游标但tweets为空，需要智能判断：真实末尾 vs API限制
                    consecutiveEmptyResponses++;
                    const currentSessionId = this.currentSession?.id || 'unknown';
                    
                    // 分析游标值的变化模式（用于判断是否到达API边界）
                    const cursorValue = nextCursor || '';
                    const cursorNumMatch = cursorValue.match(/\d+/);
                    const cursorNum = cursorNumMatch ? BigInt(cursorNumMatch[0]) : null;
                    
                    // 检查游标是否接近最小值或不再变化
                    if (cursorHistory.length > 0) {
                        const lastCursor = cursorHistory[cursorHistory.length - 1]?.cursor;
                        const lastCursorMatch = lastCursor?.match(/\d+/);
                        const lastCursorNum = lastCursorMatch ? BigInt(lastCursorMatch[0]) : null;
                        
                        if (cursorNum && lastCursorNum && cursorNum === lastCursorNum) {
                            this.eventBus.emitLog(`[DIAGNOSIS] Cursor value unchanged (${cursorValue}), may have reached API boundary`, 'warn');
                        } else if (cursorNum && lastCursorNum && cursorNum < lastCursorNum) {
                            // 游标值在减小但变化很小，可能是接近边界
                            const diff = Number(lastCursorNum - cursorNum);
                            if (diff < 10) {
                                this.eventBus.emitLog(`[DIAGNOSIS] Cursor decreasing very slowly (diff: ${diff}), may be near API limit`, 'warn');
                            }
                        }
                    }
                    
                    // 记录这个游标位置的空响应情况
                    if (!emptyCursorSessions.has(nextCursor || '')) {
                        emptyCursorSessions.set(nextCursor || '', new Set());
                    }
                    emptyCursorSessions.get(nextCursor || '')?.add(currentSessionId);
                    cursorHistory.push({ cursor: nextCursor || '', sessionId: currentSessionId, hasTweets: false });
                    
                    // 分析可能的原因
                    if (consecutiveEmptyResponses === 1) {
                        this.eventBus.emitLog(`[DIAGNOSIS] First empty response at cursor ${cursorValue}. Possible reasons: API limit (~800-900 tweets), rate limit, or timeline end.`, 'info');
                    }
                    
                    // 智能判断：检查这个游标位置是否已经被多个session验证过
                    const sessionsAtThisCursor = emptyCursorSessions.get(nextCursor || '')?.size || 0;
                    
                    // 直接使用attemptedSessions来判断，不需要调用getNextSession（避免产生误导性日志）
                    const allActiveSessions = this.sessionManager.getAllActiveSessions();
                    const hasMoreSessions = allActiveSessions.some(s => !attemptedSessions.has(s.id));
                    
                    // 判断逻辑（更保守，确保尝试所有session）：
                    // 1. 如果≥3个session都在同一游标位置返回空 → 可能是真实末尾（之前是≥2，改为≥3更保守）
                    // 2. 如果所有session都尝试过且都返回空 → 很可能是真实末尾
                    // 3. 如果只有1-2个session尝试过 → 继续切换尝试更多session
                    const likelyRealEnd = sessionsAtThisCursor >= 3 || !hasMoreSessions;
                    
                    // 如果连续2次空响应且还没尝试足够多的session，尝试切换
                    // 确保至少尝试所有4个session（account1,2,3,4）才能判断为真实末尾
                    if (consecutiveEmptyResponses >= 2 && attemptedSessions.size < 4 && !likelyRealEnd) {
                        // 直接获取所有可用session，然后选择第一个未尝试的
                        const allActiveSessions = this.sessionManager.getAllActiveSessions();
                        const untriedSessions = allActiveSessions.filter(s => !attemptedSessions.has(s.id));
                        
                        let nextSession: Session | null = null;
                        
                        if (untriedSessions.length > 0) {
                            // 选择第一个未尝试的session（简单策略，按session列表顺序）
                            nextSession = untriedSessions[0];
                            this.eventBus.emitLog(`Found ${untriedSessions.length} untried session(s): ${untriedSessions.map(s => s.id).join(', ')}`, 'debug');
                        }
                        
                        if (nextSession) {
                            try {
                                await this.applySession(nextSession, { refreshFingerprint: false, clearExistingCookies: true });
                                attemptedSessions.add(nextSession.id);
                                consecutiveEmptyResponses = 0;  // 重置计数器，给新session机会
                                this.performanceMonitor.recordSessionSwitch();
                                this.eventBus.emitLog(`Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried: ${Array.from(attemptedSessions).join(', ')}). Retrying same cursor...`, 'info');
                                
                                // 切换session后立即重试，最小延迟
                                const retryDelay = 200 + Math.random() * 300;  // 200-500ms
                                await throttle(retryDelay);
                                continue;  // 使用新session重试相同的游标
                            } catch (e: any) {
                                this.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
                                // 将这个session标记为已尝试，即使失败
                                attemptedSessions.add(nextSession.id);
                            }
                        } else {
                            this.eventBus.emitLog(`No more untried sessions available. All sessions have been tested: ${Array.from(attemptedSessions).join(', ')}`, 'warn');
                        }
                    }
                    
                    // 判断是否应该停止
                    // 停止条件：
                    // 1. 连续3次空响应 且 至少有2个session验证过（真实末尾）
                    // 2. 所有session都尝试过且都返回空（真实末尾）
                    // 3. 连续5次空响应（保守策略，避免无限循环）
                    // 4. 已尝试所有可用session（account1,2,3,4都试过）
                    const allSessionsTried = attemptedSessions.size >= 4;  // 假设有4个session
                    const shouldStop = 
                        (consecutiveEmptyResponses >= 3 && likelyRealEnd) ||
                        (allSessionsTried && sessionsAtThisCursor >= attemptedSessions.size) ||
                        (consecutiveEmptyResponses >= 5);
                    
                    if (shouldStop) {
                        const triedSessionsList = Array.from(attemptedSessions).join(', ');
                        const reason = allSessionsTried 
                            ? `All ${attemptedSessions.size} sessions (${triedSessionsList}) confirmed empty at this cursor - likely reached Twitter/X API limit (~${collectedTweets.length} tweets)`
                            : likelyRealEnd
                            ? `Multiple sessions (${sessionsAtThisCursor}) confirmed empty at this cursor position - likely reached timeline end`
                            : `Maximum retry attempts (${consecutiveEmptyResponses}) reached`;
                        this.eventBus.emitLog(`${reason}. Stopping. (Collected: ${collectedTweets.length}/${limit})`, 'warn');
                        if (collectedTweets.length < limit) {
                            this.eventBus.emitLog(`Analysis: Twitter/X GraphQL API appears to have a limit of ~${collectedTweets.length} tweets per request chain.`, 'info');
                            this.eventBus.emitLog(`Recommendation: Use 'puppeteer' mode (DOM scraping) for deeper timeline access beyond API limits.`, 'info');
                        }
                        break;
                    }
                    
                    // 空响应时最小延迟重试
                    const retryDelay = 500 + Math.random() * 500;  // 500-1000ms（之前是4-6秒）
                    this.eventBus.emitLog(`Empty response (${sessionsAtThisCursor} session(s) tried at this cursor, attempt ${consecutiveEmptyResponses}). Retrying in ${Math.round(retryDelay)}ms...`, 'warn');
                    cursor = nextCursor;
                    await throttle(retryDelay);
                    continue;
                } else {
                    // 有tweets且游标有效，重置连续空响应计数
                    consecutiveEmptyResponses = 0;
                    // 记录成功的游标位置（用于分析）
                    if (nextCursor) {
                        cursorHistory.push({ cursor: nextCursor, sessionId: this.currentSession?.id || 'unknown', hasTweets: true });
                    }
                }

                let addedCount = 0;
                for (const tweet of tweets) {
                    if (collectedTweets.length >= limit) break;
                    
                    if (!scrapedIds.has(tweet.id)) {
                        // Check stop conditions
                        if (config.stopAtTweetId && tweet.id === config.stopAtTweetId) {
                            this.eventBus.emitLog(`Reached stop tweet ID: ${tweet.id}`);
                            cursor = undefined; // Stop loop
                            break;
                        }
                        if (config.sinceTimestamp && new Date(tweet.time!).getTime() < config.sinceTimestamp) {
                            this.eventBus.emitLog(`Reached time limit: ${tweet.time}`);
                            cursor = undefined; // Stop loop
                            break;
                        }

                        collectedTweets.push(tweet);
                        scrapedIds.add(tweet.id);
                        addedCount++;
                    }
                }

                this.eventBus.emitLog(`Fetched ${tweets.length} tweets, added ${addedCount} new. Total: ${collectedTweets.length}`);
                
                // Update progress
                this.eventBus.emitProgress({
                    current: collectedTweets.length,
                    target: limit,
                    action: 'scraping'
                });

                // Update performance stats and emit update
                this.performanceMonitor.recordTweets(collectedTweets.length);
                this.emitPerformanceUpdate();

                // 如果没有游标或游标没有变化，退出循环
                if (!nextCursor || nextCursor === cursor) {
                    break;
                }
                cursor = nextCursor;
                consecutiveErrors = 0;

                // 最小延迟以避免被检测为机器人：100-500ms随机抖动
                // 只有在遇到错误时才增加延迟
                const baseDelay = consecutiveErrors > 0 ? 2000 : 100;  // 正常时几乎不等待，错误时才等待
                const delay = baseDelay + Math.random() * 400;
                await throttle(delay);

            } catch (error: any) {
                this.performanceMonitor.endPhase();
                this.eventBus.emitLog(`API Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
                consecutiveErrors++;

                // Handle Rate Limits / Session Rotation
                if (error.message.includes('429') || error.message.includes('Authentication failed') || consecutiveErrors >= 3) {
                    this.performanceMonitor.recordRateLimit();
                    const waitStartTime = Date.now();
                    this.eventBus.emitLog(`API Error: ${error.message}. Attempting session rotation...`, 'warn');
                    
                    // 直接获取所有可用session，选择第一个未尝试的（避免getNextSession的排序问题）
                    const allActiveSessions = this.sessionManager.getAllActiveSessions();
                    const untriedSessions = allActiveSessions.filter(s => !attemptedSessions.has(s.id));
                    
                    let nextSession: Session | null = null;
                    
                    if (untriedSessions.length > 0) {
                        // 选择第一个未尝试的session
                        nextSession = untriedSessions[0];
                        this.eventBus.emitLog(`Found ${untriedSessions.length} untried session(s) for rotation: ${untriedSessions.map(s => s.id).join(', ')}`, 'debug');
                    }
                    
                    if (nextSession) {
                        try {
                            await this.applySession(nextSession, { refreshFingerprint: false, clearExistingCookies: true });
                            attemptedSessions.add(nextSession.id);
                            consecutiveErrors = 0;
                            this.performanceMonitor.recordSessionSwitch();
                            const waitTime = Date.now() - waitStartTime;
                            this.performanceMonitor.recordRateLimitWait(waitTime);
                            // Update performance stats after session switch
                            this.performanceMonitor.recordTweets(collectedTweets.length);
                            this.emitPerformanceUpdate();
                            this.eventBus.emitLog(`Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried: ${Array.from(attemptedSessions).join(', ')}). Retrying...`, 'info');
                            // Retry the same request with new session
                            continue;
                        } catch (e: any) {
                            this.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
                            // 即使失败也标记为已尝试
                            attemptedSessions.add(nextSession.id);
                        }
                    }
                    
                    // 如果没有更多未尝试的session，检查是否所有session都尝试过
                    if (untriedSessions.length === 0) {
                        this.eventBus.emitLog(`All ${attemptedSessions.size} session(s) (${Array.from(attemptedSessions).join(', ')}) have been tried. Rate limit may be account-wide or IP-based. Stopping.`, 'error');
                        break;
                    }
                } else {
                    this.performanceMonitor.recordApiRequest(0, true); // 记录重试
                    this.eventBus.emitLog(`Transient error: ${error.message}. Retrying...`, 'warn');
                    // 激进策略：短暂延迟后立即重试
                    const waitTime = 500 + Math.random() * 500;  // 500-1000ms（之前是5000ms）
                    await throttle(waitTime);
                    this.performanceMonitor.recordRateLimitWait(waitTime);
                    // Update performance stats after error handling
                    this.performanceMonitor.recordTweets(collectedTweets.length);
                    this.emitPerformanceUpdate();
                }
            }
        }

        // Save Results
        this.performanceMonitor.startPhase('save-results');
        if (collectedTweets.length > 0) {
            if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(collectedTweets, runContext);
            if (exportCsv) await exportUtils.exportToCsv(collectedTweets, runContext);
            if (exportJson) await exportUtils.exportToJson(collectedTweets, runContext);
            // Screenshot saving is not applicable for API scraping
        }
        this.performanceMonitor.endPhase();

        if (this.currentSession) {
            this.sessionManager.markGood(this.currentSession.id);
        }

        this.performanceMonitor.stop();
        this.emitPerformanceUpdate(true);
        this.eventBus.emitLog(this.performanceMonitor.getReport());

        return { success: true, tweets: collectedTweets, runContext, performance: this.performanceMonitor.getStats() };
    }

    /**
     * 解析 API 响应，使用统一的解析函数
     */
    private parseApiResponse(response: any): { tweets: Tweet[], nextCursor?: string } {
        try {
            const instructions = extractInstructionsFromResponse(response);
            const tweets = parseTweetsFromInstructions(instructions);
            const nextCursor = extractNextCursor(instructions);
            
            // 详细诊断：检查API响应中的限制信息
            const responseData = response?.data?.user?.result?.timeline_v2 || response?.data?.user?.result?.timeline;
            if (responseData) {
                // 检查是否有速率限制信息
                const rateLimit = responseData.rate_limit || response?.rate_limit;
                const errors = response?.errors || responseData?.errors;
                
                if (tweets.length === 0 && nextCursor) {
                    // 空响应但有游标 - 详细分析
                    this.eventBus.emitLog(`[DIAGNOSIS] Empty tweets but cursor exists. Checking for API limits...`, 'debug');
                    
                    // 检查响应中的metadata
                    const metadata = responseData?.timeline?.metadata || responseData?.metadata;
                    if (metadata) {
                        this.eventBus.emitLog(`[DIAGNOSIS] Response metadata: ${JSON.stringify(metadata).substring(0, 200)}`, 'debug');
                    }
                    
                    // 检查是否有instructions但无推文
                    const entryCount = instructions.reduce((count: number, inst: any) => {
                        return count + (inst.entries?.length || 0);
                    }, 0);
                    this.eventBus.emitLog(`[DIAGNOSIS] Instructions: ${instructions.length}, Entries: ${entryCount}, Tweets parsed: ${tweets.length}`, 'debug');
                    
                    if (errors && errors.length > 0) {
                        this.eventBus.emitLog(`[DIAGNOSIS] API returned errors: ${JSON.stringify(errors)}`, 'warn');
                    }
                }
            }
            
            // 调试日志：显示解析详情（仅在debug模式或空响应时）
            if (tweets.length === 0 || instructions.length === 0) {
                const instructionTypes = instructions.map((inst: any) => inst.type).join(', ');
                this.eventBus.emitLog(`[DEBUG] Found ${instructions.length} instructions: ${instructionTypes}`, 'debug');
                
                // 查找所有可能的游标
                const allCursors: string[] = [];
                for (const instruction of instructions) {
                    if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                        for (const entry of instruction.entries) {
                            const entryId = entry.entryId || '';
                            if (entryId.includes('cursor')) {
                                allCursors.push(entryId);
                            }
                        }
                    }
                }
                if (allCursors.length > 0) {
                    this.eventBus.emitLog(`[DEBUG] Found cursor entry IDs: ${allCursors.join(', ')}`, 'debug');
                } else if (!nextCursor) {
                    this.eventBus.emitLog(`[DEBUG] No cursor found in response (this may indicate end of timeline)`, 'debug');
                }
            }
            
            return { tweets, nextCursor };
        } catch (e) {
            this.eventBus.emitLog(`Error parsing API response: ${e instanceof Error ? e.message : String(e)}`, 'error');
            return { tweets: [], nextCursor: undefined };
        }
    }

    /**
     * 使用 Puppeteer DOM 模式爬取时间线
     * 这是较慢但更可靠的方法，模拟真实浏览器行为
     */
    private async scrapeTimelineDom(config: ScrapeTimelineConfig): Promise<ScrapeTimelineResult> {
        // 确保页面可用
        if (!this.page) {
            await this.ensurePage();
        }

        // Start performance monitoring
        this.performanceMonitor.reset();
        this.performanceMonitor.setMode('puppeteer');
        this.performanceMonitor.start();
        this.emitPerformanceUpdate(true);

        const {
            username, limit = 50, mode = 'timeline', searchQuery,
            saveMarkdown = true, saveScreenshots = false,
            exportCsv = false, exportJson = false
        } = config;
        let { runContext } = config;

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
        const scrapedIds = new Set<string>();
        let profileInfo: ProfileInfo | null = null;
        
        // Session 管理（与 GraphQL 模式一致）
        const attemptedSessions = new Set<string>();
        if (this.currentSession) attemptedSessions.add(this.currentSession.id);

        try {
            // 构建目标 URL
            let targetUrl: string;
            if (mode === 'search' && searchQuery) {
                targetUrl = `https://x.com/search?q=${encodeURIComponent(searchQuery)}&src=typed_query&f=live`;
            } else if (username) {
                targetUrl = `https://x.com/${username}`;
            } else {
                targetUrl = 'https://x.com/home';
            }

            // 导航到页面（带 session 切换重试逻辑）
            let navigationSuccess = false;
            let navigationAttempts = 0;
            const maxNavigationAttempts = 4; // 最多尝试4个session
            
            while (!navigationSuccess && navigationAttempts < maxNavigationAttempts) {
                try {
                    this.performanceMonitor.startPhase('navigation');
                    await this.navigationService.navigateToUrl(this.page!, targetUrl);
                    await this.navigationService.waitForTweets(this.page!);
                    this.performanceMonitor.endPhase();
                    navigationSuccess = true;
                } catch (navError: any) {
                    this.performanceMonitor.endPhase();
                    navigationAttempts++;
                    
                    // 检查是否是找不到推文的错误（可能是session问题）
                    const isNoTweetsError = navError.message.includes('No tweets found') || 
                                           navError.message.includes('Waiting for selector') ||
                                           navError.message.includes('tweet');
                    
                    if (isNoTweetsError && attemptedSessions.size < 4) {
                        this.eventBus.emitLog(`Navigation/waitForTweets failed. Attempting session rotation...`, 'warn');
                        
                        const allActiveSessions = this.sessionManager.getAllActiveSessions();
                        const untriedSessions = allActiveSessions.filter(s => !attemptedSessions.has(s.id));
                        
                        if (untriedSessions.length > 0) {
                            const nextSession = untriedSessions[0];
                            try {
                                await this.applySession(nextSession, { refreshFingerprint: false, clearExistingCookies: true });
                                attemptedSessions.add(nextSession.id);
                                this.performanceMonitor.recordSessionSwitch();
                                this.eventBus.emitLog(`Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried). Retrying navigation...`, 'info');
                                
                                // 等待一下再重试
                                await throttle(2000);
                                continue; // 重试导航
                            } catch (e: any) {
                                this.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
                                attemptedSessions.add(nextSession.id);
                            }
                        } else {
                            // 所有session都尝试过了
                            throw navError; // 抛出原始错误
                        }
                    } else {
                        // 不是session问题，或者所有session都试过了，抛出错误
                        throw navError;
                    }
                }
            }
            
            if (!navigationSuccess) {
                throw new Error('Failed to navigate and load tweets after trying all available sessions');
            }

            // 提取资料信息（如果是用户页面）
            if (username && config.collectProfileInfo) {
                profileInfo = await dataExtractor.extractProfileInfo(this.page!);
            }

            // 滚动并提取推文
            let consecutiveNoNew = 0;
            // 对于大目标（>500条），增加连续无新推文的容忍度
            const maxNoNew = limit > 500 ? Math.max(constants.MAX_CONSECUTIVE_NO_NEW_TWEETS * 2, 6) : constants.MAX_CONSECUTIVE_NO_NEW_TWEETS;
            let consecutiveErrors = 0;

            while (collectedTweets.length < limit && consecutiveNoNew < maxNoNew) {
                if (this.stopSignal || (this.shouldStopFunction && this.shouldStopFunction())) {
                    this.eventBus.emitLog('Manual stop signal received.');
                    break;
                }

                try {
                    this.performanceMonitor.startPhase('extraction');
                    const tweetsOnPage = await dataExtractor.extractTweetsFromPage(this.page!);
                    this.performanceMonitor.endPhase();

                    // 检查页面是否显示错误或限制（如 "Something went wrong", "Rate limit" 等）
                    const pageText = await this.page!.evaluate(() => document.body.innerText);
                    const hasError = /rate limit|something went wrong|try again later|suspended|restricted|blocked/i.test(pageText);
                    
                    if (hasError && tweetsOnPage.length === 0) {
                        throw new Error('Page shows error or rate limit message');
                    }

                    let addedCount = 0;
                    for (const rawTweet of tweetsOnPage) {
                        if (collectedTweets.length >= limit) break;
                        
                        const tweetId = rawTweet.id;
                        if (!scrapedIds.has(tweetId)) {
                            // 使用统一的转换函数
                            const tweet = normalizeRawTweet(rawTweet);

                            // Check stop conditions
                            if (config.stopAtTweetId && tweet.id === config.stopAtTweetId) {
                                this.eventBus.emitLog(`Reached stop tweet ID: ${tweet.id}`);
                                consecutiveNoNew = maxNoNew; // Stop loop
                                break;
                            }
                            if (config.sinceTimestamp && tweet.time) {
                                const tweetTime = new Date(tweet.time).getTime();
                                if (tweetTime < config.sinceTimestamp) {
                                    this.eventBus.emitLog(`Reached time limit: ${tweet.time}`);
                                    consecutiveNoNew = maxNoNew; // Stop loop
                                    break;
                                }
                            }

                            collectedTweets.push(tweet);
                            scrapedIds.add(tweetId);
                            addedCount++;
                        }
                    }

                    this.eventBus.emitLog(`Extracted ${tweetsOnPage.length} tweets, added ${addedCount} new. Total: ${collectedTweets.length}`);
                    
                    // Update performance monitor
                    this.performanceMonitor.recordTweets(collectedTweets.length);
                    this.emitPerformanceUpdate();
                    
                    // Update progress
                    this.eventBus.emitProgress({
                        current: collectedTweets.length,
                        target: limit,
                        action: 'scraping (DOM)'
                    });

                    // 重置错误计数（成功提取）
                    consecutiveErrors = 0;

                    if (addedCount === 0) {
                        consecutiveNoNew++;
                        this.eventBus.emitLog(`No new tweets found (consecutive: ${consecutiveNoNew}/${maxNoNew}). Continuing to scroll...`, 'debug');
                        
                        // 如果连续多次没有新推文，可能是页面限制，尝试切换 session
                        // 注意：切换 session 后不重新导航，而是继续滚动，因为新 session 可能能看到更多内容
                        if (consecutiveNoNew >= 3 && attemptedSessions.size < 4) {
                            const allActiveSessions = this.sessionManager.getAllActiveSessions();
                            const untriedSessions = allActiveSessions.filter(s => !attemptedSessions.has(s.id));
                            
                            if (untriedSessions.length > 0) {
                                const nextSession = untriedSessions[0];
                                this.eventBus.emitLog(`Multiple consecutive no-new-tweet cycles. Trying session rotation to ${nextSession.id}...`, 'warn');
                                
                                try {
                                    await this.applySession(nextSession, { refreshFingerprint: false, clearExistingCookies: true });
                                    attemptedSessions.add(nextSession.id);
                                    consecutiveNoNew = 0; // 重置计数器，给新session机会
                                    this.performanceMonitor.recordSessionSwitch();
                                    
                                    // 切换 session 后，刷新页面以应用新 cookies
                                    // 但保持当前滚动位置，继续向下滚动获取更多内容
                                    this.eventBus.emitLog(`Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried). Refreshing page and continuing scroll...`, 'info');
                                    
                                    // 记录当前滚动位置（如果可能）
                                    const currentScrollY = await this.page!.evaluate(() => window.scrollY);
                                    
                                    // 刷新页面以应用新 session 的 cookies
                                    await this.page!.reload({ waitUntil: 'networkidle2', timeout: 30000 });
                                    await this.navigationService.waitForTweets(this.page!);
                                    
                                    // 尝试滚动到之前的位置附近（但可能页面结构已变，所以继续向下滚动）
                                    // 滚动到底部，让新 session 加载更多内容
                                    await this.page!.evaluate(() => {
                                        window.scrollTo(0, document.body.scrollHeight);
                                    });
                                    await throttle(2000); // 等待内容加载
                                    
                                    // 继续循环，尝试提取新内容
                                    continue;
                                } catch (e: any) {
                                    this.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
                                    attemptedSessions.add(nextSession.id); // 标记为已尝试
                                }
                            }
                        }
                        
                        // 如果连续没有新推文，可能是需要更长的滚动等待时间
                        // 增加滚动延迟，给页面更多时间加载新内容
                        if (consecutiveNoNew >= 2) {
                            const extraDelay = 2000 + Math.random() * 1000; // 2-3秒额外延迟
                            this.eventBus.emitLog(`Adding extra delay (${Math.round(extraDelay)}ms) to allow more content to load...`, 'debug');
                            await throttle(extraDelay);
                        }
                    } else {
                        consecutiveNoNew = 0;
                    }

                    // 滚动加载更多（即使连续没有新推文也继续尝试，直到达到最大次数）
                    if (collectedTweets.length < limit && consecutiveNoNew < maxNoNew) {
                        this.performanceMonitor.startPhase('scroll');
                        this.performanceMonitor.recordScroll();
                        await dataExtractor.scrollToBottomSmart(this.page!, constants.WAIT_FOR_NEW_TWEETS_TIMEOUT);
                        await new Promise(r => setTimeout(r, constants.getScrollDelay()));
                        this.performanceMonitor.endPhase();
                    }
                } catch (error: any) {
                    this.performanceMonitor.endPhase();
                    consecutiveErrors++;
                    this.eventBus.emitLog(`Error during extraction: ${error instanceof Error ? error.message : String(error)}`, 'error');
                    
                    // 处理错误：如果是页面错误或连续错误，尝试切换 session
                    if (error.message.includes('rate limit') || error.message.includes('error') || consecutiveErrors >= 3) {
                        this.performanceMonitor.recordRateLimit();
                        this.eventBus.emitLog(`Page error detected. Attempting session rotation...`, 'warn');
                        
                        const allActiveSessions = this.sessionManager.getAllActiveSessions();
                        const untriedSessions = allActiveSessions.filter(s => !attemptedSessions.has(s.id));
                        
                        if (untriedSessions.length > 0) {
                            const nextSession = untriedSessions[0];
                            try {
                                await this.applySession(nextSession, { refreshFingerprint: false, clearExistingCookies: true });
                                attemptedSessions.add(nextSession.id);
                                consecutiveErrors = 0;
                                consecutiveNoNew = 0;
                                this.performanceMonitor.recordSessionSwitch();
                                
                                // 重新导航到目标URL
                                this.performanceMonitor.startPhase('navigation');
                                await this.navigationService.navigateToUrl(this.page!, targetUrl);
                                await this.navigationService.waitForTweets(this.page!);
                                this.performanceMonitor.endPhase();
                                
                                this.eventBus.emitLog(`Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried). Retrying...`, 'info');
                                continue; // 重新开始循环
                            } catch (e: any) {
                                this.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
                                attemptedSessions.add(nextSession.id);
                            }
                        } else {
                            this.eventBus.emitLog(`All sessions attempted. Stopping.`, 'error');
                            break;
                        }
                    } else {
                        // 临时错误，等待后重试
                        const waitTime = 2000 + Math.random() * 1000;
                        await throttle(waitTime);
                    }
                }
            }

            // Save Results
            this.performanceMonitor.startPhase('save-results');
            if (collectedTweets.length > 0) {
                if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(collectedTweets, runContext);
                if (exportCsv) await exportUtils.exportToCsv(collectedTweets, runContext);
                if (exportJson) await exportUtils.exportToJson(collectedTweets, runContext);
                if (saveScreenshots) {
                    await screenshotUtils.takeTimelineScreenshot(this.page!, { runContext, filename: 'final.png' });
                            }
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
                tweets: collectedTweets,
                runContext,
                profile: profileInfo,
                performance: this.performanceMonitor.getStats()
            };

        } catch (error: any) {
            this.performanceMonitor.stop();
            this.eventBus.emitError(new Error(`DOM scraping failed: ${error.message}`));
            
            // 尝试保存错误快照
            if (this.page) {
                await this.errorSnapshotter.capture(this.page, error, 'timeline-dom');
                        }
            
            return { success: false, tweets: collectedTweets, error: error.message };
            }
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
            await this.browserManager.close();
        }
    }
}
