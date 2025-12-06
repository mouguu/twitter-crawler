import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TabType } from '@/types/ui';

type ScrapeMode = 'graphql' | 'puppeteer' | 'mixed';
type AntiDetectionLevel = 'low' | 'medium' | 'high' | 'paranoid';

interface CrawlerState {
  // Core inputs
  activeTab: TabType;
  input: string;
  limit: number;
  
  // Twitter options
  scrapeLikes: boolean;
  scrapeMode: ScrapeMode;
  autoRotateSessions: boolean;
  enableProxy: boolean;
  antiDetectionLevel: AntiDetectionLevel;
  
  // Search options
  enableDeepSearch: boolean;
  parallelChunks: number;
  startDate: string;
  endDate: string;
  lookbackHours: number;
  keywords: string;
  
  // Reddit options
  redditStrategy: string;
  
  // UI state
  isScraping: boolean;
  latestJobId: string | null;
  
  // Actions
  setActiveTab: (tab: TabType) => void;
  setInput: (input: string) => void;
  setLimit: (limit: number) => void;
  setScrapeLikes: (value: boolean) => void;
  setScrapeMode: (mode: ScrapeMode) => void;
  setAutoRotateSessions: (value: boolean) => void;
  setEnableProxy: (value: boolean) => void;
  setAntiDetectionLevel: (level: AntiDetectionLevel) => void;
  setEnableDeepSearch: (value: boolean) => void;
  setParallelChunks: (value: number) => void;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  setLookbackHours: (hours: number) => void;
  setKeywords: (keywords: string) => void;
  setRedditStrategy: (strategy: string) => void;
  setIsScraping: (value: boolean) => void;
  setLatestJobId: (id: string | null) => void;
  
  // Computed
  canSubmit: () => boolean;
  resetForm: () => void;
}

export const useCrawlerStore = create<CrawlerState>()(
  persist(
    (set, get) => ({
      // Core inputs
      activeTab: 'profile' as TabType,
      input: '',
      limit: 50,
      
      // Twitter options
      scrapeLikes: false,
      scrapeMode: 'puppeteer' as ScrapeMode,
      autoRotateSessions: true,
      enableProxy: false,
      antiDetectionLevel: 'high' as AntiDetectionLevel,
      
      // Search options
      enableDeepSearch: false,
      parallelChunks: 1,
      startDate: '',
      endDate: '',
      lookbackHours: 24,
      keywords: '',
      
      // Reddit options
      redditStrategy: 'auto',
      
      // UI state
      isScraping: false,
      latestJobId: null,
      
      // Actions
      setActiveTab: (tab) => set({ activeTab: tab, input: '' }),
      setInput: (input) => set({ input }),
      setLimit: (limit) => set({ limit }),
      setScrapeLikes: (value) => set({ scrapeLikes: value }),
      setScrapeMode: (mode) => set({ scrapeMode: mode }),
      setAutoRotateSessions: (value) => set({ autoRotateSessions: value }),
      setEnableProxy: (value) => set({ enableProxy: value }),
      setAntiDetectionLevel: (level) => set({ antiDetectionLevel: level }),
      setEnableDeepSearch: (value) => set({ enableDeepSearch: value }),
      setParallelChunks: (value) => set({ parallelChunks: value }),
      setStartDate: (date) => set({ startDate: date }),
      setEndDate: (date) => set({ endDate: date }),
      setLookbackHours: (hours) => set({ lookbackHours: hours }),
      setKeywords: (keywords) => set({ keywords }),
      setRedditStrategy: (strategy) => set({ redditStrategy: strategy }),
      setIsScraping: (value) => set({ isScraping: value }),
      setLatestJobId: (id) => set({ latestJobId: id }),
      
      // Computed
      canSubmit: () => get().input.trim().length > 0,
      resetForm: () => set({ 
        input: '', 
        limit: 50,
        startDate: '',
        endDate: '',
      }),
    }),
    {
      name: 'crawler-storage',
      partialize: (state) => ({
        // Only persist configuration, not UI state
        limit: state.limit,
        scrapeMode: state.scrapeMode,
        autoRotateSessions: state.autoRotateSessions,
        enableProxy: state.enableProxy,
        antiDetectionLevel: state.antiDetectionLevel,
        redditStrategy: state.redditStrategy,
        enableDeepSearch: state.enableDeepSearch,
        parallelChunks: state.parallelChunks,
      }),
    }
  )
);
