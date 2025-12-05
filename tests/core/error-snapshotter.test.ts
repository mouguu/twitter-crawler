/**
 * ErrorSnapshotter 单元测试
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ErrorSnapshotter } from '../../core/error-snapshotter';
import { Page } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('ErrorSnapshotter', () => {
  let snapshotter: ErrorSnapshotter;
  let testSnapshotDir: string;
  let mockPage: Partial<Page>;

  beforeEach(() => {
    testSnapshotDir = path.join(os.tmpdir(), 'test-snapshots-' + Date.now());
    snapshotter = new ErrorSnapshotter(testSnapshotDir);
    
    mockPage = {
      screenshot: mock(() => Promise.resolve(Buffer.from('screenshot'))),
      content: mock(() => Promise.resolve('<html></html>'))
    } as unknown as Partial<Page>;
  });

  afterEach(() => {
    try {
      fs.rmSync(testSnapshotDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('capture', () => {
    test('should capture screenshot and HTML', async () => {
      const error = new Error('Test error');
      const files = await snapshotter.capture(mockPage as Page, error, 'test-context');
      
      expect(files.length).toBeGreaterThan(0);
      expect(mockPage.screenshot).toHaveBeenCalled();
      expect(mockPage.content).toHaveBeenCalled();
    });

    test('should create error log file', async () => {
      const error = new Error('Test error');
      const files = await snapshotter.capture(mockPage as Page, error, 'test-context');
      
      const logFile = files.find(f => f.endsWith('.log'));
      expect(logFile).toBeDefined();
      
      if (logFile) {
        const content = fs.readFileSync(logFile, 'utf-8');
        expect(content).toContain('Test error');
        expect(content).toContain('test-context');
      }
    });

    test('should handle screenshot failure gracefully', async () => {
      mockPage.screenshot = mock(() => Promise.reject(new Error('Screenshot failed')));
      
      const error = new Error('Test error');
      const files = await snapshotter.capture(mockPage as Page, error, 'test-context');
      
      // Should still capture HTML and log
      expect(files.length).toBeGreaterThan(0);
    });

    test('should sanitize context label in filename', async () => {
      const error = new Error('Test error');
      const files = await snapshotter.capture(mockPage as Page, error, 'test@context#123');
      
      // Filename should not contain special characters
      const hasInvalidChars = files.some(f => /[@#]/.test(path.basename(f)));
      expect(hasInvalidChars).toBe(false);
    });
  });
});
