import type { ProfileInfo, Tweet } from '../types/tweet-definitions';
import type { RunContext } from '../utils';
import type { BrowserLaunchOptions } from './browser-manager';
import type { PerformanceStats } from './performance-monitor';
import type { ScraperDependencies } from './scraper-dependencies';

export interface ScraperLogger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

export interface ScraperEventBus {
  emitLog(message: string, level?: 'info' | 'warn' | 'error' | 'debug'): void;
  emitProgress(progress: { current: number; target: number; action: string }): void;
  emitError(error: Error): void;
  emitPerformance(data: any): void;
}

export interface ScraperEngineOptions {
  headless?: boolean;
  browserOptions?: BrowserLaunchOptions;
  sessionId?: string;
  
  /** Optional logger or callbacks */
  logger?: ScraperLogger;
  onProgress?: (progress: { current: number; target: number; action: string }) => void;

  /**
   * If true, only initialize API client, do not launch browser.
   * Suitable for pure GraphQL API mode.
   */
  apiOnly?: boolean;
  
  /** Dependency injection */
  dependencies?: ScraperDependencies;

  /** Linked BullMQ Job ID (for DB persistence) */
  jobId?: string;
  
  /**
   * Anti-detection level (default: 'high')
   */
  antiDetectionLevel?: 'low' | 'medium' | 'high' | 'paranoid';
}

export interface ScrapeTimelineConfig {
  username?: string;
  limit?: number;
  mode?: 'timeline' | 'search';
  searchQuery?: string;
  runContext?: RunContext;
  saveMarkdown?: boolean;
  saveScreenshots?: boolean;
  exportCsv?: boolean;
  exportJson?: boolean;
  outputDir?: string;
  tab?: 'likes' | 'replies';
  withReplies?: boolean;
  stopAtTweetId?: string;
  sinceTimestamp?: number;
  collectProfileInfo?: boolean;
  /** Scrape mode: 'graphql' (default) or 'puppeteer' */
  scrapeMode?: 'graphql' | 'puppeteer';
  /** API variant: 'graphql' (default) or 'rest' */
  apiVariant?: 'graphql' | 'rest';
  resume?: boolean;
  dateRange?: {
    start: string;
    end: string;
  };
  enableRotation?: boolean;
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
  /** Scrape mode: 'graphql' (default) or 'puppeteer' */
  scrapeMode?: 'graphql' | 'puppeteer';
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
