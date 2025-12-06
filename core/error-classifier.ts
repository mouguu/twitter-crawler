/**
 * Error Classifier
 *
 * Classifies errors into categories for better handling and logging
 */

export enum ErrorType {
  NETWORK = 'network',
  RATE_LIMIT = 'rate_limit',
  AUTH = 'auth',
  TIMEOUT = 'timeout',
  NOT_FOUND = 'not_found',
  FORBIDDEN = 'forbidden',
  PROXY = 'proxy',
  UNKNOWN = 'unknown',
}

export interface ClassifiedError {
  type: ErrorType;
  message: string;
  retryable: boolean;
  retryAfter?: number; // seconds
  shouldSwitchProxy?: boolean;
}

export function classifyError(error: any): ClassifiedError {
  // Network errors
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return {
      type: ErrorType.NETWORK,
      message: `Network error: ${error.message}`,
      retryable: true,
      shouldSwitchProxy: true,
    };
  }

  // Timeout errors
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return {
      type: ErrorType.TIMEOUT,
      message: `Request timeout: ${error.message}`,
      retryable: true,
      shouldSwitchProxy: true,
    };
  }

  // Rate limit
  if (error.response?.status === 429) {
    const retryAfter = parseInt(error.response.headers['retry-after'] || '60', 10);
    return {
      type: ErrorType.RATE_LIMIT,
      message: `Rate limited: ${error.message}`,
      retryable: true,
      retryAfter,
      shouldSwitchProxy: false,
    };
  }

  // Authentication errors
  if (error.response?.status === 401 || error.response?.status === 407) {
    return {
      type: ErrorType.AUTH,
      message: `Authentication failed: ${error.message}`,
      retryable: false,
      shouldSwitchProxy: true,
    };
  }

  // Proxy errors
  if (error.response?.status === 407) {
    return {
      type: ErrorType.PROXY,
      message: `Proxy authentication required: ${error.message}`,
      retryable: true,
      shouldSwitchProxy: true,
    };
  }

  // Not found
  if (error.response?.status === 404) {
    return {
      type: ErrorType.NOT_FOUND,
      message: `Resource not found: ${error.message}`,
      retryable: false,
      shouldSwitchProxy: false,
    };
  }

  // Forbidden
  if (error.response?.status === 403) {
    return {
      type: ErrorType.FORBIDDEN,
      message: `Access forbidden: ${error.message}`,
      retryable: false,
      shouldSwitchProxy: true,
    };
  }

  // Cancelled/Aborted
  if (error.name === 'AbortError' || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
    return {
      type: ErrorType.UNKNOWN,
      message: `Request cancelled: ${error.message}`,
      retryable: true,
      shouldSwitchProxy: false,
    };
  }

  // Unknown
  return {
    type: ErrorType.UNKNOWN,
    message: error.message || 'Unknown error',
    retryable: false,
    shouldSwitchProxy: false,
  };
}


