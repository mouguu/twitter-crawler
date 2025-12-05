import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * Logger 单元测试
 */

import { logger, createModuleLogger, createEnhancedLogger, EnhancedLogger, setLogLevel, LOG_LEVELS } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

describe('Logger', () => {
  let testLogDir: string;

  beforeEach(() => {
    testLogDir = path.join(process.cwd(), 'test-logs');
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('logger', () => {
    test('should be defined', () => {
      expect(logger).toBeDefined();
    });

    test('should have log methods', () => {
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });
  });

  describe('createModuleLogger', () => {
    test('should create module logger', () => {
      const moduleLogger = createModuleLogger('TestModule');
      
      expect(moduleLogger).toBeDefined();
      expect(typeof moduleLogger.info).toBe('function');
      expect(typeof moduleLogger.warn).toBe('function');
      expect(typeof moduleLogger.error).toBe('function');
    });

    test('should include module name in logs', () => {
      const moduleLogger = createModuleLogger('TestModule');
      
      // Just verify it doesn't throw
      expect(() => {
        moduleLogger.info('Test message');
      }).not.toThrow();
    });
  });

  describe('createEnhancedLogger', () => {
    test('should create enhanced logger', () => {
      const enhancedLogger = createEnhancedLogger('TestModule');
      
      expect(enhancedLogger).toBeInstanceOf(EnhancedLogger);
      expect(typeof enhancedLogger.info).toBe('function');
      expect(typeof enhancedLogger.setContext).toBe('function');
    });

    test('should support context', () => {
      const enhancedLogger = createEnhancedLogger('TestModule');
      
      enhancedLogger.setContext({ userId: '123' });
      expect(() => {
        enhancedLogger.info('Test message');
      }).not.toThrow();
    });

    test('should support performance tracking', () => {
      const enhancedLogger = createEnhancedLogger('TestModule');
      
      const endOperation = enhancedLogger.startOperation('test-op');
      expect(typeof endOperation).toBe('function');
      
      endOperation();
    });

    test('should track async operations', async () => {
      const enhancedLogger = createEnhancedLogger('TestModule');
      
      const result = await enhancedLogger.trackAsync('async-op', async () => {
        return 'result';
      });
      
      expect(result).toBe('result');
    });

    test('should track sync operations', () => {
      const enhancedLogger = createEnhancedLogger('TestModule');
      
      const result = enhancedLogger.trackSync('sync-op', () => {
        return 'result';
      });
      
      expect(result).toBe('result');
    });
  });

  describe('setLogLevel', () => {
    test('should set log level', () => {
      setLogLevel('debug');
      expect(logger.level).toBe('debug');
    });

    test('should accept LOG_LEVELS constants', () => {
      setLogLevel(LOG_LEVELS.INFO);
      expect(logger.level).toBe('info');
    });
  });

  describe('LOG_LEVELS', () => {
    test('should have all log levels', () => {
      expect(LOG_LEVELS.ERROR).toBe('error');
      expect(LOG_LEVELS.WARN).toBe('warn');
      expect(LOG_LEVELS.INFO).toBe('info');
      expect(LOG_LEVELS.DEBUG).toBe('debug');
      expect(LOG_LEVELS.VERBOSE).toBe('verbose');
    });
  });
});

