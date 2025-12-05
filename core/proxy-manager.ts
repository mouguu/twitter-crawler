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
    // 🆕 新增字段
    retiredAt?: number;          // 退役时间戳
    lastUsedAt?: number;         // 最后使用时间
    avgResponseTime?: number;    // 平均响应时间 (ms)
    successRate?: number;        // 成功率 (0-1)
    totalRequests: number;       // 总请求数
    successfulRequests: number;  // 成功请求数
}

export interface ProxyStats {
    total: number;
    active: number;
    retired: number;
    cooling: number;
    avgSuccessRate: number;
}

/**
 * 代理管理器（增强版）
 * 
 * 功能：
 * - 代理池管理和负载均衡
 * - 健康检查和自动恢复
 * - 冷却机制（退役代理自动复活）
 * - 智能轮询（优先选择健康代理）
 * - 实时统计和监控
 */
export class ProxyManager {
    private proxies: Proxy[] = [];
    private sessionProxyMap: Map<string, string> = new Map(); // sessionId -> proxyId
    private maxErrorCount: number = 3;
    private maxConsecutiveFailures: number = 2;
    private enabled: boolean = true;
    
    // 🆕 冷却和健康检查配置
    private cooldownPeriodMs: number = 10 * 60 * 1000; // 10 分钟冷却期
    private healthCheckIntervalMs: number = 5 * 60 * 1000; // 5 分钟健康检查间隔
    private healthCheckTimer?: ReturnType<typeof setInterval>;

    constructor(private proxyDir: string = './proxy', private eventBus?: ScraperEventBus) {}
    
    /**
     * 设置是否启用代理
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this._log('Proxy disabled by user', 'info');
            this.stopHealthCheck();
        }
    }
    
    /**
     * 检查是否启用代理
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * 设置冷却期（毫秒）
     */
    setCooldownPeriod(ms: number): void {
        this.cooldownPeriodMs = ms;
        this._log(`Cooldown period set to ${ms}ms (${ms / 60000} minutes)`, 'info');
    }

    /**
     * 初始化代理池
     */
    async init(): Promise<void> {
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
        
        // 🆕 启动健康检查定时器
        this.startHealthCheck();
    }

    /**
     * 从文件加载代理
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
                    totalRequests: 0,
                    successfulRequests: 0,
                    avgResponseTime: 0,
                    successRate: 1,
                });
            } catch (e: any) {
                this._log(`Failed to parse proxy line: ${line} - ${e.message}`, 'warn');
            }
        }
    }

    /**
     * 🆕 获取最佳代理（智能选择）
     * 优先选择：成功率高、响应时间短、使用次数少的代理
     */
    getBestProxy(excludeIds: string[] = []): Proxy | null {
        if (!this.enabled || this.proxies.length === 0) {
            return null;
        }

        // 先尝试复活冷却期已过的代理
        this.reviveCooledProxies();

        const activeProxies = this.proxies.filter(p => 
            !p.isRetired && !excludeIds.includes(p.id)
        );

        if (activeProxies.length === 0) {
            this._log('No active proxies available', 'warn');
            return null;
        }

        // 智能排序：成功率 > 响应时间 > 使用次数
        activeProxies.sort((a, b) => {
            // 优先成功率高的
            const successDiff = (b.successRate || 1) - (a.successRate || 1);
            if (Math.abs(successDiff) > 0.1) return successDiff > 0 ? 1 : -1;
            
            // 其次响应时间短的
            const timeDiff = (a.avgResponseTime || 0) - (b.avgResponseTime || 0);
            if (Math.abs(timeDiff) > 100) return timeDiff > 0 ? 1 : -1;
            
            // 最后使用次数少的
            return (a.usageCount || 0) - (b.usageCount || 0);
        });

        return activeProxies[0];
    }

