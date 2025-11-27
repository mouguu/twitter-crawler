/**
 * Cookie 管理器
 * 负责 Cookie 的加载、验证和注入
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Page, Protocol } from 'puppeteer';
import * as validation from '../utils/validation';
import { ScraperErrors } from './errors';

export interface CookieManagerOptions {
  cookiesDir?: string;
  enableRotation?: boolean;
}

export interface CookieLoadResult {
  cookies: Protocol.Network.CookieParam[];
  username: string | null;
  source: string | null;
}

export interface SessionInfo {
  filename: string;
  username: string | null;
  isValid: boolean;
  error?: string;
  cookieCount: number;
}

/**
 * Cookie 管理器类
 */
export class CookieManager {
  private cookiesDir: string;
  private enableRotation: boolean;
  private cookies: Protocol.Network.CookieParam[] | null;
  private username: string | null;
  private source: string | null;
  private cookieFiles: string[];
  private currentCookieIndex: number;

  constructor(options: CookieManagerOptions = {}) {
    this.cookiesDir = options.cookiesDir || path.join(process.cwd(), 'cookies');
    this.enableRotation = options.enableRotation !== false; // Default: enabled
    this.cookies = null;
    this.username = null;
    this.source = null;
    this.cookieFiles = [];
    this.currentCookieIndex = 0;
  }

  /**
   * 扫描 cookies 目录，获取所有可用的 cookie 文件
   */
  async scanCookieFiles(): Promise<string[]> {
    try {
      // Ensure directory exists
      try {
        await fs.access(this.cookiesDir);
      } catch {
        console.warn(`[CookieManager] Cookies directory not found: ${this.cookiesDir}`);
        return [];
      }

      const files = await fs.readdir(this.cookiesDir);
      this.cookieFiles = files
        .filter(file => file.endsWith('.json'))
        .map(file => path.join(this.cookiesDir, file));
      return [...this.cookieFiles];
    } catch (error: any) {
      console.warn(`[CookieManager] Failed to scan cookies directory: ${error.message}`);
      return [];
    }
  }

  /**
   * Ensure we have an up-to-date list of cookie files before rotating.
   */
  private async ensureCookieFiles(): Promise<void> {
    if (this.cookieFiles.length === 0) {
      await this.scanCookieFiles();
    }

    if (this.cookieFiles.length === 0) {
      throw ScraperErrors.cookieLoadFailed(`No cookie files found in ${this.cookiesDir}. Please place your exported cookie JSON files there.`);
    }
  }

  /**
   * 获取下一个 cookie 文件（轮换逻辑）
   */
  async getNextCookieFile(excludePath?: string): Promise<string> {
    await this.ensureCookieFiles();

    // Skip the excluded file if possible
    if (excludePath && this.cookieFiles.length > 1) {
      const normalizedExclude = path.resolve(excludePath);
      let safety = 0;
      while (
        path.resolve(this.cookieFiles[this.currentCookieIndex]) === normalizedExclude &&
        safety < this.cookieFiles.length
      ) {
        this.currentCookieIndex = (this.currentCookieIndex + 1) % this.cookieFiles.length;
        safety++;
      }
    }

    const cookieFile = this.cookieFiles[this.currentCookieIndex];

    if (this.enableRotation && this.cookieFiles.length > 1) {
      this.currentCookieIndex = (this.currentCookieIndex + 1) % this.cookieFiles.length;
      console.log(`[CookieManager] Rotating to cookie file ${this.currentCookieIndex + 1}/${this.cookieFiles.length}: ${path.basename(cookieFile)}`);
    } else {
      console.log(`[CookieManager] Using cookie file: ${path.basename(cookieFile)}`);
    }

    return cookieFile;
  }

  /**
   * 从指定文件加载 Cookie（不改变轮换状态）
   */
  async loadFromFile(cookieFile: string): Promise<CookieLoadResult> {
    try {
      const cookiesString = await fs.readFile(cookieFile, 'utf-8');
      const envData = JSON.parse(cookiesString);
      return this.parseCookieData(envData, cookieFile);
    } catch (error: any) {
      throw ScraperErrors.cookieLoadFailed(`Failed to load cookies from ${cookieFile}: ${error.message}`, error);
    }
  }

  /**
   * 从文件加载 Cookie
   */
  async load(): Promise<CookieLoadResult> {
    const cookieSource = await this.getNextCookieFile();
    return this.loadFromFile(cookieSource);
  }

  /**
   * 解析 Cookie 文件内容并进行验证
   */
  private parseCookieData(envData: any, sourcePath: string): CookieLoadResult {
    const cookieValidation = validation.validateEnvCookieData(envData);
    if (!cookieValidation.valid) {
      throw ScraperErrors.cookieLoadFailed(`Cookie validation failed for ${path.basename(sourcePath)}: ${cookieValidation.error}`);
    }

    this.cookies = cookieValidation.cookies || [];
    this.username = cookieValidation.username || null;
    this.source = sourcePath;

    if (cookieValidation.filteredCount && cookieValidation.filteredCount > 0) {
      console.log(`[CookieManager] Filtered out ${cookieValidation.filteredCount} expired cookie(s), using ${this.cookies?.length || 0} valid cookies`);
    }

    return {
      cookies: this.cookies || [],
      username: this.username,
      source: this.source
    };
  }

  /**
   * 将 Cookie 注入到页面
   */
  async injectIntoPage(page: Page): Promise<void> {
    if (!this.cookies) {
      throw ScraperErrors.cookieLoadFailed('Cookies not loaded. Call load() first.');
    }

    if (!page) {
      throw ScraperErrors.pageNotAvailable();
    }

    await page.setCookie(...(this.cookies as any[]));
  }

  /**
   * 加载并注入 Cookie（便捷方法）
   */
  async loadAndInject(page: Page): Promise<CookieLoadResult> {
    const cookieInfo = await this.load();
    await this.injectIntoPage(page);
    return cookieInfo;
  }

  /**
   * 获取已加载的 Cookie
   */
  getCookies(): Protocol.Network.CookieParam[] | null {
    return this.cookies;
  }

  /**
   * 获取用户名
   */
  getUsername(): string | null {
    return this.username;
  }

  /**
   * 获取 Cookie 来源
   */
  getSource(): string | null {
    return this.source;
  }

  /**
   * 检查 Cookie 是否已加载
   */
  isLoaded(): boolean {
    return this.cookies !== null;
  }

  /**
   * List all available sessions and their status
   */
  async listSessions(): Promise<SessionInfo[]> {
    await this.scanCookieFiles();
    
    const sessions: SessionInfo[] = [];
    
    for (const file of this.cookieFiles) {
      const filename = path.basename(file);
      try {
        const content = await fs.readFile(file, 'utf-8');
        const envData = JSON.parse(content);
        const validationResult = validation.validateEnvCookieData(envData);
        
        sessions.push({
          filename,
          username: validationResult.username || null,
          isValid: validationResult.valid,
          error: validationResult.error,
          cookieCount: validationResult.cookies?.length || 0
        });
      } catch (error: any) {
        sessions.push({
          filename,
          username: null,
          isValid: false,
          error: error.message,
          cookieCount: 0
        });
      }
    }
    
    return sessions;
  }

  /**
   * Clear loaded cookies
   */
  clear(): void {
    this.cookies = null;
    this.username = null;
    this.source = null;
  }
}

/**
 * 创建并加载 Cookie 管理器
 */
export async function createCookieManager(options: CookieManagerOptions = {}): Promise<CookieManager> {
  const manager = new CookieManager(options);
  await manager.load();
  return manager;
}
