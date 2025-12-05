/**
 * Advanced Fingerprint Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
    AdvancedFingerprint,
    generateRandomConfig,
    WINDOWS_CHROME_CONFIG,
    MACOS_SAFARI_CONFIG,
} from '../../core/advanced-fingerprint';

describe('AdvancedFingerprint', () => {
    describe('Configuration', () => {
        test('should generate random config', () => {
            const config = generateRandomConfig();
            
            expect(config).toBeDefined();
            expect(config.canvas).toBeDefined();
            expect(config.canvas.enabled).toBe(true);
            expect(config.canvas.factor).toBeGreaterThan(0);
            
            expect(config.webgl).toBeDefined();
            expect(config.webgl.enabled).toBe(true);
            expect(config.webgl.vendor).toBeDefined();
            expect(config.webgl.renderer).toBeDefined();
            
            expect(config.audio).toBeDefined();
            expect(config.audio.enabled).toBe(true);
            
            expect(config.hardware).toBeDefined();
            expect(config.timezone).toBeDefined();
            expect(config.languages).toBeDefined();
        });

        test('should generate different configs on each call', () => {
            const config1 = generateRandomConfig();
            const config2 = generateRandomConfig();

            // At least one field should be different due to randomness
            const isDifferent = 
                config1.canvas.factor !== config2.canvas.factor ||
                config1.audio.noiseFactor !== config2.audio.noiseFactor ||
                config1.webgl.renderer !== config2.webgl.renderer ||
                config1.timezone !== config2.timezone;

            expect(isDifferent).toBe(true);
        });

        test('WINDOWS_CHROME_CONFIG should have valid structure', () => {
            expect(WINDOWS_CHROME_CONFIG.webgl.vendor).toContain('NVIDIA');
            expect(WINDOWS_CHROME_CONFIG.hardware.maxTouchPoints).toBe(0);
            expect(WINDOWS_CHROME_CONFIG.timezone).toBe('America/New_York');
        });

        test('MACOS_SAFARI_CONFIG should have valid structure', () => {
            expect(MACOS_SAFARI_CONFIG.webgl.vendor).toContain('Apple');
            expect(MACOS_SAFARI_CONFIG.webgl.renderer).toContain('M1');
            expect(MACOS_SAFARI_CONFIG.timezone).toBe('America/Los_Angeles');
        });
    });

    describe('AdvancedFingerprint Class', () => {
        test('should create instance with default random config', () => {
            const fp = new AdvancedFingerprint();
            expect(fp).toBeDefined();
            expect(fp.getConfig()).toBeDefined();
        });

        test('should accept partial config override', () => {
            const fp = new AdvancedFingerprint({
                canvas: { enabled: true, factor: 0.1 },
            });
            const config = fp.getConfig();
            expect(config.canvas.factor).toBe(0.1);
        });

        test('should update config via setConfig', () => {
            const fp = new AdvancedFingerprint();
            fp.setConfig({ timezone: 'Europe/Paris' });
            expect(fp.getConfig().timezone).toBe('Europe/Paris');
        });

        test('should regenerate random config', () => {
            const fp = new AdvancedFingerprint();
            const originalFactor = fp.getConfig().canvas.factor;
            
            // Regenerate multiple times to ensure at least one change
            let changed = false;
            for (let i = 0; i < 10; i++) {
                fp.regenerate();
                if (fp.getConfig().canvas.factor !== originalFactor) {
                    changed = true;
                    break;
                }
            }
            
            // There's a very small chance this fails due to randomness
            expect(changed).toBe(true);
        });

        test('getConfig should return copy of config', () => {
            const fp = new AdvancedFingerprint();
            const config1 = fp.getConfig();
            const config2 = fp.getConfig();
            
            // Should be equal but not same reference
            expect(config1).not.toBe(config2);
            expect(config1.canvas.factor).toBe(config2.canvas.factor);
        });
    });

    describe('Injection Script', () => {
        test('inject method should exist', async () => {
            const fp = new AdvancedFingerprint();
            expect(fp.inject).toBeDefined();
            expect(typeof fp.inject).toBe('function');
        });
    });
});

describe('Hardware Configuration', () => {
    test('should have reasonable device memory values', () => {
        for (let i = 0; i < 10; i++) {
            const config = generateRandomConfig();
            const memory = config.hardware.deviceMemory;
            expect(memory).toBeDefined();
            expect([4, 8, 16, 32]).toContain(memory!);
        }
    });

    test('should have reasonable CPU core counts', () => {
        for (let i = 0; i < 10; i++) {
            const config = generateRandomConfig();
            const cores = config.hardware.hardwareConcurrency;
            expect(cores).toBeDefined();
            expect([4, 6, 8, 12, 16]).toContain(cores!);
        }
    });

    test('should have zero max touch points for desktop', () => {
        const config = generateRandomConfig();
        expect(config.hardware.maxTouchPoints).toBe(0);
    });
});
