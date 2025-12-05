import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * FileUtils 单元测试
 */

import * as fileUtils from '../../utils/fileutils';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as os from 'os';

describe('FileUtils', () => {
  let testOutputDir: string;

  beforeEach(async () => {
    testOutputDir = path.join(os.tmpdir(), 'test-output-' + Date.now());
    process.env.OUTPUT_DIR = testOutputDir;
  });

  afterEach(async () => {
    try {
      await fsPromises.rm(testOutputDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    delete process.env.OUTPUT_DIR;
  });

  describe('sanitizeSegment', () => {
    test('should sanitize special characters', () => {
      expect(fileUtils.sanitizeSegment('test@user#123')).toBe('test-user-123');
      expect(fileUtils.sanitizeSegment('user name')).toBe('user-name');
      expect(fileUtils.sanitizeSegment('user/name')).toBe('user-name');
    });

    test('should handle empty string', () => {
      const result = fileUtils.sanitizeSegment('');
      expect(result).toBeTruthy();
    });

    test('should convert to lowercase', () => {
      expect(fileUtils.sanitizeSegment('USERNAME')).toBe('username');
    });

    test('should remove leading/trailing dashes', () => {
      expect(fileUtils.sanitizeSegment('-username-')).toBe('username');
    });

    test('should collapse multiple dashes', () => {
      expect(fileUtils.sanitizeSegment('user---name')).toBe('user-name');
    });
  });

  describe('ensureDirExists', () => {
    test('should create directory if not exists', async () => {
      const dir = path.join(testOutputDir, 'new-dir');
      const result = await fileUtils.ensureDirExists(dir);
      
      expect(result).toBe(true);
      expect(fs.existsSync(dir)).toBe(true);
    });

    test('should return true if directory exists', async () => {
      const dir = path.join(testOutputDir, 'existing-dir');
      await fsPromises.mkdir(dir, { recursive: true });
      
      const result = await fileUtils.ensureDirExists(dir);
      expect(result).toBe(true);
    });

    test('should create nested directories', async () => {
      const dir = path.join(testOutputDir, 'nested', 'deep', 'path');
      await fileUtils.ensureDirExists(dir);
      
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('getDefaultOutputRoot', () => {
    test('should return default output root', () => {
      const root = fileUtils.getDefaultOutputRoot();
      expect(root).toBeTruthy();
      expect(typeof root).toBe('string');
    });

    test('should respect OUTPUT_DIR environment variable', () => {
      const tempDir = require('os').tmpdir();
      const customDir = path.join(tempDir, 'custom-output-' + Date.now());
      const originalEnv = process.env.OUTPUT_DIR;
      process.env.OUTPUT_DIR = customDir;
      
      // Reset OutputPathManager singleton to pick up new env var
      const { resetOutputPathManager, getOutputPathManager } = require('../../utils/output-path-manager');
      resetOutputPathManager();
      
      // Create the directory so validation passes
      fs.mkdirSync(customDir, { recursive: true });
      
      // Get a new instance with the env var
      const pathManager = getOutputPathManager({ baseDir: customDir });
      const root = fileUtils.getDefaultOutputRoot();
      
      // Should use the custom directory
      expect(root).toBe(customDir);
      
      // Cleanup
      try {
        fs.rmSync(customDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore
      }
      
      // Restore
      if (originalEnv) {
        process.env.OUTPUT_DIR = originalEnv;
      } else {
        delete process.env.OUTPUT_DIR;
      }
      resetOutputPathManager();
    });
  });

  describe('createRunContext', () => {
    test('should create run context with default options', async () => {
      const context = await fileUtils.createRunContext();
      
      expect(context).toHaveProperty('platform');
      expect(context).toHaveProperty('identifier');
      expect(context).toHaveProperty('runId');
      expect(context).toHaveProperty('runDir');
      expect(context).toHaveProperty('markdownDir');
      expect(context).toHaveProperty('jsonPath');
      expect(context).toHaveProperty('csvPath');
    });

    test('should create run context with custom options', async () => {
      const context = await fileUtils.createRunContext({
        platform: 'twitter',
        identifier: 'testuser',
        timestamp: '2024-01-01T00:00:00Z'
      });
      
      expect(context.platform).toBe('twitter');
      expect(context.identifier).toBe('testuser');
      expect(context.runId).toContain('run-');
    });

    test('should create all required directories', async () => {
      const context = await fileUtils.createRunContext({
        platform: 'test',
        identifier: 'test'
      });
      
      expect(fs.existsSync(context.runDir)).toBe(true);
      expect(fs.existsSync(context.markdownDir)).toBe(true);
      expect(fs.existsSync(context.screenshotDir)).toBe(true);
    });

    test('should sanitize platform and identifier', async () => {
      const context = await fileUtils.createRunContext({
        platform: 'Test@Platform',
        identifier: 'User#123'
      });
      
      expect(context.platform).toBe('test-platform');
      expect(context.identifier).toBe('user-123');
    });
  });

  describe('getTodayString', () => {
    test('should return date in YYYY-MM-DD format', () => {
      const today = fileUtils.getTodayString();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('should return current date', () => {
      const today = fileUtils.getTodayString();
      const expected = new Date().toISOString().split('T')[0];
      expect(today).toBe(expected);
    });
  });

  describe('getMarkdownFiles', () => {
    test('should return markdown files in directory', async () => {
      const dir = path.join(testOutputDir, 'markdown-test');
      await fsPromises.mkdir(dir, { recursive: true });
      
      await fsPromises.writeFile(path.join(dir, 'file1.md'), 'content');
      await fsPromises.writeFile(path.join(dir, 'file2.md'), 'content');
      await fsPromises.writeFile(path.join(dir, 'file3.txt'), 'content');
      
      const files = await fileUtils.getMarkdownFiles(dir);
      
      expect(files.length).toBe(2);
      expect(files.every(f => f.endsWith('.md'))).toBe(true);
    });

    test('should exclude merged files', async () => {
      const dir = path.join(testOutputDir, 'markdown-test2');
      await fsPromises.mkdir(dir, { recursive: true });
      
      await fsPromises.writeFile(path.join(dir, 'normal.md'), 'content');
      await fsPromises.writeFile(path.join(dir, 'merged-file.md'), 'content');
      await fsPromises.writeFile(path.join(dir, 'digest-file.md'), 'content');
      
      const files = await fileUtils.getMarkdownFiles(dir);
      
      expect(files.length).toBe(1);
      expect(files[0]).toContain('normal.md');
    });

    test('should return empty array for non-existent directory', async () => {
      const files = await fileUtils.getMarkdownFiles('/non/existent/path');
      expect(files).toEqual([]);
    });

    test('should return empty array for empty directory', async () => {
      const dir = path.join(testOutputDir, 'empty-dir');
      await fsPromises.mkdir(dir, { recursive: true });
      
      const files = await fileUtils.getMarkdownFiles(dir);
      expect(files).toEqual([]);
    });
  });

  describe('ensureBaseStructure', () => {
    test('should create base output structure', async () => {
      const result = await fileUtils.ensureBaseStructure();
      expect(result).toBe(true);
    });
  });
});

