/**
 * ScraperError 单元测试
 */

import { describe, it, expect, test } from 'bun:test';
import { ScraperError, ErrorCode, ErrorClassifier } from '../../core/errors';

describe('ScraperError', () => {
  describe('constructor', () => {
    test('should create error with code and message', () => {
      const error = new ScraperError(ErrorCode.RATE_LIMIT, 'Rate limit exceeded');
      
      expect(error.code).toBe(ErrorCode.RATE_LIMIT);
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.name).toBe('ScraperError');
      expect(error.retryable).toBe(false); // 默认值
    });

    test('should accept retryable option', () => {
      const error = new ScraperError(ErrorCode.RATE_LIMIT, 'Rate limit exceeded', {
        retryable: true
      });
      
      expect(error.retryable).toBe(true);
    });

    test('should accept context option', () => {
      const context = { waitTime: 60000, attempt: 3 };
      const error = new ScraperError(ErrorCode.RATE_LIMIT, 'Rate limit exceeded', {
        context
      });
      
      expect(error.context).toEqual(context);
    });

    test('should accept originalError option', () => {
      const originalError = new Error('Original error');
      const error = new ScraperError(ErrorCode.NETWORK_ERROR, 'Network failed', {
        originalError
      });
      
      expect(error.originalError).toBe(originalError);
    });

    test('should have timestamp', () => {
      const before = new Date();
      const error = new ScraperError(ErrorCode.UNKNOWN_ERROR, 'Test');
      const after = new Date();
      
      expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('fromHttpResponse', () => {
    test('should create AUTH_FAILED error for 401', async () => {
      const response = new Response('Unauthorized', { status: 401 });
      const error = ScraperError.fromHttpResponse(response);
      
      expect(error.code).toBe(ErrorCode.AUTH_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.context.statusCode).toBe(401);
    });

    test('should create RATE_LIMIT error for 429', async () => {
      const response = new Response('Too Many Requests', { status: 429 });
      const error = ScraperError.fromHttpResponse(response);
      
      expect(error.code).toBe(ErrorCode.RATE_LIMIT);
      expect(error.retryable).toBe(true);
      expect(error.context.statusCode).toBe(429);
    });

    test('should create API_ERROR for 500', async () => {
      const response = new Response('Internal Server Error', { status: 500 });
      const error = ScraperError.fromHttpResponse(response);
      
      expect(error.code).toBe(ErrorCode.API_ERROR);
      expect(error.retryable).toBe(true);
    });

    test('should include context in error', async () => {
      const context = { userId: '123', endpoint: '/api/tweets' };
      const response = new Response('Not Found', { status: 404 });
      const error = ScraperError.fromHttpResponse(response, context);
      
      expect(error.context.userId).toBe('123');
      expect(error.context.endpoint).toBe('/api/tweets');
      expect(error.context.statusCode).toBe(404);
    });
  });

  describe('fromError', () => {
    test('should wrap native Error', () => {
      const nativeError = new Error('Native error');
      const error = ScraperError.fromError(nativeError, ErrorCode.NETWORK_ERROR, true);
      
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.message).toBe('Native error');
      expect(error.retryable).toBe(true);
      expect(error.originalError).toBe(nativeError);
    });
  });

  describe('isRateLimitError', () => {
    test('should return true for RATE_LIMIT error', () => {
      const error = new ScraperError(ErrorCode.RATE_LIMIT, 'Rate limit');
      expect(ScraperError.isRateLimitError(error)).toBe(true);
    });

    test('should return true for RATE_LIMIT_EXCEEDED error', () => {
      const error = new ScraperError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded');
      expect(ScraperError.isRateLimitError(error)).toBe(true);
    });

    test('should return false for other errors', () => {
      const error = new ScraperError(ErrorCode.NETWORK_ERROR, 'Network error');
      expect(ScraperError.isRateLimitError(error)).toBe(false);
    });

    test('should check message for non-ScraperError', () => {
      const error = new Error('Rate limit exceeded');
      expect(ScraperError.isRateLimitError(error)).toBe(true);
    });
  });

  describe('isAuthError', () => {
    test('should return true for AUTH_FAILED error', () => {
      const error = new ScraperError(ErrorCode.AUTH_FAILED, 'Auth failed');
      expect(ScraperError.isAuthError(error)).toBe(true);
    });

    test('should check message for non-ScraperError', () => {
      const error = new Error('Authentication failed');
      expect(ScraperError.isAuthError(error)).toBe(true);
    });
  });

  describe('isNetworkError', () => {
    test('should return true for NETWORK_ERROR', () => {
      const error = new ScraperError(ErrorCode.NETWORK_ERROR, 'Network error');
      expect(ScraperError.isNetworkError(error)).toBe(true);
    });

    test('should check message for timeout', () => {
      const error = new Error('Request timeout');
      expect(ScraperError.isNetworkError(error)).toBe(true);
    });
  });

  describe('toJSON', () => {
    test('should serialize error to JSON', () => {
      const originalError = new Error('Original');
      const error = new ScraperError(ErrorCode.RATE_LIMIT, 'Rate limit', {
        retryable: true,
        context: { waitTime: 60000 },
        originalError
      });

      const json = error.toJSON();
      
      expect(json.code).toBe(ErrorCode.RATE_LIMIT);
      expect(json.message).toBe('Rate limit');
      expect(json.retryable).toBe(true);
      expect(json.context).toEqual({ waitTime: 60000 });
      expect(json.originalError).toBeDefined();
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('getUserMessage', () => {
    test('should return user-friendly message for RATE_LIMIT', () => {
      const error = new ScraperError(ErrorCode.RATE_LIMIT, 'Rate limit');
      expect(error.getUserMessage()).toContain('速率限制');
    });

    test('should return user-friendly message for AUTH_FAILED', () => {
      const error = new ScraperError(ErrorCode.AUTH_FAILED, 'Auth failed');
      expect(error.getUserMessage()).toContain('认证失败');
    });

    test('should return user-friendly message for NETWORK_ERROR', () => {
      const error = new ScraperError(ErrorCode.NETWORK_ERROR, 'Network error');
      expect(error.getUserMessage()).toContain('网络连接失败');
    });

    test('should return message for unknown errors', () => {
      const error = new ScraperError(ErrorCode.UNKNOWN_ERROR, 'Custom error');
      expect(error.getUserMessage()).toBe('Custom error');
    });
  });
});

describe('ErrorClassifier', () => {
  describe('classify', () => {
    test('should return ScraperError as-is', () => {
      const error = new ScraperError(ErrorCode.RATE_LIMIT, 'Rate limit');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified).toBe(error);
    });

    test('should classify rate limit errors', () => {
      const error = new Error('Rate limit exceeded');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.code).toBe(ErrorCode.RATE_LIMIT);
      expect(classified.retryable).toBe(true);
    });

    test('should classify auth errors', () => {
      const error = new Error('Authentication failed');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.code).toBe(ErrorCode.AUTH_FAILED);
      expect(classified.retryable).toBe(false);
    });

    test('should classify network errors', () => {
      const error = new Error('Network timeout');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(classified.retryable).toBe(true);
    });

    test('should classify unknown errors', () => {
      const error = new Error('Something went wrong');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    test('should handle non-Error objects', () => {
      const classified = ErrorClassifier.classify('String error');
      
      expect(classified.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(classified.message).toBe('String error');
    });
  });
});

