/**
 * Error Type Definitions
 * 
 * Defines all error types and interfaces for the application
 */

export enum ErrorType {
    NETWORK = 'network',
    AUTH = 'auth',
    RATE_LIMIT = 'rate_limit',
    CONFIG = 'config',
    VALIDATION = 'validation',
    UNKNOWN = 'unknown'
}

export interface AppError {
    type: ErrorType;
    message: string;
    details?: string;
    timestamp: Date;
    suggestion?: string;
    canRetry: boolean;
    technicalMessage?: string; // Original error message for debugging
}

/**
 * Error category information for UI display
 */
export interface ErrorCategory {
    icon: string;
    color: string;
    bgColor: string;
    borderColor: string;
}

export const ERROR_CATEGORIES: Record<ErrorType, ErrorCategory> = {
    [ErrorType.NETWORK]: {
        icon: '📡',
        color: 'text-blue-700',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200'
    },
    [ErrorType.AUTH]: {
        icon: '🔐',
        color: 'text-red-700',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200'
    },
    [ErrorType.RATE_LIMIT]: {
        icon: '⏱️',
        color: 'text-yellow-700',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200'
    },
    [ErrorType.CONFIG]: {
        icon: '⚙️',
        color: 'text-purple-700',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200'
    },
    [ErrorType.VALIDATION]: {
        icon: '⚠️',
        color: 'text-orange-700',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200'
    },
    [ErrorType.UNKNOWN]: {
        icon: '❌',
        color: 'text-gray-700',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200'
    }
};
