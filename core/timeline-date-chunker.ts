import { ScraperEngine } from './scraper-engine';
import type { ScrapeTimelineConfig, ScrapeTimelineResult } from './scraper-engine.types';
import { ScraperErrors } from './errors';
import { Tweet } from '../types';
import { DateUtils } from '../utils/date-utils';
import { createRunContext } from '../utils/fileutils';
import * as markdownUtils from '../utils/markdown';
import * as exportUtils from '../utils/export';
import { CHUNK_RETRY_CONFIG } from '../config/constants';
import { JobRepository } from './db/job-repo';
import { Task } from '../generated/prisma/client';

interface FailedChunk {
    index: number;
    range: { start: string; end: string };
    query: string;
    retryCount: number;
    error?: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Attempt to scrape a single chunk with retry logic
 */
async function scrapeChunkWithRetry(
    engine: ScraperEngine,
    chunkConfig: ScrapeTimelineConfig,
    chunkIndex: number,
    totalChunks: number,
    range: { start: string; end: string }
): Promise<{ success: boolean; tweets: Tweet[]; error?: string }> {
    let retryCount = 0;
    const attemptedSessions = new Set<string>();
    const currentSession = engine.getCurrentSession();
    if (currentSession) {
        attemptedSessions.add(currentSession.id);
    }

    while (retryCount <= CHUNK_RETRY_CONFIG.maxChunkRetries) {
        if (engine.shouldStop()) {
            return { success: false, tweets: [], error: 'Manual stop signal received' };
        }

        try {
            const result = await engine.scrapeTimeline(chunkConfig);

            if (result.success && result.tweets && result.tweets.length > 0) {
                return { success: true, tweets: result.tweets };
            }

            // If result is not successful or has no tweets, try session rotation
            if (!result.success || !result.tweets || result.tweets.length === 0) {
                const errorMsg = result.error || 'No tweets collected';
                
                // Check if we should retry with session rotation
                if (retryCount < CHUNK_RETRY_CONFIG.maxChunkRetries && engine.isRotationEnabled()) {
                    const allActiveSessions = engine.sessionManager.getAllActiveSessions();
                    const untriedSessions = allActiveSessions.filter(s => !attemptedSessions.has(s.id));

                    if (untriedSessions.length > 0) {
                        const nextSession = untriedSessions[0];
                        engine.eventBus.emitLog(
                            `[Chunk Retry] Chunk ${chunkIndex + 1}/${totalChunks} (${range.start} to ${range.end}) failed: ${errorMsg}. ` +
                            `Rotating to session ${nextSession.id} and retrying immediately...`,
                            'warn'
                        );

                        try {
                            await engine.applySession(nextSession, {
                                refreshFingerprint: false,
                                clearExistingCookies: true,
                            });
                            attemptedSessions.add(nextSession.id);
                            retryCount++;
                            await sleep(
                                CHUNK_RETRY_CONFIG.chunkRetryDelayBase + 
                                Math.random() * CHUNK_RETRY_CONFIG.chunkRetryDelayJitter
                            );
                            continue; // Retry the same chunk
                        } catch (sessionError: any) {
                            engine.eventBus.emitLog(
                                `[Chunk Retry] Session rotation failed: ${sessionError.message}`,
                                'error'
                            );
                            attemptedSessions.add(nextSession.id);
                            retryCount++;
                            continue;
                        }
                    } else {
                        engine.eventBus.emitLog(
                            `[Chunk Retry] All sessions exhausted for chunk ${chunkIndex + 1}. ` +
                            `Marking as failed after ${retryCount} retries.`,
                            'warn'
                        );
                        return { success: false, tweets: [], error: errorMsg };
                    }
                } else {
                    // No more retries or rotation disabled
                    return { success: false, tweets: [], error: errorMsg };
                }
            }

            return { success: true, tweets: result.tweets || [] };
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            engine.eventBus.emitLog(
                `[Chunk Retry] Error scraping chunk ${chunkIndex + 1}: ${errorMsg}`,
                'error'
            );

            // Check if we should retry with session rotation
            if (retryCount < CHUNK_RETRY_CONFIG.maxChunkRetries && engine.isRotationEnabled()) {
                const allActiveSessions = engine.sessionManager.getAllActiveSessions();
                const untriedSessions = allActiveSessions.filter(s => !attemptedSessions.has(s.id));

                if (untriedSessions.length > 0) {
                    const nextSession = untriedSessions[0];
                    engine.eventBus.emitLog(
                        `[Chunk Retry] Rotating to session ${nextSession.id} and retrying chunk ${chunkIndex + 1}...`,
                        'warn'
                    );

                    try {
                        await engine.applySession(nextSession, {
                            refreshFingerprint: false,
                            clearExistingCookies: true,
                        });
                        attemptedSessions.add(nextSession.id);
                        retryCount++;
                        await sleep(
                            CHUNK_RETRY_CONFIG.chunkRetryDelayBase + 
                            Math.random() * CHUNK_RETRY_CONFIG.chunkRetryDelayJitter
                        );
                        continue;
                    } catch (sessionError: any) {
                        engine.eventBus.emitLog(
                            `[Chunk Retry] Session rotation failed: ${sessionError.message}`,
                            'error'
                        );
                        attemptedSessions.add(nextSession.id);
                        retryCount++;
                        continue;
                    }
                } else {
                    return { success: false, tweets: [], error: errorMsg };
                }
            } else {
                return { success: false, tweets: [], error: errorMsg };
            }
        }
    }

    return { success: false, tweets: [], error: 'Maximum retry attempts reached' };
}

export async function runTimelineDateChunks(
  engine: ScraperEngine,
  config: ScrapeTimelineConfig
): Promise<ScrapeTimelineResult> {
    if (!config.dateRange || !config.searchQuery) {
        throw ScraperErrors.invalidConfiguration(
            'Date range and search query are required for chunked scraping',
            { config }
        );
    }

    let runContext = config.runContext;
    if (!runContext) {
        const identifier = config.searchQuery;
        runContext = await createRunContext({
            platform: 'x',
            identifier,
            baseOutputDir: config.outputDir
        });
    }

    const ranges = DateUtils.generateDateRanges(config.dateRange.start, config.dateRange.end, 'monthly');
    // REVERSE ranges to scrape newest first (Deep Search usually implies getting latest history first)
    ranges.reverse();

    const parallelChunks = config.parallelChunks || 1; // 并行数量，默认1（串行）
    const isParallel = parallelChunks > 1;
    
    if (isParallel) {
        engine.eventBus.emitLog(`Generated ${ranges.length} date chunks for historical search (Newest -> Oldest). Parallel processing enabled: ${parallelChunks} chunks simultaneously.`);
    } else {
        engine.eventBus.emitLog(`Generated ${ranges.length} date chunks for historical search (Newest -> Oldest).`);
    }

    let allTweets: Tweet[] = [];
    let totalCollected = 0;
    const globalLimit = config.limit || 10000; // Default or user limit
    const failedChunks: FailedChunk[] = [];

    // 共享进度状态（用于并行处理时的进度同步）
    // 使用Map记录每个chunk的上次计数，用于计算增量
    const chunkLastCounts = new Map<number, number>(); // chunkIndex -> 该chunk上次的内部计数
    const sharedProgress = {
        totalCollected: 0,
        limitReached: false, // 标记是否达到全局限制
        // 原子更新：基于chunk的增量累加
        addChunkIncrement(chunkIndex: number, chunkCurrentCount: number) {
            // chunkCurrentCount: chunk当前的内部计数（从0开始）
            const lastCount = chunkLastCounts.get(chunkIndex) || 0;
            
            if (chunkCurrentCount > lastCount && !this.limitReached) {
                // 计算增量
                const delta = chunkCurrentCount - lastCount;
                // 更新记录
                chunkLastCounts.set(chunkIndex, chunkCurrentCount);
                // 累加到全局
                this.totalCollected += delta;
                
                // 检查是否达到全局限制
                if (this.totalCollected >= globalLimit) {
                    this.limitReached = true;
                }
            }
            return this.totalCollected;
        },
        get() {
            return this.totalCollected;
        },
        isLimitReached() {
            return this.limitReached || this.totalCollected >= globalLimit;
        }
    };


    // 并行处理模式
    if (isParallel && engine.browserPool) {
        // 使用并发控制队列并行处理chunks
        const processChunksInParallel = async () => {
            const chunkTasks: Array<{ index: number; promise: Promise<{ success: boolean; tweets: Tweet[]; error?: string; taskId?: string }> }> = [];
            let currentIndex = 0;

            // 分批处理：每次启动parallelChunks个chunks
            while (currentIndex < ranges.length) {
                let currentGlobalTotal = sharedProgress.get();
                if (currentGlobalTotal >= globalLimit) {
                    engine.eventBus.emitLog(`Global limit of ${globalLimit} reached. Stopping deep search.`);
                    totalCollected = currentGlobalTotal; // 同步
                    break;
                }

                if (engine.shouldStop()) {
                    engine.eventBus.emitLog('Manual stop signal received. Stopping chunk processing.');
                    break;
                }

                // 启动一批chunks（最多parallelChunks个）
                const batch: number[] = [];
                while (batch.length < parallelChunks && currentIndex < ranges.length) {
                    batch.push(currentIndex++);
                }

                engine.eventBus.emitLog(`[Parallel] Starting batch: ${batch.length} chunks (${batch.map(i => i + 1).join(', ')})`);

                // 并行处理这一批chunks
                const batchPromises = batch.map(async (i) => {
                    const range = ranges[i];
                    const chunkQuery = `${config.searchQuery} since:${range.start} until:${range.end}`;

                    engine.eventBus.emitLog(`[Parallel] Processing chunk ${i + 1}/${ranges.length}: ${range.start} to ${range.end}`);

                    // Smart Resume: Check/Create Task in DB
                    let task: Task | null = null;
                    if (config.jobId) {
                        try {
                            // We don't have findTaskByConfig yet, but we can create one and if it exists we might want to check status?
                            // For now, let's just create a task record to track it.
                            // Ideally we should check if it exists and is completed.
                            // Since we don't have a unique constraint on task config/type/jobId easily accessible here without query,
                            // we will just log it for now. 
                            // TODO: Implement findTask to skip completed chunks.
                            task = await JobRepository.createTask({
                                jobId: config.jobId,
                                type: 'date-chunk',
                                config: { start: range.start, end: range.end, query: config.searchQuery }
                            });
                        } catch (e) {
                            // Ignore DB errors for tasks to avoid stopping scraping
                        }
                    }

                    // 记录chunk开始时的全局累计量（用于进度计算）
                    const chunkStartCount = sharedProgress.get();
                        const currentGlobalCount = sharedProgress.get();
                        // 如果已经达到全局限制，这个chunk不需要运行
                        if (currentGlobalCount >= globalLimit) {
                            engine.eventBus.emitLog(`[Parallel] Global limit ${globalLimit} already reached, skipping chunk ${i + 1}`, 'info');
                            return { index: i, result: { success: true, tweets: [] } };
                        }
                        const remaining = globalLimit - currentGlobalCount;
                        const chunkLimit = remaining;

                    const chunkConfig: ScrapeTimelineConfig = {
                        ...config,
                        searchQuery: chunkQuery,
                        dateRange: undefined,
                        resume: false,
                        limit: chunkLimit,
                        runContext,
                        saveMarkdown: false,
                        exportCsv: false,
                        exportJson: false,
                        progressBase: chunkStartCount, // 使用chunk开始时的累计量
                        progressTarget: globalLimit
                    };

                    // 创建包装的eventBus，拦截进度更新和日志，基于共享状态重新计算
                    const originalEmitProgress = engine.eventBus.emitProgress.bind(engine.eventBus);
                    const originalEmitLog = engine.eventBus.emitLog.bind(engine.eventBus);
                    
                    const wrappedEventBus = Object.create(engine.eventBus);
                    
                    // 拦截进度更新 - 使用增量更新机制，避免覆盖其他chunk的进度
                    wrappedEventBus.emitProgress = (data: any) => {
                        // data.current 是chunk内部的计数（基于progressBase），需要转换为chunk内部的绝对计数
                        const chunkCurrent = data.current - (chunkConfig.progressBase || 0);
                        
                        // 使用增量更新机制，累加这个chunk的增量到全局
                        const globalTotal = sharedProgress.addChunkIncrement(i, chunkCurrent);
                        
                        // 检查全局限制
                        if (globalTotal >= globalLimit) {
                            // 达到限制，标记为应该停止
                            sharedProgress.limitReached = true;
                            engine.eventBus.emitLog(`✅ Global limit of ${globalLimit} reached. This chunk should stop.`, 'info');
                        }
                        
                        // 发出全局进度更新（不超过限制）
                        originalEmitProgress({
                            current: Math.min(globalTotal, globalLimit),
                            target: globalLimit,
                            action: `scraping chunk ${i + 1}/${ranges.length} (parallel)`
                        });
                    };
                    
                    // 拦截日志输出，替换"Total: X"为全局计数
                    wrappedEventBus.emitLog = (message: string, level?: string) => {
                        // 如果日志包含"Total: X"，替换为全局计数
                        if (typeof message === 'string' && /Total:\s*\d+/.test(message)) {
                            // 提取chunk内部的Total值（这是chunk内部的累计计数，从0开始）
                            const totalMatch = message.match(/Total:\s*(\d+)/);
                            if (totalMatch) {
                                const chunkTotal = parseInt(totalMatch[1], 10);
                                
                                // 使用增量更新机制，累加这个chunk的增量到全局
                                const globalTotal = sharedProgress.addChunkIncrement(i, chunkTotal);
                                
                                // 替换为全局计数
                                message = message.replace(/Total:\s*\d+(\s*\(global\))?/, `Total: ${globalTotal} (global)`);
                            }
                        }
                        // 转发到原始eventBus
                        originalEmitLog(message, level);
                    };

                    // 为每个chunk创建独立的engine实例（共享依赖和浏览器池）
                    // 创建一个shouldStop函数，检查全局限制和原始停止信号
                    const chunkShouldStop = () => {
                        return engine.shouldStop() || sharedProgress.isLimitReached();
                    };
                    
                    const chunkEngine = new ScraperEngine(
                        chunkShouldStop,
                        {
                            apiOnly: false,
                            browserPool: engine.browserPool, // 共享浏览器池
                            dependencies: engine.dependencies, // 共享依赖（session manager等）
                            eventBus: wrappedEventBus as typeof engine.eventBus, // 使用包装的eventBus
                            headless: true,
                            jobId: config.jobId // Pass jobId to child engine
                        }
                    );

                    try {
                        // 初始化chunk engine
                        await chunkEngine.init();
                        chunkEngine.proxyManager.setEnabled(engine.proxyManager.isEnabled());
                        await chunkEngine.loadCookies(config.enableRotation !== false);

                        const result = await scrapeChunkWithRetry(chunkEngine, chunkConfig, i, ranges.length, range);
                        await chunkEngine.close();
                        return { index: i, result, taskId: task?.id };
                    } catch (error: any) {
                        await chunkEngine.close();
                        return { 
                            index: i, 
                            result: { success: false, tweets: [], error: error.message || String(error) },
                            taskId: task?.id
                        };
                    }
                });

                // 等待这一批chunks全部完成
                const batchResults = await Promise.all(batchPromises);

                // 处理结果
                for (const { index, result, taskId } of batchResults) {
                    const range = ranges[index];

                    if (result.success) {
                        if (taskId) {
                            try {
                                await JobRepository.updateTaskStatus(taskId, 'completed', { count: result.tweets?.length });
                            } catch (e) {
                                // Ignore DB error
                            }
                        }

                        if (result.tweets && result.tweets.length > 0) {
                            const newTweets = result.tweets;
                            allTweets = allTweets.concat(newTweets);
                            // 注意：进度已经在emitLog中通过增量更新了，这里只需要同步totalCollected
                            totalCollected = sharedProgress.get(); // 同步到局部变量
                            const cappedTotal = Math.min(totalCollected, globalLimit); // 不超过限制
                            engine.eventBus.emitLog(`✅ [Parallel] Chunk ${index + 1}/${ranges.length} complete: ${newTweets.length} tweets collected | Global total: ${cappedTotal}/${globalLimit}`);
                            
                            // 如果达到全局限制，记录日志
                            if (totalCollected >= globalLimit) {
                                engine.eventBus.emitLog(`✅ Global limit of ${globalLimit} reached after chunk ${index + 1}. Stopping batch.`, 'info');
                            }
                        } else {
                            engine.eventBus.emitLog(`✅ [Parallel] Chunk ${index + 1}/${ranges.length} complete: No tweets found (empty).`, 'info');
                        }
                    } else {
                        if (taskId) {
                            try {
                                await JobRepository.updateTaskStatus(taskId, 'failed', undefined, result.error);
                            } catch (e) {
                                // Ignore DB error
                            }
                        }

                        failedChunks.push({
                            index,
                            range,
                            query: `${config.searchQuery} since:${range.start} until:${range.end}`,
                            retryCount: 0,
                            error: result.error
                        });
                        engine.eventBus.emitLog(
                            `❌ [Parallel] Chunk ${index + 1}/${ranges.length} failed: ${result.error || 'Unknown error'}. ` +
                            `Will retry in global retry phase.`,
                            'warn'
                        );
                    }
                }

                // 如果达到全局限制，停止处理
                currentGlobalTotal = sharedProgress.get();
                totalCollected = currentGlobalTotal; // 同步
                if (currentGlobalTotal >= globalLimit) {
                    break;
                }
            }
        };

        await processChunksInParallel();
    } else {
        // 串行处理模式（原有逻辑）
        // First pass: process all chunks with retry
        for (let i = 0; i < ranges.length; i++) {
            // Check if we reached the global limit
            if (totalCollected >= globalLimit) {
                engine.eventBus.emitLog(`Global limit of ${globalLimit} reached. Stopping deep search.`);
                break;
            }

            if (engine.shouldStop()) {
                engine.eventBus.emitLog('Manual stop signal received. Stopping chunk processing.');
                break;
            }

            const range = ranges[i];
            const chunkQuery = `${config.searchQuery} since:${range.start} until:${range.end}`;

            engine.eventBus.emitLog(`Processing chunk ${i + 1}/${ranges.length}: ${range.start} to ${range.end}`);

            // Calculate remaining limit
            const remaining = globalLimit - totalCollected;
            // Set chunk limit to remaining needed count
            const chunkLimit = remaining;

            // Create a sub-config for this chunk
            // 传递 progressBase 和 progressTarget 以确保进度显示全局累计量
            const chunkConfig: ScrapeTimelineConfig = {
                ...config,
                searchQuery: chunkQuery,
                dateRange: undefined, // Prevent recursion
                resume: false,
                limit: chunkLimit,
                runContext,
                saveMarkdown: false,
                exportCsv: false,
                exportJson: false,
                progressBase: totalCollected, // 全局累计量作为基础
                progressTarget: globalLimit   // 全局目标量
            };

            const result = await scrapeChunkWithRetry(engine, chunkConfig, i, ranges.length, range);

            if (result.success) {
                if (result.tweets && result.tweets.length > 0) {
                    const newTweets = result.tweets;
                    allTweets = allTweets.concat(newTweets);
                    totalCollected += newTweets.length;
                    engine.eventBus.emitLog(`✅ Chunk ${i + 1}/${ranges.length} complete: ${newTweets.length} tweets collected | Global total: ${totalCollected}/${globalLimit}`);
                } else {
                    engine.eventBus.emitLog(`✅ Chunk ${i + 1}/${ranges.length} complete: No tweets found (empty).`, 'info');
                }
            } else {
                // Record failed chunk for global retry
                failedChunks.push({
                    index: i,
                    range,
                    query: chunkQuery,
                    retryCount: 0,
                    error: result.error
                });
                engine.eventBus.emitLog(
                    `❌ Chunk ${i + 1}/${ranges.length} failed: ${result.error || 'Unknown error'}. ` +
                    `Will retry in global retry phase.`,
                    'warn'
                );
            }
        }
    }

    // Global retry phase: retry failed chunks
    if (failedChunks.length > 0 && engine.isRotationEnabled()) {
        engine.eventBus.emitLog(
            `\n[Global Retry] Starting global retry phase for ${failedChunks.length} failed chunk(s)...`,
            'info'
        );

        for (let globalRetryPass = 0; globalRetryPass < CHUNK_RETRY_CONFIG.maxGlobalRetries; globalRetryPass++) {
            if (engine.shouldStop()) {
                break;
            }

            const chunksToRetry = failedChunks.filter(chunk => chunk.retryCount <= globalRetryPass);
            if (chunksToRetry.length === 0) {
                break;
            }

            engine.eventBus.emitLog(
                `[Global Retry] Pass ${globalRetryPass + 1}/${CHUNK_RETRY_CONFIG.maxGlobalRetries}: Retrying ${chunksToRetry.length} chunk(s)...`,
                'info'
            );

            // Reset session manager to allow reusing sessions
            const allActiveSessions = engine.sessionManager.getAllActiveSessions();
            if (allActiveSessions.length > 0) {
                // Try to use a different session for global retry
                // 使用更智能的session选择：优先选择未尝试过的session，如果都尝试过则轮换
                const sessionIndex = globalRetryPass % allActiveSessions.length;
                const nextSession = allActiveSessions[sessionIndex];
                
                // 检查这个session是否在之前的chunk retry中已经尝试过
                // 如果所有session都尝试过，则使用轮换策略
                try {
                    await engine.applySession(nextSession, {
                        refreshFingerprint: false,
                        clearExistingCookies: true,
                    });
                    engine.eventBus.emitLog(
                        `[Global Retry] Switched to session ${nextSession.id} for retry pass ${globalRetryPass + 1} (${sessionIndex + 1}/${allActiveSessions.length})`,
                        'info'
                    );
                } catch (sessionError: any) {
                    engine.eventBus.emitLog(
                        `[Global Retry] Failed to switch session: ${sessionError.message}`,
                        'warn'
                    );
                    // 如果session切换失败，继续尝试下一个
                    if (allActiveSessions.length > 1) {
                        const nextIndex = (sessionIndex + 1) % allActiveSessions.length;
                        const fallbackSession = allActiveSessions[nextIndex];
                        try {
                            await engine.applySession(fallbackSession, {
                                refreshFingerprint: false,
                                clearExistingCookies: true,
                            });
                            engine.eventBus.emitLog(
                                `[Global Retry] Fallback: Switched to session ${fallbackSession.id}`,
                                'info'
                            );
                        } catch (fallbackError: any) {
                            engine.eventBus.emitLog(
                                `[Global Retry] Fallback session also failed: ${fallbackError.message}`,
                                'warn'
                            );
                        }
                    }
                }
            }

            for (const failedChunk of chunksToRetry) {
                if (engine.shouldStop() || totalCollected >= globalLimit) {
                    break;
                }

                const remaining = globalLimit - totalCollected;
                const chunkLimit = remaining;

                const chunkConfig: ScrapeTimelineConfig = {
                    ...config,
                    searchQuery: failedChunk.query,
                    dateRange: undefined,
                    resume: false,
                    limit: chunkLimit,
                    runContext,
                    saveMarkdown: false,
                    exportCsv: false,
                    exportJson: false,
                    progressBase: totalCollected, // 全局累计量作为基础
                    progressTarget: globalLimit   // 全局目标量
                };

                engine.eventBus.emitLog(
                    `[Global Retry] Retrying chunk ${failedChunk.index + 1}/${ranges.length}: ` +
                    `${failedChunk.range.start} to ${failedChunk.range.end}...`,
                    'info'
                );

                const result = await scrapeChunkWithRetry(
                    engine,
                    chunkConfig,
                    failedChunk.index,
                    ranges.length,
                    failedChunk.range
                );

                if (result.success && result.tweets && result.tweets.length > 0) {
                    const newTweets = result.tweets;
                    allTweets = allTweets.concat(newTweets);
                    totalCollected += newTweets.length;
                    failedChunk.retryCount = CHUNK_RETRY_CONFIG.maxGlobalRetries + 1; // Mark as successfully retried
                    engine.eventBus.emitLog(
                        `✅ [Global Retry] Chunk ${failedChunk.index + 1} recovered: ${newTweets.length} tweets collected | Global total: ${totalCollected}/${globalLimit}`,
                        'info'
                    );
                } else {
                    failedChunk.retryCount++;
                    engine.eventBus.emitLog(
                        `❌ [Global Retry] Chunk ${failedChunk.index + 1} still failed: ${result.error || 'Unknown error'}`,
                        'warn'
                    );
                }
            }
        }

        // Report final status of failed chunks
        const stillFailed = failedChunks.filter(chunk => chunk.retryCount <= CHUNK_RETRY_CONFIG.maxGlobalRetries);
        if (stillFailed.length > 0) {
            engine.eventBus.emitLog(
                `\n[Global Retry] ${stillFailed.length} chunk(s) still failed after all retry attempts:`,
                'warn'
            );
            for (const chunk of stillFailed) {
                engine.eventBus.emitLog(
                    `  - Chunk ${chunk.index + 1}: ${chunk.range.start} to ${chunk.range.end} (Error: ${chunk.error || 'Unknown'})`,
                    'warn'
                );
            }
        } else {
            engine.eventBus.emitLog(`\n[Global Retry] All failed chunks successfully recovered!`, 'info');
        }
    } else if (failedChunks.length > 0 && !engine.isRotationEnabled()) {
        engine.eventBus.emitLog(
            `\n[Warning] ${failedChunks.length} chunk(s) failed, but auto-rotation is disabled. Skipping global retry.`,
            'warn'
        );
    }

    if (runContext && allTweets.length > 0) {
        if (config.saveMarkdown ?? true) {
            await markdownUtils.saveTweetsAsMarkdown(allTweets, runContext);
        }
        if (config.exportCsv) {
            await exportUtils.exportToCsv(allTweets, runContext);
        }
        if (config.exportJson) {
            await exportUtils.exportToJson(allTweets, runContext);
        }
    }

    return {
        success: allTweets.length > 0,
        tweets: allTweets,
        runContext,
        performance: engine.performanceMonitor.getStats()
    };
}
