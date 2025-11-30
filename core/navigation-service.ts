import { Page } from 'puppeteer';
import * as retryUtils from '../utils';
import * as constants from '../config/constants';
import { X_SELECTORS, recoverFromErrorPage } from './data-extractor';
import { ScraperEventBus } from './event-bus';
import { ScraperErrors } from './errors';

export interface NavigationOptions {
    maxRetries?: number;
    timeout?: number;
}

export class NavigationService {
    private eventBus: ScraperEventBus | undefined;

    constructor(eventBus?: ScraperEventBus) {
        this.eventBus = eventBus;
    }

    async navigateToUrl(page: Page, url: string, options: NavigationOptions = {}): Promise<boolean> {
        const maxRetries = options.maxRetries || 1;

        try {
            await retryUtils.retryPageGoto(
                page,
                url,
                {
                    waitUntil: 'networkidle2',
                    timeout: options.timeout || 25000
                },
                {
                    maxRetries,
                    baseDelay: 800,
                    onRetry: (error: any, attempt: number) => {
                        this._log(`Navigation failed (attempt ${attempt}/${maxRetries}): ${error.message}`, 'warn');
                    }
                }
            );
            
            // 导航后检查是否有错误页面，尝试恢复
            const recovered = await recoverFromErrorPage(page, 1); // 导航后只尝试一次快速恢复
            if (recovered) {
                this._log('Recovered from error page after navigation', 'info');
            }
            
            return true;
        } catch (error: any) {
            this._log(`Navigation failed: ${error.message}`, 'error');
            throw ScraperErrors.navigationFailed(url, error);
        }
    }

    async waitForTweets(page: Page, options: NavigationOptions = {}): Promise<boolean> {
        const maxRetries = options.maxRetries || 1;
        // 减少默认超时时间，加快切换（并行模式下更快）
        const defaultTimeout = options.timeout || 10000; // 从20秒减少到10秒

        try {
            await retryUtils.retryWaitForSelector(
                page,
                X_SELECTORS.TWEET,
                { timeout: defaultTimeout },
                {
                    maxRetries,
                    baseDelay: 500, // 减少重试延迟，从800ms减少到500ms
                    onRetry: (error: any, attempt: number) => {
                        this._log(`Waiting for tweets failed (attempt ${attempt}/${maxRetries}): ${error.message}`, 'warn');
                    }
                }
            );
            return true;
        } catch (error: any) {
            this._log(`No tweets found: ${error.message}`, 'error');
            throw ScraperErrors.dataExtractionFailed(`No tweets found: ${error.message}`, { page: 'waitForTweets' });
        }
    }

    async reloadPage(page: Page): Promise<boolean> {
        try {
            await retryUtils.retryWithBackoff(
                async () => {
                    await page.reload({ waitUntil: 'networkidle2', timeout: constants.NAVIGATION_TIMEOUT });
                    this._log('Page refreshed, waiting for tweets to reload...');
                    await page.waitForSelector(X_SELECTORS.TWEET, {
                        timeout: constants.WAIT_FOR_TWEETS_AFTER_REFRESH_TIMEOUT
                    });
                },
                {
                    ...constants.REFRESH_RETRY_CONFIG,
                    onRetry: (error: any, attempt: number) => {
                        this._log(`Page refresh failed (attempt ${attempt}): ${error.message}`, 'warn');
                    }
                }
            );
            return true;
        } catch (error: any) {
            this._log(`Page reload failed: ${error.message}`, 'error');
            throw ScraperErrors.navigationFailed('Page reload', error);
        }
    }

    private _log(message: string, level: string = 'info'): void {
        if (this.eventBus) {
            this.eventBus.emitLog(message, level);
        } else {
            console.log(`[NavigationService] ${message}`);
        }
    }
}
