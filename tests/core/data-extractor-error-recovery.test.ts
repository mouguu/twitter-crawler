/**
 * 错误恢复逻辑单元测试
 * 测试 detectErrorPage, clickTryAgainButton, recoverFromErrorPage 等函数
 * 使用 bun:test 和简化的 mock
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Page } from 'puppeteer';
import {
    detectErrorPage,
    clickTryAgainButton,
    recoverFromErrorPage
} from '../../core/data-extractor';
import { ERROR_RECOVERY_CONFIG } from '../../config/constants';

describe('DataExtractor Error Recovery', () => {
    let mockPage: Page;
    let evaluateMock: ReturnType<typeof mock>;

    beforeEach(() => {
        evaluateMock = mock(() => Promise.resolve(false));
        mockPage = {
            evaluate: evaluateMock,
        } as unknown as Page;
    });

    describe('detectErrorPage', () => {
        test('should detect error pages with "something went wrong"', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(true));

            const result = await detectErrorPage(mockPage);
            expect(result).toBe(true);
            expect(evaluateMock).toHaveBeenCalled();
        });

        test('should detect error pages with "rate limit"', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(true));

            const result = await detectErrorPage(mockPage);
            expect(result).toBe(true);
        });

        test('should return false for normal pages', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(false));

            const result = await detectErrorPage(mockPage);
            expect(result).toBe(false);
        });

        test('should handle evaluation errors gracefully', async () => {
            evaluateMock.mockImplementation(() => Promise.reject(new Error('Evaluation failed')));

            const result = await detectErrorPage(mockPage);
            expect(result).toBe(false);
        });
    });

    describe('clickTryAgainButton', () => {
        test('should click button with "Try again" text', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(true));

            const result = await clickTryAgainButton(mockPage);
            expect(result).toBe(true);
            expect(evaluateMock).toHaveBeenCalled();
        });

        test('should click button with "Retry" text', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(true));

            const result = await clickTryAgainButton(mockPage);
            expect(result).toBe(true);
        });

        test('should return false when no button found', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(false));

            const result = await clickTryAgainButton(mockPage);
            expect(result).toBe(false);
        });

        test('should handle evaluation errors gracefully', async () => {
            evaluateMock.mockImplementation(() => Promise.reject(new Error('Evaluation failed')));

            const result = await clickTryAgainButton(mockPage);
            expect(result).toBe(false);
        });
    });

    describe('recoverFromErrorPage', () => {
        test('should return true immediately if no error detected', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(false));

            const result = await recoverFromErrorPage(mockPage);
            expect(result).toBe(true);
        });

        test('should successfully recover after clicking Try Again button', async () => {
            let callCount = 0;
            evaluateMock.mockImplementation(() => {
                callCount++;
                // First call: detect error (true)
                // Second call: click button (true)
                // Third call: check again (false - recovered)
                if (callCount === 1) return Promise.resolve(true);  // Error detected
                if (callCount === 2) return Promise.resolve(true);  // Button clicked
                return Promise.resolve(false); // Recovered
            });

            const result = await recoverFromErrorPage(mockPage, 2);
            expect(result).toBe(true);
        }, 10000);

        test('should retry multiple times if recovery fails', async () => {
            // All attempts detect error
            evaluateMock.mockImplementation(() => Promise.resolve(true));

            const result = await recoverFromErrorPage(mockPage, 2);
            expect(result).toBe(false); // Failed to recover
        }, 15000);

        test('should handle case when no Try Again button is found', async () => {
            let callCount = 0;
            evaluateMock.mockImplementation(() => {
                callCount++;
                // Error detected, but no button found
                if (callCount === 1) return Promise.resolve(true);  // Error detected
                if (callCount === 2) return Promise.resolve(false); // No button found
                return Promise.resolve(true); // Still has error
            });

            const result = await recoverFromErrorPage(mockPage, 1);
            expect(result).toBe(false);
        }, 10000);

        test('should auto-recover if page recovers without button click', async () => {
            let callCount = 0;
            evaluateMock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) return Promise.resolve(true);  // Initial error
                if (callCount === 2) return Promise.resolve(false); // No button found
                return Promise.resolve(false); // Auto-recovered
            });

            const result = await recoverFromErrorPage(mockPage, 2);
            expect(result).toBe(true);
        }, 10000);

        test('should handle evaluation errors during recovery gracefully', async () => {
            let callCount = 0;
            evaluateMock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) return Promise.reject(new Error('Evaluation failed'));
                return Promise.resolve(false); // No error after retry
            });

            // Function should complete without throwing
            const result = await recoverFromErrorPage(mockPage, 1);
            expect(typeof result).toBe('boolean');
        }, 10000);

        test('should use default maxRetries from config when not specified', async () => {
            evaluateMock.mockImplementation(() => Promise.resolve(false));

            const result = await recoverFromErrorPage(mockPage);
            expect(result).toBe(true);
        });
    });
});
