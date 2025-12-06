/**
 * Worker Processor for Scraping Jobs
 *
 * Uses platform adapters to execute scraping tasks from the queue
 */

import { Job, UnrecoverableError, Worker } from 'bullmq';
import { getConfigManager } from '../../utils/config-manager';
import { createEnhancedLogger } from '../../utils/logger';
import { JobRepository } from '../db/job-repo';
import { ErrorClassifier } from '../errors';
import { redditAdapter } from '../platforms/reddit-adapter';
// import { getAdapter, registerAdapter } from '../platforms/registry'; // Removed
import { twitterAdapter } from '../platforms/twitter-adapter';
import { AdapterJobContext } from '../platforms/types';
import { redisConnection, redisPublisher } from './connection';
import { JobLog, JobProgress, ScrapeJobData, ScrapeJobResult } from './types';

const logger = createEnhancedLogger('Worker');
const config = getConfigManager();

const CANCELLATION_PREFIX = 'job:cancelled:';
const CANCELLATION_EXPIRY = 3600; // 1 hour

/**
 * Mark a job as cancelled
 * Called from the cancel API endpoint
 */
export async function markJobAsCancelled(jobId: string): Promise<void> {
  const key = `${CANCELLATION_PREFIX}${jobId}`;
  await redisConnection.set(key, Date.now(), 'EX', CANCELLATION_EXPIRY);
  logger.info(`Job ${jobId} marked for cancellation in Redis`);
}

/**
 * Check if a job has been cancelled
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const key = `${CANCELLATION_PREFIX}${jobId}`;
  const exists = await redisConnection.exists(key);
  return exists === 1;
}

// Register built-in adapters (removed in favor of explicit switch case)
// twitterAdapter and redditAdapter are imported directly

/**
 * Safely serialize error objects (handles Axios circular references)
 */
// biome-ignore lint/suspicious/noExplicitAny: error handling
function serializeError(error: any): any {
  if (!error) return null;

  // Handle Axios errors specifically
  if (error.isAxiosError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      method: error.config?.method,
      stack: error.stack,
    };
  }

  // Handle standard errors
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code,
    stack: error.stack,
  };
}

/**
 * Job Context - encapsulates job-specific event handling
 */
class JobContext implements AdapterJobContext {
  constructor(private job: Job<ScrapeJobData>) {}

  /**
   * Emit progress update
   */
  async emitProgress(progress: JobProgress) {
    const percentage =
      progress.target > 0 ? Math.round((progress.current / progress.target) * 100) : 0;

    await this.job.updateProgress({
      ...progress,
      percentage,
    });

    await redisPublisher.publish(
      `job:${this.job.id}:progress`,
      JSON.stringify({ ...progress, percentage }),
    );
  }

  /**
   * Emit log message
   */
  async emitLog(log: JobLog) {
    await redisPublisher.publish(`job:${this.job.id}:log`, JSON.stringify(log));
  }

  /**
   * Check if job should stop (cancelled by user)
   */
  async getShouldStop(): Promise<boolean> {
    return isJobCancelled(this.job.id || '');
  }

  /**
   * Log helper
   */
  async log(message: string, level: JobLog['level'] = 'info') {
    return this.emitLog({
      level,
      message,
      timestamp: Date.now(),
    });
  }
}

/**
 * Create and configure the worker
 */
export function createScrapeWorker(concurrency?: number) {
  const queueConfig = config.getQueueConfig();
  const workerConcurrency = concurrency || queueConfig.concurrency;

  logger.info('Creating scrape worker', { concurrency: workerConcurrency });

  const worker = new Worker<ScrapeJobData, ScrapeJobResult>(
    'scraper',
    async (job) => {
      const ctx = new JobContext(job);
      const { type, jobId } = job.data;

      logger.info(`Processing job ${job.id}`, { type, jobId });

      // Mark job as active in PostgreSQL
      if (jobId) {
        try {
          await JobRepository.updateStatus(jobId, 'active');
        } catch (_e) {
          logger.debug('Could not update job status to active', { jobId });
        }
      }

      try {
        let result: ScrapeJobResult;

        if (type === 'twitter') {
          if (twitterAdapter.init) await twitterAdapter.init();
          result = await twitterAdapter.process(job.data, ctx);
        } else if (type === 'reddit') {
          if (redditAdapter.init) await redditAdapter.init();
          result = await redditAdapter.process(job.data, ctx);
        } else {
          throw new Error(`Unknown job type: ${type}`);
        }

        // Check for cancellation one last time before marking as completed
        // This prevents race conditions where a user cancels just as the job finishes
        if (jobId && (await isJobCancelled(jobId))) {
          throw new Error('Job cancelled by user');
        }

        // Mark job as completed in PostgreSQL
        if (jobId) {
          try {
            await JobRepository.updateStatus(jobId, 'completed');
          } catch (_e) {
            logger.debug('Could not update job status to completed', { jobId });
          }
        }

        return result;
        // biome-ignore lint/suspicious/noExplicitAny: error handling
      } catch (error: any) {
        const scraperError = ErrorClassifier.classify(error);
        const serializedError = serializeError(error);

        // Standardize cancellation error message
        if (error.message === 'Job cancelled by user') {
          // error is already classified as UNKNOWN_ERROR (retryable=false) by default
        }

        // Log error and update status to failed in PostgreSQL
        if (job.data.jobId) {
          try {
            // For cancelled jobs, we might want to set a specific status if DB supports it,
            // but for now 'failed' with the specific message works with the frontend logic.
            await JobRepository.updateStatus(job.data.jobId, 'failed', scraperError.message);
            await JobRepository.logError({
              jobId: job.data.jobId,
              severity: 'error',
              category: scraperError.code || 'UNKNOWN',
              message: scraperError.message,
              stack: scraperError.stack,
              context: serializedError, // Use serialized version
            });
          } catch (dbError) {
            logger.error('Failed to log error to DB', dbError as Error);
          }
        }

        logger.error(`Job ${job.id} failed: ${scraperError.message}`, {
          errorCode: scraperError.code,
          retryable: scraperError.retryable,
          errorMessage: scraperError.message,
          errorContext: scraperError.context,
          originalError: serializedError, // Use serialized version
          // biome-ignore lint/suspicious/noExplicitAny: error serialization
        } as any);

        if (!scraperError.retryable) {
          logger.warn(`Job ${job.id} error is not retryable. Moving to failed.`);
          throw new UnrecoverableError(scraperError.message);
        }

        throw error; // BullMQ will handle retries based on backoff config
      }
    },
    {
      connection: redisConnection,
      concurrency: workerConcurrency, // 🔥 Key: Control parallelism
      limiter: {
        max: queueConfig.rateLimit.max,
        duration: queueConfig.rateLimit.duration,
      },
    },
  );

  // Worker event handlers
  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed`, {
      type: job.data.type,
      stats: job.returnvalue?.stats,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, {
      type: job?.data?.type,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker error', err);
  });

  worker.on('active', (job) => {
    logger.info(`Job ${job.id} started`, { type: job.data.type });
  });

  return worker;
}

/**
 * Graceful worker shutdown
 */
export async function shutdownWorker(worker: Worker): Promise<void> {
  logger.info('Shutting down worker...');
  await worker.close();
  logger.info('Worker shut down');
}
