import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'puppeteer';

export interface Session {
    id: string;
    cookies: any[];
    usageCount: number;
    errorCount: number;
    isRetired: boolean;
    filePath: string;
}

export class SessionManager {
    private sessions: Session[] = [];
    private currentSessionIndex: number = 0;
    private maxErrorCount: number = 3;

    constructor(private cookieDir: string = './cookies') { }

    /**
     * 初始化：加载所有 Cookie 文件
     */
    async init(): Promise<void> {
        if (!fs.existsSync(this.cookieDir)) {
            console.warn(`[SessionManager] Cookie directory not found: ${this.cookieDir}`);
            return;
        }

        const files = fs.readdirSync(this.cookieDir).filter(f => f.endsWith('.json'));

        for (const file of files) {
            try {
                const filePath = path.join(this.cookieDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(content);

                // Support both array format and object format with "cookies" key
                let cookies = Array.isArray(parsed) ? parsed : parsed.cookies;

                // 简单的验证：必须是数组且有内容
                if (Array.isArray(cookies) && cookies.length > 0) {
                    this.sessions.push({
                        id: file.replace('.json', ''),
                        cookies,
                        usageCount: 0,
                        errorCount: 0,
                        isRetired: false,
                        filePath
                    });
                }
            } catch (e) {
                console.error(`[SessionManager] Failed to load cookie file ${file}:`, e);
            }
        }

        console.log(`[SessionManager] Loaded ${this.sessions.length} sessions.`);
    }

    /**
     * 获取下一个可用 Session (轮询策略)
     */
    getSession(): Session | null {
        const activeSessions = this.sessions.filter(s => !s.isRetired);
        if (activeSessions.length === 0) return null;

        // 简单的轮询
        const session = activeSessions[this.currentSessionIndex % activeSessions.length];
        this.currentSessionIndex++;

        return session;
    }

    /**
     * 标记 Session 为“坏” (遇到错误)
     * 如果错误次数过多，将自动退休该 Session
     */
    markBad(sessionId: string) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.errorCount++;
            console.warn(`[SessionManager] Session ${sessionId} error count: ${session.errorCount}`);

            if (session.errorCount >= this.maxErrorCount) {
                this.retire(sessionId);
            }
        }
    }

    /**
     * 标记 Session 为“好” (成功抓取)
     */
    markGood(sessionId: string) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.usageCount++;
            // 成功一次可以抵消一次错误 (可选)
            if (session.errorCount > 0) session.errorCount--;
        }
    }

    /**
     * 退休 Session (不再使用)
     */
    retire(sessionId: string) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.isRetired = true;
            console.error(`[SessionManager] Session ${sessionId} has been RETIRED due to too many errors.`);
        }
    }

    /**
     * 将 Session 注入到 Page
     */
    async injectSession(page: Page, session: Session): Promise<void> {
        console.log(`[SessionManager] Injecting session: ${session.id}`);
        await page.setCookie(...session.cookies);
    }
}
