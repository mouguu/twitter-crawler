import { PrismaClient } from '../../generated/prisma/client';
import { createEnhancedLogger } from '../../utils/logger';

const logger = createEnhancedLogger('Prisma');

// 调试日志：检查环境变量是否存在
console.log(
  '[Prisma Init] Checking DATABASE_URL:',
  process.env.DATABASE_URL ? 'Present' : 'MISSING',
);

// Prevent multiple instances in development due to hot reloading
const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Only use mock in test environment WITHOUT DATABASE_URL
const isTestWithoutDb = process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL;

// Create mock PrismaClient for tests without database
const createMockPrismaClient = (): PrismaClient => {
  return {
    $connect: async () => {},
    $disconnect: async () => {},
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async (fn: any) => fn,
    // Add other necessary mock methods if tests fail
  } as any;
};

// Create real PrismaClient - Using Adapter for Prisma 7 compatibility
const createRealPrismaClient = (): PrismaClient => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is missing');
  }

  try {
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    
    console.log('[Prisma Init] Initializing PrismaClient with pg adapter...');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    
    return new PrismaClient({ 
      adapter,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    } as any);
  } catch (e) {
    console.warn('[Prisma Init] Failed to load adapter, falling back to standard client (might fail if engine type mismatch):', e);
    return new PrismaClient();
  }
};

let prismaInstance: PrismaClient;

try {
  console.log('[Prisma Init] Starting initialization...');
  prismaInstance =
    globalForPrisma.prisma ||
    (isTestWithoutDb ? createMockPrismaClient() : createRealPrismaClient());
  console.log('[Prisma Init] Successfully initialized.');
} catch (error) {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('[Prisma Init] FATAL ERROR initializing database connection:');
  console.error(error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  process.exit(1);
}

export const prisma = prismaInstance!;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function checkDatabaseConnection() {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
    return true;
  } catch (error: any) {
    logger.error('Database connection failed', error);
    return false;
  }
}
