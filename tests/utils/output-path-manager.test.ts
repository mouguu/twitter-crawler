import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * OutputPathManager 单元测试
 */

import { OutputPathManager, getOutputPathManager, resetOutputPathManager } from '../../utils/output-path-manager';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';

describe('OutputPathManager', () => {
  let testBaseDir: string;
  let manager: OutputPathManager;

  beforeEach(() => {
    // 使用临时目录进行测试
    testBaseDir = path.join(process.cwd(), 'test-output');
    manager = new OutputPathManager({ baseDir: testBaseDir });
    resetOutputPathManager();
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fsPromises.rm(testBaseDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('getBaseDir', () => {
    test('should return the configured base directory', () => {
      expect(manager.getBaseDir()).toBe(testBaseDir);
    });
  });

  describe('getPlatformDir', () => {
    test('should return platform directory path', () => {
      const platformDir = manager.getPlatformDir('twitter');
      expect(platformDir).toBe(path.join(testBaseDir, 'twitter'));
    });

    test('should sanitize platform name', () => {
      const platformDir = manager.getPlatformDir('Twitter/X');
      expect(platformDir).toBe(path.join(testBaseDir, 'twitter-x'));
    });
  });

  describe('getIdentifierDir', () => {
    test('should return identifier directory path', () => {
      const identifierDir = manager.getIdentifierDir('twitter', 'elonmusk');
      expect(identifierDir).toBe(path.join(testBaseDir, 'twitter', 'elonmusk'));
    });

    test('should sanitize identifier name', () => {
      const identifierDir = manager.getIdentifierDir('twitter', 'Elon Musk');
      expect(identifierDir).toBe(path.join(testBaseDir, 'twitter', 'elon-musk'));
    });
  });

  describe('createRunPath', () => {
    test('should create complete run path structure', async () => {
      const runPath = await manager.createRunPath('twitter', 'elonmusk', 'run-2024-01-01');

      expect(runPath.platform).toBe('twitter');
      expect(runPath.identifier).toBe('elonmusk');
      expect(runPath.runId).toBe('run-2024-01-01');
      expect(runPath.runDir).toBe(path.join(testBaseDir, 'twitter', 'elonmusk', 'run-2024-01-01'));
      expect(runPath.markdownDir).toBe(path.join(testBaseDir, 'twitter', 'elonmusk', 'run-2024-01-01', 'markdown'));
      expect(runPath.screenshotDir).toBe(path.join(testBaseDir, 'twitter', 'elonmusk', 'run-2024-01-01', 'screenshots'));
    });

    test('should create directories if they do not exist', async () => {
      const runPath = await manager.createRunPath('reddit', 'UofT', 'run-2024-01-01');

      // 检查目录是否存在
      const stats = await fsPromises.stat(runPath.runDir);
      expect(stats.isDirectory()).toBe(true);

      const markdownStats = await fsPromises.stat(runPath.markdownDir);
      expect(markdownStats.isDirectory()).toBe(true);
    });

    test('should generate correct file paths', async () => {
      const runPath = await manager.createRunPath('twitter', 'test', 'run-123');

      expect(runPath.jsonPath).toBe(path.join(runPath.runDir, 'tweets.json'));
      expect(runPath.csvPath).toBe(path.join(runPath.runDir, 'tweets.csv'));
      expect(runPath.markdownIndexPath).toBe(path.join(runPath.runDir, 'index.md'));
      expect(runPath.metadataPath).toBe(path.join(runPath.runDir, 'metadata.json'));
    });
  });

  describe('isPathSafe', () => {
    test('should return true for paths within base directory', () => {
      const safePath = path.join(testBaseDir, 'twitter', 'test.json');
      expect(manager.isPathSafe(safePath)).toBe(true);
    });

    test('should return false for paths outside base directory', () => {
      const unsafePath = path.join(process.cwd(), '..', 'sensitive-file.json');
      expect(manager.isPathSafe(unsafePath)).toBe(false);
    });
  });

  describe('resolvePath', () => {
    test('should resolve relative paths correctly', () => {
      const resolved = manager.resolvePath('twitter/test.json');
      expect(resolved).toBe(path.join(testBaseDir, 'twitter', 'test.json'));
    });

    test('should throw error for path traversal attempts', () => {
      expect(() => {
        manager.resolvePath('../../etc/passwd');
      }).toThrow('Path traversal detected');
    });
  });

  describe('getOutputPathManager (singleton)', () => {
    test('should return the same instance on multiple calls', () => {
      const instance1 = getOutputPathManager();
      const instance2 = getOutputPathManager();
      expect(instance1).toBe(instance2);
    });

    test('should allow reset for testing', () => {
      const instance1 = getOutputPathManager();
      resetOutputPathManager();
      const instance2 = getOutputPathManager();
      expect(instance1).not.toBe(instance2);
    });
  });
});

