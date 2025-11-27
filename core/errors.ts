/**
 * 统一的错误类型定义
 * 所有模块应使用此类型，确保错误处理的一致性
 */

/**
 * 错误代码枚举
 */
export enum ScraperErrorCode {
    // 认证相关
    AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
    COOKIE_LOAD_FAILED = 'COOKIE_LOAD_FAILED',
    SESSION_INVALID = 'SESSION_INVALID',
    
    // API 相关
    API_REQUEST_FAILED = 'API_REQUEST_FAILED',
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    API_CLIENT_NOT_INITIALIZED = 'API_CLIENT_NOT_INITIALIZED',
    
    // 浏览器相关
    BROWSER_NOT_INITIALIZED = 'BROWSER_NOT_INITIALIZED',
    PAGE_NOT_AVAILABLE = 'PAGE_NOT_AVAILABLE',
    NAVIGATION_FAILED = 'NAVIGATION_FAILED',
    
    // 数据提取相关
    DATA_EXTRACTION_FAILED = 'DATA_EXTRACTION_FAILED',
    USER_NOT_FOUND = 'USER_NOT_FOUND',
    TWEET_NOT_FOUND = 'TWEET_NOT_FOUND',
    
    // 配置相关
    INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
    MISSING_REQUIRED_PARAMETER = 'MISSING_REQUIRED_PARAMETER',
    
    // 通用错误
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    OPERATION_CANCELLED = 'OPERATION_CANCELLED'
}

/**
 * 标准错误类
 */
export class ScraperError extends Error {
    public readonly code: ScraperErrorCode;
    public readonly statusCode?: number;
    public readonly context?: Record<string, any>;

    constructor(
        code: ScraperErrorCode,
        message: string,
        options?: {
            statusCode?: number;
            context?: Record<string, any>;
            cause?: Error;
        }
    ) {
        super(message);
        this.name = 'ScraperError';
        this.code = code;
        this.statusCode = options?.statusCode;
        this.context = options?.context;
        
        // Store cause for error chaining (if supported)
        if (options?.cause && 'cause' in Error.prototype) {
            (this as any).cause = options.cause;
        }

        // 保持堆栈跟踪
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ScraperError);
        }
    }

    /**
     * 转换为 JSON 格式（用于日志和 API 响应）
     */
    toJSON(): {
        code: string;
        message: string;
        statusCode?: number;
        context?: Record<string, any>;
    } {
        return {
            code: this.code,
            message: this.message,
            ...(this.statusCode && { statusCode: this.statusCode }),
            ...(this.context && { context: this.context })
        };
    }

    /**
     * 检查是否为可恢复的错误
     */
    isRecoverable(): boolean {
        return [
            ScraperErrorCode.RATE_LIMIT_EXCEEDED,
            ScraperErrorCode.API_REQUEST_FAILED,
            ScraperErrorCode.NAVIGATION_FAILED
        ].includes(this.code);
    }
}

/**
 * 错误工厂函数
 */
export const ScraperErrors = {
    authenticationFailed: (message: string = 'Authentication failed', statusCode?: number) =>
        new ScraperError(ScraperErrorCode.AUTHENTICATION_FAILED, message, { statusCode }),
    
    cookieLoadFailed: (message: string = 'Failed to load cookies', cause?: Error) =>
        new ScraperError(ScraperErrorCode.COOKIE_LOAD_FAILED, message, { cause }),
    
    rateLimitExceeded: (message: string = 'Rate limit exceeded') =>
        new ScraperError(ScraperErrorCode.RATE_LIMIT_EXCEEDED, message, { statusCode: 429 }),
    
    apiRequestFailed: (message: string, statusCode?: number, context?: Record<string, any>) =>
        new ScraperError(ScraperErrorCode.API_REQUEST_FAILED, message, { statusCode, context }),
    
    apiClientNotInitialized: () =>
        new ScraperError(ScraperErrorCode.API_CLIENT_NOT_INITIALIZED, 'API Client not initialized'),
    
    browserNotInitialized: () =>
        new ScraperError(ScraperErrorCode.BROWSER_NOT_INITIALIZED, 'Browser not initialized'),
    
    pageNotAvailable: () =>
        new ScraperError(ScraperErrorCode.PAGE_NOT_AVAILABLE, 'Page not available'),
    
    navigationFailed: (url: string, cause?: Error) =>
        new ScraperError(ScraperErrorCode.NAVIGATION_FAILED, `Navigation failed: ${url}`, { context: { url }, cause }),
    
    dataExtractionFailed: (message: string, context?: Record<string, any>) =>
        new ScraperError(ScraperErrorCode.DATA_EXTRACTION_FAILED, message, { context }),
    
    userNotFound: (username: string) =>
        new ScraperError(ScraperErrorCode.USER_NOT_FOUND, `User not found: ${username}`, { context: { username } }),
    
    tweetNotFound: (tweetId: string) =>
        new ScraperError(ScraperErrorCode.TWEET_NOT_FOUND, `Tweet not found: ${tweetId}`, { context: { tweetId } }),
    
    invalidConfiguration: (message: string, context?: Record<string, any>) =>
        new ScraperError(ScraperErrorCode.INVALID_CONFIGURATION, message, { context }),
    
    missingRequiredParameter: (paramName: string) =>
        new ScraperError(ScraperErrorCode.MISSING_REQUIRED_PARAMETER, `Missing required parameter: ${paramName}`, { context: { paramName } }),
    
    operationCancelled: () =>
        new ScraperError(ScraperErrorCode.OPERATION_CANCELLED, 'Operation cancelled by user'),
    
    unknown: (message: string, cause?: Error) =>
        new ScraperError(ScraperErrorCode.UNKNOWN_ERROR, message, { cause })
};

/**
 * 错误结果类型（用于统一返回格式）
 * 
 * 注意：当前代码库中实际使用的是特定结果类型（如 ScrapeTimelineResult, ScrapeThreadResult），
 * 这些类型包含 success 字段和特定数据字段（tweets, runContext 等）。
 * 此处的 Result/ErrorResult/SuccessResult 类型保留为未来统一错误处理的备选方案。
 */
export interface ErrorResult {
    success: false;
    error: string;
    code?: ScraperErrorCode;
    statusCode?: number;
    context?: Record<string, any>;
}

/**
 * 成功结果类型
 */
export interface SuccessResult<T = any> {
    success: true;
    data: T;
}

/**
 * 统一结果类型
 */
export type Result<T = any> = SuccessResult<T> | ErrorResult;

/**
 * 将错误转换为统一的结果格式
 */
export function errorToResult(error: Error | ScraperError): ErrorResult {
    if (error instanceof ScraperError) {
        return {
            success: false,
            error: error.message,
            code: error.code,
            statusCode: error.statusCode,
            context: error.context
        };
    }
    
    return {
        success: false,
        error: error.message || 'Unknown error',
        code: ScraperErrorCode.UNKNOWN_ERROR
    };
}

/**
 * 创建成功结果
 */
export function successResult<T>(data: T): SuccessResult<T> {
    return {
        success: true,
        data
    };
}

