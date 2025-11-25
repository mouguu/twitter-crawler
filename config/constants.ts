/**
 * 配置常量
 * 集中管理所有魔法数字和配置值
 */

// ==================== 浏览器配置 ====================

/**
 * Puppeteer 浏览器启动参数
 */
export const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--window-size=1280,960',
    '--no-proxy-server'  // 禁用代理服务器
];

/**
 * 浏览器窗口尺寸
 */
export const BROWSER_VIEWPORT = {
    width: 1280,
    height: 960
};

/**
 * 浏览器 User Agent
 */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';

/**
 * 需要屏蔽的资源类型（加快加载速度）
 */
export const BLOCKED_RESOURCE_TYPES = ['image', 'media', 'font'];

// ==================== 超时配置 ====================

/**
 * 页面导航超时时间（毫秒）
 */
export const NAVIGATION_TIMEOUT = 30000;

/**
 * 等待推文选择器超时时间（毫秒）
 */
export const WAIT_FOR_TWEETS_TIMEOUT = 20000;

/**
 * 页面刷新后等待推文超时时间（毫秒）
 */
export const WAIT_FOR_TWEETS_AFTER_REFRESH_TIMEOUT = 30000;

/**
 * 等待新推文加载的超时时间（毫秒）
 */
export const WAIT_FOR_NEW_TWEETS_TIMEOUT = 2000;

// ==================== 重试配置 ====================

/**
 * 页面导航重试配置
 */
export const NAVIGATION_RETRY_CONFIG = {
    maxRetries: 2,
    baseDelay: 1000
};

/**
 * 等待选择器重试配置
 */
export const SELECTOR_RETRY_CONFIG = {
    maxRetries: 2,
    baseDelay: 1000
};

/**
 * 页面刷新重试配置
 */
export const REFRESH_RETRY_CONFIG = {
    maxRetries: 2,
    baseDelay: 1000
};

// ==================== 爬取策略配置 ====================

/**
 * 最大连续无新推文尝试次数
 * 达到此次数后会触发页面刷新
 */
export const MAX_CONSECUTIVE_NO_NEW_TWEETS = 3;

/**
 * 滚动延迟基础时间（毫秒）
 */
export const SCROLL_DELAY_BASE = 800;

/**
 * 滚动延迟随机抖动时间（毫秒）
 */
export const SCROLL_DELAY_JITTER = 500;

/**
 * 刷新后等待延迟基础时间（毫秒）
 */
export const REFRESH_WAIT_DELAY_BASE = 500;

/**
 * 刷新后等待延迟随机抖动时间（毫秒）
 */
export const REFRESH_WAIT_DELAY_JITTER = 500;

/**
 * 计算滚动延迟时间
 * @returns {number} 延迟时间（毫秒）
 */
export function getScrollDelay(): number {
    return SCROLL_DELAY_BASE + Math.random() * SCROLL_DELAY_JITTER;
}

/**
 * 计算刷新后等待时间
 * @returns {number} 延迟时间（毫秒）
 */
export function getRefreshWaitDelay(): number {
    return REFRESH_WAIT_DELAY_BASE + Math.random() * REFRESH_WAIT_DELAY_JITTER;
}

// ==================== 批处理配置 ====================

/**
 * 批处理用户之间的默认延迟（毫秒）
 */
export const BATCH_USER_DELAY = 2000;

// ==================== 调度器配置 ====================

/**
 * 调度器默认间隔时间（毫秒）
 */
export const SCHEDULER_DEFAULT_INTERVAL = 30 * 1000; // 30秒

// ==================== 默认值配置 ====================

/**
 * 默认推文抓取数量
 */
export const DEFAULT_TWEET_LIMIT = 50;

/**
 * 默认选项
 */
export const DEFAULT_SCRAPER_OPTIONS = {
    limit: DEFAULT_TWEET_LIMIT,
    saveMarkdown: true,
    saveScreenshots: false,
    exportCsv: false,
    exportJson: false
};

/**
 * 默认调度器选项
 */
export const DEFAULT_SCHEDULER_OPTIONS = {
    interval: SCHEDULER_DEFAULT_INTERVAL,
    limit: 10,
    saveMarkdown: true,
    exportCsv: false,
    exportJson: false,
    saveScreenshots: false
};

// ==================== 平台标识 ====================

/**
 * 平台名称
 */
export const PLATFORM_NAME = 'x';

/**
 * 平台显示名称
 */
export const PLATFORM_DISPLAY_NAME = 'X (Twitter)';

// ==================== 数值转换常量 ====================

/**
 * K 后缀的乘数（千）
 */
export const COUNT_MULTIPLIER_K = 1000;

/**
 * M 后缀的乘数（百万）
 */
export const COUNT_MULTIPLIER_M = 1000000;
