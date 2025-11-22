import * as path from 'path';

/**
 * Checks whether a target path is contained within a base directory.
 * Resolves both paths to avoid traversal attacks.
 */
export function isPathInsideBase(targetPath: string, baseDir: string): boolean {
    if (!targetPath || !baseDir) return false;

    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);

    // Ensure trailing separator on base for strict prefix check
    const baseWithSep = resolvedBase.endsWith(path.sep)
        ? resolvedBase
        : resolvedBase + path.sep;

    return resolvedTarget === resolvedBase || resolvedTarget.startsWith(baseWithSep);
}
