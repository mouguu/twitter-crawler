/**
 * Health Check System for XRCrawler
 * Monitors critical services: Database, Redis, Proxy
 */

import axios from 'axios';
import { createEnhancedLogger } from '../../utils/logger';
import { prisma } from '../db/prisma';
import { redisConnection } from '../queue/connection';

const logger = createEnhancedLogger('HealthChecker');

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  responseTime: number;
  message?: string;
  details?: any;
}

export interface OverallHealth {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: Date;
  checks: {
    database: HealthStatus;
    redis: HealthStatus;
    proxy: HealthStatus;
  };
}

export class HealthChecker {
  /**
   * Check PostgreSQL database health
   */
  async checkDatabase(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - start;

      return {
        status: responseTime < 100 ? 'healthy' : 'degraded',
        responseTime,
        message: responseTime < 100 ? 'Database responding normally' : 'Database responding slowly',
      };
    } catch (error: any) {
      logger.error('Database health check failed', error);
      return {
        status: 'down',
        responseTime: Date.now() - start,
        message: 'Database connection failed',
        details: error.message,
      };
    }
  }

  /**
   * Check Redis health
   */
  async checkRedis(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await redisConnection.ping();
      const responseTime = Date.now() - start;

      return {
        status: responseTime < 50 ? 'healthy' : 'degraded',
        responseTime,
        message: responseTime < 50 ? 'Redis responding normally' : 'Redis responding slowly',
      };
    } catch (error: any) {
      logger.error('Redis health check failed', error);
      return {
        status: 'down',
        responseTime: Date.now() - start,
        message: 'Redis connection failed',
        details: error.message,
      };
    }
  }

  /**
   * Check Proxy health (if configured)
   */
  /**
   * Check Proxy health using ProxyManager
   */
  async checkProxy(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Dynamic import to avoid circular dependencies if any
      const { ProxyManager } = await import('../proxy-manager');
      const proxyManager = new ProxyManager();
      // Use init() to load from files, not loadProxies()
      await proxyManager.init();

      if (!proxyManager.isEnabled()) {
         return {
          status: 'healthy',
          responseTime: 0,
          message: 'Proxy system disabled',
        };
      }

      if (!proxyManager.hasProxies()) {
        return {
          status: 'down',
          responseTime: 0,
          message: 'No active proxies available in pool',
        };
      }

      // Check stats
      const stats = proxyManager.getStats();
      const avgSuccessRate = stats.avgSuccessRate;
      
      const responseTime = Date.now() - start;
      
      let status: 'healthy' | 'degraded' | 'down' = 'healthy';
      if (avgSuccessRate < 0.5) status = 'down';
      else if (avgSuccessRate < 0.8) status = 'degraded';

      return {
        status,
        responseTime, // This is just check time, not proxy response time
        message: `Active: ${stats.active}, Success Rate: ${(avgSuccessRate * 100).toFixed(1)}%`,
        details: proxyManager.getStats(),
      };
    } catch (error: any) {
      logger.error('Proxy health check failed', error);
      return {
        status: 'down',
        responseTime: Date.now() - start,
        message: 'Proxy manager check failed',
        details: error.message,
      };
    }
  }

  /**
   * Run all health checks
   */
  async checkAll(): Promise<OverallHealth> {
    const [database, redis, proxy] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkProxy(),
    ]);

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';

    if (database.status === 'down' || redis.status === 'down') {
      overallStatus = 'down';
    } else if (
      database.status === 'degraded' ||
      redis.status === 'degraded' ||
      proxy.status === 'degraded'
    ) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date(),
      checks: { database, redis, proxy },
    };
  }

  /**
   * Parse proxy URL into axios-compatible format
   */
  private parseProxyUrl(proxyUrl: string) {
    try {
      const url = new URL(proxyUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port, 10) || 8080,
        auth:
          url.username && url.password
            ? {
                username: url.username,
                password: url.password,
              }
            : undefined,
      };
    } catch {
      // If parsing fails, return undefined (axios will use direct connection)
      return undefined;
    }
  }
}

// Singleton instance
export const healthChecker = new HealthChecker();
