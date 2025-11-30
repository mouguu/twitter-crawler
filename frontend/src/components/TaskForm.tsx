import type { TabType } from "../types/ui";
import { cn } from "../utils/cn";

type ScrapeMode = "graphql" | "puppeteer" | "mixed";

interface TaskFormProps {
  activeTab: TabType;
  input: string;
  limit: number;
  scrapeLikes: boolean;
  scrapeMode: ScrapeMode;
  autoRotateSessions: boolean;
  enableDeepSearch: boolean;
  parallelChunks: number;
  enableProxy: boolean;
  startDate: string;
  endDate: string;
  lookbackHours: number;
  keywords: string;
  redditStrategy: string;
  isScraping: boolean;
  canSubmit: boolean;
  onTabChange: (tab: TabType) => void;
  onInputChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onScrapeModeChange: (mode: ScrapeMode) => void;
  onToggleLikes: (value: boolean) => void;
  onToggleAutoRotate: (value: boolean) => void;
  onToggleDeepSearch: (value: boolean) => void;
  onParallelChunksChange: (value: number) => void;
  onToggleProxy: (value: boolean) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onLookbackHoursChange: (value: number) => void;
  onKeywordsChange: (value: string) => void;
  onRedditStrategyChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

export function TaskForm(props: TaskFormProps) {
  const {
    activeTab,
    input,
    limit,
    scrapeLikes,
    scrapeMode,
    autoRotateSessions,
    enableDeepSearch,
    parallelChunks,
    enableProxy,
    startDate,
    endDate,
    lookbackHours,
    keywords,
    redditStrategy,
    isScraping,
    canSubmit,
    onTabChange,
    onInputChange,
    onLimitChange,
    onScrapeModeChange,
    onToggleLikes,
    onToggleAutoRotate,
    onToggleDeepSearch,
    onParallelChunksChange,
    onToggleProxy,
    onStartDateChange,
    onEndDateChange,
    onLookbackHoursChange,
    onKeywordsChange,
    onRedditStrategyChange,
    onSubmit,
    onStop,
  } = props;

  return (
    <section
      id="scrape"
      className="py-16 px-6 md:px-20 max-w-5xl mx-auto"
    >
      <div className="mb-12">
        <h2 className="text-3xl md:text-4xl mb-4 font-display text-charcoal">
          Extraction Parameters
        </h2>
        <div className="h-px w-24 bg-rust mb-6"></div>
        <p className="text-lg text-stone max-w-2xl font-serif">
          Select your source and configure the extraction settings.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex space-x-12 mb-12">
        {(["profile", "thread", "search", "monitor", "reddit"] as const).map(
          (tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                "font-serif text-2xl italic pb-2 transition-all duration-300 capitalize",
                activeTab === tab
                  ? "tab-active"
                  : "tab-inactive hover:text-rust"
              )}
            >
              {tab}
            </button>
          )
        )}
      </div>

      {/* Forms Container */}
      <div>
        {/* Dynamic Form Content based on Active Tab */}
        <div className="block space-y-12">
          <div className="relative group">
            <label className="absolute left-0 -top-6 text-sm text-rust font-serif pointer-events-none">
              {activeTab === "profile"
                ? "Username or Profile URL"
                : activeTab === "thread"
                  ? "Tweet URL"
                  : activeTab === "monitor"
                    ? "Usernames (comma separated)"
                    : activeTab === "reddit"
                      ? "Subreddit Name or Post URL"
                      : "Search Query / Hashtag"}
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              className="w-full bg-transparent border-b border-stone py-4 focus:outline-none focus:border-rust transition-colors text-2xl font-serif text-charcoal placeholder-stone/30"
              placeholder={
                activeTab === "profile"
                  ? "e.g. elonmusk"
                  : activeTab === "thread"
                    ? "https://x.com/..."
                    : activeTab === "monitor"
                      ? "elonmusk, realdonaldtrump, nasa"
                      : activeTab === "reddit"
                        ? "UofT or https://reddit.com/r/Bard/comments/..."
                        : "e.g. #AI"
              }
            />
          </div>

