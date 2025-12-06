/**
 * Reddit Adapter - Complete Rewrite
 *
 * Follows Twitter adapter pattern but with Reddit-specific logic
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getOutputPathManager } from '../../utils';
import { createEnhancedLogger } from '../../utils/logger';
import { ScraperEventBus } from '../scraper-engine.types';
import { exportRedditToMarkdown } from './reddit/markdown-export';
import { RedditScraper } from './reddit/scraper';
import { FlattenedComment, RedditPost, RedditScraperResult } from './reddit/types';
import { PlatformAdapter } from './types';

const logger = createEnhancedLogger('RedditAdapter');

export const redditAdapter: PlatformAdapter = {
  name: 'reddit',

  async process(data, ctx) {
    const { config: jobConfig } = data;
    const startTime = Date.now();

    await ctx.log(`Starting Reddit scrape: ${jobConfig.subreddit || jobConfig.postUrl}`);

    // Proxy setup (only if enabled)
    let proxyConfig;
    let proxyManager: any = null;
    if (jobConfig.enableProxy) {
      await ctx.log('🔧 Proxy enabled - Initializing proxy manager...', 'info');
      const { ProxyManager } = await import('../proxy-manager');
      proxyManager = new ProxyManager();
      await proxyManager.init();

      const stats = proxyManager.getStats();
      await ctx.log(`📊 Proxy manager initialized: ${stats.total} proxies available | Details: ${JSON.stringify({
        totalProxies: stats.total,
        healthyProxies: stats.healthy,
        unhealthyProxies: stats.unhealthy,
        activeProxies: stats.active,
        avgSuccessRate: stats.avgSuccessRate,
        totalRequests: stats.totalRequests,
      })}`, 'info');

      if (proxyManager.hasProxies()) {
        const proxy = proxyManager.getNextProxy();
        if (proxy) {
          proxyConfig = {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username || '',
            password: proxy.password || '',
            id: proxy.id, // Store proxy ID for tracking
          };
          await ctx.log(`✅ Proxy selected: ${proxy.host}:${proxy.port} | Details: ${JSON.stringify({
            proxyHost: proxy.host,
            proxyPort: proxy.port,
            hasAuth: !!(proxy.username && proxy.password),
            protocol: 'http',
            proxyId: proxy.id,
          })}`, 'info');
        } else {
          await ctx.log(`⚠️ Proxy enabled but unavailable, using direct connection | Details: ${JSON.stringify({
            reason: 'getNextProxy() returned null',
            totalProxies: stats.total,
          })}`, 'warn');
        }
      } else {
        await ctx.log(`⚠️ Proxy enabled but no proxies found, using direct connection | Details: ${JSON.stringify({
          reason: 'No proxies loaded from proxy directory',
          proxyDirectory: './proxy',
          suggestion: 'Check if proxy files exist in ./proxy directory',
        })}`, 'warn');
      }
    } else {
      await ctx.log(`🌐 Running in direct connection mode (proxy disabled) | Details: ${JSON.stringify({
        proxyEnabled: false,
        connectionMode: 'direct',
      })}`, 'info');
    }

    // Event bus wrapper
    const eventBus: ScraperEventBus = {
      emitProgress: (progress) => {
        ctx.emitProgress({
          current: progress.current,
          target: progress.target,
          action: progress.action,
        });
      },
      emitLog: (message, level) => {
        ctx.log(message, level || 'info');
      },
      emitError: (error) => {
        ctx.log(error.message, 'error');
      },
      emitPerformance: () => {},
    };

    // Cancellation checker
    const shouldStop = async () => ctx.getShouldStop();

    await ctx.log(`Initializing Reddit scraper... (proxy: ${proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : 'none'}, type: ${jobConfig.postUrl ? 'post' : 'subreddit'})`, 'info');

    const scraper = new RedditScraper(proxyConfig, eventBus, shouldStop, proxyManager);
    const isPostUrl = !!jobConfig.postUrl;

    await ctx.log(`Reddit scraper initialized`, 'info');

    try {
      type ScrapedItem = RedditPost & { comments: FlattenedComment[] };
      let posts: ScrapedItem[] = [];
      let markdownPath: string | undefined;

      if (isPostUrl && jobConfig.postUrl) {
        // Single post
        await ctx.log(`Starting single post scrape: ${jobConfig.postUrl}`, 'info');
        const postScrapeStartTime = Date.now();
        const scrapeResult = await scraper.scrapePost(jobConfig.postUrl);
        const postScrapeDuration = Date.now() - postScrapeStartTime;

        await ctx.log(`Single post scrape completed in ${(postScrapeDuration / 1000).toFixed(1)}s (status: ${scrapeResult.status})`, 'info');

        if (scrapeResult.status === 'success' && scrapeResult.post && scrapeResult.comments) {
          posts = [{ ...scrapeResult.post, comments: scrapeResult.comments }];
          await ctx.log(`Scraped post with ${scrapeResult.comments.length} comments`, 'info');
        } else {
          throw new Error(scrapeResult.message || 'Failed to scrape post');
        }
      } else if (jobConfig.subreddit) {
        // Subreddit
        const subreddit = jobConfig.subreddit;
        const limit = jobConfig.limit || 50;
        const sortType = (jobConfig as any).sortType || 'hot';

        await ctx.log(`Starting subreddit scrape: r/${subreddit} (limit: ${limit}, sort: ${sortType}, estimated: ~${(limit * 3 / 60).toFixed(1)} min)`, 'info');

        if (await ctx.getShouldStop()) {
          await ctx.log('Job cancellation detected before starting scrape', 'warn');
          throw new Error('Job cancelled');
        }

        const subredditScrapeStartTime = Date.now();
        const scrapeResult = await scraper.scrapeSubreddit(subreddit, limit, sortType);
        const subredditScrapeDuration = Date.now() - subredditScrapeStartTime;

        await ctx.log(`Subreddit scrape completed in ${(subredditScrapeDuration / 1000).toFixed(1)}s (status: ${scrapeResult.status}, posts: ${scrapeResult.posts?.length || 0}/${scrapeResult.totalPosts || 0})`, 'info');

        if (scrapeResult.status === 'success' && scrapeResult.posts) {
          posts = scrapeResult.posts.map((item) => ({
            ...item.post,
            comments: item.comments,
          }));
          await ctx.log(`Successfully scraped ${posts.length} posts`, 'info');
        } else {
          throw new Error(scrapeResult.message || 'Failed to scrape subreddit');
        }
      } else {
        throw new Error('Either subreddit or postUrl must be provided');
      }

      // Save to database (even if cancelled, save what we have)
      if (posts.length > 0) {
        await ctx.log(`Saving ${posts.length} posts to database...`);

        const { prisma } = await import('../db/prisma');

        for (const item of posts) {
          try {
            if (await ctx.getShouldStop()) {
              throw new Error('Job cancelled');
            }

            // Save post
            await prisma.redditPost.upsert({
              where: { id: item.id },
              update: {
                title: item.title,
                selftext: item.selftext,
                author: item.author,
                subreddit: item.subreddit,
                score: item.score,
                upvoteRatio: item.upvote_ratio,
                numComments: item.num_comments,
                createdUtc: item.created_utc,
                url: item.url,
                permalink: item.permalink,
                isSelf: item.is_self,
              },
              create: {
                id: item.id,
                name: item.name || `t3_${item.id}`,
                title: item.title,
                selftext: item.selftext,
                author: item.author,
                subreddit: item.subreddit,
                subredditNamePrefixed: item.subreddit_name_prefixed || `r/${item.subreddit}`,
                score: item.score,
                upvoteRatio: item.upvote_ratio,
                numComments: item.num_comments,
                createdUtc: item.created_utc,
                url: item.url,
                permalink: item.permalink,
                isSelf: item.is_self,
              },
            });

            // Save comments
            for (const comment of item.comments) {
              await prisma.redditComment.upsert({
                where: { id: comment.id },
                update: {
                  author: comment.author,
                  body: comment.body,
                  score: comment.score,
                  createdUtc: comment.created_utc,
                  depth: comment.depth,
                  parentId: comment.parent_id,
                  permalink: comment.permalink,
                  postId: item.id,
                },
                create: {
                  id: comment.id,
                  name: `t1_${comment.id}`,
                  author: comment.author,
                  body: comment.body,
                  score: comment.score,
                  createdUtc: comment.created_utc,
                  depth: comment.depth,
                  parentId: comment.parent_id,
                  permalink: comment.permalink,
                  postId: item.id,
                },
              });
            }
          } catch (e: any) {
            await ctx.log(`Failed to save post ${item.id}: ${e.message}`, 'error');
          }
        }

        await ctx.log(`Saved ${posts.length} posts to database`);
      } else {
        await ctx.log('No posts to save', 'warn');
      }

      // Generate markdown export (always generate if we have posts)
      if (posts.length > 0) {
        await ctx.log('Generating markdown export...');

        const outputManager = getOutputPathManager();
        const baseDir = outputManager.getBaseDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const subredditName = isPostUrl
          ? 'post'
          : (jobConfig.subreddit || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');

        const runDir = path.join(baseDir, 'reddit', subredditName, `run-${timestamp}`);
        fs.mkdirSync(runDir, { recursive: true });

        // Convert to markdown format
        const postsForMarkdown = posts.map((p) => ({
          post: p as RedditPost,
          comments: p.comments,
        }));

        const filename = `reddit_${subredditName}_${timestamp}.md`;
        markdownPath = exportRedditToMarkdown(postsForMarkdown, runDir, filename);

        await ctx.log(`Markdown export saved: ${markdownPath}`, 'info');
        await ctx.log(`Download URL: /api/download?path=${encodeURIComponent(markdownPath)}`, 'info');
      } else {
        await ctx.log('No posts to export to markdown', 'warn');
      }

      const duration = Date.now() - startTime;

      // Check if cancelled
      const wasCancelled = await ctx.getShouldStop();
      if (wasCancelled && posts.length === 0) {
        await ctx.log('Job cancelled with no posts scraped', 'warn');
        return {
          success: false,
          error: 'Job cancelled by user',
        };
      }

      await ctx.log(`Job completed in ${(duration / 1000).toFixed(1)}s (${posts.length} posts)`, 'info');

      // Return result with download URL (same format as Twitter adapter)
      const result = {
        success: true,
        downloadUrl: markdownPath
          ? `/api/download?path=${encodeURIComponent(markdownPath)}`
          : undefined,
        stats: {
          count: posts.length,
          duration,
        },
      };

      if (!result.downloadUrl) {
        await ctx.log('WARNING: No download URL generated!', 'error');
        await ctx.log(`Posts: ${posts.length}, MarkdownPath: ${markdownPath || 'undefined'}`, 'error');
      }

      return result;
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      const isCancelled = errorMessage.toLowerCase().includes('cancel') ||
                        errorMessage.toLowerCase().includes('abort');

      await ctx.log(`Error: ${errorMessage}`, 'error');
      logger.error('Reddit adapter error', error);

      if (isCancelled) {
        return {
          success: false,
          error: 'Job cancelled by user',
        };
      }

      throw error;
    }
  },

  classifyError(err: unknown) {
    const anyErr = err as any;
    if (anyErr?.response?.status === 401) return 'auth';
    if (anyErr?.response?.status === 404) return 'not_found';
    if (anyErr?.response?.status === 429) return 'rate_limit';
    return 'unknown';
  },
};
