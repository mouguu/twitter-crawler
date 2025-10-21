/**
 * File utilities and run directory helpers for Twitter Crawler
 * 统一管理输出结构、缓存与目录创建
 */

const fs = require('fs').promises;
const path = require('path');

const DEFAULT_OUTPUT_ROOT = path.join(__dirname, '..', 'output');
const CACHE_ROOT = path.join(__dirname, '..', '.cache');

const DEFAULT_PLATFORM = 'twitter';
const DEFAULT_IDENTIFIER = 'timeline';

/**
 * 简单清理文件路径片段，避免非法字符
 * @param {string} segment
 * @returns {string}
 */
function sanitizeSegment(segment = '') {
  return String(segment)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || DEFAULT_IDENTIFIER;
}

/**
 * 确保目录存在
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function ensureDirExists(dir) {
  if (!dir) {
    console.error('ensureDirExists 需要提供目录路径');
    return false;
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    return true;
  } catch (error) {
    console.error(`创建目录失败: ${dir}`, error.message);
    return false;
  }
}

/**
 * 确保基础输出与缓存目录存在
 */
async function ensureBaseStructure() {
  await Promise.all([
    ensureDirExists(DEFAULT_OUTPUT_ROOT),
    ensureDirExists(CACHE_ROOT)
  ]);
  return true;
}

/**
 * 兼容旧函数名称，保留调用但现在只保证基础结构存在
 */
async function ensureDirectories() {
  return ensureBaseStructure();
}

/**
 * 创建一次抓取任务的运行目录上下文
 * @param {Object} options
 * @param {string} [options.platform='twitter']
 * @param {string} [options.identifier='timeline'] 例如用户名
 * @param {string} [options.baseOutputDir] 自定义输出根目录
 * @param {string} [options.timestamp] 用于测试的固定时间戳
 * @returns {Promise<Object>} runContext
 */
async function createRunContext(options = {}) {
  await ensureBaseStructure();

  const platform = sanitizeSegment(options.platform || DEFAULT_PLATFORM);
  const identifier = sanitizeSegment(options.identifier || DEFAULT_IDENTIFIER);
  const timestampRaw = options.timestamp || new Date().toISOString();
  const runTimestamp = timestampRaw.replace(/[:.]/g, '-');
  const runId = `run-${runTimestamp}`;

  const outputRoot = options.baseOutputDir
    ? path.resolve(options.baseOutputDir)
    : DEFAULT_OUTPUT_ROOT;

  const platformDir = path.join(outputRoot, platform);
  const subjectDir = path.join(platformDir, identifier);
  const runDir = path.join(subjectDir, runId);
  const markdownDir = path.join(runDir, 'markdown');
  const screenshotDir = path.join(runDir, 'screenshots');

  await Promise.all([
    ensureDirExists(platformDir),
    ensureDirExists(subjectDir),
    ensureDirExists(runDir),
    ensureDirExists(markdownDir),
    ensureDirExists(screenshotDir)
  ]);

  return {
    platform,
    identifier,
    outputRoot,
    runId,
    runTimestamp,
    runDir,
    markdownDir,
    screenshotDir,
    jsonPath: path.join(runDir, 'tweets.json'),
    csvPath: path.join(runDir, 'tweets.csv'),
    markdownIndexPath: path.join(runDir, 'index.md'),
    metadataPath: path.join(runDir, 'metadata.json')
  };
}

/**
 * 获取缓存文件路径
 * @param {string} platform
 * @param {string} identifier
 * @returns {string}
 */
function getCacheFilePath(platform = DEFAULT_PLATFORM, identifier = DEFAULT_IDENTIFIER) {
  const safePlatform = sanitizeSegment(platform);
  const safeIdentifier = sanitizeSegment(identifier);
  return path.join(CACHE_ROOT, safePlatform, `${safeIdentifier}.json`);
}

/**
 * 加载已抓取URL集合
 * @param {string} platform
 * @param {string} identifier
 * @returns {Promise<Set<string>>}
 */
async function loadSeenUrls(platform = DEFAULT_PLATFORM, identifier = DEFAULT_IDENTIFIER) {
  const cacheFile = getCacheFilePath(platform, identifier);
  await ensureDirExists(path.dirname(cacheFile));
  try {
    const data = await fs.readFile(cacheFile, 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      console.log(`[${platform}] 已加载 ${parsed.length} 条已抓取 URL (${identifier})`);
      return new Set(parsed);
    }
    return new Set();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[${platform}] 加载已抓取 URL 失败 (${identifier}): ${error.message}`);
    }
    return new Set();
  }
}

/**
 * 保存已抓取URL集合
 * @param {string} platform
 * @param {string} identifier
 * @param {Set<string>} urls
 * @returns {Promise<boolean>}
 */
async function saveSeenUrls(platform = DEFAULT_PLATFORM, identifier = DEFAULT_IDENTIFIER, urls) {
  if (!urls || !(urls instanceof Set)) {
    console.error('saveSeenUrls 需要提供 Set 类型的 urls');
    return false;
  }

  const cacheFile = getCacheFilePath(platform, identifier);
  await ensureDirExists(path.dirname(cacheFile));

  try {
    await fs.writeFile(
      cacheFile,
      JSON.stringify(Array.from(urls), null, 2),
      'utf-8'
    );
    console.log(`[${platform}] 已保存 ${urls.size} 条已抓取 URL (${identifier})`);
    return true;
  } catch (error) {
    console.error(`[${platform}] 保存已抓取 URL 失败 (${identifier}):`, error.message);
    return false;
  }
}

/**
 * 生成今天的日期字符串，格式为 YYYY-MM-DD
 * @returns {string}
 */
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * 获取目录中的 Markdown 文件（排除合并文件）
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function getMarkdownFiles(dir) {
  if (!dir) {
    console.error('getMarkdownFiles 需要指定目录');
    return [];
  }
  try {
    const files = await fs.readdir(dir);
    return files
      .filter(file => file.endsWith('.md') && !file.startsWith('merged-') && !file.startsWith('digest-'))
      .map(file => path.join(dir, file));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`目录不存在，无法读取 Markdown 文件: ${dir}`);
      return [];
    }
    console.error(`读取 Markdown 文件失败 (${dir}):`, error.message);
    return [];
  }
}

module.exports = {
  DEFAULT_OUTPUT_ROOT,
  CACHE_ROOT,

  ensureDirectories,
  ensureDirExists,
  ensureBaseStructure,
  createRunContext,
  loadSeenUrls,
  saveSeenUrls,
  getTodayString,
  getMarkdownFiles,
  sanitizeSegment
};
