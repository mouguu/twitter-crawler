/**
 * Twitter/X 爬虫模块
 * 专注于抓取 Twitter/X 用户主页与时间线内容
 */

// 导入依赖
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
// Medium 相关依赖已移除
const path = require('path');
const fs = require('fs');

// 工具模块
const fileUtils = require('./utils/fileutils');
const markdownUtils = require('./utils/markdown');
const exportUtils = require('./utils/export');
const screenshotUtils = require('./utils/screenshot');
// const { getPageContent } = require('./utils/flaresolverr'); // 不再使用

// 常量定义
const X_HOME_URL = 'https://x.com/home';
const X_COOKIE_FILE = path.join(__dirname, 'env.json');
// Medium 相关常量与服务已移除

// Twitter选择器
const X_SELECTORS = {
  TWEET: 'article[data-testid="tweet"]',
  TWEET_TEXT: '[data-testid="tweetText"]',
  LIKE: '[data-testid="like"]',
  RETWEET: '[data-testid="retweet"]',
  REPLY: '[data-testid="reply"]',
  SHARE: '[data-testid="app-text-transition-container"]',
  TIME: 'time',
  MEDIA: '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'
};

// 工具函数
const throttle = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getFormattedDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

const parseCount = (countText) => {
  if (!countText) return 0;
  const text = countText.toLowerCase().replace(/,/g, '');
  
  const kMatch = text.match(/^([\d.]+)\s*k/);
  if (kMatch && !isNaN(parseFloat(kMatch[1]))) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }
  
  const mMatch = text.match(/^([\d.]+)\s*m/);
  if (mMatch && !isNaN(parseFloat(mMatch[1]))) {
    return Math.round(parseFloat(mMatch[1]) * 1000000);
  }
  
  if (!isNaN(parseFloat(text))) {
    return Math.round(parseFloat(text));
  }
  
  return 0;
};

// 提取文章ID的正则表达式
const ARTICLE_ID_REGEX = /\/([a-zA-Z0-9-]+)-([a-zA-Z0-9]+)$/;

/**
 * 从URL中提取Medium文章ID
 * @param {string} url Medium文章URL
 * @returns {string|null} 文章ID或null
 */
function extractArticleId(url) {
  if (!url) return null;
  
  // 使用正则表达式提取ID
  const match = url.match(ARTICLE_ID_REGEX);
  return match ? match[2] : null;
}

/****************************
 * MEDIUM 相关函数
 ****************************/

/**
 * 提取各服务的实际内容
 * @param {string} html - 页面HTML内容
 * @param {string} serviceName - 使用的服务名称
 * @returns {string} - 清理后的内容HTML
 */
function extractServiceContent(html, serviceName) {
  const $ = cheerio.load(html);
  
  // 根据不同服务采取不同提取策略
  if (serviceName === '12ft.io') {
    // 检查是否有iframe
    const iframeSrc = $('#proxy-frame').attr('src');
    
    // 移除12ft.io的界面元素
    $('script').remove();
    $('.navbar').remove();
    $('#loading').remove();
    $('style').remove();
    
    // 如果有实际内容，提取内容区
    const articleContent = $('article').html() || 
                         $('.article-content').html() || 
                         $('main').html();
    
    if (articleContent) {
      return `<article>${articleContent}</article>`;
    }
    
    // 如果检测到是iframe但没有加载，提供提示
    if (iframeSrc) {
      return `<article><p>12ft.io正在通过iframe加载内容，但可能未完全加载。</p><p>您可以直接访问：${iframeSrc}</p></article>`;
    }
    
    // 无法通过常规方式提取
    return html;
  } 
  else if (serviceName === 'Archive.today') {
    // archive.today通常包含完整内容
    const archiveContent = $('#CONTENT').html() || 
                          $('#article-content').html() || 
                          $('article').html();
    
    if (archiveContent) {
      return `<article>${archiveContent}</article>`;
    }
    
    return html;
  }
  else {
    // 默认提取方式
    return html;
  }
}

/**
 * Extract article content from HTML using Cheerio
 * @param {string} html - HTML content to parse
 * @param {string} serviceName - Optional service name for specific extraction logic
 * @returns {string} - Cleaned article HTML
 */
function extractArticleContent(html, serviceName = null) {
  try {
    // 如果使用了特定服务，先进行服务特定提取
    if (serviceName) {
      html = extractServiceContent(html, serviceName);
    }
    
    const $ = cheerio.load(html);
    
    // Try to find the main article section with different potential selectors
    let content = $('article').first();
    
    if (!content.length) {
      // Fallback to common class patterns
      content = $('.article-content, .story-content, main, [role="main"]');
    }
    
    if (content.length) {
      // Clean up the content - remove unnecessary elements
      content.find('aside, nav, footer, .ad, .advertisement, [role="complementary"], button').remove();
      return content.html() || '';
    }
    
    // Last resort: Just get the body content
    return $('body').html() || '';
  } catch (error) {
    console.error(`Error extracting article content: ${error.message}`);
    return '';
  }
}

/**
 * 尝试访问指定的反付费墙服务
 * @param {Object} page - Playwright页面对象
 * @param {string} articleUrl - 原始文章URL
 * @param {Object} service - 服务配置对象
 * @returns {Promise<{success: boolean, content: string}>}
 */
