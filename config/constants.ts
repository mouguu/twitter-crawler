/**
 * Application Constants
 * 
 * This file contains ONLY truly immutable constants:
 * - API endpoints and GraphQL query IDs
 * - Platform identifiers
 * - Browser configuration (args, user agent)
 * 
 * For configurable values (timeouts, delays, limits), see:
 * - utils/config-manager.ts (ConfigManager)
 */

// ==================== 浏览器配置 ====================

/**
 * Puppeteer 浏览器启动参数
 */
export const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--window-size=1280,960",
  // Removed '--no-proxy-server' to allow proxy configuration
];

/**
 * 浏览器窗口尺寸
 */
export const BROWSER_VIEWPORT = {
  width: 1280,
  height: 960,
};

/**
 * 浏览器 User Agent (默认)
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36";

/**
 * 🆕 User-Agent 池用于指纹随机化
 * 包含最新的真实浏览器 UA（2024年末更新）
 */
export const USER_AGENT_POOL = [
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
  // Safari on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  // Firefox on Windows/macOS
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
] as const;

/**
 * 🆕 Viewport 池用于指纹随机化
 * 包含常见的桌面分辨率
 */
export const VIEWPORT_POOL = [
  { width: 1920, height: 1080 },  // 1080p (最常见)
  { width: 1366, height: 768 },   // 笔记本常见
  { width: 1440, height: 900 },   // MacBook Air
  { width: 1536, height: 864 },   // 低端笔记本
  { width: 1680, height: 1050 },  // MacBook Pro 15"
  { width: 2560, height: 1440 },  // 2K
  { width: 1280, height: 800 },   // MacBook 13"
  { width: 1600, height: 900 },   // 16:9 变体
] as const;

/**
 * 🆕 获取随机 User-Agent
 */
export function getRandomUserAgent(): string {
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
}

/**
 * 🆕 获取随机 Viewport
 */
export function getRandomViewport(): { width: number; height: number } {
  const vp = VIEWPORT_POOL[Math.floor(Math.random() * VIEWPORT_POOL.length)];
  return { width: vp.width, height: vp.height };
}

/**
 * 🆕 生成完整的随机浏览器指纹
 */
export function getRandomFingerprint(): {
  userAgent: string;
  viewport: { width: number; height: number };
  windowSize: string;
} {
  const ua = getRandomUserAgent();
  const vp = getRandomViewport();
  return {
    userAgent: ua,
    viewport: vp,
    windowSize: `--window-size=${vp.width},${vp.height}`,
  };
}

/**
 * 需要屏蔽的资源类型（加快加载速度）
 */
export const BLOCKED_RESOURCE_TYPES = ["image", "media", "font"];

// ==================== 超时配置 ====================
// NOTE: Timeout values have been moved to ConfigManager.
// These are kept for legacy compatibility but should be migrated.

/**
 * @deprecated Use ConfigManager.twitter.browserTimeout instead
 */
export const NAVIGATION_TIMEOUT = 60000;

/**
 * @deprecated Use ConfigManager.twitter.apiTimeout instead  
 */
export const WAIT_FOR_TWEETS_TIMEOUT = 45000;

/**
 * @deprecated Legacy constant
 */
export const WAIT_FOR_TWEETS_AFTER_REFRESH_TIMEOUT = 75000;

/**
 * @deprecated Legacy constant
 */
export const WAIT_FOR_NEW_TWEETS_TIMEOUT = 6000;

// ==================== 速率限制配置 ====================

/**
 * API request rate limiting configuration
 */
export const API_RATE_LIMIT = {
  /** Minimum wait time between API requests (ms) */
  MIN_WAIT: 200,
  /** Maximum wait time between API requests (ms) */
  MAX_WAIT: 500,
  /** Thread detail request wait time base (ms) */
  THREAD_WAIT_BASE: 200,
  /** Thread detail request wait time jitter (ms) */
  THREAD_WAIT_JITTER: 300,
} as const;

/**
 * Calculate random wait time for API requests
 */
