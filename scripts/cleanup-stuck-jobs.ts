#!/usr/bin/env bun
/**
 * Cleanup Stuck Jobs Script
 * 
 * This script helps clean up stuck/cancelled jobs from Redis and PostgreSQL
 * 
 * Usage:
 *   bun run scripts/cleanup-stuck-jobs.ts
 *   bun run scripts/cleanup-stuck-jobs.ts --force  # Force cleanup all active jobs
 */

import { redisConnection } from '../core/queue/connection';
import { scrapeQueue } from '../core/queue/scrape-queue';
import { JobRepository } from '../core/db/job-repo';
import { createEnhancedLogger } from '../utils/logger';

const logger = createEnhancedLogger('CleanupScript');

const CANCELLATION_PREFIX = 'job:cancelled:';

async function cleanupStuckJobs(force: boolean = false) {
  try {
    logger.info('Starting cleanup of stuck jobs...');

    // 1. Get all active jobs from Redis
    const activeJobs = await scrapeQueue.getActive(0, 100);
    logger.info(`Found ${activeJobs.length} active jobs in Redis`);

    // 2. Check each active job
    const stuckJobs: string[] = [];
    for (const job of activeJobs) {
      const jobId = job.id || '';
      const state = await job.getState();
      
      // Check if job is marked as cancelled
      const cancelledKey = `${CANCELLATION_PREFIX}${jobId}`;
      const isCancelled = await redisConnection.exists(cancelledKey);
      
      if (isCancelled || force) {
        logger.info(`Found ${isCancelled ? 'cancelled' : 'active'} job: ${jobId} (state: ${state})`);
        stuckJobs.push(jobId);
      }
    }

    if (stuckJobs.length === 0) {
      logger.info('No stuck jobs found');
      return;
    }

    logger.info(`Found ${stuckJobs.length} stuck jobs to clean up`);

    // 3. Remove jobs from Redis queue
    for (const jobId of stuckJobs) {
      try {
        const job = await scrapeQueue.getJob(jobId);
        if (job) {
          const state = await job.getState();
          if (state === 'active' || state === 'waiting' || state === 'delayed') {
            await job.remove();
            logger.info(`Removed job ${jobId} from Redis queue (was ${state})`);
          }
        }
      } catch (error) {
        logger.warn(`Failed to remove job ${jobId} from Redis:`, error);
      }
    }

    // 4. Clean up cancellation markers
    for (const jobId of stuckJobs) {
      try {
        const cancelledKey = `${CANCELLATION_PREFIX}${jobId}`;
        await redisConnection.del(cancelledKey);
        logger.info(`Cleaned up cancellation marker for job ${jobId}`);
      } catch (error) {
        logger.warn(`Failed to clean cancellation marker for ${jobId}:`, error);
      }
    }

    // 5. Update PostgreSQL job status
    for (const jobId of stuckJobs) {
      try {
        await JobRepository.updateStatus(jobId, 'failed', 'Job cancelled and cleaned up');
        logger.info(`Updated job ${jobId} status in PostgreSQL`);
      } catch (error) {
        logger.warn(`Failed to update job ${jobId} in PostgreSQL:`, error);
      }
    }

    logger.info(`Cleanup completed! Processed ${stuckJobs.length} jobs`);
  } catch (error) {
    logger.error('Cleanup failed:', error);
    throw error;
  }
}

// Main execution
const force = process.argv.includes('--force');

if (force) {
  logger.warn('⚠️  FORCE MODE: Will clean up ALL active jobs');
}

cleanupStuckJobs(force)
  .then(() => {
    logger.info('Cleanup script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Cleanup script failed:', error);
    process.exit(1);
  });



