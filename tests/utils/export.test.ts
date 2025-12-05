import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * Export 工具单元测试
 */

import * as exportUtils from '../../utils/export';
import * as fileUtils from '../../utils/fileutils';
import { Tweet } from '../../types/tweet';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Export Utils', () => {
  let testRunContext: Awaited<ReturnType<typeof fileUtils.createRunContext>>;
  let testOutputDir: string;

  beforeEach(async () => {
    testOutputDir = path.join(os.tmpdir(), 'test-export-' + Date.now());
    testRunContext = await fileUtils.createRunContext({
      platform: 'test',
      identifier: 'testuser',
      baseOutputDir: testOutputDir
    });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(testOutputDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  const mockTweets: Tweet[] = [
    {
      id: '1',
      text: 'Test tweet 1',
      time: '2024-01-01T00:00:00Z',
      url: 'https://twitter.com/user/status/1',
      likes: 10,
      retweets: 5,
      replies: 2,
      hasMedia: false
    },
    {
      id: '2',
      text: 'Test tweet 2 with "quotes"',
      time: '2024-01-02T00:00:00Z',
      url: 'https://twitter.com/user/status/2',
      likes: 20,
      retweets: 10,
      replies: 3,
      hasMedia: true
    }
  ];

  describe('exportToCsv', () => {
    test('should export tweets to CSV', async () => {
      const csvPath = await exportUtils.exportToCsv(mockTweets, testRunContext);
      
      expect(csvPath).toBeTruthy();
      expect(fs.existsSync(csvPath!)).toBe(true);
      
      const content = await fs.promises.readFile(csvPath!, 'utf-8');
      expect(content).toContain('text,time,url,likes,retweets,replies,hasMedia');
      expect(content).toContain('Test tweet 1');
      expect(content).toContain('Test tweet 2');
    });

    test('should handle empty tweet array', async () => {
      const csvPath = await exportUtils.exportToCsv([], testRunContext);
      
      expect(csvPath).toBeNull();
    });

    test('should escape quotes in CSV', async () => {
      const csvPath = await exportUtils.exportToCsv(mockTweets, testRunContext);
      const content = await fs.promises.readFile(csvPath!, 'utf-8');
      
      expect(content).toContain('"Test tweet 2 with ""quotes"""');
    });

    test('should use custom filename', async () => {
      const csvPath = await exportUtils.exportToCsv(mockTweets, testRunContext, {
        filename: 'custom.csv'
      });
      
      expect(csvPath).toContain('custom.csv');
    });

    test('should throw error for invalid runContext', async () => {
      await expect(
        exportUtils.exportToCsv(mockTweets, {} as any)
      ).rejects.toThrow();
    });
  });

  describe('exportToJson', () => {
    test('should export tweets to JSON', async () => {
      const jsonPath = await exportUtils.exportToJson(mockTweets, testRunContext);
      
      expect(jsonPath).toBeTruthy();
      expect(fs.existsSync(jsonPath!)).toBe(true);
      
      const content = await fs.promises.readFile(jsonPath!, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(parsed[0].text).toBe('Test tweet 1');
    });

    test('should handle empty tweet array', async () => {
      const jsonPath = await exportUtils.exportToJson([], testRunContext);
      
      expect(jsonPath).toBeNull();
    });

    test('should format JSON with indentation', async () => {
      const jsonPath = await exportUtils.exportToJson(mockTweets, testRunContext);
      const content = await fs.promises.readFile(jsonPath!, 'utf-8');
      
      // Should be formatted (not minified)
      expect(content).toContain('\n  ');
    });

    test('should use custom filename', async () => {
      const jsonPath = await exportUtils.exportToJson(mockTweets, testRunContext, {
        filename: 'custom.json'
      });
      
      expect(jsonPath).toContain('custom.json');
    });

    test('should throw error for invalid runContext', async () => {
      await expect(
        exportUtils.exportToJson(mockTweets, {} as any)
      ).rejects.toThrow();
    });
  });
});

