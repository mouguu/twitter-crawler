/**
 * Winston-based logger with structured output.
 */

import { createLogger as createWinstonLogger, format, transports, Logger } from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const hasFs =
  typeof fs.existsSync === 'function' &&
  typeof fs.mkdirSync === 'function' &&
  typeof fs.createWriteStream === 'function';
const logDir = path.join(process.cwd(), 'logs');

if (hasFs) {
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  }
} else {
  console.warn('[Logger] File system APIs unavailable, falling back to console-only logging.');
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

const fileTransports: transports.StreamTransportInstance[] = hasFs
  ? [
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
    ]
  : [];

const exceptionHandlers = hasFs
  ? [
    new transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3
    })
    ]
  : [];

const rejectionHandlers = hasFs
  ? [
    new transports.File({
      filename: path.join(logDir, 'rejections.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3
    })
  ]
  : [];

export const logger: Logger = createWinstonLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'xrcrawler' },
  transports: [...fileTransports],
  exceptionHandlers,
  rejectionHandlers
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
  error: (message: string, error?: Error, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  verbose: (message: string, meta?: Record<string, unknown>) => void;
}

function normalizeErrorMeta(
  error: Error | undefined,
  extraMeta: Record<string, unknown>,
): Record<string, unknown> {
  if (!error) {
    return extraMeta;
  }

  const meta: Record<string, unknown> = { ...extraMeta };

  if ((error as any).code !== undefined && (error as any).retryable !== undefined) {
    // Likely ScraperError-like shape
    meta.errorCode = (error as any).code;
    meta.retryable = (error as any).retryable;
    meta.errorContext = (error as any).context;
    if ((error as any).originalError) {
      meta.originalError = {
        name: (error as any).originalError.name,
        message: (error as any).originalError.message,
      };
    }
  } else {
    meta.errorName = error.name;
    meta.errorMessage = error.message;
  }

  return meta;
}

export function createModuleLogger(module: string): ModuleLogger {
  return {
    info: (message: string, meta: Record<string, unknown> = {}) =>
      logger.info(message, { module, ...meta }),
    warn: (message: string, meta: Record<string, unknown> = {}) =>
      logger.warn(message, { module, ...meta }),
    error: (message: string, error?: Error, meta: Record<string, unknown> = {}) =>
      logger.error(message, normalizeErrorMeta(error, { module, ...meta })),
    debug: (message: string, meta: Record<string, unknown> = {}) =>
      logger.debug(message, { module, ...meta }),
    verbose: (message: string, meta: Record<string, unknown> = {}) =>
      logger.verbose(message, { module, ...meta }),
  };
}

export type LogContext = Record<string, unknown>;

/**
 * 增强的模块日志器（集成性能追踪和上下文管理）
 */
export class EnhancedLogger {
  private module: string;
  private baseLogger: ModuleLogger;
  private context: LogContext = {};

  constructor(module: string) {
    this.module = module;
    this.baseLogger = createModuleLogger(module);
  }

  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  info(message: string, meta?: LogContext): void {
    this.baseLogger.info(message, { ...this.context, ...meta });
  }

  warn(message: string, meta?: LogContext): void {
    this.baseLogger.warn(message, { ...this.context, ...meta });
  }

  error(message: string, error?: Error, meta?: LogContext): void {
    this.baseLogger.error(message, error, { ...this.context, ...meta });
  }

  debug(message: string, meta?: LogContext): void {
    this.baseLogger.debug(message, { ...this.context, ...meta });
  }

  performance(operation: string, duration: number, metadata?: LogContext): void {
    this.baseLogger.info(`[PERF] ${operation}`, {
      ...this.context,
      ...metadata,
      duration,
      operation,
      type: 'performance'
    });
  }

  startOperation(operation: string, metadata?: LogContext): () => void {
    const startTime = Date.now();
    this.debug(`[START] ${operation}`, metadata);
    return () => {
      const duration = Date.now() - startTime;
      this.performance(operation, duration, metadata);
    };
  }

  async trackAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: LogContext
  ): Promise<T> {
    const endOperation = this.startOperation(operation, metadata);
    try {
      const result = await fn();
      endOperation();
      return result;
    } catch (error: any) {
      endOperation();
      this.error(`[FAILED] ${operation}`, error, metadata);
      throw error;
    }
  }

  trackSync<T>(
    operation: string,
    fn: () => T,
    metadata?: LogContext
  ): T {
    const endOperation = this.startOperation(operation, metadata);
    try {
      const result = fn();
      endOperation();
      return result;
    } catch (error: any) {
      endOperation();
      this.error(`[FAILED] ${operation}`, error, metadata);
      throw error;
    }
  }
}

export function createEnhancedLogger(module: string): EnhancedLogger {
  return new EnhancedLogger(module);
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
