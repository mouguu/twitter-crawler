import * as path from 'node:path';
import { Page } from 'puppeteer';
import * as fileUtils from '../utils';
import * as markdownUtils from '../utils';
import * as exportUtils from '../utils';
import { validateScrapeConfig, getThreadDetailWaitTime } from '../config/constants';
import * as constants from '../config/constants';
import { parseTweetDetailResponse, Tweet } from '../types/tweet-definitions';

import { BrowserLaunchOptions, BrowserManager, ProxyConfig as BrowserProxyConfig } from './browser-manager';
import { CookieManager } from './cookie-manager';
import * as dataExtractor from './data-extractor';
import { TweetRepository } from './db/tweet-repo';
import { ErrorClassifier, ScraperErrors } from './errors';
import { createDefaultDependencies, ScraperDependencies } from './scraper-dependencies';
import { Session } from './session-manager';
import { runTimelineApi } from './timeline-api-runner';
import { runTimelineDom } from './timeline-dom-runner';
import { XApiClient } from './x-api';
import { cleanTweetsFast, waitOrCancel } from '../utils';

import {
  ScraperEngineOptions,
  ScrapeThreadOptions,
  ScrapeThreadResult,
  ScrapeTimelineConfig,
  ScrapeTimelineResult,
  ScraperLogger,
  ScraperEventBus,
} from './scraper-engine.types';

export type {
  ScraperEngineOptions,
  ScrapeThreadOptions,
  ScrapeThreadResult,
  ScrapeTimelineConfig,
  ScrapeTimelineResult,
} from './scraper-engine.types';

