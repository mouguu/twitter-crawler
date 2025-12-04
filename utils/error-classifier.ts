/**
 * Error Classification Utility
 * 
 * Classifies errors into specific types with recovery suggestions
 */

import { ErrorType, AppError } from '../types/errors';

export function classifyError(error: any): AppError {
    const errorMessage = error?.message || String(error);
    const errorString = errorMessage.toLowerCase();
    
    // Network errors
    if (
        errorString.includes('fetch') ||
        errorString.includes('network') ||
        errorString.includes('failed to fetch') ||
        errorString.includes('networkerror') ||
        errorString.includes('connection')
    ) {
        return {
            type: ErrorType.NETWORK,
            message: '网络连接失败',
            details: errorMessage,
            suggestion: '请检查网络连接后重试。如果问题持续，请检查防火墙设置。',
            canRetry: true,
            timestamp: new Date(),
            technicalMessage: errorMessage
        };
    }
    
    // Authentication/Cookie errors
    if (
        errorString.includes('cookie') ||
        errorString.includes('auth') ||
        errorString.includes('unauthorized') ||
        errorString.includes('403') ||
        errorString.includes('401') ||
        errorString.includes('session')
    ) {
        return {
            type: ErrorType.AUTH,
            message: 'Session 已过期或无效',
            details: errorMessage,
            suggestion: '请更新 cookies 文件：\n1. 导出新的 Twitter cookies\n2. 保存到 /cookies 目录\n3. 文件格式: account1.json',
            canRetry: false,
            timestamp: new Date(),
            technicalMessage: errorMessage
        };
    }
    
    // Rate limit errors
    if (
        errorString.includes('rate limit') ||
        errorString.includes('429') ||
        errorString.includes('too many requests') ||
        errorString.includes('quota')
    ) {
        return {
            type: ErrorType.RATE_LIMIT,
            message: '达到 Twitter API 速率限制',
            details: errorMessage,
            suggestion: '请等待 15-30 分钟后重试。\n提示：使用多个账号可以增加配额。',
            canRetry: true,
            timestamp: new Date(),
            technicalMessage: errorMessage
        };
    }
    
    // Configuration errors
    if (
        errorString.includes('config') ||
        errorString.includes('invalid input') ||
        errorString.includes('missing') ||
        errorString.includes('required')
    ) {
        return {
            type: ErrorType.CONFIG,
            message: '配置错误',
            details: errorMessage,
            suggestion: '请检查输入参数是否正确。确保所有必需的字段都已填写。',
            canRetry: false,
            timestamp: new Date(),
            technicalMessage: errorMessage
        };
    }
    
    // Validation errors
    if (
        errorString.includes('validation') ||
        errorString.includes('invalid') ||
        errorString.includes('format') ||
        errorString.includes('malformed')
    ) {
        return {
            type: ErrorType.VALIDATION,
            message: '输入验证失败',
            details: errorMessage,
            suggestion: '请检查输入格式是否正确。\n例如：用户名不含 @，URL 格式正确。',
            canRetry: false,
            timestamp: new Date(),
            technicalMessage: errorMessage
        };
    }
    
    // Unknown errors
    return {
        type: ErrorType.UNKNOWN,
        message: '发生未知错误',
        details: errorMessage,
        suggestion: '请刷新页面重试。如果问题持续，请查看控制台日志。',
        canRetry: true,
        timestamp: new Date(),
        technicalMessage: errorMessage
    };
}

/**
 * Format error for display
 */
export function formatErrorMessage(error: AppError): string {
    return `${error.message}${error.suggestion ? '\n\n💡 ' + error.suggestion : ''}`;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: AppError): boolean {
    return error.canRetry && [ErrorType.NETWORK, ErrorType.RATE_LIMIT, ErrorType.UNKNOWN].includes(error.type);
}
