import fs from 'node:fs';
import path from 'node:path';
import { Page, Protocol } from 'puppeteer';
import { prisma } from './db/prisma';

export interface Session {
  id: string; // ID from DB (UUID)
  cookies: Protocol.Network.CookieParam[];
  usageCount: number;
  errorCount: number;
  consecutiveFailures: number;
  isRetired: boolean;
  filePath?: string; // Legacy: path to original file if needed, or informative
  username?: string | null;
  platform: 'twitter' | 'reddit';
}

/**
 * SessionManager - DB-Backed Implementation
 * manages sessions using PostgreSQL (Prisma) as the source of truth.
 * Replaces in-memory state with direct DB queries to solve "Ghost Session" issues in distributed workers.
 */
export class SessionManager {
  private cookieDir: string;
  private maxConsecutiveFailures: number;
  private eventBus: any;
  private prisma: any; // Type as PrismaClient, using any to avoid import cycles or type issues easily

  constructor(
    cookieDir: string = './cookies',
    maxConsecutiveFailures: number = 3,
    eventBus?: any,
    prismaClient: any = prisma,
  ) {
    this.cookieDir = cookieDir;
    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this.eventBus = eventBus;
    this.prisma = prismaClient;

    if (!fs.existsSync(this.cookieDir)) {
      fs.mkdirSync(this.cookieDir, { recursive: true });
    }
  }

  /**
   * Initialize SessionManager
   * Import legacy files if any. No need to load all sessions into memory anymore.
   */
  async init(): Promise<void> {
    this._log('Initializing SessionManager (DB-Direct)...');
    await this.importLegacySessions();
  }

  /**
   * Import legacy *.json files into the database
   */
  private async importLegacySessions(): Promise<void> {
    try {
      if (!fs.existsSync(this.cookieDir)) return;

      const files = fs
        .readdirSync(this.cookieDir)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));

