/**
 * Result 类型模式
 * 统一的成功/失败返回值处理
 */

/**
 * Result 类
 * 表示操作的结果，可能是成功或失败
 */
class Result {
  /**
   * 创建 Result 实例（不应直接调用，使用静态方法）
   * @param {boolean} success - 是否成功
   * @param {*} data - 成功时的数据
   * @param {Error|string} error - 失败时的错误
   * @param {Object} metadata - 额外的元数据
   */
  constructor(success, data = null, error = null, metadata = {}) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.metadata = metadata;
  }

  /**
   * 创建成功的 Result
   * @param {*} data - 成功的数据
   * @param {Object} metadata - 额外的元数据
   * @returns {Result}
   */
  static ok(data, metadata = {}) {
    return new Result(true, data, null, metadata);
  }

  /**
   * 创建失败的 Result
   * @param {Error|string} error - 错误信息
   * @param {Object} metadata - 额外的元数据
   * @returns {Result}
   */
  static fail(error, metadata = {}) {
    const errorMessage = error instanceof Error ? error.message : error;
    return new Result(false, null, errorMessage, metadata);
  }

  /**
   * 检查是否成功
   * @returns {boolean}
   */
  isOk() {
    return this.success === true;
  }

  /**
   * 检查是否失败
   * @returns {boolean}
   */
  isFail() {
    return this.success === false;
  }

  /**
   * 获取数据，如果失败则抛出错误
   * @returns {*}
   * @throws {Error}
   */
  unwrap() {
    if (this.success) {
      return this.data;
    }
    throw new Error(`Cannot unwrap failed Result: ${this.error}`);
  }

  /**
   * 获取数据，如果失败则返回默认值
   * @param {*} defaultValue - 默认值
   * @returns {*}
   */
  unwrapOr(defaultValue) {
    return this.success ? this.data : defaultValue;
  }

  /**
   * 如果成功，应用函数到数据
   * @param {Function} fn - 转换函数
   * @returns {Result}
   */
  map(fn) {
    if (this.success) {
      try {
        return Result.ok(fn(this.data), this.metadata);
      } catch (error) {
        return Result.fail(error, this.metadata);
      }
    }
    return this;
  }

  /**
   * 如果失败，应用函数到错误
   * @param {Function} fn - 转换函数
   * @returns {Result}
   */
  mapError(fn) {
    if (!this.success) {
      try {
        return Result.fail(fn(this.error), this.metadata);
      } catch (error) {
        return Result.fail(error, this.metadata);
      }
    }
    return this;
  }

  /**
   * 链式调用：如果当前成功，执行返回 Result 的函数
   * @param {Function} fn - 返回 Result 的函数
   * @returns {Result}
   */
  andThen(fn) {
    if (this.success) {
      try {
        return fn(this.data);
      } catch (error) {
        return Result.fail(error, this.metadata);
      }
    }
    return this;
  }

  /**
   * 转换为普通对象
   * @returns {Object}
   */
  toObject() {
    return {
      success: this.success,
      data: this.data,
      error: this.error,
      ...this.metadata
    };
  }

  /**
   * 转换为 JSON 字符串
   * @returns {string}
   */
  toJSON() {
    return JSON.stringify(this.toObject());
  }
}

/**
 * 包装异步函数，使其返回 Result
 * @param {Function} fn - 异步函数
 * @returns {Function} - 返回 Result 的函数
 */
function wrapAsync(fn) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      return Result.ok(result);
    } catch (error) {
      return Result.fail(error);
    }
  };
}

/**
 * 包装同步函数，使其返回 Result
 * @param {Function} fn - 同步函数
 * @returns {Function} - 返回 Result 的函数
 */
function wrap(fn) {
  return (...args) => {
    try {
      const result = fn(...args);
      return Result.ok(result);
    } catch (error) {
      return Result.fail(error);
    }
  };
}

/**
 * 合并多个 Result
 * 如果所有都成功，返回成功的 Result 包含所有数据的数组
 * 如果任何一个失败，返回第一个失败的 Result
 * @param {Array<Result>} results - Result 数组
 * @returns {Result}
 */
function combine(results) {
  const failed = results.find(r => r.isFail());
  if (failed) {
    return failed;
  }
  const data = results.map(r => r.data);
  return Result.ok(data);
}

/**
 * 从 Promise 创建 Result
 * @param {Promise} promise - Promise 对象
 * @returns {Promise<Result>}
 */
async function fromPromise(promise) {
  try {
    const data = await promise;
    return Result.ok(data);
  } catch (error) {
    return Result.fail(error);
  }
}

module.exports = {
  Result,
  wrapAsync,
  wrap,
  combine,
  fromPromise
};
