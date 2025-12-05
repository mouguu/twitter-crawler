/**
 * XRCrawler Hono Server
 * 
 * Modern Bun-native HTTP server with type-safe routing
 */

console.log('DEBUG: Hono server starting...');

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { logger } from 'hono/logger';
import * as path from 'path';
import * as fs from 'fs';

// Core imports
import { createCookieManager, scrapeQueue } from '../core';
import {
  createEnhancedLogger,
  getOutputPathManager,
  getConfigManager,
  setLogLevel,
} from '../utils';
import { apiKeyMiddleware } from '../middleware/api-key';
import { JobRepository } from '../core/db/job-repo';

// Route imports
import jobRoutes from '../server/routes/jobs';
import healthRoutes from '../routes/health';
import statsRoutes from '../routes/stats';
import queueMonitor from '../routes/queue-monitor';

const serverLogger = createEnhancedLogger('HonoServer');

// ============ Configuration ============
const configManager = getConfigManager();
const serverConfig = configManager.getServerConfig();
const outputConfig = configManager.getOutputConfig();
const LOG_CONFIG = configManager.getLoggingConfig();

setLogLevel(LOG_CONFIG.level);

const PORT = serverConfig.port;

const outputPathManager = getOutputPathManager({
  baseDir: outputConfig.baseDir,
});
const OUTPUT_ROOT = outputPathManager.getBaseDir();
const STATIC_DIR = path.resolve(process.cwd(), 'public');

// ============ Helper Functions ============

