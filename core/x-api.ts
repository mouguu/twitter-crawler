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
import { RetryOnNetworkError, HandleRateLimit } from '../utils/decorators';

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

    @RetryOnNetworkError(3, 1000)
    @HandleRateLimit()
    private async request(op: typeof X_API_OPS.UserTweets | typeof X_API_OPS.SearchTimeline | typeof X_API_OPS.UserByScreenName | typeof X_API_OPS.TweetDetail, variables: any) {
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
     * 获取推文详情及其对话/回复
     * @param tweetId 推文 ID
     * @param cursor 分页游标（用于加载更多回复）
     */
    async getTweetDetail(tweetId: string, cursor?: string) {
        const variables: any = {
            focalTweetId: tweetId,
            with_rux_injections: false,
            rankingMode: "Relevance",
            includePromotedContent: true,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true
        };
        
        if (cursor) {
            variables.cursor = cursor;
            variables.referrer = "tweet";
        }

        return this.request(X_API_OPS.TweetDetail, variables);
    }

    private async searchTweetsViaBrowser(query: string, count: number = 20) {
        // Deprecated fallback: should rarely be used once x-client-transaction-id generation works.
        throw ScraperErrors.invalidConfiguration('SearchTimeline fallback to browser is disabled');
    }
}
