import type { ScraperEngine } from './scraper-engine';
import type { ScrapeThreadOptions, ScrapeThreadResult } from './scraper-engine.types';
import { Tweet } from '../types';
import * as dataExtractor from './data-extractor';
import * as fileUtils from '../utils';
import * as markdownUtils from '../utils';
import * as exportUtils from '../utils';
import * as constants from '../config/constants';
import { ErrorClassifier } from './errors';

/**
 * Scrape thread using Puppeteer DOM extraction
 */
export async function runThreadDom(
  engine: ScraperEngine,
  options: ScrapeThreadOptions
): Promise<ScrapeThreadResult> {
  // Ensure page is available for DOM operations.
  const page = engine.getPageInstance();
  if (!page) {
    try {
      await engine.ensurePage();
    } catch (error) {
      const scraperError = ErrorClassifier.classify(error);
      return {
        success: false,
        tweets: [],
        error: scraperError.getUserMessage(),
        code: scraperError.code,
        retryable: scraperError.retryable
      };
    }
  }
  
  // Re-get page after ensurePage
  const activePage = engine.getPageInstance();
  if (!activePage) {
    return { success: false, tweets: [], error: 'Failed to initialize page' };
  }

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

  try {
    // Navigate
    await engine.navigationService.navigateToUrl(activePage, tweetUrl);
    await engine.navigationService.waitForTweets(activePage);

    // Extract Original Tweet
    let tweetsOnPage = await dataExtractor.extractTweetsFromPage(activePage);
    if (tweetsOnPage.length > 0) {
      originalTweet = tweetsOnPage.find(t => t.id === tweetId || t.url.includes(tweetId)) || tweetsOnPage[0];

      tweetsOnPage.forEach(tweet => {
        if (tweet.id !== originalTweet?.id && !scrapedReplyIds.has(tweet.id)) {
          allReplies.push(tweet as Tweet);
          scrapedReplyIds.add(tweet.id);
        }
      });
    }

    // Scroll for replies
    let scrollAttempts = 0;
    const maxScrollAttempts = Math.max(50, Math.ceil(maxReplies / 5));

    while (allReplies.length < maxReplies && scrollAttempts < maxScrollAttempts) {
      if (engine.shouldStop()) break;

      scrollAttempts++;
      // Smart Scroll (Mimicking Crawlee)
      await dataExtractor.scrollToBottomSmart(activePage, constants.WAIT_FOR_NEW_TWEETS_TIMEOUT);
      // Double check DOM update
      await dataExtractor.waitForNewTweets(activePage, tweetsOnPage.length, 2000);

      const newTweets = await dataExtractor.extractTweetsFromPage(activePage);
      for (const tweet of newTweets) {
        if (allReplies.length >= maxReplies) break;
        if (tweet.id === originalTweet?.id) continue;
        if (!scrapedReplyIds.has(tweet.id)) {
          allReplies.push(tweet as Tweet);
          scrapedReplyIds.add(tweet.id);
        }
      }
    }

    const allTweets = originalTweet ? [originalTweet, ...allReplies] : allReplies;

    // Save
    if (allTweets.length > 0) {
      if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
      if (exportCsv) await exportUtils.exportToCsv(allTweets, runContext);
      if (exportJson) await exportUtils.exportToJson(allTweets, runContext);
    }

    const currentSession = engine.getCurrentSession();
    if (currentSession) {
      engine.sessionManager.markGood(currentSession.id);
    }

    return {
      success: true,
      tweets: allTweets,
      originalTweet,
      replies: allReplies,
      runContext
    };

  } catch (error: unknown) {
    const scraperError = ErrorClassifier.classify(error);
    engine.eventBus.emitError(new Error(`Thread scraping (DOM) failed: ${scraperError.message}`));
    return { 
      success: false, 
      tweets: [], 
      error: scraperError.getUserMessage(),
      code: scraperError.code,
      retryable: scraperError.retryable
    };
  }
}
