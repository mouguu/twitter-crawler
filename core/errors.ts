/**
 * Error handling module for XRCrawler
 * Defines error types, codes, and classification logic
 */

/**
 * Standard error codes for the scraper
 */
export enum ErrorCode {
  // Network Errors
  NETWORK_ERROR = "NETWORK_ERROR",
  CONNECTION_REFUSED = "CONNECTION_REFUSED",
  TIMEOUT = "TIMEOUT",
  DNS_ERROR = "DNS_ERROR",
  
  // Authentication Errors
  AUTH_FAILED = "AUTH_FAILED",
  LOGIN_REQUIRED = "LOGIN_REQUIRED",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED",
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  THROTTLED = "THROTTLED",
  
  // API Errors
  API_ERROR = "API_ERROR",
  INVALID_RESPONSE = "INVALID_RESPONSE",
  BAD_REQUEST = "BAD_REQUEST",
  NOT_FOUND = "NOT_FOUND",
  SERVER_ERROR = "SERVER_ERROR",
  
  // Browser/Puppeteer Errors
  BROWSER_CRASHED = "BROWSER_CRASHED",
  BROWSER_ERROR = "BROWSER_CRASHED", // Alias for BROWSER_CRASHED
  NAVIGATION_FAILED = "NAVIGATION_FAILED",
  SELECTOR_TIMEOUT = "SELECTOR_TIMEOUT",
  ELEMENT_NOT_FOUND = "ELEMENT_NOT_FOUND",
  
  // Data Extraction Errors
  DATA_EXTRACTION_FAILED = "DATA_EXTRACTION_FAILED",
  PARSING_ERROR = "PARSING_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  
  // System Errors
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  CONFIG_ERROR = "CONFIG_ERROR",
  FILE_SYSTEM_ERROR = "FILE_SYSTEM_ERROR",
  
  // Backward compatibility aliases
  RATE_LIMIT = "RATE_LIMIT_EXCEEDED", // Alias for RATE_LIMIT_EXCEEDED
  INVALID_CONFIG = "CONFIG_ERROR", // Alias for CONFIG_ERROR
}

/**
 * Context information for errors
 */
export interface ErrorContext {
  url?: string;
  username?: string;
  tweetId?: string;
  operation?: string;
  statusCode?: number;
  retryCount?: number;
  [key: string]: any;
}

/**
 * Custom error class for scraper errors
 */
