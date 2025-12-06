/**
 * ScraperEngine 依赖注入
 * 解耦：将依赖创建逻辑分离，便于测试和配置
 */

import { AntiDetection, type AntiDetectionLevel } from './anti-detection';
import { ErrorSnapshotter } from './error-snapshotter';
import { ScraperEventBus } from './scraper-engine.types';
import { NavigationService } from './navigation-service';
import { PerformanceMonitor } from './performance-monitor';
import { ProgressManager } from './progress-manager';
import { ProxyManager } from './proxy-manager';
import { RateLimitManager } from './rate-limit-manager';
import { SessionManager } from './session-manager';

export interface ScraperDependencies {
  navigationService: NavigationService;
  rateLimitManager: RateLimitManager;
  errorSnapshotter: ErrorSnapshotter;
  antiDetection: AntiDetection;
  performanceMonitor: PerformanceMonitor;
  progressManager: ProgressManager;
  sessionManager: SessionManager;
  proxyManager: ProxyManager;
}

/**
 * 创建默认依赖
 */
export function createDefaultDependencies(
  eventBus: ScraperEventBus,
  cookieDir: string = './cookies',
  progressDir: string = './data/progress',
  antiDetectionLevel: AntiDetectionLevel = 'high',
): ScraperDependencies {
  const sessionManager = new SessionManager(cookieDir, 3, eventBus);

  return {
    navigationService: new NavigationService(eventBus),
    rateLimitManager: new RateLimitManager(sessionManager, eventBus),
    errorSnapshotter: new ErrorSnapshotter(),
    antiDetection: new AntiDetection({ level: antiDetectionLevel }),
    performanceMonitor: new PerformanceMonitor(),
    progressManager: new ProgressManager(progressDir, eventBus),
    sessionManager,
    // ProxyManager: 可选功能，如果没有代理文件会自动跳过
    // 大多数用户不需要代理，默认不使用
    proxyManager: new ProxyManager(),
  };
}
