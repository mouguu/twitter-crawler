/**
 * Cookie 管理器
 * 负责 Cookie 的加载、验证和注入
 */

const fs = require('fs').promises;
const path = require('path');
const validation = require('../utils/validation');

/**
 * Cookie 管理器类
 */
class CookieManager {
  constructor(options = {}) {
    this.primaryCookieFile = options.primaryCookieFile || path.join(process.cwd(), 'env.json');
    this.fallbackCookieFile = options.fallbackCookieFile || path.join(process.cwd(), 'cookies', 'twitter-cookies.json');
    this.cookies = null;
    this.username = null;
    this.source = null;
  }

  /**
   * 从文件加载 Cookie
   * @returns {Promise<Object>} - { cookies: Array, username: string|null, source: string }
   */
  async load() {
    let envData = null;
    let cookieSource = null;

    // 首先尝试主 Cookie 文件
    try {
      const cookiesString = await fs.readFile(this.primaryCookieFile, 'utf-8');
      envData = JSON.parse(cookiesString);
      cookieSource = this.primaryCookieFile;
    } catch (primaryError) {
      // 如果主文件失败，尝试备用文件
      try {
        const cookiesString = await fs.readFile(this.fallbackCookieFile, 'utf-8');
        envData = JSON.parse(cookiesString);
        cookieSource = this.fallbackCookieFile;
      } catch (fallbackError) {
        throw new Error(
          `Failed to load cookies from both primary (${this.primaryCookieFile}) and fallback (${this.fallbackCookieFile}) locations. ` +
          `Primary error: ${primaryError.message}. Fallback error: ${fallbackError.message}`
        );
      }
    }

    // 验证 Cookie 数据
    const cookieValidation = validation.validateEnvCookieData(envData);
    if (!cookieValidation.valid) {
      throw new Error(`Cookie validation failed: ${cookieValidation.error}`);
    }

    // 存储验证后的数据
    this.cookies = cookieValidation.cookies;
    this.username = cookieValidation.username;
    this.source = cookieSource;

    return {
      cookies: this.cookies,
      username: this.username,
      source: this.source
    };
  }

  /**
   * 将 Cookie 注入到页面
   * @param {Page} page - Puppeteer 页面对象
   * @returns {Promise<void>}
   */
  async injectIntoPage(page) {
    if (!this.cookies) {
      throw new Error('Cookies not loaded. Call load() first.');
    }

    if (!page) {
      throw new Error('Page is required');
    }

    await page.setCookie(...this.cookies);
  }

  /**
   * 加载并注入 Cookie（便捷方法）
   * @param {Page} page - Puppeteer 页面对象
   * @returns {Promise<Object>} - Cookie 信息
   */
  async loadAndInject(page) {
    const cookieInfo = await this.load();
    await this.injectIntoPage(page);
    return cookieInfo;
  }

  /**
   * 获取已加载的 Cookie
   * @returns {Array|null}
   */
  getCookies() {
    return this.cookies;
  }

  /**
   * 获取用户名
   * @returns {string|null}
   */
  getUsername() {
    return this.username;
  }

  /**
   * 获取 Cookie 来源
   * @returns {string|null}
   */
  getSource() {
    return this.source;
  }

  /**
   * 检查 Cookie 是否已加载
   * @returns {boolean}
   */
  isLoaded() {
    return this.cookies !== null;
  }

  /**
   * 清除已加载的 Cookie
   */
  clear() {
    this.cookies = null;
    this.username = null;
    this.source = null;
  }
}

/**
 * 创建并加载 Cookie 管理器
 * @param {Object} options - 配置选项
 * @returns {Promise<CookieManager>}
 */
async function createCookieManager(options = {}) {
  const manager = new CookieManager(options);
  await manager.load();
  return manager;
}

module.exports = {
  CookieManager,
  createCookieManager
};