async function tryBypassService(page, articleUrl, service) {
  console.log(`尝试使用 ${service.name} 绕过付费墙...`);
  
  try {
    // 准备访问URL
    const id = service.idExtractor(articleUrl);
    const bypassUrl = service.urlTemplate
      .replace('{articleId}', id)
      .replace('{encodedUrl}', id);
    
    console.log(`访问URL: ${bypassUrl}`);
    
    // 导航到服务
    await page.goto(bypassUrl, { timeout: 60000 });
    
    // 检查是否有Cloudflare或其他验证
    const hasCaptcha = await page.evaluate(() => {
      const title = document.title.toLowerCase();
      const bodyText = document.body.textContent.toLowerCase();
      
      return title.includes('attention') || 
             title.includes('just a moment') ||
             title.includes('cloudflare') ||
             title.includes('verify') ||
             bodyText.includes('checking if the site connection is secure') ||
             bodyText.includes('verify you are human') ||
             bodyText.includes('cloudflare') ||
             bodyText.includes('captcha');
    });
    
    if (hasCaptcha) {
      console.log(`${service.name} 需要验证，等待15秒手动解决...`);
      
      // 如果是 Freedium，减少等待时间，因为我们之前尝试过该服务多次
      const waitTime = service.name === 'Freedium' ? 5000 : 15000;
      
      // 等待用户手动解决
      await page.waitForTimeout(waitTime);
      
      // 再次检查是否解决
      const solved = await page.evaluate(() => {
        const title = document.title.toLowerCase();
        const bodyText = document.body.textContent.toLowerCase();
        
        return !(title.includes('attention') || 
                title.includes('just a moment') ||
                title.includes('cloudflare') ||
                title.includes('verify') ||
                bodyText.includes('checking if the site connection is secure') ||
                bodyText.includes('verify you are human'));
      });
      
      if (!solved) {
        console.log(`${service.name} 验证未解决，尝试下一个服务`);
        return { success: false, content: '' };
      }
    }
    
    // 等待内容加载
    await page.waitForLoadState('networkidle');
    
    // 针对12ft.io的特殊处理
    if (service.name === '12ft.io') {
      try {
        // 等待iframe加载
        const hasIframe = await page.$('#proxy-frame');
        if (hasIframe) {
          console.log('检测到12ft.io iframe，等待内容加载...');
          // 等待内容加载（iframe可能需要更长时间）
          await page.waitForTimeout(8000);
          
          // 尝试直接获取iframe URL并导航过去
          const iframeSrc = await page.evaluate(() => {
            const frame = document.querySelector('#proxy-frame');
            return frame?.src || null;
          });
          
          if (iframeSrc && iframeSrc.startsWith('/api/proxy')) {
            const fullIframeSrc = 'https://12ft.io' + iframeSrc;
            console.log(`正在导航到12ft.io iframe内容: ${fullIframeSrc}`);
            await page.goto(fullIframeSrc, { timeout: 30000, waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('networkidle');
          }
        }
      } catch (iframeError) {
        console.log(`12ft.io iframe处理出错: ${iframeError.message}`);
      }
    }
    
    // 获取页面内容
    const content = await page.content();
    
    // 简单检查是否有足够内容
    if (content && content.length > 1000) {
      // 检查内容是否实际有用（不是错误页面）
      const isErrorPage = await page.evaluate(() => {
        return document.title.includes('Error') || 
               document.body.textContent.includes('unable to access') ||
               document.body.textContent.includes('could not be found') ||
               document.body.textContent.includes('无法访问');
      });
      
      if (isErrorPage) {
        console.log(`${service.name} 返回了错误页面，尝试下一个服务`);
        return { success: false, content: '' };
      }
      
      console.log(`${service.name} 成功获取内容，长度: ${content.length} 字符`);
      return { success: true, content, serviceName: service.name };
    } else {
      console.log(`${service.name} 返回内容太短，可能失败`);
      return { success: false, content: '' };
    }
  } catch (error) {
    console.error(`${service.name} 服务出错: ${error.message}`);
    return { success: false, content: '' };
  }
}

/**
 * 使用 axios 直接尝试获取内容（不依赖浏览器）
 * @param {string} articleUrl 
 * @returns {Promise<{success: boolean, content: string}>}
 */
async function tryAxiosDirectAccess(articleUrl) {
  try {
    console.log('尝试使用 axios 直接访问...');
    
    // 1. 尝试直接访问 12ft.io 的 API
    const twelveftUrl = `https://12ft.io/api/proxy?q=${encodeURIComponent(articleUrl)}`;
    
    const response = await axios.get(twelveftUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });
    
    if (response.status === 200 && response.data && response.data.length > 1000) {
      console.log('axios 成功获取 12ft.io 内容');
      return { success: true, content: response.data, serviceName: '12ft.io (axios)' };
    }
    
    console.log('axios 请求失败或内容不完整');
    return { success: false, content: '' };
  } catch (error) {
    console.error(`axios 访问出错: ${error.message}`);
    return { success: false, content: '' };
  }
}

/**
 * 清理内容中的代理链接和无用元素
 * @param {string} markdown - 要清理的Markdown内容 
 * @param {string} serviceName - 使用的服务
 * @returns {string} - 清理后的Markdown
 */
function cleanMarkdownContent(markdown, serviceName) {
  let cleanContent = markdown;
  
  if (serviceName && serviceName.includes('12ft.io')) {
    // 移除12ft.io的代理URL
    cleanContent = cleanContent.replace(/\[([^\]]+)\]\(\/proxy\?q=[^)]+\)/g, '$1');
    
    // 移除12ft.io的提示信息
    cleanContent = cleanContent.replace(/### Cleaning Webpage[\s\S]*?============/g, '');
    
    // 移除其他12ft特有的内容
    cleanContent = cleanContent.replace(/const url[\s\S]*?proxyUrl \}/g, '');
    
    // 替换剩余的proxy链接
    cleanContent = cleanContent.replace(/\/proxy\?q=[^)\s]+/g, '');
  }
  
  // 移除Markdown中的多余分隔线
  cleanContent = cleanContent.replace(/-{40,}/g, '---');
  
  // 去除连续的空行
  cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n');
  
  return cleanContent;
}

/**
 * Main function to scrape a Medium article using Playwright
 * @param {string} articleUrl - The URL of the Medium article to scrape
 * @param {Object} options - Options for scraping
 * @param {Object} page - Existing Playwright Page object to reuse
 * @returns {Promise<Object>} - Article data including title, content, etc.
 */
