/**
 * Core Module Exports
 * 统一导出核心模块，建立清晰的模块边界
 */

// Engine
export { 
  ScraperEngine, 
  type ScraperEngineOptions,
  type ScrapeTimelineConfig,
  type ScrapeTimelineResult,
  type ScrapeThreadOptions,
  type ScrapeThreadResult
} from './scraper-engine';
export { createDefaultDependencies, type ScraperDependencies } from './scraper-dependencies';

// Errors
export {
  ScraperError,
  ErrorCode,
  ScraperErrors,
  ErrorClassifier,
  type ErrorContext,
  type ErrorResult,
  type SuccessResult,
  type Result,
  errorToResult,
  successResult
} from './errors';

// Event Bus
export { default as eventBus, default as eventBusInstance, type ScraperEventBus, type ScrapeProgressData, type LogMessageData } from './event-bus';

// Managers
export { BrowserManager, type BrowserLaunchOptions, type ProxyConfig } from './browser-manager';
export { BrowserPool, type BrowserPoolOptions } from './browser-pool';
export { CookieManager, type CookieManagerOptions, type CookieLoadResult } from './cookie-manager';
export { SessionManager, type Session } from './session-manager';
export { ProxyManager } from './proxy-manager';
export { RateLimitManager } from './rate-limit-manager';
export { ProgressManager } from './progress-manager';
export { PerformanceMonitor, type PerformanceStats } from './performance-monitor';


// Services
export { NavigationService } from './navigation-service';
export * from './data-extractor';
export { ErrorSnapshotter } from './error-snapshotter';
export { FingerprintManager } from './fingerprint-manager';
export { AntiDetection } from './anti-detection';
export { HumanBehavior } from './human-behavior';
export { AdvancedFingerprint } from './advanced-fingerprint';

export { XApiClient } from './x-api';

// Utilities
export { getShouldStopScraping, setShouldStopScraping, resetShouldStopScraping } from './stop-signal';

// Cookie Manager Factory
export { createCookieManager } from './cookie-manager';

// Queue System
export { scrapeQueue, scrapeQueueEvents, closeScrapeQueue } from './queue/scrape-queue';
export { createScrapeWorker, shutdownWorker } from './queue/worker';
export { redisConnection, redisPublisher, redisSubscriber, closeRedisConnections } from './queue/connection';
export type { ScrapeJobData, ScrapeJobResult, JobProgress, JobLog } from './queue/types';

// Platform adapters
export { registerAdapter, getAdapter, listAdapters } from './platforms/registry';
export type { PlatformAdapter, PlatformName, PlatformErrorCategory, NormalizedItem, CrawlJobConfig, CrawlTarget } from './platforms/types';
