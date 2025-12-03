/**
 * OutputPathManager
 * 统一管理输出路径，提供安全的路径操作和目录结构管理
 */

import * as path from "path";
import * as fs from "fs";
import { promises as fsPromises } from "fs";
import { sanitizeSegment } from "./fileutils";

export interface OutputPathConfig {
  baseDir?: string;
}

export interface RunPathResult {
  platform: string;
  identifier: string;
  runId: string;
  runDir: string;
  markdownDir: string;
  screenshotDir: string;
  jsonPath: string;
  csvPath: string;
  markdownIndexPath: string;
  metadataPath: string;
}

const DEFAULT_BASE_DIR = path.resolve(process.cwd(), "output");

let singletonInstance: OutputPathManager | null = null;

export class OutputPathManager {
  private baseDir: string;

  constructor(config: OutputPathConfig = {}) {
    this.baseDir = config.baseDir || process.env.OUTPUT_DIR || DEFAULT_BASE_DIR;

    // 确保基础目录存在
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * 获取基础目录
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * 获取平台目录
   */
  getPlatformDir(platform: string): string {
    const sanitized = sanitizeSegment(platform);
    return path.join(this.baseDir, sanitized);
  }

  /**
   * 获取标识符目录
   */
  getIdentifierDir(platform: string, identifier: string): string {
    const platformDir = this.getPlatformDir(platform);
    const sanitized = sanitizeSegment(identifier);
    return path.join(platformDir, sanitized);
  }

  /**
   * 创建运行路径结构
   */
  async createRunPath(
    platform: string,
    identifier: string,
    runId: string
  ): Promise<RunPathResult> {
    const runDir = path.join(
      this.getIdentifierDir(platform, identifier),
      runId
    );
    const markdownDir = path.join(runDir, "markdown");
    const screenshotDir = path.join(runDir, "screenshots");

    // 创建所有必要的目录
    await fsPromises.mkdir(runDir, { recursive: true });
    await fsPromises.mkdir(markdownDir, { recursive: true });
    await fsPromises.mkdir(screenshotDir, { recursive: true });

    return {
      platform: sanitizeSegment(platform),
      identifier: sanitizeSegment(identifier),
      runId,
      runDir,
      markdownDir,
      screenshotDir,
      jsonPath: path.join(runDir, "tweets.json"),
      csvPath: path.join(runDir, "tweets.csv"),
      markdownIndexPath: path.join(runDir, "index.md"),
      metadataPath: path.join(runDir, "metadata.json"),
    };
  }

  /**
   * 检查路径是否安全（在基础目录内）
   * 支持符号链接的真实路径解析
   */
  isPathSafe(filePath: string): boolean {
    try {
      // 1. 解析输入路径和baseDir的真实路径（跟随符号链接）
      const realPath = fs.existsSync(filePath)
        ? fs.realpathSync(filePath)
        : path.resolve(filePath);

      const baseRealPath = fs.existsSync(this.baseDir)
        ? fs.realpathSync(this.baseDir)
        : path.resolve(this.baseDir);

      // 2. 检查解析后的真实路径是否在baseDir内
      return (
        realPath.startsWith(baseRealPath + path.sep) ||
        realPath === baseRealPath
      );
    } catch (error) {
      // 如果解析失败（如权限问题），返回 false
      return false;
    }
  }

  /**
   * 解析相对路径，防止路径遍历攻击
   */
  resolvePath(relativePath: string): string {
    // 检测路径遍历尝试
    if (relativePath.includes("..") || path.isAbsolute(relativePath)) {
      throw new Error("Path traversal detected");
    }

    return path.join(this.baseDir, relativePath);
  }
}

/**
 * 获取单例 OutputPathManager 实例
 */
export function getOutputPathManager(
  config?: OutputPathConfig
): OutputPathManager {
  if (!singletonInstance || config) {
    singletonInstance = new OutputPathManager(config);
  }
  return singletonInstance;
}

/**
 * 重置单例实例（主要用于测试）
 */
export function resetOutputPathManager(): void {
  singletonInstance = null;
}
