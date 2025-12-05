/**
 * Redis Connection Setup
 * 
 * Provides Redis connection instances for BullMQ queue and Pub/Sub
 */

import Redis from 'ioredis';
import { getConfigManager } from '../../utils/config-manager';
import { createEnhancedLogger } from '../../utils/logger';

const logger = createEnhancedLogger('RedisConnection');
const config = getConfigManager();
const redisConfig = config.getRedisConfig();

// Connection options
const connectionOptions = {
  host: redisConfig.host,
  port: redisConfig.port,
  db: redisConfig.db,
  password: redisConfig.password,
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  connectTimeout: 10000, // 10 second timeout
  lazyConnect: true, // Don't connect immediately
  retryStrategy(times: number) {
    if (times > 10) {
      logger.error('Redis connection failed after 10 retries, giving up');
      return null; // Stop retrying
    }
    const delay = Math.min(times * 500, 5000);
    logger.warn(`Redis connection retry attempt ${times}, delay: ${delay}ms`);
    return delay;
  },
};

/**
 * Main Redis connection for BullMQ
 */
export const redisConnection = new Redis(connectionOptions);

/**
 * Publisher connection for Pub/Sub (logs and progress)
 */
export const redisPublisher = new Redis(connectionOptions);

/**
 * Subscriber connection for Pub/Sub (SSE streams)
 */
export const redisSubscriber = new Redis(connectionOptions);

// Connect with error handling
async function connectRedis() {
  try {
    await Promise.all([
      redisConnection.connect(),
      redisPublisher.connect(),
      redisSubscriber.connect(),
    ]);
    logger.info('All Redis connections established');
  } catch (error) {
    logger.error('Failed to connect to Redis', error as Error);
    // Don't throw - let the app continue and handle Redis errors gracefully
  }
}

// Start connection in background (non-blocking)
connectRedis();

// Connection event handlers
redisConnection.on('connect', () => {
  logger.info('Redis connection established', { 
    host: redisConfig.host, 
    port: redisConfig.port 
  });
});

redisConnection.on('error', (err) => {
  logger.error('Redis connection error', err);
});

redisPublisher.on('error', (err) => {
  logger.error('Redis publisher error', err);
});

redisSubscriber.on('error', (err) => {
  logger.error('Redis subscriber error', err);
});

/**
 * Graceful shutdown
 */
export async function closeRedisConnections(): Promise<void> {
  logger.info('Closing Redis connections...');
  await Promise.all([
    redisConnection.quit(),
    redisPublisher.quit(),
    redisSubscriber.quit(),
  ]);
  logger.info('Redis connections closed');
}
