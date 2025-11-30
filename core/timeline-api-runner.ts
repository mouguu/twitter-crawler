import type {
  ScrapeTimelineConfig,
  ScrapeTimelineResult,
} from "./scraper-engine.types";
import type { ScraperEngine } from "./scraper-engine";
import { ScraperError, ScraperErrors } from "./errors";
import {
  Tweet,
  extractInstructionsFromResponse,
  parseTweetsFromInstructions,
  extractNextCursor,
} from "../types";
import * as fileUtils from "../utils";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runTimelineApi(
  engine: ScraperEngine,
  config: ScrapeTimelineConfig
): Promise<ScrapeTimelineResult> {
  const {
    username,
    limit = 50,
    mode = "timeline",
    searchQuery,
    scrapeMode = "graphql",
  } = config;
  const totalTarget = limit;

  let { runContext } = config;
  if (!runContext) {
    const identifier = username || searchQuery || "unknown";
    runContext = await fileUtils.createRunContext({
      platform: "x",
      identifier,
      baseOutputDir: config.outputDir,
    });
    engine.eventBus.emitLog(`Created new run context: ${runContext.runId}`);
  }

  const collectedTweets: Tweet[] = [];
  const scrapedIds = new Set<string>();
  let cursor: string | undefined;
  let userId: string | null = null;

  if (mode === "timeline" && username) {
    try {
      engine.eventBus.emitLog(`Resolving user ID for ${username}...`);
      const apiClient = engine.ensureApiClient();
      userId = await apiClient.getUserByScreenName(username);
      if (!userId) {
        throw ScraperErrors.userNotFound(username);
      }
      engine.eventBus.emitLog(`Resolved user ID: ${userId}`);
    } catch (error: any) {
      const errorMessage =
        error instanceof ScraperError
          ? error.message
          : `Failed to resolve user: ${error.message}`;
      return { success: false, tweets: [], error: errorMessage };
    }
  }

  let consecutiveErrors = 0;
  let consecutiveEmptyResponses = 0;
  const attemptedSessions = new Set<string>();
  let search404Retried = false;
  const currentSession = engine.getCurrentSession();
  if (currentSession) attemptedSessions.add(currentSession.id);

  const cursorHistory: Array<{
    cursor: string;
    sessionId: string;
    hasTweets: boolean;
  }> = [];
  const emptyCursorSessions = new Map<string, Set<string>>();

  while (collectedTweets.length < limit) {
    if (engine.shouldStop()) {
      engine.eventBus.emitLog("Manual stop signal received.");
      break;
    }

    try {
      const apiClient = engine.ensureApiClient();
      let response: any;

      const apiStartTime = Date.now();
      engine.performanceMonitor.startPhase(
        mode === "search" ? "api-search" : "api-fetch-tweets"
      );

      if (mode === "search" && searchQuery) {
        engine.eventBus.emitLog(
          `Fetching search results for "${searchQuery}"...`
        );
        response = await apiClient.searchTweets(searchQuery, 20, cursor);
      } else if (userId) {
        engine.eventBus.emitLog(`Fetching tweets for user ${username}...`);
        response = await apiClient.getUserTweets(userId, 40, cursor);
      } else {
        throw ScraperErrors.invalidConfiguration(
          "Invalid configuration: missing username or search query"
        );
      }

      const apiLatency = Date.now() - apiStartTime;
      engine.performanceMonitor.endPhase();
      engine.performanceMonitor.recordApiRequest(apiLatency, false);

      engine.performanceMonitor.startPhase("parse-api-response");
      const { tweets, nextCursor } = parseApiResponse(response, username);
      const parseTime = Date.now() - apiStartTime - apiLatency;
      engine.performanceMonitor.endPhase();
      engine.performanceMonitor.recordApiParse(parseTime);

      logCursorDiagnostics(engine, tweets.length, cursor, nextCursor);

      const { shouldContinue, updatedCursor, updatedConsecutiveEmpty } =
        await handleCursorState({
          engine,
          tweets,
          nextCursor,
          cursor,
          collectedTweets,
          limit,
          consecutiveEmptyResponses,
          attemptedSessions,
          cursorHistory,
          emptyCursorSessions,
        });

      cursor = updatedCursor;
      consecutiveEmptyResponses = updatedConsecutiveEmpty;

      if (!shouldContinue && (!nextCursor || nextCursor === cursor)) {
        break;
      }
      if (!shouldContinue) {
        continue;
      }

      let addedCount = 0;
      for (const tweet of tweets) {
        if (collectedTweets.length >= limit) break;

        if (!scrapedIds.has(tweet.id)) {
          if (config.stopAtTweetId && tweet.id === config.stopAtTweetId) {
            engine.eventBus.emitLog(`Reached stop tweet ID: ${tweet.id}`);
            cursor = undefined;
            break;
          }
          if (config.sinceTimestamp && tweet.time) {
            const tweetTime = new Date(tweet.time).getTime();
            if (tweetTime < config.sinceTimestamp) {
              engine.eventBus.emitLog(`Reached time limit: ${tweet.time}`);
              cursor = undefined;
              break;
            }
          }

          collectedTweets.push(tweet);
          scrapedIds.add(tweet.id);
          addedCount++;
        }
      }

      engine.eventBus.emitLog(
        `Fetched ${tweets.length} tweets, added ${addedCount} new. Total: ${collectedTweets.length}`
      );
      engine.eventBus.emitProgress({
        current: collectedTweets.length,
        target: limit,
        action: "scraping",
      });
      engine.progressManager.updateProgress(
        collectedTweets.length,
        tweets[tweets.length - 1]?.id,
        nextCursor,
        engine.getCurrentSession()?.id
      );
      engine.performanceMonitor.recordTweets(collectedTweets.length);
      engine.emitPerformanceUpdate();

      cursor = nextCursor;
      consecutiveErrors = 0;
      search404Retried = false;

      const baseDelay = consecutiveErrors > 0 ? 2000 : 100;
      const delay = baseDelay + Math.random() * 400;
      await sleep(delay);
    } catch (error: any) {
      const handled = await handleApiError({
        engine,
        error,
        mode,
        cursor,
        collectedTweets,
        attemptedSessions,
        consecutiveErrors,
        search404Retried,
      });

      ({ cursor, consecutiveErrors, search404Retried } = handled);

      if (handled.shouldBreak) {
        break;
      }
    }
  }

  const success = collectedTweets.length > 0;
  return {
    success,
    tweets: collectedTweets,
    runContext,
    error: success ? undefined : "No tweets collected",
  };
}