          {/* Search Syntax Hints */}
          {activeTab === "search" && (
            <div className="mt-2 text-xs text-stone/60 font-sans space-y-1">
              <p className="italic">💡 Advanced search syntax:</p>
              <p className="font-mono text-[10px] leading-relaxed">
                <span className="text-rust">from:username</span> • 
                <span className="text-rust"> lang:en</span> • 
                <span className="text-rust"> #hashtag</span> • 
                <span className="text-rust"> -is:retweet</span> • 
                <span className="text-rust"> min_faves:100</span>
              </p>
            </div>
          )}

          {/* Reddit Input Hints */}
          {activeTab === "reddit" && (
            <div className="mt-2 text-xs text-stone/60 font-sans space-y-1">
              <p className="italic">💡 Supports both:</p>
              <p className="font-mono text-[10px] leading-relaxed">
                <span className="text-rust">Subreddit:</span> UofT, Bard, AskReddit<br/>
                <span className="text-rust">Single Post:</span> https://reddit.com/r/.../comments/...
              </p>
            </div>
          )}

          {activeTab !== "monitor" ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-end">
                {/* Hide Limit for Reddit Post URLs */}
                {!(activeTab === "reddit" && input.includes('reddit.com') && input.includes('/comments/')) && (
                  <div className="relative">
                    <input
                      type="number"
                      value={limit}
                      onChange={(e) => onLimitChange(parseInt(e.target.value))}
                      onWheel={(e) => e.currentTarget.blur()}
                      min="10"
                      max="1000"
                      className="peer w-full bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-xl font-serif text-charcoal"
                    />
                    <label className="absolute left-0 -top-6 text-sm text-rust font-serif">
                      {activeTab === "thread"
                        ? "Max Replies"
                        : activeTab === "reddit"
                          ? "Limit (Posts)"
                          : "Limit (Tweets)"}
                    </label>
                  </div>
                )}

                <div className="flex flex-col space-y-4">
                  {/* Hide Strategy for Reddit Post URLs */}
                  {activeTab === "reddit" && !(input.includes('reddit.com') && input.includes('/comments/')) && (
                    <div className="flex flex-col space-y-2">
                      <span className="text-xs uppercase tracking-wider text-stone/60 font-sans">
                        Scraping Strategy
                      </span>
                      <select
                        value={redditStrategy}
                        onChange={(e) => onRedditStrategyChange(e.target.value)}
                        className="bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-sm font-serif text-charcoal"
                      >
                        <option value="auto">Auto (Recommended)</option>
                        <option value="super_full">Super Full (Deep)</option>
                        <option value="super_recent">Super Recent (Fast)</option>
                        <option value="new">New Only</option>
                      </select>
                    </div>
                  )}

                  {/* Show helpful note for Post URL mode */}
                  {activeTab === "reddit" && input.includes('reddit.com') && input.includes('/comments/') && (
                    <div className="text-sm text-stone/70 font-sans italic">
                      💡 Single post mode: will scrape all available comments
                    </div>
                  )}

                  {/* Scrape Mode Toggle - 在 profile / thread 模式显示；search 强制 Puppeteer */}
                  {(activeTab === "profile" ||
                    activeTab === "thread") && (
                    <div className="flex flex-col space-y-2">
                      <span className="text-xs uppercase tracking-wider text-stone/60 font-sans">
                        Extraction Mode
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => onScrapeModeChange("graphql")}
                          className={cn(
                            "px-4 py-2 border rounded-full text-sm font-serif transition-all duration-300",
                            scrapeMode === "graphql"
                              ? "border-rust bg-rust/10 text-rust"
                              : "border-stone/30 text-stone hover:border-rust hover:text-rust"
                          )}
                        >
                          ⚡ GraphQL API
                        </button>
                        <button
                          onClick={() => onScrapeModeChange("puppeteer")}
                          className={cn(
                            "px-4 py-2 border rounded-full text-sm font-serif transition-all duration-300",
                            scrapeMode === "puppeteer"
                              ? "border-rust bg-rust/10 text-rust"
                              : "border-stone/30 text-stone hover:border-rust hover:text-rust"
                          )}
                        >
                          🌐 Puppeteer DOM
                        </button>
                        <button
                          onClick={() => onScrapeModeChange("mixed")}
                          className={cn(
                            "px-4 py-2 border rounded-full text-sm font-serif transition-all duration-300",
                            scrapeMode === "mixed"
                              ? "border-rust bg-rust/10 text-rust"
                              : "border-stone/30 text-stone hover:border-rust hover:text-rust"
                          )}
                        >
                          🔄 Mixed (API + DOM)
                        </button>
                      </div>
                      <span className="text-[10px] text-stone/40 font-sans italic">
                        {scrapeMode === "graphql"
                          ? "Faster, uses Twitter's internal API"
                          : scrapeMode === "puppeteer"
                            ? "Slower but more reliable, simulates browser"
                            : "Start with API, auto-fallback to DOM if API depth hits boundary"}
                      </span>
                    </div>
                  )}