export function getApiWaitTime(): number {
  return API_RATE_LIMIT.MIN_WAIT + 
         Math.random() * (API_RATE_LIMIT.MAX_WAIT - API_RATE_LIMIT.MIN_WAIT);
}

/**
 * Calculate random wait time for thread detail requests
 */
export function getThreadDetailWaitTime(): number {
  return API_RATE_LIMIT.THREAD_WAIT_BASE + 
         Math.random() * API_RATE_LIMIT.THREAD_WAIT_JITTER;
}

// ==================== 重试配置 ====================

/**
 * 页面导航重试配置
 */
export const NAVIGATION_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 2000,
};

/**
 * 等待选择器重试配置
 */
export const SELECTOR_RETRY_CONFIG = {
  maxRetries: 2,
  baseDelay: 2000,
};

/**
 * 页面刷新重试配置
 */
export const REFRESH_RETRY_CONFIG = {
  maxRetries: 2,
  baseDelay: 2000,
};

// ==================== 错误恢复配置 ====================

/**
 * 错误页面恢复配置
 */
export const ERROR_RECOVERY_CONFIG = {
  /**
   * 最大重试次数（尝试点击 "Try Again" 按钮）
   */
  maxRetries: 2,

  /**
   * 点击按钮后初始等待时间（毫秒）
   */
  initialWaitAfterClick: 3000,

  /**
   * 每次重试递增的等待时间（毫秒）
   */
  retryWaitIncrement: 1000,

  /**
   * 重试之间的等待时间（毫秒）
   */
  retryInterval: 1000,

  /**
   * 自动恢复检测等待时间（毫秒）- 即使没有找到按钮也等待看看是否自动恢复
   */
  autoRecoveryWait: 2000,
};

/**
 * Chunk 重试配置
 */
export const CHUNK_RETRY_CONFIG = {
  /**
   * 每个 chunk 的最大重试次数（带 session 轮换）
   */
  maxChunkRetries: 3,

  /**
   * 全局重试阶段的最大重试次数
   */
  maxGlobalRetries: 2,

  /**
   * Chunk 重试前的延迟基础时间（毫秒）
   */
  chunkRetryDelayBase: 500,

  /**
   * Chunk 重试延迟的随机抖动（毫秒）
   */
  chunkRetryDelayJitter: 500,
};

/**
 * 滚动配置
 */
export const SCROLL_CONFIG = {
  /**
   * 智能滚动的默认超时时间（毫秒）
   */
  smartScrollTimeout: 5000,

  /**
   * 等待新推文的默认超时时间（毫秒）
   */
  waitForNewTweetsTimeout: 3000,

  /**
   * 网络稳定性检查间隔（毫秒）
   */
  networkStabilityCheckInterval: 200,

  /**
   * 需要的连续稳定检查次数
   */
  requiredStableIntervals: 2,

  /**
   * 点击 "Show more" 按钮后的等待时间（毫秒）
   */
  showMoreButtonWait: 2000,
};

// ==================== 爬取策略配置 ====================

/**
 * 最大连续无新推文尝试次数
 * 达到此次数后会触发页面刷新
 */
export const MAX_CONSECUTIVE_NO_NEW_TWEETS = 2; // 搜索场景会放大为 4（加速失败检测）

/**
 * 滚动延迟基础时间（毫秒）
 */
export const SCROLL_DELAY_BASE = 400;

/**
 * 滚动延迟随机抖动时间（毫秒）
 */
export const SCROLL_DELAY_JITTER = 400;

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

// ==================== 浏览器池配置 ====================

/**
 * Browser pool configuration
 */
export const BROWSER_POOL_CONFIG = {
  /** Maximum pool size */
  MAX_SIZE: 3,
  /** Minimum pool size */
  MIN_SIZE: 1,
  /** Maximum browser idle time (ms) before closing */
  MAX_IDLE_TIME: 30000,
  /** Browser acquisition timeout (ms) */
  ACQUIRE_TIMEOUT: 30000,
} as const;

// ==================== 线程爬取配置 ====================

/**
 * Thread scraping configuration
 */
