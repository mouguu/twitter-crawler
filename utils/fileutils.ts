/**
 * File utilities and run directory helpers for Twitter Crawler
 * 统一管理输出结构与目录创建
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as timeUtils from './time';

const DEFAULT_OUTPUT_ROOT = path.resolve(process.cwd(), 'output');

const DEFAULT_PLATFORM = 'twitter';
const DEFAULT_IDENTIFIER = 'timeline';

/**
 * 简单清理文件路径片段，避免非法字符
 */
export function sanitizeSegment(segment: string = ''): string {
  return String(segment)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || DEFAULT_IDENTIFIER;
}

/**
 * 确保目录存在
 */
export async function ensureDirExists(dir: string): Promise<boolean> {
  if (!dir) {
    console.error('ensureDirExists requires directory path');
    return false;
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    return true;
  } catch (error: any) {
    console.error(`Failed to create directory: ${dir}`, error.message);
    return false;
  }
}

/**
 * 确保基础输出目录存在
 */
export async function ensureBaseStructure(): Promise<boolean> {
  await ensureDirExists(DEFAULT_OUTPUT_ROOT);
  return true;
}

/**
 * 兼容旧函数名称
 */
export async function ensureDirectories(): Promise<boolean> {
  return ensureBaseStructure();
}

export function getDefaultOutputRoot(): string {
  return DEFAULT_OUTPUT_ROOT;
}

export interface RunContextOptions {
  platform?: string;
  identifier?: string;
  baseOutputDir?: string;
  timestamp?: string;
  timezone?: string;
}

export interface RunContext {
  platform: string;
  identifier: string;
  outputRoot: string;
  runId: string;
  timezone: string;
  runTimestamp: string;
  runTimestampIso: string;
  runTimestampUtc: string;
  runDir: string;
  markdownDir: string;
  screenshotDir: string;
  jsonPath: string;
  csvPath: string;
  markdownIndexPath: string;
  metadataPath: string;
}

/**
 * 创建一次抓取任务的运行目录上下文
 */
export async function createRunContext(options: RunContextOptions = {}): Promise<RunContext> {
  await ensureBaseStructure();

  const platform = sanitizeSegment(options.platform || DEFAULT_PLATFORM);
  const identifier = sanitizeSegment(options.identifier || DEFAULT_IDENTIFIER);
  const timezone = timeUtils.resolveTimezone(options.timezone);

  let sourceDate = new Date();
  if (options.timestamp) {
    const overrideDate = new Date(options.timestamp);
    if (!Number.isNaN(overrideDate.getTime())) {
      sourceDate = overrideDate;
    } else {
      console.warn(`[fileutils] Invalid timestamp override "${options.timestamp}", using current time instead.`);
    }
  }

  const timestampInfo = timeUtils.formatZonedTimestamp(sourceDate, timezone, {
    includeMilliseconds: true,
    includeOffset: true
  });

  const runTimestamp = timestampInfo.fileSafe;
  const runTimestampIso = timestampInfo.iso;
  const runTimestampUtc = sourceDate.toISOString();
  const runId = `run-${runTimestamp}`;

  const outputRoot = options.baseOutputDir
    ? path.resolve(options.baseOutputDir)
    : DEFAULT_OUTPUT_ROOT;

  const platformDir = path.join(outputRoot, platform);
  const subjectDir = path.join(platformDir, identifier);
  const runDir = path.join(subjectDir, runId);
  const markdownDir = path.join(runDir, 'markdown');
  const screenshotDir = path.join(runDir, 'screenshots');

  await Promise.all([
    ensureDirExists(platformDir),
    ensureDirExists(subjectDir),
    ensureDirExists(runDir),
    ensureDirExists(markdownDir),
    ensureDirExists(screenshotDir)
  ]);

  return {
    platform,
    identifier,
    outputRoot,
    runId,
    timezone,
    runTimestamp,
    runTimestampIso,
    runTimestampUtc,
    runDir,
    markdownDir,
    screenshotDir,
    jsonPath: path.join(runDir, 'tweets.json'),
    csvPath: path.join(runDir, 'tweets.csv'),
    markdownIndexPath: path.join(runDir, 'index.md'),
    metadataPath: path.join(runDir, 'metadata.json')
  };
}

/**
 * 生成今天的日期字符串，格式为 YYYY-MM-DD
 */
export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * 获取目录中的 Markdown 文件（排除合并文件）
 */
export async function getMarkdownFiles(dir: string): Promise<string[]> {
  if (!dir) {
    console.error('getMarkdownFiles requires directory path');
    return [];
  }
  try {
    const files = await fs.readdir(dir);
    return files
      .filter(file => file.endsWith('.md') && !file.startsWith('merged-') && !file.startsWith('digest-'))
      .map(file => path.join(dir, file));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Directory does not exist, cannot read Markdown files: ${dir}`);
      return [];
    }
    console.error(`Failed to read Markdown files (${dir}):`, error.message);
    return [];
  }
}

export { DEFAULT_OUTPUT_ROOT };
