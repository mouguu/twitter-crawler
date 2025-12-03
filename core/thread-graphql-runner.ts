import type { ScraperEngine } from './scraper-engine';
import type { ScrapeThreadOptions, ScrapeThreadResult } from './scraper-engine.types';
import { parseTweetDetailResponse, Tweet } from '../types';
import * as fileUtils from '../utils';
import * as markdownUtils from '../utils';
import * as exportUtils from '../utils';
import { getThreadDetailWaitTime } from '../config/constants';
import { ErrorClassifier, ScraperError } from './errors';

const throttle = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Scrape thread using GraphQL API
 */
export async function runThreadGraphql(
  engine: ScraperEngine,
  options: ScrapeThreadOptions
): Promise<ScrapeThreadResult> {
  try {
    engine.ensureApiClient();
  } catch (error) {
    return {
      success: false,
      tweets: [],
      error: error instanceof ScraperError ? error.message : 'API Client not initialized'
    };
  }

  // Validate configuration
  if (options.maxReplies !== undefined) {
    if (typeof options.maxReplies !== 'number' || options.maxReplies < 1) {
      return {
        success: false,
        tweets: [],
        error: `Invalid maxReplies: must be a positive number, got ${options.maxReplies}`
      };
    }
    if (options.maxReplies > 10000) {
      return {
        success: false,
        tweets: [],
        error: `Invalid maxReplies: must be <= 10000, got ${options.maxReplies}`
      };
    }
  }

  engine.performanceMonitor.reset();
  engine.performanceMonitor.setMode('graphql');
  engine.performanceMonitor.start();
  engine.emitPerformanceUpdate(true);

  let { tweetUrl, maxReplies = 100, runContext, saveMarkdown = true, exportCsv = false, exportJson = false } = options;

  if (!tweetUrl || !tweetUrl.includes('/status/')) {
    return { success: false, tweets: [], error: 'Invalid tweet URL' };
  }

  // Extract ID and Username
  const urlMatch = tweetUrl.match(/x\.com\/([^\/]+)\/status\/(\d+)/);
  if (!urlMatch) {
    return { success: false, tweets: [], error: 'Could not parse tweet URL' };
  }
  const username = urlMatch[1];
  const tweetId = urlMatch[2];

  // Initialize runContext if missing
  if (!runContext) {
    runContext = await fileUtils.createRunContext({
      platform: 'x',
      identifier: `thread-${username}`,
      baseOutputDir: options.outputDir
    });
    engine.eventBus.emitLog(`Created new run context for thread: ${runContext.runId}`);
  }

  let originalTweet: Tweet | null = null;
  const allReplies: Tweet[] = [];
  const scrapedReplyIds = new Set<string>();
  let cursor: string | undefined;

  try {
    engine.eventBus.emitLog(`Fetching thread for tweet ${tweetId}...`);

    // Initial fetch
    const apiStartTime = Date.now();
    engine.performanceMonitor.startPhase('api-fetch-thread');
    const apiClient = engine.ensureApiClient();
    const response = await apiClient.getTweetDetail(tweetId);
    const apiLatency = Date.now() - apiStartTime;
    engine.performanceMonitor.endPhase();
    engine.performanceMonitor.recordApiRequest(apiLatency, false);

    engine.performanceMonitor.startPhase('parse-thread-response');
    const parsed = parseTweetDetailResponse(response, tweetId);
    const parseTime = Date.now() - apiStartTime - apiLatency;
    engine.performanceMonitor.endPhase();
    engine.performanceMonitor.recordApiParse(parseTime);

    originalTweet = parsed.originalTweet;

    // Add replies
    for (const reply of [...parsed.conversationTweets, ...parsed.replies]) {
      if (!scrapedReplyIds.has(reply.id)) {
        allReplies.push(reply);
        scrapedReplyIds.add(reply.id);
      }
    }

    cursor = parsed.nextCursor;

    engine.eventBus.emitLog(`Initial fetch: ${allReplies.length} replies found`);

    // Track consecutive empty fetches to avoid infinite loops
    let consecutiveEmptyFetches = 0;
    const MAX_CONSECUTIVE_EMPTY_FETCHES = 3; // Stop after 3 consecutive empty fetches

    // Fetch more replies
    while (allReplies.length < maxReplies && cursor) {
      if (engine.shouldStop()) {
        engine.eventBus.emitLog('Manual stop signal received.');
        break;
      }

      // Use centralized wait time calculation
      const waitTime = getThreadDetailWaitTime();
      await throttle(waitTime);

      const moreApiStartTime = Date.now();
      engine.performanceMonitor.startPhase('api-fetch-more-replies');
      const moreResponse = await apiClient.getTweetDetail(tweetId, cursor);
      const moreApiLatency = Date.now() - moreApiStartTime;
      engine.performanceMonitor.endPhase();
      engine.performanceMonitor.recordApiRequest(moreApiLatency, false);

      const moreParsed = parseTweetDetailResponse(moreResponse, tweetId);

      let addedCount = 0;
      for (const reply of [...moreParsed.conversationTweets, ...moreParsed.replies]) {
        if (allReplies.length >= maxReplies) break;
        if (!scrapedReplyIds.has(reply.id)) {
          allReplies.push(reply);
          scrapedReplyIds.add(reply.id);
          addedCount++;
        }
      }

      engine.eventBus.emitLog(`Fetched ${addedCount} more replies. Total: ${allReplies.length}`);

      engine.eventBus.emitProgress({
        current: allReplies.length,
        target: maxReplies,
        action: 'fetching replies'
      });

      // Track consecutive empty fetches
      if (addedCount === 0) {
        consecutiveEmptyFetches++;
        if (consecutiveEmptyFetches >= MAX_CONSECUTIVE_EMPTY_FETCHES) {
          engine.eventBus.emitLog(`No new replies found after ${MAX_CONSECUTIVE_EMPTY_FETCHES} attempts. Stopping.`);
          break;
        }
      } else {
        consecutiveEmptyFetches = 0; // Reset counter when new replies are found
      }

      if (!moreParsed.nextCursor || moreParsed.nextCursor === cursor) {
        engine.eventBus.emitLog('Reached end of replies.');
        break;
      }
      cursor = moreParsed.nextCursor;
    }

    const allTweets = originalTweet ? [originalTweet, ...allReplies] : allReplies;

    // Save
    engine.performanceMonitor.startPhase('save-results');
    if (allTweets.length > 0) {
      if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
      if (exportCsv) await exportUtils.exportToCsv(allTweets, runContext);
      if (exportJson) await exportUtils.exportToJson(allTweets, runContext);
    }
    engine.performanceMonitor.endPhase();

    const currentSession = engine.getCurrentSession();
    if (currentSession) {
      engine.sessionManager.markGood(currentSession.id);
    }

    engine.performanceMonitor.stop();
    engine.emitPerformanceUpdate(true);
    engine.eventBus.emitLog(engine.performanceMonitor.getReport());

    return {
      success: true,
      tweets: allTweets,
      originalTweet,
      replies: allReplies,
      runContext,
      performance: engine.performanceMonitor.getStats()
    };

  } catch (error: unknown) {
    const scraperError = ErrorClassifier.classify(error);
    engine.performanceMonitor.stop();
    engine.eventBus.emitError(scraperError);
    return { 
      success: false, 
      tweets: [], 
      error: scraperError.getUserMessage(),
      code: scraperError.code,
      retryable: scraperError.retryable
    };
  }
}
