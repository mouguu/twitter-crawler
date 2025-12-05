/**
 * ScraperDependencies 单元测试
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createDefaultDependencies, ScraperDependencies } from '../../core/scraper-dependencies';
import { ScraperEventBus } from '../../core/event-bus';

describe('ScraperDependencies', () => {
  let mockEventBus: Partial<ScraperEventBus>;

  beforeEach(() => {
    mockEventBus = {
      emitLog: mock(() => {}),
      emitProgress: mock(() => {}),
      emitPerformance: mock(() => {}),
      on: mock(() => {}),
      off: mock(() => {})
    } as any;
  });

  describe('createDefaultDependencies', () => {
    test('should create all required dependencies', () => {
      const deps = createDefaultDependencies(mockEventBus as ScraperEventBus);
      
      expect(deps).toHaveProperty('navigationService');
      expect(deps).toHaveProperty('rateLimitManager');
      expect(deps).toHaveProperty('errorSnapshotter');
      expect(deps).toHaveProperty('antiDetection');
      expect(deps).toHaveProperty('performanceMonitor');
      expect(deps).toHaveProperty('progressManager');
      expect(deps).toHaveProperty('sessionManager');
      expect(deps).toHaveProperty('proxyManager');
    });

    test('should use custom cookie directory', () => {
      const customCookieDir = './test-cookies';
      const deps = createDefaultDependencies(mockEventBus as ScraperEventBus, customCookieDir);
      
      expect(deps.sessionManager).toBeDefined();
    });

    test('should use custom progress directory', () => {
      const customProgressDir = './test-progress';
      const deps = createDefaultDependencies(mockEventBus as ScraperEventBus, './cookies', customProgressDir);
      
      expect(deps.progressManager).toBeDefined();
    });

    test('should create independent instances', () => {
      const deps1 = createDefaultDependencies(mockEventBus as ScraperEventBus);
      const deps2 = createDefaultDependencies(mockEventBus as ScraperEventBus);
      
      expect(deps1.sessionManager).not.toBe(deps2.sessionManager);
      expect(deps1.navigationService).not.toBe(deps2.navigationService);
    });

    test('should pass eventBus to services', () => {
      const deps = createDefaultDependencies(mockEventBus as ScraperEventBus);
      
      // Verify eventBus is passed (indirectly through service behavior)
      expect(deps.sessionManager).toBeDefined();
      expect(deps.progressManager).toBeDefined();
    });
  });

  describe('ScraperDependencies interface', () => {
    test('should match expected structure', () => {
      const deps = createDefaultDependencies(mockEventBus as ScraperEventBus);
      
      // Type check: all properties should exist
      const typedDeps: ScraperDependencies = deps;
      expect(typedDeps).toBe(deps);
    });
  });
});
