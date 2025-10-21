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
// const mergeUtils = require('./utils/merge');

// 创建命令行程序
const program = new Command();

// 版本和描述
program
  .name('twitter-crawler')
  .description('Twitter/X Crawler - 抓取Twitter/X内容的CLI工具')
  .version('1.0.0');

// 通用选项
program
  .option('-d, --debug', '启用调试模式，显示详细日志')
  .option('-o, --output <dir>', '输出目录', './output')
  .option('-m, --merge', '合并所有结果到单个文件', false)
  .option('--merge-file <filename>', '合并文件的名称', 'merged')
  .option('--format <format>', '导出格式: md/json/csv', 'md');

// Twitter命令
program
  .command('twitter')
  .description('抓取Twitter/X账号信息和推文')
  .option('-u, --username <username>', 'Twitter用户名(不含@)')
  .option('-U, --url <profileUrl>', 'Twitter/X 个人主页链接 (如 https://x.com/elonmusk)')
  .option('-f, --file <filepath>', '包含Twitter用户名的文件(每行一个)')
  .option('-c, --count <number>', '每个账号抓取的推文数量', '20')
  .option('-s, --separate', '单独保存每个Twitter账号的内容', false)
  .option('--with-replies', '抓取 with_replies 标签页（按相同逻辑保存）', false)
  .option('--json', '额外导出为 JSON（汇总到一个文件）', false)
  .option('--csv', '额外导出为 CSV（汇总到一个文件）', false)
  .option('--headless <boolean>', '无头模式运行浏览器', 'true')
  .option('-o, --output <dir>', '输出目录', './output')
  .option('-d, --debug', '启用调试模式，显示详细日志')
  .option('-m, --merge', '合并所有结果到单个文件', false)
  .option('--merge-file <filename>', '合并文件的名称', 'merged')
  .option('--format <format>', '导出格式: md/json/csv', 'md')
  .action(async (options) => {
    try {
      // 验证并初始化选项
      if (!options.username && !options.url && !options.file) {
        console.error('错误: 请提供Twitter用户名、主页链接或包含用户名/链接的文件');
        process.exit(1);
      }
      
      options.count = parseInt(options.count);
      options.headless = options.headless === 'true';
      const outputDir = path.resolve(options.output || './output');
      
      // 确保输出目录存在
      try {
        await fileUtils.ensureDirExists(outputDir);
      } catch (error) {
        console.error(`创建输出目录失败: ${outputDir}`, error);
        process.exit(1);
      }
      
      console.log('🚀 启动Twitter抓取任务...');
      
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
        console.error('没有有效的Twitter用户名/链接');
        process.exit(1);
      }
      
      console.log(`将抓取 ${usernames.length} 个Twitter账号, 每个账号最多 ${options.count} 条推文`);
      
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
        exportJson: !!options.json
      };
      
      // 执行抓取（统一逻辑）
      const results = await scraper.scrapeTwitterUsers(usernames, scraperOptions);
      
      console.log(`✅ 已完成! 基础输出目录: ${outputDir}`);
      
      // 显示结果摘要
      if (results && results.length > 0) {
        console.log('\n📊 抓取结果摘要:');
        results.forEach(result => {
          const p = result.profile || {};
          const meta = [];
          if (p.displayName) meta.push(`${p.displayName}`);
          if (typeof p.followers === 'number') meta.push(`粉丝: ${p.followers}`);
          if (typeof p.following === 'number') meta.push(`关注: ${p.following}`);
          console.log(`- @${result.username}: ${result.tweetCount} 条${meta.length ? ' | ' + meta.join(' · ') : ''}`);
        });
        
        const runDirs = results
          .map(result => result.runContext?.runDir)
          .filter(Boolean);
        if (runDirs.length > 0) {
          console.log('\n📂 输出目录:');
          runDirs.forEach(dir => console.log(`- ${dir}`));
        }
      }
    } catch (error) {
      console.error(`❌ 出错: ${error.message}`);
      if (options.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });


// 调度器命令
program
  .command('schedule')
  .description('定时运行爬虫任务')
  .option('-c, --config <filepath>', '配置文件路径', './crawler-config.json')
  .option('-i, --interval <minutes>', '抓取间隔(分钟)', '30')
  .option('--headless <boolean>', '无头模式运行浏览器', 'true')
  .action(async (options) => {
    try {
      // 检查配置文件是否存在
      if (!fs.existsSync(options.config)) {
        console.error(`错误: 配置文件 ${options.config} 不存在`);
        process.exit(1);
      }
      
      options.headless = options.headless === 'true';
      const intervalMinutes = parseInt(options.interval);
      const outputDir = path.resolve(options.parent.output);
      
      // 确保输出目录存在
      try {
        await fileUtils.ensureDirExists(outputDir);
      } catch (error) {
        console.error(`创建输出目录失败: ${outputDir}`, error);
        process.exit(1);
      }
      
      // 调度逻辑
      console.log(`🕒 启动调度任务，每 ${intervalMinutes} 分钟运行一次`);
      
      // 第一次立即运行
      executeScheduledTask();
      
      // 设置定时器
      setInterval(executeScheduledTask, intervalMinutes * 60 * 1000);
      
      // 调度执行函数
      async function executeScheduledTask() {
        try {
          const now = new Date();
          console.log(`\n[${now.toISOString()}] 执行定时抓取任务...`);
          
          // 加载配置
          const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
          
          // 基本选项
          const scraperOptions = {
            outputDir,
            headless: options.headless,
            mergeResults: options.parent.merge,
            mergeFilename: `${options.parent.mergeFile}-${getFormattedDate()}`,
            exportFormat: options.parent.format
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
          
          console.log(`✅ 定时任务完成!`);
        } catch (schedulerError) {
          console.error(`❌ 定时任务出错: ${schedulerError.message}`);
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
      console.log('调度器已启动，按 Ctrl+C 退出...');
    } catch (error) {
      console.error(`❌ 出错: ${error.message}`);
      if (options.parent.debug) {
        console.error(error);
      }
      process.exit(1);
    }
  });

// 例子命令
program
  .command('examples')
  .description('显示使用示例')
  .action(() => {
    console.log(`
Twitter/X Crawler 使用示例:

抓取单个Twitter账号 (用户名):
  $ node cli.js twitter -u elonmusk -c 50 -o ./output

抓取单个Twitter账号 (主页链接):
  $ node cli.js twitter -U https://x.com/elonmusk -c 50 -o ./output

从文件抓取多个Twitter账号(文件中可混合 用户名/@handle/主页链接):
  $ node cli.js twitter -f twitter_accounts.txt -c 20 -o ./output --merge

定时抓取:
  $ node cli.js schedule -c ./crawler-config.json -i 60 -o ./output
  
配置文件示例(crawler-config.json):
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
