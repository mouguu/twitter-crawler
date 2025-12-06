/**
 * Reddit Scraper - Complete Rewrite
 *
 * Simple, reliable, cancellation-friendly implementation
 * Follows the same architectural patterns as Twitter adapter
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { ProxyConfig } from '../../browser-manager';
import { createEnhancedLogger } from '../../../utils';
import { ScraperEventBus } from '../../scraper-engine.types';
import {
  FlattenedComment,
  RedditComment,
  RedditListing,
  RedditPost,
  RedditScraperConfig,
  RedditScraperResult,
  RedditThing,
} from './types';

const logger = createEnhancedLogger('RedditScraper');

export class RedditScraper {
  private client: AxiosInstance;
  private eventBus?: ScraperEventBus;
  private shouldStop?: () => Promise<boolean> | boolean;
  private abortController: AbortController;
  private proxyManager?: any; // ProxyManager instance for auto-rotation
  private currentProxy?: ProxyConfig & { id?: string }; // Current proxy config with ID

  constructor(
    proxyConfig?: ProxyConfig & { id?: string },
    eventBus?: ScraperEventBus,
    shouldStop?: () => Promise<boolean> | boolean,
    proxyManager?: any,
  ) {
    this.eventBus = eventBus;
    this.shouldStop = shouldStop;
    this.abortController = new AbortController();
    this.proxyManager = proxyManager;
    this.currentProxy = proxyConfig;

    // Setup periodic cancellation check
    if (shouldStop) {
      const checkInterval = setInterval(async () => {
        if (await shouldStop()) {
          this.abortController.abort();
          clearInterval(checkInterval);
        }
      }, 500);
      // Don't keep process alive for this interval
      checkInterval.unref();
    }

    const axiosConfig: AxiosRequestConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000, // 20s timeout - will retry on timeout
      signal: this.abortController.signal,
      validateStatus: (status) => status < 500, // Don't throw on 4xx
    };

    if (proxyConfig) {
      // Use HttpsProxyAgent for proper proxy authentication
      // Format: http://username:password@host:port
      const proxyUrl = proxyConfig.username && proxyConfig.password
        ? `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`
        : `http://${proxyConfig.host}:${proxyConfig.port}`;

      const httpsAgent = new HttpsProxyAgent(proxyUrl);
      const httpAgent = new HttpProxyAgent(proxyUrl);

      axiosConfig.httpsAgent = httpsAgent;
      axiosConfig.httpAgent = httpAgent;

      // Don't use axios proxy config when using agents
      axiosConfig.proxy = false;

      this.log('🔗 Axios client configured with proxy (using HttpsProxyAgent)', 'info', {
        proxyHost: proxyConfig.host,
        proxyPort: proxyConfig.port,
        hasAuth: !!(proxyConfig.username && proxyConfig.password),
        username: proxyConfig.username ? `${proxyConfig.username.substring(0, 3)}***` : 'none',
        password: proxyConfig.password ? '***' : 'none',
        usernameLength: proxyConfig.username?.length || 0,
        passwordLength: proxyConfig.password?.length || 0,
        protocol: 'http',
        method: 'HttpsProxyAgent',
      });
    } else {
      axiosConfig.proxy = false;
      this.log('🌐 Axios client configured for direct connection (no proxy)', 'info', {
        proxyEnabled: false,
      });
    }

    this.client = axios.create(axiosConfig);
  }

  /**
   * Switch to next proxy (for auto-rotation on failure)
   */
  private switchToNextProxy(reason?: string): boolean {
    if (!this.proxyManager || !this.proxyManager.hasProxies()) {
      return false;
    }

    // Mark current proxy as failed
    if (this.currentProxy?.id) {
      this.proxyManager.markProxyFailed(this.currentProxy.id, reason);
      this.log(`🔄 Marked proxy ${this.currentProxy.id} as failed, switching to next proxy`, 'warn', {
        failedProxyId: this.currentProxy.id,
        reason,
      });
    }

    // Get next proxy
    const nextProxy = this.proxyManager.getNextProxy();
    if (!nextProxy) {
      this.log('⚠️ No more proxies available, continuing with current proxy', 'warn');
      return false;
    }

    // Update proxy config
    this.currentProxy = {
      host: nextProxy.host,
      port: nextProxy.port,
      username: nextProxy.username || '',
      password: nextProxy.password || '',
      id: nextProxy.id,
    };

    // Create new abort controller if the current one is aborted
    // This is critical: if the old controller was aborted, new requests will fail immediately
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
      // Re-setup periodic cancellation check if needed
      if (this.shouldStop) {
        const shouldStopFn = this.shouldStop;
        const checkInterval = setInterval(async () => {
          const shouldStop = typeof shouldStopFn === 'function'
            ? await shouldStopFn()
            : shouldStopFn;
          if (shouldStop) {
            this.abortController.abort();
            clearInterval(checkInterval);
          }
        }, 500);
        checkInterval.unref();
      }
    }

    // Recreate axios client with new proxy using HttpsProxyAgent
    const proxyUrl = nextProxy.username && nextProxy.password
      ? `http://${nextProxy.username}:${nextProxy.password}@${nextProxy.host}:${nextProxy.port}`
      : `http://${nextProxy.host}:${nextProxy.port}`;

    const httpsAgent = new HttpsProxyAgent(proxyUrl);
    const httpAgent = new HttpProxyAgent(proxyUrl);

    const axiosConfig: AxiosRequestConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
      signal: this.abortController.signal, // Use the (possibly new) abort controller
      validateStatus: (status) => status < 500,
      httpsAgent,
      httpAgent,
      proxy: false, // Don't use axios proxy config when using agents
    };

    this.client = axios.create(axiosConfig);

    this.log(`✅ Switched to new proxy: ${nextProxy.host}:${nextProxy.port}`, 'info', {
      newProxyHost: nextProxy.host,
      newProxyPort: nextProxy.port,
      newProxyId: nextProxy.id,
      reason: reason || 'auto-rotation',
    });

    return true;
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info', details?: any) {
    const timestamp = new Date().toISOString();
    const logMessage = details
      ? `${message} | Details: ${JSON.stringify(details)}`
      : message;

    if (this.eventBus) {
      this.eventBus.emitLog(`[${timestamp}] ${logMessage}`, level);
    } else {
      logger[level](logMessage, details);
    }
  }

  private emitProgress(current: number, target: number, action: string) {
    if (this.eventBus) {
      this.eventBus.emitProgress({ current, target, action });
    }
  }

  private async checkCancel(): Promise<void> {
    try {
      if (this.shouldStop) {
        const shouldStop = await this.shouldStop();
        if (shouldStop) {
          this.log('Cancellation check: Job should stop', 'warn');
          this.abortController.abort();
          throw new Error('Job cancelled');
        }
      }
      if (this.abortController.signal.aborted) {
        this.log('Cancellation check: Request already aborted', 'warn');
        throw new Error('Request aborted');
      }
    } catch (error: any) {
      if (error.message === 'Job cancelled' || error.message === 'Request aborted') {
        throw error;
      }
      this.log(`Cancellation check error: ${error.message}`, 'error', { error: error.stack });
      throw error;
    }
  }

  private async delay(ms: number): Promise<void> {
    const step = 500;
    let elapsed = 0;
    const delayStartTime = Date.now();

    this.log(`Starting delay of ${ms}ms`, 'info', { delayMs: ms });

    while (elapsed < ms) {
      await this.checkCancel();
      const wait = Math.min(step, ms - elapsed);
      const waitStart = Date.now();
      await new Promise((resolve) => setTimeout(resolve, wait));
      const actualWait = Date.now() - waitStart;
      elapsed += actualWait;

      // Log progress every 2 seconds
      if (elapsed % 2000 < step) {
        this.log(`Delay progress: ${elapsed}/${ms}ms (${((elapsed / ms) * 100).toFixed(1)}%)`, 'info', {
          elapsed,
          total: ms,
          remaining: ms - elapsed,
        });
      }
    }

    const actualDelay = Date.now() - delayStartTime;
    this.log(`Delay completed`, 'info', {
      requested: ms,
      actual: actualDelay,
      difference: actualDelay - ms,
    });
  }

  /**
   * Fetch post list from subreddit
   */
  async fetchPostList(
    subreddit: string,
    limit: number,
    sort: 'hot' | 'new' | 'top' = 'hot',
  ): Promise<Array<{ url: string; id: string }>> {
    await this.checkCancel();

    this.log(`Fetching post list from r/${subreddit} (limit: ${limit}, sort: ${sort})`);

    const posts: Array<{ url: string; id: string }> = [];
    let after: string | null = null;
    let page = 1;

    while (posts.length < limit) {
      await this.checkCancel();

      this.log(`Fetching page ${page}... (found ${posts.length}/${limit})`);

      const url = `https://www.reddit.com/r/${subreddit}/${sort}.json`;
      const requestParams: Record<string, any> = {
        limit: Math.min(100, limit - posts.length),
        after,
      };

      // Retry logic for page fetching
      let lastError: any = null;
      let retryCount = 0;
      const maxRetries = 3;
      let response: { data: RedditListing; status: number; statusText: string; headers: any } | null = null;

      while (retryCount <= maxRetries && !response) {
        await this.checkCancel();

        if (retryCount > 0) {
          this.log(`Retrying page ${page} (attempt ${retryCount + 1}/${maxRetries + 1})...`, 'warn', {
            previousError: lastError?.message || lastError?.code,
            delay: retryCount * 2000,
          });
          await this.delay(retryCount * 2000); // Exponential backoff: 2s, 4s, 6s
        }

        try {
          // Check if using proxy via httpsAgent or currentProxy
          const isUsingProxy = !!(this.client.defaults.httpsAgent || this.currentProxy);
          const proxyInfo = isUsingProxy && this.currentProxy
            ? {
                proxyHost: this.currentProxy.host,
                proxyPort: this.currentProxy.port,
                proxyProtocol: 'http',
                usingProxy: true,
                proxyId: this.currentProxy.id,
              }
            : { usingProxy: false, connectionMode: 'direct' };

          this.log(`Making HTTP request to Reddit API`, 'info', {
            url,
            params: requestParams,
            page,
            attempt: retryCount + 1,
            maxRetries: maxRetries + 1,
            currentPosts: posts.length,
            targetLimit: limit,
            ...proxyInfo,
          });

          const requestStartTime = Date.now();
          this.log(`HTTP request starting... (timeout: 20s)`, 'info', {
            url,
            timeout: 20000,
            attempt: retryCount + 1,
            timestamp: new Date().toISOString(),
            ...proxyInfo,
          });

          // Smart timeout handling: cancel and switch proxy if slow
          const warningIntervals: NodeJS.Timeout[] = [];
          let requestAborted = false;

          // 5s warning
          const warning5s = setTimeout(() => {
            const elapsed = Date.now() - requestStartTime;
            this.log(`⚠️ HTTP request still pending (${(elapsed / 1000).toFixed(1)}s elapsed)`, 'warn', {
              elapsed: `${(elapsed / 1000).toFixed(1)}s`,
              timeout: '20s',
              remaining: `${(20 - elapsed / 1000).toFixed(1)}s`,
              attempt: retryCount + 1,
              proxyId: this.currentProxy?.id,
            });
          }, 5000);
          warningIntervals.push(warning5s);

          // 8s: Smart switch - cancel and retry with new proxy if available
          const smartSwitchTimeout = setTimeout(() => {
            const elapsed = Date.now() - requestStartTime;
            if (this.proxyManager && this.currentProxy?.id && retryCount < maxRetries && !requestAborted) {
              this.log(`🔄 Smart switch: Request too slow (${(elapsed / 1000).toFixed(1)}s), switching proxy immediately`, 'warn', {
                elapsed: `${(elapsed / 1000).toFixed(1)}s`,
                page,
                attempt: retryCount + 1,
                previousProxy: this.currentProxy.id,
                reason: 'slow_response_8s',
              });

              // Mark proxy as failed and switch (switchToNextProxy will handle abort controller)
              this.proxyManager.markProxyFailed(this.currentProxy.id, `Slow response: ${(elapsed / 1000).toFixed(1)}s`);

              // Abort current request
              this.abortController.abort();
              requestAborted = true;

              // Switch proxy (this will create new abort controller if needed)
              this.switchToNextProxy(`Slow response: ${(elapsed / 1000).toFixed(1)}s`);
            }
          }, 8000); // Switch after 8 seconds
          warningIntervals.push(smartSwitchTimeout);

          // 15s final warning
          const warning15s = setTimeout(() => {
            const elapsed = Date.now() - requestStartTime;
            this.log(`⚠️ HTTP request still pending (${(elapsed / 1000).toFixed(1)}s elapsed, final warning)`, 'warn', {
              elapsed: `${(elapsed / 1000).toFixed(1)}s`,
              timeout: '20s',
              remaining: `${(20 - elapsed / 1000).toFixed(1)}s`,
              attempt: retryCount + 1,
            });
          }, 15000);
          warningIntervals.push(warning15s);

          try {
            response = await this.client.get(url, {
              params: requestParams,
            });
            // Clear all warnings
            warningIntervals.forEach(clearTimeout);
            lastError = null; // Success, clear error
          } catch (error: any) {
            // Clear all warnings
            warningIntervals.forEach(clearTimeout);

            // If aborted due to smart switch, retry with new proxy
            if (error.name === 'AbortError' && this.proxyManager && retryCount < maxRetries) {
              this.log(`🔄 Retrying page ${page} with new proxy after smart switch (attempt ${retryCount + 2}/${maxRetries + 1})`, 'info', {
                page,
                attempt: retryCount + 2,
                reason: 'smart_switch_retry',
              });
              retryCount++;
              continue; // Retry with new proxy
            }
            const elapsed = Date.now() - requestStartTime;

            // Add elapsed time to error details
            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
              error.elapsed = elapsed;
            }

            lastError = error;

            // If this is the last retry, throw the error
            if (retryCount >= maxRetries) {
              throw error;
            }

            // Otherwise, continue to retry
            retryCount++;
            continue;
          }
        } catch (error: any) {
          lastError = error;

          // If this is the last retry, break and handle error below
          if (retryCount >= maxRetries) {
            break;
          }

          retryCount++;
          continue;
        }
      }

      // If we still don't have a response after all retries, handle the error
      if (!response) {
        await this.checkCancel();

        const errorDetails = {
          name: lastError?.name,
          code: lastError?.code,
          message: lastError?.message,
          status: lastError?.response?.status,
          statusText: lastError?.response?.statusText,
          headers: lastError?.response?.headers ? Object.keys(lastError.response.headers) : null,
          retryAfter: lastError?.response?.headers?.['retry-after'],
          url: lastError?.config?.url,
          timeout: lastError?.code === 'ECONNABORTED' || lastError?.code === 'ETIMEDOUT',
          networkError: lastError?.code === 'ENOTFOUND' || lastError?.code === 'ECONNREFUSED',
        };

        this.log(`HTTP request failed for page ${page} after ${maxRetries + 1} attempts`, 'error', errorDetails);

        if (lastError?.name === 'AbortError' || lastError?.code === 'ERR_CANCELED') {
          this.log('Request was cancelled/aborted', 'warn');
          throw new Error('Request cancelled');
        }

        const status = lastError?.response?.status;
        if (status === 404) {
          this.log(`Subreddit not found (404)`, 'error', { subreddit, page });
          throw new Error(`Subreddit r/${subreddit} not found`);
        }
        if (status === 403) {
          // 403 often means the proxy IP is blocked - try switching proxy!
          this.log(`🛑 Access forbidden (403) - proxy likely blocked`, 'warn', {
            subreddit,
            page,
            proxyId: this.currentProxy?.id,
            possibleReasons: ['Proxy IP blocked by Reddit', 'Private subreddit', 'Banned subreddit'],
          });

          // Mark current proxy as failed and try switching
          if (this.proxyManager && this.currentProxy?.id && retryCount < maxRetries) {
            this.proxyManager.markProxyFailed(this.currentProxy.id, '403 Forbidden - IP likely blocked');
            const switched = this.switchToNextProxy('403 Forbidden');
            if (switched) {
              this.log(`🔄 Switching proxy after 403 (page ${page}, attempt ${retryCount + 2}/${maxRetries + 1})`, 'info', {
                page,
                attempt: retryCount + 2,
                reason: '403_forbidden',
                newProxy: this.currentProxy?.id,
              });
              retryCount++;
              continue; // Retry with new proxy
            }
          }

          throw new Error(`Access forbidden to r/${subreddit}`);
        }
        if (status === 407) {
          // Proxy Authentication Required - try switching proxy
          this.log(`❌ Proxy authentication failed (407)`, 'error', {
            proxyId: this.currentProxy?.id,
            proxyHost: this.currentProxy?.host,
            proxyPort: this.currentProxy?.port,
            hasAuth: !!(this.currentProxy?.username && this.currentProxy?.password),
            responseBody: lastError?.response?.data ? String(lastError.response.data).substring(0, 200) : null,
          });

          // Mark current proxy as failed
          if (this.proxyManager && this.currentProxy?.id) {
            this.proxyManager.markProxyFailed(this.currentProxy.id, '407 Proxy Authentication Required');
          }

          // Try switching proxy if available
          if (this.proxyManager && retryCount < maxRetries) {
            const switched = this.switchToNextProxy('407 Proxy Authentication Required');
            if (switched) {
              this.log(`🔄 Retrying page ${page} with new proxy (attempt ${retryCount + 2}/${maxRetries + 1})`, 'info', {
                page,
                attempt: retryCount + 2,
                reason: 'proxy_auth_failed',
                previousProxy: this.currentProxy?.id,
              });
              retryCount++;
              continue; // Retry with new proxy
            }
          }

          throw new Error(`Proxy authentication failed (407): ${lastError?.response?.data || lastError.message}`);
        }
        if (status === 429) {
          const retryAfter = parseInt(lastError?.response?.headers['retry-after'] || '60', 10);
          this.log(`Rate limited (429). Waiting ${retryAfter}s before retry...`, 'warn', {
            retryAfter,
            page,
            headers: lastError?.response?.headers,
          });
          await this.delay(retryAfter * 1000);
          this.log(`Rate limit wait completed, retrying page ${page}...`, 'info');
          continue;
        }

        // Network/timeout errors - try switching proxy before final failure
        if (lastError?.code === 'ECONNABORTED' || lastError?.code === 'ETIMEDOUT') {
          const elapsed = lastError.elapsed || (lastError.config?.timeout || 20000);

          // Try switching proxy if available
          if (this.proxyManager && this.currentProxy?.id && retryCount < maxRetries) {
            const switched = this.switchToNextProxy(`Timeout after ${(elapsed / 1000).toFixed(1)}s`);
            if (switched) {
              this.log(`🔄 Retrying page ${page} with new proxy (attempt ${retryCount + 2}/${maxRetries + 1})`, 'info', {
                page,
                attempt: retryCount + 2,
                reason: 'proxy_switched',
              });
              retryCount++;
              continue; // Retry with new proxy
            }
          }

          this.log(`❌ Request timeout after ${maxRetries + 1} attempts (${lastError.code})`, 'error', {
            timeout: lastError.config?.timeout || 20000,
            elapsed: `${(elapsed / 1000).toFixed(1)}s`,
            attempts: maxRetries + 1,
            url: lastError.config?.url,
            possibleReasons: [
              'Network too slow',
              'Reddit server not responding',
              'Proxy timeout',
              'DNS resolution timeout',
              'Firewall blocking',
              'Reddit blocking requests',
            ],
            suggestions: [
              'Check internet connection',
              'Try using proxy (enable proxy in task form)',
              'Check if Reddit is accessible (visit reddit.com in browser)',
              'Check firewall/antivirus settings',
              'Try again later',
            ],
          });
          throw new Error(`Request timeout after ${maxRetries + 1} attempts (${(elapsed / 1000).toFixed(1)}s each): ${lastError.message}`);
        }

        if (lastError?.code === 'ENOTFOUND' || lastError?.code === 'ECONNREFUSED') {
          this.log(`Network error (${lastError.code}) after ${maxRetries + 1} attempts`, 'error', {
            code: lastError.code,
            message: lastError.message,
            attempts: maxRetries + 1,
            possibleReasons: ['DNS failure', 'Server unreachable', 'Proxy issue'],
            suggestions: ['Try using proxy', 'Check DNS settings', 'Check network connection'],
          });
          throw new Error(`Network error after ${maxRetries + 1} attempts: ${lastError.message}`);
        }

        this.log(`Unknown error fetching page ${page} after ${maxRetries + 1} attempts`, 'error', {
          ...errorDetails,
          attempts: maxRetries + 1,
        });
        throw new Error(`Failed to fetch page ${page} after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
      }

      // Successfully got response, process it
      try {
        this.log(`✅ HTTP request completed successfully`, 'info', {
          status: response.status || 'N/A',
          statusText: response.statusText || 'N/A',
          responseSize: JSON.stringify(response.data).length,
          responseSizeKB: `${(JSON.stringify(response.data).length / 1024).toFixed(2)} KB`,
          headers: response.headers ? Object.keys(response.headers) : [],
        });

        // 🔥 Handle 403 in try block - axios considers it 'success' due to validateStatus
        if (response.status === 403) {
          this.log(`🛑 Proxy blocked (403 in response)`, 'warn', {
            subreddit,
            page,
            proxyId: this.currentProxy?.id,
          });

          // Mark proxy as failed and switch
          if (this.proxyManager && this.currentProxy?.id && retryCount < maxRetries) {
            this.proxyManager.markProxyFailed(this.currentProxy.id, '403 Forbidden - IP blocked by Reddit');
            const switched = this.switchToNextProxy('403 Forbidden');
            if (switched) {
              this.log(`🔄 Switching proxy after 403 (page ${page}, attempt ${retryCount + 2}/${maxRetries + 1})`, 'info', {
                page,
                attempt: retryCount + 2,
                newProxy: this.currentProxy?.id,
              });
              retryCount++;
              continue; // Retry with new proxy
            }
          }
          throw new Error(`Access forbidden to r/${subreddit}`);
        }

        this.log(`Parsing response data...`, 'info', {
          kind: response.data.kind,
          hasData: !!response.data.data,
        });

        if (response.data.kind !== 'Listing') {
          this.log(`Invalid response kind: ${response.data.kind}`, 'error', {
            expected: 'Listing',
            actual: response.data.kind,
            dataPreview: JSON.stringify(response.data).slice(0, 200),
          });
          throw new Error(`Invalid response format: expected Listing, got ${response.data.kind}`);
        }

        const children = response.data.data.children;
        this.log(`Response contains ${children.length} children`, 'info', {
          childrenCount: children.length,
          after: response.data.data.after,
          dist: response.data.data.dist,
        });

        if (children.length === 0) {
          this.log('No more posts available (empty children array)', 'info', {
            after,
            page,
            totalFound: posts.length,
            reason: 'Reached end of subreddit or no more posts',
          });
          break;
        }

        let t3Count = 0;
        let otherKindCount = 0;
        for (const child of children) {
          if (child.kind === 't3') {
            t3Count++;
            const post = child.data as RedditPost;
            // Use permalink instead of url - permalink is always the Reddit post link
            // url can be external links, images, videos, etc.
            const postUrl = post.permalink.startsWith('http')
              ? post.permalink
              : `https://www.reddit.com${post.permalink}`;
            posts.push({ url: postUrl, id: post.id });
          } else {
            otherKindCount++;
            this.log(`Skipping non-post child`, 'info', {
              kind: child.kind,
              totalSkipped: otherKindCount,
            });
          }
        }

        this.log(`Processed children from page ${page}`, 'info', {
          totalChildren: children.length,
          postsFound: t3Count,
          otherKinds: otherKindCount,
          totalPostsSoFar: posts.length,
        });

        this.emitProgress(posts.length, limit, `Found ${posts.length}/${limit} posts`);
        this.log(`Page ${page}: Found ${posts.length}/${limit} posts`);

        // Mark proxy as successful if using proxy
        if (this.proxyManager && this.currentProxy?.id) {
          this.proxyManager.markProxySuccess(this.currentProxy.id);
        }

        after = response.data.data.after;
        if (!after) break;

        page++;
        if (posts.length < limit) {
          await this.delay(2000); // 2s between pages
        }
      } catch (error: any) {
        await this.checkCancel();

        const errorDetails = {
          name: error.name,
          code: error.code,
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          headers: error.response?.headers ? Object.keys(error.response.headers) : null,
          retryAfter: error.response?.headers?.['retry-after'],
          url: error.config?.url,
          timeout: error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT',
          networkError: error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED',
        };

        this.log(`HTTP request failed for page ${page}`, 'error', errorDetails);

        if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
          this.log('Request was cancelled/aborted', 'warn');
          throw new Error('Request cancelled');
        }

        const status = error.response?.status;
        if (status === 404) {
          this.log(`Subreddit not found (404)`, 'error', { subreddit, page });
          throw new Error(`Subreddit r/${subreddit} not found`);
        }
        if (status === 403) {
          // 403 often means the proxy IP is blocked - try switching proxy!
          this.log(`🛑 Access forbidden (403) - proxy likely blocked`, 'warn', {
            subreddit,
            page,
            proxyId: this.currentProxy?.id,
            possibleReasons: ['Proxy IP blocked by Reddit', 'Private subreddit', 'Banned subreddit'],
          });

          // Mark current proxy as failed and try switching
          if (this.proxyManager && this.currentProxy?.id) {
            this.proxyManager.markProxyFailed(this.currentProxy.id, '403 Forbidden - IP likely blocked');
            const switched = this.switchToNextProxy('403 Forbidden');
            if (switched) {
              this.log(`🔄 Switching proxy after 403 (page ${page})`, 'info', {
                page,
                reason: '403_forbidden',
                newProxy: this.currentProxy?.id,
              });
              continue; // Retry with new proxy
            }
          }

          throw new Error(`Access forbidden to r/${subreddit}`);
        }
        if (status === 429) {
          const retryAfter = parseInt(error.response?.headers['retry-after'] || '60', 10);
          this.log(`Rate limited (429). Waiting ${retryAfter}s before retry...`, 'warn', {
            retryAfter,
            page,
            headers: error.response?.headers,
          });
          await this.delay(retryAfter * 1000);
          this.log(`Rate limit wait completed, retrying page ${page}...`, 'info');
          continue;
        }

        // Network/timeout errors
        if (lastError?.code === 'ECONNABORTED' || lastError?.code === 'ETIMEDOUT') {
          const elapsed = lastError.elapsed || (lastError.config?.timeout || 20000);
          this.log(`❌ Request timeout after ${maxRetries + 1} attempts (${error.code})`, 'error', {
            timeout: lastError.config?.timeout || 20000,
            elapsed: `${(elapsed / 1000).toFixed(1)}s`,
            attempts: maxRetries + 1,
            url: lastError.config?.url,
            possibleReasons: [
              'Network too slow',
              'Reddit server not responding',
              'Proxy timeout',
              'DNS resolution timeout',
              'Firewall blocking',
              'Reddit blocking requests',
            ],
            suggestions: [
              'Check internet connection',
              'Try using proxy (enable proxy in task form)',
              'Check if Reddit is accessible (visit reddit.com in browser)',
              'Check firewall/antivirus settings',
              'Try again later',
            ],
          });
          throw new Error(`Request timeout after ${maxRetries + 1} attempts (${(elapsed / 1000).toFixed(1)}s each): ${lastError.message}`);
        }

        if (lastError?.code === 'ENOTFOUND' || lastError?.code === 'ECONNREFUSED') {
          this.log(`Network error (${lastError.code}) after ${maxRetries + 1} attempts`, 'error', {
            code: lastError.code,
            message: lastError.message,
            attempts: maxRetries + 1,
            possibleReasons: ['DNS failure', 'Server unreachable', 'Proxy issue'],
            suggestions: ['Try using proxy', 'Check DNS settings', 'Check network connection'],
          });
          throw new Error(`Network error after ${maxRetries + 1} attempts: ${lastError.message}`);
        }

        this.log(`Unknown error fetching page ${page} after ${maxRetries + 1} attempts`, 'error', {
          ...errorDetails,
          attempts: maxRetries + 1,
        });
        throw new Error(`Failed to fetch page ${page} after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
      }
    }

    return posts.slice(0, limit);
  }

  /**
   * Fetch single post with comments
   */
  async fetchPost(postUrl: string): Promise<{ post: RedditPost; comments: FlattenedComment[] }> {
    await this.checkCancel();

    // Extract post ID from Reddit permalink format: /r/subreddit/comments/{id}/title/
    // or handle full URL
    let postId = 'unknown';
    const permalinkMatch = postUrl.match(/\/comments\/([^\/]+)/);
    if (permalinkMatch) {
      postId = permalinkMatch[1];
    } else {
      postId = postUrl.split('/').filter(Boolean).pop() || 'unknown';
    }

    this.log(`Fetching post: ${postId}`);

    // Ensure URL ends with .json for Reddit API
    // Remove trailing slash and add .json
    let jsonUrl = postUrl.replace(/\/$/, '');
    if (!jsonUrl.endsWith('.json')) {
      jsonUrl = jsonUrl.includes('?')
        ? jsonUrl.replace('?', '.json?')
        : `${jsonUrl}.json`;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      await this.checkCancel();

      this.log(`Fetching post attempt ${attempt + 1}/3`, 'info', {
        postId,
        url: jsonUrl,
        attempt: attempt + 1,
      });

      const fetchStartTime = Date.now();
      try {
        // Check if using proxy via httpsAgent or currentProxy
        const isUsingProxy = !!(this.client.defaults.httpsAgent || this.currentProxy);
        const proxyInfo = isUsingProxy && this.currentProxy
          ? {
              proxyHost: this.currentProxy.host,
              proxyPort: this.currentProxy.port,
              proxyProtocol: 'http',
              usingProxy: true,
              proxyId: this.currentProxy.id,
            }
          : { usingProxy: false, connectionMode: 'direct' };

        this.log(`Making HTTP GET request...`, 'info', {
          url: jsonUrl,
          timeout: '60s',
          timestamp: new Date().toISOString(),
          ...proxyInfo,
        });

        // Smart timeout handling: cancel and switch proxy if slow
        const timeoutWarnings: NodeJS.Timeout[] = [];
        let requestAborted = false;

        // 5s warning
        const warning5s = setTimeout(() => {
          const elapsed = Date.now() - fetchStartTime;
          this.log(`⚠️ Post fetch still pending (${(elapsed / 1000).toFixed(1)}s elapsed)`, 'warn', {
            postId,
            elapsed: `${(elapsed / 1000).toFixed(1)}s`,
            timeout: '60s',
            proxyId: this.currentProxy?.id,
          });
        }, 5000);
        timeoutWarnings.push(warning5s);

        // 8s: Smart switch - cancel and retry with new proxy if available
        const smartSwitchTimeout = setTimeout(() => {
          const elapsed = Date.now() - fetchStartTime;
          if (!requestAborted) {
            // Clear all timeout warnings BEFORE aborting to prevent spurious warning logs
            timeoutWarnings.forEach(timeout => clearTimeout(timeout));
            
            // On attempts 0-1, switch proxy and retry
            if (this.proxyManager && this.currentProxy?.id && attempt < 2) {
              this.log(`🔄 Smart switch: Post fetch too slow (${(elapsed / 1000).toFixed(1)}s), switching proxy immediately`, 'warn', {
                postId,
                elapsed: `${(elapsed / 1000).toFixed(1)}s`,
                attempt: attempt + 1,
                previousProxy: this.currentProxy.id,
                reason: 'slow_response_8s',
              });

              // Abort current request
              this.abortController.abort();
              requestAborted = true;

              // Mark proxy as failed and switch
              this.proxyManager.markProxyFailed(this.currentProxy.id, `Slow response: ${(elapsed / 1000).toFixed(1)}s`);
              const switched = this.switchToNextProxy(`Slow response: ${(elapsed / 1000).toFixed(1)}s`);

              if (switched) {
                this.log(`✅ Smart switch completed, ready for retry with new proxy`, 'info', {
                  newProxy: this.currentProxy?.id,
                });
              }
            } else if (attempt >= 2) {
              // On last attempt (attempt=2, which is 3/3), just abort - no more retries
              // But wait a bit longer (15s) before giving up on last attempt
            }
          }
        }, 8000); // Switch after 8 seconds
        timeoutWarnings.push(smartSwitchTimeout);

        // 15s: Last attempt timeout - if on last attempt and still pending, abort
        const lastAttemptTimeout = setTimeout(() => {
          if (attempt >= 2 && !requestAborted) {
            const elapsed = Date.now() - fetchStartTime;
            timeoutWarnings.forEach(timeout => clearTimeout(timeout));
            
            this.log(`⏱️ Last attempt timeout (${(elapsed / 1000).toFixed(1)}s), giving up on this post`, 'warn', {
              postId,
              elapsed: `${(elapsed / 1000).toFixed(1)}s`,
              attempt: attempt + 1,
              proxyId: this.currentProxy?.id,
              reason: 'last_attempt_timeout_15s',
            });

            this.abortController.abort();
            requestAborted = true;
          }
        }, 15000); // Give up after 15s on last attempt
        timeoutWarnings.push(lastAttemptTimeout);

        let response;
        try {
          response = await this.client.get<RedditThing[]>(jsonUrl);
          // Clear all timeout warnings on success
          timeoutWarnings.forEach(timeout => clearTimeout(timeout));
        } catch (error: any) {
          // Clear all timeout warnings on error
          timeoutWarnings.forEach(timeout => clearTimeout(timeout));

          // If aborted due to smart switch, retry with new proxy
          const isAborted = error.name === 'AbortError' ||
                           error.name === 'CanceledError' ||
                           error.code === 'ERR_CANCELED';

          if (isAborted && this.proxyManager && attempt < 2) {
            this.log(`🔄 Retrying with new proxy after smart switch (attempt ${attempt + 2}/3)`, 'info', {
              postId,
              attempt: attempt + 2,
              reason: 'smart_switch_retry',
              errorName: error.name,
              errorCode: error.code,
            });
            continue; // Retry with new proxy
          }

          throw error;
        }

        const fetchDuration = Date.now() - fetchStartTime;

        this.log(`HTTP GET completed`, 'info', {
          status: response.status,
          duration: `${fetchDuration}ms`,
          dataLength: Array.isArray(response.data) ? response.data.length : 'N/A',
        });

        // 🔥 Handle 403 in try block - axios considers it 'success' due to validateStatus
        // This is the REAL fix - 403 responses don't go to catch block!
        if (response.status === 403) {
          this.log(`🛑 Proxy blocked (403 in response)`, 'warn', {
            postId,
            proxyId: this.currentProxy?.id,
            attempt: attempt + 1,
            responseStatus: response.status,
          });

          // Mark proxy as failed and switch
          if (this.proxyManager && this.currentProxy?.id && attempt < 2) {
            this.proxyManager.markProxyFailed(this.currentProxy.id, '403 Forbidden - IP blocked by Reddit');
            const switched = this.switchToNextProxy('403 Forbidden');
            if (switched) {
              this.log(`🔄 Switching proxy after 403 (attempt ${attempt + 2}/3)`, 'info', {
                postId,
                attempt: attempt + 2,
                newProxy: this.currentProxy?.id,
              });
              continue; // Retry with new proxy
            }
          }
          throw new Error(`Access forbidden (403): ${postUrl}`);
        }

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers['retry-after'] || '60', 10);
          if (attempt < 2) {
            this.log(`Rate limited. Waiting ${retryAfter}s...`, 'warn');
            await this.delay(retryAfter * 1000);
            continue;
          }
          throw new Error('Rate limited');
        }

        if (!Array.isArray(response.data) || response.data.length < 1) {
          throw new Error('Invalid response format');
        }

        const postListing = response.data[0] as RedditListing;
        const commentListing = response.data[1] as RedditListing;

        if (!postListing?.data?.children?.length) {
          throw new Error('Post not found');
        }

        const postThing = postListing.data.children[0];
        if (postThing.kind !== 't3') {
          throw new Error('Invalid post format');
        }

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

              if (c.replies && typeof c.replies === 'object' && c.replies.kind === 'Listing') {
                processComments(c.replies as RedditListing);
              }
            }
          }
        };

        if (commentListing) {
          processComments(commentListing);
        }

        this.log(`✓ Fetched post ${postId} (${comments.length} comments)`);

        // Mark proxy as successful if using proxy
        if (this.proxyManager && this.currentProxy?.id) {
          this.proxyManager.markProxySuccess(this.currentProxy.id);
        }

        return { post, comments };
      } catch (error: any) {
        const fetchDuration = Date.now() - fetchStartTime;
        await this.checkCancel();

        const errorDetails = {
          attempt: attempt + 1,
          totalAttempts: 3,
          duration: `${fetchDuration}ms`,
          name: error.name,
          code: error.code,
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: jsonUrl,
          postId,
          timeout: error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT',
          networkError: error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED',
        };

        this.log(`Post fetch attempt ${attempt + 1} failed`, 'error', errorDetails);

        // Check if aborted due to smart switch - if so, retry with new proxy
        const isAborted = error.name === 'AbortError' ||
                         error.name === 'CanceledError' ||
                         error.code === 'ERR_CANCELED';

        if (isAborted && this.proxyManager && attempt < 2) {
          this.log(`🔄 Retrying with new proxy after smart switch (attempt ${attempt + 2}/3)`, 'info', {
            postId,
            attempt: attempt + 2,
            reason: 'smart_switch_retry',
            errorName: error.name,
            errorCode: error.code,
          });
          continue; // Retry with new proxy
        }

        if (isAborted) {
          this.log('Post fetch was cancelled/aborted', 'warn', { postId });
          throw new Error('Request cancelled');
        }

        const status = error.response?.status;
        if (status === 404) {
          this.log(`Post not found (404)`, 'error', { postUrl, postId, attempt: attempt + 1 });
          throw new Error(`Post not found: ${postUrl}`);
        }
        if (status === 403) {
          // 403 often means the proxy IP is blocked by Reddit - try switching proxy!
          this.log(`🛑 Access forbidden (403) - proxy likely blocked`, 'warn', {
            postUrl,
            postId,
            attempt: attempt + 1,
            proxyId: this.currentProxy?.id,
            possibleReasons: ['Proxy IP blocked by Reddit', 'Rate limited', 'Post removed', 'Private subreddit'],
          });

          // Mark current proxy as failed and try switching
          if (this.proxyManager && this.currentProxy?.id && attempt < 2) {
            this.proxyManager.markProxyFailed(this.currentProxy.id, '403 Forbidden - IP likely blocked');
            const switched = this.switchToNextProxy('403 Forbidden');
            if (switched) {
              this.log(`🔄 Switching proxy after 403 (attempt ${attempt + 2}/3)`, 'info', {
                postId,
                attempt: attempt + 2,
                reason: '403_forbidden',
                newProxy: this.currentProxy?.id,
              });
              continue; // Retry with new proxy
            }
          }

          // If no proxy manager or can't switch, throw the error
          throw new Error(`Access forbidden: ${postUrl}`);
        }
        if (status === 407) {
          // Proxy Authentication Required - try switching proxy
          this.log(`❌ Proxy authentication failed (407)`, 'error', {
            proxyId: this.currentProxy?.id,
            proxyHost: this.currentProxy?.host,
            proxyPort: this.currentProxy?.port,
            hasAuth: !!(this.currentProxy?.username && this.currentProxy?.password),
            postId,
            attempt: attempt + 1,
            responseBody: error?.response?.data ? String(error.response.data).substring(0, 200) : null,
          });

          // Mark current proxy as failed
          if (this.proxyManager && this.currentProxy?.id) {
            this.proxyManager.markProxyFailed(this.currentProxy.id, '407 Proxy Authentication Required');
          }

          // Try switching proxy if available
          if (this.proxyManager && attempt < 2) {
            const switched = this.switchToNextProxy('407 Proxy Authentication Required');
            if (switched) {
              this.log(`🔄 Retrying with new proxy after auth failure (attempt ${attempt + 2}/3)`, 'info', {
                postId,
                attempt: attempt + 2,
                reason: 'proxy_auth_failed',
                previousProxy: this.currentProxy?.id,
              });
              continue; // Retry with new proxy
            }
          }

          throw new Error(`Proxy authentication failed (407): ${error?.response?.data || error.message}`);
        }

        // Network/timeout errors - try switching proxy
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          this.log(`Request timeout (${error.code})`, 'error', {
            timeout: error.config?.timeout,
            duration: fetchDuration,
            attempt: attempt + 1,
          });

          // Auto-switch proxy on timeout if available
          if (this.proxyManager && this.currentProxy?.id && attempt < 2) {
            const switched = this.switchToNextProxy(`Timeout after ${(fetchDuration / 1000).toFixed(1)}s`);
            if (switched) {
              this.log(`🔄 Retrying with new proxy (attempt ${attempt + 2}/3)`, 'info', {
                postId,
                attempt: attempt + 2,
              });
              continue; // Retry with new proxy
            }
          }
        }

        // Network errors - try switching proxy
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          if (this.proxyManager && this.currentProxy?.id && attempt < 2) {
            const switched = this.switchToNextProxy(`Network error: ${error.code}`);
            if (switched) {
              this.log(`🔄 Retrying with new proxy after network error (attempt ${attempt + 2}/3)`, 'info', {
                postId,
                attempt: attempt + 2,
                errorCode: error.code,
              });
              continue; // Retry with new proxy
            }
          }
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          this.log(`Network error (${error.code})`, 'error', {
            code: error.code,
            message: error.message,
            attempt: attempt + 1,
            possibleReasons: ['DNS failure', 'Server unreachable', 'Proxy issue'],
          });
        }

        if (attempt < 2) {
          const retryDelay = 2000 * (attempt + 1);
          this.log(`Retrying in ${retryDelay}ms... (attempt ${attempt + 1}/3)`, 'warn', {
            error: error.message,
            retryDelay,
            nextAttempt: attempt + 2,
          });
          await this.delay(retryDelay);
          this.log(`Retry delay completed, attempting again...`, 'info');
          continue;
        }

        this.log(`All retry attempts exhausted`, 'error', {
          postId,
          totalAttempts: 3,
          lastError: error.message,
        });
        throw error;
      }
    }

    throw new Error('Failed to fetch post after retries');
  }

  /**
   * Scrape subreddit
   */
  async scrapeSubreddit(
    subreddit: string,
    limit: number,
    sort: 'hot' | 'new' | 'top' = 'hot',
  ): Promise<RedditScraperResult> {
    const scrapeStartTime = Date.now();
    await this.checkCancel();

    this.log(`Starting scrape: r/${subreddit} (limit: ${limit}, sort: ${sort})`, 'info', {
      subreddit,
      limit,
      sort,
      timestamp: new Date().toISOString(),
    });

    try {
      // Step 1: Fetch post list
      this.log(`Step 1: Fetching post list...`, 'info', {
        subreddit,
        limit,
        sort,
      });
      const listFetchStartTime = Date.now();
      const postUrls = await this.fetchPostList(subreddit, limit, sort);
      const listFetchDuration = Date.now() - listFetchStartTime;

      this.log(`Step 1 completed: Fetched ${postUrls.length} post URLs`, 'info', {
        duration: `${(listFetchDuration / 1000).toFixed(1)}s`,
        postCount: postUrls.length,
      });

      if (postUrls.length === 0) {
        this.log(`No posts found for subreddit`, 'error', {
          subreddit,
          possibleReasons: [
            'Subreddit does not exist',
            'Subreddit is private/banned',
            'Network/proxy issues',
            'Reddit API rate limiting',
            'Invalid subreddit name',
          ],
        });
        return {
          status: 'error',
          message: `No posts found for r/${subreddit}`,
        };
      }

      this.log(`Step 2: Starting to fetch post details...`, 'info', {
        totalPosts: postUrls.length,
        estimatedTime: `${(postUrls.length * 3 / 60).toFixed(1)} minutes (assuming 3s per post)`,
      });

      // Step 2: Fetch posts serially (for better cancellation)
      const posts: Array<{ post: RedditPost; comments: FlattenedComment[] }> = [];
      const detailsFetchStartTime = Date.now();

      const processingStartTime = Date.now();
      for (let i = 0; i < postUrls.length; i++) {
        const postStartTime = Date.now();
        await this.checkCancel();

        const { url, id } = postUrls[i];
        this.log(`[${i + 1}/${postUrls.length}] Starting to process post`, 'info', {
          postId: id,
          url,
          progress: `${i + 1}/${postUrls.length}`,
          successCount: posts.length,
          elapsedTime: `${((Date.now() - processingStartTime) / 1000).toFixed(1)}s`,
        });

        try {
          const fetchStartTime = Date.now();
          const result = await this.fetchPost(url);
          const fetchDuration = Date.now() - fetchStartTime;

          posts.push(result);

          this.emitProgress(posts.length, postUrls.length, `Scraped ${posts.length}/${postUrls.length} posts`);
          this.log(`✓ [${i + 1}/${postUrls.length}] Post processed successfully`, 'info', {
            postId: id,
            comments: result.comments.length,
            fetchDuration: `${fetchDuration}ms`,
            totalSuccess: posts.length,
            totalFailed: i + 1 - posts.length,
          });
        } catch (error: any) {
          const errorDuration = Date.now() - postStartTime;
          this.log(`✗ [${i + 1}/${postUrls.length}] Post processing failed`, 'warn', {
            postId: id,
            url,
            error: error.message,
            errorType: error.name || error.code || 'Unknown',
            duration: `${errorDuration}ms`,
            successCount: posts.length,
            failedCount: i + 1 - posts.length,
            willContinue: true,
          });
          // Continue with next post
        }

        if (i < postUrls.length - 1) {
          const delayMs = 3000;
          this.log(`Waiting ${delayMs}ms before next post...`, 'info', {
            current: i + 1,
            total: postUrls.length,
            nextPostId: postUrls[i + 1]?.id,
          });
          await this.delay(delayMs);
          this.log(`Delay completed, proceeding to next post`, 'info');
        }
      }

      const totalProcessingTime = Date.now() - processingStartTime;
      this.log(`All posts processing completed`, 'info', {
        totalPosts: postUrls.length,
        successCount: posts.length,
        failedCount: postUrls.length - posts.length,
        successRate: `${((posts.length / postUrls.length) * 100).toFixed(1)}%`,
        totalTime: `${(totalProcessingTime / 1000).toFixed(1)}s`,
        avgTimePerPost: `${(totalProcessingTime / postUrls.length / 1000).toFixed(2)}s`,
      });

      this.log(`Scraped ${posts.length} posts successfully`);

      return {
        status: 'success',
        posts,
        scrapedCount: posts.length,
        totalPosts: postUrls.length,
      };
    } catch (error: any) {
      const message = error.message || 'Unknown error';
      this.log(`Scrape failed: ${message}`, 'error');
      return {
        status: 'error',
        message,
      };
    }
  }

  /**
   * Scrape single post
   */
  async scrapePost(postUrl: string): Promise<RedditScraperResult> {
    await this.checkCancel();

    this.log(`Scraping post: ${postUrl}`);

    try {
      const result = await this.fetchPost(postUrl);
      return {
        status: 'success',
        post: result.post,
        comments: result.comments,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.message || 'Failed to scrape post',
      };
    }
  }
}
