import * as fs from 'node:fs';
import * as path from 'node:path';
import { getOutputPathManager } from '../../utils';
import { createEnhancedLogger } from '../../utils/logger';
import { exportRedditToMarkdown } from './reddit/markdown-export';
import { RedditScraper } from './reddit/scraper';
import { PlatformAdapter } from './types';

const logger = createEnhancedLogger('RedditAdapter');

export const redditAdapter: PlatformAdapter = {
  name: 'reddit',

  async process(data, ctx) {
    const { config: jobConfig } = data;
    const startTime = Date.now();

    await ctx.log(`Starting Reddit scrape: ${jobConfig.subreddit || jobConfig.postUrl}`);

    // Initialize ProxyManager to get a proxy
    const { ProxyManager } = await import('../proxy-manager');
    const proxyManager = new ProxyManager();
    await proxyManager.init(); // Load from files
    
    let proxyConfig;
    if (proxyManager.hasProxies()) {
        const proxy = proxyManager.getNextProxy();
        if (proxy) {
             proxyConfig = {
                host: proxy.host,
                port: proxy.port,
                username: proxy.username || '',
                password: proxy.password || '',
            };
            await ctx.log(`Using proxy: ${proxy.host}:${proxy.port}`, 'info');
        }
    } else {
        await ctx.log('No proxies found! Running in direct connection mode (High Risk of Ban)', 'warn');
    }

    const scraper = new RedditScraper(proxyConfig);
    const isPostUrl = jobConfig.postUrl !== undefined;

    try {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic post structure
      let result: any;
      // biome-ignore lint/suspicious/noExplicitAny: dynamic post structure
      let posts: any[] = [];
      let outputPath: string | undefined;

      if (isPostUrl && jobConfig.postUrl) {
        // Single post scraping
        await ctx.log(`Scraping post: ${jobConfig.postUrl}`);
        result = await scraper.scrapePost(jobConfig.postUrl);

        if (result.status === 'success' && result.post && result.comments) {
          posts = [
            {
              ...result.post,
              comments: result.comments,
            },
          ];

          // Save to files
          const outputPathManager = getOutputPathManager();
          const postId = result.post.id;
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const runDir = path.join(
            outputPathManager.getBaseDir(),
            'reddit',
            `post_${postId}`,
            `run-${timestamp}`,
          );

          fs.mkdirSync(runDir, { recursive: true });

          // Save JSON
          const jsonPath = path.join(runDir, 'post.json');
          fs.writeFileSync(jsonPath, JSON.stringify(posts[0], null, 2));

          // Export Markdown with post title
          const mdPath = exportRedditToMarkdown(
            [{ post: result.post, comments: result.comments }],
            runDir,
          );
          outputPath = mdPath; // Use markdown as primary output

          await ctx.log(`Saved post with ${result.comments.length} comments`, 'info');
        } else {
          throw new Error(result.message || 'Failed to scrape post');
        }
      } else {
        // Subreddit scraping
        const subreddit = jobConfig.subreddit || 'javascript';
        const limit = jobConfig.limit || 50;

        await ctx.log(`Scraping r/${subreddit} (limit: ${limit})`);

        // Fetch post URLs
        const postUrls = await scraper.fetchSubredditPosts(subreddit, limit, 'hot');

        if (postUrls.length === 0) {
          throw new Error('No posts found');
        }

        await ctx.log(`Found ${postUrls.length} posts, fetching details...`);

        // Fetch post details with progress updates
        const concurrency = 3;
        for (let i = 0; i < postUrls.length; i += concurrency) {
          const batch = postUrls.slice(i, i + concurrency);
          const batchResults = await Promise.allSettled(
            batch.map(({ url }) => scraper.fetchPost(url)),
          );

          for (const batchResult of batchResults) {
            if (batchResult.status === 'fulfilled') {
              posts.push({
                ...batchResult.value.post,
                comments: batchResult.value.comments,
              });
            } else {
              logger.warn('Failed to fetch post', batchResult.reason);
            }
          }

          const current = Math.min(i + concurrency, postUrls.length);
          ctx.emitProgress({
            current,
            target: postUrls.length,
            action: `Scraped ${posts.length}/${postUrls.length} posts`,
          });

          await ctx.log(`Progress: ${current}/${postUrls.length} posts processed`);

          if (await ctx.getShouldStop()) {
            await ctx.log('Job cancellation detected, stopping...');
            throw new Error('Job cancelled by user');
          }
        }

        // Save to files
        const outputPathManager = getOutputPathManager();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const runDir = path.join(
          outputPathManager.getBaseDir(),
          'reddit',
          subreddit,
          `run-${timestamp}`,
        );

        fs.mkdirSync(runDir, { recursive: true });

        // Save JSON
        const jsonPath = path.join(runDir, 'posts.json');
        fs.writeFileSync(jsonPath, JSON.stringify(posts, null, 2));

        // Export Markdown (creates index + individual posts)
        const postsWithComments = posts.map((p) => ({
          post: { ...p, comments: undefined },
          comments: p.comments || [],
        }));

        const mdPath = exportRedditToMarkdown(
          postsWithComments,
          runDir,
          `r_${subreddit}_${posts.length}posts.md`,
        );
        outputPath = mdPath; // Use markdown index as primary output

        await ctx.log(`Saved ${posts.length} posts (JSON + Markdown)`, 'info');
      }

      const duration = Date.now() - startTime;
      const count = posts.length;

      await ctx.log(
        `Reddit scraping completed! ${count} items scraped (${(duration / 1000).toFixed(1)}s)`,
        'info',
      );

      return {
        success: true,
        downloadUrl: outputPath
          ? `/api/download?path=${encodeURIComponent(outputPath)}`
          : undefined,
        stats: {
          count,
          duration,
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: error handling
    } catch (error: any) {
      await ctx.log(`Error: ${error.message}`, 'error');
      logger.error('Reddit scraping failed', error);
      throw error;
    }
  },

  // biome-ignore lint/suspicious/noExplicitAny: generic error
  classifyError(err: any) {
    if (err?.response?.status === 401) return 'auth';
    if (err?.response?.status === 404) return 'not_found';
    if (err?.response?.status === 429) return 'rate_limit';
    return 'unknown';
  },
};
