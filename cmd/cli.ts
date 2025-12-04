#!/usr/bin/env node

/**
 * Twitter/X Crawler CLI
 * 专注于抓取Twitter/X账号信息与推文
 */

import * as path from "path";
import * as fs from "fs";
import { Command } from "commander";
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import * as scraper from "../core/scrape-unified";
import type { TwitterUserIdentifier } from "../core/scrape-unified";
import * as fileUtils from "../utils/fileutils";
import * as markdownUtils from "../utils/markdown";
import * as aiExportUtils from "../utils/ai-export";
import * as timeUtils from "../utils/time";
import { eventBusInstance, getShouldStopScraping, createCookieManager } from "../core";
import type { ScrapeProgressData, LogMessageData } from "../core";
import { getConfigManager, createEnhancedLogger } from "../utils";

const configManager = getConfigManager();
const outputConfig = configManager.getOutputConfig();
const twitterConfig = configManager.getTwitterConfig();
const redditConfig = configManager.getRedditConfig();
const browserConfig = configManager.getBrowserConfig();

// Progress Bar Helper
function monitorProgress(debugMode: boolean): () => void {
  let lastProgress: ScrapeProgressData | null = null;

  const updateBar = (current: number, total: number, action: string): void => {
    lastProgress = { current, target: total, action };
    const width = 30;
    const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const filled = Math.round((width * percentage) / 100);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`[${bar}] ${current}/${total} (${percentage}%) | ${action}`);
  };

  const onProgress = (data: ScrapeProgressData): void => {
    updateBar(data.current, data.target, data.action);
  };

  const onLog = (data: LogMessageData): void => {
    // In debug mode, show all logs. Otherwise only show warnings/errors to keep UI clean.
    // However, ScraperEngine emits 'info' logs for important events like "Loaded session".
    // We might want to show those but clear the bar first.
    if (debugMode || data.level === "error" || data.level === "warn" || data.level === "info") {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      // Format timestamp
      const time = new Date().toLocaleTimeString();
      console.log(`[${time}] [${data.level.toUpperCase()}] ${data.message}`);

      if (lastProgress) {
        updateBar(lastProgress.current, lastProgress.total, lastProgress.action);
      }
    }
  };

  eventBusInstance.on("scrape:progress", onProgress);
  eventBusInstance.on("log:message", onLog);

  return () => {
    eventBusInstance.off("scrape:progress", onProgress);
    eventBusInstance.off("log:message", onLog);
    // Clear the progress bar line one last time
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };
}

// 创建命令行程序
const program = new Command();

// 版本和描述
program
  .name("xrcrawler")
  .description("XRCrawler - CLI tool for scraping Twitter/X and Reddit content")
  .version("1.0.0");

// 通用选项
program
  .option("-d, --debug", "Enable debug mode with verbose logs")
  .option("-o, --output <dir>", "Output directory", outputConfig.baseDir)
  .option("-m, --merge", "Merge all results into a single file", false)
  .option("--merge-file <filename>", "Merge file name", "merged")
  .option("--format <format>", "Export format: md/json/csv", "md");

