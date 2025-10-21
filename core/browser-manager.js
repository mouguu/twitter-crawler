/**
 * 浏览器管理器
 * 负责浏览器的启动、配置和关闭
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const constants = require('../config/constants');

/**
 * 浏览器管理器类
 */
class BrowserManager {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  /**
   * 启动浏览器
   * @param {Object} options - 浏览器启动选项
   * @returns {Promise<void>}
   */
  async launch(options = {}) {
    const launchOptions = {
      headless: options.headless !== false,
      args: constants.BROWSER_ARGS,
      defaultViewport: constants.BROWSER_VIEWPORT,
      ...options.puppeteerOptions
    };

    this.browser = await puppeteer.launch(launchOptions);
  }

  /**
   * 创建新页面并配置
   * @param {Object} options - 页面配置选项
   * @returns {Promise<Page>}
   */
  async createPage(options = {}) {
    if (!this.browser) {
      throw new Error('Browser not launched. Call launch() first.');
    }

    this.page = await this.browser.newPage();

    // 设置 User Agent
    await this.page.setUserAgent(options.userAgent || constants.BROWSER_USER_AGENT);

    // 配置请求拦截
    if (options.blockResources !== false) {
      await this.setupRequestInterception(options.blockedResourceTypes);
    }

    return this.page;
  }

  /**
   * 设置请求拦截以屏蔽不必要的资源
   * @param {Array<string>} blockedTypes - 要屏蔽的资源类型
   * @returns {Promise<void>}
   */
  async setupRequestInterception(blockedTypes = null) {
    if (!this.page) {
      throw new Error('Page not created. Call createPage() first.');
    }

    const typesToBlock = blockedTypes || constants.BLOCKED_RESOURCE_TYPES;

    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (typesToBlock.includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  /**
   * 获取当前页面
   * @returns {Page}
   */
  getPage() {
    if (!this.page) {
      throw new Error('Page not created. Call createPage() first.');
    }
    return this.page;
  }

  /**
   * 获取浏览器实例
   * @returns {Browser}
   */
  getBrowser() {
    if (!this.browser) {
      throw new Error('Browser not launched. Call launch() first.');
    }
    return this.browser;
  }

  /**
   * 关闭浏览器
   * 包含错误处理和强制终止逻辑
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.browser) {
      return;
    }

    try {
      // 尝试正常关闭浏览器
      await this.browser.close();
      console.log('Browser closed successfully');
    } catch (closeError) {
      console.error(`Browser close failed: ${closeError.message}`);

      // 如果正常关闭失败，尝试强制终止浏览器进程
      try {
        const browserProcess = this.browser.process();
        if (browserProcess && browserProcess.pid) {
          console.log(`Attempting to kill browser process (PID: ${browserProcess.pid})...`);
          process.kill(browserProcess.pid, 'SIGKILL');
          console.log('Browser process killed successfully');
        }
      } catch (killError) {
        console.error(`Failed to kill browser process: ${killError.message}`);
        // 即使强制终止失败，也继续执行，避免阻塞后续操作
      }
    } finally {
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * 检查浏览器是否正在运行
   * @returns {boolean}
   */
  isRunning() {
    return this.browser !== null && this.browser.process() !== null;
  }

  /**
   * 检查页面是否已创建
   * @returns {boolean}
   */
  hasPage() {
    return this.page !== null;
  }
}

/**
 * 创建并初始化浏览器管理器
 * @param {Object} options - 初始化选项
 * @returns {Promise<BrowserManager>}
 */
async function createBrowserManager(options = {}) {
  const manager = new BrowserManager();
  await manager.launch(options);
  await manager.createPage(options);
  return manager;
}

module.exports = {
  BrowserManager,
  createBrowserManager
};
