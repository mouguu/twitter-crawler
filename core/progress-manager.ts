import * as fs from 'node:fs';
import * as path from 'node:path';
import { safeJsonParse } from '../utils';
import { CheckpointRepository } from './db/checkpoint-repo';
import { ScraperEventBus } from './scraper-engine.types';

export interface ScrapingProgress {
  jobId?: string; // Link to DB job
  targetType: string;
  targetValue: string;
  totalRequested: number;
  totalScraped: number;
  lastTweetId?: string;
  lastCursor?: string;
  oldestTweetId?: string;
  startTime: number;
  lastUpdate: number;
  accountsUsed: string[];
  completed: boolean;
  dateRange?: {
    since: string;
    until: string;
  };
  currentChunkIndex?: number; // For date chunking
  totalChunks?: number; // For date chunking
  lastDomScrollCount?: number; // Track scroll attempts in DOM mode
}

export class ProgressManager {
  private progressDir: string;
  private currentProgress: ScrapingProgress | null = null;
  private eventBus?: ScraperEventBus;

  constructor(progressDir: string = './data/progress', eventBus?: ScraperEventBus) {
    this.progressDir = progressDir;
    this.eventBus = eventBus;
    this.ensureProgressDir();
  }

  private ensureProgressDir(): void {
    if (!fs.existsSync(this.progressDir)) {
      fs.mkdirSync(this.progressDir, { recursive: true });
    }
  }

  private getProgressFilePath(targetType: string, targetValue: string): string {
    const cleanTarget = targetValue.replace(/[@ /]/g, '_');
    return path.join(this.progressDir, `${targetType}_${cleanTarget}_progress.json`);
  }

  public async loadProgress(
    targetType: string,
    targetValue: string,
    jobId?: string,
  ): Promise<ScrapingProgress | null> {
    // 1. Try DB first if jobId is provided
    if (jobId) {
      try {
        const checkpoint = await CheckpointRepository.getCheckpoint(jobId, 'progress_state');
        if (checkpoint) {
          const progress = safeJsonParse(checkpoint) as ScrapingProgress;
          this.log(
            `Loaded progress from DB for job ${jobId}: ${progress.totalScraped}/${progress.totalRequested}`,
          );
          return progress;
        }
      } catch (error: any) {
        this.log(`Failed to load progress from DB: ${error.message}`, 'warn');
      }
    }

    // 2. Fallback to file system (legacy)
    const filePath = this.getProgressFilePath(targetType, targetValue);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const progress = safeJsonParse(data) as ScrapingProgress;
      this.log(
        `Loaded progress from file: ${progress.totalScraped}/${progress.totalRequested} tweets`,
      );
      return progress;
    } catch (error: any) {
      this.log(`Failed to load progress from file: ${error.message}`, 'error');
      return null;
    }
  }

  public async saveProgress(progress: ScrapingProgress): Promise<boolean> {
    try {
      progress.lastUpdate = Date.now();

      // 1. Save to DB if jobId is present
      if (progress.jobId) {
        await CheckpointRepository.saveCheckpoint(
          progress.jobId,
          'progress_state',
          JSON.stringify(progress),
          {
            totalScraped: progress.totalScraped,
            completed: progress.completed,
            lastCursor: progress.lastCursor,
          },
        );

        // Also save specific checkpoints for easier querying
        if (progress.lastCursor) {
          await CheckpointRepository.saveCheckpoint(
            progress.jobId,
            'timeline_cursor',
            progress.lastCursor,
          );
        }
        if (progress.lastTweetId) {
          await CheckpointRepository.saveCheckpoint(
            progress.jobId,
            'last_tweet_id',
            progress.lastTweetId,
          );
        }
      }

      // 2. Save to file system (backup/legacy)
      const filePath = this.getProgressFilePath(progress.targetType, progress.targetValue);
      fs.writeFileSync(filePath, JSON.stringify(progress, null, 2), 'utf-8');

      return true;
    } catch (error: any) {
      this.log(`Failed to save progress: ${error.message}`, 'error');
      return false;
    }
  }

  public async startScraping(
    targetType: string,
    targetValue: string,
    totalRequested: number,
    resume: boolean = false,
    dateRange?: { since: string; until: string },
    jobId?: string,
  ): Promise<ScrapingProgress> {
    if (resume) {
      const existingProgress = await this.loadProgress(targetType, targetValue, jobId);
      if (existingProgress && !existingProgress.completed) {
        // Update total requested if it changed
        if (existingProgress.totalRequested !== totalRequested) {
          existingProgress.totalRequested = totalRequested;
        }
        // Ensure jobId is linked if it wasn't before
        if (jobId && !existingProgress.jobId) {
          existingProgress.jobId = jobId;
        }
        this.currentProgress = existingProgress;
        this.log(`Resuming scraping from ${existingProgress.totalScraped} tweets`);
        return existingProgress;
      }
    }

    this.currentProgress = {
      jobId,
      targetType,
      targetValue,
      totalRequested,
      totalScraped: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      accountsUsed: [],
      completed: false,
      dateRange,
    };

    await this.saveProgress(this.currentProgress);
    this.log(`Started new scraping session: 0/${totalRequested} tweets`);
    return this.currentProgress;
  }

  public async updateProgress(
    tweetsScraped: number,
    lastTweetId?: string,
    lastCursor?: string,
    accountUsed?: string,
    chunkInfo?: { current: number; total: number },
    oldestTweetId?: string,
    lastDomScrollCount?: number,
  ): Promise<boolean> {
    if (!this.currentProgress) {
      return false;
    }

    this.currentProgress.totalScraped = tweetsScraped; // This should be total accumulated, not delta

    if (lastTweetId) {
      this.currentProgress.lastTweetId = lastTweetId;
    }

    if (lastCursor) {
      this.currentProgress.lastCursor = lastCursor;
    }

    if (oldestTweetId) {
      this.currentProgress.oldestTweetId = oldestTweetId;
    }

    if (lastDomScrollCount !== undefined) {
      this.currentProgress.lastDomScrollCount = lastDomScrollCount;
    }

    if (accountUsed && !this.currentProgress.accountsUsed.includes(accountUsed)) {
      this.currentProgress.accountsUsed.push(accountUsed);
    }

    if (chunkInfo) {
      this.currentProgress.currentChunkIndex = chunkInfo.current;
      this.currentProgress.totalChunks = chunkInfo.total;
    }

    if (this.currentProgress.totalScraped >= this.currentProgress.totalRequested) {
      this.currentProgress.completed = true;
      this.log(`Scraping completed: ${this.currentProgress.totalScraped} tweets`);
    }

    return this.saveProgress(this.currentProgress);
  }

  public async completeScraping(): Promise<boolean> {
    if (!this.currentProgress) {
      return false;
    }
    this.currentProgress.completed = true;
    return this.saveProgress(this.currentProgress);
  }

  public getCurrentProgress(): ScrapingProgress | null {
    return this.currentProgress;
  }

  private log(message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void {
    if (this.eventBus) {
      this.eventBus.emitLog(message, level);
    } else {
      console.log(`[ProgressManager] ${message}`);
    }
  }
}
