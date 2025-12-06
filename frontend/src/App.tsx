import { useState, useEffect, useCallback } from 'react';
import { ErrorNotification } from './components/ErrorNotification';
import { SessionManager } from './features/sessions/SessionManager';
import { HeaderBar } from './components/HeaderBar';
import { TaskForm } from './features/crawler/components/TaskForm';
import { DashboardPanel } from './features/dashboard/components/DashboardPanel';
import { useCrawlerStore } from './features/crawler/store/useCrawlerStore';
import { submitJob, cancelJob } from './utils/queueClient';

// Error types
export enum ErrorType {
  NETWORK = 'network',
  AUTH = 'auth',
  RATE_LIMIT = 'rate_limit',
  CONFIG = 'config',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown',
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
    errorString.includes('fetch') ||
    errorString.includes('network') ||
    errorString.includes('connection')
  ) {
    return {
      type: ErrorType.NETWORK,
      message: '网络连接失败',
      details: errorMessage,
      suggestion: '请检查网络连接后重试',
      canRetry: true,
      timestamp: new Date(),
    };
  }

  if (
    errorString.includes('cookie') ||
    errorString.includes('auth') ||
    errorString.includes('401') ||
    errorString.includes('403')
  ) {
    return {
      type: ErrorType.AUTH,
      message: 'Session 已过期或无效',
      details: errorMessage,
      suggestion: '请更新 cookies 文件到 /cookies 目录',
      canRetry: false,
      timestamp: new Date(),
    };
  }

  if (errorString.includes('rate limit') || errorString.includes('429')) {
    return {
      type: ErrorType.RATE_LIMIT,
      message: '达到 Twitter API 速率限制',
      details: errorMessage,
      suggestion: '请等待 15-30 分钟后重试',
      canRetry: true,
      timestamp: new Date(),
    };
  }

  return {
    type: ErrorType.UNKNOWN,
    message: '发生未知错误',
    details: errorMessage,
    suggestion: '请刷新页面重试',
    canRetry: true,
    timestamp: new Date(),
  };
}

function App() {
  // API Key state (not part of crawler store as it's app-level config)
  const [apiKey, setApiKey] = useState<string>('');
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [apiBase, setApiBase] = useState<string>(window.__APP_CONFIG__?.apiBase || '');

  // Error Handling
  const [currentError, setCurrentError] = useState<AppError | null>(null);

  // Get state and actions from store
  const {
    activeTab,
    input,
    limit,
    scrapeMode,
    scrapeLikes,
    autoRotateSessions,
    enableProxy,
    startDate,
    endDate,
    redditStrategy,
    antiDetectionLevel,
    latestJobId,
    setLatestJobId,
    setLimit,
    setScrapeMode,
    setRedditStrategy,
    setIsScraping,
  } = useCrawlerStore();

  const withBase = useCallback(
    (path: string): string => {
      if (!apiBase) return path;
      if (/^https?:\/\//i.test(path)) return path;
      const normalizedBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      return `${normalizedBase}${normalizedPath}`;
    },
    [apiBase],
  );

  // Load saved API key
  useEffect(() => {
    const storedKey = localStorage.getItem('apiKey');
    if (storedKey) {
      setApiKey(storedKey);
      setApiKeyInput(storedKey);
    }
    if (window.__APP_CONFIG__?.apiBase) {
      setApiBase(window.__APP_CONFIG__?.apiBase);
    }
  }, []);

  // Load server config
  useEffect(() => {
    if (apiBase) return;
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (!response.ok) return;
        const data = await response.json();
        if (data?.apiBase) {
          setApiBase(data.apiBase);
          window.__APP_CONFIG__ = {
            ...window.__APP_CONFIG__,
            apiBase: data.apiBase,
          };
        }
        if (typeof data?.twitter?.defaultLimit === 'number') {
          setLimit(data.twitter.defaultLimit);
        }
        if (data?.twitter?.defaultMode) {
          setScrapeMode(data.twitter.defaultMode);
        }
        if (data?.reddit?.defaultStrategy) {
          setRedditStrategy(data.reddit.defaultStrategy);
        }
      } catch (error) {
        console.warn('Failed to fetch server config', error);
      }
    };
    loadConfig();
  }, [apiBase, setLimit, setScrapeMode, setRedditStrategy]);

  // Persist API key
  useEffect(() => {
    if (apiKey) {
      localStorage.setItem('apiKey', apiKey);
    } else {
      localStorage.removeItem('apiKey');
    }
  }, [apiKey]);

  const appendApiKey = useCallback(
    (url: string | null): string | null => {
      if (!url) return null;
      let finalUrl = url;
      if (apiKey) {
        const hasQuery = url.includes('?');
        const separator = hasQuery ? '&' : '?';
        finalUrl = `${url}${separator}api_key=${encodeURIComponent(apiKey)}`;
      }
      return withBase(finalUrl);
    },
    [apiKey, withBase],
  );

  const handleJobComplete = useCallback((jobId: string, downloadUrl?: string) => {
    console.log(`Job ${jobId} completed`, downloadUrl);
    setLatestJobId(null);
  }, [setLatestJobId]);

  const applyApiKey = () => {
    setApiKey(apiKeyInput.trim());
  };

  const handleScrape = async () => {
    try {
      const jobInfo = await submitJob({
        type:
          activeTab === 'profile' || activeTab === 'thread' || activeTab === 'search'
            ? activeTab
            : 'reddit',
        input,
        limit,
        mode: activeTab === 'search' ? 'puppeteer' : scrapeMode,
        likes: scrapeLikes,
        enableRotation: autoRotateSessions,
        enableProxy,
        dateRange: startDate && endDate ? { start: startDate, end: endDate } : undefined,
        strategy: activeTab === 'reddit' ? redditStrategy : undefined,
        antiDetectionLevel,
      });

      setLatestJobId(jobInfo.jobId);
      
      // Add job to Dashboard Panel
      const addJobFn = (window as any).__addJobToPanel;
      if (addJobFn) {
        addJobFn(jobInfo.jobId, activeTab === 'reddit' ? 'reddit' : 'twitter');
      }
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
    } catch (err: any) {
      console.error('Failed to cancel job:', err);
    } finally {
      setIsScraping(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* Geometric Background Pattern */}
      <div className="fixed inset-0 pattern-dots opacity-30 pointer-events-none" />

      {/* Error Notification */}
      {currentError && (
        <div className="fixed top-20 right-6 left-6 md:left-auto md:w-96 z-50 animate-fade-up">
          <ErrorNotification
            error={currentError}
            onDismiss={() => setCurrentError(null)}
            onRetry={currentError.canRetry ? handleScrape : undefined}
          />
        </div>
      )}

      <HeaderBar
        apiKey={apiKey}
        apiKeyInput={apiKeyInput}
        onApiKeyInputChange={setApiKeyInput}
        onApply={applyApiKey}
      />

      <main className="relative">
        <TaskForm
          onSubmit={handleScrape}
          onStop={handleStop}
        />

        {/* Dashboard & Sessions */}
        <div className="max-w-6xl mx-auto px-6 pb-24 space-y-16">
          <DashboardPanel
            onJobComplete={handleJobComplete}
            appendApiKey={appendApiKey}
          />

          {/* Session Management - Twitter only */}
          {activeTab !== 'reddit' && (
            <>
              <div className="h-px w-full bg-border" />
              <SessionManager />
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 text-center text-sm text-muted-foreground">
        <p>XRCrawler • Twitter/X & Reddit Data Extraction</p>
      </footer>
    </div>
  );
}

export default App;