function parseApiResponse(response: any, fallbackUsername?: string) {
  const instructions = extractInstructionsFromResponse(response);
  const tweets = parseTweetsFromInstructions(instructions, fallbackUsername);
  const nextCursor = extractNextCursor(instructions);
  return { tweets, nextCursor };
}

interface CursorStateParams {
  engine: ScraperEngine;
  tweets: Tweet[];
  nextCursor?: string;
  cursor?: string;
  collectedTweets: Tweet[];
  limit: number;
  consecutiveEmptyResponses: number;
  attemptedSessions: Set<string>;
  cursorHistory: Array<{
    cursor: string;
    sessionId: string;
    hasTweets: boolean;
  }>;
  emptyCursorSessions: Map<string, Set<string>>;
}

async function handleCursorState({
  engine,
  tweets,
  nextCursor,
  cursor,
  collectedTweets,
  limit,
  consecutiveEmptyResponses,
  attemptedSessions,
  cursorHistory,
  emptyCursorSessions,
}: CursorStateParams): Promise<{
  shouldContinue: boolean;
  updatedCursor?: string;
  updatedConsecutiveEmpty: number;
}> {
  if (!nextCursor || nextCursor === cursor) {
    if (tweets.length === 0) {
      engine.eventBus.emitLog(
        `No more tweets found. Reached end of timeline. (Collected: ${collectedTweets.length}/${limit})`
      );
      return {
        shouldContinue: false,
        updatedCursor: nextCursor,
        updatedConsecutiveEmpty: 0,
      };
    }
    engine.eventBus.emitLog(
      `Reached end of timeline (last page). (Collected: ${collectedTweets.length}/${limit})`
    );
    return {
      shouldContinue: true,
      updatedCursor: nextCursor,
      updatedConsecutiveEmpty: 0,
    };
  }

  if (tweets.length === 0) {
    return await handleEmptyCursor({
      engine,
      nextCursor,
      cursor,
      collectedTweets,
      limit,
      consecutiveEmptyResponses,
      attemptedSessions,
      cursorHistory,
      emptyCursorSessions,
    });
  }

  return {
    shouldContinue: true,
    updatedCursor: nextCursor,
    updatedConsecutiveEmpty: 0,
  };
}

