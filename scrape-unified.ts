/**
 * Twitter/X Scraper Module (Refactored)
 * Delegates to ScraperEngine
 */

import {
    ScraperEngine,
    ScrapeTimelineConfig,
    ScrapeTimelineResult,
    ScrapeThreadOptions,
    ScrapeThreadResult
} from './core/scraper-engine';

// Re-export types for consumers
export type { ScrapeTimelineResult, ScrapeThreadResult };
import { getShouldStopScraping } from './core/stop-signal';
import * as markdownUtils from './utils/markdown';
import * as exportUtils from './utils/export';
import * as fileUtils from './utils/fileutils';
import { Tweet, ProfileInfo } from './types/tweet';
import { ScraperErrors } from './core/errors';

export interface ScrapeXFeedOptions extends Omit<ScrapeTimelineConfig, 'mode'> {
    scrapeLikes?: boolean;
    mergeResults?: boolean;
    deleteMerged?: boolean;
    clearCache?: boolean;
    headless?: boolean;
    sessionId?: string;
    /** 爬取模式: 'graphql' 使用 API, 'puppeteer' 使用 DOM */
    scrapeMode?: 'graphql' | 'puppeteer';
}

export interface ScrapeSearchOptions extends Omit<ScrapeTimelineConfig, 'mode' | 'searchQuery'> {
    query: string;
    mergeResults?: boolean;
    deleteMerged?: boolean;
    headless?: boolean;
    sessionId?: string;
}

export interface ScrapeTwitterUsersOptions {
    outputDir?: string;
    tweetCount?: number;
    separateFiles?: boolean;
    headless?: boolean;
    mergeResults?: boolean;
    mergeFilename?: string;
    exportFormat?: 'md' | 'json' | 'csv';
    withReplies?: boolean;
    scrapeLikes?: boolean;
    exportCsv?: boolean;
    exportJson?: boolean;
    timezone?: string;
    sessionId?: string;
}

export interface ScrapeTwitterUserResult {
    username: string;
    tweetCount: number;
    tweets: Tweet[];
    runContext?: fileUtils.RunContext;
    profile?: ProfileInfo | null;
}

export async function scrapeXFeed(options: ScrapeXFeedOptions = {}): Promise<ScrapeTimelineResult> {
    // 根据 scrapeMode 决定是否启动浏览器
    // apiOnly = true 时只初始化 API 客户端，不启动浏览器（适用于 graphql 模式）
    // apiOnly = false 时需要启动浏览器（适用于 puppeteer 模式）
    const scrapeMode = options.scrapeMode || 'graphql';
    const apiOnly = scrapeMode === 'graphql';
    
    const engine = new ScraperEngine(getShouldStopScraping, { 
        headless: options.headless, 
        sessionId: options.sessionId,
        apiOnly  // 从 scrapeMode 推导：graphql -> true, puppeteer -> false
    });

    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw ScraperErrors.cookieLoadFailed('Failed to load cookies');
        }

        // Direct scrape without cache/merge logic
        const result = await engine.scrapeTimeline({
            ...options,
            mode: 'timeline'
        });

        return result;
    } catch (error: any) {
        console.error('Scrape failed:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, tweets: [], error: errorMessage };
    } finally {
        await engine.close();
    }
}

export async function scrapeSearch(options: ScrapeSearchOptions): Promise<ScrapeTimelineResult> {
    // 搜索模式默认使用 GraphQL API（更快，无需启动浏览器）
    const scrapeMode = 'graphql';
    const apiOnly = true;  // 搜索模式固定使用 API 模式
    
    const engine = new ScraperEngine(getShouldStopScraping, { 
        headless: options.headless, 
        sessionId: options.sessionId,
        apiOnly  // API 模式不需要浏览器
    });
    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw ScraperErrors.cookieLoadFailed('Failed to load cookies');
        }
        return await engine.scrapeTimeline({
            ...options,
            mode: 'search',
            searchQuery: options.query,
            scrapeMode
        });
    } catch (error: any) {
        console.error('Search scrape failed:', error);
        return { success: false, tweets: [], error: error.message };
    } finally {
        await engine.close();
    }
}

export async function scrapeThread(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
    // 根据 scrapeMode 决定是否启动浏览器
    const scrapeMode = options.scrapeMode || 'graphql';
    const apiOnly = scrapeMode === 'graphql';  // graphql 模式不需要浏览器
    
    const engine = new ScraperEngine(getShouldStopScraping, { 
        headless: options.headless, 
        sessionId: options.sessionId,
        apiOnly  // 从 scrapeMode 推导
    });
    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw ScraperErrors.cookieLoadFailed('Failed to load cookies');
        }
        return await engine.scrapeThread(options);
    } catch (error: any) {
        console.error('Thread scrape failed:', error);
        return { success: false, tweets: [], error: error.message };
    } finally {
        await engine.close();
    }
}

/**
 * Legacy-compatible bulk scraper used by the CLI.
 * Supports timeline scraping (and optional likes) for multiple users in a single browser session.
 */
export async function scrapeTwitterUsers(
    usernames: Array<string | null>,
    options: ScrapeTwitterUsersOptions = {}
): Promise<ScrapeTwitterUserResult[]> {
    if (!Array.isArray(usernames) || usernames.length === 0) {
        return [];
    }

    // 批量爬取默认使用 GraphQL API（更快）
    // 如果需要抓取 likes，则必须使用浏览器（DOM 模式），因为 likes API 可能不可用
    const apiOnly = !options.scrapeLikes;  // 抓取 likes 时需要浏览器
    
    const engine = new ScraperEngine(getShouldStopScraping, { 
        headless: options.headless, 
        sessionId: options.sessionId,
        apiOnly  // scrapeLikes = true 时需要浏览器
    });
    const results: ScrapeTwitterUserResult[] = [];

    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw ScraperErrors.cookieLoadFailed('Failed to load cookies');
        }

        for (const rawUsername of usernames) {
            const username = rawUsername || 'home';

            let runContext: fileUtils.RunContext;
            try {
                runContext = await fileUtils.createRunContext({
                    platform: 'x',
                    identifier: username,
                    baseOutputDir: options.outputDir,
                    timezone: options.timezone
                });
            } catch (error: any) {
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

                let combinedTweets: Tweet[] = [...timelineResult.tweets];

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
                    } catch (likeError: any) {
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
            } catch (userError: any) {
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
    } catch (error: any) {
        console.error('Bulk scrape failed:', error);
        return results;
    } finally {
        await engine.close();
    }
}
