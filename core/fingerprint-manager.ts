
import { FingerprintGenerator } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';
import { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * FingerprintManager
 * 
 * Responsible for generating, persisting, and injecting browser fingerprints.
 * This ensures that each session (account) maintains a consistent browser identity
 * (User-Agent, Screen Resolution, Hardware Concurrency, etc.) to avoid detection.
 */
export class FingerprintManager {
    private generator: FingerprintGenerator;
    private injector: FingerprintInjector;
    private storageDir: string;
    private fingerprints: Map<string, any>; // Cache in memory

    constructor(baseDir: string = 'output/fingerprints') {
        this.storageDir = path.isAbsolute(baseDir) ? baseDir : path.join(process.cwd(), baseDir);
        this.fingerprints = new Map();

        // Initialize generator with common desktop configurations
        this.generator = new FingerprintGenerator({
            devices: ['desktop'],
            operatingSystems: ['windows', 'macos', 'linux'],
            browsers: [{ name: 'chrome', minVersion: 100 }],
            locales: ['en-US']
        });

        this.injector = new FingerprintInjector();

        this.ensureDirExists();
        this.loadFingerprints();
    }

    private ensureDirExists() {
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    private loadFingerprints() {
        try {
            const files = fs.readdirSync(this.storageDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const sessionId = file.replace('.json', '');
                    const content = fs.readFileSync(path.join(this.storageDir, file), 'utf-8');
                    this.fingerprints.set(sessionId, JSON.parse(content));
                }
            }
        } catch (error) {
            console.error('Failed to load fingerprints:', error);
        }
    }

    /**
     * Gets a fingerprint for a specific session ID.
     * If one exists, it returns the persisted one.
     * If not, it generates a new one and saves it.
     */
    public getFingerprint(sessionId: string): any {
        if (this.fingerprints.has(sessionId)) {
            return this.fingerprints.get(sessionId);
        }

        // Generate new fingerprint
        const fingerprint = this.generator.getFingerprint();

        // Save to memory
        this.fingerprints.set(sessionId, fingerprint);

        // Save to disk
        try {
            fs.writeFileSync(
                path.join(this.storageDir, `${sessionId}.json`),
                JSON.stringify(fingerprint, null, 2)
            );
        } catch (error) {
            console.error(`Failed to save fingerprint for session ${sessionId}:`, error);
        }

        return fingerprint;
    }

    /**
     * Injects the fingerprint into a Puppeteer page.
     * This must be called BEFORE the page navigates to the target URL.
     */
    public async injectFingerprint(page: Page, sessionId: string): Promise<void> {
        const fingerprint = this.getFingerprint(sessionId);
        await this.injector.attachFingerprintToPuppeteer(page, fingerprint);
    }
}