interface EmptyCursorParams {
  engine: ScraperEngine;
  nextCursor?: string;
  cursor?: string;
  collectedTweets: Tweet[];
  limit: number;
  consecutiveEmptyResponses: number;
  attemptedSessions: Set<string>;
  cursorHistory: Array<{
    cursor: string;
    sessionId: string;
    hasTweets: boolean;
  }>;
  emptyCursorSessions: Map<string, Set<string>>;
}

async function handleEmptyCursor({
  engine,
  nextCursor,
  cursor,
  collectedTweets,
  limit,
  consecutiveEmptyResponses,
  attemptedSessions,
  cursorHistory,
  emptyCursorSessions,
}: EmptyCursorParams) {
  const updatedConsecutive = consecutiveEmptyResponses + 1;
  const currentSessionId = engine.getCurrentSession()?.id || "unknown";
  const cursorValue = nextCursor || "";
  const cursorNumMatch = cursorValue.match(/\d+/);
  const cursorNum = cursorNumMatch ? BigInt(cursorNumMatch[0]) : null;

  if (cursorHistory.length > 0) {
    const lastCursor = cursorHistory[cursorHistory.length - 1]?.cursor;
    const lastCursorMatch = lastCursor?.match(/\d+/);
    const lastCursorNum = lastCursorMatch ? BigInt(lastCursorMatch[0]) : null;

    if (cursorNum && lastCursorNum && cursorNum === lastCursorNum) {
      engine.eventBus.emitLog(
        `[DIAGNOSIS] Cursor value unchanged (${cursorValue}), may have reached API boundary`,
        "warn"
      );
    } else if (cursorNum && lastCursorNum && cursorNum < lastCursorNum) {
      const diff = Number(lastCursorNum - cursorNum);
      if (diff < 10) {
        engine.eventBus.emitLog(
          `[DIAGNOSIS] Cursor decreasing very slowly (diff: ${diff}), may be near API limit`,
          "warn"
        );
      }
    }
  }

  if (!emptyCursorSessions.has(nextCursor || "")) {
    emptyCursorSessions.set(nextCursor || "", new Set());
  }
  emptyCursorSessions.get(nextCursor || "")?.add(currentSessionId);
  cursorHistory.push({
    cursor: nextCursor || "",
    sessionId: currentSessionId,
    hasTweets: false,
  });

  if (updatedConsecutive === 1) {
    engine.eventBus.emitLog(
      `[DIAGNOSIS] First empty response at cursor ${cursorValue}. Possible reasons: API limit (~800-900 tweets), rate limit, or timeline end.`,
      "info"
    );
  }

  const sessionsAtThisCursor =
    emptyCursorSessions.get(nextCursor || "")?.size || 0;
  const allActiveSessions = engine.sessionManager.getAllActiveSessions();
  const hasMoreSessions = allActiveSessions.some(
    (s) => !attemptedSessions.has(s.id)
  );
  const likelyRealEnd = sessionsAtThisCursor >= 3 || !hasMoreSessions;

  if (!engine.isRotationEnabled()) {
    engine.eventBus.emitLog(
      `Auto-rotation disabled. Stopping at cursor ${cursorValue} after empty response. Collected: ${collectedTweets.length}/${limit}`,
      "warn"
    );
    return {
      shouldContinue: false,
      updatedCursor: nextCursor,
      updatedConsecutiveEmpty: updatedConsecutive,
    };
  }

  if (updatedConsecutive >= 2 && attemptedSessions.size < 4 && !likelyRealEnd) {
    const untriedSessions = allActiveSessions.filter(
      (s) => !attemptedSessions.has(s.id)
    );

    if (untriedSessions.length > 0) {
      const nextSession = untriedSessions[0];
      engine.eventBus.emitLog(
        `Found ${untriedSessions.length} untried session(s): ${untriedSessions
          .map((s) => s.id)
          .join(", ")}`,
        "debug"
      );
      try {
        await engine.applySession(nextSession, {
          refreshFingerprint: false,
          clearExistingCookies: true,
        });
        attemptedSessions.add(nextSession.id);
        engine.performanceMonitor.recordSessionSwitch();
        engine.eventBus.emitLog(
          `Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried). Retrying same cursor...`,
          "info"
        );
        await sleep(200 + Math.random() * 300);
        return {
          shouldContinue: true,
          updatedCursor: cursor,
          updatedConsecutiveEmpty: 0,
        };
      } catch (e: any) {
        engine.eventBus.emitLog(
          `Session rotation failed: ${e.message}`,
          "error"
        );
        attemptedSessions.add(nextSession.id);
      }
    } else {
      engine.eventBus.emitLog(
        `No more untried sessions available. All sessions have been tested: ${Array.from(
          attemptedSessions
        ).join(", ")}`
      );
    }
  }

  const allSessionsTried = attemptedSessions.size >= 4;
  const shouldStop =
    (updatedConsecutive >= 3 && likelyRealEnd) ||
    (allSessionsTried && sessionsAtThisCursor >= attemptedSessions.size) ||
    updatedConsecutive >= 5;

  if (shouldStop) {
    const triedSessionsList = Array.from(attemptedSessions).join(", ");
    const reason = allSessionsTried
      ? `All ${attemptedSessions.size} sessions (${triedSessionsList}) confirmed empty at this cursor - likely reached Twitter/X API limit (~${collectedTweets.length} tweets)`
      : likelyRealEnd
      ? `Multiple sessions (${sessionsAtThisCursor}) confirmed empty at this cursor position - likely reached timeline end`
      : `Maximum retry attempts (${updatedConsecutive}) reached`;
    engine.eventBus.emitLog(
      `${reason}. Stopping. (Collected: ${collectedTweets.length}/${limit})`,
      "warn"
    );
    if (collectedTweets.length < limit) {
      engine.eventBus.emitLog(
        `Analysis: Twitter/X GraphQL API appears to have a limit of ~${collectedTweets.length} tweets per request chain.`,
        "info"
      );
      engine.eventBus.emitLog(
        `Recommendation: Use 'puppeteer' mode (DOM scraping) for deeper timeline access beyond API limits.`,
        "info"
      );
    }
    return {
      shouldContinue: false,
      updatedCursor: nextCursor,
      updatedConsecutiveEmpty: updatedConsecutive,
    };
  }

  const retryDelay = 500 + Math.random() * 500;
  engine.eventBus.emitLog(
    `Empty response (${sessionsAtThisCursor} session(s) tried at this cursor, attempt ${updatedConsecutive}). Retrying in ${Math.round(
      retryDelay
    )}ms...`,
    "warn"
  );
  await sleep(retryDelay);

  return {
    shouldContinue: true,
    updatedCursor: nextCursor,
    updatedConsecutiveEmpty: updatedConsecutive,
  };
}