const throttle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ScraperEngine {
  private deps: ScraperDependencies;
  private lastPerformanceEmit: number = 0;
  private currentSession: Session | null = null;
  private browserManager: BrowserManager | null;
  private page: Page | null;
  private stopSignal: boolean;
  private shouldStopFunction?: () => boolean | Promise<boolean>;
  private browserOptions: BrowserLaunchOptions;
  
  public preferredSessionId: string | undefined;
  private apiOnlyMode: boolean;
  private enableRotation: boolean = true;
  private jobId?: string;

  private xApiClient: XApiClient | null = null;
  
  private logger?: ScraperLogger;
  private onProgress?: (progress: { current: number; target: number; action: string }) => void;

  // Compatibility layer for legacy runners that expect eventBus
  public readonly eventBus: ScraperEventBus;

  // Accessors
  public get navigationService() { return this.deps.navigationService; }
  public get rateLimitManager() { return this.deps.rateLimitManager; }
  public get sessionManager() { return this.deps.sessionManager; }
  public get proxyManager() { return this.deps.proxyManager; }
  public get errorSnapshotter() { return this.deps.errorSnapshotter; }
  public get antiDetection() { return this.deps.antiDetection; }
  public get performanceMonitor() { return this.deps.performanceMonitor; }
  public get progressManager() { return this.deps.progressManager; }
  public get dependencies() { return this.deps; }

  private isApiOnlyMode(): boolean { return this.apiOnlyMode; }

  public ensureApiClient(): XApiClient {
    if (!this.xApiClient) {
      throw ScraperErrors.apiClientNotInitialized();
    }
    return this.xApiClient;
  }

  private async ensureBrowserPage(): Promise<Page> {
    if (this.apiOnlyMode) {
      throw ScraperErrors.browserNotInitialized();
    }
    return await this.ensurePage();
  }

  constructor(
    shouldStopFunction?: () => boolean | Promise<boolean>,
    options: ScraperEngineOptions = {},
  ) {
    this.logger = options.logger;
    this.onProgress = options.onProgress;
    
    // Dependencies
    this.deps = options.dependencies || createDefaultDependencies(
        { emitLog: this.log.bind(this) } as any, // Mock event bus for deps that still need it
        './cookies',
        './data/progress',
        options.antiDetectionLevel || 'high'
    );

    this.browserManager = null;
    this.page = null;
    this.stopSignal = false;
    this.shouldStopFunction = shouldStopFunction;
    this.browserOptions = {
      headless: options.headless ?? true,
      ...(options.browserOptions || {}),
    };
    this.preferredSessionId = options.sessionId;
    this.apiOnlyMode = options.apiOnly ?? false;

    this.jobId = options.jobId;

    // Initialize compat eventBus
    this.eventBus = {
      emitLog: (msg, level = 'info') => this.log(msg, level),
      emitProgress: (prog) => this.emitProgress(prog),
      emitError: (err) => this.log(err.message, 'error'),
      emitPerformance: (_data) => { /* no-op or log debug */ },
    };
  }

  public log(message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') {
    if (!this.logger) return;
    switch(level) {
      case 'warn': this.logger.warn(message); break;
      case 'error': this.logger.error(message); break;
      case 'debug': 
      case 'info': 
      default: this.logger.info(message); break;
    }
  }

  public emitProgress(progress: { current: number; target: number; action: string }) {
    if (this.onProgress) this.onProgress(progress);
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

  async shouldStop(): Promise<boolean> {
    const fnResult = this.shouldStopFunction ? await this.shouldStopFunction() : false;
    return this.stopSignal || fnResult;
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

  public async applySession(
    session: Session,
    options: { refreshFingerprint?: boolean; clearExistingCookies?: boolean } = {},
  ): Promise<void> {
    // API-only mode
    if (this.isApiOnlyMode()) {
      this.currentSession = session;
      let xApiProxy: any = undefined; // Use any to match Proxy type structure dynamically if needed, or import Proxy type
      
      if (this.proxyManager.hasProxies()) {
        const proxy = this.proxyManager.getNextProxy();
        if (proxy) {
            xApiProxy = proxy;
        }
      }
      this.xApiClient = new XApiClient(session.cookies, xApiProxy);
      this.log(`[API-only] Switched to session: ${session.id}${session.username ? ` (${session.username})` : ''}`);
      return;
    }

    // Browser mode
    if (!this.page) throw ScraperErrors.pageNotAvailable();

    const sessionId = session.filePath ? path.basename(session.filePath) : session.id;
    if (options.refreshFingerprint !== false) {
      await this.antiDetection.prepare(this.page, sessionId);
      this.log(`[AntiDetection] Applied ${this.antiDetection.getLevel()} level protection`);
    }

    await this.sessionManager.injectSession(this.page, session, options.clearExistingCookies !== false);
    this.currentSession = session;

    let xApiProxy: any = undefined;
    if (this.proxyManager.hasProxies()) {
        const proxy = this.proxyManager.getNextProxy();
        if (proxy) {
            xApiProxy = proxy;
        }
    }

    this.xApiClient = new XApiClient(session.cookies, xApiProxy);
    this.log(`Loaded session: ${session.id}${session.username ? ` (${session.username})` : ''}`);
  }

  public emitPerformanceUpdate(force: boolean = false): void {
     // Optional: log performance stats periodically if debug logging enabled
  }

  async init(): Promise<void> {
    await this.proxyManager.init();
    await this.sessionManager.init();

    if (this.apiOnlyMode) {
      this.log('API-only mode: Browser not launched');
      return;
    }
    this.log('SessionManager and ProxyManager initialized');
  }

  async loadCookies(enableRotation: boolean = true): Promise<boolean> {
    this.enableRotation = enableRotation !== false;
    if (this.rateLimitManager) {
      this.rateLimitManager.setEnableRotation(this.enableRotation);
      this.log(this.enableRotation ? 'Auto-rotation enabled' : 'Auto-rotation disabled', this.enableRotation ? 'info' : 'warn');
    }

    if (this.apiOnlyMode) {
      return this.loadCookiesApiOnly(this.enableRotation);
    }

    const nextSession = await this.sessionManager.getNextSession(this.preferredSessionId);
    if (!nextSession) {
      this.log('No session available', 'error');
      return false;
    }

    let browserProxyConfig: BrowserProxyConfig | undefined;
    if (this.proxyManager.hasProxies()) {
      const proxy = this.proxyManager.getNextProxy();
      if (proxy) {
        browserProxyConfig = {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username || '',
            password: proxy.password || '',
        };
        this.log(`[ProxyManager] Binding session ${nextSession.id} -> proxy ${proxy.host}:${proxy.port}`);
      }
    }

    if (!this.apiOnlyMode) {
      try {
        const fingerprint = this.antiDetection.getFingerprint(nextSession.id);
        if (fingerprint) {
          if (fingerprint.navigator?.userAgent) this.browserOptions.userAgent = fingerprint.navigator.userAgent;
          if (fingerprint.screen) this.browserOptions.viewport = { width: fingerprint.screen.width, height: fingerprint.screen.height };
          this.browserOptions.randomizeFingerprint = false;
          this.log(`[Fingerprint] Synced browser launch options`);
        }
      } catch (fpError: any) {
        this.log(`Failed to sync fingerprint: ${fpError.message}`, 'warn');
      }
    }

    this.browserOptions.proxy = browserProxyConfig;

    if (!this.browserManager) {
      this.browserManager = new BrowserManager();
      await this.browserManager.init(this.browserOptions);
      this.log('Browser launched and configured');
    }

    try {
      await this.ensurePage();
    } catch (error: unknown) {
      this.log(`Failed to create page: ${error}`, 'error');
      return false;
    }

    try {
      await this.applySession(nextSession, { refreshFingerprint: true, clearExistingCookies: true });
      return true;
    } catch (error: unknown) {
      this.log(`Failed to inject session ${nextSession.id}: ${error}`, 'error');
      this.sessionManager.markBad(nextSession.id);
      return false;
    }
  }

  public async restartBrowserWithSession(session: Session): Promise<void> {
    this.log(`Restarting browser for session ${session.id}...`);

    if (this.page) {
      try { await this.page.close(); } catch {}
      this.page = null;
    }
    if (this.browserManager) {
      await this.browserManager.close();
      this.browserManager = null;
    }

    let browserProxyConfig: BrowserProxyConfig | undefined;
    if (this.proxyManager.hasProxies()) {
      const proxy = this.proxyManager.getNextProxy();
      if (proxy) {
        browserProxyConfig = {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username || '',
            password: proxy.password || '',
        };
        this.log(`[ProxyManager] Switching to proxy ${proxy.host}:${proxy.port}`);
      }
    }

    try {
      const fingerprint = this.antiDetection.getFingerprint(session.id);
      if (fingerprint) {
        if (fingerprint.navigator?.userAgent) this.browserOptions.userAgent = fingerprint.navigator.userAgent;
        if (fingerprint.screen) this.browserOptions.viewport = { width: fingerprint.screen.width, height: fingerprint.screen.height };
        this.browserOptions.randomizeFingerprint = false;
      }
    } catch {}

    this.browserOptions.proxy = browserProxyConfig;
    this.browserManager = new BrowserManager();
    await this.browserManager.init(this.browserOptions);
    await this.ensurePage();
    await this.applySession(session, { refreshFingerprint: true, clearExistingCookies: true });

    this.log(`Browser restarted successfully with session ${session.id}`);
  }

  private async loadCookiesApiOnly(enableRotation: boolean = true): Promise<boolean> {
    const nextSession = await this.sessionManager.getNextSession(this.preferredSessionId);
    if (nextSession) {
      this.currentSession = nextSession;
      
      let xApiProxy: any = undefined;
      if (this.proxyManager.hasProxies()) {
        const proxy = this.proxyManager.getNextProxy();
        if (proxy) {
          xApiProxy = proxy;
        }
      }

      this.xApiClient = new XApiClient(nextSession.cookies, xApiProxy);
      this.log(`[API-only] Loaded session: ${nextSession.id}`);
      return true;
    }

    try {
      const cookieManager = new CookieManager({ enableRotation });
      const cookieInfo = await cookieManager.load();
      this.currentSession = {
        id: 'legacy-cookies',
        cookies: cookieInfo.cookies,
        usageCount: 0,
        errorCount: 0,
        consecutiveFailures: 0,
        isRetired: false,
        platform: 'twitter',
        username: null,
        filePath: 'mock-session.json',
      };
      this.xApiClient = new XApiClient(cookieInfo.cookies);
      this.log(`[API-only] Loaded cookies from ${cookieInfo.source}`);
      return true;
    } catch (error: any) {
      this.log(`[API-only] Cookie error: ${error.message}`, 'error');
      return false;
    }
  }

  async scrapeTimeline(config: ScrapeTimelineConfig): Promise<ScrapeTimelineResult> {
    validateScrapeConfig({
      limit: config.limit,
      username: config.username,
      searchQuery: config.searchQuery,
      mode: config.mode,
      scrapeMode: config.scrapeMode,
    });

    const scrapeMode = config.scrapeMode || 'graphql';

    if (scrapeMode === 'puppeteer' && this.isApiOnlyMode()) {
      throw ScraperErrors.invalidConfiguration(
        'Cannot use puppeteer mode when apiOnly is true.',
      );
    }
    
    if (config.mode === 'search' && config.searchQuery && config.dateRange) {
        const { runTimelineDateChunks } = await import('./timeline-date-chunker');
        return runTimelineDateChunks(this, config);
    }

    if (this.jobId && !config.jobId) config.jobId = this.jobId;

    if (scrapeMode === 'puppeteer') {
      return runTimelineDom(this, config);
    }

    try {
      this.ensureApiClient();
    } catch (error) {
      return {
        success: false,
        tweets: [],
        error: error instanceof Error ? error.message : 'API Client not initialized',
      };
    }

    this.performanceMonitor.reset();
    this.performanceMonitor.setMode('graphql');
    this.performanceMonitor.start();

    const result = await runTimelineApi(this, config);
    result.tweets = result.tweets || [];

    let runContext = result.runContext;
    if (!runContext) {
      const identifier = config.username || config.searchQuery || 'unknown';
      runContext = await fileUtils.createRunContext({
        platform: 'x',
        identifier,
        baseOutputDir: config.outputDir,
      });
      result.runContext = runContext;
    }

    if (result.tweets.length > 0 && runContext) {
        const { saveMarkdown = true, exportCsv = false, exportJson = false } = config;
        if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(result.tweets, runContext);
        if (exportCsv) await exportUtils.exportToCsv(result.tweets, runContext);
        if (exportJson) await exportUtils.exportToJson(result.tweets, runContext);
    }

    if (this.jobId && result.tweets.length > 0) {
      this.log(`Saving ${result.tweets.length} tweets to database...`);
      try {
        const savedCount = await TweetRepository.saveTweets({
          tweets: result.tweets,
          jobId: this.jobId,
        });
        this.log(`Saved ${savedCount} tweets to database.`);
      } catch (error: any) {
        this.log(`Failed to save tweets to DB: ${error.message}`, 'error');
      }
    }

    const activeSession = this.getCurrentSession();
    if (activeSession) {
      this.sessionManager.markGood(activeSession.id);
    }
    
    this.performanceMonitor.stop();
    this.progressManager.completeScraping();
    result.success = result.tweets.length > 0;
    return {
      ...result,
      performance: this.performanceMonitor.getStats(),
    };
  }

  async scrapeThread(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
     const scrapeMode = options.scrapeMode || 'graphql';
     if (scrapeMode === 'puppeteer' && this.isApiOnlyMode()) {
       throw ScraperErrors.invalidConfiguration('Cannot use puppeteer mode when apiOnly is true.');
     }
     if (scrapeMode === 'puppeteer') {
        return this.scrapeThreadDom(options);
     }
     return this.scrapeThreadGraphql(options);
  }

  private async scrapeThreadGraphql(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
    const {
      tweetUrl,
      maxReplies = 100,
      saveMarkdown = true,
      exportCsv = false,
      exportJson = false,
      outputDir,
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
        baseOutputDir: outputDir,
      });
      this.log(`Created new run context for thread: ${runContext.runId}`);
    }

    this.performanceMonitor.reset();
    this.performanceMonitor.setMode('graphql');
    this.performanceMonitor.start();
    this.emitPerformanceUpdate(true);

    // Track progress (thread replies only; original tweet + replies = total)
    this.progressManager.startScraping(
      'thread',
      tweetId,
      maxReplies,
      false,
      undefined,
      this.jobId || options.jobId,
    );

    const apiClient = this.ensureApiClient();
    let originalTweet: Tweet | null = null;
    const replies: Tweet[] = [];
    const scrapedReplyIds = new Set<string>();
    let cursor: string | undefined;

    try {
      this.log(`Fetching thread for tweet ${tweetId}...`);

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
      this.emitProgress({
        current: replies.length,
        target: maxReplies,
        action: 'fetching replies',
      });
      this.progressManager.updateProgress(replies.length, undefined, cursor);

      // Fetch more replies with pagination
      let consecutiveEmptyFetches = 0;
      const MAX_CONSECUTIVE_EMPTY_FETCHES = 3;

      while (replies.length < maxReplies && cursor) {
        if (await this.shouldStop()) {
          this.log('Manual stop signal received.');
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
        this.log(`Fetched ${addedCount} more replies. Total: ${replies.length}`);
        this.emitProgress({
          current: replies.length,
          target: maxReplies,
          action: 'fetching replies',
        });
        this.progressManager.updateProgress(replies.length, undefined, moreParsed.nextCursor);

        if (addedCount === 0) {
          consecutiveEmptyFetches++;
          if (consecutiveEmptyFetches >= MAX_CONSECUTIVE_EMPTY_FETCHES) {
            this.log(
              `No new replies found after ${MAX_CONSECUTIVE_EMPTY_FETCHES} attempts. Stopping.`,
            );
            break;
          }
        } else {
          consecutiveEmptyFetches = 0;
        }

        if (!moreParsed.nextCursor || moreParsed.nextCursor === cursor) {
          this.log('Reached end of replies.');
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
        this.log(`Saving ${allTweets.length} tweets to database...`);
        try {
          const savedCount = await TweetRepository.saveTweets({
            tweets: allTweets,
            jobId: this.jobId,
          });
          this.log(`Saved ${savedCount} tweets to database.`);
        } catch (error: any) {
          this.log(`Failed to save tweets to DB: ${error.message}`, 'error');
        }
      }

      this.performanceMonitor.endPhase();

      const activeSession = this.getCurrentSession();
      if (activeSession) {
        this.sessionManager.markGood(activeSession.id);
      }

      this.performanceMonitor.stop();
      this.emitPerformanceUpdate(true);
      // this.eventBus.emitLog(this.performanceMonitor.getReport()); // Use logger if needed
      this.progressManager.completeScraping();

      return {
        success: true,
        tweets: allTweets,
        originalTweet,
        replies,
        runContext,
        performance: this.performanceMonitor.getStats(),
      };
    } catch (error: unknown) {
      const scraperError = ErrorClassifier.classify(error);
      this.performanceMonitor.stop();
      this.log(scraperError.message, 'error');
      return {
        success: false,
        tweets: [],
        error: scraperError.getUserMessage(),
        code: scraperError.code,
        retryable: scraperError.retryable,
      };
    }
  }

  private async scrapeThreadDom(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
    const {
      tweetUrl,
      maxReplies = 100,
      saveMarkdown = true,
      exportCsv = false,
      exportJson = false,
      outputDir,
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
        baseOutputDir: outputDir,
      });
      this.log(`Created new run context for thread: ${runContext.runId}`);
    }

    this.performanceMonitor.reset();
    this.performanceMonitor.setMode('puppeteer');
    this.performanceMonitor.start();
    this.emitPerformanceUpdate(true);

    this.progressManager.startScraping('thread', tweetId, maxReplies);

    const replies: Tweet[] = [];
    const scrapedReplyIds = new Set<string>();
    let originalTweet: Tweet | null = null;
    
    // Helper to log progress using class methods
    const logProgress = (
        current: number, 
        target: number, 
        action: string
    ) => {
        this.emitProgress({ current, target, action });
    };

    const extractAndProcessTweets = async (): Promise<number> => {
      this.performanceMonitor.startPhase('extract-thread');
      const tweetsOnPage = await dataExtractor.extractTweetsFromPage(page);
      this.performanceMonitor.endPhase();

      let added = 0;
      if (tweetsOnPage.length > 0) {
        if (!originalTweet) {
          originalTweet =
            tweetsOnPage.find((t) => t.id === tweetId || t.url.includes(tweetId)) ||
            tweetsOnPage[0];
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
      logProgress(replies.length, maxReplies, 'fetching replies');
      
      this.progressManager.updateProgress(replies.length, originalTweet?.id);
      return added;
    };

    try {
      this.performanceMonitor.startPhase('navigation');
      await this.navigationService.navigateToUrl(page, tweetUrl);
      await this.navigationService.waitForTweets(page, { timeout: 12000, maxRetries: 1 });
      this.performanceMonitor.endPhase();

      await extractAndProcessTweets();

      let scrollAttempts = 0;
      let consecutiveNoNew = 0;
      const maxScrollAttempts = Math.max(50, Math.ceil(maxReplies / 5));
      const maxNoNew = constants.MAX_CONSECUTIVE_NO_NEW_TWEETS;

      while (
        replies.length < maxReplies &&
        scrollAttempts < maxScrollAttempts &&
        consecutiveNoNew < maxNoNew
      ) {
        if (await this.shouldStop()) {
          this.log('Manual stop signal received.');
          break;
        }

        scrollAttempts++;
        this.performanceMonitor.startPhase('scroll-thread');
        await dataExtractor.scrollToBottomSmart(
          page,
          constants.WAIT_FOR_NEW_TWEETS_TIMEOUT,
          () => this.shouldStop()
        );
        this.performanceMonitor.endPhase();

        await waitOrCancel(
          dataExtractor.waitForNewTweets(page, replies.length + (originalTweet ? 1 : 0), 2000),
          () => this.shouldStop()
        );
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

      if (this.jobId && allTweets.length > 0) {
        this.log(`Saving ${allTweets.length} tweets to database...`);
        try {
          const savedCount = await TweetRepository.saveTweets({
            tweets: allTweets,
            jobId: this.jobId,
          });
          this.log(`Saved ${savedCount} tweets to database.`);
        } catch (error: any) {
          this.log(`Failed to save tweets to DB: ${error.message}`, 'error');
        }
      }

      this.performanceMonitor.endPhase();

      const activeSession = this.getCurrentSession();
      if (activeSession) {
        this.sessionManager.markGood(activeSession.id);
      }

      this.performanceMonitor.stop();
      this.emitPerformanceUpdate(true);
      this.progressManager.completeScraping();

      return {
        success: true,
        tweets: allTweets,
        originalTweet,
        replies,
        runContext,
        performance: this.performanceMonitor.getStats(),
      };
    } catch (error: unknown) {
      const scraperError = ErrorClassifier.classify(error);
      this.performanceMonitor.stop();
      this.log(`Thread scraping (DOM) failed: ${scraperError.message}`, 'error');
      return {
        success: false,
        tweets: [],
        error: scraperError.getUserMessage(),
        code: scraperError.code,
        retryable: scraperError.retryable,
      };
    }
  }

  private parseTweetUrl(tweetUrl: string): { username: string; tweetId: string } | null {
    const match = tweetUrl.match(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/i);
    if (!match) return null;
    return {
      username: match[1],
      tweetId: match[2],
    };
  }

  async close(): Promise<void> {
    if (this.browserManager) {
        await this.browserManager.close();
        this.browserManager = null;
    }
    this.page = null;
  }
}
