#!/usr/bin/env node
/**
 * Markdown文件合并工具模块
 * 合并指定目录的md文件，添加索引，并可选择删除源文件
 */

const fs = require('fs').promises;
const path = require('path');
const fileUtils = require('./fileutils');

const DEFAULT_CONVERGENCE_DIR = path.join(fileUtils.DEFAULT_OUTPUT_ROOT, 'convergence');

// 获取 Cookie 文件路径（也用于读取用户名）
const COOKIE_FILE = path.join(__dirname, '..', 'env.json');

/**
 * 尝试从 env.json 读取用户名
 * @returns {Promise<string|null>} 用户名或 null
 */
async function getUsernameFromEnv() {
  try {
    const envContent = await fs.readFile(COOKIE_FILE, 'utf-8');
    const envData = JSON.parse(envContent);
    // 假设 env.json 结构是 { "cookies": [...], "username": "YourUsername" }
    // 或者直接是 { "username": "YourUsername", ...其他cookie信息 }
    if (typeof envData.username === 'string') {
      return envData.username;
    }
    // 兼容旧格式或仅包含 cookie 的数组格式
    if (Array.isArray(envData)) {
        // 尝试从 cookie 中找 'username' (不太可靠，但可以试试)
        const usernameCookie = envData.find(c => c.name === 'username');
        if (usernameCookie) {
             return usernameCookie.value;
        }
    }
    console.warn("'username' field not found in env.json.");
    return null;
  } catch (error) {
    if (error.code !== 'ENOENT') { // 文件不存在是正常情况
      console.warn(`Failed to read env.json to get username: ${error.message}`);
    }
    return null;
  }
}

/**
 * 合并指定目录下的所有 .md 文件 (排除特定前缀的文件)
 * @param {string} sourceDir 要合并文件的源目录.
 * @param {string} outputDir 合并后文件的输出目录.
 * @param {string} platform 平台标识 ('x' or 'medium') 用于生成文件名和元数据.
 * @param {boolean} deleteSourceFiles 是否删除源文件，默认为 false.
 * @returns {Promise<string|null>} 合并后的文件路径，或 null.
 */
