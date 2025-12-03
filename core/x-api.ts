import { Protocol } from 'puppeteer';
import { XClIdGen } from './xclid';
import {
    X_API_BEARER_TOKEN,
    X_API_OPS,
    X_API_SEARCH_HEADERS,
    X_API_FEATURES_TIMELINE,
    X_API_FEATURES_USER_DETAILS
} from '../config/constants';
import { ScraperErrors } from './errors';
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY_MS = 1000;
const RETRY_BACKOFF = 2;

export class XApiClient {
    private cookies: Protocol.Network.CookieParam[];
    private headers: Record<string, string>;
    private xclidGen?: XClIdGen;
    private searchQueryId: string = X_API_OPS.SearchTimeline.queryId;

    constructor(cookies: Protocol.Network.CookieParam[]) {
        this.cookies = cookies;
        this.headers = this.buildHeaders();
    }

    private buildHeaders(): Record<string, string> {
        const cookieStr = this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const ct0 = this.cookies.find(c => c.name === 'ct0')?.value || '';

        return {
            'authorization': X_API_BEARER_TOKEN,
            'x-csrf-token': ct0,
            'cookie': cookieStr,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        };
    }

    /**
     * Generate a fresh x-client-transaction-id for SearchTimeline requests.
     * The server expects this to change per request; using a static captured
     * value causes paginated calls to start failing with 404s.
     */
    private async getXClientTransactionId(path: string): Promise<string | undefined> {
        const cookieStr = this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
        try {
            // Build generator once; calc() returns a new value every call
            this.xclidGen = this.xclidGen || (await XClIdGen.create(cookieStr, this.headers['user-agent']));
            return this.xclidGen.calc('GET', path);
        } catch {
            // Fallback to captured static header if generation fails
            return X_API_SEARCH_HEADERS.clid;
        }
    }

    private async request(op: typeof X_API_OPS.UserTweets | typeof X_API_OPS.SearchTimeline | typeof X_API_OPS.UserByScreenName | typeof X_API_OPS.TweetDetail | typeof X_API_OPS.TweetResultsByRestIds | typeof X_API_OPS.TweetResultByRestId, variables: any) {
        let delay = RETRY_INITIAL_DELAY_MS;

        for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
            try {
                return await this.performRequest(op, variables);
            } catch (error: any) {
                if (this.isRateLimitError(error)) {
                    throw error;
                }

                const isNetworkError = this.isNetworkError(error);
                const isTransientApiError = this.isTransientApiError(error);

                if (attempt < RETRY_MAX_ATTEMPTS && (isNetworkError || isTransientApiError)) {
                    console.warn(`[Retry] XApiClient request failed (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS + 1}): ${error?.message || 'Unknown error'}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= RETRY_BACKOFF;
                    continue;
                }

                throw error;
            }
        }

        throw ScraperErrors.apiRequestFailed('Request failed after maximum retry attempts', undefined, { operation: op.operationName });
    }

    private async requestRest(url: string) {
        let delay = RETRY_INITIAL_DELAY_MS;

        for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
            try {
                return await this.performRestRequest(url);
            } catch (error: any) {
                if (this.isRateLimitError(error)) {
                    throw error;
                }

                const isNetworkError = this.isNetworkError(error);
                const isTransientApiError = this.isTransientApiError(error);

                if (attempt < RETRY_MAX_ATTEMPTS && (isNetworkError || isTransientApiError)) {
                    console.warn(`[Retry] REST request failed (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS + 1}): ${error?.message || 'Unknown error'}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= RETRY_BACKOFF;
                    continue;
                }

                throw error;
            }
        }

