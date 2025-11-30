import { useState, useEffect, useRef, useCallback } from "react";
import { ErrorNotification } from "./components/ErrorNotification";
import { SessionManager } from "./components/SessionManager";
import { HeaderBar } from "./components/HeaderBar";
import { TaskForm } from "./components/TaskForm";
import { ResultsPanel } from "./components/ResultsPanel";
import type { PerformanceStats, Progress, TabType } from "./types/ui";

// Error types
export enum ErrorType {
  NETWORK = "network",
  AUTH = "auth",
  RATE_LIMIT = "rate_limit",
  CONFIG = "config",
  VALIDATION = "validation",
  UNKNOWN = "unknown",
}

export interface AppError {
  type: ErrorType;
  message: string;
  details?: string;
  timestamp: Date;
  suggestion?: string;
  canRetry: boolean;
}

declare global {
  interface Window {
    __APP_CONFIG__?: {
      apiBase?: string;
    };
  }
}

function classifyError(error: any): AppError {
  const errorMessage = error?.message || String(error);
  const errorString = errorMessage.toLowerCase();

  if (
    errorString.includes("fetch") ||
    errorString.includes("network") ||
    errorString.includes("connection")
  ) {
    return {
      type: ErrorType.NETWORK,
      message: "网络连接失败",
      details: errorMessage,
      suggestion: "请检查网络连接后重试",
      canRetry: true,
      timestamp: new Date(),
    };
  }

  if (
    errorString.includes("cookie") ||
    errorString.includes("auth") ||
    errorString.includes("401") ||
    errorString.includes("403")
  ) {
    return {
      type: ErrorType.AUTH,
      message: "Session 已过期或无效",
      details: errorMessage,
      suggestion: "请更新 cookies 文件到 /cookies 目录",
      canRetry: false,
      timestamp: new Date(),
    };
  }

  if (errorString.includes("rate limit") || errorString.includes("429")) {
    return {
      type: ErrorType.RATE_LIMIT,
      message: "达到 Twitter API 速率限制",
      details: errorMessage,
      suggestion: "请等待 15-30 分钟后重试",
      canRetry: true,
      timestamp: new Date(),
    };
  }

  return {
    type: ErrorType.UNKNOWN,
    message: "发生未知错误",
    details: errorMessage,
    suggestion: "请刷新页面重试",
    canRetry: true,
    timestamp: new Date(),
  };
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const [input, setInput] = useState("");
  const [limit, setLimit] = useState(50);
  const [isScraping, setIsScraping] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress>({ current: 0, target: 0 });
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [performanceStats, setPerformanceStats] =
    useState<PerformanceStats | null>(null);
  const [apiKey, setApiKey] = useState<string>(""); // applied key
  const [apiKeyInput, setApiKeyInput] = useState<string>(""); // input buffer
  const [apiBase, setApiBase] = useState<string>(window.__APP_CONFIG__?.apiBase || "");

  // Options
  const [scrapeLikes, setScrapeLikes] = useState(false);

  // Scrape Mode: 'graphql' (API) or 'puppeteer' (DOM)
  const [scrapeMode, setScrapeMode] = useState<
    "graphql" | "puppeteer" | "mixed"
  >("puppeteer");

  // Monitor Options
  const [lookbackHours, setLookbackHours] = useState(24);
  const [keywords, setKeywords] = useState("");
  
  // Reddit Options
  const [redditStrategy, setRedditStrategy] = useState("auto");

  // Advanced Options
  const [autoRotateSessions, setAutoRotateSessions] = useState(true);
  const [enableDeepSearch, setEnableDeepSearch] = useState(false);
  const [parallelChunks, setParallelChunks] = useState(1); // 并行处理chunks数量（1=串行，2-3=并行）
  const [enableProxy, setEnableProxy] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Error Handling
  const [currentError, setCurrentError] = useState<AppError | null>(null);

  const trimmedInput = input.trim();
  const canSubmit = !isScraping && trimmedInput.length > 0;

  const logEndRef = useRef<HTMLDivElement>(null);

  const withBase = useCallback(
    (path: string): string => {
      if (!apiBase) return path;
      if (/^https?:\/\//i.test(path)) return path;
      const normalizedBase = apiBase.endsWith("/")
        ? apiBase.slice(0, -1)
        : apiBase;
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return `${normalizedBase}${normalizedPath}`;
    },
    [apiBase]
  );

  // Load saved API key
  useEffect(() => {
    const storedKey = localStorage.getItem("apiKey");
    if (storedKey) {
      setApiKey(storedKey);
      setApiKeyInput(storedKey);
    }
    if (window.__APP_CONFIG__?.apiBase) {
      setApiBase(window.__APP_CONFIG__?.apiBase);
    }
  }, []);

  useEffect(() => {
    if (apiBase) return;
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/config");
        if (!response.ok) return;
        const data = await response.json();
        if (data?.apiBase) {
          setApiBase(data.apiBase);
          window.__APP_CONFIG__ = {
            ...window.__APP_CONFIG__,
            apiBase: data.apiBase,
          };
        }
        if (typeof data?.twitter?.defaultLimit === "number") {
          setLimit(data.twitter.defaultLimit);
        }
        if (data?.twitter?.defaultMode) {
          setScrapeMode(data.twitter.defaultMode);
        }
        if (data?.reddit?.defaultStrategy) {
          setRedditStrategy(data.reddit.defaultStrategy);
        }
      } catch (error) {
        console.warn("Failed to fetch server config", error);
      }
    };
    loadConfig();
  }, [apiBase]);

  // Persist API key
  useEffect(() => {
    if (apiKey) {
      localStorage.setItem("apiKey", apiKey);
    } else {
      localStorage.removeItem("apiKey");
    }
  }, [apiKey]);

  useEffect(() => {
    const url = apiKey
      ? `/api/progress?api_key=${encodeURIComponent(apiKey)}`
      : "/api/progress";

    const eventSource = new EventSource(withBase(url));

    const handleLog = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] ${data.level?.toUpperCase?.() || "INFO"
        }: ${data.message}`,
      ]);
    };

    const handleProgress = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      setProgress({ current: data.current, target: data.target });
    };

    const handlePerformance = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.stats) {
        setPerformanceStats(data.stats);
      }
    };

    // Explicitly listen to named SSE events; keep onmessage as a fallback for older payloads.
    eventSource.addEventListener("log", handleLog);
    eventSource.addEventListener("progress", handleProgress);
    eventSource.addEventListener("performance", handlePerformance);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "log") return handleLog(event);
      if (data.type === "progress") return handleProgress(event);
      if (data.type === "performance") return handlePerformance(event);
    };

    return () => {
      eventSource.removeEventListener("log", handleLog);
      eventSource.removeEventListener("progress", handleProgress);
      eventSource.removeEventListener("performance", handlePerformance);
      eventSource.close();
    };
  }, [apiKey, withBase]);

  // Auto-scroll removed as per user request
  // useEffect(() => {
  //     logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [logs]);

  const appendApiKey = (url: string | null): string | null => {
    if (!url) return null;
    let finalUrl = url;
    if (apiKey) {
      const hasQuery = url.includes("?");
      const separator = hasQuery ? "&" : "?";
      finalUrl = `${url}${separator}api_key=${encodeURIComponent(apiKey)}`;
    }
    return withBase(finalUrl);
  };

  const buildHeaders = (hasBody: boolean = false) => {
    const headers: Record<string, string> = {};
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    return headers;
  };

  // On mount, if server 还有在跑的任务，让 UI 显示停止按钮
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(withBase("/api/status"), { headers: buildHeaders() });
        const data = await res.json();
        if (data.isActive) {
          setIsScraping(true);
        }
      } catch (e) {
        console.warn("Failed to fetch status on mount", e);
      }
    };
    checkStatus();
  }, [apiKey, withBase]);

  const applyApiKey = () => {
    setApiKey(apiKeyInput.trim());
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setInput(""); // Clear input on tab switch
  };

  const handleScrapeModeChange = (mode: "graphql" | "puppeteer" | "mixed") => {
    setScrapeMode(mode);
  };

  const handleScrape = async () => {
    if (isScraping) return;
    setIsScraping(true);
    setLogs([]);
    setDownloadUrl(null);
    setPerformanceStats(null);
    setProgress({ current: 0, target: limit });
    setCurrentError(null);

    try {
      // Search 只能使用 Puppeteer（GraphQL 搜索分页 404）
      const resolvedMode = activeTab === "search" ? "puppeteer" : scrapeMode;
      let endpoint = "/api/scrape";
      let body: any = {
        type: activeTab,
        input,
        limit,
        likes: scrapeLikes,
        mode: resolvedMode,
        dateRange:
          startDate && endDate ? { start: startDate, end: endDate } : undefined,
        enableRotation: autoRotateSessions,
        enableDeepSearch: activeTab === "search" ? enableDeepSearch : undefined,
        parallelChunks: activeTab === "search" && enableDeepSearch ? parallelChunks : undefined,
        enableProxy: enableProxy,
      };

      if (activeTab === "monitor") {
        endpoint = "/api/monitor";
        body = {
          users: input
            .split(",")
            .map((u) => u.trim())
            .filter(Boolean),
          lookbackHours,
          keywords,
          enableRotation: autoRotateSessions,
          enableProxy: enableProxy,
        };
      }

      if (activeTab === "reddit") {
        // Reddit Scrape Payload
        // We reuse 'input' for subreddit name
        // We reuse 'limit' for max_posts
        // We add 'strategy'
        body = {
          type: "reddit",
          input: input, 
          limit,
          strategy: redditStrategy,
          save_json: true // Default to true for now
        };
      }

      const response = await fetch(withBase(endpoint), {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (result.success) {
        setDownloadUrl(result.downloadUrl);
        if (result.performance) {
          setPerformanceStats(result.performance);
        }
        setLogs((prev) => [
          ...prev,
          `✅ Operation completed! ${result.downloadUrl ? "Download available." : ""
          }`,
        ]);
      } else {
        const error = classifyError(new Error(result.error || "Server error"));
        setCurrentError(error);
        setLogs((prev) => [...prev, `❌ Error: ${result.error}`]);
      }
    } catch (error) {
      const appError = classifyError(error);
      setCurrentError(appError);
      setLogs((prev) => [...prev, `❌ ${appError.message}`]);
    } finally {
      setIsScraping(false);
    }
  };

  const handleStop = async () => {
    await fetch(withBase("/api/stop"), { method: "POST", headers: buildHeaders() });
    setLogs((prev) => [...prev, `🛑 Stop signal sent...`]);

    // Poll for result after stopping
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(withBase("/api/result"), {
          headers: buildHeaders(),
        });
        const data = await response.json();

        if (!data.isActive && data.downloadUrl) {
          // Scraping has stopped and we have a download URL
          setDownloadUrl(data.downloadUrl);
          setLogs((prev) => [
            ...prev,
            `✅ Scraping stopped! Download available.`,
          ]);
          setIsScraping(false);
          clearInterval(pollInterval);
        } else if (!data.isActive) {
          // Scraping stopped but no result
          setLogs((prev) => [
            ...prev,
            `⚠️ Scraping stopped without generating output.`,
          ]);
          setIsScraping(false);
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error("Error polling result:", error);
      }
    }, 500); // Poll every 500ms

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(pollInterval);
      setIsScraping(false);
    }, 10000);
  };

  return (
    <div className="antialiased selection:bg-stone selection:text-washi min-h-screen">
      {/* Error Notification */}
      {currentError && (
        <div className="fixed top-4 right-4 left-4 md:left-auto md:w-96 z-50">
          <ErrorNotification
            error={currentError}
            onDismiss={() => setCurrentError(null)}
            onRetry={currentError.canRetry ? handleScrape : undefined}
          />
        </div>
      )}

      <div>
        <div className="antialiased selection:bg-stone selection:text-washi min-h-screen">
          {/* Noise Texture Overlay */}
          <div className="noise-overlay"></div>

          <HeaderBar
            apiKey={apiKey}
            apiKeyInput={apiKeyInput}
            onApiKeyInputChange={setApiKeyInput}
            onApply={applyApiKey}
          />

          <TaskForm
            activeTab={activeTab}
            input={input}
            limit={limit}
            scrapeLikes={scrapeLikes}
            scrapeMode={scrapeMode}
            autoRotateSessions={autoRotateSessions}
            enableDeepSearch={enableDeepSearch}
            parallelChunks={parallelChunks}
            enableProxy={enableProxy}
            startDate={startDate}
            endDate={endDate}
            lookbackHours={lookbackHours}
            keywords={keywords}
            redditStrategy={redditStrategy}
            isScraping={isScraping}
            canSubmit={canSubmit}
            onTabChange={handleTabChange}
            onInputChange={setInput}
            onLimitChange={setLimit}
            onScrapeModeChange={handleScrapeModeChange}
            onToggleLikes={setScrapeLikes}
            onToggleAutoRotate={setAutoRotateSessions}
            onToggleDeepSearch={setEnableDeepSearch}
            onParallelChunksChange={setParallelChunks}
            onToggleProxy={setEnableProxy}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onLookbackHoursChange={setLookbackHours}
            onKeywordsChange={setKeywords}
            onRedditStrategyChange={setRedditStrategy}
            onSubmit={handleScrape}
            onStop={handleStop}
          />

          <ResultsPanel
            isScraping={isScraping}
            progress={progress}
            logs={logs}
            downloadUrl={downloadUrl}
            appendApiKey={appendApiKey}
            performanceStats={performanceStats}
            activeTab={activeTab}
            input={input}
            logEndRef={logEndRef}
          />
        </div>
        {/* Performance Dashboard */}
        {/* Session Management - Only for Twitter, not Reddit */}
        {activeTab !== "reddit" && (
          <div className="mt-16 border-t border-stone/20 pt-16">
            <SessionManager />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
