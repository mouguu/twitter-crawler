/**
 * Worker Startup Script
 * 
 * Starts the BullMQ worker process for scraping jobs
 */

import { createScrapeWorker, shutdownWorker } from '../core/queue/worker';
import { closeScrapeQueue } from '../core/queue/scrape-queue';
import { closeRedisConnections } from '../core/queue/connection';
import { createEnhancedLogger } from '../utils/logger';
import { getConfigManager } from '../utils/config-manager';

const logger = createEnhancedLogger('WorkerMain');
const config = getConfigManager();
const queueConfig = config.getQueueConfig();

// Start worker
logger.info('Starting XRCrawler Worker...', { 
  concurrency: queueConfig.concurrency,
  rateLimit: queueConfig.rateLimit 
});

const worker = createScrapeWorker(queueConfig.concurrency);

logger.info('Worker started and listening for jobs');

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Stop accepting new jobs
    await shutdownWorker(worker);
    
    // Close queue connections
    await closeScrapeQueue();
    
    // Close Redis connections
    await closeRedisConnections();
    
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error as Error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', new Error(String(reason)));
  shutdown('unhandledRejection');
});
