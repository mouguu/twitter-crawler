/**
 * ProgressManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, mock, test } from 'bun:test';
import { ProgressManager } from '../../core/progress-manager';
import { ScraperEventBus } from '../../core/event-bus';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProgressManager', () => {
  let testProgressDir: string;
  let manager: ProgressManager;
  let mockEventBus: Partial<ScraperEventBus>;

  beforeEach(() => {
    testProgressDir = path.join(os.tmpdir(), 'test-progress-' + Date.now());
    
    mockEventBus = {
      emitLog: mock(() => {}),
      emitProgress: mock(() => {}),
      emitPerformance: mock(() => {}),
      on: mock(() => {}),
      off: mock(() => {})
    } as any;

    manager = new ProgressManager(testProgressDir, mockEventBus as ScraperEventBus);
  });

  afterEach(() => {
    try {
      fs.rmSync(testProgressDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('saveProgress', () => {
    test('should save progress to file', () => {
      const progress = {
        targetType: 'profile',
        targetValue: 'testuser',
        totalRequested: 100,
        totalScraped: 50,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        accountsUsed: [],
        completed: false
      };
      
      manager.saveProgress(progress);
      
      const filePath = path.join(testProgressDir, 'profile_testuser_progress.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('should update existing progress', async () => {
      const progress1 = {
        targetType: 'profile',
        targetValue: 'testuser',
        totalRequested: 100,
        totalScraped: 50,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        accountsUsed: [],
        completed: false
      };
      
      manager.saveProgress(progress1);
      
      const progress2 = {
        ...progress1,
        totalScraped: 75
      };
      
      manager.saveProgress(progress2);
      
      const loaded = await manager.loadProgress('profile', 'testuser');
      expect(loaded?.totalScraped).toBe(75);
    });
  });

  describe('loadProgress', () => {
    test('should load progress from file', async () => {
      const progress = {
        targetType: 'profile',
        targetValue: 'testuser',
        totalRequested: 100,
        totalScraped: 50,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        accountsUsed: [],
        completed: false
      };
      
      manager.saveProgress(progress);
      
      const loaded = await manager.loadProgress('profile', 'testuser');
      expect(loaded).toBeDefined();
      expect(loaded?.totalScraped).toBe(50);
    });

    test('should return null for non-existent progress', async () => {
        const loaded = await manager.loadProgress('timeline', 'testuser');
        expect(loaded).toBeNull();
    });

    test('should load saved progress', async () => {
        const manager = new ProgressManager(testProgressDir, mockEventBus as ScraperEventBus);
        const progress = await manager.startScraping('timeline', 'testuser', 100);
        
        const loaded = await manager.loadProgress('timeline', 'testuser');
        expect(loaded?.totalScraped).toBe(0);
      expect(progress.completed).toBe(false);
    });
  });

  describe('startScraping', () => {
    test('should start new scraping session', async () => {
      const progress = await manager.startScraping('profile', 'testuser', 100);
      
      expect(progress.totalRequested).toBe(100);
      expect(progress.totalScraped).toBe(0);
      expect(progress.completed).toBe(false);
    });

    test('should resume from progress', async () => {
        const manager = new ProgressManager(testProgressDir, mockEventBus as ScraperEventBus);
        
        // Create initial progress
        const initial = await manager.startScraping('timeline', 'testuser', 100);
        await manager.updateProgress(50, 'tweet123');
        
        // Resume
        const resumed = await manager.startScraping('timeline', 'testuser', 100, true);
        expect(resumed.totalRequested).toBe(100);
        expect(resumed.totalScraped).toBe(50);
        expect(resumed.completed).toBe(false);
    });
  });

  describe('updateProgress', () => {
    test('should mark as completed when target reached', async () => {
        const manager = new ProgressManager(testProgressDir, mockEventBus as ScraperEventBus);
        
        const progress = await manager.startScraping('timeline', 'testuser', 50);
        await manager.updateProgress(50);
        
        const current = manager.getCurrentProgress();
        expect(current?.totalScraped).toBe(50);
        expect(current?.completed).toBe(true);
    });

    test('should update progress with additional info', async () => {
        const manager = new ProgressManager(testProgressDir, mockEventBus as ScraperEventBus);
        
        await manager.startScraping('timeline', 'testuser', 100);
        await manager.updateProgress(25, 'tweet123', 'cursor-abc', 'account1');
        
        const loaded = await manager.loadProgress('timeline', 'testuser');
        expect(loaded?.totalScraped).toBe(25);
        expect(loaded?.lastTweetId).toBe('tweet123');
    });
  });
});
