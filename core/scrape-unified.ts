/**
 * Twitter/X Scraper Module (Refactored)
 * Delegates to ScraperEngine
 */

import {
    ScraperEngine,
    ScrapeTimelineConfig,
    ScrapeTimelineResult,
    ScrapeThreadOptions,
    ScrapeThreadResult,
    getShouldStopScraping,
    ScraperErrors
} from './index';  // core/index.ts
import * as markdownUtils from '../utils/markdown';
import * as exportUtils from '../utils/export';
import * as fileUtils from '../utils/fileutils';
import { Tweet, ProfileInfo } from '../types';

// Re-export types for consumers
export type { ScrapeTimelineResult, ScrapeThreadResult };

export interface ScrapeXFeedOptions extends Omit<ScrapeTimelineConfig, 'mode'> {
    scrapeLikes?: boolean;
    mergeResults?: boolean;
    deleteMerged?: boolean;
    clearCache?: boolean;
    headless?: boolean;
    sessionId?: string;
    /** 爬取模式: 'graphql' 使用 API, 'puppeteer' 使用 DOM */
    scrapeMode?: 'graphql' | 'puppeteer';
    /** GraphQL（默认）或 REST v1.1（tweet_mode=extended, max_id 翻页） */
    apiVariant?: 'graphql' | 'rest';
}

