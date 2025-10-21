/**
 * 数据提取器
 * 负责从页面提取推文和用户资料信息
 */

const constants = require('../config/constants');

// Twitter 选择器
const X_SELECTORS = {
  TWEET: 'article[data-testid="tweet"]',
  TWEET_TEXT: '[data-testid="tweetText"]',
  LIKE: '[data-testid="like"]',
  RETWEET: '[data-testid="retweet"]',
  REPLY: '[data-testid="reply"]',
  SHARE: '[data-testid="app-text-transition-container"]',
  TIME: 'time',
  MEDIA: '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'
};

/**
 * 解析计数文本（如 "1.5K" -> 1500）
 * 这个函数在 Node.js 环境中运行
 * @param {string} countText - 计数文本
 * @returns {number} - 解析后的数字
 */
function parseCount(countText) {
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
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<Object|null>} - 用户资料对象
 */
async function extractProfileInfo(page) {
  try {
    const profileInfo = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? (el.textContent || '').trim() : null;
      };

      const parseCountInBrowser = (countText) => {
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
      let displayName = null;
      let handle = null;
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
      let website = null;
      const urlEl = document.querySelector('[data-testid="UserUrl"] a[href]');
      if (urlEl) website = urlEl.getAttribute('href');

      let followers = null;
      let following = null;
      try {
        document.querySelectorAll('a[href*="/followers"], a[href*="/following"]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const txt = (a.textContent || '').trim();
          if (href.includes('/followers')) followers = parseCountInBrowser(txt);
          if (href.includes('/following')) following = parseCountInBrowser(txt);
        });
      } catch (e) {}

      return { displayName, handle, bio, location, website, joined, followers, following };
    });

    return profileInfo;
  } catch (error) {
    console.warn(`Failed to extract profile info: ${error.message}`);
    return null;
  }
}

/**
 * 从页面提取所有推文
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<Array>} - 推文数组
 */
async function extractTweetsFromPage(page) {
  try {
    const tweetsOnPage = await page.evaluate((SELECTORS) => {
      const parseCountInBrowser = (countText) => {
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
            const textNode = article.querySelector(SELECTORS.TWEET_TEXT);
            const timeNode = article.querySelector(SELECTORS.TIME);
            const linkNode = timeNode?.closest('a[href*="/status/"]');

            // 计数元素
            const likeButton = article.querySelector(SELECTORS.LIKE);
            const retweetButton = article.querySelector(SELECTORS.RETWEET);
            const replyButton = article.querySelector(SELECTORS.REPLY);

            // 计数 span
            const likeCountSpan = likeButton?.querySelector(`${SELECTORS.SHARE} span > span`);
            const retweetCountSpan = retweetButton?.querySelector(`${SELECTORS.SHARE} span > span`);
            const replyCountSpan = replyButton?.querySelector(`${SELECTORS.SHARE} span > span`);

            // 检查是否包含媒体
            const hasMedia = !!article.querySelector(SELECTORS.MEDIA);

            // 获取推文 URL
            let tweetUrl = null;
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
            } catch (e) {}

            // 解析计数
            const likes = parseCountInBrowser(likeCountSpan?.innerText);
            const retweets = parseCountInBrowser(retweetCountSpan?.innerText);
            const replies = parseCountInBrowser(replyCountSpan?.innerText);

            // 提取推文 ID
            const tweetId = tweetUrl.split('/status/')[1];

            return {
              text: tweetText,
              time: dateTime,
              url: tweetUrl,
              id: tweetId,
              author: author,
              likes,
              retweets,
              replies,
              hasMedia
            };
          } catch(e) {
            return null;
          }
        })
        .filter(tweet => tweet !== null);
    }, X_SELECTORS);

    return tweetsOnPage;
  } catch (error) {
    console.error(`Failed to extract tweets: ${error.message}`);
    return [];
  }
}

/**
 * 检查页面上推文数量是否增长
 * @param {Page} page - Puppeteer 页面对象
 * @param {number} previousCount - 之前的推文数量
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<boolean>} - 是否有新推文加载
 */
async function waitForNewTweets(page, previousCount, timeout = 3000) {
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
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<void>}
 */
async function scrollToBottom(page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
}

module.exports = {
  X_SELECTORS,
  parseCount,
  extractProfileInfo,
  extractTweetsFromPage,
  waitForNewTweets,
  scrollToBottom
};
