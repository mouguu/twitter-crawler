/**
 * Health Check Routes
 */

import { Hono } from 'hono';
import { redisConnection } from '../../core/queue/connection';
import { prisma } from '../../core/db/prisma';
import { createEnhancedLogger } from '../../utils';

const healthRoutes = new Hono();
const logger = createEnhancedLogger('HealthCheck');

async function checkRedis(): Promise<boolean> {
  try {
    await redisConnection.ping();
    return true;
  } catch (error) {
    logger.error('Redis health check failed', error as Error);
    return false;
  }
}

async function checkPostgres(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Postgres health check failed', error as Error);
    return false;
  }
}

async function checkProxy(): Promise<boolean> {
  // Check if proxy file exists and is readable
  try {
    const fs = await import('fs');
    const path = await import('path');
    const proxyFile = path.join(process.cwd(), 'proxy', 'Webshare 10 proxies.txt');
    return fs.existsSync(proxyFile);
  } catch (error) {
    logger.error('Proxy health check failed', error as Error);
    return false;
  }
}

healthRoutes.get('/health', async (c) => {
  const [redis, postgres, proxy] = await Promise.all([
    checkRedis(),
    checkPostgres(),
    checkProxy(),
  ]);

  const checks = {
    redis,
    postgres,
    proxy,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  const healthy = redis && postgres;
  const status = healthy ? 200 : 503;

  return c.json(checks, status);
});

healthRoutes.get('/health/live', async (c) => {
  // Liveness probe - just check if server is running
  return c.json({ status: 'ok' }, 200);
});

healthRoutes.get('/health/ready', async (c) => {
  // Readiness probe - check if dependencies are ready
  const [redis, postgres] = await Promise.all([
    checkRedis(),
    checkPostgres(),
  ]);

  const ready = redis && postgres;
  return c.json({ ready }, ready ? 200 : 503);
});

export default healthRoutes;

