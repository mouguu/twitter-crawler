import { describe, test, expect, beforeEach, afterEach, mock, spyOn, beforeAll, afterAll } from 'bun:test';

import * as path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import { extractTweetsFromPage } from '../../core/data-extractor';

describe('DataExtractor (Integration with DOM)', () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    });

    afterAll(async () => {
        await browser.close();
    });

    beforeEach(async () => {
        page = await browser.newPage();
    });

    afterEach(async () => {
        await page.close();
    });

    test('should correctly extract tweets from mock HTML', async () => {
        // Load the local fixture file
        const fixturePath = path.join(process.cwd(), 'tests/fixtures/twitter-mock.html');
        await page.goto(`file://${fixturePath}`);

        const tweets = await extractTweetsFromPage(page);

        expect(tweets).toHaveLength(2);

        // Verify Tweet 1
        const t1 = tweets.find(t => t.id === '1234567890');
        expect(t1).toBeDefined();
        expect(t1?.text).toContain('This is a test tweet');
        expect(t1?.likes).toBe(100);
        expect(t1?.replies).toBe(10);
        expect(t1?.hasMedia).toBe(false);

        // Verify Tweet 2
        const t2 = tweets.find(t => t.id === '9876543210');
        expect(t2).toBeDefined();
        expect(t2?.text).toContain('Tweet with media');
        expect(t2?.likes).toBe(1500); // 1.5K -> 1500
        expect(t2?.hasMedia).toBe(true);
    });
});
