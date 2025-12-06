/**
 * Job Management API Routes - Hono
 *
 * Endpoints for querying job status, streaming progress, and cancelling jobs
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { redisSubscriber } from '../../core/queue/connection';
import { scrapeQueue } from '../../core/queue/scrape-queue';
import { markJobAsCancelled } from '../../core/queue/worker';
import { createEnhancedLogger, safeJsonParse } from '../../utils';

const jobRoutes = new Hono();
const logger = createEnhancedLogger('JobRoutes');

/**
 * GET /
 * List all jobs (with pagination and filtering)
 */
jobRoutes.get('/', async (c) => {
  console.log('DEBUG: GET / handler called!');
  console.log('DEBUG: Query params:', c.req.query());
  try {
    const state = c.req.query('state');
    const type = c.req.query('type');
    const start = parseInt(c.req.query('start') || '0', 10);
    const count = Math.min(parseInt(c.req.query('count') || '10', 10), 100);

    let jobs;

    // Filter by state
    if (state === 'completed') {
      jobs = await scrapeQueue.getCompleted(start, start + count - 1);
    } else if (state === 'failed') {
      jobs = await scrapeQueue.getFailed(start, start + count - 1);
    } else if (state === 'active') {
      jobs = await scrapeQueue.getActive(start, start + count - 1);
    } else if (state === 'waiting') {
      jobs = await scrapeQueue.getWaiting(start, start + count - 1);
    } else if (state === 'delayed') {
      jobs = await scrapeQueue.getDelayed(start, start + count - 1);
    } else {
      // Get all jobs
      const [waiting, active, completed, failed] = await Promise.all([
        scrapeQueue.getWaiting(0, 9),
        scrapeQueue.getActive(0, 9),
        scrapeQueue.getCompleted(0, 9),
        scrapeQueue.getFailed(0, 9),
      ]);
      jobs = [...waiting, ...active, ...completed, ...failed];
    }

    // Filter by type if specified
    if (type) {
      jobs = jobs.filter((job) => job.data.type === type);
    }

    // Map to response format
    const jobList = await Promise.all(
      jobs.map(async (job) => ({
        id: job.id,
        type: job.data.type,
        state: await job.getState(),
        progress: job.progress,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
      })),
    );

    return c.json({
      jobs: jobList,
      total: jobList.length,
    });
  } catch (error: any) {
    logger.error('Failed to list jobs', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /:jobId
 * Get job status and result
 */
jobRoutes.get('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  // Skip if this is the stream endpoint
  if (jobId === 'stream') {
    return c.notFound();
  }

  try {
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnvalue = job.returnvalue;

    return c.json({
      id: job.id,
      type: job.data.type,
      state,
      progress,
      result: returnvalue,
      createdAt: job.timestamp,
      processedAt: job.processedOn,
      finishedAt: job.finishedOn,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
    });
  } catch (error: any) {
    logger.error('Failed to get job status', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /:jobId/stream
 * Server-Sent Events stream for job progress and logs
 */
jobRoutes.get('/:jobId/stream', async (c) => {
  const jobId = c.req.param('jobId');

  try {
    // Verify job exists
    const job = await scrapeQueue.getJob(jobId);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    return streamSSE(c, async (stream) => {
      // Send initial connection event with job state
      const initialState = await job.getState();
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({
          jobId,
          type: job.data.type,
          state: initialState,
          progress: job.progress,
          createdAt: job.timestamp,
        }),
      });

      // Subscribe to job-specific Redis channels
      const progressChannel = `job:${jobId}:progress`;
      const logChannel = `job:${jobId}:log`;

      await redisSubscriber.subscribe(progressChannel, logChannel);

      // Message handler for Redis Pub/Sub
      const messageHandler = async (channel: string, message: string) => {
        if (isEnded) return; // Don't process messages if stream is ended

        try {
          const data = safeJsonParse(message);

          if (channel === progressChannel) {
            try {
              await stream.writeSSE({ event: 'progress', data: JSON.stringify(data) });
            } catch (writeError) {
              logger.warn('Failed to write progress to SSE stream', {
                error: writeError instanceof Error ? writeError.message : String(writeError),
                jobId,
              });
              // Stream may be closed, mark as ended
              isEnded = true;
            }
          } else if (channel === logChannel) {
            try {
              await stream.writeSSE({ event: 'log', data: JSON.stringify(data) });
            } catch (writeError) {
              logger.warn('Failed to write log to SSE stream', {
                error: writeError instanceof Error ? writeError.message : String(writeError),
                jobId,
              });
              // Stream may be closed, mark as ended
              isEnded = true;
            }
          }
        } catch (error) {
          logger.error('Failed to parse Redis message', error as Error);
        }
      };

      redisSubscriber.on('message', messageHandler);

      // Poll job state for completion/failure
      let isEnded = false;
      let heartbeatInterval: NodeJS.Timeout | undefined;
      const pollInterval = setInterval(async () => {
        if (isEnded) return;

        try {
          const currentState = await job.getState();

          if (currentState === 'completed') {
            try {
              await stream.writeSSE({
                event: 'completed',
                data: JSON.stringify({
                  result: job.returnvalue,
                  finishedAt: job.finishedOn,
                }),
              });
            } catch (writeError) {
              logger.warn('Failed to write completed event to SSE stream', {
                error: writeError instanceof Error ? writeError.message : String(writeError),
                jobId,
              });
            }
            isEnded = true;
            clearInterval(pollInterval);
          } else if (currentState === 'failed') {
            try {
              await stream.writeSSE({
                event: 'failed',
                data: JSON.stringify({
                  error: job.failedReason,
                  finishedAt: job.finishedOn,
                }),
              });
            } catch (writeError) {
              logger.warn('Failed to write failed event to SSE stream', {
                error: writeError instanceof Error ? writeError.message : String(writeError),
                jobId,
              });
            }
            isEnded = true;
            clearInterval(pollInterval);
          }
        } catch (error) {
          logger.error('Failed to poll job state', error as Error);
          // Don't end stream on polling error, just log it
        }
      }, 1000);

      // Keep connection alive and handle cleanup
      try {
        // Send heartbeat every 30 seconds to keep connection alive
        let heartbeatCount = 0;
        heartbeatInterval = setInterval(async () => {
          if (isEnded) {
            clearInterval(heartbeatInterval);
            return;
          }
          try {
            await stream.writeSSE({
              event: 'heartbeat',
              data: JSON.stringify({ timestamp: Date.now(), count: heartbeatCount++ }),
            });
          } catch (error) {
            // Client may have disconnected, stop heartbeat
            clearInterval(heartbeatInterval);
          }
        }, 30000);

        // Keep stream open until client disconnects or job ends
        while (!isEnded) {
          try {
            await stream.sleep(1000);

            // Check if job has ended
            const state = await job.getState();
            if (state === 'completed' || state === 'failed') {
              isEnded = true;
              if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
              }
            }
          } catch (error) {
            // Stream may have been closed by client or network issue
            logger.debug('SSE stream sleep interrupted, client may have disconnected', {
              jobId,
              error: error instanceof Error ? error.message : String(error),
            });
            isEnded = true;
            break;
          }
        }
      } finally {
        clearInterval(pollInterval);
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        redisSubscriber.off('message', messageHandler);
        await redisSubscriber.unsubscribe(progressChannel, logChannel);
        logger.debug('SSE client disconnected', { jobId });
      }
    });
  } catch (error: any) {
    logger.error('Failed to create SSE stream', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /:jobId/cancel
 * Cancel a job
 */
jobRoutes.post('/:jobId/cancel', async (c) => {
  const jobId = c.req.param('jobId');

  try {
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    const state = await job.getState();

    if (state === 'completed' || state === 'failed') {
      return c.json(
        {
          error: `Cannot cancel job in ${state} state`,
        },
        400,
      );
    }

    // For active jobs, mark them for cancellation
    if (state === 'active') {
      markJobAsCancelled(jobId);
      logger.info('Active job marked for cancellation', { jobId });

      return c.json({
        success: true,
        message: 'Job cancellation requested. The job will stop shortly.',
        note: 'Active jobs are stopped gracefully and may take a few seconds to complete cancellation.',
      });
    }

    // For waiting/delayed jobs, remove directly from queue
    await job.remove();
    logger.info('Job cancelled', { jobId, state });

    return c.json({
      success: true,
      message: 'Job cancelled successfully',
    });
  } catch (error: any) {
    logger.error('Failed to cancel job', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * DELETE /:jobId
 * Delete a completed/failed job
 */
jobRoutes.delete('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  try {
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    await job.remove();

    return c.json({
      success: true,
      message: 'Job deleted successfully',
    });
  } catch (error: any) {
    logger.error('Failed to delete job', error);
    return c.json({ error: error.message }, 500);
  }
});

export default jobRoutes;
