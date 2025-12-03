/**
 * Error handling utilities for XRCrawler
 * Provides helper functions to improve error handling consistency
 */

import { ErrorClassifier, ScraperError, ErrorCode } from './errors';

/**
 * Safely handles errors with proper classification
 * @param error - The caught error (can be any type)
 * @param context - Additional context for error classification
 * @returns A properly classified ScraperError
 */
export function handleError(
  error: unknown,
  context?: Record<string, any>
): ScraperError {
  if (error instanceof ScraperError) {
    if (context && Object.keys(context).length > 0) {
      Object.assign(error.context, context);
    }
    return error;
  }

  const scraperError = ErrorClassifier.classify(error);
  
  // Add context if provided
  if (context && Object.keys(context).length > 0) {
    Object.assign(scraperError.context, context);
  }
  
  return scraperError;
}

/**
 * Wraps a function call with error handling and classification
 * @param fn - Function to execute
 * @param errorMessage - Custom error message
 * @param errorCode - Optional error code
 * @param context - Optional context
 * @returns The result of the function or throws a ScraperError
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorMessage: string,
  errorCode?: ErrorCode,
  context?: Record<string, any>
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const classifiedError = handleError(error, context);
    
    // Enhance error with custom message if provided
    if (errorMessage && !(error instanceof ScraperError)) {
      throw new ScraperError(
        errorCode || classifiedError.code,
        `${errorMessage}: ${classifiedError.message}`,
        {
          retryable: classifiedError.retryable,
          originalError: classifiedError.originalError || (error instanceof Error ? error : undefined),
          context: { ...classifiedError.context, ...context }
        }
      );
    }
    
    throw classifiedError;
  }
}

/**
 * Creates a standardized error result from any error
 * @param error - The error to convert
 * @param operation - Operation name for context
 * @returns Standardized error result
 */
export function createErrorResult(
  error: unknown,
  operation?: string
): { success: false; error: string; code?: ErrorCode; retryable?: boolean } {
  const scraperError = handleError(error, operation ? { operation } : undefined);
  
  return {
    success: false,
    error: scraperError.getUserMessage(),
    code: scraperError.code,
    retryable: scraperError.retryable,
  };
}

/**
 * Checks if an error is recoverable and should be retried
 * @param error - The error to check
 * @returns Whether the error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  const scraperError = handleError(error);
  return scraperError.isRecoverable();
}

/**
 * Logs error with proper formatting
 * @param error - The error to log
 * @param logger - Logger function (e.g., console.error, eventBus.emitError)
 */
export function logError(
  error: unknown,
  logger: (message: string, level?: string) => void = console.error
): void {
  const scraperError = handleError(error);
  logger(`[${scraperError.code}] ${scraperError.message}`, 'error');
  
  if (scraperError.originalError) {
    logger(`Original error: ${scraperError.originalError.message}`, 'debug');
  }
  
  if (Object.keys(scraperError.context).length > 0) {
    logger(`Context: ${JSON.stringify(scraperError.context, null, 2)}`, 'debug');
  }
}
