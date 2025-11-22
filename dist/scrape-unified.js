"use strict";
/**
 * Twitter/X Scraper Module (Refactored)
 * Delegates to ScraperEngine
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeXFeed = scrapeXFeed;
exports.scrapeSearch = scrapeSearch;
exports.scrapeThread = scrapeThread;
exports.scrapeTwitterUsers = scrapeTwitterUsers;
const scraper_engine_1 = require("./core/scraper-engine");
const stop_signal_1 = require("./core/stop-signal");
const markdownUtils = __importStar(require("./utils/markdown"));
const exportUtils = __importStar(require("./utils/export"));
const fileUtils = __importStar(require("./utils/fileutils"));
async function scrapeXFeed(options = {}) {
    const engine = new scraper_engine_1.ScraperEngine(stop_signal_1.getShouldStopScraping, { headless: options.headless });
    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw new Error('Failed to load cookies');
        }
        // Direct scrape without cache/merge logic
        const result = await engine.scrapeTimeline({
            ...options,
            mode: 'timeline'
        });
        return result;
    }
    catch (error) {
        console.error('Scrape failed:', error);
        return { success: false, tweets: [], error: error.message };
    }
    finally {
        await engine.close();
    }
}
async function scrapeSearch(options) {
    const engine = new scraper_engine_1.ScraperEngine(stop_signal_1.getShouldStopScraping, { headless: options.headless });
    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw new Error('Failed to load cookies');
        }
        return await engine.scrapeTimeline({
            ...options,
            mode: 'search',
            searchQuery: options.query
        });
    }
    catch (error) {
        console.error('Search scrape failed:', error);
        return { success: false, tweets: [], error: error.message };
    }
    finally {
        await engine.close();
    }
}
async function scrapeThread(options) {
    const engine = new scraper_engine_1.ScraperEngine(stop_signal_1.getShouldStopScraping, { headless: options.headless });
    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw new Error('Failed to load cookies');
        }
        return await engine.scrapeThread(options);
    }
    catch (error) {
        console.error('Thread scrape failed:', error);
        return { success: false, tweets: [], error: error.message };
    }
    finally {
        await engine.close();
    }
}
/**
 * Legacy-compatible bulk scraper used by the CLI.
 * Supports timeline scraping (and optional likes) for multiple users in a single browser session.
 */
async function scrapeTwitterUsers(usernames, options = {}) {
    if (!Array.isArray(usernames) || usernames.length === 0) {
        return [];
    }
    const engine = new scraper_engine_1.ScraperEngine(stop_signal_1.getShouldStopScraping, { headless: options.headless });
    const results = [];
    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw new Error('Failed to load cookies');
        }
        for (const rawUsername of usernames) {
            const username = rawUsername || 'home';
            let runContext;
            try {
                runContext = await fileUtils.createRunContext({
                    platform: 'x',
                    identifier: username,
                    baseOutputDir: options.outputDir,
                    timezone: options.timezone
                });
            }
            catch (error) {
                console.error(`Failed to create run context for ${username}: ${error.message}`);
                continue;
            }
            try {
                const timelineResult = await engine.scrapeTimeline({
                    username: rawUsername || undefined,
                    limit: options.tweetCount ?? 20,
                    withReplies: options.withReplies,
                    saveMarkdown: false,
                    exportCsv: false,
                    exportJson: false,
                    runContext,
                    collectProfileInfo: true
                });
                if (!timelineResult.success) {
                    console.error(`Scraping timeline failed for ${username}: ${timelineResult.error || 'unknown error'}`);
                    results.push({
                        username,
                        tweetCount: 0,
                        tweets: [],
                        profile: timelineResult.profile,
                        runContext: timelineResult.runContext
                    });
                    continue;
                }
                let combinedTweets = [...timelineResult.tweets];
                // Optionally scrape likes tab and merge into the same result set
                if (options.scrapeLikes && rawUsername) {
                    try {
                        const likesResult = await engine.scrapeTimeline({
                            username: rawUsername,
                            tab: 'likes',
                            limit: options.tweetCount ?? 20,
                            saveMarkdown: false,
                            exportCsv: false,
                            exportJson: false,
                            runContext
                        });
                        const likedTweets = (likesResult.tweets || []).map(t => ({ ...t, isLiked: true }));
                        combinedTweets = combinedTweets.concat(likedTweets);
                    }
                    catch (likeError) {
                        console.warn(`Failed to scrape likes for ${username}: ${likeError.message}`);
                    }
                }
                if (combinedTweets.length > 0) {
                    await markdownUtils.saveTweetsAsMarkdown(combinedTweets, runContext);
                    const wantsJson = options.exportJson || options.exportFormat === 'json';
                    const wantsCsv = options.exportCsv || options.exportFormat === 'csv';
                    if (wantsJson) {
                        await exportUtils.exportToJson(combinedTweets, runContext);
                    }
                    if (wantsCsv) {
                        await exportUtils.exportToCsv(combinedTweets, runContext);
                    }
                }
                results.push({
                    username,
                    tweetCount: combinedTweets.length,
                    tweets: combinedTweets,
                    profile: timelineResult.profile,
                    runContext
                });
            }
            catch (userError) {
                console.error(`Failed to scrape ${username}: ${userError.message}`);
                results.push({
                    username,
                    tweetCount: 0,
                    tweets: [],
                    runContext
                });
            }
        }
        return results;
    }
    catch (error) {
        console.error('Bulk scrape failed:', error);
        return results;
    }
    finally {
        await engine.close();
    }
}
