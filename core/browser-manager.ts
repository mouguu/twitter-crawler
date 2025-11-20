/**
 * 浏览器管理器
 * 负责浏览器的启动、配置和关闭
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page, HTTPRequest } from 'puppeteer';
import * as constants from '../config/constants';

puppeteer.use(StealthPlugin());

export interface BrowserLaunchOptions {
    headless?: boolean;
    userAgent?: string;
    blockResources?: boolean;
    blockedResourceTypes?: string[];
    puppeteerOptions?: any;
}

/**
 * 浏览器管理器类
 */
export class BrowserManager {
    private browser: Browser | null;
    private page: Page | null;

    constructor() {
        this.browser = null;
        this.page = null;
    }

    /**
     * 启动浏览器 (Renamed from launch to match ScraperEngine usage)
     */
    async init(options: BrowserLaunchOptions = {}): Promise<void> {
        // 禁用代理环境变量
        delete process.env.HTTP_PROXY;
        delete process.env.HTTPS_PROXY;
        delete process.env.http_proxy;
        delete process.env.https_proxy;

        const launchOptions = {
            headless: options.headless !== false,
            args: [...constants.BROWSER_ARGS], // 确保参数被正确传递
            defaultViewport: constants.BROWSER_VIEWPORT,
            ...options.puppeteerOptions
        };

        console.log('[BrowserManager] Launching with args:', launchOptions.args);

        try {
            this.browser = await puppeteer.launch(launchOptions);
            console.log('[BrowserManager] Browser launched successfully');
        } catch (error) {
            console.error('[BrowserManager] Failed to launch browser:', error);
            throw error;
        }
    }

    /**
     * 创建新页面并配置
     */
    /**
     * 创建新页面并配置 (Renamed to newPage to match usage)
     */
    async newPage(options: BrowserLaunchOptions = {}): Promise<Page> {
        if (!this.browser) {
            throw new Error('[BrowserManager] Browser not initialized. Call init() first.');
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
     */
    async setupRequestInterception(blockedTypes: string[] | null = null): Promise<void> {
        if (!this.page) {
            throw new Error('Page not created. Call createPage() first.');
        }

        const typesToBlock = blockedTypes || constants.BLOCKED_RESOURCE_TYPES;

        // 1. 尝试使用 CDP (Chrome DevTools Protocol) 进行更高效的底层屏蔽 (Mimicking Crawlee)
        try {
            const client = await this.page.target().createCDPSession();
            await client.send('Network.enable');

            // 常见静态资源后缀
            const patterns = [
                '*.jpg', '*.jpeg', '*.png', '*.gif', '*.svg', '*.webp',
                '*.woff', '*.woff2', '*.ttf', '*.eot',
                '*.mp4', '*.webm', '*.avi', '*.mov',
                '*.css', // Twitter 的 CSS 可能会影响布局，但通常不影响数据抓取，屏蔽可大幅提速
                '*.ico'
            ];

            await client.send('Network.setBlockedURLs', { urls: patterns });
            console.log('[BrowserManager] Enabled CDP resource blocking for static assets (High Performance)');
        } catch (e) {
            console.warn('[BrowserManager] Failed to enable CDP blocking, falling back to standard interception', e);
        }

        // 2. Puppeteer 层面的拦截 (作为兜底，处理没有后缀但类型匹配的资源)
        await this.page.setRequestInterception(true);
        this.page.on('request', (req: HTTPRequest) => {
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
     */
    getPage(): Page {
        if (!this.page) {
            throw new Error('Page not created. Call createPage() first.');
        }
        return this.page;
    }

    /**
     * 获取浏览器实例
     */
    getBrowser(): Browser {
        if (!this.browser) {
            throw new Error('Browser not launched. Call launch() first.');
        }
        return this.browser;
    }

    /**
     * 加载 Cookies
     */
    async loadCookies(page: Page, cookieFilePath: string): Promise<void> {
        try {
            const fs = require('fs');
            const parsed = JSON.parse(fs.readFileSync(cookieFilePath, 'utf-8'));

            // Support both array format and object format with "cookies" key
            const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;

            if (!Array.isArray(cookies)) {
                throw new Error('Invalid cookie file format');
            }

            await page.setCookie(...cookies);
            console.log(`[BrowserManager] Loaded cookies from ${cookieFilePath}`);
        } catch (error) {
            console.error(`[BrowserManager] Failed to load cookies: ${error}`);
            throw error;
        }
    }

    /**
     * 关闭浏览器
     * 包含错误处理和强制终止逻辑
     */
    async close(): Promise<void> {
        if (!this.browser) {
            return;
        }

        try {
            // 尝试正常关闭浏览器
            await this.browser.close();
            console.log('Browser closed successfully');
        } catch (closeError: any) {
            console.error(`Browser close failed: ${closeError.message}`);

            // 如果正常关闭失败，尝试强制终止浏览器进程
            try {
                const browserProcess = this.browser.process();
                if (browserProcess && browserProcess.pid) {
                    console.log(`Attempting to kill browser process (PID: ${browserProcess.pid})...`);
                    process.kill(browserProcess.pid, 'SIGKILL');
                    console.log('Browser process killed successfully');
                }
            } catch (killError: any) {
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
     */
    isRunning(): boolean {
        return this.browser !== null && this.browser.process() !== null;
    }

    /**
     * 检查页面是否已创建
     */
    hasPage(): boolean {
        return this.page !== null;
    }
}

/**
 * 创建并初始化浏览器管理器
 */
export async function createBrowserManager(options: BrowserLaunchOptions = {}): Promise<BrowserManager> {
    const manager = new BrowserManager();
    await manager.init(options);
    await manager.newPage(options);
    return manager;
}