        throw ScraperErrors.apiRequestFailed('REST request failed after maximum retry attempts');
    }

    private isNetworkError(error: any): boolean {
        const message = (error?.message || '').toLowerCase();
        return message.includes('network') || message.includes('timeout') || message.includes('econnreset') || message.includes('fetch failed');
    }

    private isTransientApiError(error: any): boolean {
        const status = error?.status ?? error?.statusCode;
        return status === 500 || status === 502 || status === 503;
    }

    private isRateLimitError(error: any): boolean {
        if (!error) return false;
        const message = (error.message || '').toLowerCase();
        const status = error.status ?? error.statusCode;
        const code = error.code;
        return status === 429 ||
            message.includes('429') ||
            message.includes('rate limit') ||
            code === 'RATE_LIMIT' ||
            code === 'RATE_LIMIT_EXCEEDED';
    }

    private async performRequest(op: typeof X_API_OPS.UserTweets | typeof X_API_OPS.SearchTimeline | typeof X_API_OPS.UserByScreenName | typeof X_API_OPS.TweetDetail | typeof X_API_OPS.TweetResultsByRestIds | typeof X_API_OPS.TweetResultByRestId, variables: any) {
        const queryId = op.operationName === 'SearchTimeline' ? this.searchQueryId : op.queryId;
        const url = `https://x.com/i/api/graphql/${queryId}/${op.operationName}`;
        
        let features = X_API_FEATURES_TIMELINE;
        if (op.operationName === 'UserByScreenName') {
            features = X_API_FEATURES_USER_DETAILS as any;
        }

        const searchParams: Record<string, string> = {
            variables: JSON.stringify(variables),
            features: JSON.stringify(features)
        };

        const params = new URLSearchParams(searchParams);

        const fullUrl = `${url}?${params.toString()}`;

        const headers: Record<string, string> = {
            ...this.headers,
            'x-twitter-auth-type': 'OAuth2Session'
        };
        // Add anti-bot headers for SearchTimeline
        const path = `/i/api/graphql/${queryId}/${op.operationName}`;
        if (op.operationName === 'SearchTimeline') {
            const isCursorRequest = !!variables.cursor;
            const xclid = isCursorRequest
                ? await this.getXClientTransactionId(path)
                : X_API_SEARCH_HEADERS.clid;
            headers['x-client-transaction-id'] = xclid || X_API_SEARCH_HEADERS.clid;
            headers['x-xp-forwarded-for'] = X_API_SEARCH_HEADERS.xpf;
            headers['sec-ch-ua'] = X_API_SEARCH_HEADERS.secChUa;
            headers['sec-ch-ua-mobile'] = X_API_SEARCH_HEADERS.secChUaMobile;
            headers['sec-ch-ua-platform'] = X_API_SEARCH_HEADERS.secChUaPlatform;
            headers['accept-language'] = X_API_SEARCH_HEADERS.acceptLanguage;
            headers['x-twitter-client-language'] = X_API_SEARCH_HEADERS.clientLanguage;
            headers['referer'] = `${X_API_SEARCH_HEADERS.refererBase}${encodeURIComponent(variables.rawQuery || '')}&src=typed_query`;
            headers['accept'] = '*/*';
        }

        const response = await fetch(fullUrl, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            if (response.status === 429) {
                throw ScraperErrors.rateLimitExceeded();
            }
            if (response.status === 401 || response.status === 403) {
                throw ScraperErrors.authenticationFailed(`Authentication failed (${response.status})`, response.status);
            }
            throw ScraperErrors.apiRequestFailed(
                `API request failed: ${response.status} ${response.statusText}`,
                response.status,
                { operation: op.operationName, url }
            );
        }

        return response.json();
    }

    /**
     * Perform REST API v1.1 request
     * 
     * ⚠️ WARNING: REST API v1.1 endpoints return 404 with web cookie authentication.
     * This method is kept for potential future OAuth support.
     * 
     * @private
     * @param url Full REST API endpoint URL
     * @returns API response (will likely throw 404 error)
     */
    private async performRestRequest(url: string) {
        // Use same headers as GraphQL (already has Bearer Token, CSRF, Cookie)
        // Note: REST API v1.1 requires OAuth, web cookies alone are insufficient
        const headers: Record<string, string> = {
            ...this.headers,
            'accept': 'application/json'
        };

        const response = await fetch(url, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            if (response.status === 429) {
                throw ScraperErrors.rateLimitExceeded();
            }
            if (response.status === 401 || response.status === 403) {
                throw ScraperErrors.authenticationFailed(`Authentication failed (${response.status})`, response.status);
            }
            throw ScraperErrors.apiRequestFailed(
                `REST API request failed: ${response.status} ${response.statusText}`,
                response.status,
                { operation: 'REST', url }
            );
        }

        return response.json();
    }

    async getUserByScreenName(screenName: string): Promise<string | null> {
        try {
            const data = await this.request(X_API_OPS.UserByScreenName, {
                screen_name: screenName,
                withGrokTranslatedBio: false
            });
            const userId = data?.data?.user?.result?.rest_id;
            if (!userId) {
                throw ScraperErrors.userNotFound(screenName);
            }
            return userId;
        } catch (error) {
            // 如果是 ScraperError，直接抛出
            if (error instanceof Error && 'code' in error) {
                throw error;
            }
            // 否则包装为 ScraperError
            throw ScraperErrors.apiRequestFailed(
                `Failed to get user ID for ${screenName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                undefined,
                { screenName }
            );
        }
    }

    async getUserTweets(userId: string, count: number = 40, cursor?: string) {
        const variables: any = {
            userId,
            count,
            includePromotedContent: true,
            withQuickPromoteEligibilityTweetFields: true,
            withVoice: true
        };
        
        if (cursor) {
            variables.cursor = cursor;
        }

        return this.request(X_API_OPS.UserTweets, variables);
    }

    /**
     * Get user timeline using REST API v1.1
     * 
     * ⚠️ **WARNING: This endpoint does NOT work with web cookie authentication.**
     * 
     * Twitter's REST API v1.1 requires OAuth 1.0a tokens from a Twitter Developer Account.
     * Web cookies (used by default in this scraper) will result in 404 errors.
     * 
     * **For normal web-based scraping, use GraphQL API instead (default).**
     * 
     * This method is kept for:
     * - Future OAuth implementation
     * - Reference implementation of max_id pagination
     * - Testing purposes
     * 
     * @deprecated Use GraphQL API unless you have OAuth tokens
     * @see https://developer.twitter.com/en/docs/authentication
     * @param screenName Twitter username (without @)
     * @param options Timeline options including pagination parameters
     * @returns Promise resolving to array of tweet objects (will likely fail with 404)
     */
    async getUserTimelineRest(
        screenName: string,
        options: {
            count?: number;
            maxId?: string;
            sinceId?: string;
            includeRts?: boolean;
            excludeReplies?: boolean;
        } = {}
    ) {
        const params = new URLSearchParams();
        params.set('screen_name', screenName);
        const count = Math.min(Math.max(options.count ?? 200, 1), 200);
        params.set('count', String(count));
        params.set('tweet_mode', 'extended'); // ensure full_text

        if (options.maxId) params.set('max_id', options.maxId);
        if (options.sinceId) params.set('since_id', options.sinceId);
        if (options.includeRts !== undefined) {
            params.set('include_rts', options.includeRts ? '1' : '0');
        }
        if (options.excludeReplies !== undefined) {
            params.set('exclude_replies', options.excludeReplies ? 'true' : 'false');
        }

        const url = `https://api.twitter.com/1.1/statuses/user_timeline.json?${params.toString()}`;
        return this.requestRest(url);
    }

    async searchTweets(query: string, count: number = 20, cursor?: string) {
        const variables: any = {
            rawQuery: query,
            count,
            querySource: "typed_query",
            product: "Top",
            withGrokTranslatedBio: false
        };
        
        if (cursor) {
            variables.cursor = cursor;
        }

        return await this.request(X_API_OPS.SearchTimeline, variables);
    }

    /**
     * 获取推文详情 (Conversation View)
     * 用于 Thread 模式，包含完整的对话树
     * @param tweetId 推文 ID
     * @param cursor 可选的分页游标（用于获取更多回复）
     */
    async getTweetDetail(tweetId: string, cursor?: string) {
        const variables: any = {
            focalTweetId: tweetId, // Updated to focalTweetId for TweetDetail (conversation)
            includePromotedContent: true,
            withBirdwatchNotes: true,
            withVoice: true,
            withCommunity: true,
            // Additional variables often required for TweetDetail
            referrer: "tweet",
            controller_data: "DAACDAABDAABCgABAAAAAAAAAAgAAgAAAAA=",
        };
        
        // Add cursor if provided (for paginated replies)
        if (cursor) {
            variables.cursor = cursor;
        }

        return this.request(X_API_OPS.TweetDetail, variables);
    }

    /**
     * 获取单条推文详情 (Single Tweet View)
     * 用于批量查询或简单获取推文信息
     * @param tweetId 推文 ID
     */
    async getTweetResult(tweetId: string) {
        const variables: any = {
            tweetId: tweetId,
            includePromotedContent: true,
            withBirdwatchNotes: true,
            withVoice: true,
            withCommunity: true
        };

        return this.request(X_API_OPS.TweetResultByRestId, variables);
    }

    /**
     * 批量获取推文详情 (使用并发查询实现)
     * 
     * 由于 TweetResultsByRestIds 批量端点的 Query ID 难以获取/过期，
     * 我们使用并发的单条查询来实现批量效果
     * 
     * @param tweet_ids 推文 ID 列表
     * @param concurrency 并发数量，默认 5
     */
    async getTweetsByIds(tweet_ids: string[], concurrency: number = 5): Promise<any[]> {
        const results: any[] = [];
        
        // Process in batches for controlled concurrency
        for (let i = 0; i < tweet_ids.length; i += concurrency) {
            const batch = tweet_ids.slice(i, i + concurrency);
            const batchPromises = batch.map(id => 
                this.getTweetResult(id).catch(err => {
                    console.error(`Failed to fetch tweet ${id}:`, err.message);
                    return null; // Return null for failed requests
                })
            );
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(r => r !== null));
        }

        return results;
    }

    private async searchTweetsViaBrowser(query: string, count: number = 20) {
        // Deprecated fallback: should rarely be used once x-client-transaction-id generation works.
        throw ScraperErrors.invalidConfiguration('SearchTimeline fallback to browser is disabled');
    }
}
