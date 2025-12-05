/**
 * DataExtractor 单元测试
 * 使用 bun:test
 */

import { describe, test, expect, mock, beforeEach, spyOn } from 'bun:test';
import { parseCount, extractProfileInfo, extractTweetsFromPage, X_SELECTORS } from '../../core/data-extractor';
import { Page } from 'puppeteer';

describe('DataExtractor', () => {
    describe('parseCount', () => {
        test('should parse simple numbers', () => {
            expect(parseCount('123')).toBe(123);
            expect(parseCount('1,234')).toBe(1234);
        });

        test('should parse K suffix', () => {
            expect(parseCount('1.5K')).toBe(1500);
            expect(parseCount('10k')).toBe(10000);
        });

        test('should parse M suffix', () => {
            expect(parseCount('1.2M')).toBe(1200000);
            expect(parseCount('5m')).toBe(5000000);
        });

        test('should handle invalid input', () => {
            expect(parseCount(null)).toBe(0);
            expect(parseCount(undefined)).toBe(0);
            expect(parseCount('abc')).toBe(0);
        });
    });

    describe('extractProfileInfo', () => {
        let mockPage: Page;
        let evaluateMock: ReturnType<typeof mock>;

        beforeEach(() => {
            evaluateMock = mock(() => Promise.resolve(null));
            mockPage = {
                evaluate: evaluateMock,
            } as unknown as Page;
        });

        test('should extract profile info successfully', async () => {
            const mockProfile = {
                displayName: 'Test User',
                handle: 'testuser',
                followers: 1000
            };
            evaluateMock.mockImplementation(() => Promise.resolve(mockProfile));

            const result = await extractProfileInfo(mockPage);
            expect(result).toEqual(mockProfile);
        });

        test('should handle errors gracefully', async () => {
            evaluateMock.mockImplementation(() => Promise.reject(new Error('Evaluation failed')));
            
            // Should catch error and return null
            const consoleSpy = spyOn(console, 'warn').mockImplementation(() => {});
            const result = await extractProfileInfo(mockPage);
            
            expect(result).toBeNull();
            consoleSpy.mockRestore();
        });
    });

    describe('extractTweetsFromPage', () => {
        let mockPage: Page;
        let evaluateMock: ReturnType<typeof mock>;

        beforeEach(() => {
            evaluateMock = mock(() => Promise.resolve([]));
            mockPage = {
                evaluate: evaluateMock,
            } as unknown as Page;
        });

        test('should extract tweets using correct selectors', async () => {
            const mockTweets = [
                { id: '1', text: 'Hello', author: 'user1' }
            ];
            evaluateMock.mockImplementation(() => Promise.resolve(mockTweets));

            const result = await extractTweetsFromPage(mockPage);
            
            expect(result).toEqual(mockTweets);
            expect(evaluateMock).toHaveBeenCalled();
        });

        test('should return empty array on failure', async () => {
            evaluateMock.mockImplementation(() => Promise.reject(new Error('Failed')));
            
            const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
            const result = await extractTweetsFromPage(mockPage);
            
            expect(result).toEqual([]);
            consoleSpy.mockRestore();
        });
    });
});
