import { Page } from 'puppeteer';
import * as retryUtils from '../utils/retry';
import * as constants from '../config/constants';
// @ts-ignore
import * as dataExtractor from './data-extractor';
import { ScraperEventBus } from './event-bus';

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
            return true;
        } catch (error: any) {
            this._log(`Navigation failed: ${error.message}`, 'error');
            throw error;
        }
    }

    async waitForTweets(page: Page, options: NavigationOptions = {}): Promise<boolean> {
        const maxRetries = options.maxRetries || 1;

        try {
            await retryUtils.retryWaitForSelector(
                page,
                dataExtractor.X_SELECTORS.TWEET,
                { timeout: options.timeout || 20000 },
                {
                    maxRetries,
                    baseDelay: 800,
                    onRetry: (error: any, attempt: number) => {
                        this._log(`Waiting for tweets failed (attempt ${attempt}/${maxRetries}): ${error.message}`, 'warn');
                    }
                }
            );
            return true;
        } catch (error: any) {
            this._log(`No tweets found: ${error.message}`, 'error');
            throw error;
        }
    }

    async reloadPage(page: Page): Promise<boolean> {
        try {
            await retryUtils.retryWithBackoff(
                async () => {
                    await page.reload({ waitUntil: 'networkidle2', timeout: constants.NAVIGATION_TIMEOUT });
                    this._log('Page refreshed, waiting for tweets to reload...');
                    await page.waitForSelector(dataExtractor.X_SELECTORS.TWEET, {
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
            throw error;
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
