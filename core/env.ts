import { z } from 'zod';

const envSchema = z.object({
  // Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server
  PORT: z
    .string()
    .default('5001')
    .transform((val) => parseInt(val, 10)),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().optional(),
  API_KEY: z.string().optional(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z
    .string()
    .default('6379')
    .transform((val) => parseInt(val, 10)),
  REDIS_PASSWORD: z.string().optional(),

  // Twitter
  TWITTER_DEFAULT_MODE: z.enum(['graphql', 'puppeteer', 'mixed']).default('graphql'),
  TWITTER_DEFAULT_LIMIT: z
    .string()
    .default('50')
    .transform((val) => parseInt(val, 10)),

  // Reddit
  REDDIT_API_URL: z.string().default('http://127.0.0.1:5002'),
  REDDIT_API_PORT: z
    .string()
    .default('5002')
    .transform((val) => parseInt(val, 10)),

  // Browser
  BROWSER_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((val) => val === 'true'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = envSchema.parse(process.env);
