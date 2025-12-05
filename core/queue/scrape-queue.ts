/**
 * Scrape Queue Definition
 * 
 * BullMQ queue for managing scraping tasks
 */

import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from './connection';
import { ScrapeJobData, ScrapeJobResult } from './types';
import { createEnhancedLogger } from '../../utils/logger';

const logger = createEnhancedLogger('ScrapeQueue');

// Lazy-initialized queue instances
let _scrapeQueue: Queue<ScrapeJobData, ScrapeJobResult> | null = null;
let _scrapeQueueEvents: QueueEvents | null = null;

/**
 * Get the scrape queue (lazy initialization)
 */
export function getScrapeQueue(): Queue<ScrapeJobData, ScrapeJobResult> {
  if (!_scrapeQueue) {
    logger.info('Initializing BullMQ scrape queue...');
    _scrapeQueue = new Queue<ScrapeJobData, ScrapeJobResult>('scraper', {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 3600,
          count: 100,
        },
        removeOnFail: {
          age: 86400,
        },
      },
    });
    logger.info('BullMQ scrape queue initialized');
  }
  return _scrapeQueue;
}

/**
 * Get queue events (lazy initialization)
 */
export function getScrapeQueueEvents(): QueueEvents {
  if (!_scrapeQueueEvents) {
    logger.info('Initializing BullMQ queue events...');
    _scrapeQueueEvents = new QueueEvents('scraper', {
      connection: redisConnection,
    });

    // Event listeners for monitoring
    _scrapeQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      const stats = (returnvalue as any)?.stats;
      logger.info('Job completed', { jobId, stats });
    });

    _scrapeQueueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Job failed', new Error(failedReason || 'Unknown error'), { jobId });
    });

    _scrapeQueueEvents.on('progress', ({ jobId, data }) => {
      logger.debug('Job progress', { jobId, progress: data });
    });

    logger.info('BullMQ queue events initialized');
  }
  return _scrapeQueueEvents;
}

// Legacy export for compatibility (lazy getter)
export const scrapeQueue = {
  get queue() { return getScrapeQueue(); },
  add: (...args: Parameters<Queue<ScrapeJobData, ScrapeJobResult>['add']>) => getScrapeQueue().add(...args),
  getJob: (id: string) => getScrapeQueue().getJob(id),
  getJobs: (...args: Parameters<Queue['getJobs']>) => getScrapeQueue().getJobs(...args),
  getWaiting: (start?: number, end?: number) => getScrapeQueue().getWaiting(start, end),
  getActive: (start?: number, end?: number) => getScrapeQueue().getActive(start, end),
  getCompleted: (start?: number, end?: number) => getScrapeQueue().getCompleted(start, end),
  getFailed: (start?: number, end?: number) => getScrapeQueue().getFailed(start, end),
  getDelayed: (start?: number, end?: number) => getScrapeQueue().getDelayed(start, end),
  getWaitingCount: () => getScrapeQueue().getWaitingCount(),
  getActiveCount: () => getScrapeQueue().getActiveCount(),
  getCompletedCount: () => getScrapeQueue().getCompletedCount(),
  getFailedCount: () => getScrapeQueue().getFailedCount(),
  getDelayedCount: () => getScrapeQueue().getDelayedCount(),
  getJobLogs: (id: string) => getScrapeQueue().getJobLogs(id),
  clean: (...args: Parameters<Queue['clean']>) => getScrapeQueue().clean(...args),
  pause: () => getScrapeQueue().pause(),
  resume: () => getScrapeQueue().resume(),
  close: () => getScrapeQueue().close(),
};

export const scrapeQueueEvents = {
  get events() { return getScrapeQueueEvents(); },
  close: () => getScrapeQueueEvents().close(),
};

/**
 * Graceful shutdown
 */
export async function closeScrapeQueue(): Promise<void> {
  logger.info('Closing scrape queue...');
  if (_scrapeQueue) await _scrapeQueue.close();
  if (_scrapeQueueEvents) await _scrapeQueueEvents.close();
  logger.info('Scrape queue closed');
}