export const THREAD_CONFIG = {
  /** Maximum replies to fetch per thread */
  MAX_REPLIES: 100,
  /** Maximum scroll attempts for DOM thread scraping */
  MAX_SCROLL_ATTEMPTS: 50,
  /** Replies per scroll attempt */
  REPLIES_PER_SCROLL: 5,
} as const;

// ==================== 批处理配置 ====================

/**
 * 批处理用户之间的默认延迟（毫秒）
 */
export const BATCH_USER_DELAY = 5000;

// ==================== 调度器配置 ====================

/**
 * 调度器默认间隔时间（毫秒）
 */
export const SCHEDULER_DEFAULT_INTERVAL = 30 * 1000; // 30秒

// ==================== 默认值配置 ====================
// NOTE: Default values should be accessed via ConfigManager instead.
// These are kept for backward compatibility only.

/**
 * @deprecated Use ConfigManager.getTwitterConfig().defaultLimit
 */
export const DEFAULT_TWEET_LIMIT = 50;

/**
 * @deprecated Use ConfigManager instead
 */
export const DEFAULT_SCRAPER_OPTIONS = {
  limit: DEFAULT_TWEET_LIMIT,
  saveMarkdown: true,
  saveScreenshots: false,
  exportCsv: false,
  exportJson: false,
};

/**
 * @deprecated Legacy scheduler options - not used in queue-based system
 */
export const DEFAULT_SCHEDULER_OPTIONS = {
  interval: SCHEDULER_DEFAULT_INTERVAL,
  limit: 10,
  saveMarkdown: true,
  exportCsv: false,
  exportJson: false,
  saveScreenshots: false,
};

// ==================== 平台标识 ====================

/**
 * 平台名称
 */
export const PLATFORM_NAME = "x";

/**
 * 平台显示名称
 */
export const PLATFORM_DISPLAY_NAME = "X (Twitter)";

// ==================== 数值转换常量 ====================

/**
 * K 后缀的乘数（千）
 */
export const COUNT_MULTIPLIER_K = 1000;

/**
 * M 后缀的乘数（百万）
 */
export const COUNT_MULTIPLIER_M = 1000000;

// ==================== GraphQL API 配置 ====================

/**
 * Twitter/X API Bearer Token
 * 注意：这是公开的 Bearer Token，用于未认证请求
 */
export const X_API_BEARER_TOKEN =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

/**
 * GraphQL API 操作定义
 */
export const X_API_OPS = {
  UserByScreenName: {
    queryId: "-oaLodhGbbnzJBACb1kk2Q",
    operationName: "UserByScreenName",
    operationType: "query",
  },
  UserTweets: {
    queryId: "lZRf8IC-GTuGxDwcsHW8aw",
    operationName: "UserTweets",
    operationType: "query",
  },
  SearchTimeline: {
    // keep in sync with latest browser network requests
    queryId: "bshMIjqDk8LTXTq4w91WKw",
    operationName: "SearchTimeline",
    operationType: "query",
  },
  TweetDetail: {
    // 获取推文详情及其对话/回复
    // Updated from browser inspection 2025-11-30
    queryId: "6QzqakNMdh_YzBAR9SYPkQ",
    operationName: "TweetDetail",
    operationType: "query",
  },
  TweetResultByRestId: {
    // 单条推文详情 (用于批量查询/补全)
    queryId: "kLXoXTloWpv9d2FSXRg-Tg",
    operationName: "TweetResultByRestId",
    operationType: "query",
  },
  TweetResultsByRestIds: {
    // 批量获取推文详情
    queryId: "BWy5aoI-WvwbeSiHUIf2Hw",
    operationName: "TweetResultsByRestIds",
    operationType: "query"
  },
} as const;

/**
 * 搜索 API 的反机器人请求头（从真实浏览器请求中捕获）
 */
