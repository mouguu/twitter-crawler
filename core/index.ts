/**
 * Core Module Exports
 * 统一导出核心模块，建立清晰的模块边界
 */

// Managers
export { type BrowserLaunchOptions, BrowserManager, type ProxyConfig } from './browser-manager';
export { AntiDetection } from './anti-detection';
// Cookie Manager Factory
export {
  type CookieLoadResult,
  CookieManager,
  type CookieManagerOptions,
  createCookieManager,
} from './cookie-manager';
export * from './data-extractor';
export { ErrorSnapshotter } from './error-snapshotter';
// Errors
export {
  ErrorClassifier,
  ErrorCode,
  type ErrorContext,
  type ErrorResult,
  errorToResult,
  type Result,
  ScraperError,
  ScraperErrors,
  type SuccessResult,
  successResult,
} from './errors';
export { FingerprintManager } from './fingerprint-manager';
export { HumanBehavior } from './human-behavior';

// Services
export { NavigationService } from './navigation-service';
export { PerformanceMonitor, type PerformanceStats } from './performance-monitor';
// Platform adapters
// export { getAdapter, listAdapters, registerAdapter } from './platforms/registry'; // Removed
export type {
  CrawlJobConfig,
  CrawlTarget,
  NormalizedItem,
  PlatformAdapter,
  PlatformErrorCategory,
  PlatformName,
} from './platforms/types';
export { ProgressManager } from './progress-manager';
export { ProxyManager } from './proxy-manager';
export {
  closeRedisConnections,
  redisConnection,
  redisPublisher,
  redisSubscriber,
} from './queue/connection';
// Queue System
export { closeScrapeQueue, scrapeQueue, scrapeQueueEvents } from './queue/scrape-queue';
export type { JobLog, JobProgress, ScrapeJobData, ScrapeJobResult } from './queue/types';
export {
  createScrapeWorker,
  isJobCancelled,
  markJobAsCancelled,
  shutdownWorker,
} from './queue/worker';
export { RateLimitManager } from './rate-limit-manager';
export { createDefaultDependencies, type ScraperDependencies } from './scraper-dependencies';
// Engine
export {
  ScraperEngine,
  type ScraperEngineOptions,
  type ScrapeThreadOptions,
  type ScrapeThreadResult,
  type ScrapeTimelineConfig,
  type ScrapeTimelineResult,
} from './scraper-engine';
export { type Session, SessionManager } from './session-manager';
// Utilities
export {
  getShouldStopScraping,
  resetShouldStopScraping,
  setShouldStopScraping,
} from './stop-signal';
export { XApiClient } from './x-api';
export * from './scrape-unified';
