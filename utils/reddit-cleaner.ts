import fs from 'fs';
import path from 'path';

export interface NormalizedRedditPost {
  id: string;
  title?: string | null;
  author?: string | null;
  url?: string | null;
  selfText?: string | null;
  subreddit?: string | null;
  score?: number | null;
  upvoteRatio?: number | null;
  numComments?: number | null;
  createdUtc?: number | null;
  permalink?: string | null;
  flair?: string | null;
  over18?: boolean | null;
  stickied?: boolean | null;
}

export interface RedditParseStats {
  total: number;
  deduped: number;
  dropped: number;
}

export interface RedditParseResult {
  posts: NormalizedRedditPost[];
  stats: RedditParseStats;
  usedWasm: boolean;
  wasmError?: string;
}

type WasmModule = {
  parse_reddit_payload: (payload: any) => { posts: NormalizedRedditPost[]; stats: RedditParseStats };
};

let wasmModulePromise: Promise<WasmModule | null> | null = null;

async function loadWasm(): Promise<WasmModule | null> {
  if (wasmModulePromise) return wasmModulePromise;

  const candidates = [
    path.resolve(__dirname, '..', 'wasm', 'reddit-cleaner', 'pkg', 'reddit_cleaner.js'),
    path.resolve(__dirname, '..', '..', 'wasm', 'reddit-cleaner', 'pkg', 'reddit_cleaner.js'),
    path.resolve(process.cwd(), 'wasm', 'reddit-cleaner', 'pkg', 'reddit_cleaner.js'),
  ];

  wasmModulePromise = (async () => {
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const imported = await import(candidate);
        const mod = (imported as any).parse_reddit_payload
          ? (imported as WasmModule)
          : (imported as any).default;
        if (mod && typeof (mod as any).parse_reddit_payload === 'function') {
          return mod as WasmModule;
        }
      } catch (e) {
        // Try next candidate
        continue;
      }
    }
    return null;
  })();

  return wasmModulePromise;
}

function normalizeFallback(payload: any): RedditParseResult {
  const posts: NormalizedRedditPost[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let deduped = 0;

  const walkChildren = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walkChildren);
      return;
    }
    const children = node?.data?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const data = child?.data || child;
        const id = data?.id || data?.name;
        if (!id || typeof id !== 'string') {
          dropped++;
          continue;
        }
        if (seen.has(id)) {
          deduped++;
          continue;
        }
        seen.add(id);
        posts.push({
          id,
          title: data?.title ?? null,
          author: data?.author ?? null,
          url: data?.url ?? data?.permalink ?? null,
          selfText: data?.selftext ?? null,
          subreddit: data?.subreddit ?? null,
          score: typeof data?.score === 'number' ? data.score : null,
          upvoteRatio: typeof data?.upvote_ratio === 'number' ? data.upvote_ratio : null,
          numComments: typeof data?.num_comments === 'number' ? data.num_comments : null,
          createdUtc: typeof data?.created_utc === 'number' ? data.created_utc : null,
          permalink: data?.permalink ?? null,
          flair: data?.link_flair_text ?? data?.author_flair_text ?? null,
          over18: typeof data?.over_18 === 'boolean' ? data.over_18 : null,
          stickied: typeof data?.stickied === 'boolean' ? data.stickied : null,
        });
      }
    }
  };

  walkChildren(payload);

  return {
    posts,
    stats: {
      total: posts.length,
      deduped,
      dropped,
    },
    usedWasm: false,
  };
}

export async function parseRedditPayload(payload: any): Promise<RedditParseResult> {
  const wasm = await loadWasm();
  let wasmError: string | undefined;

  if (wasm && typeof wasm.parse_reddit_payload === 'function') {
    try {
      const { posts, stats } = wasm.parse_reddit_payload(payload);
      return { posts, stats, usedWasm: true };
    } catch (e: any) {
      wasmError = e?.message || String(e);
    }
  }

  const fallback = normalizeFallback(payload);
  if (wasmError) fallback.wasmError = wasmError;
  return fallback;
}
