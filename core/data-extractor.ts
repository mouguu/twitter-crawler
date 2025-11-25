/**
 * 数据提取器
 * 负责从页面提取推文和用户资料信息
 */

import { Page } from 'puppeteer';
import * as constants from '../config/constants';

// Twitter 选择器
export const X_SELECTORS = {
    TWEET: 'article[data-testid="tweet"]',
    TWEET_TEXT: '[data-testid="tweetText"]',
    LIKE: '[data-testid="like"]',
    RETWEET: '[data-testid="retweet"]',
    REPLY: '[data-testid="reply"]',
    SHARE: '[data-testid="app-text-transition-container"]',
    TIME: 'time',
    MEDIA: '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'
};

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

export interface TweetData {
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
 * 解析计数文本（如 "1.5K" -> 1500）
 * 这个函数在 Node.js 环境中运行
 */
export function parseCount(countText: string | null | undefined): number {
    if (!countText) return 0;
    const text = countText.toLowerCase().replace(/,/g, '');

    const kMatch = text.match(/^([\d.]+)\s*k/);
    if (kMatch && !isNaN(parseFloat(kMatch[1]))) {
        return Math.round(parseFloat(kMatch[1]) * constants.COUNT_MULTIPLIER_K);
    }

    const mMatch = text.match(/^([\d.]+)\s*m/);
    if (mMatch && !isNaN(parseFloat(mMatch[1]))) {
        return Math.round(parseFloat(mMatch[1]) * constants.COUNT_MULTIPLIER_M);
    }

    if (!isNaN(parseFloat(text))) {
        return Math.round(parseFloat(text));
    }

    return 0;
}

/**
 * 从页面提取用户资料信息
 */
export async function extractProfileInfo(page: Page): Promise<ProfileInfo | null> {
    try {
        const profileInfo = await page.evaluate(() => {
            const getText = (sel: string): string | null => {
                const el = document.querySelector(sel);
                return el ? (el.textContent || '').trim() : null;
            };

            const parseCountInBrowser = (countText: string | null | undefined): number | null => {
                if (!countText) return null;
                const text = countText.toLowerCase().replace(/,/g, '').trim();
                const m = text.match(/([\d.]+)\s*([km]?)/);
                if (!m) return parseFloat(text) || 0;
                const n = parseFloat(m[1]);
                const suf = m[2];
                if (isNaN(n)) return 0;
                if (suf === 'k') return Math.round(n * 1000);
                if (suf === 'm') return Math.round(n * 1000000);
                return Math.round(n);
            };

            // 显示名与 @handle
            let displayName: string | null = null;
            let handle: string | null = null;
            const nameRoot = document.querySelector('[data-testid="UserName"]');
            if (nameRoot) {
                const span = nameRoot.querySelector('span');
                if (span) displayName = (span.textContent || '').trim();
                const a = nameRoot.querySelector('a[href^="/"]');
                if (a) handle = (a.getAttribute('href') || '').replace(/^\//, '').replace(/^@/, '');
            }

            const bio = getText('[data-testid="UserDescription"]');
            const location = getText('[data-testid="UserLocation"]');
            const joined = getText('[data-testid="UserJoinDate"]');
            let website: string | null = null;
            const urlEl = document.querySelector('[data-testid="UserUrl"] a[href]');
            if (urlEl) website = urlEl.getAttribute('href');

            let followers: number | null = null;
            let following: number | null = null;
            try {
                document.querySelectorAll('a[href*="/followers"], a[href*="/following"]').forEach(a => {
                    const href = a.getAttribute('href') || '';
                    const txt = (a.textContent || '').trim();
                    if (href.includes('/followers')) followers = parseCountInBrowser(txt);
                    if (href.includes('/following')) following = parseCountInBrowser(txt);
                });
            } catch (e) { }

            return { displayName, handle, bio, location, website, joined, followers, following };
        });

        return profileInfo;
    } catch (error: any) {
        console.warn(`Failed to extract profile info: ${error.message}`);
        return null;
    }
}

/**
 * 从页面提取所有推文
 */
export async function extractTweetsFromPage(page: Page): Promise<TweetData[]> {
    try {
        const tweetsOnPage = await page.evaluate((SELECTORS) => {
            const parseCountInBrowser = (countText: string | null | undefined): number => {
                if (!countText) return 0;
                const text = countText.toLowerCase().replace(/,/g, '');

                if (text.includes('k')) {
                    return Math.round(parseFloat(text) * 1000);
                } else if (text.includes('m')) {
                    return Math.round(parseFloat(text) * 1000000);
                } else if (!isNaN(parseFloat(text))) {
                    return Math.round(parseFloat(text));
                }

                return 0;
            };

            return Array.from(document.querySelectorAll(SELECTORS.TWEET))
                .map(article => {
                    try {
                        const textNode = article.querySelector(SELECTORS.TWEET_TEXT) as HTMLElement | null;
                        const timeNode = article.querySelector(SELECTORS.TIME) as HTMLElement | null;
                        const linkNode = timeNode?.closest('a[href*="/status/"]');

                        // 计数元素
                        const likeButton = article.querySelector(SELECTORS.LIKE);
                        const retweetButton = article.querySelector(SELECTORS.RETWEET);
                        const replyButton = article.querySelector(SELECTORS.REPLY);

                        // 计数 span
                        const likeCountSpan = likeButton?.querySelector(`${SELECTORS.SHARE} span > span`) as HTMLElement | null;
                        const retweetCountSpan = retweetButton?.querySelector(`${SELECTORS.SHARE} span > span`) as HTMLElement | null;
                        const replyCountSpan = replyButton?.querySelector(`${SELECTORS.SHARE} span > span`) as HTMLElement | null;

                        // 检查是否包含媒体
                        const hasMedia = !!article.querySelector(SELECTORS.MEDIA);

                        // 获取推文 URL
                        let tweetUrl: string | null = null;
                        if (linkNode) {
                            const href = linkNode.getAttribute('href');
                            if (href && href.includes('/status/')) {
                                tweetUrl = `https://x.com${href.split('?')[0]}`;
                            }
                        }

                        const tweetText = textNode?.innerText?.trim() || null;
                        const dateTime = timeNode?.getAttribute('datetime') || null;

                        if (!tweetUrl || !tweetText || !dateTime) {
                            return null;
                        }

                        // 提取作者信息
                        let author = '';
                        try {
                            // 尝试从 URL 中提取
                            const urlParts = tweetUrl.split('/');
                            const authorIndex = urlParts.indexOf('status') - 1;
                            if (authorIndex > 0) {
                                author = urlParts[authorIndex];
                            }
                        } catch (e) { }

                        // 解析计数
                        const likes = parseCountInBrowser(likeCountSpan?.innerText);
                        const retweets = parseCountInBrowser(retweetCountSpan?.innerText);
                        const replies = parseCountInBrowser(replyCountSpan?.innerText);

                        // 提取推文 ID
                        const tweetId = tweetUrl.split('/status/')[1];

                        // 增强分析：检查是否为回复
                        let isReply = false;
                        const replyContext = article.querySelector('div[dir="auto"] span') as HTMLElement | null;
                        if (replyContext && replyContext.innerText.includes('Replying to')) {
                            isReply = true;
                        }

                        // 增强分析：检查是否有引用推文 (Quoted Tweet)
                        let quotedContent: string | null = null;
                        // 通常引用推文是文章内的第二个 tweetText，或者特定的 div 结构
                        // 这是一个简单的启发式方法
                        const allTextNodes = article.querySelectorAll(SELECTORS.TWEET_TEXT);
                        if (allTextNodes.length > 1) {
                            // 如果有多个文本节点，第二个通常是引用内容
                            quotedContent = (allTextNodes[1] as HTMLElement)?.innerText?.trim();
                        }

                        return {
                            text: tweetText,
                            time: dateTime,
                            url: tweetUrl,
                            id: tweetId,
                            author: author,
                            likes,
                            retweets,
                            replies,
                            hasMedia,
                            isReply,       // 新增
                            quotedContent  // 新增
                        };
                    } catch (e) {
                        return null;
                    }
                })
                .filter((tweet): tweet is NonNullable<typeof tweet> => tweet !== null);
        }, X_SELECTORS);

        return tweetsOnPage;
    } catch (error: any) {
        console.error(`Failed to extract tweets: ${error.message}`);
        return [];
    }
}

/**
 * 检查页面上推文数量是否增长
 */
export async function waitForNewTweets(page: Page, previousCount: number, timeout: number = 3000): Promise<boolean> {
    try {
        await page.waitForFunction(
            (selector, prevCount) => document.querySelectorAll(selector).length > prevCount,
            { timeout },
            X_SELECTORS.TWEET,
            previousCount
        );
        return true;
    } catch (e) {
        // 超时不一定是坏事，可能只是没新推文
        return false;
    }
}

/**
 * 滚动页面到底部
 */
/**
 * 智能滚动页面到底部 (Mimicking Crawlee's Infinite Scroll)
 * 监控网络请求活动，确保数据加载完成
 */
export async function scrollToBottomSmart(page: Page, timeout: number = 5000): Promise<void> {
    // 1. 设置网络监听
    let requestCount = 0;
    const relevantTypes = ['xhr', 'fetch', 'websocket', 'other'];

    const onRequest = (req: any) => {
        if (relevantTypes.includes(req.resourceType())) {
            requestCount++;
        }
    };

    page.on('request', onRequest);

    // 2. 执行滚动
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
    });

    // 3. 智能等待 (等待网络空闲)
    const checkInterval = 200;
    let stableIntervals = 0;
    const requiredStableIntervals = 2; // 连续 2 次检查网络稳定再继续
    let lastRequestCount = requestCount;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        await new Promise(r => setTimeout(r, checkInterval));

        if (requestCount === lastRequestCount) {
            stableIntervals++;
        } else {
            stableIntervals = 0;
            lastRequestCount = requestCount;
        }

        // 如果网络稳定了，并且至少过了一小段时间
        if (stableIntervals >= requiredStableIntervals) {
            break;
        }
    }

    // 清理监听器
    page.off('request', onRequest);
}

/**
 * 简单的滚动到底部 (Legacy)
 */
export async function scrollToBottom(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
    });
}
