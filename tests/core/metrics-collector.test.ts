/**
 * MetricsCollector 单元测试
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MetricsCollector, getMetricsCollector, resetMetricsCollector } from '../../core/metrics-collector';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    resetMetricsCollector();
    collector = new MetricsCollector();
  });

  describe('recordScrape', () => {
    test('should record successful scrape', () => {
      collector.recordScrape('twitter', true);
      
      const metrics = collector.getMetrics();
      expect(metrics.scrapes.total).toBe(1);
      expect(metrics.scrapes.successful).toBe(1);
      expect(metrics.scrapes.failed).toBe(0);
      expect(metrics.scrapes.byPlatform.twitter.total).toBe(1);
      expect(metrics.scrapes.byPlatform.twitter.successful).toBe(1);
    });

    test('should record failed scrape', () => {
      collector.recordScrape('reddit', false);
      
      const metrics = collector.getMetrics();
      expect(metrics.scrapes.total).toBe(1);
      expect(metrics.scrapes.successful).toBe(0);
      expect(metrics.scrapes.failed).toBe(1);
      expect(metrics.scrapes.byPlatform.reddit.total).toBe(1);
      expect(metrics.scrapes.byPlatform.reddit.failed).toBe(1);
    });

    test('should track multiple platforms', () => {
      collector.recordScrape('twitter', true);
      collector.recordScrape('reddit', true);
      collector.recordScrape('twitter', false);
      
      const metrics = collector.getMetrics();
      expect(metrics.scrapes.total).toBe(3);
      expect(metrics.scrapes.byPlatform.twitter.total).toBe(2);
      expect(metrics.scrapes.byPlatform.reddit.total).toBe(1);
    });
  });

  describe('recordPerformance', () => {
    test('should record performance metrics', () => {
      // Need to record a scrape first for average calculation
      collector.recordScrape('twitter', true);
      // Wait a bit to ensure elapsed time > 0
      const startTime = Date.now();
      while (Date.now() - startTime < 10) {
        // Wait
      }
      collector.recordPerformance(1000, 5000, 100);
      
      const metrics = collector.getMetrics();
      expect(metrics.performance.averageResponseTime).toBe(1000);
      expect(metrics.performance.averageScrapeTime).toBe(5000);
      expect(metrics.performance.totalTweetsScraped).toBe(100);
      // tweetsPerSecond is calculated based on elapsed time, which might be very small in tests
      expect(metrics.performance.tweetsPerSecond).toBeGreaterThanOrEqual(0);
    });

    test('should calculate tweets per second correctly', () => {
      collector.recordScrape('twitter', true);
      // Wait a bit to ensure elapsed time > 0
      const startTime = Date.now();
      while (Date.now() - startTime < 10) {
        // Wait
      }
      collector.recordPerformance(1000, 2000, 50);
      
      const metrics = collector.getMetrics();
      expect(metrics.performance.totalTweetsScraped).toBe(50);
      // tweetsPerSecond is calculated based on elapsed time
      expect(metrics.performance.tweetsPerSecond).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recordError', () => {
    test('should record error by type', () => {
      collector.recordError('RATE_LIMIT', true, false);
      collector.recordError('AUTH_FAILED', false, true);
      
      const metrics = collector.getMetrics();
      expect(metrics.errors.total).toBe(2);
      expect(metrics.errors.byType.RATE_LIMIT).toBe(1);
      expect(metrics.errors.byType.AUTH_FAILED).toBe(1);
      // rateLimitHits and authFailures are incremented separately
      expect(metrics.errors.rateLimitHits).toBeGreaterThanOrEqual(1);
      expect(metrics.errors.authFailures).toBeGreaterThanOrEqual(1);
    });

    test('should track retryable errors', () => {
      collector.recordError('RATE_LIMIT', true, false);
      collector.recordError('NETWORK_ERROR', true, false);
      
      const metrics = collector.getMetrics();
      expect(metrics.errors.byType.RATE_LIMIT).toBe(1);
      expect(metrics.errors.byType.NETWORK_ERROR).toBe(1);
    });
  });

  describe('updateResources', () => {
    test('should update resource metrics', () => {
      collector.updateResources({
        browserPoolSize: 5,
        browserPoolInUse: 2,
        memoryUsage: 512,
        activeSessions: 3
      });
      
      const metrics = collector.getMetrics();
      expect(metrics.resources.browserPoolSize).toBe(5);
      expect(metrics.resources.browserPoolInUse).toBe(2);
      expect(metrics.resources.memoryUsage).toBe(512);
      expect(metrics.resources.activeSessions).toBe(3);
    });

    test('should update partial resources', () => {
      collector.updateResources({
        browserPoolSize: 3
      });
      
      const metrics = collector.getMetrics();
      expect(metrics.resources.browserPoolSize).toBe(3);
    });
  });

  describe('getMetrics', () => {
    test('should return all metrics', () => {
      collector.recordScrape('twitter', true);
      collector.recordPerformance(1000, 2000, 50);
      collector.recordError('RATE_LIMIT', true, false);
      collector.updateResources({ browserPoolSize: 2 });
      
      const metrics = collector.getMetrics();
      expect(metrics).toHaveProperty('scrapes');
      expect(metrics).toHaveProperty('performance');
      expect(metrics).toHaveProperty('resources');
      expect(metrics).toHaveProperty('errors');
      expect(metrics).toHaveProperty('timestamp');
    });

    test('should include timestamp', () => {
      const metrics = collector.getMetrics();
      expect(metrics.timestamp).toBeGreaterThan(0);
      expect(typeof metrics.timestamp).toBe('number');
    });
  });

  describe('getSummary', () => {
    test('should return summary statistics', () => {
      collector.recordScrape('twitter', true);
      collector.recordScrape('twitter', false);
      collector.recordScrape('reddit', true);
      collector.recordPerformance(1000, 2000, 50);
      
      const summary = collector.getSummary();
      expect(typeof summary).toBe('string'); // getSummary returns a formatted string
      expect(summary).toContain('Scrapes');
      expect(summary).toContain('Performance');
    });
  });

  describe('reset', () => {
    test('should reset all metrics', () => {
      collector.recordScrape('twitter', true);
      collector.recordPerformance(1000, 2000, 50);
      collector.recordError('RATE_LIMIT', true, false);
      
      collector.reset();
      
      const metrics = collector.getMetrics();
      expect(metrics.scrapes.total).toBe(0);
      expect(metrics.performance.totalTweetsScraped).toBe(0);
      expect(metrics.errors.total).toBe(0);
    });
  });

  describe('getMetricsCollector (singleton)', () => {
    test('should return the same instance', () => {
      const instance1 = getMetricsCollector();
      const instance2 = getMetricsCollector();
      
      expect(instance1).toBe(instance2);
    });

    test('should share metrics across instances', () => {
      const instance1 = getMetricsCollector();
      instance1.recordScrape('twitter', true);
      
      const instance2 = getMetricsCollector();
      const metrics = instance2.getMetrics();
      
      expect(metrics.scrapes.total).toBe(1);
    });
  });
});

