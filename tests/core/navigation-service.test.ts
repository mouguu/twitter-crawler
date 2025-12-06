/**
 * NavigationService 单元测试
 * 使用 bun:test
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Page } from 'puppeteer';
import { ScraperEventBus } from '../../core/scraper-engine.types';
import { NavigationService } from '../../core/navigation-service';

describe('NavigationService', () => {
  let service: NavigationService;
  let mockEventBus: Partial<ScraperEventBus>;
  let mockPage: Partial<Page>;

  beforeEach(() => {
    mockEventBus = {
      emitLog: mock(() => {}),
      emitProgress: mock(() => {}),
      emitPerformance: mock(() => {}),
      emitError: mock(() => {}),
    };

    mockPage = {
      goto: mock(() => Promise.resolve(undefined)),
      waitForSelector: mock(() => Promise.resolve(undefined)),
      waitForNavigation: mock(() => Promise.resolve(undefined)),
      url: mock(() => 'https://example.com'),
      evaluate: mock(() => Promise.resolve(undefined)),
      $: mock(() => Promise.resolve({ textContent: 'tweet' })),
    } as any;

    service = new NavigationService(mockEventBus as ScraperEventBus);
  });

  describe('navigateToUrl', () => {
    test('should navigate to URL', async () => {
      const result = await service.navigateToUrl(mockPage as Page, 'https://example.com');

      expect(result).toBe(true);
      expect(mockPage.goto).toHaveBeenCalled();
    });

    test('should emit log on navigation error', async () => {
      (mockPage.goto as any) = mock(() => Promise.reject(new Error('Navigation failed')));

      await expect(
        service.navigateToUrl(mockPage as Page, 'https://example.com'),
      ).rejects.toThrow();

      expect(mockEventBus.emitLog).toHaveBeenCalled();
    });

    test('should handle navigation errors', async () => {
      (mockPage.goto as any) = mock(() => Promise.reject(new Error('Navigation failed')));

      await expect(
        service.navigateToUrl(mockPage as Page, 'https://example.com'),
      ).rejects.toThrow();
    });
  });

  describe('waitForTweets', () => {
    test('should return true when tweets are found', async () => {
      (mockPage.$ as any) = mock(() => Promise.resolve({ textContent: 'tweet' }));
      (mockPage.evaluate as any) = mock(() => Promise.resolve(false)); // No error page

      const result = await service.waitForTweets(mockPage as Page);

      expect(result).toBe(true);
      expect(mockPage.$).toHaveBeenCalled();
    });

    test('should timeout if neither tweets nor empty state is found', async () => {
      (mockPage.$ as any) = mock(() => Promise.resolve(null)); // No tweets
      (mockPage.evaluate as any) = mock(() => Promise.resolve(false)); // No issues

      await expect(service.waitForTweets(mockPage as Page, { timeout: 500 })).rejects.toThrow();
    }, 10000);
  });
});