function normalizeUsername(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  const withoutDomain = trimmed.replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i, '');
  const cleaned = withoutDomain.replace(/^@/, '').split(/[/?#]/)[0];
  return cleaned || undefined;
}

function parseRedditInput(input: string): { subreddit?: string; postUrl?: string } {
  if (!input) return {};
  const trimmed = input.trim();
  
  if (trimmed.includes('/comments/') || trimmed.includes('redd.it/')) {
    return { postUrl: trimmed };
  }
  
  const subredditMatch = trimmed.match(/reddit\.com\/r\/([^\/\?#]+)/i);
  if (subredditMatch) {
    return { subreddit: subredditMatch[1] };
  }
  
  return { subreddit: trimmed };
}

function getSafePathInfo(resolvedPath: string): {
  identifier?: string;
  runTimestamp?: string;
  tweetCount?: number;
} {
  const relPath = path.relative(OUTPUT_ROOT, resolvedPath);
  if (relPath.startsWith('..')) return {};

  const parts = relPath.split(path.sep).filter(Boolean);
  if (parts.length < 3) return {};

  const identifier = parts[1];
  const runId = parts[2];

  let runTimestamp: string | undefined;
  const match = runId.match(/run-(.+)/);
  if (match && match[1]) {
    runTimestamp = match[1];
  }

  try {
    const dir = path.dirname(resolvedPath);
    const tweetsJsonPath = path.join(dir, 'tweets.json');
    if (fs.existsSync(tweetsJsonPath)) {
      const data = JSON.parse(fs.readFileSync(tweetsJsonPath, 'utf-8'));
      if (Array.isArray(data)) {
        return { identifier, runTimestamp, tweetCount: data.length };
      }
    }
  } catch {
    // ignore parse errors
  }

  return { identifier, runTimestamp };
}

// ============ Hono App ============

const app = new Hono();

// Global state
let isShuttingDown = false;

// Middleware
app.use('*', logger());

// API Key middleware for /api routes
app.use('/api/*', apiKeyMiddleware);

// ============ API Routes ============

// Job Management Routes
app.route('/api/jobs', jobRoutes);

// Health Check Routes
app.route('/api', healthRoutes);

// Stats Routes
app.route('/api', statsRoutes);

// Queue Monitor (replaces Bull Board)
app.route('/admin/queues', queueMonitor);

// Scrape V2 Endpoint
app.post('/api/scrape-v2', async (c) => {
  if (isShuttingDown) {
    return c.json({ error: 'Server is shutting down' }, 503);
  }

  try {
    const body = await c.req.json();
    const { type, input, limit, likes, mode, dateRange, enableRotation, enableProxy, strategy, antiDetectionLevel } = body;

    serverLogger.info('收到队列爬取请求', { type, input, limit });

    const isTwitter = type === 'profile' || type === 'thread' || type === 'search';
    const isReddit = type === 'reddit';

    if (!isTwitter && !isReddit) {
      return c.json({
        success: false,
        error: 'Invalid scrape type. Must be profile, thread, search, or reddit'
      }, 400);
    }

    // Build config
    let config: any = {};
    
    if (isTwitter) {
      const normalizedUsername = type === 'profile' ? normalizeUsername(input) : undefined;
      config = {
        username: normalizedUsername,
        tweetUrl: type === 'thread' ? input : undefined,
        searchQuery: type === 'search' ? input : undefined,
        limit: limit || 50,
        mode: mode || 'puppeteer',
        likes: likes || false,
        enableRotation: enableRotation !== false,
        enableProxy: enableProxy || false,
        dateRange,
        antiDetectionLevel,
      };
    } else if (isReddit) {
      const parsed = parseRedditInput(input);
      config = {
        subreddit: parsed.subreddit,
        postUrl: parsed.postUrl,
        limit: limit || 500,
        strategy: strategy || 'auto',
      };
    }

    // Create PostgreSQL Job record
    const dbJob = await JobRepository.createJob({
      type: isTwitter ? `twitter-${type}` : 'reddit',
      config,
      priority: type === 'thread' ? 10 : 5,
    });

    serverLogger.info('PostgreSQL Job created', { dbJobId: dbJob.id, type });

    // Add to BullMQ queue
    const jobData: any = {
      jobId: dbJob.id,
      type: isTwitter ? 'twitter' : 'reddit',
      config
    };

    const bullJob = await scrapeQueue.add(dbJob.id, jobData, {
      priority: type === 'thread' ? 10 : 5,
    });

    await JobRepository.updateBullJobId(dbJob.id, bullJob.id!);

    serverLogger.info('任务已加入队列', { dbJobId: dbJob.id, bullJobId: bullJob.id, type });

    return c.json({
      success: true,
      jobId: bullJob.id,
      dbJobId: dbJob.id,
      message: 'Task queued successfully',
      statusUrl: `/api/jobs/${bullJob.id}`,
      progressUrl: `/api/jobs/${bullJob.id}/stream`,
    });

  } catch (error: any) {
    serverLogger.error('队列添加失败', error);
    return c.json({
      success: false,
      error: error.message || 'Failed to queue task'
    }, 500);
  }
});

// Config endpoint
app.get('/api/config', (c) => {
  return c.json(configManager.getPublicConfig());
});

// Download endpoint
app.get('/api/download', (c) => {
  const filePathParam = c.req.query('path') || '';

  if (!filePathParam) {
    return c.text('Invalid file path', 400);
  }

  let resolvedPath = path.resolve(filePathParam);

  if (!outputPathManager.isPathSafe(resolvedPath)) {
    serverLogger.warn('下载路径不安全', {
      path: filePathParam,
      resolved: resolvedPath,
      baseDir: outputPathManager.getBaseDir(),
    });
    return c.text('Invalid file path', 400);
  }

  if (!fs.existsSync(resolvedPath)) {
    serverLogger.warn('文件不存在', { path: resolvedPath });
    return c.text('File not found', 404);
  }

  // Handle directory paths
  if (fs.statSync(resolvedPath).isDirectory()) {
    let candidate = path.join(resolvedPath, 'index.md');
    if (fs.existsSync(candidate)) {
      resolvedPath = candidate;
    } else if (path.basename(resolvedPath) === 'markdown') {
      candidate = path.join(path.dirname(resolvedPath), 'index.md');
      if (fs.existsSync(candidate)) {
        resolvedPath = candidate;
      }
    }
    
    if (!outputPathManager.isPathSafe(resolvedPath)) {
      return c.text('Invalid file path', 400);
    }
  }

  const basename = path.basename(resolvedPath);
  let downloadName = basename;
  
  if (basename === 'tweets.md' || basename === 'index.md') {
    const { identifier, runTimestamp, tweetCount } = getSafePathInfo(resolvedPath);
    const timestamp = runTimestamp || new Date().toISOString().split('T')[0];
    const countSegment = typeof tweetCount === 'number' ? `-${tweetCount}tweets` : '';
    const idSegment = identifier || 'twitter';
    downloadName = `${idSegment}-timeline-${timestamp}${countSegment}.md`;
  }

  const fileContent = fs.readFileSync(resolvedPath);
  return new Response(fileContent, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    },
  });
});

// Sessions endpoint
app.get('/api/sessions', async (c) => {
  try {
    const cookieManager = await createCookieManager();
    const sessions = await cookieManager.listSessions();
    return c.json({ success: true, sessions });
  } catch (error: any) {
    if (error.code === 'COOKIE_LOAD_FAILED' || error.message?.includes('No cookie files found')) {
      serverLogger.warn('/api/sessions: 未找到 cookies（首次运行正常）');
      return c.json({ success: true, sessions: [] });
    } else {
      serverLogger.error('获取会话列表失败', error);
      return c.json({ success: false, error: error.message }, 500);
    }
  }
});

// Cookie upload endpoint (requires native FormData handling)
app.post('/api/cookies', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ success: false, error: 'No file uploaded' }, 400);
    }

    // Ensure cookies directory exists
    const cookiesDir = path.join(process.cwd(), 'cookies');
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }

    // Save file
    const filename = file.name.endsWith('.json') ? file.name : `${file.name}.json`;
    const filePath = path.join(cookiesDir, filename);
    const fileBuffer = await file.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(fileBuffer));

    // Validate the uploaded file
    const cookieManager = await createCookieManager();
    try {
      await cookieManager.loadFromFile(filePath);
      return c.json({
        success: true,
        message: 'Cookies uploaded and validated successfully',
        filename,
      });
    } catch (validationError: any) {
      // If invalid, delete the file
      fs.unlinkSync(filePath);
      return c.json({
        success: false,
        error: `Invalid cookie file: ${validationError.message}`,
      }, 400);
    }
  } catch (error: any) {
    serverLogger.error('上传 cookies 失败', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ Static Files & SPA ============

// Serve static files from public directory
app.use('/assets/*', serveStatic({ root: './public' }));
app.use('/enso.svg', serveStatic({ path: './public/enso.svg' }));
app.use('/icon.png', serveStatic({ path: './public/icon.png' }));

// SPA fallback - serve requested HTML file or index.html
app.get('*', (c) => {
  const requestPath = c.req.path;
  
  // Try to serve the exact file if it's an HTML request
  if (requestPath.endsWith('.html')) {
    const filePath = path.join(STATIC_DIR, requestPath);
    if (fs.existsSync(filePath)) {
      return c.html(fs.readFileSync(filePath, 'utf-8'));
    }
  }
  
  // Fallback to index.html for SPA
  const indexPath = path.join(STATIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return c.html(fs.readFileSync(indexPath, 'utf-8'));
  }
  return c.text('Not found', 404);
});

// ============ Server Configuration ============

console.log(`Server configured for port ${PORT}`);
console.log(`📊 Queue monitor at http://localhost:${PORT}/queue-monitor.html`);

// Bun will automatically serve this when running with `bun run`
// The port is configured via export default { port, fetch }
export default {
  port: PORT,
  fetch: app.fetch,
};

