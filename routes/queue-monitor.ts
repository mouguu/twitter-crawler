/**
 * Queue Monitor Routes - Pure Hono Implementation
 * 
 * Replaces Bull Board with a simple, lightweight queue monitoring API
 */

import { Hono } from 'hono';
import { scrapeQueue } from '../core/queue/scrape-queue';
import { createEnhancedLogger } from '../utils/logger';

const logger = createEnhancedLogger('QueueMonitor');

const queueMonitor = new Hono();

/**
 * GET /admin/queues
 * Get queue overview with counts for each state
 */
queueMonitor.get('/', async (c) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      scrapeQueue.getWaitingCount(),
      scrapeQueue.getActiveCount(),
      scrapeQueue.getCompletedCount(),
      scrapeQueue.getFailedCount(),
      scrapeQueue.getDelayedCount(),
    ]);

    return c.json({
      name: 'scraper',
      counts: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to get queue stats', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /admin/queues/jobs
 * List jobs with optional state filter
 */
queueMonitor.get('/jobs', async (c) => {
  try {
    const state = c.req.query('state') as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | undefined;
    const start = parseInt(c.req.query('start') || '0', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

    let jobs;
    
    if (state === 'waiting') {
      jobs = await scrapeQueue.getWaiting(start, start + limit - 1);
    } else if (state === 'active') {
      jobs = await scrapeQueue.getActive(start, start + limit - 1);
    } else if (state === 'completed') {
      jobs = await scrapeQueue.getCompleted(start, start + limit - 1);
    } else if (state === 'failed') {
      jobs = await scrapeQueue.getFailed(start, start + limit - 1);
    } else if (state === 'delayed') {
      jobs = await scrapeQueue.getDelayed(start, start + limit - 1);
    } else {
      // Get all recent jobs
      const [waiting, active, completed, failed] = await Promise.all([
        scrapeQueue.getWaiting(0, 4),
        scrapeQueue.getActive(0, 4),
        scrapeQueue.getCompleted(0, 9),
        scrapeQueue.getFailed(0, 4),
      ]);
      jobs = [...active, ...waiting, ...completed, ...failed];
    }

    const jobList = await Promise.all(
      jobs.map(async (job) => ({
        id: job.id,
        name: job.name,
        state: await job.getState(),
        progress: job.progress,
        data: {
          type: job.data.type,
          config: job.data.config,
        },
        returnvalue: job.returnvalue, // Include for downloadUrl
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
      }))
    );

    return c.json({
      jobs: jobList,
      count: jobList.length,
      filter: state || 'all',
    });
  } catch (error: any) {
    logger.error('Failed to list jobs', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /admin/queues/job/:id
 * Get detailed info for a specific job
 */
queueMonitor.get('/job/:id', async (c) => {
  try {
    const jobId = c.req.param('id');
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    const state = await job.getState();
    const logs = await scrapeQueue.getJobLogs(jobId);

    return c.json({
      id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      attemptsMade: job.attemptsMade,
      logs: logs.logs,
    });
  } catch (error: any) {
    logger.error('Failed to get job details', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /admin/queues/job/:id/retry
 * Retry a failed job
 */
queueMonitor.post('/job/:id/retry', async (c) => {
  try {
    const jobId = c.req.param('id');
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    await job.retry();
    logger.info('Job retried', { jobId });

    return c.json({ success: true, message: 'Job queued for retry' });
  } catch (error: any) {
    logger.error('Failed to retry job', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * DELETE /admin/queues/job/:id
 * Remove a job
 */
queueMonitor.delete('/job/:id', async (c) => {
  try {
    const jobId = c.req.param('id');
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    await job.remove();
    logger.info('Job removed', { jobId });

    return c.json({ success: true, message: 'Job removed' });
  } catch (error: any) {
    logger.error('Failed to remove job', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /admin/queues/clean
 * Clean completed/failed jobs
 */
queueMonitor.post('/clean', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const grace = body.grace || 3600000; // Default: 1 hour
    const limit = body.limit || 100;
    const type = body.type || 'completed'; // 'completed' | 'failed' | 'delayed'

    let cleaned: string[] = [];

    if (type === 'completed' || type === 'all') {
      cleaned = [...cleaned, ...(await scrapeQueue.clean(grace, limit, 'completed'))];
    }
    if (type === 'failed' || type === 'all') {
      cleaned = [...cleaned, ...(await scrapeQueue.clean(grace, limit, 'failed'))];
    }

    logger.info('Queue cleaned', { type, count: cleaned.length });

    return c.json({
      success: true,
      message: `Cleaned ${cleaned.length} jobs`,
      cleaned: cleaned.length,
    });
  } catch (error: any) {
    logger.error('Failed to clean queue', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /admin/queues/pause
 * Pause the queue
 */
queueMonitor.post('/pause', async (c) => {
  try {
    await scrapeQueue.pause();
    logger.info('Queue paused');
    return c.json({ success: true, message: 'Queue paused' });
  } catch (error: any) {
    logger.error('Failed to pause queue', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /admin/queues/resume
 * Resume the queue
 */
queueMonitor.post('/resume', async (c) => {
  try {
    await scrapeQueue.resume();
    logger.info('Queue resumed');
    return c.json({ success: true, message: 'Queue resumed' });
  } catch (error: any) {
    logger.error('Failed to resume queue', error);
    return c.json({ error: error.message }, 500);
  }
});

export default queueMonitor;
