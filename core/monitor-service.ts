import * as fs from 'fs';
import * as path from 'path';
import { ScraperEngine } from './scraper-engine';
import { Tweet } from '../utils/markdown';
import * as fileUtils from '../utils/fileutils';

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

    constructor(scraperEngine: ScraperEngine) {
        this.scraperEngine = scraperEngine;
        this.stateFilePath = path.join(process.cwd(), 'monitor_state.json');
        this.loadState();
    }

    private loadState() {
        if (fs.existsSync(this.stateFilePath)) {
            try {
                this.state = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf-8'));
            } catch (e) {
                console.error('Failed to load monitor state:', e);
                this.state = {};
            }
        }
    }

    private saveState() {
        try {
            fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
        } catch (e) {
            console.error('Failed to save monitor state:', e);
        }
    }

    async runMonitor(usernames: string[], options: { lookbackHours?: number, keywords?: string[] } = {}): Promise<void> {
        console.log(`[Monitor] Starting batch job for: ${usernames.join(', ')}`);

        const allNewTweets: { username: string; tweets: Tweet[] }[] = [];
        const { lookbackHours, keywords } = options;

        let sinceTimestamp: number | undefined;
        if (lookbackHours) {
            sinceTimestamp = Date.now() - (lookbackHours * 60 * 60 * 1000);
            console.log(`[Monitor] Lookback set to ${lookbackHours} hours (Since: ${new Date(sinceTimestamp).toISOString()})`);
        }

        for (const username of usernames) {
            console.log(`[Monitor] Checking updates for @${username}...`);

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
                    console.log(`[Monitor] Filtered ${result.tweets.length} -> ${newTweets.length} tweets using keywords: ${keywords.join(', ')}`);
                }

                if (newTweets.length > 0) {
                    console.log(`[Monitor] Found ${newTweets.length} relevant new tweets for @${username}`);

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
                    console.log(`[Monitor] No tweets matched keywords for @${username}`);
                    // Still update state to avoid re-scanning these non-matching tweets
                    const newestTweet = result.tweets[0];
                    this.state[username] = {
                        lastTweetId: newestTweet.id,
                        lastScrapedAt: new Date().toISOString()
                    };
                    this.saveState();
                }
            } else {
                console.log(`[Monitor] No new tweets for @${username}`);
            }
        }

        if (allNewTweets.length > 0) {
            await this.generateDailyReport(allNewTweets, options);
        } else {
            console.log('[Monitor] No new tweets found for any user.');
        }
    }

    private async generateDailyReport(data: { username: string; tweets: Tweet[] }[], options: { lookbackHours?: number, keywords?: string[] }) {
        const dateStr = new Date().toISOString().split('T')[0];
        const reportDir = path.join(process.cwd(), 'output', 'reports');
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
                content += `### ${tweet.createdAt}\n`;
                content += `${tweet.text}\n\n`;
                if (tweet.images && tweet.images.length > 0) {
                    content += `> Images: ${tweet.images.length}\n\n`;
                }
                content += `[View Tweet](${tweet.url})\n`;
                content += `---\n`;
            }
            content += `\n`;
        }

        fs.writeFileSync(filename, content, 'utf-8');
        console.log(`[Monitor] Report generated: ${filename}`);
    }
}
