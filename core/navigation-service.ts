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
        const defaultTimeout = options.timeout || 10000;
        const startTime = Date.now();

        try {
            while (Date.now() - startTime < defaultTimeout) {
                // 1. Check for tweets
                const tweetsFound = await page.$(X_SELECTORS.TWEET);
                if (tweetsFound) return true;

                // 2. Check for no results (valid empty state)
                // We import detectNoResultsPage dynamically or assume it's imported
                // Since I can't easily change imports in this tool without replacing the whole file header,
                // I'll assume I need to add the import too. 
                // Wait, I can use the imported function if I added it to the imports.
                // I need to check if I added the import. I didn't.
                // I will use a separate tool call to add the import first.
                
                // For now, let's just use the logic here or call the function if available.
                // I'll use the function `recoverFromErrorPage` is imported from `./data-extractor`.
                // I should check if `detectNoResultsPage` is exported from there. Yes I added it.
                // But I need to update the import statement in this file.
                
                // Let's assume I'll update imports in a separate step or this step if I can.
                // I'll just write the logic here to be safe and avoid import issues for now, 
                // OR I'll do a separate edit for imports.
                
                // Let's do the loop logic first.
                const noResults = await import('./data-extractor').then(m => m.detectNoResultsPage(page));
                if (noResults) {
                    this._log('No results found for query (valid empty state).', 'info');
                    return false; // Return false to indicate "no tweets but valid state"
                }

                // 3. Check for error page
                const hasError = await import('./data-extractor').then(m => m.detectErrorPage(page));
                if (hasError) {
                    this._log('Error page detected during wait. Attempting recovery...', 'warn');
                    const recovered = await import('./data-extractor').then(m => m.recoverFromErrorPage(page));
                    if (recovered) {
                        this._log('Recovered from error page. Continuing wait...', 'info');
                        continue; // Continue waiting for tweets
                    } else {
                        throw ScraperErrors.navigationFailed('Page shows error message and recovery failed');
                    }
                }

                await new Promise(r => setTimeout(r, 500));
            }

            throw new Error(`Timeout waiting for tweets or empty state (${defaultTimeout}ms)`);
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