                  {activeTab === "search" && (
                    <div className="flex flex-col space-y-2">
                      <span className="text-xs uppercase tracking-wider text-stone/60 font-sans">
                        Extraction Mode
                      </span>
                      <div className="flex items-center space-x-2">
                        <span className="px-4 py-2 border border-rust bg-rust/10 text-rust rounded-full text-sm font-serif">
                          🌐 Puppeteer DOM
                        </span>
                      </div>
                      <span className="text-[10px] text-stone/40 font-sans italic">
                        GraphQL search 已停用（Twitter SearchTimeline 游标 404），搜索强制使用 Puppeteer 模式。
                      </span>
                    </div>
                  )}

                  {activeTab === "profile" && (
                    <label className="flex items-center space-x-4 cursor-pointer group select-none">
                      <div className="w-6 h-6 border border-stone rounded-full flex items-center justify-center group-hover:border-rust transition-colors">
                        <div
                          className={cn(
                            "w-3 h-3 bg-rust rounded-full transition-opacity checkbox-indicator",
                            scrapeLikes ? "opacity-100" : "opacity-0"
                          )}
                        ></div>
                      </div>
                      <input
                        type="checkbox"
                        checked={scrapeLikes}
                        onChange={(e) => onToggleLikes(e.target.checked)}
                        className="hidden"
                      />
                      <span className="font-serif text-xl text-stone group-hover:text-charcoal transition-colors">
                        Scrape Likes
                      </span>
                    </label>
                  )}