export class ScraperError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly originalError?: Error;
  public readonly statusCode?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      context?: ErrorContext;
      originalError?: Error;
      statusCode?: number;
    } = {}
  ) {
    super(message);
    this.name = "ScraperError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.context = options.context || {};
    this.timestamp = new Date();
    this.originalError = options.originalError;
    this.statusCode = options.statusCode;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScraperError);
    }
  }

  /**
   * Check if the error is recoverable
   */
  public isRecoverable(): boolean {
    return this.retryable;
  }

  /**
   * Get a user-friendly error message
   */
  public getUserMessage(): string {
    switch (this.code) {
      case ErrorCode.RATE_LIMIT_EXCEEDED:
        return "Rate limit exceeded. Waiting before retrying...";
      case ErrorCode.AUTH_FAILED:
        return "Authentication failed. Please check your credentials.";
      case ErrorCode.NETWORK_ERROR:
        return "Network error. Please check your internet connection.";
      case ErrorCode.TIMEOUT:
        return "Operation timed out.";
      case ErrorCode.NOT_FOUND:
        return "Resource not found.";
      default:
        return this.message;
    }
  }

  /**
   * Convert error to JSON object
   */
  public toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
            stack: this.originalError.stack,
           }
        : undefined,
    };
  }

  /**
   * Create ScraperError from HTTP response (backward compatibility)
   */
  public static fromHttpResponse(
    response: { status: number; statusText?: string },
    context?: ErrorContext
  ): ScraperError {
    const statusCode = response.status;
    const statusText = response.statusText || String(statusCode);
    
    if (statusCode === 429) {
      return new ScraperError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Rate limit exceeded: ${statusText}`,
        { retryable: true, statusCode, context }
      );
    }
    
    if (statusCode === 401 || statusCode === 403) {
      return new ScraperError(
        ErrorCode.AUTH_FAILED,
        `Authentication failed: ${statusText}`,
        { retryable: false, statusCode, context }
      );
    }
    
    if (statusCode >= 500) {
      return new ScraperError(
        ErrorCode.SERVER_ERROR,
        `Server error: ${statusText}`,
        { retryable: true, statusCode, context }
      );
    }
    
    return new ScraperError(
      ErrorCode.API_ERROR,
      `HTTP ${statusCode}: ${statusText}`,
      { retryable: false, statusCode, context }
    );
  }

  /**
   * Create ScraperError from native Error (backward compatibility)
   */
  public static fromError(
    error: Error,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    retryable: boolean = false,
    context?: ErrorContext
  ): ScraperError {
    return new ScraperError(code, error.message, {
      retryable,
      originalError: error,
      context,
    });
  }

  /**
   * Check if error is a rate limit error
   */
  public static isRateLimitError(error: unknown): boolean {
    if (error instanceof ScraperError) {
      return error.code === ErrorCode.RATE_LIMIT_EXCEEDED;
    }
    if (error instanceof Error) {
      return ErrorClassifier.isRateLimit(error);
    }
    return false;
  }

  /**
   * Check if error is an auth error
   */
  public static isAuthError(error: unknown): boolean {
    if (error instanceof ScraperError) {
      return error.code === ErrorCode.AUTH_FAILED ||
             error.code === ErrorCode.LOGIN_REQUIRED ||
             error.code === ErrorCode.SESSION_EXPIRED ||
             error.code === ErrorCode.ACCOUNT_LOCKED ||
             error.code === ErrorCode.ACCOUNT_SUSPENDED;
    }
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      return lower.includes('auth') || lower.includes('login') ||
             lower.includes('unauthorized') || lower.includes('401') || lower.includes('403');
    }
    return false;
  }

  /**
   * Check if error is a network error
   */
  public static isNetworkError(error: unknown): boolean {
    if (error instanceof ScraperError) {
      return error.code === ErrorCode.NETWORK_ERROR ||
             error.code === ErrorCode.CONNECTION_REFUSED ||
             error.code === ErrorCode.TIMEOUT ||
             error.code === ErrorCode.DNS_ERROR;
    }
    if (error instanceof Error) {
      return ErrorClassifier.isNetworkError(error);
    }
    return false;
  }
}

/**
 * Result types for backward compatibility
 */
export interface SuccessResult<T> {
  success: true;
  data: T;
}

export interface ErrorResult {
  success: false;
  error: string;
  code?: ErrorCode;
  retryable?: boolean;
}

export type Result<T> = SuccessResult<T> | ErrorResult;

/**
 * Helper to create success result
 */
export function successResult<T>(data: T): SuccessResult<T> {
  return { success: true, data };
}

/**
 * Helper to create error result from error
 */
export function errorToResult(error: unknown): ErrorResult {
  const scraperError = ErrorClassifier.classify(error);
  return {
    success: false,
    error: scraperError.getUserMessage(),
    code: scraperError.code,
    retryable: scraperError.retryable,
  };
}

/**
 * Factory for creating common errors
 */
export const ScraperErrors = {
  NetworkError: (message: string, context?: ErrorContext, originalError?: Error) =>
    new ScraperError(ErrorCode.NETWORK_ERROR, message, {
      retryable: true,
      context,
      originalError,
    }),

  RateLimitError: (message: string = "Rate limit exceeded", context?: ErrorContext) =>
    new ScraperError(ErrorCode.RATE_LIMIT_EXCEEDED, message, {
      retryable: true,
      context,
    }),

  AuthError: (message: string, context?: ErrorContext) =>
    new ScraperError(ErrorCode.AUTH_FAILED, message, {
      retryable: false,
      context,
    }),

  TimeoutError: (message: string, context?: ErrorContext) =>
    new ScraperError(ErrorCode.TIMEOUT, message, {
      retryable: true,
      context,
    }),

  BrowserError: (message: string, context?: ErrorContext, originalError?: Error) =>
    new ScraperError(ErrorCode.BROWSER_CRASHED, message, {
      retryable: true,
      context,
      originalError,
    }),
    
  DataError: (message: string, context?: ErrorContext) =>
    new ScraperError(ErrorCode.DATA_EXTRACTION_FAILED, message, {
      retryable: false,
      context,
    }),
    
  ApiError: (message: string, statusCode?: number, context?: ErrorContext) =>
    new ScraperError(ErrorCode.API_ERROR, message, {
      retryable: statusCode ? [429, 500, 502, 503, 504].includes(statusCode) : true,
      statusCode,
      context,
    }),

  apiClientNotInitialized: () =>
    new ScraperError(ErrorCode.INTERNAL_ERROR, "API Client not initialized", {
      retryable: false,
    }),

  browserNotInitialized: () =>
    new ScraperError(ErrorCode.INTERNAL_ERROR, "Browser not initialized", {
      retryable: false,
    }),

  pageNotAvailable: () =>
    new ScraperError(ErrorCode.INTERNAL_ERROR, "Page not available", {
      retryable: false,
    }),

  invalidConfiguration: (message: string, context?: ErrorContext) =>
    new ScraperError(ErrorCode.CONFIG_ERROR, message, {
      retryable: false,
      context,
    }),

  apiRequestFailed: (message: string, statusCode?: number, context?: ErrorContext) =>
    new ScraperError(ErrorCode.API_ERROR, message, {
      retryable: statusCode ? [429, 500, 502, 503, 504].includes(statusCode) : true,
      statusCode,
      context,
    }),

  rateLimitExceeded: (message: string = "Rate limit exceeded", context?: ErrorContext) =>
    new ScraperError(ErrorCode.RATE_LIMIT_EXCEEDED, message, {
      retryable: true,
      context,
    }),

  userNotFound: (username: string, context?: ErrorContext) =>
    new ScraperError(ErrorCode.NOT_FOUND, `User not found: ${username}`, {
      retryable: false,
      context: { ...context, username },
    }),

  dataExtractionFailed: (message: string, context?: ErrorContext) =>
    new ScraperError(ErrorCode.DATA_EXTRACTION_FAILED, message, {
      retryable: false,
      context,
    }),

  cookieLoadFailed: (message: string, context?: ErrorContext) =>
    new ScraperError(ErrorCode.INTERNAL_ERROR, message, {
      retryable: false,
      context,
    }),

  navigationFailed: (url: string | Error, error?: Error) =>
    typeof url === 'string'
      ? new ScraperError(ErrorCode.NAVIGATION_FAILED, `Navigation failed: ${url}`, {
          retryable: true,
          context: { url },
          originalError: error,
        })
      : new ScraperError(ErrorCode.NAVIGATION_FAILED, `Navigation failed: ${url.message}`, {
          retryable: true,
          originalError: url,
        }),

  authenticationFailed: (message: string, statusCode?: number, context?: ErrorContext) =>
    new ScraperError(ErrorCode.AUTH_FAILED, message, {
      retryable: false,
      statusCode,
      context,
    }),
};

/**
 * Utility to classify unknown errors
 */
export class ErrorClassifier {
  /**
   * Classify an unknown error into a ScraperError
   */
  public static classify(error: unknown, context?: ErrorContext): ScraperError {
    if (error instanceof ScraperError) {
      if (context) {
        // Merge context if provided
        Object.assign(error.context, context);
      }
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const originalError = error instanceof Error ? error : undefined;
    const lowerMessage = message.toLowerCase();

    // Rate Limiting
    if (
      lowerMessage.includes("rate limit") ||
      lowerMessage.includes("too many requests") ||
      lowerMessage.includes("429")
    ) {
      return new ScraperError(ErrorCode.RATE_LIMIT_EXCEEDED, message, {
        retryable: true,
        context,
        originalError,
      });
    }

    // Network Errors
    if (
      lowerMessage.includes("network") ||
      lowerMessage.includes("connection refused") ||
      lowerMessage.includes("econnrefused") ||
      lowerMessage.includes("socket hang up") ||
      lowerMessage.includes("fetch failed")
    ) {
      return new ScraperError(ErrorCode.NETWORK_ERROR, message, {
        retryable: true,
        context,
        originalError,
      });
    }

    // Timeouts
    if (
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("timed out")
    ) {
      return new ScraperError(ErrorCode.TIMEOUT, message, {
        retryable: true,
        context,
        originalError,
      });
    }

    // Authentication
    if (
      lowerMessage.includes("auth") ||
      lowerMessage.includes("login") ||
      lowerMessage.includes("unauthorized") ||
      lowerMessage.includes("401") ||
      lowerMessage.includes("403")
    ) {
      return new ScraperError(ErrorCode.AUTH_FAILED, message, {
        retryable: false,
        context,
        originalError,
      });
    }

    // Browser/Puppeteer
    if (
      lowerMessage.includes("puppeteer") ||
      lowerMessage.includes("chromium") ||
      lowerMessage.includes("browser") ||
      lowerMessage.includes("target closed") ||
      lowerMessage.includes("session closed")
    ) {
      return new ScraperError(ErrorCode.BROWSER_CRASHED, message, {
        retryable: true,
        context,
        originalError,
      });
    }
    
    // Navigation
    if (
      lowerMessage.includes("navigation") ||
      lowerMessage.includes("navigating")
    ) {
      return new ScraperError(ErrorCode.NAVIGATION_FAILED, message, {
        retryable: true,
        context,
        originalError,
      });
    }
    
    // Selectors
    if (
      lowerMessage.includes("selector") ||
      lowerMessage.includes("element")
    ) {
      return new ScraperError(ErrorCode.ELEMENT_NOT_FOUND, message, {
        retryable: true,
        context,
        originalError,
      });
    }

    // Default to Unknown Error
    return new ScraperError(ErrorCode.UNKNOWN_ERROR, message, {
      retryable: false,
      context,
      originalError,
    });
  }
  
  /**
   * Check if an error represents a rate limit
   */
  public static isRateLimit(error: unknown): boolean {
    const classified = this.classify(error);
    return classified.code === ErrorCode.RATE_LIMIT_EXCEEDED;
  }
  
  /**
   * Check if an error represents a network issue
   */
  public static isNetworkError(error: unknown): boolean {
    const classified = this.classify(error);
    return classified.code === ErrorCode.NETWORK_ERROR || 
           classified.code === ErrorCode.TIMEOUT ||
           classified.code === ErrorCode.DNS_ERROR ||
           classified.code === ErrorCode.CONNECTION_REFUSED;
  }
}
