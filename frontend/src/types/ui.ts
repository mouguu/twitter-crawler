export type TabType = "profile" | "thread" | "search" | "reddit";

export interface Progress {
  current: number;
  target: number;
}

export interface PerformanceStats {
  totalDuration: number;
  navigationTime: number;
  scrollTime: number;
  extractionTime: number;
  tweetsCollected: number;
  tweetsPerSecond: number;
  scrollCount: number;
  sessionSwitches: number;
  rateLimitHits: number;
  peakMemoryUsage: number;
  currentMemoryUsage: number;
  phases?: { name: string; duration: number; percentage: number }[];
  apiRequestTime?: number;
  apiRequestCount?: number;
  apiParseTime?: number;
  apiAverageLatency?: number;
  apiRetryCount?: number;
  rateLimitWaitTime?: number;
  mode?: "graphql" | "puppeteer" | "mixed";
}