async function scrapeMediumArticle(articleUrl, page, options = {}) {
  let title = '';
  let author = '';
  let publishedDate = '';
  let originalUrl = articleUrl;
  
  try {
    console.log(`Starting to scrape Medium article: ${articleUrl}`);
    
    // 检查是否是 Medium 首页
    if (articleUrl === 'https://medium.com/' || articleUrl === 'https://medium.com') {
      console.log('This is Medium homepage, not an article. Please provide a specific article URL.');
      return {
        title: 'Medium Homepage',
        author: 'Medium',
        publishedDate: new Date().toISOString(),
        content: '这是 Medium 首页，不是具体文章。请提供特定文章的 URL。',
        url: articleUrl,
        fileName: `${getFormattedDate()}-Medium-Homepage.md`
      };
    }
    
    // 尝试从URL中提取文章信息
    try {
      // 如果直接是文章URL，我们可以从其中提取有用信息
      const urlPath = new URL(articleUrl).pathname;
      const pathSegments = urlPath.split('/');
      
      // Medium URL通常格式: /publication/article-title-id
      if (pathSegments.length >= 3) {
        // 可能的出版物/作者
        const possiblePublication = pathSegments[1];
        if (possiblePublication && !possiblePublication.startsWith('@') && possiblePublication !== 'p') {
          // 可能是出版物名称
          console.log(`Possible publication from URL: ${possiblePublication}`);
          if (!author) author = possiblePublication.replace(/-/g, ' ');
        }
        
        // 可能的标题
        const lastSegment = pathSegments[pathSegments.length - 1];
        if (lastSegment && lastSegment.includes('-')) {
          // 最后部分通常是 title-id 格式
          const urlSlugParts = lastSegment.split('-');
          if (urlSlugParts.length > 1) {
            // 忽略最后一部分 (通常是ID)
            const readableTitle = urlSlugParts.slice(0, -1)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
            
            // 如果我们没有从DOM中提取到标题，使用URL中的
            if (!title) title = readableTitle;
          }
        }
      }
    } catch (urlError) {
      console.error('Error extracting info from URL:', urlError.message);
    }
    
    // 增强的元数据提取
    try {
      // 先尝试从页面元素提取元数据
      const metaFromDOM = await page.evaluate(() => {
        // 获取页面HTML以便日志调试
        const bodyText = document.body.textContent.substring(0, 200) + '...';
        
        // Title: 尝试多种选择器，排除错误的"Medium"和"Open in app"
        const titleSelectors = [
          'h1.pw-post-title',                  // Medium新布局
          'h1[data-testid="storyTitle"]',      // 部分Medium文章
          'article h1',                        // 文章内的h1
          'article header h1',                 // 文章标题
          '[data-testid="article-header"] h1',  // 测试ID
          'h1:not(:empty)'                     // 任何非空h1
        ];
        
        // 忽略的标题关键词
        const ignoreTitles = ['Medium', 'Open in app', 'Sign in', 'Get started', 'Welcome', 'Mastodon'];
        
        let title = '';
        for (const selector of titleSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent.trim();
            if (text && !ignoreTitles.includes(text) && text.length > 5) {
              title = text;
              break;
            }
          }
          if (title) break;
        }
        
        // Author: 尝试多种选择器，排除通用元素
        const authorSelectors = [
          'a[data-testid="authorLink"]',                // Medium常用（2023后）
          '[data-testid="authorName"]:not(:empty)',     // Medium常用（较旧）
          'a[rel="author"]:not(:empty)',               // HTML5标准
          'article header a[href*="/@"]:not(:empty)',   // Medium作者链接
          'header a[href*="/@"]',                       // 头部作者链接
          '.author-name:not(:empty)',                  // 常见类名
          'article footer a[href*="/@"]',              // 文章底部作者链接
          'div.n.o a',                                 // 特定Medium布局类 
          'article a[href^="/@"]',                     // 任何作者链接
          'h2 + div > a'                               // 基于层次结构
        ];
        
        // 忽略的作者关键词
        const ignoreAuthors = ['Open in app', 'Sign in', 'Get started', 'More from', 'Follow', 'Member'];
        
        let author = '';
        for (const selector of authorSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent.trim();
            if (text && !ignoreAuthors.some(ignore => text.includes(ignore)) && text.length < 50) {
              // 检查是否是实际的作者名（查找作者链接通常是个好办法）
              const href = el.getAttribute('href') || '';
              if (href.includes('/@') || !href) { // 作者链接或纯文本
                author = text;
                break;
              }
            }
          }
          if (author) break;
        }
        
        // 如果仍然没有找到作者，尝试直接查找发布信息段落
        if (!author) {
          const publishedInText = document.body.textContent.match(/Published in(.*?)·/);
          if (publishedInText && publishedInText[1]) {
            author = publishedInText[1].trim();
          }
        }
        
        // Date: 尝试多种选择器
        const dateSelectors = [
          'time[datetime]',                      // 标准time标签带datetime
          'article time',                        // 文章内的time
          '[data-testid="storyPublishDate"]',    // Medium特定
          '.published-date',                     // 常见类名
          'article [datetime]'                   // 文章内任何带datetime的元素 
        ];
        
        let publishedDate = '';
        let publishedDateTime = '';
        for (const selector of dateSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            publishedDate = el.textContent.trim();
            publishedDateTime = el.getAttribute('datetime') || '';
            break;
          }
        }
        
        // 如果仍然没有找到日期，尝试直接查找文本 
        if (!publishedDate) {
          // 查找包含"days ago"或"hours ago"的文本
          const els = Array.from(document.querySelectorAll('span, div, p'));
          for (const el of els) {
            const text = el.textContent.trim();
            if (text.match(/\d+ days? ago|\d+ hours? ago|\d+ minutes? ago/i)) {
              publishedDate = text.match(/\d+ days? ago|\d+ hours? ago|\d+ minutes? ago/i)[0];
              break;
            }
          }
        }
        
        return { title, author, publishedDate, publishedDateTime };
      });
      
      // 检查元数据结果
      console.log('Raw DOM metadata:', metaFromDOM);
      
      // 如果DOM元素提取失败，尝试从meta标签提取
      if (!metaFromDOM.title) {
        const metaTags = await page.evaluate(() => {
          const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
          const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.content || '';
          const documentTitle = document.title.replace(' – Medium', '').replace('| Medium', '').trim();
          
          return {
            title: ogTitle || twitterTitle || (documentTitle !== 'Medium' ? documentTitle : ''),
            author: document.querySelector('meta[name="author"]')?.content || 
                    document.querySelector('meta[property="article:author"]')?.content,
            publishedDate: document.querySelector('meta[property="article:published_time"]')?.content
          };
        });
        
        console.log('Meta tag metadata:', metaTags);
        
        title = metaFromDOM.title || metaTags.title || title;
        author = metaFromDOM.author || metaTags.author || author;
        publishedDate = metaFromDOM.publishedDate || metaFromDOM.publishedDateTime || metaTags.publishedDate || publishedDate;
      } else {
        title = metaFromDOM.title || title;
        author = metaFromDOM.author || author;
        publishedDate = metaFromDOM.publishedDate || metaFromDOM.publishedDateTime || publishedDate;
      }
      
      // 如果仍然没有标题，从URL提取
      if (!title) {
        // 再尝试从URL的最后部分提取
        const urlParts = articleUrl.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        if (lastPart.includes('-')) {
          const titleParts = lastPart.split('-');
          if (titleParts.length > 1) {
            title = titleParts.slice(0, -1)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
          }
        }
      }
      
      // 如果仍然没有作者，但有出版物名称，使用出版物名称
      if (!author && articleUrl.includes('/')) {
        const urlParts = articleUrl.split('/');
        if (urlParts.length > 2) {
          const possiblePublication = urlParts[urlParts.indexOf('medium.com') + 1];
          if (possiblePublication && possiblePublication !== 'p' && !possiblePublication.startsWith('@')) {
            author = possiblePublication.replace(/-/g, ' ');
          }
        }
      }
      
      // 确保我们有一些标题
      title = title || 'Untitled Medium Article';
      author = author || 'Unknown Author';
      
      console.log(`Extracted metadata - Title: "${title}", Author: "${author}", Date: "${publishedDate}"`);
    } catch (metaError) {
      console.error(`Error extracting metadata: ${metaError.message}`);
      // 使用备用方法或默认值
      title = title || 'Untitled Article';
      author = author || 'Unknown Author';
    }
    
    // Check if the article is paywalled
    const isPaywalled = await page.evaluate((selector) => {
      return Boolean(document.querySelector(selector)) || 
             document.body.textContent.includes('You\'ve read all of your free member-only stories') ||
             document.body.textContent.includes('You\'ve read all of your free stories') ||
             document.body.textContent.includes('Member-only story');
    }, PAYWALL_SELECTOR);
    
    let contentHtml = '';
    let usedBypassService = false;
    let bypassServiceName = '';
    
    if (isPaywalled) {
      console.log('文章有付费墙，尝试绕过...');
      
      // 保存当前页面内容作为备选方案
      const originalContent = await page.content();
      let originalArticleHtml = await page.evaluate(() => {
        const article = document.querySelector('article');
        return article ? article.innerHTML : '';
      });
      
      // 先尝试使用 axios 直接访问（绕过CloudFlare）
      const axiosResult = await tryAxiosDirectAccess(articleUrl);
      
      if (axiosResult.success) {
        contentHtml = axiosResult.content;
        usedBypassService = true;
        bypassServiceName = axiosResult.serviceName;
      } else {
        // 依次尝试各种反付费墙服务
        for (const service of BYPASS_SERVICES) {
          const result = await tryBypassService(page, articleUrl, service);
          
          if (result.success) {
            console.log(`使用 ${service.name} 成功获取内容`);
            contentHtml = result.content;
            usedBypassService = true;
            bypassServiceName = service.name;
            break;
          }
        }
      }
      
      // 如果所有服务都失败，使用原始内容
      if (!usedBypassService) {
        console.log('所有反付费墙服务均失败，使用原始内容（可能不完整）');
        contentHtml = originalContent;
        
        // 尝试提取付费墙前的内容
        if (originalArticleHtml) {
          const $ = cheerio.load(originalContent);
          const visibleContent = $('article p').slice(0, 8).text(); // 提取更多段落
          
          if (visibleContent && visibleContent.length > 200) {
            console.log('成功提取了部分可见内容（付费墙前）');
            contentHtml = `<html><body><article><h1>${title}</h1><p><em>注意：这是一篇付费文章，以下仅包含部分可见内容</em></p>${originalArticleHtml}</article></body></html>`;
          }
        }
      }
    } else {
      console.log('No paywall detected, extracting content directly from Medium');
      contentHtml = await page.content();
    }
    
    // Extract the main article content
    const articleHtml = extractArticleContent(contentHtml, usedBypassService ? bypassServiceName : null);
    
    // Convert HTML to Markdown
    const turndownService = new TurndownService();
    const markdown = turndownService.turndown(articleHtml);
    
    // 如果使用了反付费墙服务，在Markdown内容顶部添加说明
    let finalMarkdown = markdown;
    if (usedBypassService) {
      finalMarkdown = `> *此内容通过 ${bypassServiceName} 服务获取*\n\n${markdown}`;
    } else if (isPaywalled) {
      finalMarkdown = `> *注意：这是一篇付费文章，以下仅包含部分可见内容（付费墙前）*\n\n${markdown}`;
    }
    
    // 清理Markdown内容
    if (usedBypassService) {
      finalMarkdown = cleanMarkdownContent(finalMarkdown, bypassServiceName);
    }
    
    // Format date for filename
    const formattedDate = getFormattedDate();
    const fileName = title 
      ? `${formattedDate}-${title}.md` 
      : `${formattedDate}-${articleUrl.split('/').pop()}.md`;
    
    const sanitizedFileName = fileName
      .replace(/[\\/:"*?<>|]/g, '')  // Remove invalid characters
      .replace(/\s+/g, ' ');         // Replace multiple spaces with a single space
    
    const result = {
      title: title || 'Untitled Article',
      author: author || 'Unknown Author',
      publishedDate: publishedDate || 'Unknown Date',
      content: finalMarkdown,
      url: originalUrl,
      fileName: sanitizedFileName,
      isPartialContent: isPaywalled && !usedBypassService, // 仅当付费且未成功使用反付费墙服务时为部分内容
      bypassServiceUsed: usedBypassService ? bypassServiceName : null
    };
    
    return result;
  } catch (error) {
    console.error(`Error scraping Medium article: ${error.message}`);
    throw error;
  }
}

