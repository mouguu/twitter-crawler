/**
 * Health Check API Routes - Hono
 */

import { Hono } from 'hono';
import { healthChecker } from '../core/health/health-checker';
import { createEnhancedLogger } from '../utils/logger';

const logger = createEnhancedLogger('HealthAPI');

const healthRoutes = new Hono();

/**
 * GET /health
 * Returns health status of all services
 */
healthRoutes.get('/health', async (c) => {
  try {
    const health = await healthChecker.checkAll();
    
    // Set appropriate HTTP status code based on health
    const statusCode = 
      health.status === 'down' ? 503 :
      health.status === 'degraded' ? 200 :
      200;

    return c.json(health, statusCode);
  } catch (error: any) {
    logger.error('Health check endpoint failed', error);
    return c.json({
      status: 'down',
      timestamp: new Date(),
      message: 'Health check failed',
      error: error.message
    }, 500);
  }
});

/**
 * GET /health/database
 * Check only database health
 */
healthRoutes.get('/health/database', async (c) => {
  try {
    const health = await healthChecker.checkDatabase();
    return c.json(health, health.status === 'down' ? 503 : 200);
  } catch (error: any) {
    logger.error('Database health check failed', error);
    return c.json({ status: 'down', message: error.message }, 500);
  }
});

/**
 * GET /health/redis
 * Check only Redis health
 */
healthRoutes.get('/health/redis', async (c) => {
  try {
    const health = await healthChecker.checkRedis();
    return c.json(health, health.status === 'down' ? 503 : 200);
  } catch (error: any) {
    logger.error('Redis health check failed', error);
    return c.json({ status: 'down', message: error.message }, 500);
  }
});

/**
 * GET /health/proxy
 * Check only Proxy health
 */
healthRoutes.get('/health/proxy', async (c) => {
  try {
    const health = await healthChecker.checkProxy();
    return c.json(health, health.status === 'down' ? 503 : 200);
  } catch (error: any) {
    logger.error('Proxy health check failed', error);
    return c.json({ status: 'down', message: error.message }, 500);
  }
});

export default healthRoutes;
