import * as fs from 'fs';
import * as path from 'path';
import { ScraperEventBus } from './event-bus';

export interface Proxy {
    id: string;
    host: string;
    port: number;
    username: string;
    password: string;
    usageCount: number;
    errorCount: number;
    consecutiveFailures: number;
    isRetired: boolean;
}

/**
 * 代理管理器（可选功能，默认不使用代理）
 * 
 * 作用：为每个 session 分配代理，提高匿名性和绕过 IP 限制
 * 
 * 适用场景：
 * - 需要隐藏真实 IP 地址
 * - 需要绕过地理位置限制
 * - 需要提高爬取稳定性
 * 
 * 使用方式：
 * - 默认不使用代理，如果没有代理文件会自动跳过
 * - 在 ./proxy 目录放置代理文件（格式：IP:PORT:USERNAME:PASSWORD）
 * - 如果检测到代理文件，会自动加载并使用
 */
export class ProxyManager {
    private proxies: Proxy[] = [];
    private sessionProxyMap: Map<string, string> = new Map(); // sessionId -> proxyId
    private maxErrorCount: number = 3;
    private maxConsecutiveFailures: number = 2;
    private enabled: boolean = true; // 是否启用代理（可通过setEnabled控制）

    constructor(private proxyDir: string = './proxy', private eventBus?: ScraperEventBus) {}
    
    /**
     * 设置是否启用代理
     * @param enabled true=启用（默认），false=禁用
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this._log('Proxy disabled by user', 'info');
        }
    }
    
    /**
     * 检查是否启用代理
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Load proxies from file(s) in the proxy directory
     */
    async init(): Promise<void> {
        // 如果代理被禁用，直接返回
        if (!this.enabled) {
            this._log('Proxy is disabled, skipping initialization', 'info');
            return;
        }
        
        if (!fs.existsSync(this.proxyDir)) {
            this._log(`Proxy directory not found: ${this.proxyDir}. Proxies will not be used.`, 'warn');
            return;
        }

        const files = fs.readdirSync(this.proxyDir).filter(f => f.endsWith('.txt'));
        
        if (files.length === 0) {
            this._log(`No proxy files found in ${this.proxyDir}. Proxies will not be used.`, 'warn');
            return;
        }

        for (const file of files) {
            const filePath = path.join(this.proxyDir, file);
            try {
                await this.loadProxiesFromFile(filePath);
            } catch (e: any) {
                this._log(`Failed to load proxy file ${file}: ${e.message}`, 'error');
            }
        }

        this._log(`Loaded ${this.proxies.length} proxies.`);
    }

    /**
     * Load proxies from a single file
     * Supports Webshare format: IP:PORT:USERNAME:PASSWORD
     */
    private async loadProxiesFromFile(filePath: string): Promise<void> {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        for (const line of lines) {
            try {
                const parts = line.split(':');
                if (parts.length !== 4) {
                    this._log(`Skipping invalid proxy format: ${line}`, 'warn');
                    continue;
                }

                const [host, port, username, password] = parts;
                const proxyId = `${host}:${port}`;

                // Check if already loaded
                if (this.proxies.some(p => p.id === proxyId)) {
                    continue;
                }

                this.proxies.push({
                    id: proxyId,
                    host: host.trim(),
                    port: parseInt(port.trim()),
                    username: username.trim(),
                    password: password.trim(),
                    usageCount: 0,
                    errorCount: 0,
                    consecutiveFailures: 0,
                    isRetired: false,
                });
            } catch (e: any) {
                this._log(`Failed to parse proxy line: ${line} - ${e.message}`, 'warn');
            }
        }
    }

    /**
     * Get proxy for a specific session (deterministic 1:1 mapping)
     */
    getProxyForSession(sessionId: string): Proxy | null {
        // 如果代理被禁用，返回null
        if (!this.enabled) {
            return null;
        }
        
        if (this.proxies.length === 0) {
            return null;
        }

        // Check if we already have a binding
        const existingProxyId = this.sessionProxyMap.get(sessionId);
        if (existingProxyId) {
            const proxy = this.proxies.find(p => p.id === existingProxyId && !p.isRetired);
            if (proxy) {
                return proxy;
            }
        }

        // Create new binding: hash sessionId to proxy index
        const activeProxies = this.proxies.filter(p => !p.isRetired);
        if (activeProxies.length === 0) {
            this._log('All proxies are retired. No proxy available.', 'error');
            return null;
        }

        // Deterministic mapping: use hash of sessionId
        const hash = this.hashCode(sessionId);
        const index = Math.abs(hash) % activeProxies.length;
        const selectedProxy = activeProxies[index];

        this.sessionProxyMap.set(sessionId, selectedProxy.id);
        this._log(`Binding session ${sessionId} → proxy ${selectedProxy.id}`);

        return selectedProxy;
    }

    /**
     * Simple hash function for deterministic mapping
     */
    private hashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }

    /**
     * Mark proxy as failed
     */
    markProxyFailed(proxyId: string, reason: string = 'unknown error'): void {
        const proxy = this.proxies.find(p => p.id === proxyId);
        if (proxy) {
            proxy.errorCount++;
            proxy.consecutiveFailures++;
            this._log(`Proxy ${proxyId} error count: ${proxy.errorCount} (${reason})`, 'warn');

            if (proxy.errorCount >= this.maxErrorCount || proxy.consecutiveFailures >= this.maxConsecutiveFailures) {
                this.retireProxy(proxyId);
            }
        }
    }

    /**
     * Mark proxy as successful
     */
    markProxySuccess(proxyId: string): void {
        const proxy = this.proxies.find(p => p.id === proxyId);
        if (proxy) {
            proxy.usageCount++;
            if (proxy.errorCount > 0) proxy.errorCount--;
            proxy.consecutiveFailures = 0;
        }
    }

    /**
     * Retire a proxy (no longer use it)
     */
    private retireProxy(proxyId: string): void {
        const proxy = this.proxies.find(p => p.id === proxyId);
        if (proxy) {
            proxy.isRetired = true;
            this._log(`Proxy ${proxyId} has been RETIRED due to too many errors.`, 'error');
        }
    }

    /**
     * Get all active proxies
     */
    getAllActiveProxies(): Proxy[] {
        return this.proxies.filter(p => !p.isRetired);
    }

    /**
     * Check if proxies are available
     */
    hasProxies(): boolean {
        // 如果代理被禁用，返回false
        if (!this.enabled) {
            return false;
        }
        return this.getAllActiveProxies().length > 0;
    }

    private _log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        if (this.eventBus) {
            this.eventBus.emitLog(`[ProxyManager] ${message}`, level);
        } else {
            const prefix = '[ProxyManager]';
            if (level === 'error') console.error(prefix, message);
            else if (level === 'warn') console.warn(prefix, message);
            else console.log(prefix, message);
        }
    }
}
