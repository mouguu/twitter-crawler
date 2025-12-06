/**
 * SessionManager Tests
 * Mocks Prisma to test logic without DB
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionManager } from '../../core/session-manager';

// Mock Prisma Client
class MockPrismaClient {
  store: Map<string, any> = new Map();

  cookieSession = {
    upsert: async (args: any) => {
      const id = args.where.platform_username ? args.where.platform_username.username : 'new-id';
      const data = { 
        id, 
        errorCount: 0,
        ...args.create, 
        ...args.update,
        cookies: args.create?.cookies || args.update?.cookies || [] 
      };
      this.store.set(id, data);
      return data;
    },
    findFirst: async (args: any) => {
      // Simple mock implementation
      if (args?.where?.id) {
         return this.store.get(args.where.id) || null;
      }
      // Return first valid session
      for (const val of this.store.values()) {
        if (val.isValid) return val;
      }
      return null;
    },
    findUnique: async (args: any) => {
      return this.store.get(args.where.id) || null;
    },
    update: async (args: any) => {
      const item = this.store.get(args.where.id);
      if (!item) throw new Error('Not found');
      const updated = { ...item, ...args.data };
      this.store.set(args.where.id, updated);
      return updated;
    },
    findMany: async (args: any) => {
        return Array.from(this.store.values()).filter(s => s.isValid);
    },
    count: async (args: any) => {
        return Array.from(this.store.values()).filter(s => s.isValid).length;
    }
  };
}

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let testCookieDir: string;
  let mockPrisma: MockPrismaClient;

  beforeEach(() => {
    testCookieDir = path.join(os.tmpdir(), `test-cookies-${Date.now()}`);
    if(!fs.existsSync(testCookieDir)) fs.mkdirSync(testCookieDir, { recursive: true });
    
    mockPrisma = new MockPrismaClient();
    sessionManager = new SessionManager(testCookieDir, 3, undefined, mockPrisma);
  });

  afterEach(() => {
    try {
      fs.rmSync(testCookieDir, { recursive: true, force: true });
    } catch (_error) {}
  });

  function createMockCookieFile(filename: string) {
    const cookieData = [{ name: 'auth_token', value: 'test123', domain: '.twitter.com', path: '/' }]; // Array!
    fs.writeFileSync(path.join(testCookieDir, filename), JSON.stringify(cookieData));
  }

  describe('init', () => {
    test('should load sessions from cookie files into DB', async () => {
      createMockCookieFile('session1.json');
      createMockCookieFile('session2.json');

      await sessionManager.init();

      expect(await sessionManager.hasActiveSession()).toBe(true);
      expect(await sessionManager.getSessionById('session1')).toBeDefined();
      expect(await sessionManager.getSessionById('session2')).toBeDefined();
    });

    test('should handle new directory gracefully', async () => {
      const newDir = path.join(testCookieDir, 'new-dir');
      const manager = new SessionManager(newDir, 3, undefined, mockPrisma);
      await manager.init();
      expect(await manager.hasActiveSession()).toBe(false);
    });
  });

  describe('getNextSession', () => {
    beforeEach(async () => {
      createMockCookieFile('s1.json');
      createMockCookieFile('s2.json');
      await sessionManager.init();
    });

    test('should return a session', async () => {
      const session = await sessionManager.getNextSession();
      expect(session).toBeDefined();
      if (session) {
        expect(['s1', 's2']).toContain(session.id);
      }
    });

    test('should prioritize preferred session', async () => {
      const session = await sessionManager.getNextSession('s2');
      expect(session?.id).toBe('s2');
    });

    test('should prioritise valid sessions', async () => {
        // retire s1 manually in mock
        const s1 = mockPrisma.store.get('s1');
        if(s1) { s1.isValid = false; mockPrisma.store.set('s1', s1); }

        const session = await sessionManager.getNextSession();
        expect(session?.id).toBe('s2');
    });
  });

  describe('Session Health', () => {
    beforeEach(async () => {
      createMockCookieFile('s1.json');
      await sessionManager.init();
    });

    test('should retire session after max errors', async () => {
      // Mock expects explicit retire call logic or markBad implementation
      // markBad calls retire if >= 10
      for (let i = 0; i < 10; i++) {
        await sessionManager.markBad('s1');
      }

      const s1 = await sessionManager.getSessionById('s1');
      expect(s1?.isRetired).toBe(true);
      expect(await sessionManager.hasActiveSession()).toBe(false);
    });

    test('should increment error count on markBad', async () => {
        await sessionManager.markBad('s1');
        const s1 = await sessionManager.getSessionById('s1');
        expect(s1?.errorCount).toBe(1);
    });
  });
});