      for (const file of files) {
        try {
          const filePath = path.join(this.cookieDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(raw);

          // Support both formats: plain array or { cookies: [...] }
          const cookies = Array.isArray(parsed) ? parsed : parsed.cookies || null;

          if (!Array.isArray(cookies)) {
            this._log(
              `Skipping invalid cookie file ${file}: not an array or object with cookies field`,
              'warn',
            );
            continue;
          }

          const label = path.basename(file, '.json');

          // Upsert to DB
          await this.prisma.cookieSession.upsert({
            where: {
              platform_username: {
                platform: 'twitter',
                username: label,
              },
            },
            update: {
              cookies: cookies as any,
              isValid: true,
              label: label,
            },
            create: {
              platform: 'twitter',
              username: label,
              label: label,
              cookies: cookies as any,
              isValid: true,
            },
          });

          this._log(`Imported legacy session to DB: ${label}`);
          fs.renameSync(filePath, `${filePath}.imported`);
        } catch (e: any) {
          this._log(`Failed to import legacy session ${file}: ${e.message}`, 'error');
        }
      }
    } catch (error) {
      this._log(`Error during legacy session import: ${error}`, 'error');
    }
  }

  /**
   * Get the next available valid session from the database.
   * If preferredId is provided, tries to get that one if valid.
   * Otherwise, gets the least recently used valid session.
   */
  async getNextSession(preferredId?: string): Promise<Session | undefined> {
    try {
      let dbSession: {
        id: string;
        cookies: unknown;
        errorCount: number;
        label: string | null;
        lastUsedAt: Date | null;
        username: string | null;
      } | null = null;

      if (preferredId) {
        dbSession = await this.prisma.cookieSession.findFirst({
          where: {
            id: preferredId,
            isValid: true,
            platform: 'twitter',
          },
        });
      }

      if (!dbSession) {
        // Find a valid session, sorted by lastUsed ASC (LRU)
        // We can also prioritize ones with fewer errors?
        dbSession = await this.prisma.cookieSession.findFirst({
          where: {
            isValid: true,
            platform: 'twitter',
          },
          orderBy: [{ lastUsed: 'asc' }],
        });
      }

      if (!dbSession) return undefined;

      // Update lastUsed to rotate
      await this.prisma.cookieSession.update({
        where: { id: dbSession.id },
        data: { lastUsed: new Date() },
      });

      return {
        id: dbSession.id,
        cookies: dbSession.cookies as any,
        usageCount: 0, // Reset for this run context
        errorCount: dbSession.errorCount,
        consecutiveFailures: 0,
        isRetired: false,
        username: dbSession.username,
        platform: 'twitter',
        filePath: dbSession.label || undefined,
      };
    } catch (error: any) {
      this._log(`Failed to get next session: ${error.message}`, 'error');
      return undefined;
    }
  }

  // Alias for backward compatibility if needed, but we prefer getNextSession
  async getSession(): Promise<Session | undefined> {
    return this.getNextSession();
  }

  /**
   * Get a specific session by ID
   */
  async getSessionById(sessionId: string): Promise<Session | undefined> {
    try {
      const dbSession = await this.prisma.cookieSession.findUnique({
        where: { id: sessionId },
      });

      if (!dbSession) return undefined;

      return {
        id: dbSession.id,
        cookies: dbSession.cookies as any,
        usageCount: 0,
        errorCount: dbSession.errorCount,
        consecutiveFailures: 0,
        isRetired: !dbSession.isValid,
        username: dbSession.username,
        platform: 'twitter',
        filePath: dbSession.label || undefined,
      };
    } catch (error: any) {
      this._log(`Failed to get session ${sessionId}: ${error.message}`, 'error');
      return undefined;
    }
  }

  /**
   * Get all active (valid) sessions from the database
   */
  async getAllActiveSessions(): Promise<Session[]> {
    try {
      const dbSessions = await this.prisma.cookieSession.findMany({
        where: {
          isValid: true,
          platform: 'twitter',
        },
        orderBy: { lastUsed: 'asc' },
      });

      return dbSessions.map((dbSession: any) => ({
        id: dbSession.id,
        cookies: dbSession.cookies as any,
        usageCount: 0,
        errorCount: dbSession.errorCount,
        consecutiveFailures: 0,
        isRetired: false,
        username: dbSession.username,
        platform: 'twitter',
        filePath: dbSession.label || undefined,
      }));
    } catch (error: any) {
      this._log(`Failed to get all active sessions: ${error.message}`, 'error');
      return [];
    }
  }

  /**
   * Check if there are any active sessions available
   */
  async hasActiveSession(): Promise<boolean> {
    try {
      const count = await this.prisma.cookieSession.count({
        where: {
          isValid: true,
          platform: 'twitter',
        },
      });
      return count > 0;
    } catch (error: any) {
      this._log(`Failed to check active sessions: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Mark session as bad (error occurred). Updates DB immediately.
   */
  async markBad(sessionId: string, reason?: string): Promise<void> {
    try {
      const session = await this.prisma.cookieSession.findUnique({ where: { id: sessionId } });
      if (!session) return;

      const newErrorCount = session.errorCount + 1;
      this._log(
        `Marking session ${sessionId} BAD: ${reason || 'Unknown'} (Errors: ${newErrorCount})`,
        'warn',
      );

      await this.prisma.cookieSession.update({
        where: { id: sessionId },
        data: {
          errorCount: newErrorCount,
          lastUsed: new Date(),
        },
      });

      if (newErrorCount >= 10) {
        // Hardcoded limit for now, could be dynamic
        await this.retire(sessionId);
      }
    } catch (e: any) {
      this._log(`Failed to update session ${sessionId}: ${e.message}`, 'error');
    }
  }

  /**
   * Mark session as success. Resets errors?
   * Usually means we successfully scraped something.
   */
  async markGood(sessionId: string): Promise<void> {
    await this.markSuccess(sessionId);
  }

  async markSuccess(sessionId: string): Promise<void> {
    try {
      this._log(`Marking session ${sessionId} GOOD`);
      // Optional: Decrement error count? or just reset logic?
      // Staying simple: just update lastUsed.
      await this.prisma.cookieSession.update({
        where: { id: sessionId },
        data: {
          lastUsed: new Date(),
          errorCount: 0, // Reset error count on success? Debateable. Let's say yes for "recovery".
        },
      });
    } catch (e: any) {
      this._log(`Failed to mark success for session ${sessionId}: ${e.message}`, 'error');
    }
  }

  /**
   * Retire session (Invalidate in DB)
   */
  async retire(sessionId: string): Promise<void> {
    this._log(`Retiring session ${sessionId} due to excessive errors`, 'error');
    try {
      await this.prisma.cookieSession.update({
        where: { id: sessionId },
        data: { isValid: false },
      });
    } catch (e: any) {
      this._log(`Failed to retire session ${sessionId}: ${e.message}`, 'error');
    }
  }

  async injectSession(
    page: Page,
    session: Session,
    clearExistingCookies: boolean = true,
  ): Promise<void> {
    this._log(`Injecting session: ${session.username || session.id}`);
    if (clearExistingCookies) {
      const existingCookies = await page.cookies();
      if (existingCookies.length > 0) {
        await page.deleteCookie(...existingCookies);
      }
    }
    await page.setCookie(...(session.cookies as any));
  }

  private _log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (this.eventBus) {
      this.eventBus.emitLog(message, level);
    } else {
      const prefix = '[SessionManager]';
      if (level === 'error') console.error(prefix, message);
      else if (level === 'warn') console.warn(prefix, message);
      else console.log(prefix, message);
    }
  }
}
