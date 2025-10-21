/**
 * Export utilities for Twitter Crawler
 * 在新的运行目录结构中导出 CSV 与 JSON
 */

const fs = require('fs').promises;
const path = require('path');
const fileUtils = require('./fileutils');

/**
 * 导出推文数据为 CSV
 * @param {Array<Object>} tweets
 * @param {Object} runContext
 * @param {Object} [options]
 * @param {string} [options.filename='tweets.csv']
 * @returns {Promise<string|null>}
 */
async function exportToCsv(tweets, runContext, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    console.log('No tweet data to export as CSV');
    return null;
  }
  if (!runContext?.runDir) {
    throw new Error('exportToCsv requires valid runContext');
  }

  await fileUtils.ensureDirExists(runContext.runDir);

  const headers = ['text', 'time', 'url', 'likes', 'retweets', 'replies', 'hasMedia'];
  const csvRows = [
    headers.join(','),
    ...tweets.map(tweet =>
      headers.map(field => {
        const value = tweet[field];
        if (field === 'text' && value) {
          const escaped = String(value).replace(/"/g, '""');
          return /[,"\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
        }
        if (typeof value === 'boolean') {
          return value ? '1' : '0';
        }
        if (value === null || value === undefined) {
          return '';
        }
        return String(value);
      }).join(',')
    )
  ].join('\n');

  const defaultCsvName = runContext.csvPath ? path.basename(runContext.csvPath) : 'tweets.csv';
  const filename = options.filename || defaultCsvName;
  const csvPath = options.filename
    ? path.join(runContext.runDir, filename)
    : (runContext.csvPath || path.join(runContext.runDir, filename));
  await fs.writeFile(csvPath, csvRows, 'utf-8');

  console.log(`✅ CSV exported successfully: ${csvPath}`);
  return csvPath;
}

/**
 * 导出推文数据为 JSON
 * @param {Array<Object>} tweets
 * @param {Object} runContext
 * @param {Object} [options]
 * @param {string} [options.filename='tweets.json']
 * @returns {Promise<string|null>}
 */
async function exportToJson(tweets, runContext, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    console.log('No tweet data to export as JSON');
    return null;
  }
  if (!runContext?.runDir) {
    throw new Error('exportToJson requires valid runContext');
  }

  await fileUtils.ensureDirExists(runContext.runDir);

  const defaultJsonName = runContext.jsonPath ? path.basename(runContext.jsonPath) : 'tweets.json';
  const filename = options.filename || defaultJsonName;
  const jsonPath = options.filename
    ? path.join(runContext.runDir, filename)
    : (runContext.jsonPath || path.join(runContext.runDir, filename));
  await fs.writeFile(jsonPath, JSON.stringify(tweets, null, 2), 'utf-8');

  console.log(`✅ JSON exported successfully: ${jsonPath}`);
  return jsonPath;
}

module.exports = {
  exportToCsv,
  exportToJson
};
