/**
 * Screenshot utilities for Twitter Crawler
 * 根据新的运行目录结构存放截图
 */

const path = require('path');
const fileUtils = require('./fileutils');

function resolveScreenshotDir(runContext, fallbackDir) {
  if (runContext?.screenshotDir) {
    return runContext.screenshotDir;
  }
  if (fallbackDir) {
    return fallbackDir;
  }
  return path.join(fileUtils.DEFAULT_OUTPUT_ROOT, 'screenshots');
}

/**
 * 截取单条推文截图
 * @param {Object} page
 * @param {string} tweetUrl
 * @param {Object} [options]
 * @param {Object} [options.runContext]
 * @param {string} [options.outputDir]
 * @returns {Promise<string|null>}
 */
async function takeScreenshotOfTweet(page, tweetUrl, options = {}) {
  if (!page || !tweetUrl) {
    console.warn('Missing required parameters, cannot take screenshot');
    return null;
  }

  const runContext = options.runContext;
  const outputDir = resolveScreenshotDir(runContext, options.outputDir);
  await fileUtils.ensureDirExists(outputDir);

  try {
    console.log(`Taking screenshot of tweet: ${tweetUrl}`);

    const tweetId = tweetUrl.split('/').pop().split('?')[0];
    const filename = tweetId ? `tweet-${tweetId}-${Date.now()}.png` : `tweet-${Date.now()}.png`;
    const screenshotPath = path.join(outputDir, filename);

    await page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });

    const tweetElement = await page.$('article[data-testid="tweet"]');
    if (!tweetElement) {
      console.warn(`Tweet element not found: ${tweetUrl}`);
      return null;
    }

    await tweetElement.screenshot({ path: screenshotPath, omitBackground: true });
    console.log(`✅ Tweet screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  } catch (error) {
    console.error(`Tweet screenshot failed (${tweetUrl}):`, error.message);
    return null;
  }
}

/**
 * 批量截取推文截图
 * @param {Object} page
 * @param {Array} tweets
 * @param {Object} [options]
 * @returns {Promise<Array<string>>}
 */
async function takeScreenshotsOfTweets(page, tweets, options = {}) {
  if (!page || !Array.isArray(tweets) || tweets.length === 0) {
    console.log('No tweets to screenshot');
    return [];
  }

  const results = [];
  for (const tweet of tweets) {
    if (!tweet.url) continue;
    const shot = await takeScreenshotOfTweet(page, tweet.url, options);
    if (shot) results.push(shot);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  console.log(`Completed ${results.length} tweet screenshots`);
  return results;
}

/**
 * 截取时间线页面截图
 * @param {Object} page
 * @param {Object} [options]
 * @param {string} [options.filename]
 * @param {Object} [options.runContext]
 * @param {string} [options.outputDir]
 * @returns {Promise<string|null>}
 */
async function takeTimelineScreenshot(page, options = {}) {
  if (!page) {
    console.warn('Missing page object, cannot take screenshot');
    return null;
  }

  const runContext = options.runContext;
  const outputDir = resolveScreenshotDir(runContext, options.outputDir);
  await fileUtils.ensureDirExists(outputDir);

  try {
    const filename = options.filename || `timeline-${Date.now()}.png`;
    const screenshotPath = path.join(outputDir, filename);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`✅ Timeline screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  } catch (error) {
    console.error('Timeline screenshot failed:', error.message);
    return null;
  }
}

module.exports = {
  takeScreenshotOfTweet,
  takeScreenshotsOfTweets,
  takeTimelineScreenshot
};
