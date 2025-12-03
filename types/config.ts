/**
 * Configuration types and interfaces
 * Centralized configuration management for the scraper
 */

/**
 * Export configuration options
 */
export interface ExportOptions {
  /** Save results as Markdown */
  markdown?: boolean;
  /** Export results as CSV */
  csv?: boolean;
  /** Export results as JSON */
  json?: boolean;
  /** Save screenshots during scraping */
  screenshots?: boolean;
}

/**
 * Retry strategy configuration
 */
export interface RetryOptions {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Base delay between retries (ms) */
  baseDelay?: number;
  /** Whether to use exponential backoff */
  exponentialBackoff?: boolean;
  /** Maximum delay between retries (ms) */
  maxDelay?: number;
}

/**
 * Browser pool configuration
 */
export interface BrowserPoolConfig {
  /** Maximum pool size */
  maxSize?: number;
  /** Minimum pool size */
  minSize?: number;
  /** Maximum browser idle time (ms) before closing */
  maxIdleTime?: number;
  /** Browser acquisition timeout (ms) */
  acquireTimeout?: number;
}

/**
 * Common scraper options
 */
export interface ScraperOptions {
  /** Export configuration */
  export?: ExportOptions;
  /** Retry configuration */
  retry?: RetryOptions;
  /** Browser pool configuration */
  browserPool?: BrowserPoolConfig;
  /** Output directory */
  outputDir?: string;
  /** Enable headless mode */
  headless?: boolean;
  /** Enable rotation between multiple accounts */
  enableRotation?: boolean;
  /** API-only mode (no browser) */
  apiOnly?: boolean;
  /** Browser user agent */
  userAgent?: string;
}

/**
 * Timeline scraping specific options
 */
export interface TimelineScrapeOptions {
  /** Username to scrape */
  username?: string;
  /** Search query for search mode */
  searchQuery?: string;
  /** Scraping mode: 'timeline' or 'search' */
  mode?: "timeline" | "search";
  /** Maximum number of tweets to scrape */
  limit?: number;
  /** Scraping technique: 'graphql', 'puppeteer', or 'mixed' */
  scrapeMode?: "graphql" | "puppeteer" | "mixed";
  /** Date range for search mode */
  dateRange?: { start: string; end: string };
  /** Enable deep search with date chunking */
  enableDeepSearch?: boolean;
  /** Number of parallel chunks for date chunking */
  parallelChunks?: number;
  /** Tab to scrape: 'likes' or 'replies' */
  tab?: "likes" | "replies";
  /** Include replies in timeline */
  withReplies?: boolean;
}

/**
 * Thread scraping specific options
 */
export interface ThreadScrapeOptions {
  /** Tweet URL to scrape */
  tweetUrl: string;
  /** Maximum number of replies to fetch */
  maxReplies?: number;
  /** Scraping technique: 'graphql' or 'puppeteer' */
  scrapeMode?: "graphql" | "puppeteer";
}

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Session ID */
  id: string;
  /** Cookies for the session */
  cookies: Record<string, string>[];
  /** Usage count */
  usageCount: number;
  /** Error count */
  errorCount: number;
  /** Consecutive failures */
  consecutiveFailures: number;
  /** Whether session is retired */
  isRetired: boolean;
  /** Cookie file path */
  filePath: string;
  /** Username associated with session */
  username?: string;
}

/**
 * Performance monitoring configuration
 */
export interface PerformanceConfig {
  /** Enable performance monitoring */
  enabled?: boolean;
  /** Enable detailed metrics collection */
  detailedMetrics?: boolean;
  /** Metrics collection interval (ms) */
  collectionInterval?: number;
}

/**
 * Complete configuration object
 */
