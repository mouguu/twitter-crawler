/**
 * 重试工具模块
 * 提供指数退避重试功能，用于处理网络请求和其他可能失败的操作
 */

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 使用指数退避策略重试异步函数
 * @param {Function} fn - 要执行的异步函数
 * @param {Object} options - 重试选项
 * @param {number} options.maxRetries - 最大重试次数，默认3次
 * @param {number} options.baseDelay - 基础延迟时间（毫秒），默认1000ms
 * @param {number} options.maxDelay - 最大延迟时间（毫秒），默认30000ms
 * @param {Function} options.onRetry - 重试时的回调函数，接收 (error, attempt) 参数
 * @param {Function} options.shouldRetry - 判断是否应该重试的函数，接收 error 参数，返回 boolean
 * @returns {Promise<any>} - 函数执行结果
 * @throws {Error} - 如果所有重试都失败，抛出最后一次的错误
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    onRetry = null,
    shouldRetry = null
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 执行函数
      return await fn();
    } catch (error) {
      lastError = error;

      // 检查是否应该重试
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      // 如果是最后一次尝试，直接抛出错误
      if (attempt === maxRetries) {
        throw error;
      }

      // 计算延迟时间（指数退避）
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      // 调用重试回调
      if (onRetry) {
        onRetry(error, attempt + 1);
      }

      console.log(`Retrying ${attempt + 1}/${maxRetries}, retrying after ${delay}ms...`);

      // 等待后重试
      await sleep(delay);
    }
  }

  // 理论上不会到这里，但为了类型安全
  throw lastError;
}

/**
 * 使用线性退避策略重试异步函数
 * @param {Function} fn - 要执行的异步函数
 * @param {Object} options - 重试选项
 * @param {number} options.maxRetries - 最大重试次数，默认3次
 * @param {number} options.delay - 每次重试的延迟时间（毫秒），默认1000ms
 * @param {Function} options.onRetry - 重试时的回调函数
 * @param {Function} options.shouldRetry - 判断是否应该重试的函数
 * @returns {Promise<any>}
 */
async function retryWithLinearBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    delay = 1000,
    onRetry = null,
    shouldRetry = null
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      if (attempt === maxRetries) {
        throw error;
      }

      if (onRetry) {
        onRetry(error, attempt + 1);
      }

      console.log(`Retrying ${attempt + 1}/${maxRetries}, retrying after ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * 判断错误是否可以重试的辅助函数
 * @param {Error} error - 错误对象
 * @returns {boolean} - 是否应该重试
 */
function isRetryableError(error) {
  const message = error.message.toLowerCase();

  // 网络相关的错误
  const networkErrors = [
    'timeout',
    'econnreset',
    'econnrefused',
    'enetunreach',
    'enotfound',
    'network',
    'navigation timeout',
    'net::err',
    'waiting for selector'
  ];

  // 临时性错误
  const temporaryErrors = [
    '503',
    '502',
    '504',
    '429', // 速率限制
    'service unavailable',
    'gateway timeout'
  ];

  // 检查是否包含可重试的错误信息
  const hasRetryableMessage = networkErrors.some(err => message.includes(err)) ||
                              temporaryErrors.some(err => message.includes(err));

  return hasRetryableMessage;
}

/**
 * 包装 Puppeteer 页面导航的重试函数
 * @param {Object} page - Puppeteer 页面对象
 * @param {string} url - 要导航的 URL
 * @param {Object} navigationOptions - 导航选项
 * @param {Object} retryOptions - 重试选项
 * @returns {Promise<void>}
 */
async function retryPageGoto(page, url, navigationOptions = {}, retryOptions = {}) {
  return retryWithBackoff(
    () => page.goto(url, navigationOptions),
    {
      maxRetries: retryOptions.maxRetries || 3,
      baseDelay: retryOptions.baseDelay || 2000,
      shouldRetry: isRetryableError,
      onRetry: (error, attempt) => {
        console.log(`Page navigation to ${url} failed: ${error.message}`);
      },
      ...retryOptions
    }
  );
}

/**
 * 包装 Puppeteer 等待选择器的重试函数
 * @param {Object} page - Puppeteer 页面对象
 * @param {string} selector - 选择器
 * @param {Object} waitOptions - 等待选项
 * @param {Object} retryOptions - 重试选项
 * @returns {Promise<void>}
 */
async function retryWaitForSelector(page, selector, waitOptions = {}, retryOptions = {}) {
  return retryWithBackoff(
    () => page.waitForSelector(selector, waitOptions),
    {
      maxRetries: retryOptions.maxRetries || 2,
      baseDelay: retryOptions.baseDelay || 1000,
      shouldRetry: isRetryableError,
      onRetry: (error, attempt) => {
        console.log(`Waiting for selector ${selector} failed: ${error.message}`);
      },
      ...retryOptions
    }
  );
}

module.exports = {
  sleep,
  retryWithBackoff,
  retryWithLinearBackoff,
  isRetryableError,
  retryPageGoto,
  retryWaitForSelector
};