export interface ScrapeSearchOptions extends Omit<ScrapeTimelineConfig, 'mode' | 'searchQuery'> {
    query: string;
    mergeResults?: boolean;
    deleteMerged?: boolean;
    headless?: boolean;
    sessionId?: string;
    apiVariant?: 'graphql' | 'rest';
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
    scrapeMode?: 'graphql' | 'puppeteer' | 'mixed';
    resume?: boolean;
    resumeFromTweetId?: string;
    apiVariant?: 'graphql' | 'rest';
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
        // CLI mode: disable proxy by default (direct connection)
        engine.proxyManager.setEnabled(false);
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
        // CLI mode: disable proxy by default (direct connection)
        engine.proxyManager.setEnabled(false);
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
        // CLI mode: disable proxy by default (direct connection)
        engine.proxyManager.setEnabled(false);
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
export type TwitterUserIdentifier = string | null | { searchQuery: string };

function isSearchQueryIdentifier(value: TwitterUserIdentifier): value is { searchQuery: string } {
    return typeof value === 'object' && value !== null && typeof value.searchQuery === 'string';
}

export async function scrapeTwitterUsers(
    usernames: TwitterUserIdentifier[],
    options: ScrapeTwitterUsersOptions = {}
): Promise<ScrapeTwitterUserResult[]> {
    if (!Array.isArray(usernames) || usernames.length === 0) {
        return [];
    }

    // 批量爬取默认使用 GraphQL API（更快）
    // 如果需要抓取 likes，则必须使用浏览器（DOM 模式），因为 likes API 可能不可用
    let scrapeMode: 'graphql' | 'puppeteer' | 'mixed' = options.scrapeMode || (options.scrapeLikes ? 'puppeteer' : 'graphql');

    if (options.scrapeLikes && scrapeMode === 'graphql') {
        // Likes 标签依赖浏览器，自动升级为 mixed 模式以兼容 API + DOM
        scrapeMode = 'mixed';
    }

    const apiOnly = scrapeMode === 'graphql' && !options.scrapeLikes;
    
    const engine = new ScraperEngine(getShouldStopScraping, { 
        headless: options.headless, 
        sessionId: options.sessionId,
        apiOnly  // scrapeMode 决定是否需要浏览器
    });
    const results: ScrapeTwitterUserResult[] = [];

    try {
        await engine.init();
        // CLI mode: disable proxy by default (direct connection)
        engine.proxyManager.setEnabled(false);
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw ScraperErrors.cookieLoadFailed('Failed to load cookies');
        }

        for (const rawIdentifier of usernames) {
            const isSearchMode = isSearchQueryIdentifier(rawIdentifier);
            const searchQuery = isSearchMode ? rawIdentifier.searchQuery : null;
            const timelineUsername = !isSearchMode && typeof rawIdentifier === 'string' ? rawIdentifier : null;
            const resultIdentifier = isSearchMode ? 'search' : (rawIdentifier ?? 'home');
            const timelineUsernameValue: string | undefined = timelineUsername ?? undefined;

            let runContext: fileUtils.RunContext;
            try {
                runContext = await fileUtils.createRunContext({
                    platform: 'x',
                    identifier: searchQuery ? `search_${searchQuery.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}` : resultIdentifier,
                    baseOutputDir: options.outputDir,
                    timezone: options.timezone
                });
            } catch (error: any) {
                console.error(`Failed to create run context for ${resultIdentifier}: ${error.message}`);
                continue;
            }

            try {
                const targetCount = options.tweetCount ?? 20;
                
                // 🚀 Auto-switch to date-chunked search when target > 800 and using Puppeteer
                // OR when using search query (search mode always uses deep search)
                const shouldUseDeepSearch = (targetCount > 800 && (scrapeMode === 'puppeteer' || scrapeMode === 'mixed')) || isSearchMode;
                
                let timelineResult: ScrapeTimelineResult;
                
                if (shouldUseDeepSearch && (timelineUsername || isSearchMode)) {
                    const today = new Date().toISOString().split('T')[0];
                    // For search queries, use last 6 months; for user timelines, use full history
                    const startDate = isSearchMode ? 
                        new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : 
                        '2006-01-01';
                    
                    // Use date-chunked search (newest → oldest time periods)
                    timelineResult = await engine.scrapeTimeline({
                        username: isSearchMode ? undefined : timelineUsernameValue,
                        searchQuery: isSearchMode
                            ? searchQuery ?? undefined
                            : (timelineUsername ? `from:${timelineUsername}` : undefined),
                        dateRange: { start: startDate, end: today },
                        limit: targetCount,
                        withReplies: options.withReplies,
                        saveMarkdown: false,
                        exportCsv: false,
                        exportJson: false,
                        runContext,
                        scrapeMode: 'puppeteer',
                        mode: 'search',
                        apiVariant: options.apiVariant,
                        collectProfileInfo: !isSearchMode, // No profile info for search queries
                        resume: options.resume
                    });
                } else {
                    // Normal timeline scraping (target <= 800 or GraphQL API)
                    timelineResult = await engine.scrapeTimeline({
                        username: timelineUsernameValue,
                        limit: targetCount,
                        withReplies: options.withReplies,
                        saveMarkdown: false,
                        exportCsv: false,
                        exportJson: false,
                        runContext,
                        scrapeMode,
                        apiVariant: options.apiVariant,
                        collectProfileInfo: true,
                        resume: options.resume
                    });
                }

                if (!timelineResult.success) {
                    console.error(`Scraping timeline failed for ${resultIdentifier}: ${timelineResult.error || 'unknown error'}`);
                    results.push({
                        username: resultIdentifier,
                        tweetCount: 0,
                        tweets: [],
                        profile: timelineResult.profile,
                        runContext: timelineResult.runContext
                    });
                    continue;
                }

                let combinedTweets: Tweet[] = [...timelineResult.tweets];

                // Optionally scrape likes tab and merge into the same result set
                if (options.scrapeLikes && timelineUsername) {
                    try {
                        const likesResult = await engine.scrapeTimeline({
                            username: timelineUsername,
                            tab: 'likes',
                            limit: options.tweetCount ?? 20,
                            saveMarkdown: false,
                            exportCsv: false,
                            exportJson: false,
                            runContext,
                            scrapeMode,
                            apiVariant: options.apiVariant,
                            resume: options.resume
                        });

                        const likedTweets = (likesResult.tweets || []).map((t: Tweet) => ({ ...t, isLiked: true }));
                        combinedTweets = combinedTweets.concat(likedTweets);
                    } catch (likeError: any) {
                        console.warn(`Failed to scrape likes for ${resultIdentifier}: ${likeError.message}`);
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
                    username: resultIdentifier,
                    tweetCount: combinedTweets.length,
                    tweets: combinedTweets,
                    profile: timelineResult.profile,
                    runContext
                });
            } catch (userError: any) {
                console.error(`Failed to scrape ${resultIdentifier}: ${userError.message}`);
                results.push({
                    username: resultIdentifier,
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