/**
 * 使用Axios抓取Medium Feed (不使用浏览器)
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 抓取结果
 */
async function scrapeMediumFeedWithAxios(options = {}) {
  const feedUrl = options.url || 'https://medium.com/';
  const limit = options.limit || 20;
  
  console.log(`使用Axios抓取Medium Feed: ${feedUrl}, 最多${limit}篇文章`);
  
  try {
    // 发送请求获取Medium页面内容
    const response = await axios.get(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 30000
    });
    
    if (response.status !== 200) {
      return {
        success: false,
        error: `获取页面失败，状态码: ${response.status}`,
        urls: []
      };
    }
    
    // 使用cheerio解析HTML
    const $ = cheerio.load(response.data);
    
    // 提取文章链接
    let articleUrls = [];
    
    // 使用选择器查找文章链接
    $('a[href*="/p/"], a[href*="/@"][href*="/"]').each((index, element) => {
      const href = $(element).attr('href');
      
      // 确认是否是Medium文章链接
      if (href && 
          (href.includes('/p/') || /\/@[^/]+\/[^/]+(?:-[a-zA-Z0-9]+)+$/.test(href)) &&
          !href.includes('/responses/') &&
          !href.includes('/comments/')) {
        
        // 处理相对链接
        let fullUrl = href;
        if (href.startsWith('/')) {
          fullUrl = `https://medium.com${href}`;
        } else if (!href.startsWith('http')) {
          fullUrl = `https://medium.com/${href}`;
        }
        
        articleUrls.push(fullUrl);
      }
    });
    
    // 去重
    articleUrls = [...new Set(articleUrls)];
    
    // 限制数量
    articleUrls = articleUrls.slice(0, limit);
    
    console.log(`提取到 ${articleUrls.length} 个文章链接`);
    
    return {
      success: true,
      urls: articleUrls,
      source: feedUrl,
      count: articleUrls.length
    };
  } catch (error) {
    console.error('使用Axios抓取Medium Feed出错:', error);
    
    return {
      success: false,
      error: error.message,
      urls: []
    };
  }
}

/**
 * 抓取Medium Feed (支持Medium首页或标签页)
 * @param {string|Object} options - Feed URL或配置选项
 * @returns {Promise<Object>} 抓取结果
 */
async function scrapeMediumFeed(options = {}) {
  // 兼容两种调用方式
  let config = {};
  if (typeof options === 'string') {
    config.url = options;
  } else {
    config = { ...options };
  }

  // 使用axios方式还是playwright方式
  if (config.useAxios) {
    return scrapeMediumFeedWithAxios(config);
  } else {
    // 默认使用playwright方式
    console.log('使用Playwright方式抓取Medium Feed');
    
    // 基本配置
    const feedUrl = config.url || 'https://medium.com/';
    const limit = config.limit || 20;
    const outputDir = config.outputDir || path.join(__dirname, 'output');
    
    console.log(`开始抓取Medium Feed: ${feedUrl}, 最多${limit}篇文章`);
    
    let browser = null;
    try {
      browser = await chromium.launch({ 
        headless: config.headless !== false
      });
      
      const context = await browser.newContext();
      // 尝试加载cookie
      try {
        if (fs.existsSync(MEDIUM_COOKIE_FILE)) {
          const cookiesJson = JSON.parse(fs.readFileSync(MEDIUM_COOKIE_FILE, 'utf8'));
          await context.addCookies(Array.isArray(cookiesJson) ? cookiesJson : cookiesJson.cookies || []);
          console.log('Medium cookies loaded');
        }
      } catch (e) {
        console.log('Cookie loading error:', e.message);
      }
      
      const page = await context.newPage();
      
      // 设置更长的超时时间
      page.setDefaultTimeout(60000);
      
      await page.goto(feedUrl, { waitUntil: 'domcontentloaded' });
      
      // 等待页面加载一些内容
      await page.waitForTimeout(5000);
      
      console.log('页面初步加载完成，现在进行滚动以加载更多内容...');
      
      // 执行滚动操作，加载更多内容
      await page.evaluate(async () => {
        const scrollStep = 500;
        const scrollDelay = 500;
        const scrolls = 10; // 滚动10次
        
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        for (let i = 0; i < scrolls; i++) {
          window.scrollBy(0, scrollStep);
          await wait(scrollDelay);
          console.log(`滚动 ${i+1}/${scrolls}...`);
        }
        
        return Promise.resolve();
      });
      
      // 再等待一段时间确保内容加载
      await page.waitForTimeout(3000);
      
      console.log('页面加载和滚动完成，开始提取文章链接');
      
      // 提取文章链接
      const articleUrls = await page.evaluate((limit) => {
        const uniqueUrls = new Set();
        // More specific selector targeting links within article previews
        const potentialArticleLinks = document.querySelectorAll('article[data-testid="post-preview"] a[href]');
        console.log(`找到潜在文章链接 ${potentialArticleLinks.length} 个 (在 article 元素内)`);

        for (const link of potentialArticleLinks) {
          let href = link.getAttribute('href');
          if (!href) continue;

          // Normalize URL to absolute
          let absoluteUrl;
          try {
            // Use document.baseURI as the base for resolving relative URLs
            absoluteUrl = new URL(href, document.baseURI).href;
          } catch (e) {
            console.log(`无法解析URL: ${href}`);
            continue; // Skip invalid URLs
          }

          // Basic filtering
          if (!absoluteUrl.includes('medium.com')) continue; // Ensure it's a medium.com domain
          if (absoluteUrl.includes('/responses/') || absoluteUrl.includes('/comments/')) continue; // Exclude comments/responses links
          if (absoluteUrl.endsWith('/about')) continue; // Exclude about pages

          // Clean URL by removing query parameters for pattern matching and uniqueness check
          const cleanUrl = absoluteUrl.split('?')[0];
          const urlPath = new URL(cleanUrl).pathname;

          // Refined Regex patterns for different article URL types (matching against pathname)
          // Pattern for /@username/slug-hexId
          const isAuthorArticle = /^\/@([^/]+)\/([^/]+-[a-f0-9]+)$/.test(urlPath);
          // Pattern for /publication/slug-hexId (ensure publication doesn't start with @)
          const isPubArticle = /^\/([^/@][^/]*)\/([^/]+-[a-f0-9]+)$/.test(urlPath);
          // Pattern for older /p/hexId format
          const isPArticle = /^\/p\/[a-f0-9]+$/.test(urlPath);

          if (isAuthorArticle || isPubArticle || isPArticle) {
            uniqueUrls.add(cleanUrl); // Add the clean URL to the set
            if (uniqueUrls.size >= limit) break; // Stop if limit reached
          }
        }

        console.log(`筛选后找到 ${uniqueUrls.size} 个唯一文章链接`);
        return Array.from(uniqueUrls); // Return the array of unique, clean article URLs
      }, limit); // Pass limit correctly

      console.log(`最终提取到 ${articleUrls.length} 个文章链接`);

      await browser.close();
      
      return { 
        success: true, 
        urls: articleUrls, 
        source: feedUrl,
        count: articleUrls.length
      };
    } catch (error) {
      console.error('抓取Medium Feed出错:', error);
      if (browser) await browser.close();
      
      return { 
        success: false, 
        error: error.message, 
        urls: []
      };
    }
  }
}

