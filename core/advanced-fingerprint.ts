/**
 * AdvancedFingerprint - 高级指纹伪装模块
 * 
 * 扩展基础的 FingerprintManager，提供更深层的反检测能力：
 * - Canvas 指纹伪装
 * - WebGL 指纹伪装
 * - 音频指纹伪装
 * - 硬件信息伪装
 * - 时区和语言伪装
 */

import { Page } from 'puppeteer';

// Canvas 噪声注入参数
interface CanvasNoiseConfig {
    enabled: boolean;
    factor: number;  // 噪声因子 (0-1)，值越大噪声越明显
}

// WebGL 伪装参数
interface WebGLSpoofConfig {
    enabled: boolean;
    vendor: string;
    renderer: string;
    unmaskedVendor?: string;
    unmaskedRenderer?: string;
}

// 音频伪装参数
interface AudioSpoofConfig {
    enabled: boolean;
    noiseFactor: number;  // 音频噪声因子
}

// 硬件伪装参数
interface HardwareSpoofConfig {
    deviceMemory?: number;       // GB
    hardwareConcurrency?: number; // CPU 核心数
    maxTouchPoints?: number;
}

// 完整配置
export interface AdvancedFingerprintConfig {
    canvas: CanvasNoiseConfig;
    webgl: WebGLSpoofConfig;
    audio: AudioSpoofConfig;
    hardware: HardwareSpoofConfig;
    timezone?: string;
    languages?: string[];
}

// 预设配置：Windows Chrome 用户
export const WINDOWS_CHROME_CONFIG: AdvancedFingerprintConfig = {
    canvas: { enabled: true, factor: 0.01 },
    webgl: {
        enabled: true,
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        unmaskedVendor: 'NVIDIA Corporation',
        unmaskedRenderer: 'GeForce GTX 1060/PCIe/SSE2',
    },
    audio: { enabled: true, noiseFactor: 0.0003 },
    hardware: {
        deviceMemory: 8,
        hardwareConcurrency: 8,
        maxTouchPoints: 0,
    },
    timezone: 'America/New_York',
    languages: ['en-US', 'en'],
};

// 预设配置：MacOS Safari 用户
export const MACOS_SAFARI_CONFIG: AdvancedFingerprintConfig = {
    canvas: { enabled: true, factor: 0.008 },
    webgl: {
        enabled: true,
        vendor: 'Apple Inc.',
        renderer: 'Apple M1',
    },
    audio: { enabled: true, noiseFactor: 0.0002 },
    hardware: {
        deviceMemory: 16,
        hardwareConcurrency: 8,
        maxTouchPoints: 0,
    },
    timezone: 'America/Los_Angeles',
    languages: ['en-US', 'en'],
};

// 随机配置生成器
const GPU_MODELS = [
    { vendor: 'NVIDIA Corporation', renderer: 'GeForce GTX 1080/PCIe/SSE2' },
    { vendor: 'NVIDIA Corporation', renderer: 'GeForce RTX 2070/PCIe/SSE2' },
    { vendor: 'NVIDIA Corporation', renderer: 'GeForce RTX 3060/PCIe/SSE2' },
    { vendor: 'AMD', renderer: 'AMD Radeon RX 580 Series' },
    { vendor: 'AMD', renderer: 'AMD Radeon RX 6700 XT' },
    { vendor: 'Intel', renderer: 'Intel(R) UHD Graphics 630' },
    { vendor: 'Intel', renderer: 'Intel(R) Iris(R) Xe Graphics' },
];

const TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Denver',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
];

export function generateRandomConfig(): AdvancedFingerprintConfig {
    const gpu = GPU_MODELS[Math.floor(Math.random() * GPU_MODELS.length)];
    const timezone = TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)];
    const cores = [4, 6, 8, 12, 16][Math.floor(Math.random() * 5)];
    const memory = [4, 8, 16, 32][Math.floor(Math.random() * 4)];

    return {
        canvas: { enabled: true, factor: 0.005 + Math.random() * 0.01 },
        webgl: {
            enabled: true,
            vendor: `Google Inc. (${gpu.vendor})`,
            renderer: `ANGLE (${gpu.vendor}, ${gpu.renderer} Direct3D11 vs_5_0 ps_5_0, D3D11)`,
            unmaskedVendor: gpu.vendor,
            unmaskedRenderer: gpu.renderer,
        },
        audio: { enabled: true, noiseFactor: 0.0001 + Math.random() * 0.0004 },
        hardware: {
            deviceMemory: memory,
            hardwareConcurrency: cores,
            maxTouchPoints: 0,
        },
        timezone,
        languages: ['en-US', 'en'],
    };
}

/**
 * AdvancedFingerprint 类
 */
export class AdvancedFingerprint {
    private config: AdvancedFingerprintConfig;

    constructor(config?: Partial<AdvancedFingerprintConfig>) {
        this.config = config ? { ...generateRandomConfig(), ...config } : generateRandomConfig();
    }

