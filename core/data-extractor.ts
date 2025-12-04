/**
 * 数据提取器
 * 负责从页面提取推文和用户资料信息
 */

import { Page } from 'puppeteer';
import * as constants from '../config/constants';
import { ERROR_RECOVERY_CONFIG, SCROLL_CONFIG } from '../config/constants';
import type { Tweet, ProfileInfo, RawTweetData } from '../types/tweet-definitions';
import { normalizeRawTweet } from '../types/tweet-definitions';

// 重新导出统一类型
export type { Tweet, ProfileInfo, RawTweetData };

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

// 已废弃，使用 RawTweetData
export type TweetData = RawTweetData;

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
export async function extractTweetsFromPage(page: Page): Promise<RawTweetData[]> {
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
export async function waitForNewTweets(page: Page, previousCount: number, timeout: number = SCROLL_CONFIG.waitForNewTweetsTimeout): Promise<boolean> {
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
export async function scrollToBottomSmart(page: Page, timeout: number = SCROLL_CONFIG.smartScrollTimeout): Promise<void> {
    // 1. 设置网络监听
    let requestCount = 0;
    const relevantTypes = ['xhr', 'fetch', 'websocket', 'other'];

    const onRequest = (req: any) => {
        if (relevantTypes.includes(req.resourceType())) {
            requestCount++;
        }
    };

    page.on('request', onRequest);

    try {
        // 2. 执行滚动策略 (Keyboard Strategy - More reliable for infinite scroll)
        try {
            // Press PageDown multiple times to trigger scroll events
            // This is better than window.scrollTo because it fires all the native events
            for (let i = 0; i < 5; i++) {
                await page.keyboard.press('PageDown');
                await new Promise(r => setTimeout(r, 200));
            }

            // Final ensure bottom
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
        } catch (e) {
            console.warn('Scroll execution failed:', e);
        }

        // 2.5 Check for "Show more" / "Load more" buttons
        try {
            const clicked = await page.evaluate(() => {
                // Common selectors for "Show more" buttons in Twitter search
                const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
                const showMoreBtn = buttons.find(b => {
                    const text = b.textContent?.toLowerCase() || '';
                    return text.includes('show more') || 
                           text.includes('show more results') || 
                           text.includes('load more');
                });
                
                if (showMoreBtn && (showMoreBtn as HTMLElement).click) {
                    (showMoreBtn as HTMLElement).click();
                    return true;
                }
                return false;
            });
            
            if (clicked) {
                // If we clicked a button, wait a bit for new content
                await new Promise(r => setTimeout(r, SCROLL_CONFIG.showMoreButtonWait));
            }
        } catch (e) {
            // Ignore errors checking for buttons
        }

        // 3. 智能等待 (等待网络空闲)
        const checkInterval = SCROLL_CONFIG.networkStabilityCheckInterval;
        let stableIntervals = 0;
        const requiredStableIntervals = SCROLL_CONFIG.requiredStableIntervals;
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
    } finally {
        // 清理监听器，防止内存泄漏
        page.off('request', onRequest);
    }
}

/**
 * 检测并点击 "Try Again" 按钮（处理 Twitter 错误页面）
 * @param page Puppeteer Page 实例
 * @returns 是否成功点击了按钮
 */
export async function clickTryAgainButton(page: Page): Promise<boolean> {
    try {
        const clicked = await page.evaluate(() => {
            // 查找所有可能的按钮元素
            const buttons = Array.from(document.querySelectorAll(
                'div[role="button"], button, a[role="button"], span[role="button"]'
            ));
            
            // 查找包含 "Try again"、"Try Again"、"Retry" 等文本的按钮
            const tryAgainBtn = buttons.find(b => {
                const text = (b.textContent || '').toLowerCase().trim();
                const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                
                return text.includes('try again') || 
                       text === 'try again' ||
                       text.includes('retry') ||
                       ariaLabel.includes('try again') ||
                       ariaLabel.includes('retry');
            });
            
            if (tryAgainBtn) {
                const element = tryAgainBtn as HTMLElement;
                // 尝试多种点击方式
                if (element.click) {
                    element.click();
                    return true;
                } else if (element.dispatchEvent) {
                    // 使用事件触发
                    const clickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    element.dispatchEvent(clickEvent);
                    return true;
                }
            }
            
            // 也尝试查找包含特定 data-testid 的按钮
            const testIdButtons = Array.from(document.querySelectorAll('[data-testid]'));
            const retryButton = testIdButtons.find(btn => {
                const testId = btn.getAttribute('data-testid') || '';
                const text = (btn.textContent || '').toLowerCase();
                return testId.includes('retry') || 
                       testId.includes('try') ||
                       (text.includes('try again') && testId);
            });
            
            if (retryButton) {
                const element = retryButton as HTMLElement;
                if (element.click) {
                    element.click();
                    return true;
                }
            }
            
            return false;
        });
        
        if (clicked) {
            // 点击后等待页面响应
            await new Promise(r => setTimeout(r, ERROR_RECOVERY_CONFIG.initialWaitAfterClick));
            return true;
        }
        
        return false;
    } catch (e) {
        // 忽略错误，返回 false
        return false;
    }
}

/**
 * 检测页面是否显示错误信息
 * @param page Puppeteer Page 实例
 * @returns 是否检测到错误页面
 */
export async function detectErrorPage(page: Page): Promise<boolean> {
    try {
        const hasError = await page.evaluate(() => {
            const bodyText = document.body.innerText.toLowerCase();
            const errorPatterns = [
                'something went wrong',
                'try again',
                'rate limit',
                'try again later',
                'suspended',
                'restricted',
                'blocked',
                'this page doesn\'t exist',
                'something went wrong, but don\'t fret',
                'something went wrong. try again'
            ];
            
            return errorPatterns.some(pattern => bodyText.includes(pattern));
        });
        
        return hasError;
    } catch (e) {
        return false;
    }
}

/**
 * 检测页面是否显示"无结果"信息
 * @param page Puppeteer Page 实例
 * @returns 是否检测到无结果页面
 */
export async function detectNoResultsPage(page: Page): Promise<boolean> {
    try {
        const hasNoResults = await page.evaluate(() => {
            const bodyText = document.body.innerText.toLowerCase();
            const noResultsPatterns = [
                'no results for',
                'no results found',
                'the term you entered did not bring up any results',
                'didn\'t find any results' // Generic fallback
            ];
            
            // Also check for specific empty state element if known
            const emptyState = document.querySelector('[data-testid="emptyState"]');
            if (emptyState) return true;

            return noResultsPatterns.some(pattern => bodyText.includes(pattern));
        });
        
        return hasNoResults;
    } catch (e) {
        return false;
    }
}

/**
 * 尝试从错误页面恢复：检测错误并点击 "Try Again" 按钮
 * @param page Puppeteer Page 实例
 * @param maxRetries 最大重试次数
 * @returns 是否成功恢复
 */
export async function recoverFromErrorPage(
    page: Page, 
    maxRetries: number = ERROR_RECOVERY_CONFIG.maxRetries
): Promise<boolean> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const hasError = await detectErrorPage(page);
            
            if (!hasError) {
                // 没有错误，页面正常
                return true;
            }
            
            // 检测到错误，尝试点击 "Try Again" 按钮
            const clicked = await clickTryAgainButton(page);
            
            if (clicked) {
                // 等待页面加载，给更多时间让页面响应
                const waitTime = ERROR_RECOVERY_CONFIG.initialWaitAfterClick + 
                                attempt * ERROR_RECOVERY_CONFIG.retryWaitIncrement;
                await new Promise(r => setTimeout(r, waitTime));
                
                // 再次检查是否还有错误
                const stillHasError = await detectErrorPage(page);
                if (!stillHasError) {
                    return true; // 成功恢复
                }
                
                // 如果还有错误，继续重试
                if (attempt < maxRetries - 1) {
                    // 等待一下再重试
                    await new Promise(r => setTimeout(r, ERROR_RECOVERY_CONFIG.retryInterval));
                }
            } else {
                // 没有找到 "Try Again" 按钮，可能不是可恢复的错误
                // 但如果是第一次尝试，可以再等一会儿看看页面是否自动恢复
                if (attempt === 0) {
                    await new Promise(r => setTimeout(r, ERROR_RECOVERY_CONFIG.autoRecoveryWait));
                    const autoRecovered = !(await detectErrorPage(page));
                    if (autoRecovered) {
                        return true;
                    }
                }
                break;
            }
        } catch (error) {
            // 如果检测过程中出错，记录但不中断
            console.warn(`Error during recovery attempt ${attempt + 1}:`, error);
            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, ERROR_RECOVERY_CONFIG.retryInterval));
            }
        }
    }
    
    return false; // 未能恢复
}

/**
 * 简单的滚动到底部 (Legacy)
 */
export async function scrollToBottom(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
    });
}
