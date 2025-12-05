import { describe, test, expect, beforeEach } from 'bun:test';
import { ScraperEventBus } from '../../core/event-bus';

describe('ScraperEventBus', () => {
    let eventBus: ScraperEventBus;

    beforeEach(() => {
        eventBus = new ScraperEventBus();
    });

    test('should emit progress events', (done) => {
        const progressData = { current: 10, target: 100, action: 'scraping' };

        eventBus.on('scrape:progress', (data) => {
            expect(data).toEqual(progressData);
            done();
        });

        eventBus.emitProgress(progressData);
    });

    test('should emit log messages', (done) => {
        eventBus.on('log:message', (data) => {
            expect(data.message).toBe('Test message');
            expect(data.level).toBe('info');
            expect(data.timestamp).toBeInstanceOf(Date);
            done();
        });

        eventBus.emitLog('Test message', 'info');
    });
});
