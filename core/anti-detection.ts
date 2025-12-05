/**
 * AntiDetection - 统一的反检测模块
 * 
 * 整合所有反检测功能，提供简单的 API 来配置和应用反检测措施：
 * - 基础指纹管理 (FingerprintManager)
 * - 高级指纹伪装 (AdvancedFingerprint)
 * - 人性化行为模拟 (HumanBehavior)
 * 
 * 使用方式:
 * ```typescript
 * const antiDetection = new AntiDetection({ level: 'high' });
 * await antiDetection.prepare(page, 'sessionId');
 * 
 * // 人性化操作
 * await antiDetection.humanClick(page, selector);
 * await antiDetection.humanType(page, 'hello', '#input');
 * await antiDetection.humanScroll(page, 500);
 * ```
 */

import { Page } from 'puppeteer';
import { FingerprintManager } from './fingerprint-manager';
import { AdvancedFingerprint, generateRandomConfig, type AdvancedFingerprintConfig } from './advanced-fingerprint';
import { HumanBehavior, DEFAULT_HUMAN_CONFIG, FAST_HUMAN_CONFIG, type HumanBehaviorConfig } from './human-behavior';

// 反检测级别
export type AntiDetectionLevel = 'low' | 'medium' | 'high' | 'paranoid';

// 配置选项
export interface AntiDetectionOptions {
    level?: AntiDetectionLevel;
    fingerprint?: Partial<AdvancedFingerprintConfig>;
    behavior?: Partial<HumanBehaviorConfig>;
    fingerprintDir?: string;  // 指纹存储目录
}

/**
 * 反检测级别对应的功能配置
 */
const LEVEL_CONFIGS: Record<AntiDetectionLevel, {
    useBasicFingerprint: boolean;
    useAdvancedFingerprint: boolean;
    useHumanBehavior: boolean;
    behaviorSpeed: 'fast' | 'normal';
    canvasNoise: number;
    audioNoise: number;
}> = {
    low: {
        useBasicFingerprint: true,
        useAdvancedFingerprint: false,
        useHumanBehavior: false,
        behaviorSpeed: 'fast',
        canvasNoise: 0,
        audioNoise: 0,
    },
    medium: {
        useBasicFingerprint: true,
        useAdvancedFingerprint: true,
        useHumanBehavior: false,
        behaviorSpeed: 'fast',
        canvasNoise: 0.005,
        audioNoise: 0.0001,
    },
    high: {
        useBasicFingerprint: true,
        useAdvancedFingerprint: true,
        useHumanBehavior: true,
        behaviorSpeed: 'fast',
        canvasNoise: 0.01,
        audioNoise: 0.0003,
    },
    paranoid: {
        useBasicFingerprint: true,
        useAdvancedFingerprint: true,
        useHumanBehavior: true,
        behaviorSpeed: 'normal',
        canvasNoise: 0.015,
        audioNoise: 0.0005,
    },
};

export class AntiDetection {
    private level: AntiDetectionLevel;
    private fingerprintManager: FingerprintManager;
    private advancedFingerprint: AdvancedFingerprint;
    private humanBehavior: HumanBehavior;
    private levelConfig: typeof LEVEL_CONFIGS[AntiDetectionLevel];

    constructor(options: AntiDetectionOptions = {}) {
        this.level = options.level || 'high';
        this.levelConfig = LEVEL_CONFIGS[this.level];

        // 初始化指纹管理器
        this.fingerprintManager = new FingerprintManager(options.fingerprintDir);

        // 初始化高级指纹
        const fingerprintConfig = generateRandomConfig();
        if (options.fingerprint) {
            Object.assign(fingerprintConfig, options.fingerprint);
        }
        fingerprintConfig.canvas.factor = this.levelConfig.canvasNoise;
        fingerprintConfig.audio.noiseFactor = this.levelConfig.audioNoise;
        this.advancedFingerprint = new AdvancedFingerprint(fingerprintConfig);

        // 初始化人性化行为
        const behaviorConfig = this.levelConfig.behaviorSpeed === 'fast' 
            ? FAST_HUMAN_CONFIG 
            : DEFAULT_HUMAN_CONFIG;
        this.humanBehavior = new HumanBehavior({
            ...behaviorConfig,
            ...options.behavior,
        });
    }

    /**
     * 准备页面 - 注入所有反检测措施
     * 
     * 必须在页面导航到目标 URL 之前调用
     */
    async prepare(page: Page, sessionId: string, options: { rotate?: boolean } = {}): Promise<void> {
        const { rotate = false } = options;

        // 1. 注入基础指纹 (UA, Viewport 等)
        if (this.levelConfig.useBasicFingerprint) {
            await this.fingerprintManager.injectFingerprint(page, sessionId, rotate);
        }

        // 2. 注入高级指纹 (Canvas, WebGL, Audio 等)
        if (this.levelConfig.useAdvancedFingerprint) {
            await this.advancedFingerprint.inject(page);
        }

        // 3. 设置额外的页面配置
        await this.setupPage(page);
    }

