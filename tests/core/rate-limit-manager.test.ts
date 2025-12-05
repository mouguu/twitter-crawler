import { describe, test, expect, beforeEach } from 'bun:test';
import { RateLimitManager } from '../../core/rate-limit-manager';
import { ScraperEventBus } from '../../core/event-bus';
import { Page, Protocol } from 'puppeteer';
import { Session } from '../../core/session-manager';

class FakeSessionManager {
    public markedBad: string[] = [];
    private sessions: Session[];

    constructor() {
        this.sessions = [{
            id: 'session-a',
            cookies: [] as Protocol.Network.CookieParam[],
            usageCount: 0,
            errorCount: 0,
            consecutiveFailures: 0,
            isRetired: false,
            filePath: 'session-a.json'
        }, {
            id: 'session-b',
            cookies: [] as Protocol.Network.CookieParam[],
            usageCount: 0,
            errorCount: 0,
            consecutiveFailures: 0,
            isRetired: false,
            filePath: 'session-b.json'
        }];
    }

    markBad(id: string) {
        this.markedBad.push(id);
    }

    getNextSession(_preferredId?: string, excludeId?: string): Session | null {
        const available = this.sessions.filter(s => s.id !== excludeId && !s.isRetired);
        return available[0] || null;
    }
}

describe('RateLimitManager', () => {
    let rateLimitManager: RateLimitManager;
    let mockEventBus: ScraperEventBus;
    let fakeSessionManager: FakeSessionManager;
    let mockPage: Partial<Page>;

    beforeEach(() => {
        mockEventBus = new ScraperEventBus();
        fakeSessionManager = new FakeSessionManager();
        rateLimitManager = new RateLimitManager(fakeSessionManager as any, mockEventBus);
        mockPage = {} as Page;
    });

    test('should detect rate limit errors', () => {
        const error = new Error('Navigation timeout exceeded');
        expect(rateLimitManager.isRateLimitError(error)).toBe(true);

        const normalError = new Error('Something else');
        expect(rateLimitManager.isRateLimitError(normalError)).toBe(false);
    });

    test('should handle rate limit with cookie rotation', async () => {
        const error = new Error('Rate limit exceeded');
        const result = await rateLimitManager.handleRateLimit(mockPage as Page, 0, error, 'session-a');
        expect(result?.id).toBe('session-b');
        expect(fakeSessionManager.markedBad).toContain('session-a');
    });
});
