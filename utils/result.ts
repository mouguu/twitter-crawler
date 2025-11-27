/**
 * Result helper utilities for consistent success/failure handling.
 * 提供统一的结果处理工具，用于处理成功/失败场景
 * 
 * 注意：当前代码库中实际使用的是特定结果类型（如 ScrapeTimelineResult, ScrapeThreadResult），
 * 而不是这个通用的 Result 类型。此文件保留为未来统一结果格式的备选方案。
 */

/**
 * 统一的结果类型
 * @template T 成功时的数据类型
 * @template E 失败时的错误类型（默认为 string）
 */
export interface Result<T, E = string> {
  success: boolean;
  data: T | null;
  error: E | null;
  metadata?: Record<string, unknown>;
}

/**
 * 创建成功结果
 * @param data 成功时的数据
 * @param metadata 可选的元数据
 * @returns 成功结果对象
 */
export function ok<T>(data: T, metadata: Record<string, unknown> = {}): Result<T> {
  return { success: true, data, error: null, metadata };
}

/**
 * 创建失败结果
 * @param error 错误信息
 * @param metadata 可选的元数据
 * @returns 失败结果对象
 */
export function fail<E = string>(error: E, metadata: Record<string, unknown> = {}): Result<never, E> {
  return { success: false, data: null, error, metadata };
}

/**
 * 检查结果是否为成功
 * @param result 结果对象
 * @returns 是否为成功结果
 */
export function isOk<T, E>(result: Result<T, E>): result is Result<T, E> & { success: true; data: T } {
  return result.success;
}

/**
 * 检查结果是否为失败
 * @param result 结果对象
 * @returns 是否为失败结果
 */
export function isFail<T, E>(result: Result<T, E>): result is Result<T, E> & { success: false; error: E } {
  return !result.success;
}

/**
 * 获取结果数据，失败时返回默认值
 * @param result 结果对象
 * @param defaultValue 默认值
 * @returns 成功时的数据或默认值
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.success ? (result.data as T) : defaultValue;
}

/**
 * 包装函数，自动将返回值转换为 Result 类型
 * @param fn 要包装的函数
 * @returns 包装后的函数，返回 Result 类型
 */
export function wrap<T extends (...args: any[]) => any>(fn: T) {
  return (...args: Parameters<T>): ReturnType<T> extends Promise<infer R>
    ? Promise<Result<R>>
    : Result<ReturnType<T>> => {
    try {
      const maybePromise = fn(...args);
      if (maybePromise instanceof Promise) {
        return (maybePromise.then(value => ok(value)).catch(err => fail(err))) as any;
      }
      return ok(maybePromise) as any;
    } catch (error: any) {
      return fail(error) as any;
    }
  };
}

/**
 * 将 Promise 转换为 Result 类型
 * @param promise Promise 对象
 * @returns Result 类型的结果
 */
export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    const data = await promise;
    return ok(data);
  } catch (error: any) {
    return fail(error);
  }
}
