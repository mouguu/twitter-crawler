/**
 * BrowserManager 单元测试
 * 使用 bun:test 和 mock.module
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { BrowserManager, BrowserLaunchOptions, ProxyConfig } from '../../core/browser-manager';

// 创建 mock 对象
const mockCDPSession = {
    send: mock(() => Promise.resolve(undefined))
};

const mockPage = {
    setUserAgent: mock(() => Promise.resolve(undefined)),
    setViewport: mock(() => Promise.resolve(undefined)),
    setRequestInterception: mock(() => Promise.resolve(undefined)),
    on: mock(() => {}),
    authenticate: mock(() => Promise.resolve(undefined)),
    close: mock(() => Promise.resolve(undefined)),
    target: mock(() => ({
        createCDPSession: mock(() => Promise.resolve(mockCDPSession))
    }))
};

const mockBrowser = {
    newPage: mock(() => Promise.resolve(mockPage)),
    close: mock(() => Promise.resolve(undefined)),
    pages: mock(() => [mockPage])
};

// Mock puppeteer-extra 模块
mock.module('puppeteer-extra', () => ({
    default: {
        use: mock(() => {}),
        launch: mock(() => Promise.resolve(mockBrowser))
    }
}));

// 动态导入以使用 mock
import puppeteer from 'puppeteer-extra';

describe('BrowserManager', () => {
    let browserManager: BrowserManager;

    beforeEach(() => {
        browserManager = new BrowserManager();
        
        // 重置 mock 调用记录
        (mockPage.setUserAgent as any).mockClear?.();
        (mockPage.authenticate as any).mockClear?.();
        (mockPage.setRequestInterception as any).mockClear?.();
        (mockPage.on as any).mockClear?.();
        (mockBrowser.newPage as any).mockClear?.();
        (mockBrowser.close as any).mockClear?.();
    });

    describe('constructor', () => {
        test('should initialize with null browser and page', () => {
            const manager = new BrowserManager();
            expect(manager).toBeDefined();
        });
    });

    describe('init', () => {
        test('should launch browser with default options', async () => {
            await browserManager.init();
            expect(puppeteer.launch).toHaveBeenCalled();
        });

        test('should launch browser with custom headless option', async () => {
            await browserManager.init({ headless: false });
            expect(puppeteer.launch).toHaveBeenCalled();
        });

        test('should launch browser with proxy', async () => {
            const proxyConfig: ProxyConfig = {
                host: 'proxy.example.com',
                port: 8080,
                username: 'user',
                password: 'pass'
            };

            await browserManager.init({ proxy: proxyConfig });
            expect(puppeteer.launch).toHaveBeenCalled();
        });
    });

    describe('newPage', () => {
        test('should throw error if browser not initialized', async () => {
            await expect(browserManager.newPage()).rejects.toThrow();
        });

        test('should create new page after initialization', async () => {
            await browserManager.init();
            const page = await browserManager.newPage();
            
            expect(mockBrowser.newPage).toHaveBeenCalled();
            expect(page).toBeDefined();
        });

        test('should inject proxy authentication if provided', async () => {
            const proxyConfig: ProxyConfig = {
                host: 'proxy.example.com',
                port: 8080,
                username: 'user',
                password: 'pass'
            };

            await browserManager.init({ proxy: proxyConfig });
            await browserManager.newPage({ proxy: proxyConfig });

            expect(mockPage.authenticate).toHaveBeenCalledWith({
                username: 'user',
                password: 'pass'
            });
        });

        test('should set user agent if provided', async () => {
            await browserManager.init();
            await browserManager.newPage({ userAgent: 'Custom Agent' });

            expect(mockPage.setUserAgent).toHaveBeenCalledWith('Custom Agent');
        });

        test('should configure request interception if blockResources is true', async () => {
            await browserManager.init();
            await browserManager.newPage({ blockResources: true });

            expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
            expect(mockPage.on).toHaveBeenCalled();
        });
    });

    describe('close', () => {
        test('should close browser if initialized', async () => {
            await browserManager.init();
            await browserManager.close();

            expect(mockBrowser.close).toHaveBeenCalled();
        });

        test('should handle close when browser not initialized', async () => {
            // Should not throw when closing uninitialized browser
            await browserManager.close();
            // If we get here, it didn't throw
            expect(true).toBe(true);
        });
    });

    describe('getPage', () => {
        test('should return current page if exists', async () => {
            await browserManager.init();
            await browserManager.newPage();
            const page = browserManager.getPage();

            expect(page).toBeDefined();
        });

        test('should throw error if no page created', async () => {
            await browserManager.init();
            
            expect(() => {
                browserManager.getPage();
            }).toThrow();
        });
    });

    describe('getBrowser', () => {
        test('should return browser if initialized', async () => {
            await browserManager.init();
            const browser = browserManager.getBrowser();

            expect(browser).toBeDefined();
        });

        test('should throw error if not initialized', () => {
            expect(() => {
                browserManager.getBrowser();
            }).toThrow();
        });
    });
});
