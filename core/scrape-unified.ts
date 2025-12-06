
import { EventEmitter } from 'events';
import { ScraperEngine } from './scraper-engine';
import { ScrapeTimelineConfig } from './scraper-engine.types';
import { Tweet } from '../types/tweet-definitions';
import { RunContext } from '../utils';

// Re-export common types for CLI
export type TwitterUserIdentifier = string | {
  username?: string;
  url?: string;
  searchQuery?: string;
} | null;

export interface LogMessageData {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp?: number;
}

export interface ScrapeProgressData {
  current: number;
  target: number;
  total: number;
  action: string;
}

class CliEventBus extends EventEmitter {
  emitLog(message: string, level: LogMessageData['level'] = 'info') {
    this.emit('log:message', { level, message, timestamp: Date.now() });
  }

  emitProgress(data: Omit<ScrapeProgressData, 'total'> & { total?: number }) {
    this.emit('scrape:progress', { ...data, total: data.total ?? data.target });
  }
}

export const eventBusInstance = new CliEventBus();

export async function scrapeTwitterUsers(
  identifiers: (string | TwitterUserIdentifier)[],
  options: any
) {
  const results: any[] = [];
  
  const engineOptions = {
    apiOnly: options.apiVariant === 'graphql' || options.scrapeMode === 'graphql',
    logger: {
      info: (msg: string) => eventBusInstance.emitLog(msg, 'info'),
      warn: (msg: string) => eventBusInstance.emitLog(msg, 'warn'),
      error: (msg: string) => eventBusInstance.emitLog(msg, 'error'),
      debug: (msg: string) => eventBusInstance.emitLog(msg, 'debug'),
    },
    onProgress: (progress: any) => {
      eventBusInstance.emitProgress({
        current: progress.current || 0,
        target: progress.total || 100,
        action: progress.phase || 'Scraping',
        total: progress.total || 100
      });
    },
  };

  const getShouldStop = async () => false;

  const engine = new ScraperEngine(getShouldStop, engineOptions);
  await engine.init();

  try {
    for (const id of identifiers) {
      let username: string | undefined;
      let query: string | undefined;
      
      if (typeof id === 'string') {
        username = id;
      } else if (id && typeof id === 'object') {
        if ('searchQuery' in id && id.searchQuery) {
          query = id.searchQuery;
        } else if ('username' in id) {
          username = id.username;
        }
      }

      const mode = options.scrapeMode === 'puppeteer' ? 'puppeteer' : 'graphql';

      if (query) {
         eventBusInstance.emitLog(`Starting search: ${query}`, 'info');
         const config: ScrapeTimelineConfig = {
           searchQuery: query,
           limit: options.tweetCount || 50,
           scrapeMode: mode,
         } as any; 

         const result = await engine.scrapeTimeline(config);
         if (result.success) {
             results.push({ username: query, tweets: result.tweets, tweetCount: result.tweets.length, profile: result.profile, runContext: result.runContext });
         } else {
             eventBusInstance.emitLog(`Search failed: ${result.error}`, 'error');
         }
      } else if (username || id === null) {
          const target = username || 'Home Timeline';
          eventBusInstance.emitLog(`Starting user scrape: ${target}`, 'info');
          
          const searchQ = username ? `from:${username}` : ''; 
          
          const config: ScrapeTimelineConfig = {
            searchQuery: searchQ,
            limit: options.tweetCount || 50,
            scrapeMode: mode,
            username: username,
          } as any;

          const result = await engine.scrapeTimeline(config);
          if (result.success) {
              results.push({ username: username || 'home', tweets: result.tweets, tweetCount: result.tweets.length, profile: result.profile, runContext: result.runContext });
          } else {
              eventBusInstance.emitLog(`Scrape failed for ${target}: ${result.error}`, 'error');
          }
      }
    }
  } catch (err: any) {
    eventBusInstance.emitLog(`Error: ${err.message}`, 'error');
  } finally {
    await engine.close();
  }

  return results;
}

export async function scrapeThread(options: any) {
    eventBusInstance.emitLog('Thread scraping not fully reimplemented in simplified CLI bridge.', 'warn');
    const result: {
        success: boolean;
        error: string;
        tweets: Tweet[];
        originalTweet: Tweet | null;
        replies: Tweet[];
        runContext: RunContext | null;
    } = { 
      success: false, 
      error: 'Not implemented', 
      tweets: [], 
      originalTweet: null, 
      replies: [], 
      runContext: null 
    };
    return result;
}
