/**
 * Retry 工具单元测试
 * 使用 bun:test
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import * as retry from '../../utils/retry';
import { Page } from 'puppeteer';

describe('Retry Utils', () => {
    describe('sleep', () => {
        test('should delay for specified time', async () => {
            const start = Date.now();
            await retry.sleep(100);
            const duration = Date.now() - start;
            
            expect(duration).toBeGreaterThanOrEqual(90);
            expect(duration).toBeLessThan(200);
        });
    });

    describe('retryWithBackoff', () => {
        test('should succeed on first attempt', async () => {
            const fn = mock(() => Promise.resolve('success'));
            
            const result = await retry.retryWithBackoff(fn);
            
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        test('should retry on failure', async () => {
            let callCount = 0;
            const fn = mock(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.reject(new Error('Fail 1'));
                }
                return Promise.resolve('success');
            });
            
            const result = await retry.retryWithBackoff(fn, { maxRetries: 2 });
            
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        test('should throw after max retries', async () => {
            const fn = mock(() => Promise.reject(new Error('Always fail')));
            
            await expect(
                retry.retryWithBackoff(fn, { maxRetries: 2 })
            ).rejects.toThrow('Always fail');
            
            expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
        });

        test('should call onRetry callback', async () => {
            const onRetry = mock(() => {});
            let callCount = 0;
            const fn = mock(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.reject(new Error('Fail'));
                }
                return Promise.resolve('success');
            });
            
            await retry.retryWithBackoff(fn, { maxRetries: 1, onRetry });
            
            expect(onRetry).toHaveBeenCalled();
        });

        test('should respect shouldRetry callback', async () => {
            const fn = mock(() => Promise.reject(new Error('Non-retryable')));
            const shouldRetry = mock(() => false);
            
            await expect(
                retry.retryWithBackoff(fn, { maxRetries: 2, shouldRetry })
            ).rejects.toThrow('Non-retryable');
            
            expect(fn).toHaveBeenCalledTimes(1); // Should not retry
        });

        test('should use exponential backoff', async () => {
            let callCount = 0;
            const fn = mock(() => {
                callCount++;
                if (callCount <= 2) {
                    return Promise.reject(new Error(`Fail ${callCount}`));
                }
                return Promise.resolve('success');
            });
            
            const start = Date.now();
            await retry.retryWithBackoff(fn, {
                maxRetries: 2,
                baseDelay: 50
            });
            const totalTime = Date.now() - start;
            
            // Should have delays between retries
            expect(totalTime).toBeGreaterThan(50);
        });
    });

    describe('retryPageGoto', () => {
        test('should have retryPageGoto function', () => {
            expect(typeof retry.retryPageGoto).toBe('function');
        });
    });

    describe('retryWaitForSelector', () => {
        test('should have retryWaitForSelector function', () => {
            expect(typeof retry.retryWaitForSelector).toBe('function');
        });
    });
});
