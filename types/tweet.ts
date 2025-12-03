/**
 * 统一的 Tweet 类型定义
 * 所有模块应使用此类型，确保一致性
 */

/**
 * 推文必需字段
 */
export interface TweetRequired {
    /** 推文唯一 ID */
    id: string;
    
    /** 推文 URL */
    url: string;
    
    /** 推文文本内容 */
    text: string;
}

/**
 * 推文可选字段
 */
export interface TweetOptional {
    /** 发布时间 (ISO 8601 格式) */
    time?: string;
    
    /** 点赞数 */
    likes?: number;
    
    /** 转发数 */
    retweets?: number;
    
    /** 回复数 */
    replies?: number;
    
    /** 是否包含媒体（图片/视频） */
    hasMedia?: boolean;
    
    /** 用户名 (不含 @) */
    username?: string;
    
    /** 用户 ID */
    userId?: string;
    
    /** 用户显示名称 */
    userDisplayName?: string;
    
    /** 用户头像 URL */
    userAvatar?: string;
    
    /** 推文语言 */
    lang?: string;
    
    /** 浏览量 */
    views?: number | string;
    
    /** 是否为回复 */
    isReply?: boolean;
    
    /** 引用的推文内容 */
    quotedContent?: string | null;
    
    /** 是否为用户点赞的推文 */
    isLiked?: boolean;
}

/**
 * 推文数据接口（必需字段 + 可选字段）
 */
export interface Tweet extends TweetRequired, TweetOptional {
    /** 允许额外字段以保持向后兼容 */
    [key: string]: any;
}

/**
 * 类型守卫：检查 Tweet 是否包含必需字段
 */
export function isValidTweet(tweet: any): tweet is Tweet {
    return (
        typeof tweet === 'object' &&
        tweet !== null &&
        typeof tweet.id === 'string' &&
        tweet.id.length > 0 &&
        typeof tweet.url === 'string' &&
        tweet.url.length > 0 &&
        typeof tweet.text === 'string'
    );
}

/**
 * 验证并清理 Tweet 数据
 */
export function validateTweet(tweet: any): Tweet | null {
    if (!isValidTweet(tweet)) {
        return null;
    }
    
    // 确保必需字段存在
    return {
        id: String(tweet.id),
        url: String(tweet.url),
        text: String(tweet.text),
        ...(tweet.time && { time: String(tweet.time) }),
        ...(typeof tweet.likes === 'number' && { likes: tweet.likes }),
        ...(typeof tweet.retweets === 'number' && { retweets: tweet.retweets }),
        ...(typeof tweet.replies === 'number' && { replies: tweet.replies }),
        ...(typeof tweet.hasMedia === 'boolean' && { hasMedia: tweet.hasMedia }),
        ...(tweet.username && { username: String(tweet.username) }),
        ...(tweet.userId && { userId: String(tweet.userId) }),
        ...(tweet.userDisplayName && { userDisplayName: String(tweet.userDisplayName) }),
        ...(tweet.userAvatar && { userAvatar: String(tweet.userAvatar) }),
        ...(tweet.lang && { lang: String(tweet.lang) }),
        ...(tweet.views !== undefined && { views: tweet.views }),
        ...(typeof tweet.isReply === 'boolean' && { isReply: tweet.isReply }),
        ...(tweet.quotedContent !== undefined && { quotedContent: tweet.quotedContent }),
        ...(typeof tweet.isLiked === 'boolean' && { isLiked: tweet.isLiked })
    };
}

/**
 * 用户资料信息
 */
export interface ProfileInfo {
    displayName: string | null;
    handle: string | null;
    bio: string | null;
    location: string | null;
    website: string | null;
    joined: string | null;
    followers: number | null;
    following: number | null;
}

/**
 * 从 DOM 提取的原始推文数据
 * 用于 data-extractor.ts 的内部使用
 */
export interface RawTweetData {
    text: string;
    time: string;
    url: string;
    id: string;
    author: string;
    likes: number;
    retweets: number;
    replies: number;
    hasMedia: boolean;
    isReply: boolean;
    quotedContent: string | null;
}

/**
 * 将原始推文数据转换为统一的 Tweet 格式
 */
export function normalizeRawTweet(raw: RawTweetData): Tweet {
    return {
        id: raw.id,
        url: raw.url,
        text: raw.text,
        time: raw.time,
        likes: raw.likes,
        retweets: raw.retweets,
        replies: raw.replies,
        hasMedia: raw.hasMedia,
        username: raw.author,
        isReply: raw.isReply,
        quotedContent: raw.quotedContent
    };
}

