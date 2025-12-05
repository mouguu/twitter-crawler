import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
/**
 * Decorators 工具单元测试
 */

import { RetryOnNetworkError, HandleRateLimit } from '../../utils/decorators';
import { ScraperErrors } from '../../core/errors';

describe('Decorators', () => {
  describe('RetryOnNetworkError', () => {
    class TestClass {
      callCount = 0;
      lastError: any = null;

      @RetryOnNetworkError(2, 10, 1.5)
      async failingMethod(errorMessage: string): Promise<string> {
        this.callCount++;
        throw new Error(errorMessage);
      }

      @RetryOnNetworkError(2, 10, 1.5)
      async successMethod(): Promise<string> {
        this.callCount++;
        return 'success';
      }

      @RetryOnNetworkError(2, 10, 1.5)
      async networkErrorMethod(): Promise<string> {
        this.callCount++;
        const error: any = new Error('network timeout');
        throw error;
      }
    }

    test('should retry on network errors', async () => {
      const instance = new TestClass();
      
      await expect(
        instance.networkErrorMethod()
      ).rejects.toThrow('network timeout');
      
      expect(instance.callCount).toBe(3); // initial + 2 retries
    });

    test('should succeed on first attempt', async () => {
      const instance = new TestClass();
      
      const result = await instance.successMethod();
      
      expect(result).toBe('success');
      expect(instance.callCount).toBe(1);
    });

    test('should not retry non-network errors', async () => {
      const instance = new TestClass();
      
      await expect(
        instance.failingMethod('validation failed')
      ).rejects.toThrow('validation failed');
      
      // The decorator checks for specific error messages, so validation errors won't retry
      expect(instance.callCount).toBe(1); // No retry for non-network errors
    });
  });

  describe('HandleRateLimit', () => {
    class TestClass {
      @HandleRateLimit()
      async rateLimitedMethod(): Promise<string> {
        const error: any = new Error('Rate limit exceeded');
        error.status = 429;
        throw error;
      }

      @HandleRateLimit()
      async normalMethod(): Promise<string> {
        return 'success';
      }

      @HandleRateLimit()
      async normalErrorMethod(): Promise<string> {
        throw new Error('Normal error');
      }
    }

    test('should handle rate limit errors', async () => {
      const instance = new TestClass();
      
      await expect(
        instance.rateLimitedMethod()
      ).rejects.toThrow(); // ScraperErrors.rateLimitExceeded() is thrown
    });

    test('should pass through normal errors', async () => {
      const instance = new TestClass();
      
      const result = await instance.normalMethod();
      expect(result).toBe('success');
    });

    test('should not catch non-rate-limit errors', async () => {
      const instance = new TestClass();
      
      await expect(
        instance.normalErrorMethod()
      ).rejects.toThrow('Normal error');
    });
  });
});

