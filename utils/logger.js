/**
 * 日志模块
 * 使用 Winston 提供结构化日志功能
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * 自定义日志格式
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

/**
 * 控制台日志格式（更易读）
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

/**
 * 创建 Winston logger 实例
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'twitter-crawler' },
  transports: [
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // 组合日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  // 未捕获异常处理
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      maxsize: 5242880,
      maxFiles: 3,
    }),
  ],
  // 未处理的 Promise 拒绝
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      maxsize: 5242880,
      maxFiles: 3,
    }),
  ],
});

// 在非生产环境添加控制台输出
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

/**
 * 创建带有模块上下文的 logger
 * @param {string} module - 模块名称
 * @returns {Object} - 带上下文的 logger
 */
function createLogger(module) {
  return {
    info: (message, meta = {}) => logger.info(message, { module, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { module, ...meta }),
    error: (message, meta = {}) => logger.error(message, { module, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { module, ...meta }),
    verbose: (message, meta = {}) => logger.verbose(message, { module, ...meta }),
  };
}

/**
 * 日志级别
 */
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  VERBOSE: 'verbose',
};

/**
 * 设置日志级别
 * @param {string} level - 日志级别
 */
function setLogLevel(level) {
  logger.level = level;
}

/**
 * 关闭所有日志传输
 */
async function closeLogger() {
  return new Promise((resolve) => {
    logger.on('finish', resolve);
    logger.end();
  });
}

module.exports = {
  logger,
  createLogger,
  LOG_LEVELS,
  setLogLevel,
  closeLogger,
};