    /**
     * 额外的页面配置
     */
    private async setupPage(page: Page): Promise<void> {
        // 设置合理的视口尺寸
        const viewports = [
            { width: 1920, height: 1080 },
            { width: 1536, height: 864 },
            { width: 1440, height: 900 },
            { width: 1366, height: 768 },
        ];
        const viewport = viewports[Math.floor(Math.random() * viewports.length)];
        await page.setViewport(viewport);

        // 设置额外的请求头
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'sec-ch-ua': '"Chromium";v="119", "Not?A_Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
        });
    }

    // ============ 人性化行为代理方法 ============

    /**
     * 人性化点击选择器
     */
    async humanClick(page: Page, selector: string): Promise<void> {
        if (this.levelConfig.useHumanBehavior) {
            await this.humanBehavior.humanClickSelector(page, selector);
        } else {
            await page.click(selector);
        }
    }

    /**
     * 人性化打字
     */
    async humanType(page: Page, text: string, selector?: string): Promise<void> {
        if (this.levelConfig.useHumanBehavior) {
            await this.humanBehavior.humanType(page, text, selector);
        } else {
            if (selector) {
                await page.click(selector);
            }
            await page.keyboard.type(text);
        }
    }

    /**
     * 人性化滚动
     */
    async humanScroll(page: Page, distance: number, direction: 'up' | 'down' = 'down'): Promise<void> {
        if (this.levelConfig.useHumanBehavior) {
            await this.humanBehavior.humanScroll(page, distance, direction);
        } else {
            const sign = direction === 'down' ? 1 : -1;
            await page.evaluate((d) => window.scrollBy(0, d), sign * distance);
        }
    }

    /**
     * 滚动到元素
     */
    async scrollToElement(page: Page, selector: string): Promise<void> {
        if (this.levelConfig.useHumanBehavior) {
            await this.humanBehavior.scrollToElement(page, selector);
        } else {
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, selector);
        }
    }

    /**
     * 随机延迟
     */
    async delay(min: number, max: number): Promise<void> {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise(r => setTimeout(r, ms));
    }

    /**
     * 操作间延迟 - 根据级别自动调整
     */
    async betweenActions(type: 'fast' | 'normal' | 'slow' = 'normal'): Promise<void> {
        if (this.levelConfig.useHumanBehavior) {
            await this.humanBehavior.betweenActions({ type });
        } else {
            const delays = { fast: 200, normal: 500, slow: 1000 };
            await this.delay(delays[type] * 0.5, delays[type] * 1.5);
        }
    }

    /**
     * 模拟阅读
     */
    async simulateReading(contentLength: number = 500): Promise<void> {
        if (this.levelConfig.useHumanBehavior) {
            await this.humanBehavior.simulateReading(contentLength);
        } else {
            // 简单的阅读延迟
            await this.delay(500, 2000);
        }
    }

    /**
     * 可能休息 - 根据概率决定是否暂停
     */
    async maybeRest(): Promise<boolean> {
        if (this.levelConfig.useHumanBehavior) {
            return await this.humanBehavior.maybeRest();
        }
        return false;
    }

    // ============ 配置方法 ============

    /**
     * 获取当前级别
     */
    getLevel(): AntiDetectionLevel {
        return this.level;
    }

    /**
     * 设置新级别
     */
    setLevel(level: AntiDetectionLevel): void {
        this.level = level;
        this.levelConfig = LEVEL_CONFIGS[level];
        
        // 更新行为配置
        if (this.levelConfig.behaviorSpeed === 'fast') {
            this.humanBehavior.useFastConfig();
        } else {
            this.humanBehavior.useDefaultConfig();
        }

        // 更新指纹配置
        this.advancedFingerprint.setConfig({
            canvas: { enabled: true, factor: this.levelConfig.canvasNoise },
            audio: { enabled: true, noiseFactor: this.levelConfig.audioNoise },
        });
    }

    /**
     * 获取组件实例（高级用途）
     */
    getComponents() {
        return {
            fingerprintManager: this.fingerprintManager,
            advancedFingerprint: this.advancedFingerprint,
            humanBehavior: this.humanBehavior,
        };
    }

    /**
     * 获取配置摘要
     */
    getSummary(): string {
        return `AntiDetection [${this.level}]
  ├─ Basic Fingerprint: ${this.levelConfig.useBasicFingerprint ? '✓' : '✗'}
  ├─ Advanced Fingerprint: ${this.levelConfig.useAdvancedFingerprint ? '✓' : '✗'}
  │  ├─ Canvas Noise: ${this.levelConfig.canvasNoise}
  │  └─ Audio Noise: ${this.levelConfig.audioNoise}
  └─ Human Behavior: ${this.levelConfig.useHumanBehavior ? '✓' : '✗'} (${this.levelConfig.behaviorSpeed})`;
    }
}

// 导出默认实例
export const antiDetection = new AntiDetection({ level: 'high' });
