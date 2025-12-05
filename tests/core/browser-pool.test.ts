/**
 * BrowserPool 单元测试
 * 使用 bun:test
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BrowserPool, BrowserPoolOptions } from '../../core/browser-pool';
import { Browser } from 'puppeteer';

describe('BrowserPool', () => {
    let pool: BrowserPool;

    beforeEach(() => {
        // Reset pool
        pool = new BrowserPool({
            maxSize: 3,
            minSize: 1,
            idleTimeout: 1000
        });
    });

    afterEach(async () => {
        try {
            await pool.close();
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    describe('constructor', () => {
        test('should create pool with default options', async () => {
            const defaultPool = new BrowserPool();
            expect(defaultPool).toBeDefined();
            await defaultPool.close();
        });

        test('should create pool with custom options', async () => {
            const customPool = new BrowserPool({
                maxSize: 5,
                minSize: 2,
                idleTimeout: 5000
            });
            expect(customPool).toBeDefined();
            await customPool.close();
        });
    });

    describe('acquire', () => {
        test('should have acquire method', () => {
            expect(pool).toBeDefined();
            expect(typeof pool.acquire).toBe('function');
        });

        test('should have getStatus method', () => {
            const status = pool.getStatus();
            expect(status).toHaveProperty('total');
            expect(status).toHaveProperty('inUse');
            expect(status).toHaveProperty('available');
            expect(status).toHaveProperty('maxSize');
        });
    });

    describe('release', () => {
        test('should have release method', () => {
            expect(typeof pool.release).toBe('function');
        });

        test('should handle releasing unknown browser', () => {
            const fakeBrowser = {} as Browser;
            expect(() => pool.release(fakeBrowser)).not.toThrow();
        });
    });

    describe('getStatus', () => {
        test('should return correct status structure', () => {
            const status = pool.getStatus();
            expect(status).toHaveProperty('total');
            expect(status).toHaveProperty('inUse');
            expect(status).toHaveProperty('available');
            expect(status).toHaveProperty('maxSize');
            expect(typeof status.total).toBe('number');
            expect(typeof status.inUse).toBe('number');
            expect(status.maxSize).toBe(3);
        });
    });

    describe('close', () => {
        test('should handle close when pool is empty', async () => {
            // Just verify it completes without throwing
            await pool.close();
            expect(true).toBe(true);
        });
    });

    describe('shrink', () => {
        test('should have shrink method', async () => {
            expect(typeof pool.shrink).toBe('function');
            // Just verify it completes without throwing
            await pool.shrink();
            expect(true).toBe(true);
        });
    });
});
