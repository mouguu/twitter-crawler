import * as constants from '../config/constants';
import type { ProfileInfo, Tweet } from '../types/tweet-definitions';
import * as fileUtils from '../utils';
import * as markdownUtils from '../utils';
import * as exportUtils from '../utils';
import * as screenshotUtils from '../utils';
import { cleanTweetsFast, sleepOrCancel, waitOrCancel } from '../utils';
import * as dataExtractor from './data-extractor';
import { ScraperErrors } from './errors';
import type { ScraperEngine } from './scraper-engine';
import type { ScrapeTimelineConfig, ScrapeTimelineResult } from './scraper-engine.types';

export async function runTimelineDom(
  engine: ScraperEngine,
  config: ScrapeTimelineConfig,
): Promise<ScrapeTimelineResult> {
  // 确保页面可用
  if (!engine.getPageInstance()) {
    await engine.ensurePage();
  }

  // Start performance monitoring
  engine.performanceMonitor.reset();
  engine.performanceMonitor.setMode('puppeteer');
  engine.performanceMonitor.start();
  engine.emitPerformanceUpdate(true);

  const {
    username,
    limit = 50,
    mode = 'timeline',
    searchQuery,
    saveMarkdown = true,
    saveScreenshots = false,
    exportCsv = false,
    exportJson = false,
    progressBase = 0,
  } = config as any;
  const progressTarget = (config as any).progressTarget; // Temporary cast if type is strict
  let { runContext } = config;
  const totalTarget = progressTarget ?? progressBase + limit;

  // Initialize runContext if missing
  if (!runContext) {
    const identifier = username || searchQuery || 'unknown';
    runContext = await fileUtils.createRunContext({
      platform: 'x',
      identifier,
      baseOutputDir: config.outputDir,
    });
    engine.eventBus.emitLog(`Created new run context: ${runContext.runId}`);
  }

  const collectedTweets: Tweet[] = [];
  const scrapedIds = new Set<string>();
  let profileInfo: ProfileInfo | null = null;
  let wasmCleanerLogged = false;

  // Session 管理（与 GraphQL 模式一致）
  const attemptedSessions = new Set<string>();
  const initialSession = engine.getCurrentSession();
  if (initialSession) attemptedSessions.add(initialSession.id);

  // Cancellation checker wrapper
  const shouldStop = () => engine.shouldStop();

  try {
    // 构建目标 URL
    let targetUrl: string;
    if (mode === 'search' && searchQuery) {
      targetUrl = `https://x.com/search?q=${encodeURIComponent(searchQuery)}&src=typed_query&f=live`;
    } else if (username) {
      targetUrl = `https://x.com/${username}`;
    } else {
      targetUrl = 'https://x.com/home';
    }

    // 导航到页面（带 session 切换重试逻辑）
    let navigationSuccess = false;
    let navigationAttempts = 0;
    const maxNavigationAttempts = 4; // 最多尝试4个session

    while (!navigationSuccess && navigationAttempts < maxNavigationAttempts) {
      if (await shouldStop()) break;
      try {
        engine.performanceMonitor.startPhase('navigation');
        // biome-ignore lint/style/noNonNullAssertion: page ensured
        await waitOrCancel(
          engine.navigationService.navigateToUrl(engine.getPageInstance()!, targetUrl),
          shouldStop
        );
        
        if (await shouldStop()) break;

        const tweetsFound = await waitOrCancel(
          engine.navigationService.waitForTweets(
            // biome-ignore lint/style/noNonNullAssertion: page ensured
            engine.getPageInstance()!,
            {
              timeout: 10000, // 减少超时时间
              maxRetries: 1, // 只重试1次
            }
          ),
          shouldStop
        );

        engine.performanceMonitor.endPhase();
        navigationSuccess = true;

        if (!tweetsFound) {
          engine.eventBus.emitLog(
            'No tweets found for this query/chunk (valid empty state). Skipping extraction.',
            'info',
          );
          // Return early with success and empty tweets
          return {
            success: true,
            tweets: [],
            runContext,
            profile: profileInfo,
            performance: engine.performanceMonitor.getStats(),
          };
        }
        // biome-ignore lint/suspicious/noExplicitAny: error handling
      } catch (navError: any) {
        if (navError.message === 'Job cancelled by user') throw navError;

        engine.performanceMonitor.endPhase();
        navigationAttempts++;
        engine.eventBus.emitLog(
          `Page load failed (attempt ${navigationAttempts}/${maxNavigationAttempts}): ${navError.message}`,
          'warn',
        );

        if (navigationAttempts >= maxNavigationAttempts) {
          throw new Error(`Failed to load page after ${maxNavigationAttempts} attempts`);
        }

        // 尝试切换 Session
        if (config.enableRotation && navigationAttempts < maxNavigationAttempts) {
          const nextSession = await engine.sessionManager.getNextSession();
          if (nextSession) {
            try {
              // Use restartBrowserWithSession to ensure IP switch during navigation rotation
              await waitOrCancel(engine.restartBrowserWithSession(nextSession), shouldStop);
              engine.eventBus.emitLog(`Rotated to session: ${nextSession.id}`, 'info');

              // 减少等待时间，加快切换（从2000ms减少到500ms）
              await sleepOrCancel(500, shouldStop);
              // biome-ignore lint/suspicious/noExplicitAny: error handling
            } catch (e: any) {
              if (e.message === 'Job cancelled by user') throw e;
              engine.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
              attemptedSessions.add(nextSession.id);
            }
          } else {
            engine.eventBus.emitLog(`All sessions attempted. Stopping.`, 'error');
            break;
          }
        } else {
          // 临时错误，等待后重试
          const waitTime = 2000 + Math.random() * 1000;
          await sleepOrCancel(waitTime, shouldStop);
        }
      }
    }

    if (await shouldStop()) {
      throw new Error('Job cancelled by user');
    }

    // 提取资料信息（如果是用户页面）
    if (username && config.collectProfileInfo) {
      if (await shouldStop()) throw new Error('Job cancelled by user');
      const page = engine.getPageInstance();
      if (page) {
        profileInfo = await dataExtractor.extractProfileInfo(page);
      }
    }

    // 滚动并提取推文
    let consecutiveNoNew = 0;
    // 针对 mixed 续跑场景，使用总目标而非本地 remainingLimit 来决定耐心阈值
    const effectiveTarget = totalTarget;
    // 对于大目标（>500条），适度增加连续无新推文的容忍度
    // 降低最大尝试次数，避免过长时间的无效重复尝试
    const maxNoNew =
      effectiveTarget > 500
        ? Math.max(constants.MAX_CONSECUTIVE_NO_NEW_TWEETS * 2, 5)
        : constants.MAX_CONSECUTIVE_NO_NEW_TWEETS;
    let consecutiveErrors = 0;

    // 记录所有 session 都无法加载新推文的次数
    let sessionsFailedCount = 0;
    const MAX_SESSIONS_FAILED = 2; // 如果连续2个session都无法加载新推文，可能是平台限制

    // Deep Search 变量 (Placeholder for future use or removal if unused)
    // const deepSearchMode = false;
    // const deepSearchScrolls = 0;
    // const MAX_DEEP_SEARCH_SCROLLS = 20;

    engine.performanceMonitor.startPhase('main-loop');

    while (collectedTweets.length < limit && consecutiveNoNew < maxNoNew) {
      if (await shouldStop()) {
        engine.eventBus.emitLog('Manual stop signal received', 'warn');
        break;
      }

      // Extraction Phase
      try {
        engine.performanceMonitor.startPhase('extraction');
        // biome-ignore lint/style/noNonNullAssertion: page existence checked by ensurePage
        let tweetsOnPage = await waitOrCancel(dataExtractor.extractTweetsFromPage(engine.getPageInstance()!), shouldStop);
        engine.performanceMonitor.endPhase();

        // 检查页面是否显示错误或限制（如 "Something went wrong", "Rate limit" 等）
        const pageText = await engine.getPageInstance()?.evaluate(() => document.body.innerText);
        const hasError =
          /rate limit|something went wrong|try again later|suspended|restricted|blocked/i.test(
            pageText || '',
          );

        if (hasError && tweetsOnPage.length === 0) {
          // 尝试从错误页面恢复：自动点击 "Try Again" 按钮
          engine.eventBus.emitLog(
            'Error page detected. Attempting to recover by clicking "Try Again" button...',
            'warn',
          );

          // biome-ignore lint/style/noNonNullAssertion: page exists
          const recovered = await dataExtractor.recoverFromErrorPage(engine.getPageInstance()!, 2, shouldStop);

          if (recovered) {
            engine.eventBus.emitLog(
              'Successfully recovered from error page. Re-extracting tweets...',
              'info',
            );
            // 重新提取推文
            await sleepOrCancel(2000, shouldStop); // 等待页面加载
            // biome-ignore lint/style/noNonNullAssertion: page exists
            tweetsOnPage = await waitOrCancel(dataExtractor.extractTweetsFromPage(engine.getPageInstance()!), shouldStop);
            if (tweetsOnPage.length > 0) {
              engine.eventBus.emitLog(
                `Recovery successful: found ${tweetsOnPage.length} tweets after retry.`,
                'info',
              );
            } else {
              // 恢复后仍然没有推文，可能是真的没有内容
              engine.eventBus.emitLog(
                'Recovery successful but no tweets found. This may be normal.',
                'info',
              );
            }
          } else {
            // 恢复失败，抛出异常
            throw ScraperErrors.apiRequestFailed(
              'Page shows error or rate limit message and recovery failed',
              undefined,
              { url: 'https://x.com' },
            );
          }
        }

        const cleaned = await cleanTweetsFast([], tweetsOnPage, { limit });
        if (cleaned.usedWasm && !wasmCleanerLogged) {
          engine.eventBus.emitLog('Using Rust/WASM tweet cleaner for normalization/dedup.', 'info');
          wasmCleanerLogged = true;
        }

        let addedCount = 0;
        for (const tweet of cleaned.tweets) {
          if (collectedTweets.length >= limit) break;
          if (scrapedIds.has(tweet.id)) continue;

          // Check stop conditions
          if (config.stopAtTweetId && tweet.id === config.stopAtTweetId) {
            engine.eventBus.emitLog(`Reached stop tweet ID: ${tweet.id}`);
            consecutiveNoNew = maxNoNew; // Stop loop
            break;
          }
          if (config.sinceTimestamp && tweet.time) {
            const tweetTime = new Date(tweet.time).getTime();
            if (tweetTime < config.sinceTimestamp) {
              engine.eventBus.emitLog(`Reached time limit: ${tweet.time}`);
              consecutiveNoNew = maxNoNew; // Stop loop
              break;
            }
          }

          collectedTweets.push(tweet);
          scrapedIds.add(tweet.id);
          addedCount++;
        }

        engine.eventBus.emitLog(
          `Extracted ${cleaned.tweets.length} cleaned tweets (raw ${tweetsOnPage.length}), added ${addedCount} new. Total: ${collectedTweets.length}`,
        );

        // Update performance monitor
        engine.performanceMonitor.recordTweets(collectedTweets.length);
        engine.emitPerformanceUpdate();

        // Update progress
        const currentProgress = progressBase + collectedTweets.length;
        engine.eventBus.emitProgress({
          current: Math.min(currentProgress, totalTarget), // 不超过目标
          target: totalTarget,
          action: 'scraping (DOM)',
        });

        // 如果达到目标，应该停止
        if (currentProgress >= totalTarget) {
          engine.eventBus.emitLog(
            `✅ Target of ${totalTarget} reached. Stopping extraction.`,
            'info',
          );
          break;
        }

        // 检查停止信号（可能包含全局限制检查）
        if (await shouldStop()) {
          engine.eventBus.emitLog(
            'Stop signal received (may be global limit reached). Stopping extraction.',
            'info',
          );
          break;
        }

        // 重置错误计数（成功提取）
        consecutiveErrors = 0;

        if (addedCount === 0) {
          consecutiveNoNew++;
          engine.eventBus.emitLog(
            `No new tweets found (consecutive: ${consecutiveNoNew}/${maxNoNew}). Continuing to scroll...`,
            'debug',
          );

          // 智能判断：识别边界问题 vs session问题
          // 关键改进：在 Date Chunking 模式下，更激进地识别边界
          const totalCount = collectedTweets.length + progressBase;
          // 🔑 修复：通过 mode === 'search' 判断是否是 chunk 模式
          // 之前用 progressBase > 0 判断，但第一个 chunk 的 progressBase = 0！
          const isChunkMode = mode === 'search';
          const chunkTweetCount = collectedTweets.length; // 这个chunk收集的推文数

          // 日期分块模式下的边界判断（超级激进策略）:
          // 用户的痛点：明明是该日期范围内没推文了，还在切号尝试
          // 修正：只要收集到了少量推文（>5条）且连续2次没新推文，就认为是该Chunk结束
          // 或者：即使没收集到推文，连续4次没新推文也认为是结束（空Chunk）
          const isLikelyBoundary =
            isChunkMode &&
            (consecutiveNoNew >= 4 || // 连续4次无新，直接结束（针对空Chunk或少内容Chunk）
              (chunkTweetCount >= 5 && consecutiveNoNew >= 2)); // 只要有内容，对“无新推文”的容忍度极低

          // 如果识别为边界，立即停止，不要浪费时间切换session
          if (isLikelyBoundary) {
            engine.eventBus.emitLog(
              `✅ Chunk boundary reached (${chunkTweetCount} tweets, ${consecutiveNoNew} consecutive no-new). Moving to next chunk.`,
              'info',
            );
            break; // 跳出循环，停止这个chunk
          }

          // 如果不是边界，继续判断其他情况（仅非 chunk 模式）
          const isLowCount = !isChunkMode && totalCount < 200;
          const isHighCount = totalCount >= 500;

          // 调整切换session的阈值
          // 关键修正：在 Search/Chunk 模式下，禁用基于"连续无新推文"的 Session 轮换
          // 原因：Search 模式下"没推文"通常就是"没结果"，换号也一样。轮换只会浪费时间。
          // 只有遇到显式 Error (catch块) 时才轮换。
          let sessionSwitchThreshold: number;
          if (isChunkMode) {
             sessionSwitchThreshold = 999; // 实际上禁用
          } else if (isLowCount) {
            sessionSwitchThreshold = 3; // timeline模式：尽快切换
          } else if (isHighCount) {
            sessionSwitchThreshold = Math.min(maxNoNew, 8); // timeline模式：深度限制
          } else {
            sessionSwitchThreshold = Math.min(maxNoNew, 6);
          }

          // Check if this is Home Timeline mode (username is null/undefined)
          // In Home Timeline mode, session rotation is meaningless because each account has different feed
          const isHomeTimeline = !username && !searchQuery;

          if (
            consecutiveNoNew >= sessionSwitchThreshold &&
            attemptedSessions.size < 4 &&
            !isLikelyBoundary
          ) {
            // Skip session rotation for Home Timeline mode
            if (isHomeTimeline) {
              engine.eventBus.emitLog(
                `Home Timeline mode detected. Session rotation skipped (each account has different feed). Reached platform limit of ~${collectedTweets.length} tweets.`,
                'warn',
              );
              break; // Stop scraping, we've hit the platform limit
            }

            if (isLowCount) {
              engine.eventBus.emitLog(
                `Low tweet count (${collectedTweets.length}) with ${consecutiveNoNew} consecutive no-new cycles. Likely session issue. Rotating session...`,
                'warn',
              );
            } else {
              engine.eventBus.emitLog(
                `High tweet count (${collectedTweets.length}) with ${consecutiveNoNew} consecutive no-new cycles. May have reached depth limit. Trying session rotation...`,
                'warn',
              );
            }
            const allActiveSessions = await engine.sessionManager.getAllActiveSessions();
            const untriedSessions = allActiveSessions.filter((s) => !attemptedSessions.has(s.id));

            if (untriedSessions.length > 0) {
              const nextSession = untriedSessions[0];
              engine.eventBus.emitLog(`Switching to session: ${nextSession.id}...`, 'info');

              try {
                // Use restartBrowserWithSession to ensure IP switch during scroll rotation
                await waitOrCancel(engine.restartBrowserWithSession(nextSession), shouldStop);
                attemptedSessions.add(nextSession.id);
                consecutiveNoNew = 0; // 重置计数器，给新session机会
                engine.performanceMonitor.recordSessionSwitch();

                // 切换 session 后，刷新页面以应用新 cookies
                engine.eventBus.emitLog(
                  `Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried). Refreshing and performing rapid deep scroll...`,
                  'info',
                );

                // waitForTweets 失败时快速重试一次，减少超时时间
                try {
                  // biome-ignore lint/style/noNonNullAssertion: page exists
                  await waitOrCancel(
                    engine.navigationService.waitForTweets(engine.getPageInstance()!, {
                    timeout: 10000, // Increase from 3s to 10s to prevent flakes
                    maxRetries: 1, // Allow 1 retry
                  }), shouldStop);
                } catch (_navErr) {
                  engine.eventBus.emitLog(
                    `waitForTweets after session switch failed, skipping retry for faster switching...`,
                    'warn',
                  );
                  // 不再重试，直接继续，加快切换速度
                }

                // Fast scroll to discover new tweets with new session
                const maxScrollAttempts = 10; // 从20减少到10，加快失败检测
                const scrollsPerExtraction = 2; // 从3减少到2，更频繁检查

                engine.eventBus.emitLog(
                  `Performing rapid deep scroll: ${maxScrollAttempts} scrolls, extracting every ${scrollsPerExtraction} scrolls to check for new tweets...`,
                  'debug',
                );

                let scrollCount = 0;
                let lastExtractionCount = collectedTweets.length;

                while (scrollCount < maxScrollAttempts) {
                  // 检查 stop 信号（在每次循环开始和关键操作前）
                  if (await shouldStop()) {
                    engine.eventBus.emitLog(
                      'Manual stop signal received during deep scroll. Stopping...',
                      'info',
                    );
                    break;
                  }

                  // 快速连续滚动 scrollsPerExtraction 次
                  for (
                    let i = 0;
                    i < scrollsPerExtraction && scrollCount < maxScrollAttempts;
                    i++
                  ) {
                    // 在每次滚动前也检查 stop 信号
                    if (await shouldStop()) {
                      break;
                    }
                    // 使用人性化滚动（antiDetection.humanScroll）
                    // biome-ignore lint/style/noNonNullAssertion: page exists
                    const page = engine.getPageInstance()!;
                    await engine.antiDetection.humanScroll(page, 800, 'down');
                    await engine.antiDetection.betweenActions('fast');
                    scrollCount++;

                    // 在等待后再次检查
                    if (await shouldStop()) {
                      break;
                    }
                  }

                  // 在提取前再次检查 stop 信号
                  if (await shouldStop()) {
                    engine.eventBus.emitLog(
                      'Manual stop signal received. Stopping extraction...',
                      'info',
                    );
                    break;
                  }

                  // 每滚动 scrollsPerExtraction 次后，提取一次推文
                  const tweetsOnPage = await waitOrCancel(dataExtractor.extractTweetsFromPage(
                    // biome-ignore lint/style/noNonNullAssertion: page exists
                    engine.getPageInstance()!,
                  ), shouldStop);
                  const cleaned = await cleanTweetsFast([], tweetsOnPage, { limit });
                  if (cleaned.usedWasm && !wasmCleanerLogged) {
                    engine.eventBus.emitLog(
                      'Using Rust/WASM tweet cleaner for normalization/dedup.',
                      'info',
                    );
                    wasmCleanerLogged = true;
                  }

                  const beforeCount = collectedTweets.length;
                  for (const tweet of cleaned.tweets) {
                    if (collectedTweets.length >= limit) break;
                    if (scrapedIds.has(tweet.id)) continue;
                    collectedTweets.push(tweet);
                    scrapedIds.add(tweet.id);
                  }
                  const foundNew = collectedTweets.length > beforeCount;

                  const currentCount = collectedTweets.length;

                  if (foundNew) {
                    // Emit progress update during deep scroll so UI reflects new totals (carry base/target)
                    engine.eventBus.emitProgress({
                      current: progressBase + currentCount,
                      target: totalTarget,
                      action: 'deep-scroll',
                    });

                    // 发现新推文，继续滚动
                    engine.eventBus.emitLog(
                      `Found new tweets during deep scroll! Extracted ${cleaned.tweets.length} cleaned tweets (raw ${tweetsOnPage.length}), added ${currentCount - lastExtractionCount} new. Total: ${currentCount} (scrolled ${scrollCount} times)`,
                      'info',
                    );
                    lastExtractionCount = currentCount;

                    // 如果已经超过目标深度，可以停止快速滚动
                    const _tweetCountOnPage = await engine
                      .getPageInstance()
                      ?.evaluate((selector) => {
                        return document.querySelectorAll(selector).length;
                      }, 'article[data-testid="tweet"]');

                    // Continue scrolling to find more tweets
                  } else {
                    // 没有新推文，检查是否到达边界
                    const tweetCountOnPage =
                      (await engine.getPageInstance()?.evaluate((selector) => {
                        return document.querySelectorAll(selector).length;
                      }, 'article[data-testid="tweet"]')) || 0;

                    // 每20次滚动报告一次
                    if (scrollCount % 20 === 0) {
                      engine.eventBus.emitLog(
                        `Deep scroll progress: ${scrollCount}/${maxScrollAttempts} scrolls, ${tweetCountOnPage} tweets on page, ${currentCount} collected`,
                        'debug',
                      );
                    }

                    // 如果页面上推文数量稳定在很低的值（<30条），说明可能无法加载更多
                    if (tweetCountOnPage < 30 && scrollCount >= 10) {
                      engine.eventBus.emitLog(
                        `Tweet count on page is low (${tweetCountOnPage}) after ${scrollCount} scrolls. This session cannot load deeper content. Platform limit likely reached.`,
                        'warn',
                      );
                      break;
                    }
                  }

                  // 如果已经收集到足够的推文，停止
                  if (collectedTweets.length >= limit) {
                    break;
                  }
                }

                // 检查刷新后是否找到了新推文
                const tweetsAfterRefresh = collectedTweets.length;
                const foundNewAfterRefresh = tweetsAfterRefresh > lastExtractionCount;

                engine.eventBus.emitLog(
                  `Completed rapid deep scroll: ${scrollCount} scrolls, collected ${tweetsAfterRefresh} tweets total (${foundNewAfterRefresh ? 'found new tweets' : 'no new tweets found'}).`,
                  'info',
                );

                if (!foundNewAfterRefresh) {
                  // 刷新后滚动多次仍然没有新推文，说明这个 session 也无法突破限制
                  sessionsFailedCount++;
                  engine.eventBus.emitLog(
                    `Session ${nextSession.id} also cannot load more tweets after refresh and deep scroll. Failed sessions: ${sessionsFailedCount}/${MAX_SESSIONS_FAILED}`,
                    'warn',
                  );

                  // 如果连续多个 session 都无法加载新推文，很可能是平台限制
                  if (sessionsFailedCount >= MAX_SESSIONS_FAILED) {
                    engine.eventBus.emitLog(
                      `⚠️  Platform depth limit reached! After trying ${sessionsFailedCount} sessions, none can load more tweets. Twitter/X appears to have a ~800 tweet limit per timeline access. Stopping to avoid wasting time.`,
                      'warn',
                    );
                    // 设置为达到最大无新推文次数，触发循环退出
                    consecutiveNoNew = maxNoNew;
                    break;
                  }

                  // 重置计数器，继续尝试下一个 session
                  consecutiveNoNew = 0;
                } else {
                  // 找到了新推文，重置失败计数和计数器
                  sessionsFailedCount = 0;
                  consecutiveNoNew = 0;
                }

                // 继续循环，尝试提取新内容
                continue;
                // biome-ignore lint/suspicious/noExplicitAny: error handling
              } catch (e: any) {
                if (e.message === 'Job cancelled by user') throw e;
                engine.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
                attemptedSessions.add(nextSession.id); // 标记为已尝试
              }
            }
          }

          // 如果连续没有新推文，增加等待时间，给 Twitter 更多时间加载内容
          // 连续无新推文越多，等待时间越长
          if (consecutiveNoNew >= 2) {
            // 降低等待时长，减少空耗
            const baseDelay = consecutiveNoNew >= 8 ? 2500 : consecutiveNoNew >= 5 ? 2000 : 1200;
            const extraDelay = baseDelay + Math.random() * 500;
            engine.eventBus.emitLog(
              `Adding extra delay (${Math.round(extraDelay)}ms) to allow more content to load (consecutive no-new: ${consecutiveNoNew})...`,
              'debug',
            );

            // 在长时间等待前检查 stop 信号
            if (await shouldStop()) {
              engine.eventBus.emitLog(
                'Manual stop signal received during delay. Stopping...',
                'info',
              );
              break;
            }

            await sleepOrCancel(extraDelay, shouldStop);

            // 等待后再次检查
            if (await shouldStop()) {
              engine.eventBus.emitLog(
                'Manual stop signal received after delay. Stopping...',
                'info',
              );
              break;
            }
          }
        } else {
          consecutiveNoNew = 0;
        }

        // 检查 stop 信号
        if (await shouldStop()) {
          engine.eventBus.emitLog('Manual stop signal received.');
          break;
        }

        // 滚动加载更多（即使连续没有新推文也继续尝试，直到达到最大次数）
        if (collectedTweets.length < limit && consecutiveNoNew < maxNoNew) {
          engine.performanceMonitor.startPhase('scroll');
          engine.performanceMonitor.recordScroll();

          // 如果连续无新推文，进行更激进的滚动（多次滚动，更长的等待时间）
          // 关键：不要过早放弃，继续滚动更长时间
          let scrollCount = 1;
          let scrollDelay = constants.getScrollDelay();

          if (consecutiveNoNew >= 5) {
            // 连续无新达到 5 直接判定到顶，跳出循环
            engine.eventBus.emitLog(
              `Reached ${consecutiveNoNew} consecutive no-new cycles. Treating as depth boundary.`,
              'warn',
            );
            consecutiveNoNew = maxNoNew;
            break;
          } else if (consecutiveNoNew >= 3) {
            // 连续3-4次：小幅多滚，但不放大等待
            scrollCount = 2;
            scrollDelay = constants.getScrollDelay() * 1.2;
            engine.eventBus.emitLog(
              `Consecutive no-new-tweets: ${consecutiveNoNew}. Light aggressive scroll (${scrollCount} scrolls, ${Math.round(scrollDelay)}ms delay)...`,
              'debug',
            );
          }

          for (let i = 0; i < scrollCount; i++) {
            // 在每次滚动前检查 stop 信号
            if (await shouldStop()) {
              engine.eventBus.emitLog(
                'Manual stop signal received during scroll. Stopping...',
                'info',
              );
              break;
            }

            await dataExtractor.scrollToBottomSmart(
              // biome-ignore lint/style/noNonNullAssertion: page exists
              engine.getPageInstance()!,
              constants.WAIT_FOR_NEW_TWEETS_TIMEOUT,
              shouldStop
            );

            // 每次滚动后等待，给内容加载时间
            await sleepOrCancel(scrollDelay, shouldStop);

            // 在等待后也检查 stop 信号
            if (await shouldStop()) {
              engine.eventBus.emitLog('Manual stop signal received. Stopping scroll...', 'info');
              break;
            }

            if (i < scrollCount - 1) {
              engine.eventBus.emitLog(
                `Additional scroll ${i + 2}/${scrollCount} to load more content...`,
                'debug',
              );
            }
          }

          engine.performanceMonitor.endPhase();
        }
        // biome-ignore lint/suspicious/noExplicitAny: error handling
      } catch (error: any) {
        if (error.message === 'Job cancelled by user') throw error;
        engine.performanceMonitor.endPhase();
        consecutiveErrors++;
        engine.eventBus.emitLog(
          `Error during extraction: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );

        // 处理错误：如果是页面错误或连续错误，尝试切换 session
        if (
          error.message.includes('rate limit') ||
          error.message.includes('error') ||
          consecutiveErrors >= 3
        ) {
          engine.performanceMonitor.recordRateLimit();
          engine.eventBus.emitLog(`Page error detected. Attempting session rotation...`, 'warn');

          const allActiveSessions = await engine.sessionManager.getAllActiveSessions();
          const untriedSessions = allActiveSessions.filter((s) => !attemptedSessions.has(s.id));

          if (untriedSessions.length > 0) {
            const nextSession = untriedSessions[0];
            try {
              await engine.applySession(nextSession, {
                refreshFingerprint: false,
                clearExistingCookies: true,
              });
              attemptedSessions.add(nextSession.id);
              consecutiveErrors = 0;
              consecutiveNoNew = 0;
              engine.performanceMonitor.recordSessionSwitch();

              // 重新导航到目标URL
              engine.performanceMonitor.startPhase('navigation');
              // biome-ignore lint/style/noNonNullAssertion: page exists
              await waitOrCancel(engine.navigationService.navigateToUrl(engine.getPageInstance()!, targetUrl), shouldStop);
              // biome-ignore lint/style/noNonNullAssertion: page exists
              await waitOrCancel(engine.navigationService.waitForTweets(engine.getPageInstance()!, {
                timeout: 8000, // 减少超时时间，加快切换
                maxRetries: 0, // 不重试，快速切换
              }), shouldStop);
              engine.performanceMonitor.endPhase();

              engine.eventBus.emitLog(
                `Switched to session: ${nextSession.id} (${attemptedSessions.size} session(s) tried). Retrying...`,
                'info',
              );
              // biome-ignore lint/suspicious/noExplicitAny: error handling
            } catch (e: any) {
              if (e.message === 'Job cancelled by user') throw e;
              engine.eventBus.emitLog(`Session rotation failed: ${e.message}`, 'error');
              attemptedSessions.add(nextSession.id);
            }
          } else {
            engine.eventBus.emitLog(`All sessions attempted. Stopping.`, 'error');
            break;
          }
        } else {
          // 临时错误，等待后重试
          const waitTime = 2000 + Math.random() * 1000;
          await sleepOrCancel(waitTime, shouldStop);
        }
      }
    }

    // Save Results
    engine.performanceMonitor.startPhase('save-results');
    if (collectedTweets.length > 0) {
      if (saveMarkdown) await markdownUtils.saveTweetsAsMarkdown(collectedTweets, runContext);
      if (exportCsv) await exportUtils.exportToCsv(collectedTweets, runContext);
      if (exportJson) await exportUtils.exportToJson(collectedTweets, runContext);
      const page = engine.getPageInstance();
      if (saveScreenshots && page) {
        await screenshotUtils.takeTimelineScreenshot(page, { runContext, filename: 'final.png' });
      }
    }
    engine.performanceMonitor.endPhase();

    const activeSession = engine.getCurrentSession();
    if (activeSession) {
      engine.sessionManager.markGood(activeSession.id);
    }

    engine.performanceMonitor.stop();
    engine.emitPerformanceUpdate(true);
    engine.eventBus.emitLog(engine.performanceMonitor.getReport());

    return {
      success: true,
      tweets: collectedTweets,
      runContext,
      profile: profileInfo,
      performance: engine.performanceMonitor.getStats(),
    };
    // biome-ignore lint/suspicious/noExplicitAny: error handling
  } catch (error: any) {
    if (error.message === 'Job cancelled by user' || await shouldStop()) {
      // If we are stopping, any protocol/detached error is likely a side effect
      if (
        error.message.includes('detached Frame') ||
        error.message.includes('Target closed') ||
        error.message.includes('Session closed') ||
        error.message.includes('Protocol error')
      ) {
         throw new Error('Job cancelled by user');
      }
      throw error;
    }
    
    engine.performanceMonitor.stop();
    engine.eventBus.emitError(new Error(`DOM scraping failed: ${error.message}`));

    // 尝试保存错误快照
    const page = engine.getPageInstance();
    if (page) {
      await engine.errorSnapshotter.capture(page, error, 'timeline-dom');
    }

    return { success: false, tweets: collectedTweets, error: error.message };
  }
}