async function mergeMarkdownFiles(sourceDir, outputDir, platform, deleteSourceFiles = false) {
  // Validate required parameters
  if (!sourceDir || !outputDir || !platform) {
      console.error('mergeMarkdownFiles missing required parameters: sourceDir, outputDir, platform');
      return null;
  }

  try {
    console.log(`[${platform.toUpperCase()}] Starting to merge Markdown files from ${sourceDir}...`);
    await fileUtils.ensureBaseStructure(); // Ensures base dirs exist
    await fs.mkdir(outputDir, { recursive: true }); // Ensure specific output dir exists
    
    // 获取所有符合条件的Markdown文件
    const mdFiles = await fileUtils.getMarkdownFiles(sourceDir); // Pass sourceDir
    
    if (mdFiles.length === 0) {
      console.log(`[${platform.toUpperCase()}] No Markdown files found to merge in ${sourceDir}`);
      return null;
    }

    // 按文件名排序，新的在前
    mdFiles.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));

    console.log(`[${platform.toUpperCase()}] Found ${mdFiles.length} Markdown files ready to merge`);
    
    // -- 开始构建元数据 --
    const mergeTime = new Date();
    const username = await getUsernameFromEnv(); // Username might be specific to platform if needed
    const dateString = mergeTime.toISOString().split('T')[0];
    const timeString = mergeTime.toTimeString().split(' ')[0].replace(/:/g, '');
    const mergedFilename = `merged-${platform}-${dateString}-${timeString}.md`; // Include platform

    let metadataBlock = [
      '---',
      `platform: ${platform}`,
      `mergedFilename: ${mergedFilename}`,
      `mergeTimestamp: ${mergeTime.toISOString()}`,
      // Use platform-specific username if available, otherwise generic
      username ? `accountUsername: ${username}` : '# accountUsername: (not found in env.json/medium-cookies.json)',
      `totalItemsMerged: ${mdFiles.length}`,
      '---',
      '\n' 
    ].join('\n');
    // -- 元数据构建结束 --

    // 读取所有文件内容并添加索引后拼接
    let allItemsContent = ''; // Renamed variable
    const separator = '\n\n---\n\n'; 
    let itemIndex = 1; // Renamed variable
    
    for (const file of mdFiles) {
      const content = await fs.readFile(file, 'utf-8');
      // Add index before the content of each file
      allItemsContent += `## ${itemIndex}.\n\n${content}${separator}`;
      itemIndex++; 
    }
    
    // 清理末尾多余的分隔符
    if (allItemsContent.endsWith(separator)) {
        allItemsContent = allItemsContent.slice(0, -separator.length);
    }

    // 合并元数据和内容
    const finalContent = metadataBlock + allItemsContent;

    // 保存合并后的文件
    const mergedFilePath = path.join(outputDir, mergedFilename);
    await fs.writeFile(mergedFilePath, finalContent, 'utf-8');
    console.log(`[${platform.toUpperCase()}] ✅ All Markdown files merged and saved as: ${mergedFilename}`);

    // 如果需要，删除源文件
    if (deleteSourceFiles) {
      console.log(`[${platform.toUpperCase()}] Deleting ${mdFiles.length} source Markdown files from ${sourceDir}...`);
      let deletedCount = 0;
      for (const file of mdFiles) {
        // Safety check (redundant due to initial filter but safe)
        if (path.basename(file).startsWith('merged-') || path.basename(file).startsWith('digest-')) {
            console.warn(`[${platform.toUpperCase()}] Skipping deletion of protected file: ${file}`);
            continue;
        }
        try {
          await fs.unlink(file);
          deletedCount++;
        } catch (delError) {
          console.warn(`[${platform.toUpperCase()}] Failed to delete file: ${file}`, delError.message);
        }
      }
      console.log(`[${platform.toUpperCase()}] Successfully deleted ${deletedCount} source files`);
    }

    return mergedFilePath;
  } catch (error) {
    console.error(`[${platform.toUpperCase()}] Failed to merge Markdown files:`, error.message);
    return null;
  }
}

/**
 * Formats a single tweet object into a Markdown string for convergence.
 * (Adapts logic from markdownUtils.saveTweetAsMarkdown)
 * @param {Object} tweet Tweet object.
 * @param {number} index Index for the item.
 * @returns {string} Markdown formatted string.
 */
function formatTweetForConvergence(tweet, index) {
  const date = new Date(tweet.time);
  const content = [
    `## ${index}. (X) ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`, // Add platform hint
    '',
    `> ${tweet.text.replace(/\n/g, '\n> ')}`, // Basic blockquote
    '',
    `❤️ ${tweet.likes || 0} | 🔄 ${tweet.retweets || 0} | 💬 ${tweet.replies || 0}${tweet.hasMedia ? ' | 🖼️' : ''}`,
    `🔗 [View on X](${tweet.url})`,
  ].join('\n');
  return content;
}

/**
 * Formats a single Medium article object into a Markdown string for convergence.
 * (Adapts logic from markdownUtils.saveMediumArticleAsMarkdown)
 * @param {Object} article Article object.
 * @param {number} index Index for the item.
 * @returns {string} Markdown formatted string.
 */
function formatMediumForConvergence(article, index) {
  const publishedDate = article.publishedDate ? new Date(article.publishedDate) : null;
  const title = article.title || 'Untitled';
  const content = [
    `## ${index}. (Medium) ${title}`, // Add platform hint and Title
    '',
    article.authorName ? `*By ${article.authorName}*` : '',
    publishedDate ? `*Published on ${publishedDate.toLocaleDateString()}*` : '',
    '',
    '---',
    '',
    article.content, // Assumes content is already Markdown
    '',
    '---',
    `🔗 [View Original](${article.originalUrl || article.url})`, // Prefer original URL if via Freedium
    (article.originalUrl && article.url !== article.originalUrl) ? `🔗 [View Scraped Version](${article.url})` : ''
  ].filter(Boolean).join('\n');
  return content;
}

