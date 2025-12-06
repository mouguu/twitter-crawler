import * as fs from 'node:fs';
import * as path from 'node:path';
import { createEnhancedLogger } from '../utils/logger';

const logger = createEnhancedLogger('ProxyManager');

export interface Proxy {
  id: string; // host:port
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'https';
  url: string; // http://user:pass@host:port
}

/**
 * Enhanced ProxyManager with failure tracking and auto-rotation
 *
 * Features:
 * - Failure tracking per proxy
 * - Auto-rotation on timeout/failure
 * - Health checking
 * - Statistics
 */
export class ProxyManager {
  private proxies: Proxy[] = [];
  private enabled: boolean = true;
  private currentIndex: number = 0;
  private proxyStats: Map<string, {
    failures: number;
    successes: number;
    lastFailure?: number;
    lastSuccess?: number;
    isHealthy: boolean;
  }> = new Map();
  private maxFailuresBeforeMarkUnhealthy = 3;
  private failureCooldown = 60000; // 1 minute cooldown after failure

  constructor(private proxyDir: string = './proxy') {}

  /**
   * Initialize and load proxies
   */
  async init(): Promise<void> {
    if (!this.enabled) {
      logger.info('Proxy disabled via config');
      return;
    }

    if (!fs.existsSync(this.proxyDir)) {
      logger.warn(`Proxy directory not found: ${this.proxyDir}`);
      return;
    }

    const files = fs.readdirSync(this.proxyDir).filter((f) => f.endsWith('.txt'));

    for (const file of files) {
      await this.loadProxiesFromFile(path.join(this.proxyDir, file));
    }

    logger.info(`Loaded ${this.proxies.length} proxies from ${files.length} files`);
  }

  /**
   * Set enabled state
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled && this.proxies.length > 0;
  }

  hasProxies(): boolean {
      return this.proxies.length > 0;
  }

  /**
   * Get next proxy (Round Robin with health check)
   */
  getNextProxy(): Proxy | null {
    if (!this.isEnabled()) return null;

    // Try to find a healthy proxy
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      const stats = this.proxyStats.get(proxy.id);

      // If proxy is healthy or has no stats (new proxy), use it
      if (!stats || stats.isHealthy) {
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
      }

      // Check if cooldown has passed
      if (stats.lastFailure && Date.now() - stats.lastFailure > this.failureCooldown) {
        // Reset health after cooldown
        stats.isHealthy = true;
        stats.failures = 0;
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
      }

      // Skip unhealthy proxy, try next
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      attempts++;
    }

    // If all proxies are unhealthy, return the next one anyway (better than nothing)
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }

  /**
   * Mark proxy as failed (for auto-rotation)
   */
  markProxyFailed(proxyId: string, reason?: string): void {
    const stats = this.proxyStats.get(proxyId) || {
      failures: 0,
      successes: 0,
      isHealthy: true,
    };

    stats.failures++;
    stats.lastFailure = Date.now();

    if (stats.failures >= this.maxFailuresBeforeMarkUnhealthy) {
      stats.isHealthy = false;
      logger.warn(`Proxy ${proxyId} marked as unhealthy after ${stats.failures} failures`, {
        proxyId,
        failures: stats.failures,
        reason,
      });
    }

    this.proxyStats.set(proxyId, stats);
  }

  /**
   * Mark proxy as successful (for health tracking)
   */
  markProxySuccess(proxyId: string): void {
    const stats = this.proxyStats.get(proxyId) || {
      failures: 0,
      successes: 0,
      isHealthy: true,
    };

    stats.successes++;
    stats.lastSuccess = Date.now();

    // Reset failures on success (proxy is working again)
    if (stats.failures > 0) {
      stats.failures = Math.max(0, stats.failures - 1);
    }

    // Mark as healthy if it was unhealthy
    if (!stats.isHealthy && stats.failures < this.maxFailuresBeforeMarkUnhealthy) {
      stats.isHealthy = true;
      logger.info(`Proxy ${proxyId} recovered and marked as healthy`, {
        proxyId,
        successes: stats.successes,
      });
    }

    this.proxyStats.set(proxyId, stats);
  }

  /**
   * Get proxy statistics
   */
  getProxyStats(proxyId: string) {
    return this.proxyStats.get(proxyId) || {
      failures: 0,
      successes: 0,
      isHealthy: true,
    };
  }

  /**
   * Get random proxy
   */
  getRandomProxy(): Proxy | null {
    if (!this.isEnabled()) return null;
    const index = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[index];
  }

  // Helper: Load from file
  private async loadProxiesFromFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);

      for (const line of lines) {
        // Format: host:port:user:pass
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        const parts = trimmedLine.split(':');
        if (parts.length >= 4) {
          const host = parts[0];
          const port = parseInt(parts[1], 10);
          const username = parts[2];
          const password = parts.slice(3).join(':'); // Handle passwords that might contain ':'
          
          if (!host || !port || isNaN(port)) {
            logger.warn(`Invalid proxy line (missing host/port): ${trimmedLine.substring(0, 50)}`);
            continue;
          }
          
          let url = `http://${host}:${port}`;
          if (username && password) {
            url = `http://${username}:${password}@${host}:${port}`;
          }

          this.proxies.push({
            id: `${host}:${port}`,
            host,
            port,
            username,
            password,
            protocol: 'http',
            url
          });
          
          logger.debug(`Loaded proxy: ${host}:${port} (auth: ${username ? 'yes' : 'no'})`);
        } else if (parts.length >= 2) {
          // Proxy without auth: host:port
          const host = parts[0];
          const port = parseInt(parts[1], 10);
          if (host && port && !isNaN(port)) {
            this.proxies.push({
              id: `${host}:${port}`,
              host,
              port,
              protocol: 'http',
              url: `http://${host}:${port}`
            });
            logger.debug(`Loaded proxy without auth: ${host}:${port}`);
          }
        } else {
          logger.warn(`Invalid proxy line format: ${trimmedLine.substring(0, 50)}`);
        }
      }
    } catch (error) {
      logger.error(`Failed to load proxy file: ${filePath}`, error as Error);
    }
  }

  /**
   * Destroy - no-op for simple manager
   */
  destroy(): void {}

  // Method to satisfy interfaces that might need stats
  getStats() {
    const healthyCount = Array.from(this.proxyStats.values()).filter(s => s.isHealthy).length;
    const totalRequests = Array.from(this.proxyStats.values()).reduce((sum, s) => sum + s.successes + s.failures, 0);
    const totalSuccesses = Array.from(this.proxyStats.values()).reduce((sum, s) => sum + s.successes, 0);
    const avgSuccessRate = totalRequests > 0 ? totalSuccesses / totalRequests : 1.0;

    return {
      total: this.proxies.length,
      active: healthyCount || this.proxies.length, // Healthy proxies or all if no stats
      healthy: healthyCount,
      unhealthy: this.proxies.length - healthyCount,
      avgSuccessRate,
      totalRequests,
      totalSuccesses,
      details: 'Enhanced Proxy Manager with health tracking',
    };
  }
}
