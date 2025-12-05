/**
 * ProxyManager 单元测试（增强版）
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ProxyManager, ProxyStats } from '../../core/proxy-manager';
import { ScraperEventBus } from '../../core/event-bus';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProxyManager', () => {
  let testProxyDir: string;
  let manager: ProxyManager;
  let mockEventBus: Partial<ScraperEventBus>;

  beforeEach(() => {
    testProxyDir = path.join(os.tmpdir(), 'test-proxy-' + Date.now());
    fs.mkdirSync(testProxyDir, { recursive: true });
    
    mockEventBus = {
      emitLog: mock(() => {}),
      emitProgress: mock(() => {}),
      emitPerformance: mock(() => {}),
      on: mock(() => {}),
      off: mock(() => {})
    } as any;

    manager = new ProxyManager(testProxyDir, mockEventBus as ScraperEventBus);
  });

  afterEach(() => {
    manager.destroy();
    try {
      fs.rmSync(testProxyDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('init', () => {
    test('should handle missing proxy directory', async () => {
      const managerWithoutDir = new ProxyManager('/non/existent/path');
      await managerWithoutDir.init();
      // Should not throw
      managerWithoutDir.destroy();
    });

    test('should load proxies from file', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1\nhost2:8080:user2:pass2');
      
      await manager.init();
      
      const proxies = manager.getAllActiveProxies();
      expect(proxies.length).toBe(2);
    });

    test('should handle invalid proxy format', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'invalid-format\nhost1:8080:user1:pass1');
      
      await manager.init();
      
      // Should only load valid proxies
      const proxies = manager.getAllActiveProxies();
      expect(proxies.length).toBe(1);
    });
  });

  describe('getProxyForSession', () => {
    test('should return null when no proxies available', () => {
      const proxy = manager.getProxyForSession('session1');
      expect(proxy).toBeNull();
    });

    test('should return proxy when available', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1');
      
      await manager.init();
      
      const proxy = manager.getProxyForSession('session1');
      expect(proxy).toBeDefined();
      expect(proxy?.host).toBe('host1');
      expect(proxy?.port).toBe(8080);
    });

    test('should return same proxy for same session', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1\nhost2:8080:user2:pass2');
      
      await manager.init();
      
      const proxy1 = manager.getProxyForSession('session1');
      const proxy2 = manager.getProxyForSession('session1');
      
      expect(proxy1?.id).toBe(proxy2?.id);
    });
  });

  describe('getBestProxy', () => {
    test('should prefer proxies with higher success rate', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1\nhost2:8080:user2:pass2');
      
      await manager.init();
      
      // Simulate success for host2
      const proxy2 = manager.getProxyForSession('s2');
      if (proxy2) {
        manager.markProxySuccess(proxy2.id, 100);
        manager.markProxySuccess(proxy2.id, 100);
      }
      
      // Simulate failure for host1
      const proxy1 = manager.getProxyForSession('s1');
      if (proxy1) {
        manager.markProxyFailed(proxy1.id, 'test');
      }
      
      // Best proxy should be host2
      const best = manager.getBestProxy();
      expect(best?.host).toBe('host2');
    });

    test('should exclude specified proxies', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1\nhost2:8080:user2:pass2');
      
      await manager.init();
      
      const best = manager.getBestProxy(['host1:8080']);
      expect(best?.host).toBe('host2');
    });
  });

  describe('switchProxyForSession', () => {
    test('should switch to a different proxy', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1\nhost2:8080:user2:pass2');
      
      await manager.init();
      
      const original = manager.getProxyForSession('session1');
      const switched = manager.switchProxyForSession('session1', 'rate limited');
      
      expect(switched).toBeDefined();
      expect(switched?.id).not.toBe(original?.id);
    });

    test('should return null when no alternative proxy available', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1');
      
      await manager.init();
      
      manager.getProxyForSession('session1');
      const switched = manager.switchProxyForSession('session1', 'error');
      
      // Only one proxy, can't switch
      expect(switched).toBeNull();
    });
  });

  describe('cooldown mechanism', () => {
    test('should revive proxy after cooldown period', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1');
      
      // Set very short cooldown for testing
      manager.setCooldownPeriod(100); // 100ms
      
      await manager.init();
      
      const proxy = manager.getProxyForSession('session1');
      
      // Force retire
      manager.markProxyFailed(proxy!.id, 'error');
      manager.markProxyFailed(proxy!.id, 'error');
      manager.markProxyFailed(proxy!.id, 'error');
      
      // Should be retired now
      expect(manager.getAllActiveProxies().length).toBe(0);
      
      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should be revived
      expect(manager.hasProxies()).toBe(true);
      expect(manager.getAllActiveProxies().length).toBe(1);
    });
  });

  describe('markProxySuccess', () => {
    test('should update success rate and response time', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1');
      
      await manager.init();
      const proxy = manager.getProxyForSession('session1');
      
      manager.markProxySuccess(proxy!.id, 150);
      manager.markProxySuccess(proxy!.id, 100);
      
      const stats = manager.getStats();
      expect(stats.avgSuccessRate).toBe(1); // 100% success rate
    });

    test('should reset consecutive failures on success', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1');
      
      await manager.init();
      const proxy = manager.getProxyForSession('session1');
      
      manager.markProxyFailed(proxy!.id, 'Error');
      manager.markProxySuccess(proxy!.id);
      
      const proxyAfter = manager.getProxyForSession('session1');
      expect(proxyAfter?.consecutiveFailures).toBe(0);
    });
  });

  describe('getStats', () => {
    test('should return correct statistics', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1\nhost2:8080:user2:pass2');
      
      await manager.init();
      
      const stats = manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.retired).toBe(0);
      expect(stats.cooling).toBe(0);
    });
  });

  describe('getHealthReport', () => {
    test('should return formatted health report', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1');
      
      await manager.init();
      
      const proxy = manager.getProxyForSession('session1');
      manager.markProxySuccess(proxy!.id, 100);
      
      const report = manager.getHealthReport();
      expect(report).toContain('Proxy Pool Health Report');
      expect(report).toContain('host1:8080');
    });
  });

  describe('enabled/disabled state', () => {
    test('should not return proxies when disabled', async () => {
      const proxyFile = path.join(testProxyDir, 'proxies.txt');
      fs.writeFileSync(proxyFile, 'host1:8080:user1:pass1');
      
      await manager.init();
      manager.setEnabled(false);
      
      expect(manager.getProxyForSession('session1')).toBeNull();
      expect(manager.hasProxies()).toBe(false);
    });
  });
});