// Reddit Command
program
  .command("reddit")
  .description("Scrape Reddit content")
  .option("-r, --subreddit <name>", "Subreddit name", "UofT")
  .option("-c, --count <number>", "Number of posts to scrape", "100")
  .option(
    "-s, --strategy <strategy>",
    "Scraping strategy (auto, super_full, super_recent, new)",
    redditConfig.defaultStrategy
  )
  .option("--save-json", "Save individual JSON files")
  .action(async (options: any) => {
    console.log(`🚀 Starting Reddit Scraper...`);
    console.log(`r/ ${options.subreddit}`);
    console.log(`📊 Target: ${options.count} posts`);
    console.log(`🎯 Strategy: ${options.strategy}`);

    const pythonScript = path.join(__dirname, "platforms/reddit/reddit_cli.py");
    const python: ChildProcess = spawn("python3", [
      pythonScript,
      "--subreddit",
      options.subreddit,
      "--max_posts",
      options.count,
      "--strategy",
      options.strategy,
      ...(options.saveJson ? ["--save_json"] : []),
    ]);

    python.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      // Filter out the JSON result marker for clean logs
      if (!output.includes("__JSON_RESULT__")) {
        process.stdout.write(output);
      } else {
        // Parse result
        const parts = output.split("__JSON_RESULT__");
        if (parts[0].trim()) process.stdout.write(parts[0]);

        try {
          const resultJson = parts[1].trim();
          const result = JSON.parse(resultJson);
          if (result.status === "success") {
            console.log("\n✅ Scraping completed successfully!");
            console.log(`📈 Scraped Count: ${result.scraped_count}`);
            console.log(`💾 Total in DB: ${result.total_posts_in_db}`);
          } else {
            console.error("\n❌ Scraping failed:", result.message);
          }
        } catch (e) {
          console.error("Error parsing result:", e);
        }
      }
    });

    python.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[PYTHON ERROR] ${data}`);
    });

    python.on("close", (code: number | null) => {
      if (code !== 0) {
        console.log(`Python process exited with code ${code}`);
      }
    });
  });

// Twitter Command (existing)
program
  .command("twitter")
  .description("Scrape Twitter/X account information and tweets")
  .option("-u, --username <username>", "Twitter username (without @)")
  .option("-U, --url <profileUrl>", "Twitter/X profile URL (e.g., https://x.com/elonmusk)")
  .option("--home", "Scrape the home timeline (For You / Following) of the logged-in account")
  .option(
    "--thread <tweetUrl>",
    "Scrape a specific tweet thread (e.g., https://x.com/username/status/123456)"
  )
  .option("--max-replies <number>", "Maximum number of replies to scrape for thread mode", "100")
  .option("-f, --file <filepath>", "File containing Twitter usernames (one per line)")
  .option(
    "-c, --count <number>",
    "Number of tweets to scrape per account",
    String(twitterConfig.defaultLimit)
  )
  .option("-s, --separate", "Save each Twitter account separately", false)
  .option("--with-replies", "Scrape with_replies tab (saved with same logic)", false)
  .option("--likes", "Also scrape user likes (useful for persona analysis)", false)
  .option(
    "--persona",
    "Enable Persona Analysis mode (auto-generates AI prompt, includes replies)",
    false
  )
  .option("--json", "Additionally export as JSON (consolidated into one file)", false)
  .option("--csv", "Additionally export as CSV (consolidated into one file)", false)
  .option(
    "--headless <boolean>",
    "Run browser in headless mode",
    browserConfig.headless ? "true" : "false"
  )
  .option("--resume", "Resume from last saved progress", false)
  .option("--resume-from <tweetId>", "Resume after the specified tweet ID")
  .option("--mode <graphql|puppeteer|mixed>", "Scrape mode", twitterConfig.defaultMode)
  .option(
    "--api <graphql|rest>",
    "API variant when using API mode (graphql default, rest uses tweet_mode=extended)",
    "graphql"
  )
  .option("-o, --output <dir>", "Output directory", outputConfig.baseDir)
  .option("--timezone <timezone>", "Timezone for timestamp output (IANA name)")
  .option("-d, --debug", "Enable debug mode with verbose logs")
  .option("-m, --merge", "Merge all results into a single file", false)
  .option("--merge-file <filename>", "Merge file name", "merged")
  .option("--format <format>", "Export format: md/json/csv", "md")
  .option(
    "--query <searchQuery>",
    'Search query (e.g., "climate change" or "from:username keyword")'
  )
  .option("--session <filename>", "Cookie file to use (e.g., account2.json)")
  .action(async (options: any) => {
    try {
      // 验证并初始化选项
      if (
        !options.username &&
        !options.url &&
        !options.file &&
        !options.home &&
        !options.thread &&
        !options.query
      ) {
        console.error(
          "Error: Please provide Twitter username, profile URL, file, --query, --home, or --thread"
        );
        process.exit(1);
      }

      // 处理 Thread 模式（优先处理，因为它是独立的功能）
      if (options.thread) {
        console.log("🧵 Thread Mode ENABLED");
        const maxReplies = parseInt(options.maxReplies) || 100;

        const threadOptions = {
          tweetUrl: options.thread,
          maxReplies: maxReplies,
          outputDir: path.resolve(options.output || outputConfig.baseDir),
          timezone: timeUtils.resolveTimezone(options.timezone || timeUtils.getDefaultTimezone()),
          saveMarkdown: true,
          exportJson: !!options.json,
          exportCsv: !!options.csv,
          generateAnalysis: true,
          headless: options.headless,
          sessionId: options.session,
        };

        const stopMonitoring = monitorProgress(options.debug);
        const result = await scraper.scrapeThread(threadOptions);
        stopMonitoring();

        if (result.success) {
          console.log(`✅ Thread scraping completed!`);
          console.log(`   - Original tweet: ${result.originalTweet ? "Found" : "Not found"}`);
          console.log(`   - Replies scraped: ${result.replies?.length || 0}`);
          console.log(`   - Total tweets: ${result.tweets.length}`);
          if (result.runContext?.runDir) {
            console.log(`   - Output directory: ${result.runContext.runDir}`);
          }
        } else {
          console.error(`❌ Thread scraping failed: ${result.error}`);
          process.exit(1);
        }

        return; // Thread 模式完成后直接返回
      }

      options.count = parseInt(options.count);
      options.headless = options.headless === "true";
      let scrapeMode = (options.mode || "graphql").toLowerCase();
      const validModes = new Set(["graphql", "puppeteer", "mixed"]);
      if (!validModes.has(scrapeMode)) {
        console.warn(`Unknown mode "${options.mode}", falling back to "graphql".`);
        scrapeMode = "graphql";
      }
      let apiVariant = (options.api || "graphql").toLowerCase();
      const validApiVariants = new Set(["graphql", "rest"]);
      if (!validApiVariants.has(apiVariant)) {
        console.warn(`Unknown api variant "${options.api}", falling back to "graphql".`);
        apiVariant = "graphql";
      }
      const outputDir = path.resolve(options.output || outputConfig.baseDir);
      const timezoneInput = options.timezone || timeUtils.getDefaultTimezone();
      const timezone = timeUtils.resolveTimezone(timezoneInput);

      // 确保输出目录存在
      try {
        await fileUtils.ensureDirExists(outputDir);
      } catch (error) {
        console.error(`Failed to create output directory: ${outputDir}`, error);
        process.exit(1);
      }

      console.log("🚀 Starting Twitter scraping task...");
      console.log(`⏱️ Using timezone: ${timezone}`);

      // 辅助函数: 归一化输入为用户名
      const normalizeToUsername = (input: any): string | null => {
        if (!input) return null;
        const raw = String(input).trim();
        if (!raw) return null;
        // 1) 处理 @handle
        if (raw.startsWith("@")) return raw.slice(1);
        // 2) 处理 URL
        if (/^https?:\/\//i.test(raw)) {
          try {
            const u = new URL(raw);
            // 仅接受 x.com 或 twitter.com
            if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(u.hostname)) return null;
            // 取路径第一个非空段
            const seg = u.pathname.split("/").filter(Boolean)[0] || "";
            // 排除非用户路径
            const blocked = new Set([
              "home",
              "explore",
              "i",
              "notifications",
              "messages",
              "settings",
              "search",
            ]);
            if (!seg || blocked.has(seg.toLowerCase())) return null;
            return seg.replace(/^@/, "");
          } catch (_) {
            return null;
          }
        }
        // 3) 普通用户名
        return raw.replace(/^@/, "");
      };

      // 检测是否请求了 with_replies 标签
      const isWithReplies = (input: any): boolean => {
        if (!input) return false;
        const raw = String(input).trim().toLowerCase();
        if (!raw) return false;
        if (/^https?:\/\//i.test(raw)) {
          try {
            const u = new URL(raw);
            const pathLower = u.pathname.toLowerCase();
            return pathLower.includes("/with_replies");
          } catch (_) {
            return false;
          }
        }
        return false;
      };

      // 初始化用户列表
      let usernames: TwitterUserIdentifier[] = [];
      let withReplies = !!options.withReplies;

      // 处理 Home 模式
      if (options.home) {
        console.log("🏠 Home Timeline Mode ENABLED");
        console.log("   - Auto-switching to Puppeteer mode (required for home timeline)");
        // Home timeline requires Puppeteer mode as GraphQL API doesn't support it
        scrapeMode = "puppeteer";
        usernames.push(null);
      }

      // Persona 模式自动配置
      if (options.persona) {
        console.log("🧠 Persona Analysis Mode ENABLED");
        console.log('   - Auto-enabling "with_replies" to capture interactions');
        withReplies = true;

        if (options.count === 20) {
          // 如果用户使用的是默认值 (数字比较)
          console.log("   - Bumping tweet count to 100 for better analysis depth");
          options.count = 100;
        }
      }

      if (options.username) {
        const u = normalizeToUsername(options.username);
        if (u) usernames.push(u);
      }
      if (options.url) {
        const u = normalizeToUsername(options.url);
        if (u) usernames.push(u);
        if (isWithReplies(options.url)) withReplies = true;
      } else if (options.file && fs.existsSync(options.file)) {
        const fileContent = fs.readFileSync(options.file, "utf8");
        const lines = fileContent.split("\n");
        usernames = lines
          .map((line) => normalizeToUsername(line))
          .filter((line): line is string => line !== null && !String(line).startsWith("#"));
        // 如果文件里任一行包含 with_replies，则启用
        if (!withReplies) {
          withReplies = lines.some((line) => isWithReplies(line));
        }
      }

      // Handle Search Query mode
      if (options.query) {
        console.log(`🔍 Search Mode ENABLED: "${options.query}"`);
        // Use a special marker that scrape-unified will recognize as search mode
        usernames.push({ searchQuery: options.query });
      }

      if (usernames.length === 0) {
        console.error("No valid Twitter usernames/URLs or search query");
        process.exit(1);
      }

      // Update console message for search mode
      if (options.query) {
        console.log(`Will search Twitter for: "${options.query}", up to ${options.count} tweets`);
      } else {
        console.log(
          `Will scrape ${usernames.length} Twitter accounts, up to ${options.count} tweets per account`
        );
      }

      // 设置爬虫选项
      const scraperOptions = {
        outputDir,
        tweetCount: options.count,
        separateFiles: options.separate,
        headless: options.headless,
        mergeResults: options.merge,
        mergeFilename: options.mergeFile,
        exportFormat: options.format,
        withReplies,
        scrapeLikes: !!options.likes,
        exportCsv: !!options.csv,
        exportJson: !!options.json,
        timezone,
        sessionId: options.session,
        scrapeMode,
        apiVariant,
        resume: !!options.resume,
        resumeFromTweetId: options.resumeFrom || undefined,
      };

      // 执行抓取（统一逻辑）
      const stopMonitoring = monitorProgress(options.debug);
      const results = await scraper.scrapeTwitterUsers(usernames, scraperOptions);
      stopMonitoring();

      // 统一生成 AI 分析文件 (无论是否开启 persona 模式，只要有数据就生成)
      if (results && results.length > 0) {
        console.log("\n🧠 Generating AI Analysis Prompts...");
        for (const result of results) {
          if (result.tweets && result.tweets.length > 0) {
            // 决定使用哪种 Prompt 模板
            let promptType: "persona" | "feed_analysis" = "persona"; // 默认人物画像
            if (!options.username && !options.url && !options.file && options.home) {
              promptType = "feed_analysis"; // 如果是 Home 模式，改为信息流分析
            }

            if (result.runContext) {
              await aiExportUtils.generatePersonaAnalysis(
                result.tweets,
                result.profile || undefined,
                result.runContext,
                promptType // 传入类型
              );
            }
          }
        }
      }

      console.log(`✅ Completed! Base output directory: ${outputDir}`);

      // 显示结果摘要
      if (results && results.length > 0) {
        console.log("\n📊 Scraping results summary:");
        results.forEach((result) => {
          const p = result.profile;
          const meta: string[] = [];
          if (p?.displayName) meta.push(`${p.displayName}`);
          if (typeof p?.followers === "number") meta.push(`Followers: ${p.followers}`);
          if (typeof p?.following === "number") meta.push(`Following: ${p.following}`);
          console.log(
            `- @${result.username}: ${result.tweetCount} tweets${meta.length ? " | " + meta.join(" · ") : ""}`
          );
        });

        const runDirs = results
          .map((result) => result.runContext?.runDir)
          .filter((dir): dir is string => dir !== undefined && dir !== null);
        if (runDirs.length > 0) {
          console.log("\n📂 Output directories:");
          runDirs.forEach((dir) => console.log(`- ${dir}`));
        }
      }
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (options.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });

// 调度器命令
program
  .command("schedule")
  .description("Run crawler task on schedule")
  .option("-c, --config <filepath>", "Configuration file path", "./crawler-config.json")
  .option("-i, --interval <minutes>", "Scraping interval (minutes)", "30")
  .option(
    "--headless <boolean>",
    "Run browser in headless mode",
    browserConfig.headless ? "true" : "false"
  )
  .option("--timezone <timezone>", "Timezone for timestamp output (IANA name)")
  .action(async (options: any) => {
    try {
      // 检查配置文件是否存在
      if (!fs.existsSync(options.config)) {
        console.error(`Error: Config file ${options.config} does not exist`);
        process.exit(1);
      }

      options.headless = options.headless === "true";
      const intervalMinutes = parseInt(options.interval);
      const outputDir = path.resolve(options.parent.output);

      // 确保输出目录存在
      try {
        await fileUtils.ensureDirExists(outputDir);
      } catch (error) {
        console.error(`Failed to create output directory: ${outputDir}`, error);
        process.exit(1);
      }

      // 调度逻辑
      console.log(`🕒 Starting scheduled task, running every ${intervalMinutes} minutes`);

      // 第一次立即运行
      executeScheduledTask();

      // 设置定时器
      setInterval(executeScheduledTask, intervalMinutes * 60 * 1000);

      // 调度执行函数
      async function executeScheduledTask() {
        try {
          const now = new Date();
          console.log(`\n[${now.toISOString()}] Executing scheduled scraping task...`);

          // 加载配置
          const config = JSON.parse(fs.readFileSync(options.config, "utf8"));

          const timezoneInput =
            (config.schedule && config.schedule.timezone) ||
            options.timezone ||
            timeUtils.getDefaultTimezone();
          const timezone = timeUtils.resolveTimezone(timezoneInput);
          console.log(`Timezone for this run: ${timezone}`);

          // 基本选项
          const scraperOptions = {
            outputDir,
            headless: options.headless,
            mergeResults: options.parent.merge,
            mergeFilename: `${options.parent.mergeFile}-${getFormattedDate()}`,
            exportFormat: options.parent.format,
            timezone,
          };

          // 仅抓取Twitter
          if (config.twitter && (config.twitter.usernames || config.twitter.usernameFile)) {
            let usernames: string[] = [];
            if (config.twitter.usernames && Array.isArray(config.twitter.usernames)) {
              usernames = config.twitter.usernames;
            } else if (config.twitter.usernameFile && fs.existsSync(config.twitter.usernameFile)) {
              const fileContent = fs.readFileSync(config.twitter.usernameFile, "utf8");
              usernames = fileContent
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#"));
            }

            if (usernames.length > 0) {
              const twitterOptions = {
                ...scraperOptions,
                tweetCount: config.twitter.tweetCount || 20,
                separateFiles: config.twitter.separateFiles || false,
              };

              await scraper.scrapeTwitterUsers(usernames, twitterOptions);
            }
          }

          console.log(`✅ Scheduled task completed!`);
        } catch (schedulerError: any) {
          console.error(`❌ Scheduled task error: ${schedulerError.message}`);
          if (options.parent.debug) {
            console.error(schedulerError);
          }
          // 不退出进程，等待下一次调度
        }
      }

      // 辅助函数 - 获取格式化日期
      function getFormattedDate(): string {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      }

      // 保持进程活跃
      console.log("Scheduler started, press Ctrl+C to exit...");
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      if (options.parent.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });

// 例子命令
program
  .command("examples")
  .description("Show usage examples")
  .action(() => {
    console.log(`