interface ErrorHandlingResult {
  cursor?: string;
  consecutiveErrors: number;
  search404Retried: boolean;
  shouldBreak: boolean;
}

interface ApiErrorParams {
  engine: ScraperEngine;
  error: any;
  mode: string;
  cursor?: string;
  collectedTweets: Tweet[];
  attemptedSessions: Set<string>;
  consecutiveErrors: number;
  search404Retried: boolean;
}

async function handleApiError({
  engine,
  error,
  mode,
  cursor,
  collectedTweets,
  attemptedSessions,
  consecutiveErrors,
  search404Retried,
}: ApiErrorParams): Promise<ErrorHandlingResult> {
  engine.performanceMonitor.endPhase();
  engine.eventBus.emitLog(
    `API Error: ${error instanceof Error ? error.message : String(error)}`,
    "error"
  );

  if (
    String(error.message || "").includes("404") &&
    mode === "search" &&
    cursor
  ) {
    if (!search404Retried) {
      engine.eventBus.emitLog(
        `404 error with cursor in search mode. Refreshing search headers/xclid and retrying current cursor once...`,
        "warn"
      );
      await sleep(300 + Math.random() * 300);
      return {
        cursor,
        consecutiveErrors,
        search404Retried: true,
        shouldBreak: false,
      };
    }
    engine.eventBus.emitLog(
      `404 error repeated after retry. Treating as end of results.`,
      "warn"
    );
    return {
      cursor,
      consecutiveErrors,
      search404Retried: true,
      shouldBreak: true,
    };
  }

  let updatedConsecutiveErrors = consecutiveErrors + 1;

  if (
    (error.message && error.message.includes("429")) ||
    (error.message && error.message.includes("Authentication failed")) ||
    updatedConsecutiveErrors >= 3
  ) {
    engine.performanceMonitor.recordRateLimit();
    const waitStartTime = Date.now();

    if (!engine.isRotationEnabled()) {
      engine.eventBus.emitLog(
        `Auto-rotation disabled. Stopping after error: ${error.message}`,
        "warn"
      );
      return {
        cursor,
        consecutiveErrors: updatedConsecutiveErrors,
        search404Retried: false,
        shouldBreak: true,
      };
    }

    engine.eventBus.emitLog(
      `API Error: ${error.message}. Attempting session rotation...`,
      "warn"
    );
    const allActiveSessions = engine.sessionManager.getAllActiveSessions();
    const untriedSessions = allActiveSessions.filter(
      (s) => !attemptedSessions.has(s.id)
    );

    if (untriedSessions.length > 0) {
      const nextSession = untriedSessions[0];
      engine.eventBus.emitLog(
        `Found ${
          untriedSessions.length
        } untried session(s) for rotation: ${untriedSessions
          .map((s) => s.id)
          .join(", ")}`,
        "debug"
      );
      try {
        await engine.applySession(nextSession, {
          refreshFingerprint: false,
          clearExistingCookies: true,
        });
        attemptedSessions.add(nextSession.id);
        updatedConsecutiveErrors = 0;
        engine.performanceMonitor.recordSessionSwitch();
        const waitTime = Date.now() - waitStartTime;
        engine.performanceMonitor.recordRateLimitWait(waitTime);
        engine.performanceMonitor.recordTweets(collectedTweets.length);
        engine.emitPerformanceUpdate();
        engine.eventBus.emitLog(
          `Switched to session: ${nextSession.id} (${
            attemptedSessions.size
          } session(s) tried: ${Array.from(attemptedSessions).join(
            ", "
          )}). Retrying...`,
          "info"
        );
        return {
          cursor,
          consecutiveErrors: updatedConsecutiveErrors,
          search404Retried: false,
          shouldBreak: false,
        };
      } catch (e: any) {
        engine.eventBus.emitLog(
          `Session rotation failed: ${e.message}`,
          "error"
        );
        attemptedSessions.add(nextSession.id);
      }
    }

    if (untriedSessions.length === 0) {
      engine.eventBus.emitLog(
        `All ${attemptedSessions.size} session(s) (${Array.from(
          attemptedSessions
        ).join(
          ", "
        )}) have been tried. Rate limit may be account-wide or IP-based. Stopping.`,
        "error"
      );
      return {
        cursor,
        consecutiveErrors: updatedConsecutiveErrors,
        search404Retried: false,
        shouldBreak: true,
      };
    }
  } else {
    engine.performanceMonitor.recordApiRequest(0, true);
    engine.eventBus.emitLog(
      `Transient error: ${error.message}. Retrying...`,
      "warn"
    );
    const waitTime = 500 + Math.random() * 500;
    await sleep(waitTime);
    engine.performanceMonitor.recordRateLimitWait(waitTime);
    engine.performanceMonitor.recordTweets(collectedTweets.length);
    engine.emitPerformanceUpdate();
    return {
      cursor,
      consecutiveErrors: updatedConsecutiveErrors,
      search404Retried: false,
      shouldBreak: false,
    };
  }

  return {
    cursor,
    consecutiveErrors: updatedConsecutiveErrors,
    search404Retried: false,
    shouldBreak: false,
  };
}

function logCursorDiagnostics(
  engine: ScraperEngine,
  tweetCount: number,
  cursor?: string,
  nextCursor?: string
) {
  if (!nextCursor || nextCursor === cursor) {
    if (tweetCount === 0) {
      engine.eventBus.emitLog(
        `[DEBUG] API returned ${tweetCount} tweets, no cursor (prev cursor: ${
          cursor ? "exists" : "none"
        })`
      );
    } else {
      engine.eventBus.emitLog(
        `[DEBUG] API returned ${tweetCount} tweets, no new cursor (prev cursor: ${
          cursor ? "exists" : "none"
        }) - likely last page`
      );
    }
  } else {
    engine.eventBus.emitLog(
      `[DEBUG] API returned ${tweetCount} tweets, new cursor exists`
    );
  }
}