/**
 * API 响应中的推文结果结构
 */
export interface TweetResult {
    legacy?: any;
    tweet?: { legacy?: any; core?: any };
    core?: any;
    views?: { count?: number | string };
    rest_id?: string;
    note_tweet?: { note_tweet_results?: { result?: { text?: string } } };
}

/**
 * 从 API 响应解析推文
 */
export function parseTweetFromApiResult(result: TweetResult, fallbackUsername?: string): Tweet | null {
    try {
        const legacy = result.legacy || result.tweet?.legacy;
        const core = result.core || result.tweet?.core;
        
        if (!legacy) return null;

        const user = core?.user_results?.result?.legacy;
        let username = user?.screen_name || 'unknown';
        
        // Use fallback username if available and username is unknown
        if (username === 'unknown' && fallbackUsername) {
            username = fallbackUsername;
        }

        const tweetId = legacy.id_str || result.rest_id;

        // 优先获取长推文文本
        const noteText = result.note_tweet?.note_tweet_results?.result?.text;
        const text = noteText || legacy.full_text || '';

        return {
            id: tweetId,
            url: `https://x.com/${username}/status/${tweetId}`,
            text,
            time: new Date(legacy.created_at).toISOString(),
            likes: legacy.favorite_count || 0,
            retweets: legacy.retweet_count || 0,
            replies: legacy.reply_count || 0,
            hasMedia: !!legacy.extended_entities?.media?.length,
            username: username,
            userId: user?.rest_id,
            userDisplayName: user?.name,
            userAvatar: user?.profile_image_url_https,
            lang: legacy.lang,
            views: result.views?.count
        };
    } catch (e) {
        return null;
    }
}

/**
 * 从 v1.1 REST API 的状态对象解析推文
 * 依赖 tweet_mode=extended 返回的 full_text，适合 max_id 翻页
 */
export function parseTweetFromRestStatus(status: any, fallbackUsername?: string): Tweet | null {
    if (!status || (!status.id_str && !status.id)) return null;

    const username = status.user?.screen_name || fallbackUsername || 'unknown';
    const text =
        status.full_text ||
        status.extended_tweet?.full_text ||
        status.text ||
        '';

    const tweetId = status.id_str || String(status.id);
    const createdAt = status.created_at
        ? new Date(status.created_at).toISOString()
        : undefined;

    return {
        id: tweetId,
        url: `https://x.com/${username}/status/${tweetId}`,
        text,
        time: createdAt,
        likes: status.favorite_count ?? 0,
        retweets: status.retweet_count ?? 0,
        replies: status.reply_count ?? 0,
        hasMedia: Boolean(
            status.extended_entities?.media?.length || status.entities?.media?.length
        ),
        username,
        userId: status.user?.id_str,
        userDisplayName: status.user?.name,
        userAvatar: status.user?.profile_image_url_https,
        lang: status.lang,
        isReply: Boolean(status.in_reply_to_status_id_str)
    };
}

/**
 * 从 API 指令中解析推文列表
 */
export function parseTweetsFromInstructions(instructions: any[], fallbackUsername?: string): Tweet[] {
    const tweets: Tweet[] = [];

    for (const instruction of instructions) {
        if (instruction?.type !== 'TimelineAddEntries' || !Array.isArray(instruction.entries)) {
            continue;
        }
        
        for (const entry of instruction.entries) {
            if (!entry?.entryId || !String(entry.entryId).startsWith('tweet-')) {
                continue;
            }
            
            const tweetResult = entry.content?.itemContent?.tweet_results?.result;
            if (!tweetResult) continue;
            
            // Pass fallbackUsername to ensure URL is generated correctly
            const tweet = parseTweetFromApiResult(tweetResult, fallbackUsername);
            if (tweet) {
                tweets.push(tweet);
            }
        }
    }
    
    return tweets;
}

/**
 * 从 API 响应中提取 instructions
 */
export function extractInstructionsFromResponse(data: any): any[] {
    // 支持多种 API 响应结构
    return data?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
           data?.data?.user?.result?.timeline?.timeline?.instructions ||
           data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
           [];
}

/**
 * 从 API 响应中提取下一页游标
 */
