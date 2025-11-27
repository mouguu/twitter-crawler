import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ErrorNotification } from './components/ErrorNotification';
import { SessionManager } from './components/SessionManager';
import { PerformanceDashboard } from './components/PerformanceDashboard';
import dayjs from 'dayjs';

// Error types
export enum ErrorType {
    NETWORK = 'network',
    AUTH = 'auth',
    RATE_LIMIT = 'rate_limit',
    CONFIG = 'config',
    VALIDATION = 'validation',
    UNKNOWN = 'unknown'
}

export interface AppError {
    type: ErrorType;
    message: string;
    details?: string;
    timestamp: Date;
    suggestion?: string;
    canRetry: boolean;
}

function classifyError(error: any): AppError {
    const errorMessage = error?.message || String(error);
    const errorString = errorMessage.toLowerCase();
    
    if (errorString.includes('fetch') || errorString.includes('network') || errorString.includes('connection')) {
        return {
            type: ErrorType.NETWORK,
            message: '网络连接失败',
            details: errorMessage,
            suggestion: '请检查网络连接后重试',
            canRetry: true,
            timestamp: new Date()
        };
    }
    
    if (errorString.includes('cookie') || errorString.includes('auth') || errorString.includes('401') || errorString.includes('403')) {
        return {
            type: ErrorType.AUTH,
            message: 'Session 已过期或无效',
            details: errorMessage,
            suggestion: '请更新 cookies 文件到 /cookies 目录',
            canRetry: false,
            timestamp: new Date()
        };
    }
    
    if (errorString.includes('rate limit') || errorString.includes('429')) {
        return {
            type: ErrorType.RATE_LIMIT,
            message: '达到 Twitter API 速率限制',
            details: errorMessage,
            suggestion: '请等待 15-30 分钟后重试',
            canRetry: true,
            timestamp: new Date()
        };
    }
    
    return {
        type: ErrorType.UNKNOWN,
        message: '发生未知错误',
        details: errorMessage,
        suggestion: '请刷新页面重试',
        canRetry: true,
        timestamp: new Date()
    };
}

function cn(...inputs: any[]) {
    return twMerge(clsx(inputs));
}

type TabType = 'profile' | 'thread' | 'search' | 'monitor';

interface Progress {
    current: number;
    target: number;
}

interface PerformanceStats {
    totalDuration: number;
    navigationTime: number;
    scrollTime: number;
    extractionTime: number;
    tweetsCollected: number;
    tweetsPerSecond: number;
    scrollCount: number;
    sessionSwitches: number;
    rateLimitHits: number;
    peakMemoryUsage: number;
    currentMemoryUsage: number;
    phases?: { name: string; duration: number; percentage: number }[];
    // API mode stats
    apiRequestTime?: number;
    apiRequestCount?: number;
    apiParseTime?: number;
    apiAverageLatency?: number;
    apiRetryCount?: number;
    rateLimitWaitTime?: number;
    mode?: 'graphql' | 'puppeteer' | 'mixed';
}

