#!/usr/bin/env bun
/**
 * Force Cancel Job Script
 *
 * 强制取消指定任务（紧急情况使用）
 *
 * Usage:
 *   bun run scripts/force-cancel-job.ts <jobId>
 *   bun run scripts/force-cancel-job.ts 14
 */

import { redisConnection } from '../core/queue/connection';
import { scrapeQueue } from '../core/queue/scrape-queue';
import { JobRepository } from '../core/db/job-repo';
import { createEnhancedLogger } from '../utils/logger';

const logger = createEnhancedLogger('ForceCancel');

const CANCELLATION_PREFIX = 'job:cancelled:';

async function forceCancelJob(jobId: string) {
  try {
    logger.info(`Force cancelling job ${jobId}...`);

    // 1. 设置取消标记（立即生效）
    const cancelledKey = `${CANCELLATION_PREFIX}${jobId}`;
    await redisConnection.set(cancelledKey, Date.now(), 'EX', 3600);
    logger.info(`✓ Set cancellation marker in Redis`);

    // 2. 尝试从队列中移除任务
    try {
      const job = await scrapeQueue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        logger.info(`Job ${jobId} current state: ${state}`);

        if (state === 'active') {
          // 对于活跃任务，标记为失败（因为无法直接中断）
          await job.moveToFailed(new Error('Force cancelled by user'), '0');
          logger.info(`✓ Moved active job to failed state`);
        } else if (state === 'waiting' || state === 'delayed') {
          // 对于等待中的任务，直接删除
          await job.remove();
          logger.info(`✓ Removed ${state} job from queue`);
        }
      } else {
        logger.warn(`Job ${jobId} not found in queue`);
      }
    } catch (error) {
      logger.warn(`Failed to remove job from queue:`, error);
    }

    // 3. 更新 PostgreSQL 状态
    try {
      await JobRepository.updateStatus(jobId, 'failed', 'Force cancelled by user');
      logger.info(`✓ Updated job status in PostgreSQL`);
    } catch (error) {
      logger.warn(`Failed to update PostgreSQL:`, error);
    }

    // 4. 清理取消标记（可选，保留也可以）
    // await redisConnection.del(cancelledKey);

    logger.info(`✅ Job ${jobId} force cancelled successfully!`);
    logger.info(`Note: If the job is currently running, it will stop on the next cancellation check.`);
  } catch (error) {
    logger.error('Force cancel failed:', error);
    throw error;
  }
}

// Main execution
const jobId = process.argv[2];

if (!jobId) {
  console.error('Usage: bun run scripts/force-cancel-job.ts <jobId>');
  console.error('Example: bun run scripts/force-cancel-job.ts 14');
  process.exit(1);
}

forceCancelJob(jobId)
  .then(() => {
    logger.info('Force cancel completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Force cancel failed:', error);
    process.exit(1);
  });


