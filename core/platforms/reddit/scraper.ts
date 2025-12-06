import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ProxyConfig } from '../../browser-manager';
import { createEnhancedLogger } from '../../../utils';
import { prisma } from '../../db/prisma';
import { ScraperEventBus } from '../../scraper-engine.types';
import {
  FlattenedComment,
  RedditComment,
  RedditListing,
  RedditMore,
  RedditPost,
  RedditScraperConfig,
  RedditScraperResult,
  RedditThing,
} from './types';

const logger = createEnhancedLogger('RedditScraper');

/**
 * Reddit Scraper - Node.js Implementation
 * 
 * Now with full proxy support to prevent IP bans.
 * Integrated with EventBus for progress tracking and Prisma for persistence.
 */
export class RedditScraper {
  private client: AxiosInstance;
  private baseDelay = 2000; // 2 seconds between requests
  private proxyConfig?: ProxyConfig;
  private eventBus?: ScraperEventBus;

  constructor(proxyConfig?: ProxyConfig, eventBus?: ScraperEventBus) {
    this.proxyConfig = proxyConfig;
    this.eventBus = eventBus;
    
    const axiosConfig: AxiosRequestConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      },
      timeout: 20000,
    };

    if (this.proxyConfig) {
      axiosConfig.proxy = {
        host: this.proxyConfig.host,
        port: this.proxyConfig.port,
        protocol: 'http', // Axios proxy config requires protocol
      };
      
      if (this.proxyConfig.username && this.proxyConfig.password) {
        axiosConfig.proxy.auth = {
          username: this.proxyConfig.username,
          password: this.proxyConfig.password,
        };
      }
      logger.debug(`Initialized Reddit scraper with proxy ${this.proxyConfig.host}:${this.proxyConfig.port}`);
    } else {
      // Explicitly disable proxy if none provided
      axiosConfig.proxy = false; 
    }

    this.client = axios.create(axiosConfig);
  }

  private emitProgress(current: number, target: number, action: string) {
    if (this.eventBus) {
      this.eventBus.emitProgress({ current, target, action });
    }
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (this.eventBus) {
      this.eventBus.emitLog(message, level);
    } else {
      if (level === 'error') logger.error(message);
      else if (level === 'warn') logger.warn(message);
      else logger.info(message);
    }
  }

  /**
   * Fetch subreddit posts
   */
  async fetchSubredditPosts(
    subreddit: string,
    limit: number = 100,
    sortType: string = 'hot',
  ): Promise<Array<{ url: string; id: string }>> {
    const posts: Array<{ url: string; id: string }> = [];
    let after: string | null = null;
    let page = 1;

    // Use initial progress target as limit, will refine as we go
    this.emitProgress(0, limit, `fetching subreddit listing page 1`);

    while (posts.length < limit) {
      try {
        this.log(`Fetching page ${page} of r/${subreddit}...`);
        const url = `https://www.reddit.com/r/${subreddit}/${sortType}.json`;
        const response: { data: RedditListing } = await this.client.get(url, {
          params: {
            limit: Math.min(100, limit - posts.length), // Max 100 per request
            after: after,
            t: 'all', // time filter, maybe configurable later
          },
        });

        if (response.data.kind !== 'Listing') {
          throw new Error(`Unexpected response kind: ${response.data.kind}`);
        }

        const children = response.data.data.children;
        if (children.length === 0) break;

        for (const child of children) {
          if (child.kind === 't3') {
            const data = child.data as RedditPost;
            posts.push({ url: data.url, id: data.id });
          }
        }

        this.log(`Found ${posts.length} posts so far`);
        this.emitProgress(posts.length, limit, 'fetching subreddit listing');

        after = response.data.data.after;
        if (!after) break;

        page++;
        await this.delay(this.baseDelay);

      } catch (error: any) {
        this.log(`Error fetching subreddit page: ${error.message}`, 'error');
        // If we have some posts, maybe continue? Or break?
        // Let's break to avoid infinite loop of errors
        break;
      }
    }

    return posts.slice(0, limit);
  }

  /**
   * Fetch a single post and its comments
   */
  async fetchPost(postUrl: string): Promise<{ post: RedditPost; comments: FlattenedComment[] }> {
    // Append .json to url if not present
    const url = postUrl.endsWith('.json') ? postUrl : `${postUrl}.json`; // Wait, typical reddit url doesn't end in .json
    // Correct logic: append .json before query params or at end
    const jsonUrl = postUrl.includes('?') 
      ? postUrl.replace('?', '.json?') 
      : `${postUrl}${postUrl.endsWith('/') ? '' : '/'}.json`;

    const response = await this.client.get<RedditThing[]>(jsonUrl); 
    // Response is array: [Listing(post), Listing(comments)]

    if (!Array.isArray(response.data)) {
        throw new Error('Invalid post response format');
    }

    const postListing = response.data[0] as RedditListing;
    const commentListing = response.data[1] as RedditListing;

    const postThing = postListing.data.children[0];
    if (postThing.kind !== 't3') throw new Error('First element is not a post');

    const post = postThing.data as RedditPost;
    const comments: FlattenedComment[] = [];

    const processComments = (listing: RedditListing) => {
        for (const child of listing.data.children) {
            if (child.kind === 't1') {
                const c = child.data as RedditComment;
                comments.push({
                    id: c.id,
                    author: c.author,
                    body: c.body,
                    score: c.score,
                    created_utc: c.created_utc,
                    depth: c.depth || 0,
                    parent_id: c.parent_id,
                    permalink: c.permalink,
                    is_submitter: c.is_submitter,
                    gilded: c.gilded,
                    controversiality: c.controversiality,
                });

                if (c.replies && typeof c.replies === 'object') {
                    processComments(c.replies as RedditListing);
                }
            }
        }
    };

    if (commentListing) {
        processComments(commentListing);
    }

    return { post, comments };
  }

  /**
   * Main entry point: Scrape Subreddit
   */
  async scrapeSubreddit(config: RedditScraperConfig): Promise<RedditScraperResult> {
    try {
      const { subreddit, limit = 100, sortType = 'hot' } = config;
      if (!subreddit) throw new Error('Subreddit is required');

      this.log(`Starting scrape for r/${subreddit} (limit: ${limit})`);

      // Step 1: Fetch Post URLs
      const postUrls = await this.fetchSubredditPosts(subreddit, limit, sortType);

      if (postUrls.length === 0) {
        return { status: 'error', message: 'No posts found' };
      }

      this.log(`Found ${postUrls.length} posts. Starting detail fetch...`);

      // Step 2: Fetch post details (with concurrency limit)
      const posts: Array<{ post: RedditPost; comments: FlattenedComment[] }> = [];
      const concurrency = 3;

      for (let i = 0; i < postUrls.length; i += concurrency) {
        const batch = postUrls.slice(i, i + concurrency);
        
        // Progress update
        this.emitProgress(i, postUrls.length, `processing posts ${i+1}-${Math.min(i+concurrency, postUrls.length)}`);

        const results = await Promise.allSettled(batch.map(({ url }) => this.fetchPost(url)));

        for (const result of results) {
          if (result.status === 'fulfilled') {
            posts.push(result.value);
          } else {
            this.log('Failed to fetch post', 'warn');
          }
        }
        
        // Respect rate limits strongly
        await this.delay(this.baseDelay);
      }

      this.log(`Successfully scraped ${posts.length} posts. Saving to database...`);
      
      // Step 3: Persistence
      await this.saveToDatabase(posts);

      this.emitProgress(posts.length, postUrls.length, 'completed');
      
      return {
        status: 'success',
        scrapedCount: posts.length,
        totalPosts: postUrls.length,
        message: 'Scraping completed',
        posts: posts,
      };
    } catch (error: any) {
      this.log(`Subreddit scrape failed: ${error.message}`, 'error');
      return {
        status: 'error',
        message: error.message || 'Scraping failed',
      };
    }
  }

  private async saveToDatabase(items: Array<{ post: RedditPost; comments: FlattenedComment[] }>) {
      let savedCount = 0;
      for (const item of items) {
          try {
              // Upsert post
              await prisma.redditPost.upsert({
                  where: { id: item.post.id }, // Short ID
                  update: {
                      title: item.post.title,
                      score: item.post.score,
                      numComments: item.post.num_comments,
                      upvoteRatio: item.post.upvote_ratio,
                  },
                  create: {
                      id: item.post.id,
                      name: item.post.name,
                      title: item.post.title,
                      selftext: item.post.selftext,
                      author: item.post.author,
                      subreddit: item.post.subreddit,
                      subredditNamePrefixed: item.post.subreddit_name_prefixed,
                      score: item.post.score,
                      upvoteRatio: item.post.upvote_ratio,
                      numComments: item.post.num_comments,
                      createdUtc: item.post.created_utc,
                      url: item.post.url,
                      permalink: item.post.permalink,
                      isSelf: item.post.is_self,
                  }
              });

              // Upsert comments - batching would be better but keeping it simple
              /* 
                 Comments need to be processed carefully because of parent_id dependencies?
                 Actually, Prisma createMany is fine, but we need upsert for idempotency.
                 Since we can't createMany with upsert logic easily, transaction or loop.
                 Loop is safer for relations.
              */
              for (const comment of item.comments) {
                   await prisma.redditComment.upsert({
                       where: { id: comment.id },
                       update: { score: comment.score },
                       create: {
                           id: comment.id,
                           name: `t1_${comment.id}`, // Reconstruct name if missing
                           postId: item.post.id,
                           author: comment.author,
                           body: comment.body,
                           score: comment.score,
                           createdUtc: comment.created_utc,
                           parentId: comment.parent_id,
                           permalink: comment.permalink,
                           depth: comment.depth
                       }
                   });
              }
              savedCount++;
          } catch (e: any) {
              this.log(`Failed to save post ${item.post.id}: ${e.message}`, 'error');
          }
      }
      this.log(`Saved ${savedCount} posts to database.`);
  }

  /**
   * Scrape a single post
   */
  async scrapePost(postUrl: string): Promise<RedditScraperResult> {
    try {
      const { post, comments } = await this.fetchPost(postUrl);

      // Save single post to DB
      await this.saveToDatabase([{ post, comments }]);

      return {
        status: 'success',
        post,
        comments,
        message: 'Post scraped successfully',
      };
    } catch (error: any) {
      this.log(`Post scrape failed: ${error.message}`, 'error');
      return {
        status: 'error',
        message: error.message || 'Failed to scrape post',
      };
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
