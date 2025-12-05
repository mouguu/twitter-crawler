import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * ErrorClassifier 单元测试
 */

import * as errorClassifier from '../../utils/error-classifier';
import { ErrorType } from '../../types/errors';

describe('ErrorClassifier', () => {
  describe('classifyError', () => {
    test('should classify rate limit errors', () => {
      const error = new Error('Rate limit exceeded');
      const classified = errorClassifier.classifyError(error);
      
      expect(classified.type).toBe(ErrorType.RATE_LIMIT);
      expect(classified.canRetry).toBe(true);
    });

    test('should classify authentication errors', () => {
      const error = new Error('Authentication failed');
      const classified = errorClassifier.classifyError(error);
      
      expect(classified.type).toBe(ErrorType.AUTH);
      expect(classified.canRetry).toBe(false);
    });

    test('should classify network errors', () => {
      const error = new Error('Network timeout');
      const classified = errorClassifier.classifyError(error);
      
      expect(classified.type).toBe(ErrorType.NETWORK);
      expect(classified.canRetry).toBe(true);
    });

    test('should default to unknown for unrecognized errors', () => {
      const error = new Error('Unknown error');
      const classified = errorClassifier.classifyError(error);
      
      expect(classified.type).toBe(ErrorType.UNKNOWN);
    });

    test('should include suggestion message', () => {
      const error = new Error('Rate limit exceeded');
      const classified = errorClassifier.classifyError(error);
      
      expect(classified.suggestion).toBeDefined();
      expect(typeof classified.suggestion).toBe('string');
    });
  });

  describe('formatErrorMessage', () => {
    test('should format error message with suggestion', () => {
      const error = errorClassifier.classifyError(new Error('Rate limit'));
      const formatted = errorClassifier.formatErrorMessage(error);
      
      expect(formatted).toContain(error.message);
      expect(formatted).toContain('💡');
    });
  });

  describe('isRetryableError', () => {
    test('should identify retryable errors', () => {
      const error = errorClassifier.classifyError(new Error('Rate limit exceeded'));
      expect(errorClassifier.isRetryableError(error)).toBe(true);
    });

    test('should identify non-retryable errors', () => {
      const error = errorClassifier.classifyError(new Error('Authentication failed'));
      expect(errorClassifier.isRetryableError(error)).toBe(false);
    });
  });
});

