"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const path_utils_1 = require("../../utils/path-utils");
describe('path-utils', () => {
    const baseDir = path.join(process.cwd(), 'output');
    test('returns true for path inside base directory', () => {
        const target = path.join(baseDir, 'user', 'index.md');
        expect((0, path_utils_1.isPathInsideBase)(target, baseDir)).toBe(true);
    });
    test('returns false for traversal outside base directory', () => {
        const target = path.join(baseDir, '..', 'etc', 'passwd');
        expect((0, path_utils_1.isPathInsideBase)(target, baseDir)).toBe(false);
    });
    test('returns true when target equals base directory', () => {
        expect((0, path_utils_1.isPathInsideBase)(baseDir, baseDir)).toBe(true);
    });
    test('returns false when inputs are empty', () => {
        expect((0, path_utils_1.isPathInsideBase)('', baseDir)).toBe(false);
        expect((0, path_utils_1.isPathInsideBase)(baseDir, '')).toBe(false);
    });
});
