"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastProgress = broadcastProgress;
const express_1 = __importDefault(require("express"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const scraper = __importStar(require("./scrape-unified"));
const event_bus_1 = __importDefault(require("./core/event-bus"));
const stop_signal_1 = require("./core/stop-signal");
const path_utils_1 = require("./utils/path-utils");
const app = (0, express_1.default)();
const PORT = 3000;
const OUTPUT_ROOT = path.resolve(process.cwd(), 'output');
// Global state for manual stop
let isScrapingActive = false;
let lastDownloadUrl = null;
// Middleware
app.use(express_1.default.json());
app.use(express_1.default.static(path.join(__dirname, 'public')));
// API: Scrape
app.post('/api/scrape', async (req, res) => {
    try {
        const { type, input, limit = 50, likes = false, mergeResults = false, deleteMerged = false } = req.body;
        console.log(`Received scrape request: Type=${type}, Input=${input}, Limit=${limit}`);
        // Reset stop flag and set active state
        (0, stop_signal_1.resetShouldStopScraping)();
        isScrapingActive = true;
        lastDownloadUrl = null; // Clear previous result
        let result;
        if (type === 'profile') {
            // Profile Scrape
            const username = input.replace('@', '').replace('https://x.com/', '').replace('/', '');
            result = await scraper.scrapeXFeed({
                username,
                limit: parseInt(limit),
                scrapeLikes: likes,
                saveMarkdown: true,
                mergeResults,
                deleteMerged
            });
        }
        else if (type === 'thread') {
            // Thread Scrape
            result = await scraper.scrapeThread({
                tweetUrl: input,
                maxReplies: parseInt(limit),
                saveMarkdown: true
            });
        }
        else if (type === 'search') {
            // Search Scrape
            result = await scraper.scrapeSearch({
                query: input,
                limit: parseInt(limit),
                saveMarkdown: true,
                mergeResults,
                deleteMerged
            });
        }
        else {
            return res.status(400).json({ error: 'Invalid scrape type' });
        }
        if (result && result.success) {
            console.log('[DEBUG] Scrape result:', JSON.stringify({
                success: result.success,
                hasRunContext: !!result.runContext,
                hasTweets: !!result.tweets,
                tweetsCount: result.tweets?.length,
                runContextKeys: result.runContext ? Object.keys(result.runContext) : [],
                markdownIndexPath: result.runContext?.markdownIndexPath
            }, null, 2));
            const runContext = result.runContext;
            if (runContext && runContext.markdownIndexPath) {
                // Success
                const downloadUrl = `/api/download?path=${encodeURIComponent(runContext.markdownIndexPath)}`;
                lastDownloadUrl = downloadUrl; // Save for later retrieval
                console.log('[DEBUG] Sending success response with downloadUrl:', runContext.markdownIndexPath);
                return res.json({
                    success: true,
                    message: 'Scraping completed successfully!',
                    downloadUrl,
                    stats: {
                        count: result.tweets ? result.tweets.length : 0
                    }
                });
            }
            else {
                // No file path found
                console.error('[DEBUG] No markdownIndexPath found in runContext');
                return res.status(500).json({
                    success: false,
                    error: 'Scraping finished but output file not found.'
                });
            }
        }
        else {
            // Error
            console.error('Scraping failed:', result?.error || 'Unknown error');
            return res.status(500).json({
                success: false,
                error: result?.error || 'Scraping failed'
            });
        }
    }
    catch (error) {
        console.error('Server error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
    finally {
        // Reset scraping state
        isScrapingActive = false;
        (0, stop_signal_1.resetShouldStopScraping)();
    }
});
// API: Monitor
app.post('/api/monitor', async (req, res) => {
    try {
        const { users, lookbackHours, keywords } = req.body;
        if (!users || !Array.isArray(users) || users.length === 0) {
            return res.status(400).json({ error: 'Invalid users list' });
        }
        console.log(`Received monitor request for: ${users.join(', ')}`);
        isScrapingActive = true;
        (0, stop_signal_1.resetShouldStopScraping)();
        // Dynamic import to avoid circular dependencies or initialization issues
        const { ScraperEngine } = require('./core/scraper-engine');
        const { MonitorService } = require('./core/monitor-service');
        const engine = new ScraperEngine(() => (0, stop_signal_1.getShouldStopScraping)());
        await engine.init();
        const success = await engine.loadCookies();
        if (!success) {
            await engine.close();
            return res.status(500).json({ error: 'Failed to load cookies' });
        }
        const monitor = new MonitorService(engine);
        await monitor.runMonitor(users, {
            lookbackHours: lookbackHours ? parseFloat(lookbackHours) : undefined,
            keywords: keywords ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : undefined
        });
        await engine.close();
        // Check for report file
        const dateStr = new Date().toISOString().split('T')[0];
        const reportPath = path.join(process.cwd(), 'output', 'reports', `daily_report_${dateStr}.md`);
        let downloadUrl = null;
        if (fs.existsSync(reportPath)) {
            downloadUrl = `/api/download?path=${encodeURIComponent(reportPath)}`;
        }
        res.json({
            success: true,
            message: 'Monitor run completed',
            downloadUrl
        });
    }
    catch (error) {
        console.error('Monitor error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
    finally {
        isScrapingActive = false;
        (0, stop_signal_1.resetShouldStopScraping)();
    }
});
// API: Manual Stop
app.post('/api/stop', (req, res) => {
    console.log('Received manual stop request');
    if (!isScrapingActive) {
        return res.json({
            success: false,
            message: 'No active scraping session'
        });
    }
    (0, stop_signal_1.setShouldStopScraping)(true);
    console.log('Stop flag set. Waiting for scraper to terminate gracefully...');
    res.json({
        success: true,
        message: 'Stop signal sent. Scraper will terminate after current batch.'
    });
});
// API: Progress Stream (SSE)
app.get('/api/progress', (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Send initial message
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Progress stream connected' })}\n\n`);
    // Listener for progress events
    const onProgress = (data) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', ...data })}\n\n`);
    };
    const onLog = (data) => {
        res.write(`data: ${JSON.stringify({ type: 'log', ...data })}\n\n`);
    };
    const onError = (error) => {
        console.error('[Scraper Error]', error);
        res.write(`data: ${JSON.stringify({ type: 'log', level: 'error', message: error.message })}\n\n`);
    };
    event_bus_1.default.on('scrape:progress', onProgress);
    event_bus_1.default.on('log:message', onLog);
    event_bus_1.default.on('scrape:error', onError);
    // Remove listeners on disconnect
    req.on('close', () => {
        event_bus_1.default.off('scrape:progress', onProgress);
        event_bus_1.default.off('log:message', onLog);
        event_bus_1.default.off('scrape:error', onError);
        console.log('[SSE] Client disconnected');
    });
});
// Helper function to broadcast progress (Deprecated, kept for compatibility)
function broadcastProgress(data) {
    event_bus_1.default.emitProgress(data);
}
// API: Get scraping status
app.get('/api/status', (req, res) => {
    res.json({
        isActive: isScrapingActive,
        shouldStop: (0, stop_signal_1.getShouldStopScraping)()
    });
});
// API: Get result (download URL after scraping completes)
app.get('/api/result', (req, res) => {
    res.json({
        isActive: isScrapingActive,
        downloadUrl: lastDownloadUrl
    });
});
// API: Download
app.get('/api/download', (req, res) => {
    const filePathParam = typeof req.query.path === 'string' ? req.query.path : '';
    const resolvedPath = path.resolve(filePathParam);
    if (!filePathParam || !(0, path_utils_1.isPathInsideBase)(resolvedPath, OUTPUT_ROOT)) {
        return res.status(400).send('Invalid file path');
    }
    if (!fs.existsSync(resolvedPath)) {
        return res.status(404).send('File not found');
    }
    // Generate a better filename
    const basename = path.basename(resolvedPath);
    let downloadName = basename;
    if (basename === 'tweets.md' || basename === 'index.md') {
        const timestamp = new Date().toISOString().split('T')[0];
        downloadName = `twitter-scrape-${timestamp}.md`;
    }
    res.download(resolvedPath, downloadName);
});
// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
