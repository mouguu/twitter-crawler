/**
 * SessionManager 单元测试
 * 使用真实文件系统进行集成测试
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SessionManager } from '../../core/session-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SessionManager', () => {
    let sessionManager: SessionManager;
    let testCookieDir: string;

    beforeEach(() => {
        // 创建临时测试目录
        testCookieDir = path.join(os.tmpdir(), 'test-cookies-' + Date.now());
        fs.mkdirSync(testCookieDir, { recursive: true });
        
        sessionManager = new SessionManager(testCookieDir);
    });

    afterEach(() => {
        // 清理测试目录
        try {
            fs.rmSync(testCookieDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    // 辅助函数：创建模拟的 cookie 文件
    function createMockCookieFile(filename: string) {
        const cookieData = {
            cookies: [
                { name: 'auth_token', value: 'test123', domain: '.twitter.com', path: '/' }
            ]
        };
        fs.writeFileSync(
            path.join(testCookieDir, filename),
            JSON.stringify(cookieData)
        );
    }

    describe('init', () => {
        test('should load sessions from cookie files', async () => {
            // 创建测试 cookie 文件
            createMockCookieFile('session1.json');
            createMockCookieFile('session2.json');

            await sessionManager.init();

            expect(sessionManager.hasActiveSession()).toBe(true);
            expect(sessionManager.getSessionById('session1')).toBeDefined();
            expect(sessionManager.getSessionById('session2')).toBeDefined();
        });

        test('should handle missing directory gracefully', async () => {
            // 使用不存在的目录
            const managerWithMissingDir = new SessionManager('/non/existent/path');
            
            await managerWithMissingDir.init();
            
            expect(managerWithMissingDir.hasActiveSession()).toBe(false);
        });

        test('should handle empty directory', async () => {
            // 目录存在但没有文件
            await sessionManager.init();
            
            expect(sessionManager.hasActiveSession()).toBe(false);
        });
    });

    describe('getNextSession', () => {
        beforeEach(async () => {
            createMockCookieFile('s1.json');
            createMockCookieFile('s2.json');
            await sessionManager.init();
        });

        test('should return a session', () => {
            const session = sessionManager.getNextSession();
            expect(session).toBeDefined();
            expect(['s1', 's2']).toContain(session?.id);
        });

        test('should prioritize preferred session', () => {
            const session = sessionManager.getNextSession('s2.json');
            expect(session?.id).toBe('s2');
        });

        test('should exclude specified session', () => {
            const session = sessionManager.getNextSession(undefined, 's1.json');
            expect(session?.id).toBe('s2');
        });

        test('should prioritize healthy sessions (fewer errors)', () => {
            sessionManager.markBad('s1'); // s1 has 1 error
            
            const session = sessionManager.getNextSession();
            // Should pick s2 because it has 0 errors
            expect(session?.id).toBe('s2');
        });
    });

    describe('Session Health', () => {
        beforeEach(async () => {
            createMockCookieFile('s1.json');
            await sessionManager.init();
        });

        test('should retire session after max errors', () => {
            const maxErrors = 3;
            for (let i = 0; i < maxErrors; i++) {
                sessionManager.markBad('s1');
            }

            expect(sessionManager.getSessionById('s1')?.isRetired).toBe(true);
            expect(sessionManager.hasActiveSession()).toBe(false);
        });

        test('should increment usage count on markGood', () => {
            sessionManager.markGood('s1');
            const session = sessionManager.getSessionById('s1');
            expect(session?.usageCount).toBe(1);
        });

        test('should reset consecutive failures on markGood', () => {
            sessionManager.markBad('s1');
            sessionManager.markGood('s1');
            
            const session = sessionManager.getSessionById('s1');
            expect(session?.consecutiveFailures).toBe(0);
        });
    });
});
