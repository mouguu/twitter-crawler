/**
 * Reddit API Client
 * 使用 HTTP API 替代 spawn 子进程通信
 */

import { ScraperError, ErrorCode } from './errors';
import { parseRedditPayload } from '../utils';

export interface RedditScrapeOptions {
  subreddit?: string;
  postUrl?: string;
  maxPosts?: number;
  strategy?: 'auto' | 'super_full' | 'super_recent' | 'new';
  saveJson?: boolean;
  onProgress?: (current: number, total: number, message: string) => void;
  onLog?: (message: string, level?: string) => void;
}

export interface RedditScrapeResult {
  success: boolean;
  data?: {
    post?: any;
    comments?: any[];
    comment_count?: number;
    scraped_count?: number;
    file_path?: string;
    message?: string;
  };
  error?: string;
  errorType?: string;
  traceback?: string;
  normalizedPosts?: any[];
  parseStats?: { total: number; deduped: number; dropped: number };
  usedWasm?: boolean;
}

export class RedditApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl?: string, timeout: number = 300000) {
    // 默认使用环境变量或本地服务器
    this.baseUrl = baseUrl || 
                   process.env.REDDIT_API_URL || 
                   'http://127.0.0.1:5002';
    this.timeout = timeout;
  }

  /**
   * 检查服务是否可用
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * 爬取 subreddit
   */
  async scrapeSubreddit(options: RedditScrapeOptions): Promise<RedditScrapeResult> {
    const { subreddit = 'UofT', maxPosts = 100, strategy = 'auto', saveJson = false, onProgress, onLog } = options;

    try {
      const controller = new AbortController();
      // Increase timeout for streaming
      const timeoutId = setTimeout(() => controller.abort(), this.timeout * 2);

      const response = await fetch(`${this.baseUrl}/api/scrape/subreddit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subreddit,
          max_posts: maxPosts,
          strategy,
          save_json: saveJson
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw ScraperError.fromHttpResponse(response, {
          subreddit,
          maxPosts,
          strategy,
          ...errorData
        });
      }

      if (!response.body || typeof (response.body as any).getReader !== 'function') {
        // Fallback for non-streaming/testing environments
        const data = await response.json().catch(() => null);
        if (data) {
          const parsed = await parseRedditPayload(data).catch(() => null);
          return {
            success: !!data.success,
            data: data.data,
            error: data.error,
            errorType: data.error_type,
            traceback: data.traceback,
            normalizedPosts: parsed?.posts,
            parseStats: parsed?.stats,
            usedWasm: parsed?.usedWasm
          };
        }
        throw new Error('Response body is empty');
      }

      // Handle streaming response (NDJSON)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: RedditScrapeResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'progress' && onProgress) {
              onProgress(data.current, data.total, data.message);
            } else if (data.type === 'log' && onLog) {
              onLog(data.message || '', data.level || 'info');
            } else if (data.type === 'result') {
              finalResult = {
                success: data.success,
                data: data.data,
                error: data.error,
                errorType: data.error_type,
                traceback: data.traceback
              };
            } else if (data.type === 'error') {
               throw new Error(data.error || 'Unknown error from stream');
            }
          } catch (e) {
            console.warn('Failed to parse NDJSON line:', line);
          }
        }
      }

      if (finalResult) {
        try {
          const parsed = await parseRedditPayload(finalResult.data || finalResult);
          finalResult = {
            ...finalResult,
            normalizedPosts: parsed.posts,
            parseStats: parsed.stats,
            usedWasm: parsed.usedWasm
          };
        } catch (_) {
          // Ignore parsing issues; return raw
        }
        return finalResult;
      }
      
      // Fallback for non-streaming response or empty stream
      throw new Error('Stream ended without result');

    } catch (error: any) {
      if (error instanceof ScraperError) {
        throw error;
      }

      // 处理网络错误
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        throw new ScraperError(
          ErrorCode.TIMEOUT,
          `Reddit API request timeout after ${this.timeout}ms`,
          {
            retryable: true,
            context: { subreddit, maxPosts }
          }
        );
      }

      throw new ScraperError(
        ErrorCode.NETWORK_ERROR,
        `Failed to connect to Reddit API: ${error.message}`,
        {
          retryable: true,
          originalError: error,
          context: { baseUrl: this.baseUrl }
        }
      );
    }
  }

  /**
   * 爬取单个 Reddit 帖子
   */
  async scrapePost(postUrl: string): Promise<RedditScrapeResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/scrape/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ post_url: postUrl }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw ScraperError.fromHttpResponse(response, {
          postUrl,
          ...errorData
        });
      }

      const result = await response.json();
      return {
        success: result.success || false,
        data: result.data,
        error: result.error,
        errorType: result.error_type,
        traceback: result.traceback
      };
    } catch (error: any) {
      if (error instanceof ScraperError) {
        throw error;
      }

      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        throw new ScraperError(
          ErrorCode.TIMEOUT,
          `Reddit API request timeout after ${this.timeout}ms`,
          {
            retryable: true,
            context: { postUrl }
          }
        );
      }

      throw new ScraperError(
        ErrorCode.NETWORK_ERROR,
        `Failed to connect to Reddit API: ${error.message}`,
        {
          retryable: true,
          originalError: error,
          context: { baseUrl: this.baseUrl, postUrl }
        }
      );
    }
  }
}
