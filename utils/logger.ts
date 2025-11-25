/**
 * Winston-based logger with structured output.
 */

import { createLogger as createWinstonLogger, format, transports, Logger } from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message as string}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

export const logger: Logger = createWinstonLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'twitter-crawler' },
  transports: [
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5
    }),
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5
    })
  ],
  exceptionHandlers: [
    new transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3
    })
  ],
  rejectionHandlers: [
    new transports.File({
      filename: path.join(logDir, 'rejections.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: consoleFormat
    })
  );
}

export interface ModuleLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  verbose: (message: string, meta?: Record<string, unknown>) => void;
}

export function createModuleLogger(module: string): ModuleLogger {
  return {
    info: (message: string, meta: Record<string, unknown> = {}) => logger.info(message, { module, ...meta }),
    warn: (message: string, meta: Record<string, unknown> = {}) => logger.warn(message, { module, ...meta }),
    error: (message: string, meta: Record<string, unknown> = {}) => logger.error(message, { module, ...meta }),
    debug: (message: string, meta: Record<string, unknown> = {}) => logger.debug(message, { module, ...meta }),
    verbose: (message: string, meta: Record<string, unknown> = {}) => logger.verbose(message, { module, ...meta })
  };
}

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  VERBOSE: 'verbose'
} as const;

export function setLogLevel(level: keyof typeof LOG_LEVELS | string): void {
  logger.level = level;
}

export async function closeLogger(): Promise<void> {
  await new Promise<void>((resolve) => {
    logger.on('finish', resolve);
    logger.end();
  });
}