/****************************
 * TWITTER/X 相关函数
 ****************************/

/**
 * 抓取Twitter/X Feed
 * @param {Object} options - 配置选项
 * @param {string} options.username - Twitter用户名
 * @param {number} options.limit - 最多抓取的推文数量（默认：50）
 * @returns {Promise<{success: boolean, tweets: Array}>}
 */
async function scrapeXFeed(options = {}) {
  const username = options.username;
  const limit = options.limit || 50;
  const platform = 'x';
  
  if (!username) {
    console.error(`[${platform.toUpperCase()}] 必须提供Twitter用户名`);
    return { success: false, tweets: [], error: 'Username is required' };
  }
  
  console.log(`[${platform.toUpperCase()}] 开始抓取用户 ${username} 的推文，上限=${limit}条...`);
  
  return scrapeTwitter({
    limit: limit,
    username: username,
    withReplies: options.withReplies || false,
    exportCsv: options.exportCsv || false,
    exportJson: options.exportJson || false,
    saveMarkdown: options.saveMarkdown !== false,
    saveScreenshots: options.saveScreenshots || false,
    runContext: options.runContext,
    outputDir: options.outputDir
  });
}

/**
 * 主要的Twitter/X抓取功能
 * @param {Object} options - 配置选项
 * @param {number} options.limit - 最多抓取的推文数量（默认：50）
 * @param {string} options.username - 可选的Twitter用户名
 * @param {boolean} options.saveMarkdown - 是否保存单独的Markdown文件（默认：true）
 * @param {boolean} options.saveScreenshots - 是否保存推文截图（默认：false）
 * @param {boolean} options.exportCsv - 是否导出CSV文件（默认：false）
 * @param {boolean} options.exportJson - 是否导出JSON文件（默认：false）
 * @returns {Promise<{success: boolean, tweets: Array}>}
 */
