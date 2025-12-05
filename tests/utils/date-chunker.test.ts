import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * DateChunker 单元测试
 */

import { DateChunker } from '../../utils/date-chunker';

describe('DateChunker', () => {
  describe('generateDateChunks', () => {
    test('should generate date chunks by year', () => {
      const chunks = DateChunker.generateDateChunks('2020-01-01', '2024-01-01', 'year');
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty('since');
      expect(chunks[0]).toHaveProperty('until');
      expect(chunks[0]).toHaveProperty('label');
    });

    test('should generate date chunks by month', () => {
      const chunks = DateChunker.generateDateChunks('2024-01-01', '2024-03-01', 'month');
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(chunks[0].until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('should generate chunks from newest to oldest', () => {
      const chunks = DateChunker.generateDateChunks('2022-01-01', '2024-01-01', 'year');
      
      // First chunk should be most recent
      expect(chunks[0].until).toContain('2024');
    });

    test('should use default dates when not provided', () => {
      const chunks = DateChunker.generateDateChunks();
      
      expect(chunks.length).toBeGreaterThan(0);
    });

    test('should format dates correctly', () => {
      const chunks = DateChunker.generateDateChunks('2024-01-01', '2024-12-31', 'month');
      
      chunks.forEach(chunk => {
        expect(chunk.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(chunk.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(chunk.label).toBeDefined();
      });
    });
  });
});

