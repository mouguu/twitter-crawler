/**
 * 浏览器池管理器（可选功能，默认关闭）
 * 
 * 作用：复用浏览器实例，减少资源消耗和启动时间
 * 
 * 适用场景：
 * - 批量爬取多个任务时，可以复用浏览器实例节省启动时间（5-10秒）
 * - 单任务场景不需要，每次创建新浏览器即可
 * 
 * 使用方式：
 * - 默认不启用，需要在 ScraperEngineOptions 中明确提供 browserPoolOptions
 * - 如果不提供，每次任务会创建新的浏览器实例
 */

import { Browser } from 'puppeteer';
import { BrowserManager, BrowserLaunchOptions } from './browser-manager';
import { ScraperError, ErrorCode } from './errors';

export interface BrowserPoolOptions {
  maxSize?: number;
  minSize?: number;
  idleTimeout?: number; // 空闲超时（毫秒）
  browserOptions?: BrowserLaunchOptions;
}

export interface PooledBrowser {
  browser: Browser;
  lastUsed: number;
  inUse: boolean;
}

/**
 * 浏览器池
 * 管理多个浏览器实例，支持复用和自动清理
 */
export class BrowserPool {
  private pool: PooledBrowser[] = [];
  private maxSize: number;
  private minSize: number;
  private idleTimeout: number;
  private browserOptions: BrowserLaunchOptions;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: BrowserPoolOptions = {}) {
    this.maxSize = options.maxSize || 3;
    this.minSize = options.minSize || 1;
    this.idleTimeout = options.idleTimeout || 300000; // 5 分钟
    this.browserOptions = options.browserOptions || { headless: true };

    // 启动清理任务
    this.startCleanupTask();
  }

  /**
   * 获取浏览器实例（从池中获取或创建新的）
   */
  async acquire(): Promise<Browser> {
    // 1. 尝试从池中获取空闲浏览器
    const available = this.pool.find(b => !b.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available.browser;
    }

    // 2. 如果池未满，创建新浏览器
    if (this.pool.length < this.maxSize) {
      const browser = await this.createBrowser();
      const pooled: PooledBrowser = {
        browser,
        lastUsed: Date.now(),
        inUse: true
      };
      this.pool.push(pooled);
      return browser;
    }

    // 3. 池已满，等待可用浏览器
    return this.waitForAvailable();
  }

  /**
   * 释放浏览器实例（归还到池中）
   */
  release(browser: Browser): void {
    const pooled = this.pool.find(p => p.browser === browser);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
    }
  }

  /**
   * 创建新浏览器实例
   */
  private async createBrowser(): Promise<Browser> {
    try {
      const manager = new BrowserManager();
      await manager.init(this.browserOptions);
      return manager.getBrowser()!;
    } catch (error: any) {
      throw new ScraperError(
        ErrorCode.BROWSER_ERROR,
        `Failed to create browser: ${error.message}`,
        { retryable: true, originalError: error }
      );
    }
  }

  /**
   * 等待可用浏览器
   */
  private async waitForAvailable(): Promise<Browser> {
    const maxWait = 30000; // 最多等待 30 秒
    const checkInterval = 100; // 每 100ms 检查一次
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const available = this.pool.find(b => !b.inUse);
      if (available) {
        available.inUse = true;
        available.lastUsed = Date.now();
        return available.browser;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new ScraperError(
      ErrorCode.BROWSER_ERROR,
      'Timeout waiting for available browser',
      { retryable: true }
    );
  }

  /**
   * 启动清理任务（定期清理空闲浏览器）
   */
  private startCleanupTask(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 清理空闲浏览器
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    const toRemove: PooledBrowser[] = [];

    // 找出需要清理的浏览器（空闲且超过超时时间）
    for (const pooled of this.pool) {
      if (!pooled.inUse && (now - pooled.lastUsed) > this.idleTimeout) {
        // 保持最小池大小
        if (this.pool.length > this.minSize) {
          toRemove.push(pooled);
        }
      }
    }

    // 关闭并移除浏览器
    for (const pooled of toRemove) {
      try {
        await pooled.browser.close();
        const index = this.pool.indexOf(pooled);
        if (index > -1) {
          this.pool.splice(index, 1);
        }
      } catch (error: any) {
        console.warn(`Failed to close browser in pool: ${error.message}`);
      }
    }
  }

  /**
   * 获取池状态
   */
  getStatus(): {
    total: number;
    inUse: number;
    available: number;
    maxSize: number;
  } {
    return {
      total: this.pool.length,
      inUse: this.pool.filter(b => b.inUse).length,
      available: this.pool.filter(b => !b.inUse).length,
      maxSize: this.maxSize
    };
  }

  /**
   * 关闭所有浏览器并清空池
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const closePromises = this.pool.map(async (pooled) => {
      try {
        await pooled.browser.close();
      } catch (error: any) {
        console.warn(`Failed to close browser: ${error.message}`);
      }
    });

    await Promise.all(closePromises);
    this.pool = [];
  }

  /**
   * 关闭所有空闲浏览器（保持最小池大小）
   */
  async shrink(): Promise<void> {
    const available = this.pool.filter(b => !b.inUse);
    const toKeep = Math.max(this.minSize, this.pool.length - available.length);

    const toClose = available.slice(toKeep);
    for (const pooled of toClose) {
      try {
        await pooled.browser.close();
        const index = this.pool.indexOf(pooled);
        if (index > -1) {
          this.pool.splice(index, 1);
        }
      } catch (error: any) {
        console.warn(`Failed to close browser: ${error.message}`);
      }
    }
  }
}

// 全局单例
let globalBrowserPool: BrowserPool | null = null;

/**
 * 获取全局浏览器池实例
 */
export function getBrowserPool(options?: BrowserPoolOptions): BrowserPool {
  if (!globalBrowserPool) {
    globalBrowserPool = new BrowserPool(options);
  }
  return globalBrowserPool;
}

/**
 * 重置全局浏览器池（主要用于测试）
 */
export function resetBrowserPool(): void {
  if (globalBrowserPool) {
    globalBrowserPool.close();
    globalBrowserPool = null;
  }
}