async function scrapeTwitter(options = {}) {
  const platform = 'x'; // 平台标识
  // 默认选项
  const config = {
    limit: 50,
    saveMarkdown: true,
    saveScreenshots: false,
    exportCsv: false,
    exportJson: false,
    ...options // 用传入的 options 覆盖默认值
  };
  
  console.log(`[${platform.toUpperCase()}] 开始时间线抓取，上限=${config.limit}条推文${config.withReplies ? '（with_replies）' : ''}...`);
  console.log(`[${platform.toUpperCase()}] 选项: ${JSON.stringify(config, null, 2)}`);

  const identifierForRun = config.username || 'timeline';
  let runContext = config.runContext;
  if (!runContext) {
    runContext = await fileUtils.createRunContext({
      platform: 'twitter',
      identifier: identifierForRun,
      baseOutputDir: config.outputDir
    });
  }
  const cachePlatform = runContext.platform || 'twitter';
  const cacheIdentifier = runContext.identifier || fileUtils.sanitizeSegment(identifierForRun);
  const runStartedAt = new Date().toISOString();
  
  let browser = null;
  let collectedTweets = [];
  const scrapedUrls = new Set();
  let seenUrls = await fileUtils.loadSeenUrls(cachePlatform, cacheIdentifier);
  let noNewTweetsConsecutiveAttempts = 0;
  const MAX_CONSECUTIVE_NO_NEW_TWEETS = 3;
  let profileInfo = null;
  
  try {
    // 启动浏览器（优化性能设置）
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1280,960'
      ],
      defaultViewport: { width: 1280, height: 960 }
    });
    
    const page = await browser.newPage();
    
    // 设置现代浏览器UA
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
    
    // 屏蔽不必要的资源以加快加载速度
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
        req.abort();
      } else {
        req.continue();
      }
    });

    // 注入Cookie进行认证
    try {
      let cookieSource = null;
      let envData = null;
      // 首先尝试 env.json（新格式）
      try {
        const cookiesString = await fs.promises.readFile(X_COOKIE_FILE, 'utf-8');
        envData = JSON.parse(cookiesString);
        cookieSource = X_COOKIE_FILE;
      } catch (_) {
        // 回退到 ./cookies/twitter-cookies.json
        const altPath = path.join(__dirname, 'cookies', 'twitter-cookies.json');
        const cookiesString = await fs.promises.readFile(altPath, 'utf-8');
        envData = JSON.parse(cookiesString);
        cookieSource = altPath;
      }

      if (typeof envData === 'object' && envData !== null && Array.isArray(envData.cookies)) {
        if (envData.cookies.length === 0) throw new Error(`${cookieSource} 的 cookies 数组为空`);
        await page.setCookie(...envData.cookies);
      } else if (Array.isArray(envData)) {
        console.warn(`${cookieSource} 使用的是数组格式，建议更新为包含 username 和 cookies 的对象格式。`);
        if (envData.length === 0) throw new Error(`${cookieSource} 数组为空`);
        await page.setCookie(...envData);
      } else {
        throw new Error(`无效的 cookies 文件格式: ${cookieSource}`);
      }
      console.log(`[${platform.toUpperCase()}] 已从 ${cookieSource} 注入Cookie`);
    } catch (error) {
      console.error(`[${platform.toUpperCase()}] Cookie错误: ${error.message}`);
      return { success: false, tweets: [], error: error.message };
    }

    // 确定访问URL (是主页还是特定用户)
    const targetUrl = config.username ? 
      `https://x.com/${config.username}${config.withReplies ? '/with_replies' : ''}` : 
      X_HOME_URL;
    
    // 导航到Twitter页面
    console.log(`[${platform.toUpperCase()}] 正在导航到 ${targetUrl}...`);
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (navError) {
      console.error(`[${platform.toUpperCase()}] 导航失败: ${navError.message}`);
      return { success: false, tweets: [], error: navError.message };
    }

    // 等待推文加载
    try {
      await page.waitForSelector(X_SELECTORS.TWEET, { timeout: 45000 });
      console.log(`[${platform.toUpperCase()}] 推文加载成功`);
    } catch (waitError) {
      console.error(`[${platform.toUpperCase()}] 未找到推文:`, waitError.message);
      return { success: false, tweets: [], error: waitError.message };
    }

    // 提取用户资料信息（如果是访问特定用户）
    if (config.username) {
      try {
        profileInfo = await page.evaluate(() => {
          const getText = (sel) => {
            const el = document.querySelector(sel);
            return el ? (el.textContent || '').trim() : null;
          };
          const parseCountInBrowser = (countText) => {
            if (!countText) return null;
            const text = countText.toLowerCase().replace(/,/g, '').trim();
            const m = text.match(/([\d.]+)\s*([km]?)/);
            if (!m) return parseFloat(text) || 0;
            const n = parseFloat(m[1]);
            const suf = m[2];
            if (isNaN(n)) return 0;
            if (suf === 'k') return Math.round(n * 1000);
            if (suf === 'm') return Math.round(n * 1000000);
            return Math.round(n);
          };

          // 显示名与@handle
          let displayName = null;
          let handle = null;
          const nameRoot = document.querySelector('[data-testid="UserName"]');
          if (nameRoot) {
            const span = nameRoot.querySelector('span');
            if (span) displayName = (span.textContent || '').trim();
            const a = nameRoot.querySelector('a[href^="/"]');
            if (a) handle = (a.getAttribute('href') || '').replace(/^\//, '').replace(/^@/, '');
          }

          const bio = getText('[data-testid="UserDescription"]');
          const location = getText('[data-testid="UserLocation"]');
          const joined = getText('[data-testid="UserJoinDate"]');
          let website = null;
          const urlEl = document.querySelector('[data-testid="UserUrl"] a[href]');
          if (urlEl) website = urlEl.getAttribute('href');

          let followers = null;
          let following = null;
          try {
            document.querySelectorAll('a[href*="/followers"], a[href*="/following"]').forEach(a => {
              const href = a.getAttribute('href') || '';
              const txt = (a.textContent || '').trim();
              if (href.includes('/followers')) followers = parseCountInBrowser(txt);
              if (href.includes('/following')) following = parseCountInBrowser(txt);
            });
          } catch (e) {}

          return { displayName, handle, bio, location, website, joined, followers, following };
        });
        if (profileInfo) {
          console.log(`[${platform.toUpperCase()}] 资料: ${JSON.stringify(profileInfo)}`);
        }
      } catch (e) {
        console.warn(`[${platform.toUpperCase()}] 提取用户资料失败: ${e.message}`);
      }
    }

    // 滚动和抓取逻辑
    let scrollAttempts = 0;
    const maxScrollAttempts = Math.max(50, Math.ceil(config.limit / 5));
    
    // 首先尝试截取时间线截图（如果启用了截图功能）
    if (config.saveScreenshots) {
      try {
        await screenshotUtils.takeTimelineScreenshot(page, { runContext });
      } catch (error) {
        console.warn('时间线截图失败:', error.message);
      }
    }
    
    while (collectedTweets.length < config.limit && scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;
      console.log(`[${platform.toUpperCase()}] 抓取尝试 ${scrollAttempts}...`);

      // 使用page.evaluate提取推文数据（性能更好）
      const tweetsOnPage = await page.evaluate((SELECTORS) => {
        const parseCountInBrowser = (countText) => {
          if (!countText) return 0;
          const text = countText.toLowerCase().replace(/,/g, '');
          
          if (text.includes('k')) {
            return Math.round(parseFloat(text) * 1000);
          } else if (text.includes('m')) {
            return Math.round(parseFloat(text) * 1000000);
          } else if (!isNaN(parseFloat(text))) {
            return Math.round(parseFloat(text));
          }
          
          return 0;
        };

        return Array.from(document.querySelectorAll(SELECTORS.TWEET))
          .map(article => {
            try {
              const textNode = article.querySelector(SELECTORS.TWEET_TEXT);
              const timeNode = article.querySelector(SELECTORS.TIME);
              const linkNode = timeNode?.closest('a[href*="/status/"]');
              
              // 计数元素
              const likeButton = article.querySelector(SELECTORS.LIKE);
              const retweetButton = article.querySelector(SELECTORS.RETWEET);
              const replyButton = article.querySelector(SELECTORS.REPLY);
              
              // 计数span
              const likeCountSpan = likeButton?.querySelector(`${SELECTORS.SHARE} span > span`);
              const retweetCountSpan = retweetButton?.querySelector(`${SELECTORS.SHARE} span > span`);
              const replyCountSpan = replyButton?.querySelector(`${SELECTORS.SHARE} span > span`);
              
              // 检查是否包含媒体
              const hasMedia = !!article.querySelector(SELECTORS.MEDIA);

              // 获取推文URL
              let tweetUrl = null;
              if (linkNode) {
                const href = linkNode.getAttribute('href');
                if (href && href.includes('/status/')) {
                  tweetUrl = `https://x.com${href.split('?')[0]}`;
                }
              }

              const tweetText = textNode?.innerText?.trim() || null;
              const dateTime = timeNode?.getAttribute('datetime') || null;

              if (!tweetUrl || !tweetText || !dateTime) {
                return null;
              }

              // 提取作者信息
              let author = '';
              try {
                // 尝试从URL中提取
                const urlParts = tweetUrl.split('/');
                const authorIndex = urlParts.indexOf('status') - 1;
                if (authorIndex > 0) {
                  author = urlParts[authorIndex];
                }
              } catch (e) {}

              // 解析计数
              const likes = parseCountInBrowser(likeCountSpan?.innerText);
              const retweets = parseCountInBrowser(retweetCountSpan?.innerText);
              const replies = parseCountInBrowser(replyCountSpan?.innerText);

              // 提取推文ID
              const tweetId = tweetUrl.split('/status/')[1];

              return {
                text: tweetText,
                time: dateTime,
                url: tweetUrl,
                id: tweetId,
                author: author,
                likes,
                retweets,
                replies,
                hasMedia
              };
            } catch(e) {
              return null;
            }
          })
          .filter(tweet => tweet !== null);
      }, X_SELECTORS);

      // 添加唯一推文到集合
      let addedInAttempt = 0;
      for (const tweet of tweetsOnPage) {
        if (collectedTweets.length < config.limit && 
            !scrapedUrls.has(tweet.url) && 
            !seenUrls.has(tweet.url)) {
          
          collectedTweets.push(tweet);
          scrapedUrls.add(tweet.url);
          seenUrls.add(tweet.url);
          addedInAttempt++;
        }
        if (collectedTweets.length >= config.limit) break;
      }
      
      console.log(`[${platform.toUpperCase()}] 尝试 ${scrollAttempts}: 页面上有 ${tweetsOnPage.length} 条推文，添加了 ${addedInAttempt} 条新推文。总计: ${collectedTweets.length}`);

      // 更新连续无新推文计数器
      if (addedInAttempt === 0) {
        noNewTweetsConsecutiveAttempts++;
        console.log(`[${platform.toUpperCase()}] 连续无新推文次数: ${noNewTweetsConsecutiveAttempts}`);
      } else {
        noNewTweetsConsecutiveAttempts = 0; 
      }

      // 检查是否需要刷新页面
      if (noNewTweetsConsecutiveAttempts >= MAX_CONSECUTIVE_NO_NEW_TWEETS && collectedTweets.length < config.limit) {
        console.warn(`[${platform.toUpperCase()}] 连续 ${noNewTweetsConsecutiveAttempts} 次未抓到新推文，尝试刷新页面...`);
        try {
          await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
          console.log(`[${platform.toUpperCase()}] 页面刷新成功，等待推文重新加载...`);
          // 增加刷新后的等待超时时间
          await page.waitForSelector(X_SELECTORS.TWEET, { timeout: 75000 });
          console.log(`[${platform.toUpperCase()}] 推文已重新加载`);
          noNewTweetsConsecutiveAttempts = 0; // 刷新后重置计数器
          await throttle(1000 + Math.random() * 1000); // 刷新后稍作等待
          continue; // 跳过本次滚动的剩余部分，直接开始下一次抓取尝试
        } catch (reloadError) {
          console.error(`[${platform.toUpperCase()}] 页面刷新或等待推文失败: ${reloadError.message}`);
          // 在退出前截图
          try {
            const errorScreenshotPath = path.join(runContext.screenshotDir, `error_refresh_timeout_${Date.now()}.png`);
            await page.screenshot({ path: errorScreenshotPath, fullPage: true });
            console.log(`[${platform.toUpperCase()}] 错误截图已保存到: ${errorScreenshotPath}`);
          } catch (screenshotError) {
            console.error('保存错误截图失败:', screenshotError.message);
          }
          // 刷新失败，可能页面卡死或网络问题，直接退出
          return { success: false, tweets: collectedTweets, error: `页面刷新失败: ${reloadError.message}` };
        }
      }

      // 如果目标未达成且未超最大尝试次数，则滚动页面
      if (collectedTweets.length < config.limit && scrollAttempts < maxScrollAttempts) {
        console.log(`[${platform.toUpperCase()}] 正在滚动以加载更多推文...`);
        
        // 滚动到底部
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        // 随机延迟 1.5-3 秒，避免被检测
        await throttle(1500 + Math.random() * 1500);
        
        // 等待新推文加载
        try {
          await page.waitForFunction(
            (selector, prevCount) => document.querySelectorAll(selector).length > prevCount,
            { timeout: 3000 },
            X_SELECTORS.TWEET,
            tweetsOnPage.length // 使用本次抓取前的数量判断是否有增长
          );
        } catch (e) {
          // 注意：这里的超时不一定是坏事，可能只是没新推文
          console.log(`[${platform.toUpperCase()}] 滚动后短时间内未检测到新推文元素（可能已无更多或加载慢）`);
        }
      }
    }

    console.log(`[${platform.toUpperCase()}] 抓取完成。已收集 ${collectedTweets.length} 条推文。`);

    // 保存已抓取的URL集合
    try {
      await fileUtils.saveSeenUrls(cachePlatform, cacheIdentifier, seenUrls);
    } catch (error) {
      console.warn(`[${platform.toUpperCase()}] 保存已抓取的 URL 集合失败:`, error.message);
    }

    // 保存为Markdown文件（如果启用）
    if (config.saveMarkdown && collectedTweets.length > 0) {
      await markdownUtils.saveTweetsAsMarkdown(collectedTweets, runContext);
    } else if (!config.saveMarkdown) {
      console.log(`[${platform.toUpperCase()}] Markdown保存已禁用`);
    }
    
    // 导出为CSV（如果启用）
    if (config.exportCsv && collectedTweets.length > 0) {
      await exportUtils.exportToCsv(collectedTweets, runContext);
    }
    
    // 导出为JSON（如果启用）
    if (config.exportJson && collectedTweets.length > 0) {
      await exportUtils.exportToJson(collectedTweets, runContext);
    }
    
    // 截图（如果启用）
    let screenshotPaths = [];
    if (config.saveScreenshots && collectedTweets.length > 0) {
      screenshotPaths = await screenshotUtils.takeScreenshotsOfTweets(page, collectedTweets, { runContext });
    }

    const runCompletedAt = new Date().toISOString();
    const metadata = {
      platform,
      username: config.username || null,
      runId: runContext.runId,
      runTimestamp: runContext.runTimestamp,
      runStartedAt,
      runCompletedAt,
      tweetCount: collectedTweets.length,
      withReplies: !!config.withReplies,
      exportCsv: !!config.exportCsv,
      exportJson: !!config.exportJson,
      saveMarkdown: !!config.saveMarkdown,
      saveScreenshots: !!config.saveScreenshots,
      profile: profileInfo || null,
      output: {
        runDir: runContext.runDir,
        markdownDir: runContext.markdownDir,
        csvPath: config.exportCsv ? (runContext.csvPath || path.join(runContext.runDir, 'tweets.csv')) : null,
        jsonPath: config.exportJson ? (runContext.jsonPath || path.join(runContext.runDir, 'tweets.json')) : null,
        indexPath: runContext.markdownIndexPath,
        screenshotDir: runContext.screenshotDir
      }
    };

    try {
      await fs.promises.writeFile(runContext.metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    } catch (metaError) {
      console.warn(`[${platform.toUpperCase()}] 写入 metadata 失败: ${metaError.message}`);
    }

    console.log(`[${platform.toUpperCase()}] 本次抓取输出目录: ${runContext.runDir}`);

    return { 
      success: true, 
      tweets: collectedTweets,
      count: collectedTweets.length,
      screenshotPaths,
      profile: profileInfo || null,
      runContext
    };

  } catch (error) {
    console.error(`[${platform.toUpperCase()}] 抓取失败:`, error.message);
    return { success: false, tweets: [], error: error.message, runContext };
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${platform.toUpperCase()}] 浏览器已关闭`);
    }
    console.log(`[${platform.toUpperCase()}] 抓取周期结束`);
  }
}

/**
 * 抓取多个Twitter用户的推文
 * @param {Array} usernames - 用户名数组
 * @param {Object} options - 抓取选项
 * @returns {Promise<Array>} 结果数组
 */
async function scrapeTwitterUsers(usernames, options = {}) {
  if (!Array.isArray(usernames) || usernames.length === 0) {
    console.error('需要提供有效的Twitter用户名数组');
    return [];
  }
  
  console.log(`批量抓取 ${usernames.length} 个Twitter用户的推文`);
  
  const results = [];
  
  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];
    console.log(`[${i+1}/${usernames.length}] 抓取用户 @${username} 的推文`);
    
    try {
      const runContext = await fileUtils.createRunContext({
        platform: 'twitter',
        identifier: username,
        baseOutputDir: options.outputDir
      });

      const userOptions = {
        ...options,
        username,
        limit: options.tweetCount || 20,
        runContext
      };
      
      const result = await scrapeXFeed(userOptions);
      
      if (result.success) {
        results.push({
          username,
          tweetCount: result.tweets.length,
          tweets: result.tweets,
          profile: result.profile || null,
          runDir: result.runContext?.runDir,
          runContext: result.runContext
        });
        
        if (result.runContext?.runDir) {
          console.log(`成功抓取 @${username} 的 ${result.tweets.length} 条推文，输出目录: ${result.runContext.runDir}`);
        } else {
          console.log(`成功抓取 @${username} 的 ${result.tweets.length} 条推文`);
        }
      } else {
        console.error(`抓取 @${username} 失败: ${result.error || '未知错误'}`);
        results.push({
          username,
          tweetCount: 0,
          tweets: [],
          error: result.error
        });
      }
    } catch (error) {
      console.error(`抓取 @${username} 出错:`, error);
      results.push({
        username,
        tweetCount: 0,
        tweets: [],
        error: error.message
      });
    }
    
    // 添加间隔，避免触发限流
    if (i < usernames.length - 1) {
      const delay = options.delay || 5000;
      console.log(`等待 ${delay/1000} 秒后继续下一个用户...`);
      await throttle(delay);
    }
  }
  
  return results;
}

/****************************
 * 调度器功能
 ****************************/

/**
 * 启动周期性爬虫调度器
 * @param {Object} options - 配置选项
 * @param {number} options.interval - 爬取间隔，单位毫秒，默认30秒
 * @param {string} options.platform - 要爬取的平台，'x'或'medium'，默认'x'
 * @param {number} options.limit - 每次爬取的数量限制，默认10
 * @param {boolean} options.saveMarkdown - 是否保存为Markdown，默认true
 * @param {boolean} options.exportCsv - 是否导出CSV，默认false
 * @param {boolean} options.exportJson - 是否导出JSON，默认false
 * @param {boolean} options.saveScreenshots - 是否保存截图，默认false
 * @returns {Object} - 调度器控制对象，包含stop方法
 */
function startScheduler(options = {}) {
  const config = {
    interval: options.interval || 30 * 1000, // 默认30秒
    platform: options.platform || 'x',
    limit: options.limit || 10,
    saveMarkdown: options.saveMarkdown !== false,
    exportCsv: options.exportCsv || false,
    exportJson: options.exportJson || false,
    saveScreenshots: options.saveScreenshots || false,
    username: options.username
  };
  
  let isScraping = false; // 防止爬取重叠
  let intervalId = null;
  let isRunning = true;
  
  console.log(`启动调度器，平台: ${config.platform}，每隔 ${config.interval / 1000} 秒爬取一次`);
  
  // 爬取函数
  async function performScrape() {
    if (!isRunning) return;
    if (isScraping) {
      console.log('上一次爬取仍在进行中，跳过本次爬取');
      return;
    }
    
    isScraping = true;
    try {
      console.log(`开始定时爬取，时间: ${new Date().toLocaleString()}`);
      
      if (config.platform === 'x' || config.platform === 'twitter') {
        await scrapeTwitter({
          limit: config.limit,
          saveMarkdown: config.saveMarkdown,
          exportCsv: config.exportCsv,
          exportJson: config.exportJson,
          saveScreenshots: config.saveScreenshots,
          username: config.username
        });
      } else if (config.platform === 'medium') {
        // 为Medium实现定时抓取逻辑
        // 这里简化处理，实际使用时需要调用scrapeMediumFeed并处理结果
        console.log('Medium定时抓取功能正在开发中');
      } else {
        console.error(`不支持的平台: ${config.platform}`);
      }
      
      console.log(`定时爬取完成，时间: ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error('定时爬取出错:', error);
    } finally {
      isScraping = false;
    }
  }
  
  // 立即执行一次
  performScrape();
  
  // 设置定时器
  intervalId = setInterval(performScrape, config.interval);
  
  // 返回控制对象
  return {
    stop: () => {
      isRunning = false;
      if (intervalId) {
        clearInterval(intervalId);
        console.log('调度器已停止');
      }
    },
    isRunning: () => isRunning,
    config
  };
}

