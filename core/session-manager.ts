import * as fs from 'fs';
import * as path from 'path';
import { Page, Protocol } from 'puppeteer';
import { CookieManager } from './cookie-manager';
import { ScraperEventBus } from './event-bus';

export interface Session {
    id: string;
    cookies: Protocol.Network.CookieParam[];
    usageCount: number;
    errorCount: number;
    isRetired: boolean;
    filePath: string;
    username?: string | null;
}

export class SessionManager {
    private sessions: Session[] = [];
    private currentSessionIndex: number = 0;
    private maxErrorCount: number = 3;
    private cookieManager: CookieManager;

    constructor(private cookieDir: string = './cookies', private eventBus?: ScraperEventBus) {
        this.cookieManager = new CookieManager({ cookiesDir: this.cookieDir, enableRotation: false });
    }

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
            const filePath = path.join(this.cookieDir, file);
            try {
                const cookieInfo = await this.cookieManager.loadFromFile(filePath);
                this.sessions.push({
                    id: file.replace('.json', ''),
                    cookies: cookieInfo.cookies,
                    username: cookieInfo.username,
                    usageCount: 0,
                    errorCount: 0,
                    isRetired: false,
                    filePath
                });
            } catch (e: any) {
                this._log(`Failed to load cookie file ${file}: ${e.message}`, 'error');
            }
        }

        this._log(`[SessionManager] Loaded ${this.sessions.length} sessions.`);
    }

    hasActiveSession(): boolean {
        return this.sessions.some(s => !s.isRetired);
    }

    getSessionById(id: string): Session | undefined {
        return this.sessions.find(s => s.id === id);
    }

    /**
     * 获取下一个可用 Session (按健康度排序，优先选择错误少的)
     */
    getNextSession(preferredId?: string, excludeId?: string): Session | null {
        const activeSessions = this.sessions.filter(s => !s.isRetired);
        if (activeSessions.length === 0) return null;

        const normalizedPreferred = preferredId ? preferredId.replace('.json', '') : undefined;
        if (normalizedPreferred) {
            const preferred = activeSessions.find(s => s.id === normalizedPreferred);
            if (preferred) return preferred;
        }

        const normalizedExclude = excludeId ? excludeId.replace('.json', '') : undefined;
        const eligibleSessions = normalizedExclude
            ? activeSessions.filter(s => s.id !== normalizedExclude)
            : activeSessions;

        if (eligibleSessions.length === 0) {
            return null;
        }

        // 按错误次数排序，优先选择错误最少的 session
        const sorted = [...eligibleSessions].sort((a, b) => {
            // 优先选择错误少的
            if (a.errorCount !== b.errorCount) {
                return a.errorCount - b.errorCount;
            }
            // 错误相同则选择使用次数少的
            return a.usageCount - b.usageCount;
        });

        const selected = sorted[0];
        this._log(`Selected session: ${selected.id} (errors: ${selected.errorCount}, usage: ${selected.usageCount})`);
        return selected;
    }

    /**
     * 标记 Session 为“坏” (遇到错误)
     * 如果错误次数过多，将自动退休该 Session
     */
    markBad(sessionId: string, reason: string = 'unknown error'): void {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.errorCount++;
            this._log(`Session ${sessionId} error count: ${session.errorCount} (${reason})`, 'warn');

            if (session.errorCount >= this.maxErrorCount) {
                this.retire(sessionId);
            }
        }
    }

    /**
     * 标记 Session 为“好” (成功抓取)
     */
    markGood(sessionId: string): void {
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
    retire(sessionId: string): void {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.isRetired = true;
            this._log(`Session ${sessionId} has been RETIRED due to too many errors.`, 'error');
        }
    }

    /**
     * 将 Session 注入到 Page
     */
    async injectSession(page: Page, session: Session, clearExistingCookies: boolean = true): Promise<void> {
        this._log(`Injecting session: ${session.id}`);
        if (clearExistingCookies) {
            const existingCookies = await page.cookies();
            if (existingCookies.length > 0) {
                await page.deleteCookie(...existingCookies);
            }
        }
        await page.setCookie(...(session.cookies as Parameters<typeof page.setCookie>));
    }

    private _log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        if (this.eventBus) {
            this.eventBus.emitLog(message, level);
        } else {
            const prefix = '[SessionManager]';
            if (level === 'error') console.error(prefix, message);
            else if (level === 'warn') console.warn(prefix, message);
            else console.log(prefix, message);
        }
    }
}
