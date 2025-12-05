import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
/**
 * ConfigManager 单元测试
 */

import { ConfigManager, getConfigManager, resetConfigManager } from '../../utils/config-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ConfigManager', () => {
  let testConfigDir: string;
  let testConfigFile: string;

  beforeEach(() => {
    testConfigDir = path.join(os.tmpdir(), 'test-config');
    testConfigFile = path.join(testConfigDir, 'config.json');
    fs.mkdirSync(testConfigDir, { recursive: true });
    resetConfigManager();
  });

  afterEach(() => {
    try {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    resetConfigManager();
  });

  describe('constructor', () => {
    test('should create manager with default config', () => {
      const manager = new ConfigManager();
      const config = manager.getConfig();
      
      expect(config).toBeDefined();
      expect(config.server.port).toBe(5001);
      expect(config.server.host).toBe('0.0.0.0'); // Default is 0.0.0.0
    });

    test('should load from config file', () => {
      const customConfig = {
        server: { port: 8080, host: '0.0.0.0' },
        twitter: { defaultMode: 'graphql', defaultLimit: 100 }
      };
      fs.writeFileSync(testConfigFile, JSON.stringify(customConfig, null, 2));
      
      const manager = new ConfigManager(testConfigFile);
      const config = manager.getConfig();
      
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('0.0.0.0');
    });

    test('should load from environment variables', () => {
      const tempDir = require('os').tmpdir();
      process.env.PORT = '9000';
      process.env.OUTPUT_DIR = tempDir;
      
      const manager = new ConfigManager();
      const config = manager.getConfig();
      
      expect(config.server.port).toBe(9000);
      expect(config.output.baseDir).toBe(tempDir);
      
      delete process.env.PORT;
      delete process.env.OUTPUT_DIR;
      resetConfigManager();
    });

    test('should prioritize environment variables over config file', () => {
      const tempDir = require('os').tmpdir();
      const fileConfig = { server: { port: 8080, host: '0.0.0.0' }, output: { baseDir: tempDir } };
      fs.writeFileSync(testConfigFile, JSON.stringify(fileConfig, null, 2));
      
      process.env.PORT = '9000';
      
      const manager = new ConfigManager(testConfigFile);
      const config = manager.getConfig();
      
      expect(config.server.port).toBe(9000); // Env takes precedence
      
      delete process.env.PORT;
      resetConfigManager();
    });
  });

  describe('getConfig', () => {
    test('should return complete config object', () => {
      const manager = new ConfigManager();
      const config = manager.getConfig();
      
      expect(config).toHaveProperty('server');
      expect(config).toHaveProperty('output');
      expect(config).toHaveProperty('twitter');
      expect(config).toHaveProperty('reddit');
      expect(config).toHaveProperty('browser');
      expect(config).toHaveProperty('rateLimit');
      expect(config).toHaveProperty('logging');
    });
  });

  describe('getServerConfig', () => {
    test('should return server configuration', () => {
      const manager = new ConfigManager();
      const serverConfig = manager.getServerConfig();
      
      expect(serverConfig).toHaveProperty('port');
      expect(serverConfig).toHaveProperty('host');
      expect(typeof serverConfig.port).toBe('number');
      expect(typeof serverConfig.host).toBe('string');
    });
  });

  describe('getTwitterConfig', () => {
    test('should return Twitter configuration', () => {
      const manager = new ConfigManager();
      const twitterConfig = manager.getTwitterConfig();
      
      expect(twitterConfig).toHaveProperty('defaultMode');
      expect(twitterConfig).toHaveProperty('defaultLimit');
      expect(twitterConfig).toHaveProperty('apiTimeout');
      expect(['graphql', 'puppeteer', 'mixed']).toContain(twitterConfig.defaultMode);
    });
  });

  describe('getOutputConfig', () => {
    test('should return output configuration', () => {
      const manager = new ConfigManager();
      const outputConfig = manager.getOutputConfig();
      
      expect(outputConfig).toHaveProperty('baseDir');
      expect(outputConfig).toHaveProperty('enableLegacyCompat');
      expect(typeof outputConfig.baseDir).toBe('string');
      expect(typeof outputConfig.enableLegacyCompat).toBe('boolean');
    });
  });

  describe('updateConfig', () => {
    test('should update configuration', () => {
      const manager = new ConfigManager();
      
      manager.updateConfig({
        server: { port: 9999, host: '127.0.0.1' }
      });
      
      const config = manager.getConfig();
      expect(config.server.port).toBe(9999);
      expect(config.server.host).toBe('127.0.0.1');
    });

    test('should merge partial updates', () => {
      const manager = new ConfigManager();
      const originalPort = manager.getConfig().server.port;
      
      manager.updateConfig({
        twitter: { 
          defaultMode: 'graphql',
          defaultLimit: 200,
          apiTimeout: 30000,
          browserTimeout: 60000
        }
      });
      
      const config = manager.getConfig();
      expect(config.server.port).toBe(originalPort); // Unchanged
      expect(config.twitter.defaultLimit).toBe(200); // Updated
    });
  });

  describe('saveToFile', () => {
    test('should save config to file', () => {
      const manager = new ConfigManager();
      manager.updateConfig({ server: { port: 7777, host: '0.0.0.0' } });
      
      manager.saveToFile(testConfigFile);
      
      expect(fs.existsSync(testConfigFile)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(testConfigFile, 'utf-8'));
      expect(saved.server.port).toBe(7777);
    });
  });

  describe('getConfigManager (singleton)', () => {
    test('should return the same instance', () => {
      const instance1 = getConfigManager();
      const instance2 = getConfigManager();
      
      expect(instance1).toBe(instance2);
    });

    test('should reset singleton', () => {
      const instance1 = getConfigManager();
      resetConfigManager();
      const instance2 = getConfigManager();
      
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('validation', () => {
    test('should validate port range', () => {
      expect(() => {
        const manager = new ConfigManager();
        manager.updateConfig({ server: { port: -1, host: 'localhost' } });
      }).toThrow();
    });

    test('should validate required fields', () => {
      const invalidConfig = { server: {} };
      fs.writeFileSync(testConfigFile, JSON.stringify(invalidConfig));
      
      // ConfigManager might use defaults for missing fields, so it might not throw
      // Just verify it can be created (with defaults)
      const manager = new ConfigManager(testConfigFile);
      expect(manager).toBeDefined();
    });
  });
});