/**
 * 运行爬虫调度器（直接执行版本）
 * @param {Object} options - 配置选项
 */
function runScheduler(options = {}) {
  return startScheduler(options);
}

/**
 * 批量抓取Medium文章
 * @param {Array} urls - 要抓取的URL数组
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} 抓取结果数组
 */
async function scrapeMediumBatch(urls, options = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    console.error('需要提供有效的URL数组');
    return [];
  }
  
  console.log(`批量抓取 ${urls.length} 篇Medium文章`);
  
  const results = [];
  const batchSize = options.batchSize || 3; // 默认批处理大小
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batchUrls = urls.slice(i, i + batchSize);
    console.log(`处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(urls.length / batchSize)}`);
    
    const batchPromises = batchUrls.map(url => 
      scrapeMediumArticle(url, null, options)
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));
  }
  
  console.log(`成功抓取 ${results.length} 篇文章`);
  return results;
}

/**
 * 抓取Medium出版物的文章
 * @param {string} publicationName - 出版物名称
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} 抓取结果数组
 */
async function scrapeMediumPublication(publicationName, options = {}) {
  if (!publicationName) {
    console.error('需要提供出版物名称');
    return [];
  }
  
  console.log(`抓取Medium出版物: ${publicationName}`);
  
  // 构建出版物URL
  const publicationUrl = `https://medium.com/${publicationName}`;
  
  // 首先抓取Feed获取文章列表
  const feedResults = await scrapeMediumFeed({
    url: publicationUrl,
    limit: options.limit || 20,
    useAxios: options.useAxios,
    headless: options.headless
  });
  
  if (!feedResults.success || feedResults.urls.length === 0) {
    console.log(`没有从出版物 ${publicationName} 找到文章`);
    return [];
  }
  
  // 然后批量抓取文章
  return scrapeMediumBatch(feedResults.urls, options);
}

/**
 * 抓取Medium作者的文章
 * @param {string} authorName - 作者用户名
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} 抓取结果数组
 */
async function scrapeMediumAuthor(authorName, options = {}) {
  if (!authorName) {
    console.error('需要提供作者用户名');
    return [];
  }
  
  authorName = authorName.replace('@', ''); // 移除可能的@前缀
  console.log(`抓取Medium作者: @${authorName}`);
  
  // 构建作者URL
  const authorUrl = `https://medium.com/@${authorName}`;
  
  // 首先抓取Feed获取文章列表
  const feedResults = await scrapeMediumFeed({
    url: authorUrl,
    limit: options.limit || 20,
    useAxios: options.useAxios,
    headless: options.headless
  });
  
  if (!feedResults.success || feedResults.urls.length === 0) {
    console.log(`没有从作者 @${authorName} 找到文章`);
    return [];
  }
  
  // 然后批量抓取文章
  return scrapeMediumBatch(feedResults.urls, options);
}

// 导出所有函数
module.exports = {
  // Twitter/X相关
  scrapeTwitter,
  scrapeXFeed,
  scrapeTwitterUsers,

  // 调度器功能
  startScheduler,
  runScheduler
}; 
