import type { BrowserLaunchOptions } from "./browser-manager";
import type { BrowserPool, BrowserPoolOptions } from "./browser-pool";
import type { ScraperEventBus } from "./event-bus";
import type { ScraperDependencies } from "./scraper-dependencies";
import type { RunContext } from "../utils";
import type { Tweet, ProfileInfo } from "../types/tweet-definitions";
import type { PerformanceStats } from "./performance-monitor";

export interface ScraperEngineOptions {
  headless?: boolean;
  browserOptions?: BrowserLaunchOptions;
  sessionId?: string;
  eventBus?: ScraperEventBus;
  /**
   * 如果为 true，只初始化 API 客户端，不启动浏览器
   * 适用于纯 GraphQL API 模式，节省资源
   */
  apiOnly?: boolean;
  /** 依赖注入（用于测试和自定义配置） */
  dependencies?: ScraperDependencies;
  /** 
   * 浏览器池选项（可选功能，默认关闭）
   * 仅在需要批量爬取多个任务时启用，可以复用浏览器实例节省启动时间
   * 对于单任务场景，每次创建新浏览器即可，不需要启用此功能
   */
  browserPoolOptions?: BrowserPoolOptions;
  /** 
   * 浏览器池实例（可选功能，默认关闭）
   * 如果提供，直接使用此实例；否则根据 browserPoolOptions 创建
   */
  browserPool?: BrowserPool;
  /** Linked BullMQ Job ID (for DB persistence) */
  jobId?: string;
}

export interface ScrapeTimelineConfig {
  username?: string;
  limit?: number;
  mode?: "timeline" | "search";
  searchQuery?: string;
  runContext?: RunContext;
  saveMarkdown?: boolean;
  saveScreenshots?: boolean;
  exportCsv?: boolean;
  exportJson?: boolean;
  outputDir?: string;
  tab?: "likes" | "replies";
  withReplies?: boolean;
  stopAtTweetId?: string;
  sinceTimestamp?: number;
  collectProfileInfo?: boolean;
  /** 爬取模式: 'graphql' 使用 API (默认), 'puppeteer' 使用 DOM, 'mixed' 先 API 后 DOM 补深度 */
  scrapeMode?: "graphql" | "puppeteer" | "mixed";
  /** API 变体: 默认 GraphQL；如果希望用 v1.1 + max_id/tweet_mode=extended，请设置为 'rest' */
  apiVariant?: "graphql" | "rest";
  resume?: boolean;
  dateRange?: {
    start: string;
    end: string;
  };
  enableRotation?: boolean;
  /** Internal use: offset progress current/target when doing mixed模式 DOM 续跑 */
  progressBase?: number;
  progressTarget?: number;
  /** 
   * 并行处理chunks的数量（仅适用于日期分块模式）
   * 默认：1（串行处理）
   * 建议：2-3（避免触发Twitter限流）
   * 需要浏览器池支持，会自动启用浏览器池
   */
  parallelChunks?: number;
  jobId?: string;
}

export interface ScrapeTimelineResult {
  success: boolean;
  tweets: Tweet[];
  runContext?: RunContext;
  profile?: ProfileInfo | null;
  error?: string;
  code?: string;
  retryable?: boolean;
  performance?: PerformanceStats;
}

export interface ScrapeThreadOptions {
  tweetUrl: string;
  maxReplies?: number;
  runContext?: RunContext;
  saveMarkdown?: boolean;
  exportCsv?: boolean;
  exportJson?: boolean;
  outputDir?: string;
  headless?: boolean;
  sessionId?: string;
  /** 爬取模式: 'graphql' 使用 API (默认), 'puppeteer' 使用 DOM */
  scrapeMode?: "graphql" | "puppeteer";
  jobId?: string;
}

export interface ScrapeThreadResult {
  success: boolean;
  tweets: Tweet[];
  originalTweet?: Tweet | null;
  replies?: Tweet[];
  runContext?: RunContext;
  error?: string;
  code?: string;
  retryable?: boolean;
  performance?: PerformanceStats;
}

