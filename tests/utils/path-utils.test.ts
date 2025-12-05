import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as path from 'path';
import { isPathInsideBase } from '../../utils/path-utils';

describe('path-utils', () => {
    const baseDir = path.join(process.cwd(), 'output');

    test('returns true for path inside base directory', () => {
        const target = path.join(baseDir, 'user', 'index.md');
        expect(isPathInsideBase(target, baseDir)).toBe(true);
    });

    test('returns false for traversal outside base directory', () => {
        const target = path.join(baseDir, '..', 'etc', 'passwd');
        expect(isPathInsideBase(target, baseDir)).toBe(false);
    });

    test('returns true when target equals base directory', () => {
        expect(isPathInsideBase(baseDir, baseDir)).toBe(true);
    });

    test('returns false when inputs are empty', () => {
        expect(isPathInsideBase('', baseDir)).toBe(false);
        expect(isPathInsideBase(baseDir, '')).toBe(false);
    });
});