    /**
     * 获取指定 session 的代理
     */
    getProxyForSession(sessionId: string): Proxy | null {
        if (!this.enabled) {
            return null;
        }
        
        if (this.proxies.length === 0) {
            return null;
        }

        // 先尝试复活冷却期已过的代理
        this.reviveCooledProxies();

        // 检查是否已有绑定
        const existingProxyId = this.sessionProxyMap.get(sessionId);
        if (existingProxyId) {
            const proxy = this.proxies.find(p => p.id === existingProxyId && !p.isRetired);
            if (proxy) {
                return proxy;
            }
            // 绑定的代理已退役，需要重新分配
            this.sessionProxyMap.delete(sessionId);
        }

        // 使用智能选择获取最佳代理
        const bestProxy = this.getBestProxy();
        if (bestProxy) {
            this.sessionProxyMap.set(sessionId, bestProxy.id);
            this._log(`Binding session ${sessionId} → proxy ${bestProxy.id} (success rate: ${((bestProxy.successRate || 1) * 100).toFixed(1)}%)`);
            return bestProxy;
        }

        return null;
    }

    /**
     * 🆕 为 session 切换到新代理（当前代理出错时）
     */
    switchProxyForSession(sessionId: string, reason: string = 'error'): Proxy | null {
        const currentProxyId = this.sessionProxyMap.get(sessionId);
        
        // 先标记当前代理失败
        if (currentProxyId) {
            this.markProxyFailed(currentProxyId, reason);
        }

        // 获取新代理，排除当前失败的代理
        const excludeIds = currentProxyId ? [currentProxyId] : [];
        const newProxy = this.getBestProxy(excludeIds);

        if (newProxy) {
            this.sessionProxyMap.set(sessionId, newProxy.id);
            this._log(`Switched session ${sessionId} from ${currentProxyId || 'none'} → ${newProxy.id} (reason: ${reason})`);
            return newProxy;
        }

        this._log(`Failed to switch proxy for session ${sessionId}: no available proxies`, 'error');
        return null;
    }

    /**
     * 🆕 复活冷却期已过的代理
     */
    private reviveCooledProxies(): void {
        const now = Date.now();
        let revivedCount = 0;

        for (const proxy of this.proxies) {
            if (proxy.isRetired && proxy.retiredAt) {
                const cooledTime = now - proxy.retiredAt;
                if (cooledTime >= this.cooldownPeriodMs) {
                    proxy.isRetired = false;
                    proxy.consecutiveFailures = 0;
                    proxy.errorCount = Math.max(0, proxy.errorCount - 1); // 减少错误计数
                    proxy.retiredAt = undefined;
                    revivedCount++;
                    this._log(`Proxy ${proxy.id} revived after ${Math.round(cooledTime / 60000)} min cooldown`, 'info');
                }
            }
        }

        if (revivedCount > 0) {
            this._log(`Revived ${revivedCount} proxies from cooldown`, 'info');
        }
    }

    /**
     * 🆕 开始健康检查定时器
     */
    private startHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        this.healthCheckTimer = setInterval(() => {
            this.reviveCooledProxies();
            this.logStats();
        }, this.healthCheckIntervalMs);

