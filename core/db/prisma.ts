import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { createEnhancedLogger } from '../../utils/logger';

const logger = createEnhancedLogger('Prisma');

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
  } as any;
};

// Create real PrismaClient with pg adapter (Prisma v7 pattern)
const createRealPrismaClient = (): PrismaClient => {
  // 1. 创建原生的 pg 连接池
  const connectionString = `${process.env.DATABASE_URL}`;
  const pool = new Pool({ connectionString });

  // 2. 创建 Prisma 的驱动适配器
  // 这就是 Prisma 7 报错里要的那个 "adapter"
  const adapter = new PrismaPg(pool);

  // 3. 初始化 Client，注入适配器
  return new PrismaClient({ adapter });
};

let prismaInstance: PrismaClient;
try {
  console.log('DEBUG: Initializing Prisma Client with pg adapter...');
  prismaInstance = globalForPrisma.prisma || (isTestWithoutDb ? createMockPrismaClient() : createRealPrismaClient());
  console.log('DEBUG: Prisma Client initialized successfully');
} catch (e: any) {
  console.error('CRITICAL ERROR: Prisma Client initialization failed:', e);
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
