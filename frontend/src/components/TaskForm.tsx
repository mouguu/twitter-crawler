import { motion } from "framer-motion";
import { ArrowRight, Square, Zap, Globe, MessageSquare, MessageCircle } from "lucide-react";

import type { TabType } from "../types/ui";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

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
  onRedditStrategyChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

const tabs = [
  { id: "profile" as const, label: "Profile", icon: Globe, description: "Scrape user tweets" },
  { id: "thread" as const, label: "Thread", icon: MessageSquare, description: "Get full conversations" },
  { id: "search" as const, label: "Search", icon: Zap, description: "Query-based extraction" },
  { id: "reddit" as const, label: "Reddit", icon: MessageCircle, description: "Subreddit scraping" },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
};

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
    onRedditStrategyChange,
    onSubmit,
    onStop,
  } = props;

  const isRedditPostUrl = activeTab === "reddit" && input.includes('reddit.com') && input.includes('/comments/');
  const currentTab = tabs.find(t => t.id === activeTab);

  return (
    <section id="scrape" className="pt-24 pb-16 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-12"
        >
          {/* Hero Section */}
          <motion.div variants={itemVariants} className="text-center space-y-4">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
              Data Extraction
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Extract data from Twitter/X and Reddit with precision. 
              Choose your source and configure how you want to scrape.
            </p>
          </motion.div>

          {/* Platform Selector - Bento Grid Style */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`
                    relative p-4 rounded-2xl border text-left transition-all duration-300
                    ${isActive 
                      ? 'bg-foreground text-background border-foreground shadow-lg' 
                      : 'bg-card border-border/50 hover:border-border hover:shadow-md'
                    }
                  `}
                >
                  <Icon className={`w-5 h-5 mb-2 ${isActive ? 'text-background' : 'text-muted-foreground'}`} />
                  <div className={`font-medium ${isActive ? '' : 'text-foreground'}`}>
                    {tab.label}
                  </div>
                  <div className={`text-xs mt-0.5 ${isActive ? 'text-background/70' : 'text-muted-foreground'}`}>
                    {tab.description}
                  </div>
                  {isActive && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="absolute top-3 right-3 w-2 h-2 rounded-full bg-background"
                    />
                  )}
                </button>
              );
            })}
          </motion.div>

          {/* Main Form Card */}
          <motion.div 
            variants={itemVariants}
            className="bg-card border border-border/50 rounded-3xl p-8 md:p-10 shadow-sm"
          >
            <div className="space-y-8">
              {/* Primary Input */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    {activeTab === "profile" && "Username or Profile URL"}
                    {activeTab === "thread" && "Tweet URL"}
                    {activeTab === "search" && "Search Query"}
                    {activeTab === "reddit" && "Subreddit or Post URL"}
                  </Label>
                  <span className="text-xs text-muted-foreground font-mono">
                    {currentTab?.id.toUpperCase()}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder={
                      activeTab === "profile" ? "elonmusk or https://x.com/elonmusk"
                      : activeTab === "thread" ? "https://x.com/user/status/..."
                      : activeTab === "reddit" ? "MachineLearning or https://reddit.com/r/..."
                      : "#AI from:elonmusk -is:retweet"
                    }
                    className="h-14 text-lg px-5 rounded-xl border-border/50 focus:border-foreground/20 transition-colors"
                  />
                </div>
              </div>

              {/* Search Hints */}
              {activeTab === "search" && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="flex flex-wrap gap-2"
                >
                  {["from:user", "to:user", "#hashtag", "min_faves:100", "-is:retweet", "lang:en"].map((hint) => (
                    <button
                      key={hint}
                      onClick={() => onInputChange(input + (input ? " " : "") + hint)}
                      className="px-3 py-1.5 text-xs font-mono bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                    >
                      {hint}
                    </button>
                  ))}
                </motion.div>
              )}

              {/* Two Column Layout */}
              <div className="grid md:grid-cols-2 gap-8">
                {/* Left Column */}
                <div className="space-y-6">
                  {/* Limit */}
                  {!isRedditPostUrl && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        {activeTab === "thread" ? "Max Replies" : activeTab === "reddit" ? "Post Limit" : "Tweet Limit"}
                      </Label>
                      <Input
                        type="number"
                        value={limit}
                        onChange={(e) => onLimitChange(parseInt(e.target.value))}
                        onWheel={(e) => e.currentTarget.blur()}
                        min={10}
                        max={1000}
                        className="w-32 font-mono"
                      />
                    </div>
                  )}



                  {/* Reddit Strategy */}
                  {activeTab === "reddit" && !isRedditPostUrl && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Scrape Strategy</Label>
                      <Select value={redditStrategy} onValueChange={onRedditStrategyChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto (Recommended)</SelectItem>
                          <SelectItem value="super_full">Super Full (Deep)</SelectItem>
                          <SelectItem value="super_recent">Super Recent (Fast)</SelectItem>
                          <SelectItem value="new">New Posts Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Extraction Mode */}
                  {(activeTab === "profile" || activeTab === "thread") && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Extraction Mode</Label>
                      <div className="flex flex-wrap gap-2">
                        {(["graphql", "puppeteer", "mixed"] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => onScrapeModeChange(mode)}
                            className={`
                              px-4 py-2 rounded-xl text-sm font-medium transition-all
                              ${scrapeMode === mode 
                                ? 'bg-foreground text-background' 
                                : 'bg-muted hover:bg-muted/80'
                              }
                            `}
                          >
                            {mode === "graphql" ? "GraphQL" : mode === "puppeteer" ? "Puppeteer" : "Mixed"}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {scrapeMode === "graphql" && "Fast extraction using Twitter's internal API"}
                        {scrapeMode === "puppeteer" && "Browser simulation for reliable results"}
                        {scrapeMode === "mixed" && "Start with API, fallback to browser if needed"}
                      </p>
                    </div>
                  )}

                  {activeTab === "search" && (
                    <div className="p-4 bg-muted/50 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary">Puppeteer Mode</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Search uses browser automation for comprehensive results.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                  {/* Date Range for Search */}
                  {activeTab === "search" && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Start Date</Label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) => onStartDateChange(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">End Date</Label>
                        <Input
                          type="date"
                          value={endDate}
                          onChange={(e) => onEndDateChange(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Options */}
                  <div className="space-y-4">
                    {activeTab === "profile" && (
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <Checkbox
                          checked={scrapeLikes}
                          onCheckedChange={(c) => onToggleLikes(c as boolean)}
                        />
                        <span className="text-sm group-hover:text-foreground transition-colors">
                          Include liked tweets
                        </span>
                      </label>
                    )}

                    {activeTab !== "reddit" && (
                      <>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <Checkbox
                            checked={autoRotateSessions}
                            onCheckedChange={(c) => onToggleAutoRotate(c as boolean)}
                          />
                          <div>
                            <span className="text-sm group-hover:text-foreground transition-colors block">
                              Auto-rotate sessions
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Switch accounts on rate limit
                            </span>
                          </div>
                        </label>

                        <label className="flex items-center gap-3 cursor-pointer group">
                          <Checkbox
                            checked={enableProxy}
                            onCheckedChange={(c) => onToggleProxy(c as boolean)}
                          />
                          <div>
                            <span className="text-sm group-hover:text-foreground transition-colors block">
                              Enable proxy
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Use proxies from ./proxy directory
                            </span>
                          </div>
                        </label>
                      </>
                    )}

                    {activeTab === "search" && (
                      <>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <Checkbox
                            checked={enableDeepSearch}
                            onCheckedChange={(c) => onToggleDeepSearch(c as boolean)}
                          />
                          <div>
                            <span className="text-sm group-hover:text-foreground transition-colors block">
                              Date chunking
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Split into monthly chunks for deeper results
                            </span>
                          </div>
                        </label>

                        {enableDeepSearch && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="pl-7 space-y-2"
                          >
                            <Label className="text-sm">Parallel chunks</Label>
                            <Input
                              type="number"
                              min={1}
                              max={3}
                              value={parallelChunks}
                              onChange={(e) => onParallelChunksChange(parseInt(e.target.value))}
                              className="w-20 font-mono"
                            />
                          </motion.div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Reddit Post Mode Notice */}
                  {isRedditPostUrl && (
                    <div className="p-4 bg-muted/50 rounded-xl border border-border/50">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-sm font-medium">Single Post Mode</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Will extract all available comments from this post.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between pt-6 border-t border-border/50">
                <div className="text-sm text-muted-foreground">
                  {canSubmit ? "Ready to extract" : "Enter a valid input to start"}
                </div>
                
                {!isScraping ? (
                  <Button
                    onClick={onSubmit}
                    disabled={!canSubmit}
                    size="lg"
                    className="gap-2 px-8 rounded-xl hover-lift"
                  >
                    Begin Extraction
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={onStop}
                    variant="destructive"
                    size="lg"
                    className="gap-2 px-8 rounded-xl"
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
