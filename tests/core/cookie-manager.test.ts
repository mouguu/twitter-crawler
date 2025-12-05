/**
 * CookieManager 单元测试
 * 注意：这个测试文件需要真实的文件系统交互，而不是 mock
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CookieManager } from '../../core/cookie-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CookieManager', () => {
    let cookieManager: CookieManager;
    let testCookiesDir: string;

    beforeEach(() => {
        testCookiesDir = path.join(os.tmpdir(), 'test-cookies-' + Date.now());
        fs.mkdirSync(testCookiesDir, { recursive: true });
        cookieManager = new CookieManager({ cookiesDir: testCookiesDir });
    });

    afterEach(() => {
        try {
            fs.rmSync(testCookiesDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    describe('scanCookieFiles', () => {
        test('should return a list of json files in the directory', async () => {
            // Create test files
            fs.writeFileSync(path.join(testCookiesDir, 'cookie1.json'), '{}');
            fs.writeFileSync(path.join(testCookiesDir, 'cookie2.json'), '{}');
            fs.writeFileSync(path.join(testCookiesDir, 'readme.txt'), 'readme');
            
            const files = await cookieManager.scanCookieFiles();
            
            expect(files).toHaveLength(2);
            expect(files.some(f => f.includes('cookie1.json'))).toBe(true);
            expect(files.some(f => f.includes('cookie2.json'))).toBe(true);
        });

        test('should return empty list if no json files exist', async () => {
            const files = await cookieManager.scanCookieFiles();
            expect(files).toEqual([]);
        });
    });

    describe('getNextCookieFile', () => {
        test('should rotate through cookie files', async () => {
            fs.writeFileSync(path.join(testCookiesDir, 'a.json'), '{}');
            fs.writeFileSync(path.join(testCookiesDir, 'b.json'), '{}');
            
            const file1 = await cookieManager.getNextCookieFile();
            const file2 = await cookieManager.getNextCookieFile();
            const file3 = await cookieManager.getNextCookieFile();
            
            // Files should be rotated
            expect(file1).toBeDefined();
            expect(file2).toBeDefined();
            expect(file3).toBe(file1); // Rotated back
        });
    });

    describe('loadFromFile', () => {
        test('should load cookies from valid file', async () => {
            const cookieData = {
                cookies: [
                    { name: 'auth_token', value: 'test123', domain: '.twitter.com', path: '/' }
                ]
            };
            
            const cookieFile = path.join(testCookiesDir, 'valid.json');
            fs.writeFileSync(cookieFile, JSON.stringify(cookieData));
            
            const result = await cookieManager.loadFromFile(cookieFile);
            
            expect(result.cookies).toHaveLength(1);
            expect(result.cookies[0].name).toBe('auth_token');
        });

        test('should throw error for invalid file', async () => {
            const cookieFile = path.join(testCookiesDir, 'invalid.json');
            fs.writeFileSync(cookieFile, 'not json');
            
            await expect(cookieManager.loadFromFile(cookieFile)).rejects.toThrow();
        });
    });
});
