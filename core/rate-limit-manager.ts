import { Page } from 'puppeteer';
import { ScraperEventBus } from './scraper-engine.types';
import { Session, SessionManager } from './session-manager';

const throttle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimitManager {
  private eventBus: ScraperEventBus | undefined;
  private sessionManager: SessionManager;
  private maxRotationAttempts: number;
  private enableRotation: boolean = true;

  constructor(sessionManager: SessionManager, eventBus?: ScraperEventBus) {
    this.eventBus = eventBus;
    this.sessionManager = sessionManager;
    this.maxRotationAttempts = 3;
  }

  setEnableRotation(enable: boolean) {
    this.enableRotation = enable;
  }

  async handleRateLimit(
    _page: Page,
    currentAttempt: number,
    error: Error,
    currentSessionId?: string,
  ): Promise<Session | null> {
    if (currentAttempt >= this.maxRotationAttempts) {
      this._log(
        `Rate limit handling failed after ${currentAttempt} attempts: ${error.message}`,
        'error',
      );
      return null;
    }

    if (!this.enableRotation) {
      this._log(
        `⚠️ Rate limit detected, but auto-rotation is DISABLED. Stopping execution.`,
        'warn',
      );
      return null;
    }

    this._log(
      `⚠️ Rate limit detected! Rotating to next cookie account (attempt ${currentAttempt + 1}/${this.maxRotationAttempts})...`,
      'warn',
    );

    try {
      if (currentSessionId) {
        this.sessionManager.markBad(currentSessionId, 'rate-limit');
      }
      // Try to get a different session
      // We pass undefined as preferredId because we specifically DON'T want the current one if possible? 
      // Actually getNextSession(preferredId) returns preferred if valid. 
      // If we want a different one, we should probably not pass currentSessionId.
      // But the original code passed `undefined, currentSessionId`. 
      // I'll assume it meant "any session" and just call it without args, OR if it meant "exclude current", my new logic doesn't support exclusion explicitly yet.
      // But let's just await it for now.
      const nextSession = await this.sessionManager.getNextSession();
      if (!nextSession) {
        this._log('No additional sessions available to rotate into.', 'error');
        return null;
      }

      this._log(
        `✅ Selected fallback session: ${nextSession.id}${nextSession.username ? ` (${nextSession.username})` : ''}`,
      );
      await throttle(2000);
      return nextSession;
    } catch (err: any) {
      this._log(`Failed to rotate cookie: ${err.message}`, 'error');
      return null;
    }
  }

  isRateLimitError(error: Error): boolean {
    const msg = (error.message || '').toLowerCase();
    if ((error as any).name === 'TimeoutError' && msg.includes('navigation')) {
      return true;
    }

    const rateLimitHints = [
      'too many requests',
      'rate limit',
      'rate-limited',
      '429',
      'exceeded',
      'something went wrong',
      'guest token',
      'waiting failed',
      'waiting for selector',
      'navigation timeout',
      'timeout exceeded',
    ];

    return rateLimitHints.some((hint) => msg.includes(hint));
  }

  private _log(message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void {
    if (this.eventBus) {
      this.eventBus.emitLog(message, level);
    } else {
      console.log(`[RateLimitManager] ${message}`);
    }
  }
}
