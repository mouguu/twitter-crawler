/**
 * HumanBehavior - 人性化行为模拟模块
 * 
 * 让爬虫行为更像真人操作，避免被机器人检测系统识别。
 * 
 * 功能：
 * - 随机延迟（打字速度、点击间隔）
 * - 模拟鼠标移动轨迹（贝塞尔曲线）
 * - 真实滚动行为（渐进式、非瞬间跳转）
 * - 随机休息时间
 * - 阅读模拟（停留时间与内容长度相关）
 */

import { Page, ElementHandle } from 'puppeteer';

// 高斯分布随机数（用于更自然的随机性）
function gaussianRandom(mean: number, stdev: number): number {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
}

// 确保值在范围内
function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

// 随机整数
function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 随机浮点数
function randomFloat(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

export interface HumanBehaviorConfig {
    // 打字速度配置 (毫秒/字符)
    typingSpeed: {
        min: number;
        max: number;
        errorRate: number;  // 打字错误率 (0-1)
    };
    // 鼠标移动配置
    mouseMoveSpeed: {
        minDuration: number;  // 最小移动时间 (ms)
        maxDuration: number;  // 最大移动时间 (ms)
        steps: number;        // 移动步数
    };
    // 点击配置
    click: {
        preDelay: { min: number; max: number };   // 点击前延迟
        postDelay: { min: number; max: number };  // 点击后延迟
        holdTime: { min: number; max: number };   // 按住时间
    };
    // 滚动配置
    scroll: {
        stepSize: { min: number; max: number };   // 每次滚动像素
        stepDelay: { min: number; max: number };  // 滚动间隔
        pauseChance: number;  // 暂停概率 (0-1)
        pauseTime: { min: number; max: number };  // 暂停时间
    };
    // 阅读配置 (每 1000 字符停留时间)
    reading: {
        baseTime: number;     // 基础阅读时间 (ms)
        perCharTime: number;  // 每字符额外时间 (ms)
        variance: number;     // 时间方差
    };
    // 休息配置
    rest: {
        chance: number;       // 休息概率 (0-1)
        duration: { min: number; max: number };  // 休息时间
    };
}

// 默认配置 - 模拟普通用户行为
export const DEFAULT_HUMAN_CONFIG: HumanBehaviorConfig = {
    typingSpeed: {
        min: 50,
        max: 150,
        errorRate: 0.02,
    },
    mouseMoveSpeed: {
        minDuration: 200,
        maxDuration: 600,
        steps: 20,
    },
    click: {
        preDelay: { min: 100, max: 300 },
        postDelay: { min: 50, max: 200 },
        holdTime: { min: 50, max: 120 },
    },
    scroll: {
        stepSize: { min: 100, max: 400 },
        stepDelay: { min: 50, max: 150 },
        pauseChance: 0.15,
        pauseTime: { min: 500, max: 2000 },
    },
    reading: {
        baseTime: 1000,
        perCharTime: 2,
        variance: 0.3,
    },
    rest: {
        chance: 0.05,
        duration: { min: 3000, max: 8000 },
    },
};

// 快速配置 - 资深用户行为
export const FAST_HUMAN_CONFIG: HumanBehaviorConfig = {
    typingSpeed: {
        min: 30,
        max: 80,
        errorRate: 0.01,
    },
    mouseMoveSpeed: {
        minDuration: 100,
        maxDuration: 300,
        steps: 10,
    },
    click: {
        preDelay: { min: 50, max: 150 },
        postDelay: { min: 20, max: 100 },
        holdTime: { min: 30, max: 80 },
    },
    scroll: {
        stepSize: { min: 200, max: 600 },
        stepDelay: { min: 30, max: 80 },
        pauseChance: 0.05,
        pauseTime: { min: 300, max: 1000 },
    },
    reading: {
        baseTime: 500,
        perCharTime: 1,
        variance: 0.2,
    },
    rest: {
        chance: 0.02,
        duration: { min: 1000, max: 3000 },
    },
};

/**
 * HumanBehavior 类
 * 
 * 用于在 Puppeteer 页面上模拟人类行为
 */
export class HumanBehavior {
    private config: HumanBehaviorConfig;
    private lastMousePosition: { x: number; y: number } = { x: 0, y: 0 };

    constructor(config: Partial<HumanBehaviorConfig> = {}) {
        this.config = { ...DEFAULT_HUMAN_CONFIG, ...config };
    }

    /**
     * 随机延迟
     */
    async randomDelay(min: number, max: number): Promise<void> {
        const delay = randomInt(min, max);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * 高斯延迟 - 更自然的延迟分布
     */
    async gaussianDelay(mean: number, stddev: number, min: number = 0): Promise<void> {
        const delay = Math.max(min, Math.round(gaussianRandom(mean, stddev)));
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * 可能休息 - 按概率决定是否休息
     */
    async maybeRest(): Promise<boolean> {
        if (Math.random() < this.config.rest.chance) {
            const duration = randomInt(this.config.rest.duration.min, this.config.rest.duration.max);
            await new Promise(resolve => setTimeout(resolve, duration));
            return true;
        }
        return false;
    }

    /**
     * 生成贝塞尔曲线路径点
     */
    private generateBezierPath(
        startX: number, startY: number,
        endX: number, endY: number,
        steps: number
    ): Array<{ x: number; y: number }> {
        const points: Array<{ x: number; y: number }> = [];
        
        // 生成控制点（添加随机性使曲线更自然）
        const ctrlX1 = startX + (endX - startX) * randomFloat(0.2, 0.4) + randomFloat(-50, 50);
        const ctrlY1 = startY + (endY - startY) * randomFloat(0.1, 0.3) + randomFloat(-30, 30);
        const ctrlX2 = startX + (endX - startX) * randomFloat(0.6, 0.8) + randomFloat(-50, 50);
        const ctrlY2 = startY + (endY - startY) * randomFloat(0.7, 0.9) + randomFloat(-30, 30);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const t2 = t * t;
            const t3 = t2 * t;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;

            // 三次贝塞尔曲线公式
            const x = mt3 * startX + 3 * mt2 * t * ctrlX1 + 3 * mt * t2 * ctrlX2 + t3 * endX;
            const y = mt3 * startY + 3 * mt2 * t * ctrlY1 + 3 * mt * t2 * ctrlY2 + t3 * endY;

            points.push({ x: Math.round(x), y: Math.round(y) });
        }

        return points;
    }

    /**
     * 模拟鼠标移动（贝塞尔曲线轨迹）
     */
    async moveMouse(page: Page, targetX: number, targetY: number): Promise<void> {
        const { mouseMoveSpeed } = this.config;
        const path = this.generateBezierPath(
            this.lastMousePosition.x,
            this.lastMousePosition.y,
            targetX,
            targetY,
            mouseMoveSpeed.steps
        );

        const totalDuration = randomInt(mouseMoveSpeed.minDuration, mouseMoveSpeed.maxDuration);
        const stepDelay = totalDuration / path.length;

        for (const point of path) {
            await page.mouse.move(point.x, point.y);
            // 添加微小的随机延迟使移动更自然
            await this.randomDelay(
                Math.max(1, stepDelay - 10),
                stepDelay + 10
            );
        }

        this.lastMousePosition = { x: targetX, y: targetY };
    }

    /**
     * 人性化点击（包含移动 + 点击 + 延迟）
     */
    async humanClick(page: Page, x: number, y: number): Promise<void> {
        const { click } = this.config;

        // 1. 移动鼠标到目标
        await this.moveMouse(page, x, y);

        // 2. 点击前延迟
        await this.randomDelay(click.preDelay.min, click.preDelay.max);

        // 3. 模拟按下和释放
        await page.mouse.down();
        await this.randomDelay(click.holdTime.min, click.holdTime.max);
        await page.mouse.up();

        // 4. 点击后延迟
        await this.randomDelay(click.postDelay.min, click.postDelay.max);
    }

    /**
     * 人性化点击元素
     */
    async humanClickElement(page: Page, element: ElementHandle): Promise<void> {
        const box = await element.boundingBox();
        if (!box) {
            throw new Error('Element is not visible or has no bounding box');
        }

        // 点击元素内的随机位置（不是正中心）
        const x = box.x + randomFloat(box.width * 0.2, box.width * 0.8);
        const y = box.y + randomFloat(box.height * 0.2, box.height * 0.8);

        await this.humanClick(page, x, y);
    }

    /**
     * 人性化点击选择器
     */
    async humanClickSelector(page: Page, selector: string): Promise<void> {
        const element = await page.$(selector);
        if (!element) {
            throw new Error(`Element not found: ${selector}`);
        }
        await this.humanClickElement(page, element);
    }

    /**
     * 人性化打字
     */
    async humanType(page: Page, text: string, selector?: string): Promise<void> {
        const { typingSpeed } = this.config;

        if (selector) {
            await this.humanClickSelector(page, selector);
            await this.randomDelay(100, 300); // 点击后等待输入框聚焦
        }

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            // 模拟打字错误
            if (Math.random() < typingSpeed.errorRate && i > 0) {
                // 打错一个字符
                const wrongChar = String.fromCharCode(char.charCodeAt(0) + randomInt(-3, 3));
                await page.keyboard.type(wrongChar);
                await this.randomDelay(100, 200);
                // 删除错误字符
                await page.keyboard.press('Backspace');
                await this.randomDelay(50, 100);
            }

            // 输入正确字符
            await page.keyboard.type(char);

            // 打字间隔
            const delay = randomInt(typingSpeed.min, typingSpeed.max);
            
            // 在标点符号后稍微暂停
            const isPunctuation = ['.', ',', '!', '?', ':', ';'].includes(char);
            if (isPunctuation) {
                await this.randomDelay(delay * 2, delay * 4);
            } else if (char === ' ') {
                // 空格后也稍微暂停
                await this.randomDelay(delay, delay * 2);
            } else {
                await this.randomDelay(delay * 0.5, delay);
            }
        }
    }

    /**
     * 人性化滚动
     */
    async humanScroll(page: Page, distance: number, direction: 'up' | 'down' = 'down'): Promise<void> {
        const { scroll } = this.config;
        const sign = direction === 'down' ? 1 : -1;
        let scrolled = 0;

        while (Math.abs(scrolled) < Math.abs(distance)) {
            // 随机滚动量
            const step = randomInt(scroll.stepSize.min, scroll.stepSize.max);
            const actualStep = Math.min(step, Math.abs(distance) - Math.abs(scrolled));

            await page.evaluate((delta) => {
                window.scrollBy(0, delta);
            }, sign * actualStep);

            scrolled += actualStep;

            // 滚动间隔
            await this.randomDelay(scroll.stepDelay.min, scroll.stepDelay.max);

            // 随机暂停（模拟阅读）
            if (Math.random() < scroll.pauseChance) {
                await this.randomDelay(scroll.pauseTime.min, scroll.pauseTime.max);
            }

            // 可能休息
            await this.maybeRest();
        }
    }

    /**
     * 滚动到元素可见
     */
    async scrollToElement(page: Page, selector: string): Promise<void> {
        const element = await page.$(selector);
        if (!element) {
            throw new Error(`Element not found: ${selector}`);
        }

        const box = await element.boundingBox();
        if (!box) return;

        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const currentScroll = await page.evaluate(() => window.scrollY);
        const elementTop = box.y + currentScroll;

        // 目标位置：元素在视口中间偏上
        const targetScroll = elementTop - viewportHeight * 0.3;
        const scrollDistance = targetScroll - currentScroll;

        if (Math.abs(scrollDistance) > 50) {
            const direction = scrollDistance > 0 ? 'down' : 'up';
            await this.humanScroll(page, Math.abs(scrollDistance), direction);
        }
    }

    /**
     * 模拟阅读内容
     */
    async simulateReading(contentLength: number): Promise<void> {
        const { reading } = this.config;
        
        const baseTime = reading.baseTime + (contentLength * reading.perCharTime);
        const variance = baseTime * reading.variance;
        const readingTime = clamp(
            gaussianRandom(baseTime, variance),
            reading.baseTime / 2,
            baseTime * 2
        );

        await new Promise(resolve => setTimeout(resolve, Math.round(readingTime)));
    }

    /**
     * 等待并模拟人类行为
     */
    async humanWait(minMs: number, maxMs: number): Promise<void> {
        await this.randomDelay(minMs, maxMs);
    }

    /**
     * 在两个操作之间插入人性化延迟
     */
    async betweenActions(options: {
        type?: 'fast' | 'normal' | 'slow';
        mayRest?: boolean;
    } = {}): Promise<void> {
        const { type = 'normal', mayRest = true } = options;

        const delays = {
            fast: { min: 200, max: 500 },
            normal: { min: 500, max: 1500 },
            slow: { min: 1500, max: 4000 },
        };

        const delay = delays[type];
        await this.randomDelay(delay.min, delay.max);

        if (mayRest) {
            await this.maybeRest();
        }
    }

    /**
     * 更新配置
     */
    setConfig(config: Partial<HumanBehaviorConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 使用快速配置
     */
    useFastConfig(): void {
        this.config = { ...FAST_HUMAN_CONFIG };
    }

    /**
     * 使用默认配置
     */
    useDefaultConfig(): void {
        this.config = { ...DEFAULT_HUMAN_CONFIG };
    }
}

// 导出单例实例（方便直接使用）
export const humanBehavior = new HumanBehavior();

// 导出快速访问函数
export const delay = (min: number, max: number) => humanBehavior.randomDelay(min, max);
export const betweenActions = (type?: 'fast' | 'normal' | 'slow') => 
    humanBehavior.betweenActions({ type });
