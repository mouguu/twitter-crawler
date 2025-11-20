#!/usr/bin/env node

/**
 * Twitter/X Crawler CLI
 * 专注于抓取Twitter/X账号信息与推文
 */

const path = require('path');
const fs = require('fs');
const { Command } = require('commander');
const scraper = require('./scrape-unified');
const fileUtils = require('./utils/fileutils');
const markdownUtils = require('./utils/markdown');
const aiExportUtils = require('./utils/ai-export');
const timeUtils = require('./utils/time');
// const mergeUtils = require('./utils/merge');

// 创建命令行程序
const program = new Command();

// 版本和描述
program
  .name('twitter-crawler')
  .description('Twitter/X Crawler - CLI tool for scraping Twitter/X content')
  .version('1.0.0');

// 通用选项
program
  .option('-d, --debug', 'Enable debug mode with verbose logs')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-m, --merge', 'Merge all results into a single file', false)
  .option('--merge-file <filename>', 'Merge file name', 'merged')
  .option('--format <format>', 'Export format: md/json/csv', 'md');

// Twitter命令
program
  .command('twitter')
  .description('Scrape Twitter/X account information and tweets')
  .option('-u, --username <username>', 'Twitter username (without @)')
  .option('-U, --url <profileUrl>', 'Twitter/X profile URL (e.g., https://x.com/elonmusk)')
  .option('--home', 'Scrape the home timeline (For You / Following) of the logged-in account')
  .option('--thread <tweetUrl>', 'Scrape a specific tweet thread (e.g., https://x.com/username/status/123456)')
  .option('--max-replies <number>', 'Maximum number of replies to scrape for thread mode', '100')
  .option('-f, --file <filepath>', 'File containing Twitter usernames (one per line)')
  .option('-c, --count <number>', 'Number of tweets to scrape per account', '20')
  .option('-s, --separate', 'Save each Twitter account separately', false)
  .option('--with-replies', 'Scrape with_replies tab (saved with same logic)', false)
  .option('--likes', 'Also scrape user likes (useful for persona analysis)', false)
  .option('--persona', 'Enable Persona Analysis mode (auto-generates AI prompt, includes replies)', false)
  .option('--json', 'Additionally export as JSON (consolidated into one file)', false)
  .option('--csv', 'Additionally export as CSV (consolidated into one file)', false)
  .option('--headless <boolean>', 'Run browser in headless mode', 'true')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--timezone <timezone>', 'Timezone for timestamp output (IANA name)')
  .option('-d, --debug', 'Enable debug mode with verbose logs')
  .option('-m, --merge', 'Merge all results into a single file', false)
  .option('--merge-file <filename>', 'Merge file name', 'merged')
  .option('--format <format>', 'Export format: md/json/csv', 'md')
  .action(async (options) => {
    try {
      // 验证并初始化选项
      if (!options.username && !options.url && !options.file && !options.home && !options.thread) {
        console.error('Error: Please provide Twitter username, profile URL, file, --home, or --thread');
        process.exit(1);
      }

      // 处理 Thread 模式（优先处理，因为它是独立的功能）
      if (options.thread) {
        console.log('🧵 Thread Mode ENABLED');
        const maxReplies = parseInt(options.maxReplies) || 100;

        const threadOptions = {
          tweetUrl: options.thread,
          maxReplies: maxReplies,
          outputDir: path.resolve(options.output || './output'),
          timezone: timeUtils.resolveTimezone(options.timezone || timeUtils.getDefaultTimezone()),
          saveMarkdown: true,
          exportJson: !!options.json,
          exportCsv: !!options.csv,
          generateAnalysis: true
        };

        const result = await scraper.scrapeThread(threadOptions);

        if (result.success) {
          console.log(`✅ Thread scraping completed!`);
          console.log(`   - Original tweet: ${result.originalTweet ? 'Found' : 'Not found'}`);
          console.log(`   - Replies scraped: ${result.replyCount}`);
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
      options.headless = options.headless === 'true';
      const outputDir = path.resolve(options.output || './output');
      const timezoneInput = options.timezone || timeUtils.getDefaultTimezone();
      const timezone = timeUtils.resolveTimezone(timezoneInput);

      // 确保输出目录存在
      try {
        await fileUtils.ensureDirExists(outputDir);
      } catch (error) {
        console.error(`Failed to create output directory: ${outputDir}`, error);
        process.exit(1);
      }

      console.log('🚀 Starting Twitter scraping task...');
      console.log(`⏱️ Using timezone: ${timezone}`);

      // 辅助函数: 归一化输入为用户名
      const normalizeToUsername = (input) => {
        if (!input) return null;
        const raw = String(input).trim();
        if (!raw) return null;
        // 1) 处理 @handle
        if (raw.startsWith('@')) return raw.slice(1);
        // 2) 处理 URL
        if (/^https?:\/\//i.test(raw)) {
          try {
            const u = new URL(raw);
            // 仅接受 x.com 或 twitter.com
            if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(u.hostname)) return null;
            // 取路径第一个非空段
            const seg = u.pathname.split('/').filter(Boolean)[0] || '';
            // 排除非用户路径
            const blocked = new Set(['home', 'explore', 'i', 'notifications', 'messages', 'settings', 'search']);
            if (!seg || blocked.has(seg.toLowerCase())) return null;
            return seg.replace(/^@/, '');
          } catch (_) {
            return null;
          }
        }
        // 3) 普通用户名
        return raw.replace(/^@/, '');
      };

      // 检测是否请求了 with_replies 标签
      const isWithReplies = (input) => {
        if (!input) return false;
        const raw = String(input).trim().toLowerCase();
        if (!raw) return false;
        if (/^https?:\/\//i.test(raw)) {
          try {
            const u = new URL(raw);
            const pathLower = u.pathname.toLowerCase();
            return pathLower.includes('/with_replies');
          } catch (_) {
            return false;
          }
        }
        return false;
      };

      // 初始化用户列表
      let usernames = [];
      let withReplies = !!options.withReplies;

      // 处理 Home 模式
      if (options.home) {
        console.log('🏠 Home Timeline Mode ENABLED');
        // 我们使用一个特殊的占位符，scrape-unified.js 会识别它
        // 但实际上 scrape-unified.js 的 scrapeTwitterUsers 是设计为遍历用户名的
        // 所以我们需要稍微调整一下调用逻辑，或者把 "home" 当作一个特殊用户处理

        // 让我们看看 scrape-unified.js 的 scrapeTwitterUsers
        // 它接受一个数组。我们可以传入 [null] 或者 ['home'] 吗？
        // scrapeTwitterUsers 会用这个名字创建目录。

        // 更好的方式：直接调用 scrapeXFeed 或者构造一个特殊的 username 列表
        // 但 scrapeTwitterUsers 内部有循环。

        // 让我们修改 scrape-unified.js 来更好地支持 Home，现在先暂时用一个特殊标记
        // 如果我们传入 null，scrapeTwitter 会默认去 X_HOME_URL
        usernames.push(null);
      }

      // Persona 模式自动配置
      if (options.persona) {
        console.log('🧠 Persona Analysis Mode ENABLED');
        console.log('   - Auto-enabling "with_replies" to capture interactions');
        withReplies = true;

        if (options.count === 20) { // 如果用户使用的是默认值 (数字比较)
          console.log('   - Bumping tweet count to 100 for better analysis depth');
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
        const fileContent = fs.readFileSync(options.file, 'utf8');
        const lines = fileContent.split('\n');
        usernames = lines
          .map(line => normalizeToUsername(line))
          .filter(line => line && !String(line).startsWith('#'));
        // 如果文件里任一行包含 with_replies，则启用
        if (!withReplies) {
          withReplies = lines.some(line => isWithReplies(line));
        }
      }

      if (usernames.length === 0) {
        console.error('No valid Twitter usernames/URLs');
        process.exit(1);
      }

      console.log(`Will scrape ${usernames.length} Twitter accounts, up to ${options.count} tweets per account`);

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
        timezone
      };

      // 执行抓取（统一逻辑）
      const results = await scraper.scrapeTwitterUsers(usernames, scraperOptions);

      // 统一生成 AI 分析文件 (无论是否开启 persona 模式，只要有数据就生成)
      if (results && results.length > 0) {
        console.log('\n🧠 Generating AI Analysis Prompts...');
        for (const result of results) {
          if (result.tweets && result.tweets.length > 0) {
            // 决定使用哪种 Prompt 模板
            let promptType = 'persona'; // 默认人物画像
            if (!options.username && !options.url && !options.file && options.home) {
              promptType = 'feed_analysis'; // 如果是 Home 模式，改为信息流分析
            }

            await aiExportUtils.generatePersonaAnalysis(
              result.tweets,
              result.profile,
              result.runContext,
              promptType // 传入类型
            );
          }
        }
      }

      console.log(`✅ Completed! Base output directory: ${outputDir}`);

      // 显示结果摘要
      if (results && results.length > 0) {
        console.log('\n📊 Scraping results summary:');
        results.forEach(result => {
          const p = result.profile || {};
          const meta = [];
          if (p.displayName) meta.push(`${p.displayName}`);
          if (typeof p.followers === 'number') meta.push(`Followers: ${p.followers}`);
          if (typeof p.following === 'number') meta.push(`Following: ${p.following}`);
          console.log(`- @${result.username}: ${result.tweetCount} tweets${meta.length ? ' | ' + meta.join(' · ') : ''}`);
        });

        const runDirs = results
          .map(result => result.runContext?.runDir)
          .filter(Boolean);
        if (runDirs.length > 0) {
          console.log('\n📂 Output directories:');
          runDirs.forEach(dir => console.log(`- ${dir}`));
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      if (options.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });


// 调度器命令
program
  .command('schedule')
  .description('Run crawler task on schedule')
  .option('-c, --config <filepath>', 'Configuration file path', './crawler-config.json')
  .option('-i, --interval <minutes>', 'Scraping interval (minutes)', '30')
  .option('--headless <boolean>', 'Run browser in headless mode', 'true')
  .option('--timezone <timezone>', 'Timezone for timestamp output (IANA name)')
  .action(async (options) => {
    try {
      // 检查配置文件是否存在
      if (!fs.existsSync(options.config)) {
        console.error(`Error: Config file ${options.config} does not exist`);
        process.exit(1);
      }

      options.headless = options.headless === 'true';
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
          const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));

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
            timezone
          };

          // 仅抓取Twitter
          if (config.twitter && (config.twitter.usernames || config.twitter.usernameFile)) {
            let usernames = [];
            if (config.twitter.usernames && Array.isArray(config.twitter.usernames)) {
              usernames = config.twitter.usernames;
            } else if (config.twitter.usernameFile && fs.existsSync(config.twitter.usernameFile)) {
              const fileContent = fs.readFileSync(config.twitter.usernameFile, 'utf8');
              usernames = fileContent.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            }

            if (usernames.length > 0) {
              const twitterOptions = {
                ...scraperOptions,
                tweetCount: config.twitter.tweetCount || 20,
                separateFiles: config.twitter.separateFiles || false
              };

              await scraper.scrapeTwitterUsers(usernames, twitterOptions);
            }
          }

          console.log(`✅ Scheduled task completed!`);
        } catch (schedulerError) {
          console.error(`❌ Scheduled task error: ${schedulerError.message}`);
          if (options.parent.debug) {
            console.error(schedulerError);
          }
          // 不退出进程，等待下一次调度
        }
      }

      // 辅助函数 - 获取格式化日期
      function getFormattedDate() {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      }

      // 保持进程活跃
      console.log('Scheduler started, press Ctrl+C to exit...');
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      if (options.parent.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });

// 例子命令
program
  .command('examples')
  .description('Show usage examples')
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
    .command('monitor')
    .description('Monitor multiple users for new tweets and generate a daily report')
    .requiredOption('-u, --users <users>', 'Comma-separated list of usernames (e.g. elonmusk,trump)')
    .action(async (options) => {
      try {
        const { ScraperEngine } = require('./core/scraper-engine');
        const { MonitorService } = require('./core/monitor-service');

        const engine = new ScraperEngine();
        await engine.init();
        const success = await engine.loadCookies();
        if (!success) {
          console.error('Failed to load cookies. Exiting.');
          process.exit(1);
        }

        const monitor = new MonitorService(engine);
        const usernames = options.users.split(',').map(u => u.trim());

        await monitor.runMonitor(usernames);

        await engine.close();
        process.exit(0);
      } catch (error) {
        console.error('Monitor failed:', error);
        process.exit(1);
      }
    });

  program.parse(process.argv);
}

module.exports = program; 
