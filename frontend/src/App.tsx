import { useState, useEffect, useRef, useCallback } from "react";
import { ErrorNotification } from "./components/ErrorNotification";
import { SessionManager } from "./components/SessionManager";
import { HeaderBar } from "./components/HeaderBar";
import { TaskForm } from "./components/TaskForm";
import { DashboardPanel } from "./components/DashboardPanel";
import { submitJob, cancelJob } from "./utils/queueClient";
import type { TabType } from "./types/ui";

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
  
  
  const [apiKey, setApiKey] = useState<string>(""); // applied key
  const [apiKeyInput, setApiKeyInput] = useState<string>(""); // input buffer
  const [apiBase, setApiBase] = useState<string>(window.__APP_CONFIG__?.apiBase || "");
  
  // Queue Mode is now the ONLY mode.
  // const [useQueueAPI, setUseQueueAPI] = useState(true);

  // Options
  const [scrapeLikes, setScrapeLikes] = useState(false);

  // Scrape Mode: 'graphql' (API) or 'puppeteer' (DOM)
  const [scrapeMode, setScrapeMode] = useState<
    "graphql" | "puppeteer" | "mixed"
  >("puppeteer");
  const [latestJobId, setLatestJobId] = useState<string | null>(null);

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
  const canSubmit = trimmedInput.length > 0;


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
    // Legacy progress endpoint removed; no-op listener
    const eventSource = new EventSource(withBase("/api/job/dummy/stream"));

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
    // Always use Queue API
    try {
      const jobInfo = await submitJob({
        type: activeTab === "profile" || activeTab === "thread" || activeTab === "search" ? activeTab : "reddit",
        input,
        limit,
        mode: activeTab === "search" ? "puppeteer" : scrapeMode,
        likes: scrapeLikes,
        enableRotation: autoRotateSessions,
        enableProxy,
        dateRange: startDate && endDate ? { start: startDate, end: endDate } : undefined,
        strategy: activeTab === "reddit" ? redditStrategy : undefined,
      });

      setLatestJobId(jobInfo.jobId);
      // Add job to Dashboard Panel
      const addJobFn = (window as any).__addJobToPanel;
      if (addJobFn) {
        addJobFn(jobInfo.jobId, activeTab === "reddit" ? "reddit" : "twitter");
      }
      
      // Optional: Clear input after successful submission?
      // setInput(""); 
      
    } catch (error) {
      const appError = classifyError(error);
      setCurrentError(appError);
    }
  };

  const handleStop = async () => {
    if (!latestJobId) {
      return;
    }

    try {
      await cancelJob(latestJobId);
      setLogs((prev) => [...prev, `🛑 Abort signal sent for job ${latestJobId}`]);
    } catch (err: any) {
      setLogs((prev) => [...prev, `❌ Failed to abort job ${latestJobId}: ${err?.message || err}`]);
    } finally {
    }
  };

  return (
    <div className="antialiased selection:bg-stone selection:text-washi min-h-screen relative">
      {/* Error Notification */}
      {currentError && (
        <div className="fixed top-6 right-6 left-6 md:left-auto md:w-96 z-50 animate-fade-in-organic">
          <ErrorNotification
            error={currentError}
            onDismiss={() => setCurrentError(null)}
            onRetry={currentError.canRetry ? handleScrape : undefined}
          />
        </div>
      )}

      <div>
        {/* Noise Texture Overlay */}
        <div className="noise-overlay"></div>

        <HeaderBar
          apiKey={apiKey}
          apiKeyInput={apiKeyInput}
          onApiKeyInputChange={setApiKeyInput}
          onApply={applyApiKey}
        />

        <main className="space-y-24 pb-32">
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

          {/* Active Jobs Panel - Queue Mode */}
          <div className="max-w-6xl mx-auto px-6">
            <DashboardPanel
              onJobComplete={(jobId, downloadUrl) => {
                console.log(`Job ${jobId} completed`, downloadUrl);
                setLatestJobId((prev) => (prev === jobId ? null : prev));
                        }}
              appendApiKey={appendApiKey}
            />
          </div>

          {/* Session Management - Only for Twitter, not Reddit */}
          {activeTab !== "reddit" && (
            <div className="max-w-4xl mx-auto px-6">
               <div className="h-px w-full bg-stone/10 mb-16"></div>
               <SessionManager />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