function App() {
    const [activeTab, setActiveTab] = useState<TabType>('profile');
    const [input, setInput] = useState('');
    const [limit, setLimit] = useState(50);
    const [isScraping, setIsScraping] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState<Progress>({ current: 0, target: 0 });
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [performanceStats, setPerformanceStats] = useState<PerformanceStats | null>(null);
    const [apiKey, setApiKey] = useState<string>(''); // applied key
    const [apiKeyInput, setApiKeyInput] = useState<string>(''); // input buffer

    // Options
    const [scrapeLikes, setScrapeLikes] = useState(false);
    
    // Scrape Mode: 'graphql' (API) or 'puppeteer' (DOM)
    const [scrapeMode, setScrapeMode] = useState<'graphql' | 'puppeteer'>('graphql');

    // Monitor Options
    const [lookbackHours, setLookbackHours] = useState(24);
    const [keywords, setKeywords] = useState('');

    // Advanced Options
    const [resume, setResume] = useState(false);
    const [autoRotateSessions, setAutoRotateSessions] = useState(true);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Error Handling
    const [currentError, setCurrentError] = useState<AppError | null>(null);

    const trimmedInput = input.trim();
    const canSubmit = !isScraping && trimmedInput.length > 0;



    const logEndRef = useRef<HTMLDivElement>(null);

    // Load saved API key
    useEffect(() => {
        const storedKey = localStorage.getItem('apiKey');
        if (storedKey) {
            setApiKey(storedKey);
            setApiKeyInput(storedKey);
        }
    }, []);

    // Persist API key
    useEffect(() => {
        if (apiKey) {
            localStorage.setItem('apiKey', apiKey);
        } else {
            localStorage.removeItem('apiKey');
        }
    }, [apiKey]);

    useEffect(() => {
        const url = apiKey
            ? `/api/progress?api_key=${encodeURIComponent(apiKey)}`
            : '/api/progress';

        const eventSource = new EventSource(url);

        const handleLog = (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${data.level?.toUpperCase?.() || 'INFO'}: ${data.message}`]);
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
        eventSource.addEventListener('log', handleLog);
        eventSource.addEventListener('progress', handleProgress);
        eventSource.addEventListener('performance', handlePerformance);
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'log') return handleLog(event);
            if (data.type === 'progress') return handleProgress(event);
            if (data.type === 'performance') return handlePerformance(event);
        };

        return () => {
            eventSource.removeEventListener('log', handleLog);
            eventSource.removeEventListener('progress', handleProgress);
            eventSource.removeEventListener('performance', handlePerformance);
            eventSource.close();
        };
    }, [apiKey]);

    // Auto-scroll removed as per user request
    // useEffect(() => {
    //     logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    // }, [logs]);

    const appendApiKey = (url: string | null): string | null => {
        if (!url) return null;
        if (!apiKey) return url;
        const hasQuery = url.includes('?');
        const separator = hasQuery ? '&' : '?';
        return `${url}${separator}api_key=${encodeURIComponent(apiKey)}`;
    };

    const buildHeaders = (hasBody: boolean = false) => {
        const headers: Record<string, string> = {};
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }
        if (apiKey) {
            headers['x-api-key'] = apiKey;
        }
        return headers;
    };

    const applyApiKey = () => {
        setApiKey(apiKeyInput.trim());
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
            const resolvedMode = activeTab === 'search' ? 'puppeteer' : scrapeMode;
            let endpoint = '/api/scrape';
            let body: any = {
                type: activeTab,
                input,
                limit,
                likes: scrapeLikes,
                mode: resolvedMode,
                resume,
                dateRange: startDate && endDate ? { start: startDate, end: endDate } : undefined,
                enableRotation: autoRotateSessions
            };

            if (activeTab === 'monitor') {
                endpoint = '/api/monitor';
                body = {
                    users: input.split(',').map(u => u.trim()).filter(Boolean),
                    lookbackHours,
                    keywords,
                    enableRotation: autoRotateSessions
                };
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: buildHeaders(true),
                body: JSON.stringify(body)
            });

            const result = await response.json();
            if (result.success) {
                setDownloadUrl(result.downloadUrl);
                if (result.performance) {
                    setPerformanceStats(result.performance);
                }
                setLogs(prev => [...prev, `✅ Operation completed! ${result.downloadUrl ? 'Download available.' : ''}`]);
            } else {
                const error = classifyError(new Error(result.error || 'Server error'));
                setCurrentError(error);
                setLogs(prev => [...prev, `❌ Error: ${result.error}`]);
            }
        } catch (error) {
            const appError = classifyError(error);
            setCurrentError(appError);
            setLogs(prev => [...prev, `❌ ${appError.message}`]);
        } finally {
            setIsScraping(false);
        }
    };

    const handleStop = async () => {
        await fetch('/api/stop', { method: 'POST', headers: buildHeaders() });
        setLogs(prev => [...prev, `🛑 Stop signal sent...`]);

        // Poll for result after stopping
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/result', { headers: buildHeaders() });
                const data = await response.json();

                if (!data.isActive && data.downloadUrl) {
                    // Scraping has stopped and we have a download URL
                    setDownloadUrl(data.downloadUrl);
                    setLogs(prev => [...prev, `✅ Scraping stopped! Download available.`]);
                    setIsScraping(false);
                    clearInterval(pollInterval);
                } else if (!data.isActive) {
                    // Scraping stopped but no result
                    setLogs(prev => [...prev, `⚠️ Scraping stopped without generating output.`]);
                    setIsScraping(false);
                    clearInterval(pollInterval);
                }
            } catch (error) {
                console.error('Error polling result:', error);
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

            {/* Header */}
            <header className="py-8 px-6 md:px-20 border-b border-stone/20">
                <div className="max-w-5xl mx-auto flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl md:text-4xl mb-2 font-display text-charcoal">Mono no Aware</h1>
                        <p className="text-stone text-sm uppercase tracking-widest font-serif">Twitter Archiver</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative flex items-center gap-2">
                            <div className="relative">
                                <input
                                    type="password"
                                    value={apiKeyInput}
                                    onChange={(e) => setApiKeyInput(e.target.value)}
                                    placeholder="API Key"
                                    className="bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-sm font-mono text-charcoal placeholder-stone/50 w-44"
                                />
                                <label className="absolute left-0 -top-5 text-[10px] uppercase tracking-[0.2em] text-stone/50 font-sans">API Key</label>
                            </div>
                            <button
                                onClick={applyApiKey}
                                className="px-3 py-2 border border-charcoal rounded-full text-[10px] uppercase tracking-[0.15em] hover:bg-charcoal hover:text-washi transition-colors"
                            >
                                Apply
                            </button>
                            {apiKey && (
                                <span className="text-[10px] uppercase tracking-[0.2em] text-moss font-sans">Applied</span>
                            )}
                        </div>
                        <a href="#results" className="text-sm uppercase tracking-widest hover:text-rust transition-colors duration-300 font-serif text-charcoal">Logs</a>
                    </div>
                </div>
            </header>

            {/* Scraper Interface */}
            <section id="scrape" className="py-16 px-6 md:px-20 max-w-5xl mx-auto">
                <div className="mb-12">
                    <h2 className="text-3xl md:text-4xl mb-4 font-display text-charcoal">Extraction Parameters</h2>
                    <div className="h-px w-24 bg-rust mb-6"></div>
                    <p className="text-lg text-stone max-w-2xl font-serif">
                        Select your source and configure the extraction settings.
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex space-x-12 mb-12">
                    {(['profile', 'thread', 'search', 'monitor'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={cn(
                                "font-serif text-2xl italic pb-2 transition-all duration-300 capitalize",
                                activeTab === tab ? "tab-active" : "tab-inactive hover:text-rust"
                            )}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Forms Container */}
                <div>
                    {/* Dynamic Form Content based on Active Tab */}
                    <div className="block space-y-12">
                        <div className="relative group">
                            <label className="absolute left-0 -top-6 text-sm text-rust font-serif pointer-events-none">
                                {activeTab === 'profile' ? 'Username or Profile URL' :
                                    activeTab === 'thread' ? 'Tweet URL' :
                                        activeTab === 'monitor' ? 'Usernames (comma separated)' : 'Search Query / Hashtag'}
                            </label>
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                className="w-full bg-transparent border-b border-stone py-4 focus:outline-none focus:border-rust transition-colors text-2xl font-serif text-charcoal placeholder-stone/30"
                                placeholder={
                                    activeTab === 'profile' ? 'e.g. elonmusk' :
                                        activeTab === 'thread' ? 'https://x.com/...' :
                                            activeTab === 'monitor' ? 'elonmusk, realdonaldtrump, nasa' : 'e.g. #AI'
                                }
                            />
                        </div>

                        {activeTab !== 'monitor' ? (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-end">
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={limit}
                                            onChange={(e) => setLimit(parseInt(e.target.value))}
                                            onWheel={(e) => e.currentTarget.blur()}
                                            min="10"
                                            max="1000"
                                            className="peer w-full bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-xl font-serif text-charcoal"
                                        />
                                        <label className="absolute left-0 -top-6 text-sm text-rust font-serif">
                                            {activeTab === 'thread' ? 'Max Replies' : 'Limit (Tweets)'}
                                        </label>
                                    </div>

                                    <div className="flex flex-col space-y-4">
                                        {/* Scrape Mode Toggle - 在 profile, search, thread 模式显示 */}
                                        {(activeTab === 'profile' || activeTab === 'search' || activeTab === 'thread') && (
                                            <div className="flex flex-col space-y-2">
                                                <span className="text-xs uppercase tracking-wider text-stone/60 font-sans">Extraction Mode</span>
                                                <div className="flex items-center space-x-2">
                                                    {activeTab !== 'search' && (
                                                        <button
                                                            onClick={() => setScrapeMode('graphql')}
                                                            className={cn(
                                                                "px-4 py-2 border rounded-full text-sm font-serif transition-all duration-300",
                                                                scrapeMode === 'graphql'
                                                                    ? "border-rust bg-rust/10 text-rust"
                                                                    : "border-stone/30 text-stone hover:border-rust hover:text-rust"
                                                            )}
                                                        >
                                                            ⚡ GraphQL API
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setScrapeMode('puppeteer')}
                                                        className={cn(
                                                            "px-4 py-2 border rounded-full text-sm font-serif transition-all duration-300",
                                                            scrapeMode === 'puppeteer'
                                                                ? "border-rust bg-rust/10 text-rust"
                                                                : "border-stone/30 text-stone hover:border-rust hover:text-rust"
                                                        )}
                                                    >
                                                        🌐 Puppeteer DOM
                                                        {activeTab === 'search' && (
                                                            <span className="ml-2 text-[10px] bg-rust/20 text-rust px-2 py-0.5 rounded-full">Required</span>
                                                        )}
                                                    </button>
                                                </div>
                                                <span className="text-[10px] text-stone/40 font-sans italic">
                                                    {activeTab === 'search' 
                                                        ? 'Search mode requires Puppeteer (GraphQL search has cursor pagination issues)'
                                                        : scrapeMode === 'graphql' 
                                                            ? 'Faster, uses Twitter\'s internal API' 
                                                            : 'Slower but more reliable, simulates browser'}
                                                </span>
                                            </div>
                                        )}
                                        
                                        {activeTab === 'profile' && (
                                            <label className="flex items-center space-x-4 cursor-pointer group select-none">
                                                <div className="w-6 h-6 border border-stone rounded-full flex items-center justify-center group-hover:border-rust transition-colors">
                                                    <div className={cn("w-3 h-3 bg-rust rounded-full transition-opacity checkbox-indicator", scrapeLikes ? "opacity-100" : "opacity-0")}></div>
                                                </div>
                                                <input type="checkbox" checked={scrapeLikes} onChange={(e) => setScrapeLikes(e.target.checked)} className="hidden" />
                                                <span className="font-serif text-xl text-stone group-hover:text-charcoal transition-colors">Scrape Likes</span>
                                            </label>
                                        )}

                                        {/* Auto-Rotate Sessions Toggle */}
                                        <div className="pt-4 border-t border-stone/10">
                                            <label className="flex items-center space-x-4 cursor-pointer group select-none">
                                                <div className="w-6 h-6 border border-stone rounded-full flex items-center justify-center group-hover:border-rust transition-colors">
                                                    <div className={cn("w-3 h-3 bg-rust rounded-full transition-opacity checkbox-indicator", autoRotateSessions ? "opacity-100" : "opacity-0")}></div>
                                                </div>
                                                <input type="checkbox" checked={autoRotateSessions} onChange={(e) => setAutoRotateSessions(e.target.checked)} className="hidden" />
                                                <div className="flex flex-col">
                                                    <span className="font-serif text-xl text-stone group-hover:text-charcoal transition-colors">Auto-Rotate Sessions</span>
                                                    <span className="text-xs text-stone/60 font-sans">Switch account on rate limit</span>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                {/* Advanced Options for Search Mode */}
                                {activeTab === 'search' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-end pt-4 border-t border-stone/10 mt-8">
                                        <div className="flex flex-col space-y-4">
                                            <label className="flex items-center space-x-4 cursor-pointer group select-none">
                                                <div className="w-6 h-6 border border-stone rounded-full flex items-center justify-center group-hover:border-rust transition-colors">
                                                    <div className={cn("w-3 h-3 bg-rust rounded-full transition-opacity checkbox-indicator", resume ? "opacity-100" : "opacity-0")}></div>
                                                </div>
                                                <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} className="hidden" />
                                                <span className="font-serif text-xl text-stone group-hover:text-charcoal transition-colors">Resume Previous Scrape</span>
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="relative">
                                                <input
                                                    type="date"
                                                    value={startDate}
                                                    onChange={(e) => setStartDate(e.target.value)}
                                                    className="peer w-full bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-lg font-serif text-charcoal"
                                                />
                                                <label className="absolute left-0 -top-6 text-sm text-rust font-serif">
                                                    Start Date
                                                </label>
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="date"
                                                    value={endDate}
                                                    onChange={(e) => setEndDate(e.target.value)}
                                                    className="peer w-full bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-lg font-serif text-charcoal"
                                                />
                                                <label className="absolute left-0 -top-6 text-sm text-rust font-serif">
                                                    End Date
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-end">
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={lookbackHours}
                                        onChange={(e) => setLookbackHours(parseInt(e.target.value))}
                                        onWheel={(e) => e.currentTarget.blur()}
                                        min="1"
                                        max="168"
                                        className="peer w-full bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-xl font-serif text-charcoal"
                                    />
                                    <label className="absolute left-0 -top-6 text-sm text-rust font-serif">
                                        Lookback Period (Hours)
                                    </label>
                                </div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={keywords}
                                        onChange={(e) => setKeywords(e.target.value)}
                                        className="peer w-full bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-xl font-serif text-charcoal"
                                        placeholder="e.g. AI, Mars, Crypto"
                                    />
                                    <label className="absolute left-0 -top-6 text-sm text-rust font-serif">
                                        Keywords Filter (Optional)
                                    </label>
                                </div>
                            </div>
                        )}

                    </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-20 flex gap-4 items-center">
                    {!isScraping ? (
                        <button
                            onClick={handleScrape}
                            disabled={!canSubmit}
                            className="group px-10 py-4 border border-charcoal rounded-full hover:bg-charcoal hover:text-washi transition-all duration-500 uppercase tracking-widest text-sm flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed font-serif"
                        >
                            <span className="group-hover:translate-x-1 transition-transform duration-300">
                                {activeTab === 'monitor' ? 'Start Monitor' : 'Begin Extraction'}
                            </span>
                            <i className="ph ph-arrow-right group-hover:translate-x-1 transition-transform duration-300"></i>
                        </button>
                    ) : (
                        <button
                            onClick={handleStop}
                            className="px-8 py-4 border border-rust rounded-full hover:bg-rust hover:text-washi transition-all duration-500 uppercase tracking-widest text-sm text-rust font-serif"
                        >
                            Stop
                        </button>
                    )}
                </div>
            </section>

            {/* Results / Logs Section */}
            < section id="results" className="py-16 px-6 bg-charcoal text-washi min-h-[40vh] relative transition-colors duration-1000 border-t border-white/5" >
                <div className="max-w-4xl mx-auto">

                    {/* Status & Progress */}
                    <div className="mb-12">
                        <div className="flex justify-between items-end mb-4">
                            <div>
                                <h2 className="text-2xl mb-1 font-display tracking-wide text-stone/80">Process Status</h2>
                                <p className="text-stone/60 text-sm font-serif italic">
                                    {isScraping ? 'Extracting digital fragments...' :
                                        downloadUrl ? 'Collection complete.' : 'Ready to begin.'}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-3xl font-display text-rust">{progress.current} <span className="text-sm text-stone/50">/ {progress.target}</span></p>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="h-px w-full bg-stone/10 overflow-hidden">
                            <div
                                className="h-full bg-rust transition-all duration-500 ease-out"
                                style={{ width: `${Math.min(100, (progress.current / Math.max(progress.target, 1)) * 100)}%` }}
                            ></div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Logs Column */}
                        <div className="lg:col-span-2">
                            <h3 className="text-[10px] uppercase tracking-[0.2em] text-stone/30 mb-3 font-sans">System Journal</h3>
                            <div className="font-mono text-[11px] leading-relaxed text-stone/10 space-y-1 h-[180px] overflow-y-auto p-4 border border-white/10 rounded-sm bg-white/5 scrollbar-thin scrollbar-thumb-stone/30 backdrop-blur-sm transition-all hover:border-white/20">
                                {logs.length === 0 && <p className="opacity-70 italic text-stone">Waiting for command input...</p>}
                                {logs.map((log, i) => (
                                    <div key={i} className="break-all border-l border-transparent hover:border-rust/60 pl-2 transition-colors duration-200 text-washi">
                                        {log}
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        </div>

                        {/* Result Card Column */}
                        <div className="lg:col-span-1">
                            {downloadUrl ? (
                                <div className="h-full flex flex-col justify-center animate-in fade-in slide-in-from-bottom-4 duration-700">
                                    <div className="p-6 border border-rust/20 bg-rust/5 rounded-sm text-center space-y-4 hover:bg-rust/10 transition-colors duration-500">
                                        <div className="w-10 h-10 mx-auto bg-rust text-washi rounded-full flex items-center justify-center text-lg shadow-lg shadow-rust/20">
                                            <i className="ph ph-check"></i>
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-display mb-1 text-washi/90">Extraction Complete</h3>
                                            <p className="text-stone/60 font-serif text-xs italic">Your archive is ready.</p>
                                        </div>
                                        <a
                                            href={appendApiKey(downloadUrl) || undefined}
                                            className="block w-full py-3 bg-stone/10 border border-stone/20 text-stone hover:bg-rust hover:border-rust hover:text-washi transition-all duration-300 uppercase tracking-widest text-[10px] font-sans"
                                        >
                                            Download Artifact
                                        </a>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center border border-dashed border-stone/10 rounded-sm opacity-20">
                                    <p className="font-serif italic text-stone text-xs">Artifact will appear here</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Performance Statistics */}
                    {performanceStats && (
                        <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <h3 className="text-[10px] uppercase tracking-[0.2em] text-stone/30 mb-4 font-sans">Performance Metrics</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {/* Total Duration */}
                                <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                    <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-1">Duration</p>
                                    <p className="text-xl font-display text-rust">
                                        {performanceStats.totalDuration < 60000 
                                            ? `${(performanceStats.totalDuration / 1000).toFixed(1)}s`
                                            : `${Math.floor(performanceStats.totalDuration / 60000)}m ${((performanceStats.totalDuration % 60000) / 1000).toFixed(0)}s`
                                        }
                                    </p>
                                </div>
                                
                                {/* Tweets/Second */}
                                <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                    <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-1">Speed</p>
                                    <p className="text-xl font-display text-rust">{performanceStats.tweetsPerSecond.toFixed(2)} <span className="text-xs text-stone/50">t/s</span></p>
                                </div>
                                
                                {/* Mode-specific metric */}
                                {(performanceStats.mode === 'graphql' || performanceStats.mode === 'mixed') && performanceStats.apiRequestCount !== undefined ? (
                                    <>
                                        {/* API Requests */}
                                        <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                            <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-1">API Requests</p>
                                            <p className="text-xl font-display text-washi/80">{performanceStats.apiRequestCount}</p>
                                        </div>
                                        
                                        {/* Avg API Latency */}
                                        <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                            <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-1">Avg Latency</p>
                                            <p className="text-xl font-display text-washi/80">
                                                {performanceStats.apiAverageLatency 
                                                    ? `${(performanceStats.apiAverageLatency / 1000).toFixed(2)}s`
                                                    : 'N/A'
                                                }
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {/* Scroll Count (Puppeteer mode) */}
                                        <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                            <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-1">Scrolls</p>
                                            <p className="text-xl font-display text-washi/80">{performanceStats.scrollCount}</p>
                                        </div>
                                        
                                        {/* Peak Memory */}
                                        <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                            <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-1">Peak Memory</p>
                                            <p className="text-xl font-display text-washi/80">{performanceStats.peakMemoryUsage.toFixed(0)} <span className="text-xs text-stone/50">MB</span></p>
                                        </div>
                                    </>
                                )}
                            </div>
                            
                            {/* Detailed Breakdown */}
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Time Breakdown - Different for API vs Puppeteer */}
                                <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                    <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-3">
                                        {(performanceStats.mode === 'graphql' || performanceStats.mode === 'mixed') && performanceStats.apiRequestTime !== undefined
                                            ? 'API Time Breakdown'
                                            : 'Time Breakdown'}
                                    </p>
                                    <div className="space-y-2 text-xs">
                                        {(performanceStats.mode === 'graphql' || performanceStats.mode === 'mixed') && performanceStats.apiRequestTime !== undefined ? (
                                            <>
                                                <div className="flex justify-between">
                                                    <span className="text-stone/60">API Request Time</span>
                                                    <span className="text-washi/80">
                                                        {performanceStats.apiRequestTime 
                                                            ? `${(performanceStats.apiRequestTime / 1000).toFixed(2)}s`
                                                            : '0s'}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-stone/60">API Parse Time</span>
                                                    <span className="text-washi/80">
                                                        {performanceStats.apiParseTime 
                                                            ? `${(performanceStats.apiParseTime / 1000).toFixed(2)}s`
                                                            : '0s'}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-stone/60">Extraction</span>
                                                    <span className="text-washi/80">{(performanceStats.extractionTime / 1000).toFixed(2)}s</span>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex justify-between">
                                                    <span className="text-stone/60">Navigation</span>
                                                    <span className="text-washi/80">{(performanceStats.navigationTime / 1000).toFixed(2)}s</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-stone/60">Scrolling</span>
                                                    <span className="text-washi/80">{(performanceStats.scrollTime / 1000).toFixed(2)}s</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-stone/60">Extraction</span>
                                                    <span className="text-washi/80">{(performanceStats.extractionTime / 1000).toFixed(2)}s</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Session Stats */}
                                <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                    <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-3">Session Health</p>
                                    <div className="space-y-2 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-stone/60">Session Switches</span>
                                            <span className={performanceStats.sessionSwitches > 0 ? "text-yellow-400" : "text-green-400"}>{performanceStats.sessionSwitches}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-stone/60">Rate Limits Hit</span>
                                            <span className={performanceStats.rateLimitHits > 0 ? "text-red-400" : "text-green-400"}>{performanceStats.rateLimitHits}</span>
                                        </div>
                                        {performanceStats.rateLimitWaitTime !== undefined && performanceStats.rateLimitWaitTime > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-stone/60">Rate Limit Wait</span>
                                                <span className="text-washi/80">{(performanceStats.rateLimitWaitTime / 1000).toFixed(2)}s</span>
                                            </div>
                                        )}
                                        {(performanceStats.mode === 'graphql' || performanceStats.mode === 'mixed') && performanceStats.apiRetryCount !== undefined && performanceStats.apiRetryCount > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-stone/60">API Retries</span>
                                                <span className="text-yellow-400">{performanceStats.apiRetryCount}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Efficiency */}
                                <div className="p-4 border border-white/10 rounded-sm bg-white/5">
                                    <p className="text-[10px] uppercase tracking-wider text-stone/50 mb-3">Efficiency</p>
                                    <div className="space-y-2 text-xs">
                                        {(performanceStats.mode === 'graphql' || performanceStats.mode === 'mixed') && performanceStats.apiRequestCount !== undefined ? (
                                            <div className="flex justify-between">
                                                <span className="text-stone/60">Tweets/Request</span>
                                                <span className="text-washi/80">
                                                    {performanceStats.apiRequestCount > 0 
                                                        ? (performanceStats.tweetsCollected / performanceStats.apiRequestCount).toFixed(1)
                                                        : 'N/A'
                                                    }
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex justify-between">
                                                <span className="text-stone/60">Tweets/Scroll</span>
                                                <span className="text-washi/80">
                                                    {performanceStats.scrollCount > 0 
                                                        ? (performanceStats.tweetsCollected / performanceStats.scrollCount).toFixed(1)
                                                        : 'N/A'
                                                    }
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex justify-between">
                                            <span className="text-stone/60">Total Tweets</span>
                                            <span className="text-rust font-medium">{performanceStats.tweetsCollected}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="absolute bottom-4 left-0 w-full text-center text-stone/20 text-[10px] uppercase tracking-[0.3em] font-sans">
                    © 2024 Mono no Aware
                </div>
            </section >
        </div >
                {/* Performance Dashboard */}
                <div className="mt-16 border-t border-stone/20 pt-16">
                    <PerformanceDashboard 
                        speedHistory={speedHistory}
                        sessionStats={sessionStats}
                    />
                </div>

                {/* Session Management */}
                <div className="mt-16 border-t border-stone/20 pt-16">
                    <SessionManager />
                </div>
            </div>
        </div>
    );
}

export default App;
