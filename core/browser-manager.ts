/**
 * 浏览器管理器
 * 负责浏览器的启动、配置和关闭
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page, HTTPRequest } from 'puppeteer';
import * as constants from '../config/constants';
import { getRandomFingerprint, getRandomUserAgent } from '../config/constants';
import { ScraperErrors } from './errors';

puppeteer.use(StealthPlugin());

export interface ProxyConfig {
    host: string;
    port: number;
    username: string;
    password: string;
}

export interface BrowserLaunchOptions {
    headless?: boolean;
    userAgent?: string;
    blockResources?: boolean;
    blockedResourceTypes?: string[];
    puppeteerOptions?: any;
    proxy?: ProxyConfig;
    /** 🆕 是否启用指纹随机化（默认 true） */
    randomizeFingerprint?: boolean;
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
     * 从外部 Browser 实例初始化（用于浏览器池）
     */
    initFromBrowser(browser: Browser): void {
        this.browser = browser;
    }

    /**
     * 启动浏览器 (Renamed from launch to match ScraperEngine usage)
     */
    async init(options: BrowserLaunchOptions = {}): Promise<void> {
        // 禁用代理环境变量（除非使用自定义代理）
        if (!options.proxy) {
            delete process.env.HTTP_PROXY;
            delete process.env.HTTPS_PROXY;
            delete process.env.http_proxy;
            delete process.env.https_proxy;
        }

        // Determine Chrome executable path
        // Priority: options.puppeteerOptions.executablePath > PUPPETEER_EXECUTABLE_PATH > CHROME_BIN > auto-detect
        const executablePath = options.puppeteerOptions?.executablePath 
            || process.env.PUPPETEER_EXECUTABLE_PATH 
            || process.env.CHROME_BIN
            || undefined; // Let puppeteer auto-detect if not specified

        // 🆕 指纹随机化（默认启用）
        const useRandomFingerprint = options.randomizeFingerprint !== false;
        const fingerprint = useRandomFingerprint ? getRandomFingerprint() : null;
        
        // 确定使用的 viewport
        const viewport = fingerprint?.viewport || constants.BROWSER_VIEWPORT;
        
        // 构建浏览器启动参数
        const browserArgs = [...constants.BROWSER_ARGS];
        
        // 🆕 使用随机窗口大小替换默认值
        if (fingerprint) {
            const windowSizeIndex = browserArgs.findIndex(arg => arg.startsWith('--window-size='));
            if (windowSizeIndex >= 0) {
                browserArgs[windowSizeIndex] = fingerprint.windowSize;
            } else {
                browserArgs.push(fingerprint.windowSize);
            }
        }

        const launchOptions: any = {
            headless: options.headless !== false,
            args: browserArgs,
            defaultViewport: viewport,
            ...options.puppeteerOptions,
            // Ensure executablePath is set if provided
            ...(executablePath ? { executablePath } : {})
        };

        // Add proxy server if provided
        if (options.proxy) {
            const proxyUrl = `${options.proxy.host}:${options.proxy.port}`;
            launchOptions.args.push(`--proxy-server=${proxyUrl}`);
            console.log(`[BrowserManager] Launching with proxy: ${proxyUrl}`);
        }

        if (executablePath) {
            console.log(`[BrowserManager] Using Chrome at: ${executablePath}`);
        }
        
        // 🆕 输出指纹信息
        if (fingerprint) {
            console.log(`[BrowserManager] 🎭 Random fingerprint: ${viewport.width}x${viewport.height}`);
        }

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
            throw ScraperErrors.browserNotInitialized();
        }

        this.page = await this.browser.newPage();

        // Inject proxy authentication if provided
        if (options.proxy) {
            await this.page.authenticate({
                username: options.proxy.username,
                password: options.proxy.password
            });
            console.log(`[BrowserManager] Proxy authentication injected for ${options.proxy.host}:${options.proxy.port}`);
        }

        // 🆕 设置 User Agent（支持随机化）
        const useRandomFingerprint = options.randomizeFingerprint !== false;
        const userAgent = options.userAgent 
            || (useRandomFingerprint ? getRandomUserAgent() : constants.BROWSER_USER_AGENT);
        await this.page.setUserAgent(userAgent);
        
        if (useRandomFingerprint && !options.userAgent) {
            // 只显示 UA 的简短版本
            const uaShort = userAgent.includes('Chrome') 
                ? `Chrome/${userAgent.match(/Chrome\/(\d+)/)?.[1] || '?'}`
                : userAgent.includes('Firefox')
                    ? `Firefox/${userAgent.match(/Firefox\/(\d+)/)?.[1] || '?'}`
                    : userAgent.includes('Safari')
                        ? 'Safari'
                        : 'Unknown';
            console.log(`[BrowserManager] 🎭 Random UA: ${uaShort}`);
        }

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
            throw ScraperErrors.pageNotAvailable();
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
            throw ScraperErrors.pageNotAvailable();
        }
        return this.page;
    }

    /**
     * 获取浏览器实例
     */
    getBrowser(): Browser {
        if (!this.browser) {
            throw ScraperErrors.browserNotInitialized();
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
                throw ScraperErrors.cookieLoadFailed('Invalid cookie file format');
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