Twitter/X Crawler Usage Examples:

Scrape a single Twitter account (username):
  $ node cli.js twitter -u elonmusk -c 50 -o ./output

Scrape a single Twitter account (profile URL):
  $ node cli.js twitter -U https://x.com/elonmusk -c 50 -o ./output

Scrape multiple Twitter accounts from file (can mix usernames/@handles/profile URLs):
  $ node cli.js twitter -f twitter_accounts.txt -c 20 -o ./output --merge

Scheduled scraping:
  $ node cli.js schedule -c ./crawler-config.json -i 60 -o ./output

Example config file (crawler-config.json):
{
  "twitter": {
    "usernames": ["elonmusk", "BillGates"],
    "tweetCount": 50,
    "separateFiles": true,
    "useAxios": false
  }
}
`);
  });

// 直接运行
if (require.main === module) {
  program
    .command("monitor")
    .description("Monitor multiple users for new tweets and generate a daily report")
    .requiredOption(
      "-u, --users <users>",
      "Comma-separated list of usernames (e.g. elonmusk,trump)"
    )
    .action(async (options: any) => {
      try {
        // 统一使用编译后的 dist 目录
        const { ScraperEngine } = require("./dist/core/scraper-engine");
        const { MonitorService } = require("./dist/core/monitor-service");
        const { getShouldStopScraping } = require("./dist/core/stop-signal");

        // 使用 apiOnly 模式（默认使用 GraphQL API，更快）
        // 添加 shouldStopFunction 以支持停止信号
        const engine = new ScraperEngine(() => getShouldStopScraping(), { apiOnly: true });
        await engine.init();
        const success = await engine.loadCookies();
        if (!success) {
          console.error("Failed to load cookies. Exiting.");
          process.exit(1);
        }

        const monitor = new MonitorService(engine);
        const usernames = options.users.split(",").map((u: string) => u.trim());

        await monitor.runMonitor(usernames);

        await engine.close();
        process.exit(0);
      } catch (error: any) {
        console.error("Monitor failed:", error);
        process.exit(1);
      }
    });

  program.parse(process.argv);
}

export default program;
