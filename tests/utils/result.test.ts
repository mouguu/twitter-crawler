import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * Result 工具单元测试
 */

import { ok, fail, isOk, isFail, unwrapOr, fromPromise, wrap } from '../../utils/result';

describe('Result Utils', () => {
  describe('ok', () => {
    test('should create success result', () => {
      const result = ok({ id: 1, name: 'test' });
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1, name: 'test' });
      expect(result.error).toBeNull();
    });

    test('should include metadata', () => {
      const result = ok('data', { timestamp: 123 });
      
      expect(result.success).toBe(true);
      expect(result.metadata).toEqual({ timestamp: 123 });
    });
  });

  describe('fail', () => {
    test('should create failure result', () => {
      const result = fail('Error message');
      
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBe('Error message');
    });

    test('should include metadata', () => {
      const result = fail('Error', { code: 500 });
      
      expect(result.success).toBe(false);
      expect(result.metadata).toEqual({ code: 500 });
    });
  });

  describe('isOk', () => {
    test('should return true for success result', () => {
      const result = ok('data');
      expect(isOk(result)).toBe(true);
    });

    test('should return false for failure result', () => {
      const result = fail('error');
      expect(isOk(result)).toBe(false);
    });
  });

  describe('isFail', () => {
    test('should return true for failure result', () => {
      const result = fail('error');
      expect(isFail(result)).toBe(true);
    });

    test('should return false for success result', () => {
      const result = ok('data');
      expect(isFail(result)).toBe(false);
    });
  });

  describe('unwrapOr', () => {
    test('should return data for success result', () => {
      const result = ok('data');
      expect(unwrapOr(result, 'default')).toBe('data');
    });

    test('should return default for failure result', () => {
      const result = fail('error');
      expect(unwrapOr(result, 'default')).toBe('default');
    });
  });

  describe('fromPromise', () => {
    test('should convert successful promise to ok result', async () => {
      const promise = Promise.resolve('data');
      const result = await fromPromise(promise);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('data');
    });

    test('should convert failed promise to fail result', async () => {
      const promise = Promise.reject(new Error('error'));
      const result = await fromPromise(promise);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('wrap', () => {
    test('should wrap sync function', () => {
      const fn = (x: number) => x * 2;
      const wrapped = wrap(fn);
      
      const result = wrapped(5);
      expect(result.success).toBe(true);
      expect(result.data).toBe(10);
    });

    test('should wrap async function', async () => {
      const fn = async (x: number) => x * 2;
      const wrapped = wrap(fn);
      
      const result = await wrapped(5);
      expect(result.success).toBe(true);
      expect(result.data).toBe(10);
    });

    test('should handle errors in wrapped function', () => {
      const fn = () => { throw new Error('test'); };
      const wrapped = wrap(fn);
      
      const result = wrapped() as any; // Type assertion for test
      // wrap catches sync errors and returns fail result
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle errors in async wrapped function', async () => {
      const fn = async () => { throw new Error('test'); };
      const wrapped = wrap(fn);
      
      const result = await wrapped();
      expect(result.success).toBe(false);
    });
  });
});

