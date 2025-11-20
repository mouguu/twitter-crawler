
import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'puppeteer';

/**
 * ErrorSnapshotter
 * 
 * Responsible for capturing screenshots and HTML snapshots when an error occurs.
 * Inspired by Crawlee's ErrorSnapshotter.
 */
export class ErrorSnapshotter {
    private snapshotDir: string;

    constructor(baseDir: string = 'output/errors') {
        this.snapshotDir = path.isAbsolute(baseDir) ? baseDir : path.join(process.cwd(), baseDir);
        this.ensureDirExists();
    }

    private ensureDirExists() {
        if (!fs.existsSync(this.snapshotDir)) {
            fs.mkdirSync(this.snapshotDir, { recursive: true });
        }
    }

    /**
     * Captures a snapshot (screenshot + HTML) of the current page state.
     * @param page The Puppeteer page instance
     * @param error The error object that triggered this snapshot
     * @param contextLabel A label to identify the context (e.g., 'scrapeTimeline-elonmusk')
     */
    async capture(page: Page, error: Error, contextLabel: string = 'unknown'): Promise<string[]> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sanitizedLabel = contextLabel.replace(/[^a-z0-9-]/gi, '_');
            const errorName = error.name || 'Error';

            // Base filename: timestamp_label_error
            const baseFilename = `${timestamp}_${sanitizedLabel}_${errorName}`;

            const screenshotPath = path.join(this.snapshotDir, `${baseFilename}.jpg`);
            const htmlPath = path.join(this.snapshotDir, `${baseFilename}.html`);

            const savedFiles: string[] = [];

            // 1. Capture Screenshot
            try {
                await page.screenshot({
                    path: screenshotPath,
                    type: 'jpeg',
                    quality: 60,
                    fullPage: true
                });
                savedFiles.push(screenshotPath);
            } catch (e) {
                console.error(`[ErrorSnapshotter] Failed to capture screenshot: ${e}`);
            }

            // 2. Capture HTML
            try {
                const htmlContent = await page.content();
                fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
                savedFiles.push(htmlPath);
            } catch (e) {
                console.error(`[ErrorSnapshotter] Failed to capture HTML: ${e}`);
            }

            // 3. Save Error Details
            try {
                const errorLogPath = path.join(this.snapshotDir, `${baseFilename}.log`);
                const errorLog = `Error: ${error.message}\nStack: ${error.stack}\nContext: ${contextLabel}\nTime: ${new Date().toISOString()}`;
                fs.writeFileSync(errorLogPath, errorLog, 'utf-8');
                savedFiles.push(errorLogPath);
            } catch (e) {
                console.error(`[ErrorSnapshotter] Failed to save error log: ${e}`);
            }

            return savedFiles;

        } catch (criticalError) {
            console.error(`[ErrorSnapshotter] Critical failure: ${criticalError}`);
            return [];
        }
    }
}
