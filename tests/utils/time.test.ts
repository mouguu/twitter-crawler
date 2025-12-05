import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * Time 工具单元测试
 */

import * as timeUtils from '../../utils/time';

describe('Time Utils', () => {
  describe('getDefaultTimezone', () => {
    test('should return timezone string', () => {
      const tz = timeUtils.getDefaultTimezone();
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    });
  });

  describe('resolveTimezone', () => {
    test('should return provided timezone', () => {
      expect(timeUtils.resolveTimezone('America/New_York')).toBe('America/New_York');
    });

    test('should return default if not provided', () => {
      const tz = timeUtils.resolveTimezone();
      expect(tz).toBeDefined();
    });
  });

  describe('formatZonedTimestamp', () => {
    test('should format timestamp with timezone', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      const result = timeUtils.formatZonedTimestamp(date, 'UTC');
      
      expect(result).toHaveProperty('iso');
      expect(result).toHaveProperty('fileSafe');
      expect(result.iso).toContain('2024');
    });

    test('should include milliseconds when requested', () => {
      const date = new Date('2024-01-01T00:00:00.123Z');
      const result = timeUtils.formatZonedTimestamp(date, 'UTC', {
        includeMilliseconds: true
      });
      
      expect(result.iso).toContain('.123');
    });

    test('should create file-safe format', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      const result = timeUtils.formatZonedTimestamp(date, 'UTC');
      
      expect(result.fileSafe).not.toContain(':');
      expect(result.fileSafe).not.toContain(' ');
    });
  });

  describe('formatReadableLocal', () => {
    test('should format readable local time', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      const formatted = timeUtils.formatReadableLocal(date, 'UTC');
      
      expect(formatted).toContain('2024');
      expect(formatted).toContain('(');
    });
  });
});

