import { describe, test, expect, afterEach } from 'bun:test';
import { getShouldStopScraping, resetShouldStopScraping, setShouldStopScraping } from '../../core/stop-signal';

describe('stop-signal', () => {
    afterEach(() => {
        resetShouldStopScraping();
    });

    test('defaults to false and can be toggled', () => {
        expect(getShouldStopScraping()).toBe(false);
        setShouldStopScraping(true);
        expect(getShouldStopScraping()).toBe(true);
    });

    test('reset clears the flag', () => {
        setShouldStopScraping(true);
        resetShouldStopScraping();
        expect(getShouldStopScraping()).toBe(false);
    });
});