                  {/* Auto-Rotate Sessions Toggle - Hide for Reddit */}
                  {activeTab !== "reddit" && (
                    <div className="pt-4 border-t border-stone/10 space-y-4">
                      <label className="flex items-center space-x-4 cursor-pointer group select-none">
                        <div className="w-6 h-6 border border-stone rounded-full flex items-center justify-center group-hover:border-rust transition-colors">
                          <div
                            className={cn(
                              "w-3 h-3 bg-rust rounded-full transition-opacity checkbox-indicator",
                              autoRotateSessions
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          ></div>
                        </div>
                        <input
                          type="checkbox"
                          checked={autoRotateSessions}
                          onChange={(e) =>
                            onToggleAutoRotate(e.target.checked)
                          }
                          className="hidden"
                        />
                        <div className="flex flex-col">
                          <span className="font-serif text-xl text-stone group-hover:text-charcoal transition-colors">
                            Auto-Rotate Sessions
                          </span>
                          <span className="text-xs text-stone/60 font-sans">
                            Switch account on rate limit
                          </span>
                        </div>
                      </label>
                      
                      {/* Proxy Toggle - Optional Feature */}
                      <label className="flex items-center space-x-4 cursor-pointer group select-none">
                        <div className="w-6 h-6 border border-stone rounded-full flex items-center justify-center group-hover:border-rust transition-colors">
                          <div
                            className={cn(
                              "w-3 h-3 bg-rust rounded-full transition-opacity checkbox-indicator",
                              enableProxy
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          ></div>
                        </div>
                        <input
                          type="checkbox"
                          checked={enableProxy}
                          onChange={(e) => onToggleProxy(e.target.checked)}
                          className="hidden"
                        />
                        <div className="flex flex-col">
                          <span className="font-serif text-xl text-stone group-hover:text-charcoal transition-colors">
                            Enable Proxy (Optional)
                          </span>
                          <span className="text-xs text-stone/60 font-sans">
                            Use proxy from ./proxy directory if available
                          </span>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Advanced Options for Search Mode */}
              {activeTab === "search" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-end pt-4 border-t border-stone/10 mt-8">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => onStartDateChange(e.target.value)}
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
                        onChange={(e) => onEndDateChange(e.target.value)}
                        className="peer w-full bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-lg font-serif text-charcoal"
                      />
                      <label className="absolute left-0 -top-6 text-sm text-rust font-serif">
                        End Date
                      </label>
                    </div>
                  </div>

                  {/* Deep Search Toggle */}
                  <div className="flex flex-col space-y-4">
                    <div className="flex flex-col space-y-2">
                      <span className="text-xs uppercase tracking-wider text-stone/60 font-sans">
                        Deep Search
                      </span>
                      <label className="flex items-center space-x-4 cursor-pointer group select-none">
                        <div className="w-6 h-6 border border-stone rounded-full flex items-center justify-center group-hover:border-rust transition-colors">
                          <div
                            className={cn(
                              "w-3 h-3 bg-rust rounded-full transition-opacity checkbox-indicator",
                              enableDeepSearch ? "opacity-100" : "opacity-0"
                            )}
                          ></div>
                        </div>
                        <input
                          type="checkbox"
                          checked={enableDeepSearch}
                          onChange={(e) => onToggleDeepSearch(e.target.checked)}
                          className="hidden"
                        />
                        <div className="flex flex-col">
                          <span className="font-serif text-lg text-stone group-hover:text-charcoal transition-colors">
                            Enable Date Chunking
                          </span>
                          <span className="text-[10px] text-stone/50 font-sans">
                            Split search into monthly chunks (Newest → Oldest)
                          </span>
                        </div>
                      </label>
                    </div>

                    {/* Parallel Chunks Control - Only show when Deep Search is enabled */}
                    {enableDeepSearch && (
                      <div className="flex flex-col space-y-2 pl-10">
                        <label className="text-xs uppercase tracking-wider text-stone/60 font-sans">
                          Parallel Processing
                        </label>
                        <div className="flex items-center space-x-4">
                          <input
                            type="number"
                            min="1"
                            max="3"
                            value={parallelChunks}
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 1;
                              const clamped = Math.max(1, Math.min(3, value));
                              onParallelChunksChange(clamped);
                            }}
                            onWheel={(e) => e.currentTarget.blur()}
                            className="w-20 bg-transparent border-b border-stone py-1 focus:outline-none focus:border-rust transition-colors text-sm font-serif text-charcoal text-center"
                          />
                          <div className="flex flex-col">
                            <span className="font-serif text-sm text-stone">
                              Parallel Chunks
                            </span>
                            <span className="text-[10px] text-stone/50 font-sans">
                              {parallelChunks === 1 
                                ? "Serial (1 chunk at a time)" 
                                : `Parallel (${parallelChunks} chunks simultaneously, 2-3x faster)`}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
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
                  onChange={(e) =>
                    onLookbackHoursChange(parseInt(e.target.value))
                  }
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
                  onChange={(e) => onKeywordsChange(e.target.value)}
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
            onClick={onSubmit}
            disabled={!canSubmit}
            className="group px-10 py-4 border border-charcoal rounded-full hover:bg-charcoal hover:text-washi transition-all duration-500 uppercase tracking-widest text-sm flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed font-serif"
          >
            <span className="group-hover:translate-x-1 transition-transform duration-300">
              {activeTab === "monitor"
                ? "Start Monitor"
                : "Begin Extraction"}
            </span>
            <i className="ph ph-arrow-right group-hover:translate-x-1 transition-transform duration-300"></i>
          </button>
        ) : (
          <button
            onClick={onStop}
            className="px-8 py-4 border border-rust rounded-full hover:bg-rust hover:text-washi transition-all duration-500 uppercase tracking-widest text-sm text-rust font-serif"
          >
            Stop
          </button>
        )}
      </div>
    </section>
  );
}
