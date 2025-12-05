import { ScraperEngine } from "../scraper-engine";
import { ScraperErrors } from "../errors";
import { createEventBus } from "../event-bus";
import { createEnhancedLogger } from "../../utils/logger";
import { PlatformAdapter } from "./types";

const logger = createEnhancedLogger("TwitterAdapter");

export const twitterAdapter: PlatformAdapter = {
  name: "twitter",

  async process(data, ctx) {
    const { config: jobConfig } = data;
    const startTime = Date.now();

    const jobEventBus = createEventBus();
    jobEventBus.on(jobEventBus.events.SCRAPE_PROGRESS, (progress: any) => {
      ctx.emitProgress({
        current: progress.current ?? 0,
        target: progress.target ?? jobConfig.limit ?? 0,
        action: progress.action || "scraping",
      });
    });
    jobEventBus.on(jobEventBus.events.LOG_MESSAGE, (log: any) => {
      ctx.emitLog({
        level: (log.level || "info") as any,
        message: log.message,
        timestamp: log.timestamp ? new Date(log.timestamp).getTime() : Date.now(),
      });
    });

    await ctx.log(
      `Starting Twitter scrape: ${jobConfig.username || jobConfig.tweetUrl || jobConfig.searchQuery}`
    );

    const engine = new ScraperEngine(() => ctx.getShouldStop(), {
      apiOnly: jobConfig.mode === "graphql",
      eventBus: jobEventBus,
      jobId: data.jobId, // Pass BullMQ Job ID
      antiDetectionLevel: jobConfig.antiDetectionLevel,
    });

    let result: any;

    try {
      await engine.init();
      engine.proxyManager.setEnabled(jobConfig.enableProxy || false);

      const cookiesLoaded = await engine.loadCookies(jobConfig.enableRotation !== false);
      if (!cookiesLoaded) {
        throw ScraperErrors.cookieLoadFailed("Failed to load cookies");
      }

      if (jobConfig.username) {
        await ctx.log(`Scraping @${jobConfig.username}'s ${jobConfig.tab || "posts"}...`);

        const timelineConfig: any = {
          username: jobConfig.username,
          limit: jobConfig.limit || 50,
          saveMarkdown: true,
          scrapeMode: (jobConfig.mode || "puppeteer") as "puppeteer" | "graphql",
          dateRange: jobConfig.dateRange,
          jobId: data.jobId, // Pass to config as well
        };

        if (jobConfig.tab === "likes" || jobConfig.tab === "replies") {
          timelineConfig.tab = jobConfig.tab;
        }

        result = await engine.scrapeTimeline(timelineConfig);

        if (result?.tweets) {
          await ctx.emitProgress({
            current: result.tweets.length,
            target: jobConfig.limit || 50,
            action: `Scraped ${result.tweets.length} tweets`,
          });
        }

        if (jobConfig.likes && jobConfig.mode !== "graphql") {
          await ctx.log("Fetching liked tweets...");
          const likesResult = await engine.scrapeTimeline({
            username: jobConfig.username,
            tab: "likes",
            limit: jobConfig.limit || 50,
            saveMarkdown: false,
            scrapeMode: "puppeteer",
          });

          if (likesResult.success && likesResult.tweets) {
            const likedTweets = likesResult.tweets.map((t: any) => ({
              ...t,
              isLiked: true,
            }));
            result.tweets = [...(result.tweets || []), ...likedTweets];
            await ctx.log(`Added ${likedTweets.length} liked tweets`);
          }
        }
      } else if (jobConfig.tweetUrl) {
        await ctx.log(`Scraping thread: ${jobConfig.tweetUrl}`);

        result = await engine.scrapeThread({
          tweetUrl: jobConfig.tweetUrl,
          maxReplies: jobConfig.limit || 50,
          saveMarkdown: true,
          scrapeMode: (jobConfig.mode || "puppeteer") as "puppeteer" | "graphql",
        });

        if (result?.tweets) {
          await ctx.emitProgress({
            current: result.tweets.length,
            target: jobConfig.limit || 50,
            action: `Scraped ${result.tweets.length} replies`,
          });
        }
      } else if (jobConfig.searchQuery) {
        await ctx.log(`Searching: "${jobConfig.searchQuery}"`);

        result = await engine.scrapeTimeline({
          mode: "search",
          searchQuery: jobConfig.searchQuery,
          limit: jobConfig.limit || 50,
          saveMarkdown: true,
          scrapeMode: jobConfig.mode || "puppeteer",
          dateRange: jobConfig.dateRange,
        });

        if (result?.tweets) {
          await ctx.emitProgress({
            current: result.tweets.length,
            target: jobConfig.limit || 50,
            action: `Found ${result.tweets.length} tweets`,
          });
        }
      } else {
        throw new Error(
          "Invalid Twitter job configuration: missing username, tweetUrl, or searchQuery"
        );
      }
    } catch (error: any) {
      await ctx.log(`Error: ${error.message}`, "error");
      logger.error("Twitter scraping failed", error);
      throw error;
    } finally {
      await engine.close();
    }

    if (result?.success && result.runContext?.markdownIndexPath) {
      const duration = Date.now() - startTime;
      await ctx.log(`Scraping completed successfully! (${(duration / 1000).toFixed(1)}s)`, "info");

      return {
        success: true,
        downloadUrl: `/api/download?path=${encodeURIComponent(result.runContext.markdownIndexPath)}`,
        stats: {
          count: result.tweets?.length || 0,
          duration,
        },
        performance: result.performance,
      };
    }

    throw new Error(result?.error || "Scraping failed with unknown error");
  },

  classifyError(err: any) {
    if (err?.response?.status === 401) return "auth";
    if (err?.response?.status === 404) return "not_found";
    if (err?.response?.status === 429) return "rate_limit";
    return "unknown";
  },
};
