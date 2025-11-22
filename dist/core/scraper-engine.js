"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScraperEngine = void 0;
const path = __importStar(require("path"));
const browser_manager_1 = require("./browser-manager");
const cookie_manager_1 = require("./cookie-manager");
const session_manager_1 = require("./session-manager");
const request_queue_1 = require("./request-queue"); // Import RequestQueue
const error_snapshotter_1 = require("./error-snapshotter");
const fingerprint_manager_1 = require("./fingerprint-manager");
const dataExtractor = __importStar(require("./data-extractor"));
const navigation_service_1 = require("./navigation-service");
const rate_limit_manager_1 = require("./rate-limit-manager");
const event_bus_1 = __importDefault(require("./event-bus"));
const fileUtils = __importStar(require("../utils/fileutils"));
const markdownUtils = __importStar(require("../utils/markdown"));
const exportUtils = __importStar(require("../utils/export"));
const screenshotUtils = __importStar(require("../utils/screenshot"));
const constants = __importStar(require("../config/constants"));
const throttle = (ms) => new Promise(resolve => setTimeout(resolve, ms));
class ScraperEngine {
    constructor(shouldStopFunction, options = {}) {
        this.currentSession = null;
        this.eventBus = event_bus_1.default;
        this.navigationService = new navigation_service_1.NavigationService(this.eventBus);
        this.rateLimitManager = new rate_limit_manager_1.RateLimitManager(this.eventBus);
        this.sessionManager = new session_manager_1.SessionManager();
        this.requestQueue = new request_queue_1.RequestQueue(); // Initialize RequestQueue
        this.errorSnapshotter = new error_snapshotter_1.ErrorSnapshotter();
        this.fingerprintManager = new fingerprint_manager_1.FingerprintManager();
        this.browserManager = null;
        this.page = null;
        this.stopSignal = false;
        this.shouldStopFunction = shouldStopFunction;
        this.browserOptions = {
            headless: options.headless ?? true,
            ...(options.browserOptions || {})
        };
    }
    setStopSignal(value) {
        this.stopSignal = value;
    }
    async init() {
        this.browserManager = new browser_manager_1.BrowserManager();
        await this.browserManager.init(this.browserOptions);
        // We do NOT create the page here anymore. 
        // The page is created in loadCookies() to ensure it's tied to a session and fingerprint.
        // Initialize Managers
        await this.sessionManager.init();
        // RequestQueue auto-loads state in constructor
        this.eventBus.emitLog('Browser launched and configured');
    }
    async loadCookies() {
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
            }
            catch (error) {
                this.eventBus.emitError(new Error(`Failed to inject session ${this.currentSession.id}: ${error.message}`));
                this.sessionManager.markBad(this.currentSession.id);
                return false;
            }
        }
        // 2. Fallback to legacy single-file loading (env.json or cookies/twitter-cookies.json)
        // This ensures backward compatibility if no multi-session files are found
        try {
            const cookieManager = new cookie_manager_1.CookieManager();
            const cookieInfo = await cookieManager.loadAndInject(this.page);
            this.eventBus.emitLog(`Loaded legacy cookies from ${cookieInfo.source}`);
            return true;
        }
        catch (error) {
            this.eventBus.emitError(new Error(`Cookie error: ${error.message}`));
            return false;
        }
    }
    async scrapeTimeline(config) {
        if (!this.page) {
            return { success: false, tweets: [], error: 'Page not initialized' };
        }
        let { username, limit = 50, mode = 'timeline', searchQuery, runContext, saveMarkdown = true, saveScreenshots = false, exportCsv = false, exportJson = false } = config;
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
        const collectedTweets = [];
        const scrapedUrls = new Set();
        // Determine Target URL
        let targetUrl = 'https://x.com/home';
        if (mode === 'search' && searchQuery) {
            const encodedQuery = encodeURIComponent(searchQuery);
            targetUrl = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;
        }
        else if (username) {
            if (config.tab === 'likes') {
                targetUrl = `https://x.com/${username}/likes`;
            }
            else if (config.withReplies || config.tab === 'replies') {
                targetUrl = `https://x.com/${username}/with_replies`;
            }
            else {
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
            }
            catch (error) {
                if (this.rateLimitManager.isRateLimitError(error)) {
                    const rotated = await this.rateLimitManager.handleRateLimit(this.page, attempts, error);
                    if (!rotated)
                        throw error;
                }
                else {
                    throw error;
                }
            }
            attempts++;
        }
        // Scraping Loop
        let scrollAttempts = 0;
        const maxScrollAttempts = Math.max(50, Math.ceil(limit / 5));
        let noNewTweetsConsecutiveAttempts = 0;
        let profileInfo = null;
        if (config.collectProfileInfo) {
            try {
                profileInfo = await dataExtractor.extractProfileInfo(this.page);
            }
            catch (error) {
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
            }
            else {
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
            if (saveMarkdown)
                await markdownUtils.saveTweetsAsMarkdown(collectedTweets, runContext);
            if (exportCsv)
                await exportUtils.exportToCsv(collectedTweets, runContext);
            if (exportJson)
                await exportUtils.exportToJson(collectedTweets, runContext);
            if (saveScreenshots)
                await screenshotUtils.takeScreenshotsOfTweets(this.page, collectedTweets, { runContext });
        }
        return { success: true, tweets: collectedTweets, runContext, profile: profileInfo };
    }
    async scrapeThread(options) {
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
        let originalTweet = null;
        const allReplies = [];
        const scrapedReplyIds = new Set();
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
                if (this.stopSignal || (this.shouldStopFunction && this.shouldStopFunction()))
                    break;
                scrollAttempts++;
                // Smart Scroll (Mimicking Crawlee)
                await dataExtractor.scrollToBottomSmart(this.page, constants.WAIT_FOR_NEW_TWEETS_TIMEOUT);
                // Double check DOM update
                await dataExtractor.waitForNewTweets(this.page, tweetsOnPage.length, 2000);
                const newTweets = await dataExtractor.extractTweetsFromPage(this.page);
                for (const tweet of newTweets) {
                    if (allReplies.length >= maxReplies)
                        break;
                    if (tweet.id === originalTweet?.id)
                        continue;
                    if (!scrapedReplyIds.has(tweet.id)) {
                        allReplies.push(tweet);
                        scrapedReplyIds.add(tweet.id);
                    }
                }
            }
            const allTweets = originalTweet ? [originalTweet, ...allReplies] : allReplies;
            // Save
            if (allTweets.length > 0) {
                if (saveMarkdown)
                    await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
                if (exportCsv)
                    await exportUtils.exportToCsv(allTweets, runContext);
                if (exportJson)
                    await exportUtils.exportToJson(allTweets, runContext);
            }
            return {
                success: true,
                tweets: allTweets,
                originalTweet,
                replies: allReplies,
                runContext
            };
        }
        catch (error) {
            this.eventBus.emitError(new Error(`Thread scraping failed: ${error.message}`));
            return { success: false, tweets: [], error: error.message };
        }
    }
    async close() {
        if (this.browserManager) {
            await this.browserManager.close();
        }
    }
}
exports.ScraperEngine = ScraperEngine;
