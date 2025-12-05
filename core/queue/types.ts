/**
 * Queue Type Definitions
 * 
 * Types for BullMQ job data, results, progress, and logs
 */

export interface ScrapeJobData {
  jobId: string;
  type: 'twitter' | 'reddit' | string;
  config: {
    // Twitter options
    username?: string;
    tweetUrl?: string;
    searchQuery?: string;
    limit?: number;
    mode?: 'puppeteer' | 'graphql' | 'mixed';
    likes?: boolean;
    tab?: 'posts' | 'likes' | 'replies'; // 'posts' is the default, but we don't pass it to scrapeTimeline
    
    // Reddit options
    subreddit?: string;
    postUrl?: string;
    strategy?: string;
    
    // Common options
    enableRotation?: boolean;
    enableProxy?: boolean;
    dateRange?: { start: string; end: string };
    antiDetectionLevel?: 'low' | 'medium' | 'high' | 'paranoid';
  };
}

export interface ScrapeJobResult {
  success: boolean;
  downloadUrl?: string;
  stats?: {
    count: number;
    duration: number;
  };
  error?: string;
  performance?: any;
}

export interface JobProgress {
  current: number;
  target: number;
  action: string;
  percentage?: number;
}

export interface JobLog {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}
