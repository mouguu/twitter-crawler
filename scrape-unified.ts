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
import { Tweet } from './utils/markdown';
import { ProfileInfo } from './core/data-extractor';

export interface ScrapeXFeedOptions extends Omit<ScrapeTimelineConfig, 'mode'> {
    scrapeLikes?: boolean;
    mergeResults?: boolean;
    deleteMerged?: boolean;
    clearCache?: boolean;
    headless?: boolean;
    sessionId?: string;
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
    const engine = new ScraperEngine(getShouldStopScraping, { headless: options.headless, sessionId: options.sessionId });

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
    } catch (error: any) {
        console.error('Scrape failed:', error);
        return { success: false, tweets: [], error: error.message };
    } finally {
        await engine.close();
    }
}

export async function scrapeSearch(options: ScrapeSearchOptions): Promise<ScrapeTimelineResult> {
    const engine = new ScraperEngine(getShouldStopScraping, { headless: options.headless, sessionId: options.sessionId });
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
    } catch (error: any) {
        console.error('Search scrape failed:', error);
        return { success: false, tweets: [], error: error.message };
    } finally {
        await engine.close();
    }
}

export async function scrapeThread(options: ScrapeThreadOptions): Promise<ScrapeThreadResult> {
    const engine = new ScraperEngine(getShouldStopScraping, { headless: options.headless, sessionId: options.sessionId });
    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw new Error('Failed to load cookies');
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

    const engine = new ScraperEngine(getShouldStopScraping, { headless: options.headless, sessionId: options.sessionId });
    const results: ScrapeTwitterUserResult[] = [];

    try {
        await engine.init();
        const cookiesLoaded = await engine.loadCookies();
        if (!cookiesLoaded) {
            throw new Error('Failed to load cookies');
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
