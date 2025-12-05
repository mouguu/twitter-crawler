/**
 * AntiDetection Integration Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { AntiDetection, type AntiDetectionLevel } from '../../core/anti-detection';

describe('AntiDetection', () => {
    describe('Initialization', () => {
        test('should create instance with default config', () => {
            const ad = new AntiDetection();
            expect(ad).toBeDefined();
            expect(ad.getLevel()).toBe('high'); // Default level
        });

        test('should accept level option', () => {
            const ad = new AntiDetection({ level: 'paranoid' });
            expect(ad.getLevel()).toBe('paranoid');
        });

        test('should accept all levels', () => {
            const levels: AntiDetectionLevel[] = ['low', 'medium', 'high', 'paranoid'];
            for (const level of levels) {
                const ad = new AntiDetection({ level });
                expect(ad.getLevel()).toBe(level);
            }
        });
    });

    describe('Level Configuration', () => {
        test('should change level dynamically', () => {
            const ad = new AntiDetection({ level: 'low' });
            expect(ad.getLevel()).toBe('low');
            
            ad.setLevel('paranoid');
            expect(ad.getLevel()).toBe('paranoid');
        });

        test('getSummary should include level info', () => {
            const ad = new AntiDetection({ level: 'medium' });
            const summary = ad.getSummary();
            
            expect(summary).toContain('medium');
            expect(summary).toContain('Basic Fingerprint');
            expect(summary).toContain('Advanced Fingerprint');
        });

        test('low level should have minimal features', () => {
            const ad = new AntiDetection({ level: 'low' });
            const summary = ad.getSummary();
            
            expect(summary).toContain('Basic Fingerprint: ✓');
            expect(summary).toContain('Advanced Fingerprint: ✗');
            expect(summary).toContain('Human Behavior: ✗');
        });

        test('paranoid level should have all features', () => {
            const ad = new AntiDetection({ level: 'paranoid' });
            const summary = ad.getSummary();
            
            expect(summary).toContain('Basic Fingerprint: ✓');
            expect(summary).toContain('Advanced Fingerprint: ✓');
            expect(summary).toContain('Human Behavior: ✓');
        });
    });

    describe('Components Access', () => {
        test('should expose internal components', () => {
            const ad = new AntiDetection();
            const components = ad.getComponents();
            
            expect(components.fingerprintManager).toBeDefined();
            expect(components.advancedFingerprint).toBeDefined();
            expect(components.humanBehavior).toBeDefined();
        });
    });

    describe('Delay Functions', () => {
        test('delay should wait correctly', async () => {
            const ad = new AntiDetection();
            const start = Date.now();
            await ad.delay(10, 30);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(10);
        });

        test('betweenActions should accept type parameter', async () => {
            const ad = new AntiDetection({ level: 'low' }); // No human behavior
            const start = Date.now();
            await ad.betweenActions('fast');
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThan(0);
        });

        test('simulateReading should delay', async () => {
            const ad = new AntiDetection({ level: 'low' }); // Faster for testing
            const start = Date.now();
            await ad.simulateReading(100);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThan(0);
        });

        test('maybeRest should return boolean', async () => {
            const ad = new AntiDetection({ level: 'low' });
            const result = await ad.maybeRest();
            expect(typeof result).toBe('boolean');
        });
    });

    describe('Custom Configuration', () => {
        test('should accept custom fingerprint config', () => {
            const ad = new AntiDetection({
                level: 'high',
                fingerprint: {
                    timezone: 'Asia/Tokyo',
                },
            });
            expect(ad).toBeDefined();
        });

        test('should accept custom behavior config', () => {
            const ad = new AntiDetection({
                level: 'high',
                behavior: {
                    typingSpeed: { min: 10, max: 20, errorRate: 0 },
                },
            });
            expect(ad).toBeDefined();
        });

        test('should accept custom fingerprint directory', () => {
            const ad = new AntiDetection({
                fingerprintDir: '/tmp/test-fingerprints',
            });
            expect(ad).toBeDefined();
        });
    });
});

describe('Level Feature Matrix', () => {
    const levels: AntiDetectionLevel[] = ['low', 'medium', 'high', 'paranoid'];

    test('higher levels should have more features', () => {
        const summaries = levels.map(level => ({
            level,
            summary: new AntiDetection({ level }).getSummary(),
        }));

        // Count checkmarks in each summary
        const counts = summaries.map(s => (s.summary.match(/✓/g) || []).length);

        // Low should have fewest, paranoid should have most
        expect(counts[0]).toBeLessThanOrEqual(counts[1]);
        expect(counts[1]).toBeLessThanOrEqual(counts[2]);
        expect(counts[2]).toBeLessThanOrEqual(counts[3]);
    });
});
