import { createEnhancedLogger } from '../../utils/logger';
import { ScraperErrors } from '../errors';

import { ScraperEngine } from '../scraper-engine';
import { PlatformAdapter } from './types';

const logger = createEnhancedLogger('TwitterAdapter');

export const twitterAdapter: PlatformAdapter = {
  name: 'twitter',

  async process(data, ctx) {
    const { config: jobConfig } = data;
    const startTime = Date.now();

    const engine = new ScraperEngine(async () => await ctx.getShouldStop(), {
      apiOnly: jobConfig.mode === 'graphql',
      logger: {
        info: (message: string) => ctx.emitLog({ level: 'info', message, timestamp: Date.now() }),
        warn: (message: string) => ctx.emitLog({ level: 'warn', message, timestamp: Date.now() }),
        error: (message: string) => ctx.emitLog({ level: 'error', message, timestamp: Date.now() }),
        debug: (message: string) => ctx.emitLog({ level: 'debug', message, timestamp: Date.now() }),
      },
      onProgress: (progress: any) => {
        ctx.emitProgress({
          current: progress.current ?? 0,
          target: progress.target ?? jobConfig.limit ?? 0,
          action: progress.action || 'scraping',
        });
      },
      jobId: data.jobId,
      antiDetectionLevel: jobConfig.antiDetectionLevel,
    });

    // biome-ignore lint/suspicious/noExplicitAny: dynamic result type
    let result: any;

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

        // biome-ignore lint/suspicious/noExplicitAny: complex config type
        const timelineConfig: any = {
          username: jobConfig.username,
          limit: jobConfig.limit || 50,
          saveMarkdown: true,
          scrapeMode: (jobConfig.mode || 'puppeteer') as 'puppeteer' | 'graphql',
          dateRange: jobConfig.dateRange,
          jobId: data.jobId, // Pass to config as well
        };

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

          if (likesResult.success && likesResult.tweets) {
            // biome-ignore lint/suspicious/noExplicitAny: tweet structure
            const likedTweets = likesResult.tweets.map((t: any) => ({
              ...t,
              isLiked: true,
            }));
            result.tweets = [...(result.tweets || []), ...likedTweets];
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
          scrapeMode: (jobConfig.mode === 'mixed' ? 'puppeteer' : jobConfig.mode || 'puppeteer') as 'puppeteer' | 'graphql',
          dateRange: jobConfig.dateRange,
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
      // biome-ignore lint/suspicious/noExplicitAny: error handling
    } catch (error: any) {
      await ctx.log(`Error: ${error.message}`, 'error');
      logger.error('Twitter scraping failed', error);
      throw error;
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

  // biome-ignore lint/suspicious/noExplicitAny: error handling
  classifyError(err: any) {
    if (err?.response?.status === 401) return 'auth';
    if (err?.response?.status === 404) return 'not_found';
    if (err?.response?.status === 429) return 'rate_limit';
    return 'unknown';
  },
};
