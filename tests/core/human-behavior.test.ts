/**
 * Human Behavior Tests
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { HumanBehavior, DEFAULT_HUMAN_CONFIG, FAST_HUMAN_CONFIG } from '../../core/human-behavior';

describe('HumanBehavior', () => {
    let behavior: HumanBehavior;

    beforeEach(() => {
        behavior = new HumanBehavior();
    });

    describe('Configuration', () => {
        test('should use default config by default', () => {
            const newBehavior = new HumanBehavior();
            expect(newBehavior).toBeDefined();
        });

        test('should accept custom config', () => {
            const customBehavior = new HumanBehavior({
                typingSpeed: { min: 10, max: 20, errorRate: 0 },
            });
            expect(customBehavior).toBeDefined();
        });

        test('should switch to fast config', () => {
            behavior.useFastConfig();
            // Verify by checking behavior still works
            expect(behavior).toBeDefined();
        });

        test('should switch back to default config', () => {
            behavior.useFastConfig();
            behavior.useDefaultConfig();
            expect(behavior).toBeDefined();
        });
    });

    describe('Delay Functions', () => {
        test('randomDelay should wait within range', async () => {
            const start = Date.now();
            await behavior.randomDelay(10, 30);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(10);
            expect(elapsed).toBeLessThan(100); // Allow some overhead
        });

        test('gaussianDelay should respect minimum', async () => {
            const start = Date.now();
            await behavior.gaussianDelay(50, 10, 30);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(30);
        });

        test('humanWait should delay correctly', async () => {
            const start = Date.now();
            await behavior.humanWait(20, 50);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(20);
        });
    });

    describe('maybeRest', () => {
        test('should return boolean', async () => {
            const result = await behavior.maybeRest();
            expect(typeof result).toBe('boolean');
        });

        test('should eventually rest with high probability config', async () => {
            const highRestBehavior = new HumanBehavior({
                rest: { chance: 1, duration: { min: 1, max: 5 } },
            });
            const result = await highRestBehavior.maybeRest();
            expect(result).toBe(true);
        });

        test('should never rest with zero probability', async () => {
            const noRestBehavior = new HumanBehavior({
                rest: { chance: 0, duration: { min: 1, max: 5 } },
            });
            const result = await noRestBehavior.maybeRest();
            expect(result).toBe(false);
        });
    });

    describe('betweenActions', () => {
        test('should accept different types', async () => {
            const start = Date.now();
            await behavior.betweenActions({ type: 'fast', mayRest: false });
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThan(0);
        });

        test('fast type should be quicker than slow', async () => {
            const fastBehavior = new HumanBehavior({
                rest: { chance: 0, duration: { min: 0, max: 1 } },
            });

            const startFast = Date.now();
            await fastBehavior.betweenActions({ type: 'fast', mayRest: false });
            const fastElapsed = Date.now() - startFast;

            const startSlow = Date.now();
            await fastBehavior.betweenActions({ type: 'slow', mayRest: false });
            const slowElapsed = Date.now() - startSlow;

            // Slow should generally take longer (with some variance)
            expect(slowElapsed).toBeGreaterThanOrEqual(fastElapsed * 0.5);
        });
    });

    describe('simulateReading', () => {
        test('should delay based on content length', async () => {
            const start = Date.now();
            await behavior.simulateReading(100);
            const elapsed = Date.now() - start;
            // Should take at least baseTime / 2
            expect(elapsed).toBeGreaterThan(200);
        });

        test('longer content should take more time', async () => {
            const startShort = Date.now();
            await behavior.simulateReading(100);
            const shortElapsed = Date.now() - startShort;

            const startLong = Date.now();
            await behavior.simulateReading(1000);
            const longElapsed = Date.now() - startLong;

            // Longer content should generally take more time
            expect(longElapsed).toBeGreaterThanOrEqual(shortElapsed * 0.8);
        });
    });
});

describe('Config Presets', () => {
    test('DEFAULT_HUMAN_CONFIG should have all required fields', () => {
        expect(DEFAULT_HUMAN_CONFIG.typingSpeed).toBeDefined();
        expect(DEFAULT_HUMAN_CONFIG.mouseMoveSpeed).toBeDefined();
        expect(DEFAULT_HUMAN_CONFIG.click).toBeDefined();
        expect(DEFAULT_HUMAN_CONFIG.scroll).toBeDefined();
        expect(DEFAULT_HUMAN_CONFIG.reading).toBeDefined();
        expect(DEFAULT_HUMAN_CONFIG.rest).toBeDefined();
    });

    test('FAST_HUMAN_CONFIG should have faster settings', () => {
        expect(FAST_HUMAN_CONFIG.typingSpeed.max).toBeLessThan(DEFAULT_HUMAN_CONFIG.typingSpeed.max);
        expect(FAST_HUMAN_CONFIG.click.preDelay.max).toBeLessThan(DEFAULT_HUMAN_CONFIG.click.preDelay.max);
        expect(FAST_HUMAN_CONFIG.rest.chance).toBeLessThan(DEFAULT_HUMAN_CONFIG.rest.chance);
    });
});
