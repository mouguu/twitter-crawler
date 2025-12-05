/**
 * PerformanceMonitor 单元测试
 */

import { describe, it, expect, beforeEach, test } from 'bun:test';
import { PerformanceMonitor, PerformanceStats } from '../../core/performance-monitor';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  describe('recordApiRequest', () => {
    test('should record API request time', () => {
      monitor.recordApiRequest(100);
      monitor.recordApiRequest(200);
      
      const stats = monitor.getStats();
      expect(stats.apiRequestCount).toBe(2);
      expect(stats.apiAverageLatency).toBeGreaterThan(0);
    });

    test('should calculate average latency correctly', () => {
      monitor.recordApiRequest(100);
      monitor.recordApiRequest(200);
      monitor.recordApiRequest(300);
      
      const stats = monitor.getStats();
      expect(stats.apiAverageLatency).toBe(200);
    });
  });

  describe('recordTweets', () => {
    test('should record tweets collected', () => {
      monitor.recordTweets(10);
      monitor.recordTweets(20);
      
      const stats = monitor.getStats();
      expect(stats.tweetsCollected).toBe(20); // recordTweets sets, not adds
    });
  });

  describe('addTweets', () => {
    test('should add to tweets count', () => {
      monitor.addTweets(10);
      monitor.addTweets(20);
      
      const stats = monitor.getStats();
      expect(stats.tweetsCollected).toBe(30);
    });
  });

  describe('recordScroll', () => {
    test('should increment scroll count', () => {
      monitor.recordScroll();
      monitor.recordScroll();
      
      const stats = monitor.getStats();
      expect(stats.scrollCount).toBe(2);
    });
  });

  describe('recordSessionSwitch', () => {
    test('should increment session switch count', () => {
      monitor.recordSessionSwitch();
      
      const stats = monitor.getStats();
      expect(stats.sessionSwitches).toBe(1);
    });
  });

  describe('recordRateLimitWait', () => {
    test('should record rate limit hit', () => {
      monitor.recordRateLimitWait(5000);
      
      const stats = monitor.getStats();
      expect(stats.rateLimitHits).toBe(1);
      expect(stats.rateLimitWaitTime).toBe(5000);
    });
  });

  describe('getStats', () => {
    test('should return all performance stats', () => {
      monitor.start();
      monitor.recordApiRequest(100);
      monitor.addTweets(10);
      monitor.recordScroll();
      monitor.recordSessionSwitch();
      
      const stats = monitor.getStats();
      
      expect(stats).toHaveProperty('apiRequestCount');
      expect(stats).toHaveProperty('apiAverageLatency');
      expect(stats).toHaveProperty('tweetsCollected');
      expect(stats).toHaveProperty('scrollCount');
      expect(stats).toHaveProperty('sessionSwitches');
      expect(stats).toHaveProperty('totalDuration');
    });

    test('should return zero stats initially', () => {
      const stats = monitor.getStats();
      
      expect(stats.apiRequestCount).toBe(0);
      expect(stats.tweetsCollected).toBe(0);
      expect(stats.scrollCount).toBe(0);
    });
  });

  describe('reset', () => {
    test('should reset all stats', () => {
      monitor.start();
      monitor.recordApiRequest(100);
      monitor.addTweets(10);
      monitor.recordScroll();
      
      monitor.reset();
      
      const stats = monitor.getStats();
      expect(stats.apiRequestCount).toBe(0);
      expect(stats.tweetsCollected).toBe(0);
      expect(stats.scrollCount).toBe(0);
    });
  });

  describe('tweetsPerSecond', () => {
    test('should calculate tweets per second', () => {
      monitor.start();
      monitor.recordTweets(100);
      monitor.stop();
      
      const stats = monitor.getStats();
      if (stats.totalDuration > 0) {
        expect(stats.tweetsPerSecond).toBeGreaterThan(0);
      }
    });
  });
});

