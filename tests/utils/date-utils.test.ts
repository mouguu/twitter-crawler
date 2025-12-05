import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * DateUtils 单元测试
 */

import { DateUtils } from '../../utils/date-utils';

describe('DateUtils', () => {
  describe('parseDate', () => {
    test('should parse relative date string like "1 year"', () => {
      const result = DateUtils.parseDate('1 year');
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('should parse relative date string like "3 months"', () => {
      const result = DateUtils.parseDate('3 months');
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('should return absolute date string as-is', () => {
      const result = DateUtils.parseDate('2024-01-01');
      expect(result).toBe('2024-01-01');
    });
  });

  describe('generateDateRanges', () => {
    test('should generate daily date ranges', () => {
      const ranges = DateUtils.generateDateRanges('2024-01-01', '2024-01-05', 'daily');
      
      expect(ranges.length).toBeGreaterThan(0);
      expect(ranges[0]).toHaveProperty('start');
      expect(ranges[0]).toHaveProperty('end');
      expect(ranges[0].start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('should generate monthly date ranges', () => {
      const ranges = DateUtils.generateDateRanges('2024-01-01', '2024-03-01', 'monthly');
      
      expect(ranges.length).toBeGreaterThan(0);
      ranges.forEach(range => {
        expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(range.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    test('should generate yearly date ranges', () => {
      const ranges = DateUtils.generateDateRanges('2020-01-01', '2024-01-01', 'yearly');
      
      expect(ranges.length).toBeGreaterThan(0);
    });
  });
});

