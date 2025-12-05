import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * Markdown 工具单元测试
 */

import * as markdown from '../../utils/markdown';
import * as fileUtils from '../../utils/fileutils';
import { Tweet } from '../../types/tweet';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Markdown Utils', () => {
  let testRunContext: Awaited<ReturnType<typeof fileUtils.createRunContext>>;
  let testOutputDir: string;

  beforeEach(async () => {
    testOutputDir = path.join(os.tmpdir(), 'test-markdown-' + Date.now());
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
    }
  ];

  describe('saveTweetAsMarkdown', () => {
    test('should save tweet as markdown file', async () => {
      const filePath = await markdown.saveTweetAsMarkdown(mockTweets[0], testRunContext, 0);
      
      expect(filePath).toBeTruthy();
      expect(fs.existsSync(filePath!)).toBe(true);
      
      const content = await fs.promises.readFile(filePath!, 'utf-8');
      expect(content).toContain('Test tweet 1');
      expect(content).toContain('https://twitter.com/user/status/1');
    });

    test('should return null for invalid tweet', async () => {
      const invalidTweet = {} as Tweet;
      const filePath = await markdown.saveTweetAsMarkdown(invalidTweet, testRunContext);
      
      expect(filePath).toBeNull();
    });

    test('should handle missing markdownDir', async () => {
      const invalidContext = { ...testRunContext, markdownDir: undefined };
      
      await expect(
        markdown.saveTweetAsMarkdown(mockTweets[0], invalidContext as any)
      ).rejects.toThrow();
    });
  });

  describe('saveTweetsAsMarkdown', () => {
    test('should save multiple tweets', async () => {
      const result = await markdown.saveTweetsAsMarkdown(mockTweets, testRunContext);
      
      expect(result.perTweetFiles.length).toBe(1);
      expect(result.indexPath).toBeTruthy();
      
      const indexPath = result.indexPath!;
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    test('should create index file', async () => {
      const result = await markdown.saveTweetsAsMarkdown(mockTweets, testRunContext);
      
      const indexPath = result.indexPath!;
      const content = await fs.promises.readFile(indexPath, 'utf-8');
      
      expect(content).toContain('#');
      expect(content).toContain('Test tweet 1');
    });

    test('should handle empty tweet array', async () => {
      const result = await markdown.saveTweetsAsMarkdown([], testRunContext);
      
      expect(result.perTweetFiles.length).toBe(0);
    });
  });
});