export function extractNextCursor(instructions: any[]): string | undefined {
    for (const instruction of instructions) {
        if (instruction.type !== 'TimelineAddEntries') continue;
        
        for (const entry of instruction.entries) {
            const entryId = entry.entryId || '';
            // 优先使用 cursor-bottom（用于分页获取更早的推文）
            // cursor-top 通常用于顶部刷新，不适用于分页
            if (entryId.startsWith('cursor-bottom')) {
                const cursorValue = entry.content?.value || 
                                   entry.content?.cursorType ||
                                   entry.content?.itemContent?.value;
                if (cursorValue) {
                    return cursorValue;
                }
            }
        }
        
        // 如果没有找到 cursor-bottom，再尝试其他游标类型（作为备选）
        for (const entry of instruction.entries) {
            const entryId = entry.entryId || '';
            if (entryId.startsWith('cursor-top') || entryId.includes('cursor')) {
                const cursorValue = entry.content?.value || 
                                   entry.content?.cursorType ||
                                   entry.content?.itemContent?.value;
                if (cursorValue) {
                    return cursorValue;
                }
            }
        }
    }
    
    // 如果没有找到标准的游标，检查其他可能的响应结构
    // 有时游标可能在响应的其他地方
    for (const instruction of instructions) {
        if (instruction.type === 'TimelineAddToModule') {
            // TimelineAddToModule 可能包含游标信息
            const moduleItems = instruction.moduleItems || [];
            for (const item of moduleItems) {
                if (item.entryId?.includes('cursor')) {
                    const cursorValue = item.item?.itemContent?.value || 
                                       item.item?.itemContent?.cursorType;
                    if (cursorValue) {
                        return cursorValue;
                    }
                }
            }
        }
    }
    
    return undefined;
}

/**
 * TweetDetail API 响应的解析结果
 */
export interface TweetDetailResult {
    originalTweet: Tweet | null;
    replies: Tweet[];
    conversationTweets: Tweet[];
    nextCursor?: string;
}

/**
 * 从 TweetDetail API 响应中解析推文和回复
 */
export function parseTweetDetailResponse(data: any, focalTweetId: string): TweetDetailResult {
    const result: TweetDetailResult = {
        originalTweet: null,
        replies: [],
        conversationTweets: []
    };

    try {
        const instructions = data?.data?.tweetResult?.result?.legacy?.conversation_control?.policy
            ? [] // 受限对话
            : data?.data?.threaded_conversation_with_injections_v2?.instructions || [];

        for (const instruction of instructions) {
            if (instruction.type === 'TimelineAddEntries') {
                for (const entry of instruction.entries) {
                    const entryId = entry.entryId || '';
                    
                    // 处理主推文
                    if (entryId.startsWith('tweet-')) {
                        const tweetResult = entry.content?.itemContent?.tweet_results?.result;
                        if (tweetResult) {
                            const tweet = parseTweetFromApiResult(tweetResult);
                            if (tweet) {
                                if (tweet.id === focalTweetId) {
                                    result.originalTweet = tweet;
                                } else {
                                    result.conversationTweets.push(tweet);
                                }
                            }
                        }
                    }
                    
                    // 处理对话模块（包含回复）
                    if (entryId.startsWith('conversationthread-')) {
                        const items = entry.content?.items || [];
                        for (const item of items) {
                            const itemEntryId = item.entryId || '';
                            
                            if (itemEntryId.includes('tweet-')) {
                                const tweetResult = item.item?.itemContent?.tweet_results?.result;
                                if (tweetResult) {
                                    const tweet = parseTweetFromApiResult(tweetResult);
                                    if (tweet && tweet.id !== focalTweetId) {
                                        result.replies.push(tweet);
                                    }
                                }
                            }
                            
                            // 提取回复的下一页游标
                            if (itemEntryId.includes('cursor-showmore')) {
                                const cursorValue = item.item?.itemContent?.value;
                                if (cursorValue && !result.nextCursor) {
                                    result.nextCursor = cursorValue;
                                }
                            }
                        }
                    }
                    
                    // 底部游标
                    if (entryId.startsWith('cursor-bottom')) {
                        result.nextCursor = entry.content?.value;
                    }
                }
            }
            
            // 处理 TimelineAddToModule（更多回复）
            if (instruction.type === 'TimelineAddToModule') {
                const items = instruction.moduleItems || [];
                for (const item of items) {
                    const tweetResult = item.item?.itemContent?.tweet_results?.result;
                    if (tweetResult) {
                        const tweet = parseTweetFromApiResult(tweetResult);
                        if (tweet && tweet.id !== focalTweetId) {
                            result.replies.push(tweet);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error parsing TweetDetail response:', e);
    }

    return result;
}