export const X_API_SEARCH_HEADERS = {
  xpf: "f06f4d1ed144fdb9b6a429bb1cd1410334bc5d3a3739de5893b1f864888503b23cc58e30586a810c23f2de1b03d05f8c48bad910913835ff90d5abaa13b1e827aca9993ecd16e0ab3b0bdd062508d6a0f4642847fe88d942c243034a6a6da7520986e86bacc7887a6b89c315f4c6b7b60b08a4503cd1cb24f81227e6c75c58d164f3e874c4e1c908ae80c4279e99d4e49a7b0faa0c4dd595abb257cd5c030d2d1207503f7fac3f3887dfebda85f4d5860eb8390d9f37249526be7f2aa7b8a0184b87a13ace19c31083a0d94e928c10021be2266421c701fa9251954bfc1acea9e442bcadb5250d8eb210ef87caa0aafed9a5dd08a962ce6d8a438f1c23a40a294b",
  clid: "qiZQzHpRH6sM/HpovvVQDARl/PkdDw20+hRk6JkgAMb5/clzwOybZgsact47/+KfiZeOcq53EbGhTRl58REfduSu5D25qQ",
  secChUa: '" Not;A Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
  secChUaMobile: "?0",
  secChUaPlatform: '"Mac OS X"',
  acceptLanguage: "en-US,en;q=0.9",
  refererBase: "https://x.com/search?q=",
  clientLanguage: "en",
} as const;

/**
 * GraphQL API Features 配置 - Timeline
 */
export const X_API_FEATURES_TIMELINE = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
} as const;

/**
 * GraphQL API Features 配置 - User Details
 */
export const X_API_FEATURES_USER_DETAILS = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
} as const;

// ==================== 配置验证函数 ====================

/**
 * 验证爬取配置选项
 * @param config 爬取配置对象
 * @throws {Error} 如果配置无效
 */
export function validateScrapeConfig(config: {
  limit?: number;
  username?: string;
  searchQuery?: string;
  mode?: "timeline" | "search";
  scrapeMode?: "graphql" | "puppeteer" | "mixed";
}): void {
  if (config.limit !== undefined) {
    if (typeof config.limit !== "number" || config.limit < 1) {
      throw new Error(
        `Invalid limit: must be a positive number, got ${config.limit}`
      );
    }
    if (config.limit > 10000) {
      throw new Error(`Invalid limit: must be <= 10000, got ${config.limit}`);
    }
  }

  if (config.mode === "timeline" && !config.username) {
    throw new Error("Username is required for timeline mode");
  }

  if (config.mode === "search" && !config.searchQuery) {
    throw new Error("Search query is required for search mode");
  }

  if (
    config.scrapeMode &&
    !["graphql", "puppeteer", "mixed"].includes(config.scrapeMode)
  ) {
    throw new Error(
      `Invalid scrapeMode: must be 'graphql', 'puppeteer', or 'mixed', got ${config.scrapeMode}`
    );
  }
}

/**
 * 验证浏览器启动配置
 * @param options 浏览器启动选项
 * @throws {Error} 如果配置无效
 */
export function validateBrowserOptions(options: {
  headless?: boolean;
  userAgent?: string;
  blockResources?: boolean;
}): void {
  if (options.headless !== undefined && typeof options.headless !== "boolean") {
    throw new Error(
      `Invalid headless option: must be boolean, got ${typeof options.headless}`
    );
  }

  if (options.userAgent && typeof options.userAgent !== "string") {
    throw new Error(
      `Invalid userAgent: must be string, got ${typeof options.userAgent}`
    );
  }

  if (
    options.blockResources !== undefined &&
    typeof options.blockResources !== "boolean"
  ) {
    throw new Error(
      `Invalid blockResources option: must be boolean, got ${typeof options.blockResources}`
    );
  }
}

/**
 * 验证超时配置
 * @param timeout 超时时间（毫秒）
 * @param min 最小超时时间（毫秒）
 * @param max 最大超时时间（毫秒）
 * @throws {Error} 如果超时配置无效
 */
export function validateTimeout(
  timeout: number,
  min: number = 1000,
  max: number = 300000
): void {
  if (typeof timeout !== "number" || isNaN(timeout)) {
    throw new Error(`Invalid timeout: must be a number, got ${timeout}`);
  }
  if (timeout < min) {
    throw new Error(`Invalid timeout: must be >= ${min}ms, got ${timeout}ms`);
  }
  if (timeout > max) {
    throw new Error(`Invalid timeout: must be <= ${max}ms, got ${timeout}ms`);
  }
}