        this._log(`Health check started (interval: ${this.healthCheckIntervalMs / 60000} min)`);
    }

    /**
     * 🆕 停止健康检查
     */
    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
    }

    /**
     * 标记代理失败
     */
    markProxyFailed(proxyId: string, reason: string = 'unknown error'): void {
        const proxy = this.proxies.find(p => p.id === proxyId);
        if (proxy) {
            proxy.errorCount++;
            proxy.consecutiveFailures++;
            proxy.totalRequests++;
            
            // 更新成功率
            proxy.successRate = proxy.successfulRequests / proxy.totalRequests;
            
            this._log(`Proxy ${proxyId} failed: ${reason} (errors: ${proxy.errorCount}, rate: ${(proxy.successRate * 100).toFixed(1)}%)`, 'warn');

            if (proxy.errorCount >= this.maxErrorCount || proxy.consecutiveFailures >= this.maxConsecutiveFailures) {
                this.retireProxy(proxyId);
            }
        }
    }

    /**
     * 标记代理成功
     */
    markProxySuccess(proxyId: string, responseTimeMs?: number): void {
        const proxy = this.proxies.find(p => p.id === proxyId);
        if (proxy) {
            proxy.usageCount++;
            proxy.totalRequests++;
            proxy.successfulRequests++;
            proxy.consecutiveFailures = 0;
            proxy.lastUsedAt = Date.now();
            
            // 更新成功率
            proxy.successRate = proxy.successfulRequests / proxy.totalRequests;
            
            // 更新平均响应时间
            if (responseTimeMs !== undefined) {
                if (proxy.avgResponseTime === 0) {
                    proxy.avgResponseTime = responseTimeMs;
                } else {
                    // 滑动平均
                    proxy.avgResponseTime = proxy.avgResponseTime * 0.7 + responseTimeMs * 0.3;
                }
            }

            // 逐渐恢复错误计数
            if (proxy.errorCount > 0) {
                proxy.errorCount = Math.max(0, proxy.errorCount - 0.5);
            }
        }
    }

    /**
     * 🆕 退役代理（带冷却时间）
     */
    private retireProxy(proxyId: string): void {
        const proxy = this.proxies.find(p => p.id === proxyId);
        if (proxy) {
            proxy.isRetired = true;
            proxy.retiredAt = Date.now(); // 记录退役时间
            
            // 清除该代理的 session 绑定
            for (const [sessionId, pId] of this.sessionProxyMap.entries()) {
                if (pId === proxyId) {
                    this.sessionProxyMap.delete(sessionId);
                }
            }
            
            this._log(`Proxy ${proxyId} RETIRED (will revive after ${this.cooldownPeriodMs / 60000} min cooldown)`, 'warn');
        }
    }

    /**
     * 获取所有活跃代理
     */
    getAllActiveProxies(): Proxy[] {
        return this.proxies.filter(p => !p.isRetired);
    }

    /**
     * 🆕 获取代理统计信息
     */
    getStats(): ProxyStats {
        const active = this.proxies.filter(p => !p.isRetired);
        const retired = this.proxies.filter(p => p.isRetired && !p.retiredAt);
        const cooling = this.proxies.filter(p => p.isRetired && p.retiredAt);
        
        const totalSuccessRate = active.length > 0 
            ? active.reduce((sum, p) => sum + (p.successRate || 1), 0) / active.length
            : 0;

        return {
            total: this.proxies.length,
            active: active.length,
            retired: retired.length,
            cooling: cooling.length,
            avgSuccessRate: totalSuccessRate,
        };
    }

    /**
     * 🆕 输出代理池统计日志
     */
    private logStats(): void {
        const stats = this.getStats();
        this._log(
            `Pool stats: ${stats.active} active, ${stats.cooling} cooling, ${stats.retired} retired ` +
            `(avg success rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%)`,
            'info'
        );
    }

    /**
     * 检查是否有可用代理
     */
    hasProxies(): boolean {
        if (!this.enabled) {
            return false;
        }
        this.reviveCooledProxies();
        return this.getAllActiveProxies().length > 0;
    }

    /**
     * 🆕 获取代理的健康报告
     */
    getHealthReport(): string {
        const stats = this.getStats();
        const lines = [
            `=== Proxy Pool Health Report ===`,
            `Total: ${stats.total} | Active: ${stats.active} | Cooling: ${stats.cooling} | Retired: ${stats.retired}`,
            `Average Success Rate: ${(stats.avgSuccessRate * 100).toFixed(1)}%`,
            ``,
            `Top 5 Proxies:`,
        ];

        const topProxies = [...this.proxies]
            .filter(p => p.totalRequests > 0)
            .sort((a, b) => (b.successRate || 0) - (a.successRate || 0))
            .slice(0, 5);

        for (const p of topProxies) {
            const status = p.isRetired ? (p.retiredAt ? '❄️ COOLING' : '💀 RETIRED') : '✅ ACTIVE';
            lines.push(
                `  ${p.id}: ${status} | ` +
                `Success: ${((p.successRate || 0) * 100).toFixed(1)}% | ` +
                `Requests: ${p.totalRequests} | ` +
                `Avg Time: ${Math.round(p.avgResponseTime || 0)}ms`
            );
        }

        return lines.join('\n');
    }

    /**
     * 🆕 清理资源
     */
    destroy(): void {
        this.stopHealthCheck();
        this.sessionProxyMap.clear();
        this._log('ProxyManager destroyed', 'info');
    }

    private hashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash;
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
