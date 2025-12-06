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
 * Simplified ProxyManager
 * 
 * Focuses on robustly loading and rotating proxies without complex scoring.
 */
export class ProxyManager {
  private proxies: Proxy[] = [];
  private enabled: boolean = true;
  private currentIndex: number = 0;

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
   * Get next proxy (Round Robin)
   */
  getNextProxy(): Proxy | null {
    if (!this.isEnabled()) return null;

    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
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
        const parts = line.trim().split(':');
        if (parts.length >= 2) {
          const host = parts[0];
          const port = parseInt(parts[1], 10);
          const username = parts[2];
          const password = parts[3];
          
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
  
  // Method to satisfy interfaces that might need stats (though simplified)
  getStats() {
      return {
          total: this.proxies.length,
          active: this.proxies.length, // Assume all active
          avgSuccessRate: 1.0,
          details: 'Simple Proxy Manager',
      };
  }
}
