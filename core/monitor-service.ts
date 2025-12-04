import * as fs from 'fs';
import * as path from 'path';
import { ScraperEngine } from './scraper-engine';
import type { Tweet } from '../types/tweet-definitions';
import * as fileUtils from '../utils';
import { ScraperEventBus } from './event-bus';

interface MonitorState {
    [username: string]: {
        lastTweetId: string;
        lastScrapedAt: string;
    };
}

export class MonitorService {
    private stateFilePath: string;
    private state: MonitorState = {};
    private scraperEngine: ScraperEngine;
    private eventBus?: ScraperEventBus;

    constructor(scraperEngine: ScraperEngine, eventBus?: ScraperEventBus) {
        this.scraperEngine = scraperEngine;
        this.eventBus = eventBus;
        this.stateFilePath = path.join(process.cwd(), 'monitor_state.json');
        this.loadState();
    }

    private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        if (this.eventBus) {
            this.eventBus.emitLog(message, level);
        } else {
            const prefix = '[Monitor]';
            if (level === 'error') console.error(prefix, message);
            else if (level === 'warn') console.warn(prefix, message);
            else console.log(prefix, message);
        }
    }

    private loadState() {
        if (fs.existsSync(this.stateFilePath)) {
            try {
                this.state = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf-8'));
            } catch (e) {
                this.log(`Failed to load monitor state: ${e instanceof Error ? e.message : String(e)}`, 'error');
                this.state = {};
            }
        }
    }

    private saveState() {
        try {
            fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
        } catch (e) {
            this.log(`Failed to save monitor state: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }
    }

    async runMonitor(usernames: string[], options: { lookbackHours?: number, keywords?: string[] } = {}): Promise<void> {
        this.log(`Starting batch job for: ${usernames.join(', ')}`);

        const allNewTweets: { username: string; tweets: Tweet[] }[] = [];
        const { lookbackHours, keywords } = options;

        let sinceTimestamp: number | undefined;
        if (lookbackHours) {
            sinceTimestamp = Date.now() - (lookbackHours * 60 * 60 * 1000);
            this.log(`Lookback set to ${lookbackHours} hours (Since: ${new Date(sinceTimestamp).toISOString()})`);
        }

        for (const username of usernames) {
            this.log(`Checking updates for @${username}...`);

            const lastState = this.state[username];
            const stopAtTweetId = lastState ? lastState.lastTweetId : undefined;

            const result = await this.scraperEngine.scrapeTimeline({
                username,
                limit: 50, // Check last 50 tweets for updates
                stopAtTweetId,
                sinceTimestamp, // Pass time limit
                saveMarkdown: false, // We will aggregate them later
                saveScreenshots: false
            });

            if (result.success && result.tweets.length > 0) {
                let newTweets = result.tweets;

                // Filter by Keywords
                if (keywords && keywords.length > 0) {
                    const lowerKeywords = keywords.map(k => k.toLowerCase());
                    newTweets = newTweets.filter(t => {
                        const text = (t.text || '').toLowerCase();
                        return lowerKeywords.some(k => text.includes(k));
                    });
                    this.log(`Filtered ${result.tweets.length} -> ${newTweets.length} tweets using keywords: ${keywords.join(', ')}`);
                }

                if (newTweets.length > 0) {
                    this.log(`Found ${newTweets.length} relevant new tweets for @${username}`);

                    // Update state with the latest tweet from the ORIGINAL result (to avoid re-scanning even if filtered out)
                    // We track progress based on the timeline, not the filtered results.
                    const newestTweet = result.tweets[0];

                    this.state[username] = {
                        lastTweetId: newestTweet.id,
                        lastScrapedAt: new Date().toISOString()
                    };
                    this.saveState();

                    allNewTweets.push({ username, tweets: newTweets });
                } else {
                    this.log(`No tweets matched keywords for @${username}`);
                    // Still update state to avoid re-scanning these non-matching tweets
                    const newestTweet = result.tweets[0];
                    this.state[username] = {
                        lastTweetId: newestTweet.id,
                        lastScrapedAt: new Date().toISOString()
                    };
                    this.saveState();
                }
            } else {
                this.log(`No new tweets for @${username}`);
            }
        }

        if (allNewTweets.length > 0) {
            await this.generateDailyReport(allNewTweets, options);
        } else {
            this.log('No new tweets found for any user.');
        }
    }

    private async generateDailyReport(data: { username: string; tweets: Tweet[] }[], options: { lookbackHours?: number, keywords?: string[] }) {
        const dateStr = new Date().toISOString().split('T')[0];
        const reportDir = path.join(fileUtils.getDefaultOutputRoot(), 'reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        const filename = path.join(reportDir, `daily_report_${dateStr}.md`);

        let content = `# Daily Twitter Monitor Report - ${dateStr}\n\n`;

        if (options.lookbackHours) content += `**Lookback:** Last ${options.lookbackHours} hours\n`;
        if (options.keywords && options.keywords.length > 0) content += `**Keywords:** ${options.keywords.join(', ')}\n`;
        content += `\n---\n\n`;

        for (const item of data) {
            content += `## @${item.username} (${item.tweets.length} new)\n\n`;
            for (const tweet of item.tweets) {
                // 使用统一的 time 字段
                const tweetTime = tweet.time ? new Date(tweet.time).toLocaleString() : 'Unknown time';
                content += `### ${tweetTime}\n`;
                content += `${tweet.text || ''}\n\n`;
                // 使用统一的 hasMedia 字段
                if (tweet.hasMedia) {
                    content += `> 📷 Contains media\n\n`;
                }
                content += `[View Tweet](${tweet.url})\n`;
                content += `---\n`;
            }
            content += `\n`;
        }

        fs.writeFileSync(filename, content, 'utf-8');
        this.log(`Report generated: ${filename}`);
    }
}
