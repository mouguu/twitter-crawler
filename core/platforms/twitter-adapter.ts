import { createEnhancedLogger } from '../../utils/logger';
import { ScraperErrors } from '../errors';
import type {
  ScrapeThreadResult,
  ScrapeTimelineConfig,
  ScrapeTimelineResult,
} from '../scraper-engine';
import { ScraperEngine } from '../scraper-engine';
import { AdapterJobContext, PlatformAdapter } from './types';

const logger = createEnhancedLogger('TwitterAdapter');

interface TwitterJobConfig {
  mode?: 'puppeteer' | 'graphql' | 'mixed';
  limit?: number;
  username?: string;
  tweetUrl?: string;
  searchQuery?: string;
  tab?: 'tweets' | 'replies' | 'likes' | 'media';
  likes?: boolean;
  enableProxy?: boolean;
  enableRotation?: boolean;
  sessionLabel?: string;
  antiDetectionLevel?: 'low' | 'medium' | 'high' | 'paranoid';
  dateRange?: { start?: string; end?: string };
}

export const twitterAdapter: PlatformAdapter = {
  name: 'twitter',

  async process(data, ctx: AdapterJobContext) {
    const jobConfig = data.config as TwitterJobConfig;
    const startTime = Date.now();

    const engine = new ScraperEngine(async () => await ctx.getShouldStop(), {
      apiOnly: jobConfig.mode === 'graphql',
      logger: {
        info: (message: string) => ctx.emitLog({ level: 'info', message, timestamp: Date.now() }),
        warn: (message: string) => ctx.emitLog({ level: 'warn', message, timestamp: Date.now() }),
        error: (message: string) => ctx.emitLog({ level: 'error', message, timestamp: Date.now() }),
        debug: (message: string) => ctx.emitLog({ level: 'debug', message, timestamp: Date.now() }),
      },
      onProgress: (progress) => {
        ctx.emitProgress({
          current: progress.current ?? 0,
          target: progress.target ?? jobConfig.limit ?? 0,
          action: progress.action || 'scraping',
        });
      },
      jobId: data.jobId,
      antiDetectionLevel: jobConfig.antiDetectionLevel,
    });

    let result: ScrapeTimelineResult | ScrapeThreadResult | undefined;

    try {
      await engine.init();
      engine.proxyManager.setEnabled(jobConfig.enableProxy || false);

      // Set preferred session if specified in config (e.g. for scraping specific timeline)
      if (jobConfig.sessionLabel) {
        engine.preferredSessionId = jobConfig.sessionLabel;
        await ctx.log(`Requesting session: ${jobConfig.sessionLabel}`, 'info');
      }

      const cookiesLoaded = await engine.loadCookies(jobConfig.enableRotation !== false);
      if (!cookiesLoaded) {
        throw ScraperErrors.cookieLoadFailed('Failed to load cookies');
      }

      if (jobConfig.username) {
        await ctx.log(`Scraping @${jobConfig.username}'s ${jobConfig.tab || 'posts'}...`);

        const timelineConfig: ScrapeTimelineConfig = {
          username: jobConfig.username,
          limit: jobConfig.limit || 50,
          saveMarkdown: true,
          scrapeMode: (jobConfig.mode || 'puppeteer') as 'puppeteer' | 'graphql',
          // jobId is not part of ScrapeTimelineConfig but was passed before.
          // Assuming engine handles it via constructor options.
        };

        // Handle dateRange type mismatch
        if (jobConfig.dateRange?.start && jobConfig.dateRange?.end) {
          timelineConfig.dateRange = {
            start: jobConfig.dateRange.start,
            end: jobConfig.dateRange.end,
          };
        }

        if (jobConfig.tab === 'likes' || jobConfig.tab === 'replies') {
          timelineConfig.tab = jobConfig.tab;
        }

        result = await engine.scrapeTimeline(timelineConfig);

        if (result?.tweets) {
          await ctx.emitProgress({
            current: result.tweets.length,
            target: jobConfig.limit || 50,
            action: `Scraped ${result.tweets.length} tweets`,
          });
        }

        if (jobConfig.likes && jobConfig.mode !== 'graphql') {
          await ctx.log('Fetching liked tweets...');
          const likesResult = await engine.scrapeTimeline({
            username: jobConfig.username,
            tab: 'likes',
            limit: jobConfig.limit || 50,
            saveMarkdown: false,
            scrapeMode: 'puppeteer',
          });

          if (likesResult.success && likesResult.tweets && 'tweets' in result) {
            const likedTweets = likesResult.tweets.map((t) => ({
              ...t,
              isLiked: true,
            }));
            // Type assertion needed as result can be ThreadResult which doesn't have mutable tweets in same way
            // but here we know it's TimelineResult
            (result as ScrapeTimelineResult).tweets = [...(result.tweets || []), ...likedTweets];
            await ctx.log(`Added ${likedTweets.length} liked tweets`);
          }
        }
      } else if (jobConfig.tweetUrl) {
        await ctx.log(`Scraping thread: ${jobConfig.tweetUrl}`);

        result = await engine.scrapeThread({
          tweetUrl: jobConfig.tweetUrl,
          maxReplies: jobConfig.limit || 50,
          saveMarkdown: true,
          scrapeMode: (jobConfig.mode || 'puppeteer') as 'puppeteer' | 'graphql',
        });

        if (result?.tweets) {
          await ctx.emitProgress({
            current: result.tweets.length,
            target: jobConfig.limit || 50,
            action: `Scraped ${result.tweets.length} replies`,
          });
        }
      } else if (jobConfig.searchQuery) {
        await ctx.log(`Searching: "${jobConfig.searchQuery}"`);

        result = await engine.scrapeTimeline({
          mode: 'search',
          searchQuery: jobConfig.searchQuery,
          limit: jobConfig.limit || 50,
          saveMarkdown: true,
          scrapeMode: (jobConfig.mode === 'mixed' ? 'puppeteer' : jobConfig.mode || 'puppeteer') as
            | 'puppeteer'
            | 'graphql',
          dateRange: 
            jobConfig.dateRange?.start && jobConfig.dateRange?.end
              ? { start: jobConfig.dateRange.start, end: jobConfig.dateRange.end }
              : undefined,
        });

        if (result?.tweets) {
          await ctx.emitProgress({
            current: result.tweets.length,
            target: jobConfig.limit || 50,
            action: `Found ${result.tweets.length} tweets`,
          });
        }
      } else {
        throw new Error(
          'Invalid Twitter job configuration: missing username, tweetUrl, or searchQuery',
        );
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      await ctx.log(`Error: ${err.message}`, 'error');
      logger.error('Twitter scraping failed', err);
      throw err;
    } finally {
      await engine.close();
    }

    if (result?.success && result.runContext?.markdownIndexPath) {
      const duration = Date.now() - startTime;
      await ctx.log(`Scraping completed successfully! (${(duration / 1000).toFixed(1)}s)`, 'info');

      return {
        success: true,
        downloadUrl: `/api/download?path=${encodeURIComponent(result.runContext.markdownIndexPath)}`,
        stats: {
          count: result.tweets?.length || 0,
          duration,
        },
        performance: result.performance,
      };
    }

    throw new Error(result?.error || 'Scraping failed with unknown error');
  },

  classifyError(err: unknown) {
    // biome-ignore lint/suspicious/noExplicitAny: error property access
    const error = err as any;
    if (error?.response?.status === 401) return 'auth';
    if (error?.response?.status === 404) return 'not_found';
    if (error?.response?.status === 429) return 'rate_limit';
    return 'unknown';
  },
};