    /**
     * 注入所有指纹伪装到页面
     */
    async inject(page: Page): Promise<void> {
        // 需要在页面加载前注入
        await page.evaluateOnNewDocument(this.getInjectionScript());
    }

    /**
     * 获取注入脚本
     */
    private getInjectionScript(): string {
        const config = this.config;

        return `
            (function() {
                'use strict';
                
                const config = ${JSON.stringify(config)};
                
                // ============ Canvas 指纹伪装 ============
                if (config.canvas.enabled) {
                    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
                    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
                    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
                    
                    // 添加噪声到像素数据
                    function addNoise(imageData, factor) {
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i += 4) {
                            // 对 RGB 通道添加微小噪声，保持 Alpha 不变
                            for (let j = 0; j < 3; j++) {
                                const noise = (Math.random() - 0.5) * 2 * factor * 255;
                                data[i + j] = Math.max(0, Math.min(255, data[i + j] + noise));
                            }
                        }
                        return imageData;
                    }
                    
                    HTMLCanvasElement.prototype.toDataURL = function(...args) {
                        const ctx = this.getContext('2d');
                        if (ctx) {
                            try {
                                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                                addNoise(imageData, config.canvas.factor);
                                ctx.putImageData(imageData, 0, 0);
                            } catch(e) {}
                        }
                        return originalToDataURL.apply(this, args);
                    };
                    
                    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
                        const imageData = originalGetImageData.apply(this, args);
                        return addNoise(imageData, config.canvas.factor);
                    };
                    
                    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
                        const ctx = this.getContext('2d');
                        if (ctx) {
                            try {
                                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                                addNoise(imageData, config.canvas.factor);
                                ctx.putImageData(imageData, 0, 0);
                            } catch(e) {}
                        }
                        return originalToBlob.call(this, callback, ...args);
                    };
                }
                
                // ============ WebGL 指纹伪装 ============
                if (config.webgl.enabled) {
                    const getParameter = WebGLRenderingContext.prototype.getParameter;
                    const getParameter2 = WebGL2RenderingContext?.prototype?.getParameter;
                    
                    function spoofGetParameter(target) {
                        return function(param) {
                            // VENDOR
                            if (param === 0x1F00) return config.webgl.vendor;
                            // RENDERER  
                            if (param === 0x1F01) return config.webgl.renderer;
                            
                            // UNMASKED_VENDOR_WEBGL
                            if (param === 0x9245) return config.webgl.unmaskedVendor || config.webgl.vendor;
                            // UNMASKED_RENDERER_WEBGL
                            if (param === 0x9246) return config.webgl.unmaskedRenderer || config.webgl.renderer;
                            
                            return getParameter.apply(this, arguments);
                        };
                    }
                    
                    WebGLRenderingContext.prototype.getParameter = spoofGetParameter(WebGLRenderingContext);
                    if (WebGL2RenderingContext) {
                        WebGL2RenderingContext.prototype.getParameter = spoofGetParameter(WebGL2RenderingContext);
                    }
                    
                    // 伪装 getExtension
                    const originalGetExtension = WebGLRenderingContext.prototype.getExtension;
                    WebGLRenderingContext.prototype.getExtension = function(name) {
                        if (name === 'WEBGL_debug_renderer_info') {
                            return {
                                UNMASKED_VENDOR_WEBGL: 0x9245,
                                UNMASKED_RENDERER_WEBGL: 0x9246,
                            };
                        }
                        return originalGetExtension.apply(this, arguments);
                    };
                }
                
                // ============ 音频指纹伪装 ============
                if (config.audio.enabled && window.AudioContext) {
                    const OriginalAudioContext = window.AudioContext;
                    const OriginalOfflineAudioContext = window.OfflineAudioContext;
                    
                    // 包装 AudioContext
                    window.AudioContext = function(...args) {
                        const ctx = new OriginalAudioContext(...args);
                        
                        const originalCreateOscillator = ctx.createOscillator.bind(ctx);
                        const originalCreateDynamicsCompressor = ctx.createDynamicsCompressor.bind(ctx);
                        
                        // 添加微小噪声到音频处理
                        ctx.createOscillator = function() {
                            const osc = originalCreateOscillator();
                            const originalFrequency = osc.frequency.value;
                            osc.frequency.value = originalFrequency + (Math.random() - 0.5) * config.audio.noiseFactor;
                            return osc;
                        };
                        
                        ctx.createDynamicsCompressor = function() {
                            const compressor = originalCreateDynamicsCompressor();
                            const originalThreshold = compressor.threshold.value;
                            compressor.threshold.value = originalThreshold + (Math.random() - 0.5) * config.audio.noiseFactor * 10;
                            return compressor;
                        };
                        
                        return ctx;
                    };
                    window.AudioContext.prototype = OriginalAudioContext.prototype;
                    
                    // 包装 OfflineAudioContext
                    if (OriginalOfflineAudioContext) {
                        window.OfflineAudioContext = function(...args) {
                            const ctx = new OriginalOfflineAudioContext(...args);
                            
                            const originalRenderBuffer = ctx.startRendering.bind(ctx);
                            ctx.startRendering = function() {
                                return originalRenderBuffer().then(buffer => {
                                    // 向音频缓冲区添加微小噪声
                                    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                                        const data = buffer.getChannelData(channel);
                                        for (let i = 0; i < data.length; i++) {
                                            data[i] += (Math.random() - 0.5) * config.audio.noiseFactor;
                                        }
                                    }
                                    return buffer;
                                });
                            };
                            
                            return ctx;
                        };
                        window.OfflineAudioContext.prototype = OriginalOfflineAudioContext.prototype;
                    }
                }
                
                // ============ 硬件信息伪装 ============
                if (config.hardware) {
                    if (config.hardware.deviceMemory !== undefined) {
                        Object.defineProperty(navigator, 'deviceMemory', {
                            get: () => config.hardware.deviceMemory,
                            configurable: true
                        });
                    }
                    
                    if (config.hardware.hardwareConcurrency !== undefined) {
                        Object.defineProperty(navigator, 'hardwareConcurrency', {
                            get: () => config.hardware.hardwareConcurrency,
                            configurable: true
                        });
                    }
                    
                    if (config.hardware.maxTouchPoints !== undefined) {
                        Object.defineProperty(navigator, 'maxTouchPoints', {
                            get: () => config.hardware.maxTouchPoints,
                            configurable: true
                        });
                    }
                }
                
                // ============ 时区伪装 ============
                if (config.timezone) {
                    const originalDateTimeFormat = Intl.DateTimeFormat;
                    Intl.DateTimeFormat = function(locales, options) {
                        options = options || {};
                        options.timeZone = options.timeZone || config.timezone;
                        return new originalDateTimeFormat(locales, options);
                    };
                    Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
                    
                    // 伪装 resolvedOptions
                    const originalResolvedOptions = originalDateTimeFormat.prototype.resolvedOptions;
                    Intl.DateTimeFormat.prototype.resolvedOptions = function() {
                        const result = originalResolvedOptions.call(this);
                        result.timeZone = config.timezone;
                        return result;
                    };
                    
                    // 伪装 Date.prototype.getTimezoneOffset
                    const timezoneOffsets = {
                        'America/New_York': 300,
                        'America/Chicago': 360,
                        'America/Denver': 420,
                        'America/Los_Angeles': 480,
                        'Europe/London': 0,
                        'Europe/Paris': -60,
                        'Asia/Tokyo': -540,
                    };
                    
                    if (timezoneOffsets[config.timezone] !== undefined) {
                        Date.prototype.getTimezoneOffset = function() {
                            return timezoneOffsets[config.timezone];
                        };
                    }
                }
                
                // ============ 语言伪装 ============
                if (config.languages && config.languages.length > 0) {
                    Object.defineProperty(navigator, 'languages', {
                        get: () => config.languages,
                        configurable: true
                    });
                    
                    Object.defineProperty(navigator, 'language', {
                        get: () => config.languages[0],
                        configurable: true
                    });
                }
                
                // ============ 其他反检测措施 ============
                
                // 隐藏 webdriver 属性
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false,
                    configurable: true
                });
                
                // 伪装 plugins 数组（非空）
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        const plugins = [
                            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                            { name: 'Native Client', filename: 'internal-nacl-plugin' },
                        ];
                        const pluginArray = Object.create(PluginArray.prototype);
                        plugins.forEach((p, i) => {
                            const plugin = Object.create(Plugin.prototype);
                            Object.defineProperty(plugin, 'name', { get: () => p.name });
                            Object.defineProperty(plugin, 'filename', { get: () => p.filename });
                            Object.defineProperty(plugin, 'description', { get: () => '' });
                            Object.defineProperty(plugin, 'length', { get: () => 0 });
                            pluginArray[i] = plugin;
                        });
                        Object.defineProperty(pluginArray, 'length', { get: () => plugins.length });
                        return pluginArray;
                    },
                    configurable: true
                });
                
                // 修复 chrome 对象（Puppeteer 检测）
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {},
                    csi: function() {},
                    app: {},
                };
                
                // 移除 Puppeteer 的痕迹
                delete window.Puppeteer;
                delete window.__puppeteer_evaluation_script__;
                
                console.log('[AdvancedFingerprint] Injected successfully');
            })();
        `;
    }

    /**
     * 更新配置
     */
    setConfig(config: Partial<AdvancedFingerprintConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 获取当前配置
     */
    getConfig(): AdvancedFingerprintConfig {
        return { ...this.config };
    }

    /**
     * 重新生成随机配置
     */
    regenerate(): void {
        this.config = generateRandomConfig();
    }
}

// 导出默认实例
export const advancedFingerprint = new AdvancedFingerprint();
