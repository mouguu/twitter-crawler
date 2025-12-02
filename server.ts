import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as scraper from "./scrape-unified";
// 注意: scrapeProfileGraphql 已废弃，统一使用 ScraperEngine
import {
  eventBusInstance,
  ScrapeProgressData,
  LogMessageData,
  getShouldStopScraping,
  resetShouldStopScraping,
  setShouldStopScraping,
  RequestQueue,
  RequestTask,
  ScraperEngine,
  MonitorService,
  ScraperErrors,
  ScraperError,
  createCookieManager,
  RedditApiClient,
} from "./core";
import {
  createEnhancedLogger,
  getOutputPathManager,
  getConfigManager,
  setLogLevel,
} from "./utils";
import * as fileUtils from "./utils/fileutils";
import { apiKeyMiddleware } from "./middleware/api-key";
import {
  ScrapeRequest,
  MonitorRequest,
  ScrapeResponse,
  MonitorResponse,
  isScrapeRequest,
  isMonitorRequest,
} from "./types";
import multer from "multer";
import { TaskQueueManager } from "./server/task-queue";

// 创建服务器日志器
const serverLogger = createEnhancedLogger("Server");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const cookiesDir = path.join(process.cwd(), "cookies");
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }
    cb(null, cookiesDir);
  },
  filename: (req, file, cb) => {
    // Ensure .json extension
    const name = file.originalname.endsWith(".json")
      ? file.originalname
      : `${file.originalname}.json`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/json" ||
      file.originalname.endsWith(".json")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only JSON files are allowed"));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

const app = express();

const configManager = getConfigManager();
const serverConfig = configManager.getServerConfig();
const outputConfig = configManager.getOutputConfig();
const twitterConfig = configManager.getTwitterConfig();
const redditConfig = configManager.getRedditConfig();
const LOG_CONFIG = configManager.getLoggingConfig();

setLogLevel(LOG_CONFIG.level);

const PORT = serverConfig.port;

// 统一使用 OutputPathManager，删除 legacy 路径
const outputPathManager = getOutputPathManager({
  baseDir: outputConfig.baseDir,
});
const OUTPUT_ROOT = outputPathManager.getBaseDir();
const STATIC_DIR = path.resolve(process.cwd(), "public");

// Global state for manual stop
let isScrapingActive = false;
let lastDownloadUrl: string | null = null;
let isShuttingDown = false;
const activeTasks = new Set<Promise<unknown>>();
const requestQueue = new RequestQueue({ persistIntervalMs: 0 });
const taskQueue = new TaskQueueManager(requestQueue, {
  isShuttingDown: () => isShuttingDown,
});

async function trackTask<T>(fn: () => Promise<T>): Promise<T> {
  const taskPromise = fn();
  activeTasks.add(taskPromise);
  try {
    return await taskPromise;
  } finally {
    activeTasks.delete(taskPromise);
  }
}

function rejectIfShuttingDown(res: Response): boolean {
  if (isShuttingDown) {
    res.status(503).json({ error: "Server is shutting down" });
    return true;
  }
  return false;
}

// Middleware
app.use(express.json());
app.use(express.static(STATIC_DIR));
app.use("/api", apiKeyMiddleware);

function getSafePathInfo(resolvedPath: string): {
  identifier?: string;
  runTimestamp?: string;
  tweetCount?: number;
} {
  // 使用统一的 OUTPUT_ROOT，删除 legacy 支持
  const relPath = path.relative(OUTPUT_ROOT, resolvedPath);
  if (relPath.startsWith("..")) return {};

  const parts = relPath.split(path.sep).filter(Boolean);
  // expected: platform / identifier / run-xxxx / file
  if (parts.length < 3) return {};

  const identifier = parts[1];
  const runId = parts[2];

  let runTimestamp: string | undefined;
  const match = runId.match(/run-(.+)/);
  if (match && match[1]) {
    runTimestamp = match[1];
  }

  // Try to read tweet count from sibling tweets.json
  try {
    const dir = path.dirname(resolvedPath);
    const tweetsJsonPath = path.join(dir, "tweets.json");
    if (fs.existsSync(tweetsJsonPath)) {
      const data = JSON.parse(fs.readFileSync(tweetsJsonPath, "utf-8"));
      if (Array.isArray(data)) {
        return { identifier, runTimestamp, tweetCount: data.length };
      }
    }
  } catch {
    // ignore parse errors
  }

  return { identifier, runTimestamp };
}

// API: Scrape
app.post(
  "/api/scrape",
  async (
    req: Request<{}, {}, ScrapeRequest>,
    res: Response<ScrapeResponse>
  ) => {
    if (rejectIfShuttingDown(res)) return;

    const queueType: RequestTask["type"] =
      req.body?.type === "thread"
        ? "thread"
        : req.body?.type === "search"
        ? "search"
        : req.body?.type === "reddit"
        ? "reddit"
        : "timeline";
    const queueKey =
      typeof req.body?.input === "string" && req.body.input
        ? req.body.input
        : queueType;

    try {
      await taskQueue.enqueue(
        { url: queueKey, type: queueType, priority: 1 },
        () =>
          trackTask(async () => {
            try {
              const {
                type,
                input,
                limit = 50,
                likes = false,
                mode,
                dateRange,
                enableRotation = true,
                enableProxy = false,
              } = req.body;

              serverLogger.info("收到爬取请求", { type, input, limit });

              // Reset stop flag and set active state
              resetShouldStopScraping();
              isScrapingActive = true;
              lastDownloadUrl = null; // Clear previous result

              let result:
                | scraper.ScrapeTimelineResult
                | scraper.ScrapeThreadResult
                | undefined;

              if (type === "profile") {
                // Profile Scrape - 统一使用 ScraperEngine
                const username = input
                  .replace("@", "")
                  .replace("https://x.com/", "")
                  .replace("/", "");
                const scrapeMode =
                  mode === "graphql" || mode === "mixed" ? mode : "puppeteer";
                const apiOnly = scrapeMode === "graphql"; // graphql 模式不需要浏览器

                const engine = new ScraperEngine(
                  () => getShouldStopScraping(),
                  { apiOnly }
                );

                try {
                  await engine.init();
                  // Apply proxy setting from UI
                  engine.proxyManager.setEnabled(enableProxy);

                  const cookiesLoaded = await engine.loadCookies(
                    enableRotation
                  );

                  if (!cookiesLoaded) {
                    throw ScraperErrors.cookieLoadFailed(
                      "Failed to load cookies"
                    );
                  }

                  result = await engine.scrapeTimeline({
                    username,
                    limit,
                    saveMarkdown: true,
                    scrapeMode,
                    dateRange,
                  });

                  // 如果需要抓取 likes，使用 DOM 模式单独处理
                  if (likes && scrapeMode !== "graphql" && result) {
                    const likesResult = await engine.scrapeTimeline({
                      username,
                      tab: "likes",
                      limit,
                      saveMarkdown: false,
                      scrapeMode: "puppeteer",
                    });
                    if (likesResult.success && likesResult.tweets) {
                      const likedTweets = likesResult.tweets.map((t: any) => ({
                        ...t,
                        isLiked: true,
                      }));
                      result.tweets = [
                        ...(result.tweets || []),
                        ...likedTweets,
                      ];
                    }
                  }
                } finally {
                  await engine.close();
                }
              } else if (type === "thread") {
                // Thread Scrape - 统一使用 ScraperEngine
                const scrapeMode =
                  mode === "puppeteer" ? "puppeteer" : "graphql";
                const apiOnly = scrapeMode === "graphql"; // graphql 模式不需要浏览器

                const engine = new ScraperEngine(
                  () => getShouldStopScraping(),
                  { apiOnly }
                );

                try {
                  await engine.init();
                  // Apply proxy setting from UI
                  engine.proxyManager.setEnabled(enableProxy);

                  const cookiesLoaded = await engine.loadCookies(
                    enableRotation
                  );

                  if (!cookiesLoaded) {
                    throw ScraperErrors.cookieLoadFailed(
                      "Failed to load cookies"
                    );
                  }

                  result = await engine.scrapeThread({
                    tweetUrl: input,
                    maxReplies: limit,
                    saveMarkdown: true,
                    scrapeMode,
                  });
                } finally {
                  await engine.close();
                }
              } else if (type === "search") {
                // Search Scrape - 统一使用 ScraperEngine
                const scrapeMode = mode === "graphql" ? "graphql" : "puppeteer";
                const apiOnly = scrapeMode === "graphql"; // graphql 模式不需要浏览器

                const engine = new ScraperEngine(
                  () => getShouldStopScraping(),
                  { apiOnly }
                );

                try {
                  await engine.init();
                  // Apply proxy setting from UI
                  engine.proxyManager.setEnabled(enableProxy);

                  const cookiesLoaded = await engine.loadCookies(
                    enableRotation
                  );

                  if (!cookiesLoaded) {
                    throw ScraperErrors.cookieLoadFailed(
                      "Failed to load cookies"
                    );
                  }

                  result = await engine.scrapeTimeline({
                    mode: "search",
                    searchQuery: input,
                    limit,
                    saveMarkdown: true,
                    scrapeMode, // 使用用户选择的模式，而不是强制 puppeteer
                    dateRange,
                  });
                } finally {
                  await engine.close();
                }
              } else if (type === "reddit") {
                // Reddit Scrape - 使用 HTTP API 替代 spawn
                const redditClient = new RedditApiClient(
                  redditConfig.apiUrl,
                  redditConfig.apiTimeout
                );

                // Detect if input is a URL or subreddit name
                const isPostUrl =
                  input &&
                  ((input.includes("reddit.com/r/") &&
                    input.includes("/comments/")) ||
                    input.includes("redd.it/"));

                serverLogger.info("开始 Reddit 爬取", {
                  mode: isPostUrl ? "post" : "subreddit",
                  input,
                });
                eventBusInstance.emitLog(
                  `Starting Reddit scraper for ${
                    isPostUrl ? "post URL" : `r/${input || "UofT"}`
                  }...`,
                  "info"
                );

                try {
                  // 检查服务健康状态
                  const isHealthy = await redditClient.healthCheck();
                  if (!isHealthy) {
                    throw ScraperErrors.apiRequestFailed(
                      "Reddit API server is not available. Please start it with: python3 platforms/reddit/reddit_api_server.py",
                      undefined,
                      { type: "reddit", service: "health_check_failed" }
                    );
                  }

                  let redditResult;
                  const redditStrategy =
                    req.body?.strategy || redditConfig.defaultStrategy;

                  if (isPostUrl) {
                    redditResult = await redditClient.scrapePost(input);
                  } else {
                    redditResult = await redditClient.scrapeSubreddit({
                      subreddit: input || "UofT",
                      maxPosts: limit,
                      strategy: redditStrategy,
                      saveJson: true,
                      onProgress: (current, total, message) => {
                        eventBusInstance.emitProgress({
                          current,
                          target: total,
                          action: message,
                        });
                      },
                      onLog: (message, level = 'info') => {
                        eventBusInstance.emitLog(message, level as any);
                      },
                    });
                  }

                  if (redditResult.success && redditResult.data) {
                    const data = redditResult.data;
                    const tweetCount = isPostUrl
                      ? data.comment_count || 0
                      : data.scraped_count || 0;

                    // Emit progress update for Reddit
                    eventBusInstance.emitProgress({
                      current: tweetCount,
                      target: isPostUrl ? tweetCount : limit,
                      action: isPostUrl
                        ? `Scraped ${tweetCount} comments`
                        : `Scraped ${tweetCount} posts`,
                    });

                    // Use actual file path from API response
                    let filePath: string;

                    if (data.file_path) {
                      // API returned a file path - use it
                      filePath = path.resolve(data.file_path);

                      // Validate it's within output directory
                      if (!outputPathManager.isPathSafe(filePath)) {
                        serverLogger.warn(
                          "Reddit API returned file outside output directory",
                          {
                            apiPath: data.file_path,
                            resolved: filePath,
                            outputDir: OUTPUT_ROOT,
                          }
                        );
                        // Security: don't use paths outside output dir
                        throw ScraperErrors.apiRequestFailed(
                          "Reddit API returned invalid file path",
                          undefined,
                          { type: "reddit", path: data.file_path } as any
                        );
                      }

                      // Verify file actually exists
                      if (!fs.existsSync(filePath)) {
                        serverLogger.error(
                          "Reddit API returned non-existent file",
                          undefined,
                          { filePath }
                        );
                        throw ScraperErrors.apiRequestFailed(
                          `Reddit output file not found: ${filePath}`,
                          undefined,
                          { type: "reddit", path: filePath } as any
                        );
                      }
                    } else {
                      // No file_path in response - this shouldn't happen for successful scrapes
                      serverLogger.error(
                        "Reddit API succeeded but returned no file_path",
                        undefined,
                        { data }
                      );
                      throw ScraperErrors.apiRequestFailed(
                        "Reddit scraping completed but no output file was generated",
                        undefined,
                        { type: "reddit", data } as any
                      );
                    }

                    result = {
                      success: true,
                      tweets: Array(tweetCount).fill({}),
                      runContext: {
                        markdownIndexPath: filePath,
                      },
                      message: data.message || "Reddit scraping completed",
                    } as any;
                  } else {
                    throw ScraperErrors.apiRequestFailed(
                      redditResult.error || "Reddit scraping failed",
                      undefined,
                      { type: "reddit", result: redditResult } as any
                    );
                  }
                } catch (error: any) {
                  serverLogger.error("Reddit 爬取失败", error);
                  eventBusInstance.emitLog(`Error: ${error.message}`, "error");

                  // 统一使用 ScraperError，不再回退到 spawn
                  if (error instanceof ScraperError) {
                    throw error;
                  }

                  // 包装为 ScraperError
                  throw ScraperErrors.apiRequestFailed(
                    error.message || "Reddit scraping failed",
                    undefined,
                    { type: "reddit", originalError: error }
                  );
                }
              } else {
                // Invalid type
                res
                  .status(400)
                  .json({ success: false, error: "Invalid scrape type" });
                return;
              }

              const hasTweets =
                result && result.tweets && result.tweets.length > 0;

              if (result && (result.success || hasTweets)) {
                serverLogger.debug("爬取结果", {
                  success: result.success,
                  tweetsCount: result.tweets?.length,
                  hasRunContext: !!result.runContext,
                });

                const runContext = result.runContext;

                if (runContext && runContext.markdownIndexPath) {
                  // Success
                  const downloadUrl = `/api/download?path=${encodeURIComponent(
                    runContext.markdownIndexPath
                  )}`;
                  lastDownloadUrl = downloadUrl; // Save for later retrieval
                  serverLogger.debug("返回成功响应", {
                    downloadUrl: runContext.markdownIndexPath,
                  });

                  // If success is false but we have tweets, treat it as a warning/partial success
                  const message = result.success
                    ? "Scraping completed successfully!"
                    : `Scraping stopped with error but saved ${result.tweets?.length} tweets. Error: ${result.error}`;

                  res.json({
                    success: true, // Return true to frontend so it shows the download button
                    message: message,
                    downloadUrl,
                    stats: {
                      count: result.tweets ? result.tweets.length : 0,
                    },
                    performance: result.performance || undefined,
                  });
                } else {
                  // No file path found
                  serverLogger.error("未找到输出文件路径");
                  res.status(500).json({
                    success: false,
                    error: "Scraping finished but output file not found.",
                  });
                }
              } else {
                // Error and no tweets
                serverLogger.error(
                  "爬取失败",
                  new Error(result?.error || "Unknown error")
                );
                res.status(500).json({
                  success: false,
                  error: result?.error || "Scraping failed",
                });
              }
            } catch (error: any) {
              serverLogger.error("服务器错误", error);
              res.status(500).json({
                success: false,
                error: error.message,
              });
            } finally {
              // Reset scraping state
              isScrapingActive = false;
              resetShouldStopScraping();
            }
          })
      );
    } catch (error: any) {
      serverLogger.error("队列错误", error);
      const shuttingDown =
        isShuttingDown || (error?.message || "").includes("shutting down");
      res.status(shuttingDown ? 503 : 429).json({
        success: false,
        error: shuttingDown
          ? "Server is shutting down"
          : "Another task is already queued or running",
      });
    }
  }
);

// API: Monitor
app.post(
  "/api/monitor",
  async (
    req: Request<{}, {}, MonitorRequest>,
    res: Response<MonitorResponse>
  ) => {
    if (rejectIfShuttingDown(res)) return;

    const queueKey = Array.isArray(req.body?.users)
      ? req.body.users.join(",")
      : "monitor";

    try {
      await taskQueue.enqueue(
        { url: queueKey || "monitor", type: "monitor", priority: 1 },
        () =>
          trackTask(async () => {
            try {
              const {
                users,
                lookbackHours,
                keywords,
                enableRotation = true,
                enableProxy = false,
              } = req.body;
              if (!users || users.length === 0) {
                res
                  .status(400)
                  .json({ success: false, error: "Invalid users list" });
                return;
              }

              serverLogger.info("收到监控请求", { users });

              isScrapingActive = true;
              resetShouldStopScraping();

              const engine = new ScraperEngine(() => getShouldStopScraping());
              await engine.init();
              // Apply proxy setting from UI
              engine.proxyManager.setEnabled(enableProxy);

              const cookiesLoaded = await engine.loadCookies(enableRotation);
              if (!cookiesLoaded) {
                res
                  .status(500)
                  .json({ success: false, error: "Failed to load cookies" });
                return;
              }

              const monitorService = new MonitorService(
                engine,
                eventBusInstance
              );
              await monitorService.runMonitor(users, {
                lookbackHours: lookbackHours || undefined,
                keywords: keywords
                  ? keywords
                      .split(",")
                      .map((k: string) => k.trim())
                      .filter(Boolean)
                  : undefined,
              });

              await engine.close();

              // Check for report file
              const dateStr = new Date().toISOString().split("T")[0];
              const reportPath = path.join(
                OUTPUT_ROOT,
                "reports",
                `daily_report_${dateStr}.md`
              );
              let downloadUrl: string | undefined = undefined;

              if (fs.existsSync(reportPath)) {
                downloadUrl = `/api/download?path=${encodeURIComponent(
                  reportPath
                )}`;
              }

              res.json({
                success: true,
                message: "Monitoring completed",
                downloadUrl: downloadUrl || undefined,
              });
            } catch (error: any) {
              serverLogger.error("监控错误", error);
              res.status(500).json({
                success: false,
                error: error.message,
              });
            } finally {
              isScrapingActive = false;
              resetShouldStopScraping();
            }
          })
      );
    } catch (error: any) {
      serverLogger.error("队列错误", error);
      const shuttingDown =
        isShuttingDown || (error?.message || "").includes("shutting down");
      res.status(shuttingDown ? 503 : 429).json({
        success: false,
        error: shuttingDown
          ? "Server is shutting down"
          : "Another task is already queued or running",
      });
    }
  }
);

// API: Manual Stop
app.post("/api/stop", (req: Request, res: Response) => {
  serverLogger.info("收到手动停止请求");

  if (!isScrapingActive) {
    return res.json({
      success: false,
      message: "No active scraping session",
    });
  }

  setShouldStopScraping(true);
  serverLogger.info("停止信号已设置，等待爬虫优雅终止");

  res.json({
    success: true,
    message: "Stop signal sent. Scraper will terminate after current batch.",
  });
});

// API: Progress Stream (SSE)
app.get("/api/progress", (req: Request, res: Response) => {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event: string, payload: Record<string, any>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Send initial message
  sendEvent("connected", {
    type: "connected",
    message: "Progress stream connected",
  });

  // Listener for progress events
  const onProgress = (data: ScrapeProgressData) => {
    sendEvent("progress", { type: "progress", ...data });
  };

  const onLog = (data: LogMessageData) => {
    sendEvent("log", { type: "log", ...data });
  };

  const onPerformance = (data: any) => {
    sendEvent("performance", { type: "performance", ...data });
  };

  const onError = (error: Error) => {
    serverLogger.error("爬虫错误", error);
    sendEvent("log", { type: "log", level: "error", message: error.message });
  };

  eventBusInstance.on("scrape:progress", onProgress);
  eventBusInstance.on("log:message", onLog);
  eventBusInstance.on("performance:update", onPerformance);
  eventBusInstance.on("scrape:error", onError);

  // Remove listeners on disconnect
  req.on("close", () => {
    eventBusInstance.off("scrape:progress", onProgress);
    eventBusInstance.off("log:message", onLog);
    eventBusInstance.off("performance:update", onPerformance);
    eventBusInstance.off("scrape:error", onError);
    serverLogger.debug("SSE 客户端断开连接");
  });
});

// Helper function to broadcast progress
export function broadcastProgress(data: ScrapeProgressData): void {
  eventBusInstance.emitProgress(data);
}

// API: Get scraping status
app.get("/api/status", (req: Request, res: Response) => {
  res.json({
    isActive: isScrapingActive,
    shouldStop: getShouldStopScraping(),
  });
});

// API: Get metrics (简单 JSON 格式)
app.get("/api/metrics", (req: Request, res: Response) => {
  try {
    const { getMetricsCollector } = require("./core/metrics-collector");
    const collector = getMetricsCollector();
    res.json(collector.getMetrics());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get metrics summary
app.get("/api/metrics/summary", (req: Request, res: Response) => {
  try {
    const { getMetricsCollector } = require("./core/metrics-collector");
    const collector = getMetricsCollector();
    res.json({
      summary: collector.getSummary(),
      metrics: collector.getMetrics(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Health check
app.get("/api/health", (req: Request, res: Response) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    activeTasks: activeTasks.size,
    isScraping: isScrapingActive,
  };

  res.json(health);
});

// API: Public config for frontend
app.get("/api/config", (req: Request, res: Response) => {
  res.json(configManager.getPublicConfig());
});

// API: Get result (download URL after scraping completes)
app.get("/api/result", (req: Request, res: Response) => {
  res.json({
    isActive: isScrapingActive,
    downloadUrl: lastDownloadUrl,
  });
});

// API: Download
app.get("/api/download", (req: Request, res: Response) => {
  const filePathParam =
    typeof req.query.path === "string" ? req.query.path : "";

  if (!filePathParam) {
    return res.status(400).send("Invalid file path");
  }

  const resolvedPath = path.resolve(filePathParam);

  // 检查路径是否安全（在 output 目录内）
  if (!outputPathManager.isPathSafe(resolvedPath)) {
    serverLogger.warn("下载路径不安全", {
      path: filePathParam,
      resolved: resolvedPath,
      baseDir: outputPathManager.getBaseDir(),
    });
    return res.status(400).send("Invalid file path");
  }

  if (!fs.existsSync(resolvedPath)) {
    serverLogger.warn("文件不存在", { path: resolvedPath });
    return res.status(404).send("File not found");
  }

  // Generate a better filename
  const basename = path.basename(resolvedPath);

  let downloadName = basename;
  if (basename === "tweets.md" || basename === "index.md") {
    const { identifier, runTimestamp, tweetCount } =
      getSafePathInfo(resolvedPath);
    const timestamp = runTimestamp || new Date().toISOString().split("T")[0];
    const countSegment =
      typeof tweetCount === "number" ? `-${tweetCount}tweets` : "";
    const idSegment = identifier || "twitter";
    downloadName = `${idSegment}-timeline-${timestamp}${countSegment}.md`;
  }

  res.download(resolvedPath, downloadName);
});

// Frontend entry (allows visiting "/" directly). Exclude /api routes.
app.get(/^(?!\/api).*/, (req: Request, res: Response) => {
  const indexPath = path.join(STATIC_DIR, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send("Not found");
});

// Session Management API
app.get("/api/sessions", async (req, res) => {
  try {
    const cookieManager = await createCookieManager();
    const sessions = await cookieManager.listSessions();
    res.json({ success: true, sessions });
  } catch (error: any) {
    if (
      error.code === "COOKIE_LOAD_FAILED" ||
      error.message?.includes("No cookie files found")
    ) {
      serverLogger.warn("/api/sessions: 未找到 cookies（首次运行正常）");
      res.json({ success: true, sessions: [] }); // Return empty list instead of error
    } else {
      serverLogger.error("获取会话列表失败", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

app.post("/api/cookies", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    // Validate the uploaded file
    const cookieManager = await createCookieManager();
    try {
      // Attempt to load/validate the file we just saved
      await cookieManager.loadFromFile(req.file.path);
      res.json({
        success: true,
        message: "Cookies uploaded and validated successfully",
        filename: req.file.filename,
      });
    } catch (validationError: any) {
      // If invalid, delete the file
      fs.unlinkSync(req.file.path);
      res.status(400).json({
        success: false,
        error: `Invalid cookie file: ${validationError.message}`,
      });
    }
  } catch (error: any) {
    serverLogger.error("上传 cookies 失败", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Server
const serverInstance = app.listen(PORT, () => {
  serverLogger.info(`服务器启动`, { port: PORT, host: "localhost" });
});

const SHUTDOWN_TIMEOUT_MS = 12000;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  serverLogger.info(`收到关闭信号: ${signal}，等待活动任务完成`);
  setShouldStopScraping(true);

  try {
    await Promise.race([
      Promise.allSettled(Array.from(activeTasks)),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
  } finally {
    serverInstance.close(() => {
      serverLogger.info("HTTP 服务器已关闭");
      process.exit(0);
    });
    setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS + 2000).unref();
  }
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal as NodeJS.Signals, () => gracefulShutdown(signal));
});
