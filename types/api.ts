/**
 * API Request/Response Type Definitions
 *
 * Shared types for frontend-backend API communication
 */

// ============================================================================
// Request Types
// ============================================================================

export type ScrapeType = "profile" | "thread" | "search" | "reddit";
export type ScrapeMode = "graphql" | "puppeteer" | "mixed";
export type RedditStrategy = "auto" | "super_full" | "super_recent" | "new";

export interface DateRange {
  start: string; // ISO date string
  end: string; // ISO date string
}

export interface ScrapeRequest {
  type: ScrapeType;
  input: string;
  limit?: number;
  likes?: boolean;
  mode?: ScrapeMode;
  dateRange?: DateRange;
  enableRotation?: boolean;
  /** Enable proxy usage (optional, default: false) */
  enableProxy?: boolean;
  /** Enable deep search with date chunking (optional, default: false) */
  enableDeepSearch?: boolean;
  /** Parallel chunks for date chunking (1=serial, 2-3=parallel, optional, default: 1) */
  parallelChunks?: number;
  /** Reddit only: subreddit scraping strategy */
  strategy?: RedditStrategy;
  /** 
   * Anti-detection level (optional, default: 'high')
   * - 'low': Basic fingerprint only
   * - 'medium': + Advanced fingerprint (Canvas/WebGL/Audio)
   * - 'high': + Human behavior simulation (recommended)
   * - 'paranoid': Full protection with realistic delays (slowest)
   */
  antiDetectionLevel?: 'low' | 'medium' | 'high' | 'paranoid';
}

export interface MonitorRequest {
  users: string[];
  lookbackHours?: number;
  keywords?: string;
  enableRotation?: boolean;
  /** Enable proxy usage (optional, default: false) */
  enableProxy?: boolean;
}

// ============================================================================
// Response Types
// ============================================================================

export interface ScrapeStats {
  count: number;
  [key: string]: any;
}

export interface PerformanceMetrics {
  totalTime?: number;
  apiCalls?: number;
  scrollCount?: number;
  sessionSwitches?: number;
  [key: string]: any;
}

export interface ScrapeResponse {
  success: boolean;
  message?: string;
  downloadUrl?: string;
  stats?: ScrapeStats;
  performance?: PerformanceMetrics;
  error?: string;
}

export interface MonitorResponse {
  success: boolean;
  message?: string;
  downloadUrl?: string;
  stats?: {
    totalNewTweets: number;
    users: Array<{
      username: string;
      newTweets: number;
    }>;
  };
  error?: string;
}

export interface ResultResponse {
  success: boolean;
  downloadUrl?: string;
  error?: string;
}

export interface StopResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// SSE Event Types
// ============================================================================

export interface LogEvent {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  timestamp?: string;
}

export interface ProgressEvent {
  current: number;
  total?: number;
  percentage?: number;
  status?: string;
}

export interface PerformanceEvent {
  metrics: PerformanceMetrics;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isScrapeRequest(body: any): body is ScrapeRequest {
  return (
    body &&
    typeof body === "object" &&
    ["profile", "thread", "search", "reddit"].includes(body.type) &&
    typeof body.input === "string"
  );
}

export function isMonitorRequest(body: any): body is MonitorRequest {
  return (
    body &&
    typeof body === "object" &&
    Array.isArray(body.users) &&
    body.users.length > 0
  );
}
