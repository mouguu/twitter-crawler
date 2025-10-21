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
  .option('-f, --file <filepath>', 'File containing Twitter usernames (one per line)')
  .option('-c, --count <number>', 'Number of tweets to scrape per account', '20')
  .option('-s, --separate', 'Save each Twitter account separately', false)
  .option('--with-replies', 'Scrape with_replies tab (saved with same logic)', false)
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
      if (!options.username && !options.url && !options.file) {
        console.error('Error: Please provide Twitter username, profile URL, or file containing usernames/URLs');
        process.exit(1);
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
            const blocked = new Set(['home','explore','i','notifications','messages','settings','search']);
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
        exportCsv: !!options.csv,
        exportJson: !!options.json,
        timezone
      };
      
      // 执行抓取（统一逻辑）
      const results = await scraper.scrapeTwitterUsers(usernames, scraperOptions);

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
  program.parse(process.argv);
}

module.exports = program; 