export interface CompleteConfig {
  /** General scraper options */
  general: ScraperOptions;
  /** Timeline scraping options */
  timeline?: TimelineScrapeOptions;
  /** Thread scraping options */
  thread?: ThreadScrapeOptions;
  /** Session configuration */
  session?: {
    /** Directory containing cookie files */
    cookieDir?: string;
    /** Session management options */
    management?: {
      /** Enable automatic rotation */
      autoRotation?: boolean;
      /** Maximum consecutive failures before retiring session */
      maxConsecutiveFailures?: number;
    };
  };
  /** Performance monitoring configuration */
  performance?: PerformanceConfig;
  /** Error handling configuration */
  errorHandling?: {
    /** Enable error snapshotting */
    snapshotting?: boolean;
    /** Maximum retry attempts */
    maxRetryAttempts?: number;
    /** Retry delay base (ms) */
    retryDelayBase?: number;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: CompleteConfig = {
  general: {
    export: {
      markdown: true,
      csv: false,
      json: false,
      screenshots: false,
    },
    retry: {
      maxRetries: 3,
      baseDelay: 2000,
      exponentialBackoff: true,
      maxDelay: 10000,
    },
    browserPool: {
      maxSize: 3,
      minSize: 1,
      maxIdleTime: 30000,
      acquireTimeout: 30000,
    },
    outputDir: "./output",
    headless: true,
    enableRotation: true,
    apiOnly: false,
  },
  timeline: {
    limit: 50,
    scrapeMode: "graphql",
    mode: "timeline",
    withReplies: false,
    enableDeepSearch: false,
    parallelChunks: 1,
  },
  thread: {
    tweetUrl: '',
    maxReplies: 100,
    scrapeMode: "graphql",
  },
  session: {
    cookieDir: "./cookies",
    management: {
      autoRotation: true,
      maxConsecutiveFailures: 3,
    },
  },
  performance: {
    enabled: true,
    detailedMetrics: false,
    collectionInterval: 1000,
  },
  errorHandling: {
    snapshotting: true,
    maxRetryAttempts: 2,
    retryDelayBase: 1000,
  },
};

/**
 * Validate configuration object
 * @param config Configuration to validate
 * @throws {Error} If configuration is invalid
 */
export function validateConfig(config: Partial<CompleteConfig>): void {
  if (!config.general) {
    return; // Empty config is valid
  }

  const { general } = config;

  if (general.outputDir && typeof general.outputDir !== "string") {
    throw new Error("outputDir must be a string");
  }

  if (general.headless !== undefined && typeof general.headless !== "boolean") {
    throw new Error("headless must be a boolean");
  }

  if (
    general.enableRotation !== undefined &&
    typeof general.enableRotation !== "boolean"
  ) {
    throw new Error("enableRotation must be a boolean");
  }

  if (general.apiOnly !== undefined && typeof general.apiOnly !== "boolean") {
    throw new Error("apiOnly must be a boolean");
  }

  if (general.export) {
    const { export: exportOpts } = general;
    if (
      exportOpts.markdown !== undefined &&
      typeof exportOpts.markdown !== "boolean"
    ) {
      throw new Error("export.markdown must be a boolean");
    }
    if (exportOpts.csv !== undefined && typeof exportOpts.csv !== "boolean") {
      throw new Error("export.csv must be a boolean");
    }
    if (exportOpts.json !== undefined && typeof exportOpts.json !== "boolean") {
      throw new Error("export.json must be a boolean");
    }
    if (
      exportOpts.screenshots !== undefined &&
      typeof exportOpts.screenshots !== "boolean"
    ) {
      throw new Error("export.screenshots must be a boolean");
    }
  }

  if (config.timeline?.limit !== undefined) {
    if (
      typeof config.timeline.limit !== "number" ||
      config.timeline.limit < 1
    ) {
      throw new Error("timeline.limit must be a positive number");
    }
    if (config.timeline.limit > 10000) {
      throw new Error("timeline.limit must be <= 10000");
    }
  }

  if (
    config.timeline?.scrapeMode &&
    !["graphql", "puppeteer", "mixed"].includes(config.timeline.scrapeMode)
  ) {
    throw new Error(
      "timeline.scrapeMode must be 'graphql', 'puppeteer', or 'mixed'"
    );
  }

  if (
    config.thread?.scrapeMode &&
    !["graphql", "puppeteer"].includes(config.thread.scrapeMode)
  ) {
    throw new Error("thread.scrapeMode must be 'graphql' or 'puppeteer'");
  }
}

/**
 * Merge user configuration with defaults
 * @param userConfig User configuration
 * @returns Merged configuration
 */
export function mergeConfig(
  userConfig: Partial<CompleteConfig>
): CompleteConfig {
  const merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CompleteConfig;

  // Deep merge function
  function deepMerge(target: any, source: any): any {
    if (source && typeof source === "object") {
      Object.keys(source).forEach((key) => {
        if (
          source[key] &&
          typeof source[key] === "object" &&
          !Array.isArray(source[key])
        ) {
          if (!target[key] || typeof target[key] !== "object") {
            target[key] = {};
          }
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      });
    }
    return target;
  }

  return deepMerge(merged, userConfig);
}
