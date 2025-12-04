import fs from 'fs';
import path from 'path';
import type { Tweet, RawTweetData } from '../types/tweet-definitions';
import { normalizeRawTweet } from '../types/tweet-definitions';

export interface CleanStats {
  added: number;
  deduped: number;
  dropped: number;
  truncated: number;
  total: number;
}

export interface CleanTweetsResult {
  tweets: Tweet[];
  stats: CleanStats;
  usedWasm: boolean;
  wasmError?: string;
}

type CleanerModule = {
  clean_and_merge: (existing: any, incoming: any, limit?: number | null) => {
    tweets: Tweet[];
    stats: CleanStats;
  };
};

let wasmModulePromise: Promise<CleanerModule | null> | null = null;

async function resolveWasmModule(): Promise<CleanerModule | null> {
  if (wasmModulePromise) return wasmModulePromise;

  const candidates = [
    path.resolve(__dirname, '..', 'wasm', 'tweet-cleaner', 'pkg', 'tweet_cleaner.js'),
    path.resolve(__dirname, '..', '..', 'wasm', 'tweet-cleaner', 'pkg', 'tweet_cleaner.js'),
    path.resolve(process.cwd(), 'wasm', 'tweet-cleaner', 'pkg', 'tweet_cleaner.js'),
  ];

  wasmModulePromise = (async () => {
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const imported = await import(candidate);
        const mod = (imported as any).clean_and_merge
          ? (imported as CleanerModule)
          : (imported as any).default;

        if (mod && typeof (mod as any).clean_and_merge === 'function') {
          return mod as CleanerModule;
        }
      } catch (err) {
        // Try next candidate
        continue;
      }
    }
    return null;
  })();

  return wasmModulePromise;
}

function coerceTweet(input: any): Tweet | null {
  if (!input || typeof input !== 'object') return null;

  // Already normalized Tweet-like
  if (typeof input.id === 'string' && typeof input.url === 'string' && typeof input.text === 'string') {
    return {
      id: String(input.id),
      url: String(input.url),
      text: String(input.text).trim(),
      ...(input.time ? { time: String(input.time) } : {}),
      ...(typeof input.likes === 'number' ? { likes: input.likes } : {}),
      ...(typeof input.retweets === 'number' ? { retweets: input.retweets } : {}),
      ...(typeof input.replies === 'number' ? { replies: input.replies } : {}),
      ...(typeof input.hasMedia === 'boolean' ? { hasMedia: input.hasMedia } : {}),
      ...(input.username ? { username: String(input.username) } : {}),
      ...(input.userId ? { userId: String(input.userId) } : {}),
      ...(input.userDisplayName ? { userDisplayName: String(input.userDisplayName) } : {}),
      ...(input.userAvatar ? { userAvatar: String(input.userAvatar) } : {}),
      ...(input.lang ? { lang: String(input.lang) } : {}),
      ...(input.views !== undefined ? { views: input.views } : {}),
      ...(typeof input.isReply === 'boolean' ? { isReply: input.isReply } : {}),
      ...(input.quotedContent !== undefined ? { quotedContent: input.quotedContent } : {}),
      ...(typeof input.isLiked === 'boolean' ? { isLiked: input.isLiked } : {}),
    };
  }

  // RawTweetData path
  if (typeof input.author === 'string' && typeof input.time === 'string') {
    try {
      return normalizeRawTweet(input as RawTweetData);
    } catch {
      return null;
    }
  }

  return null;
}

function sortTweetsByTime(tweets: Tweet[]): Tweet[] {
  return [...tweets].sort((a, b) => {
    const aMs = a.time ? new Date(a.time).getTime() : 0;
    const bMs = b.time ? new Date(b.time).getTime() : 0;
    return bMs - aMs;
  });
}

function mergeTweetsFallback(existing: Tweet[], incoming: any[], limit?: number): CleanTweetsResult {
  const map = new Map<string, Tweet>();
  let dropped = 0;
  let deduped = 0;
  let added = 0;

  for (const item of existing) {
    const normalized = coerceTweet(item);
    if (!normalized) {
      dropped++;
      continue;
    }
    map.set(normalized.id, normalized);
  }

  for (const item of incoming) {
    const normalized = coerceTweet(item);
    if (!normalized) {
      dropped++;
      continue;
    }
    if (map.has(normalized.id)) {
      deduped++;
    } else {
      added++;
    }
    map.set(normalized.id, normalized);
  }

  let tweets = sortTweetsByTime(Array.from(map.values()));

  let truncated = 0;
  if (typeof limit === 'number' && limit > 0 && tweets.length > limit) {
    truncated = tweets.length - limit;
    tweets = tweets.slice(0, limit);
  }

  return {
    tweets,
    stats: {
      added,
      deduped,
      dropped,
      truncated,
      total: tweets.length,
    },
    usedWasm: false,
  };
}

export async function cleanTweetsFast(
  existing: Tweet[],
  incoming: any[],
  options: { limit?: number } = {}
): Promise<CleanTweetsResult> {
  const wasm = await resolveWasmModule();
  let wasmError: string | undefined;

  if (wasm && typeof wasm.clean_and_merge === 'function') {
    try {
      const limit = options.limit ?? undefined;
      const { tweets, stats } = wasm.clean_and_merge(existing, incoming, limit);
      return {
        tweets: sortTweetsByTime(tweets),
        stats,
        usedWasm: true,
      };
    } catch (err: any) {
      wasmError = err?.message || String(err);
    }
  }

  const fallback = mergeTweetsFallback(existing, incoming, options.limit);
  if (wasmError) {
    fallback.wasmError = wasmError;
  }
  return fallback;
}