/**
 * Merges scraped items from multiple platforms into a single convergence file.
 * @param {Array<Object>} twitterResults Array of tweet objects from scrape.
 * @param {Array<Object>} mediumResults Array of article objects from scrapeMediumArticle.
 * @param {string} [outputDir] Output directory, defaults to CONVERGENCE_DIR.
 * @returns {Promise<string|null>} Path to the convergence file or null.
 */
async function mergeAllPlatforms(twitterResults = [], mediumResults = [], outputDir = DEFAULT_CONVERGENCE_DIR) {
  const allItems = [
      ...twitterResults.map(item => ({ ...item, platform: 'x' })),
      ...mediumResults.map(item => ({ ...item, platform: 'medium' }))
  ];

  if (allItems.length === 0) {
    console.log('[Convergence] No content found from any platform to merge.');
    return null;
  }

  // Sort all items by date (time for tweets, publishedDate or scrape time for articles)
  allItems.sort((a, b) => {
      const dateA = new Date(a.time || a.publishedDate || Date.now()); // Fallback needed
      const dateB = new Date(b.time || b.publishedDate || Date.now());
      return dateB - dateA; // Sort descending (newest first)
  });

  console.log(`[Convergence] Starting to merge ${allItems.length} items (from ${twitterResults.length} X, ${mediumResults.length} Medium)...`);
  await fileUtils.ensureBaseStructure(); // Ensure base dirs exist
  await fs.mkdir(outputDir, { recursive: true }); // Ensure convergence dir exists

  // --- Build Metadata --- 
  const mergeTime = new Date();
  const username = await getUsernameFromEnv(); // Assuming one primary username for now
  const dateString = mergeTime.toISOString().split('T')[0];
  const timeString = mergeTime.toTimeString().split(' ')[0].replace(/:/g, '');
  const mergedFilename = `convergence-${dateString}-${timeString}.md`;

  const metadataBlock = [
    '---',
    `mergedFilename: ${mergedFilename}`,
    `mergeTimestamp: ${mergeTime.toISOString()}`,
    username ? `primaryAccount: ${username}` : '# primaryAccount: (not found in env.json)',
    `totalItemsMerged: ${allItems.length}`,
    `twitterItems: ${twitterResults.length}`,
    `mediumItems: ${mediumResults.length}`,
    '---',
    '\n'
  ].join('\n');
  // --- Metadata End --- 

  let finalContent = metadataBlock;
  const separator = '\n\n---\n\n';
  let itemIndex = 1;

  for (const item of allItems) {
    let formattedItem = '';
    if (item.platform === 'x') {
        formattedItem = formatTweetForConvergence(item, itemIndex);
    } else if (item.platform === 'medium') {
        formattedItem = formatMediumForConvergence(item, itemIndex);
    }
    
    if (formattedItem) {
        finalContent += formattedItem + separator;
        itemIndex++;
    }
  }

  // Clean trailing separator
  if (finalContent.endsWith(separator)) {
    finalContent = finalContent.slice(0, -separator.length);
  }

  // Save the convergence file
  const mergedFilePath = path.join(outputDir, mergedFilename);
  try {
    await fs.writeFile(mergedFilePath, finalContent, 'utf-8');
    console.log(`[Convergence] ✅ Convergence file saved successfully: ${mergedFilename}`);
    return mergedFilePath;
  } catch (error) {
      console.error(`[Convergence] Failed to save convergence file:`, error.message);
      return null;
  }
}

// Export the new function along with the old one
module.exports = { mergeMarkdownFiles, mergeAllPlatforms }; 
