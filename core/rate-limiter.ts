/**
 * Global Rate Limiter using Redis
 *
 * Ensures rate limits are enforced across all workers
 */

import { Redis } from 'ioredis';
import { createEnhancedLogger } from '../utils';

const logger = createEnhancedLogger('RateLimiter');

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  key: string;
}

export class GlobalRateLimiter {
  constructor(private redis: Redis) {}

  /**
   * Check if request is allowed under rate limit
   * Returns true if allowed, false if rate limited
   */
  async checkLimit(config: RateLimitConfig): Promise<boolean> {
    const { key, maxRequests, windowMs } = config;

    try {
      // Use Lua script for atomic operation
      const script = `
        local key = KEYS[1]
        local max = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local count = redis.call('INCR', key)

        if count == 1 then
          redis.call('PEXPIRE', key, window)
        end

        return count <= max
      `;

      const result = await this.redis.eval(
        script,
        1,
        key,
        maxRequests.toString(),
        windowMs.toString()
      ) as number;

      const allowed = result === 1;

      if (!allowed) {
        const ttl = await this.redis.pttl(key);
        logger.debug(`Rate limit exceeded for ${key}`, {
          key,
          maxRequests,
          windowMs,
          ttl,
        });
      }

      return allowed;
    } catch (error) {
      logger.error(`Rate limit check failed for ${key}`, error as Error);
      // Fail open - allow request if Redis is down
      return true;
    }
  }

  /**
   * Wait until a slot is available
   * Blocks until rate limit allows the request
   */
  async waitForSlot(config: RateLimitConfig, maxWaitMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const allowed = await this.checkLimit(config);

      if (allowed) {
        return true;
      }

      // Wait before retrying
      const ttl = await this.redis.pttl(config.key);
      const waitTime = Math.min(ttl || 1000, 1000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    logger.warn(`Rate limit wait timeout for ${config.key}`, {
      key: config.key,
      maxWaitMs,
    });

    return false;
  }

  /**
   * Get current rate limit status
   */
  async getStatus(key: string): Promise<{
    count: number;
    limit: number;
    windowMs: number;
    ttl: number;
    remaining: number;
  } | null> {
    try {
      const count = parseInt((await this.redis.get(key)) || '0', 10);
      const ttl = await this.redis.pttl(key);

      // Parse limit from key pattern (e.g., "reddit:rate-limit:1:3000" -> max=1, window=3000)
      const parts = key.split(':');
      const maxRequests = parseInt(parts[parts.length - 2] || '1', 10);
      const windowMs = parseInt(parts[parts.length - 1] || '3000', 10);

      return {
        count,
        limit: maxRequests,
        windowMs,
        ttl: ttl > 0 ? ttl : 0,
        remaining: Math.max(0, maxRequests - count),
      };
    } catch (error) {
      logger.error(`Failed to get rate limit status for ${key}`, error as Error);
      return null;
    }
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key: string): Promise<void> {
    await this.redis.del(key);
    logger.debug(`Rate limit reset for ${key}`);
  }
}
