/**
 * Markdown utilities for Twitter Crawler
 * 负责在新的运行目录结构中生成 Markdown 内容
 */

const fs = require('fs').promises;
const path = require('path');
const fileUtils = require('./fileutils');
const timeUtils = require('./time');

/**
 * 生成单条推文的 Markdown 文件
 * @param {Object} tweet
 * @param {Object} runContext
 * @param {number} index
 * @returns {Promise<string|null>}
 */
async function saveTweetAsMarkdown(tweet, runContext, index = 0) {
  if (!tweet?.time || !tweet?.text || !tweet?.url) {
    console.warn('[X] Tweet missing required data, skipping save');
    return null;
  }
  if (!runContext?.markdownDir) {
    throw new Error('saveTweetAsMarkdown requires valid runContext.markdownDir');
  }

  const timezone = runContext?.timezone || timeUtils.getDefaultTimezone();
  let tweetTimestampIso = tweet.time;
  try {
    const timestampInfo = timeUtils.formatZonedTimestamp(tweet.time, timezone, {
      includeMilliseconds: true,
      includeOffset: true
    });
    tweetTimestampIso = timestampInfo.iso;
  } catch (error) {
    console.warn('[X] Failed to format tweet timestamp, falling back to raw value:', error.message);
    const fallback = new Date(tweet.time);
    if (!Number.isNaN(fallback.getTime())) {
      tweetTimestampIso = fallback.toISOString();
    }
  }

  const urlSegment = Buffer.from(tweet.url).toString('base64url').substring(0, 8);
  const filename = `${String(index + 1).padStart(3, '0')}-${urlSegment}.md`;
  const filePath = path.join(runContext.markdownDir, filename);

  const markdownContent = [
    '---',
    `platform: x`,
    `username: ${runContext.identifier}`,
    `runId: ${runContext.runId}`,
    `timezone: ${timezone}`,
    `tweetIndex: ${index + 1}`,
    `tweetTimestamp: ${tweetTimestampIso}`,
    `url: ${tweet.url}`,
    `likes: ${tweet.likes || 0}`,
    `retweets: ${tweet.retweets || 0}`,
    `replies: ${tweet.replies || 0}`,
    tweet.hasMedia ? 'hasMedia: true' : '',
    '---',
    '',
    `# Tweet ${index + 1}`,
    '',
    tweet.text,
    '',
    `🔗 [View on X](${tweet.url})`,
    ''
  ].filter(Boolean).join('\n');

  await fs.writeFile(filePath, markdownContent, 'utf-8');
  return filePath;
}

/**
 * 批量保存推文 Markdown，并生成 run 的索引文件
 * @param {Array<Object>} tweets
 * @param {Object} runContext
 * @param {Object} [options]
 * @param {number} [options.batchSize=10]
 * @returns {Promise<{perTweetFiles: string[], indexPath: string}>}
 */
async function saveTweetsAsMarkdown(tweets, runContext, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    console.log('[X] No tweets to save as Markdown');
    return { perTweetFiles: [], indexPath: null };
  }
  if (!runContext?.markdownDir) {
    throw new Error('saveTweetsAsMarkdown requires valid runContext');
  }

  await fileUtils.ensureDirExists(runContext.markdownDir);

  const batchSize = options.batchSize || 10;
  const savedFiles = [];
  const aggregatedSections = [];
  const timezone = runContext?.timezone || timeUtils.getDefaultTimezone();

  for (let i = 0; i < tweets.length; i += batchSize) {
    const batch = tweets.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((tweet, localIdx) => saveTweetAsMarkdown(tweet, runContext, i + localIdx))
    );
    savedFiles.push(...results.filter(Boolean));
    if (i + batchSize < tweets.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  tweets.forEach((tweet, index) => {
    let formattedTimestamp = 'Unknown time';
    if (tweet.time) {
      try {
        formattedTimestamp = timeUtils.formatReadableLocal(tweet.time, timezone);
      } catch (error) {
        const fallback = new Date(tweet.time);
        formattedTimestamp = Number.isNaN(fallback.getTime())
          ? 'Unknown time'
          : fallback.toISOString();
      }
    }
    const metrics = [
      `❤️ ${tweet.likes || 0}`,
      `🔁 ${tweet.retweets || 0}`,
      `💬 ${tweet.replies || 0}`
    ];
    if (tweet.hasMedia) {
      metrics.push('🖼️ Media');
    }

    aggregatedSections.push([
      `## ${index + 1}. ${formattedTimestamp}`,
      '',
      tweet.text || '(No text content)',
      '',
      metrics.join(' · '),
      `[View Tweet](${tweet.url})`
    ].join('\n'));
  });

  const headerLines = [
    '---',
    `platform: x`,
    `username: ${runContext.identifier}`,
    `runId: ${runContext.runId}`,
    runContext.runTimestampIso
      ? `runTimestamp: ${runContext.runTimestampIso}`
      : `runTimestamp: ${runContext.runTimestamp}`,
    runContext.runTimestampUtc ? `runTimestampUtc: ${runContext.runTimestampUtc}` : null,
    `timezone: ${timezone}`,
    `tweetCount: ${tweets.length}`,
    '---'
  ].filter(Boolean);

  const indexContent = [
    ...headerLines,
    '',
    `# Twitter Timeline - @${runContext.identifier}`,
    '',
    ...aggregatedSections
  ].join('\n\n');

  const indexPath = runContext.markdownIndexPath || path.join(runContext.runDir, 'index.md');
  await fs.writeFile(indexPath, indexContent, 'utf-8');

  console.log(`[X] Markdown written to directory: ${runContext.markdownDir}`);
  return { perTweetFiles: savedFiles, indexPath };
}

module.exports = {
  saveTweetAsMarkdown,
  saveTweetsAsMarkdown
};
