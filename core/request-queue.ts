import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface RequestTask {
    id: string;
    url: string;
    uniqueKey: string;
    type: 'timeline' | 'thread' | 'search';
    priority: number; // Higher number = higher priority
    retryCount: number;
    payload?: any; // Extra data (e.g. maxTweets, search query)
}

export interface RequestQueueOptions {
    queueDir?: string;
    persistIntervalMs?: number;
}

export class RequestQueue {
    private queue: RequestTask[] = [];
    private inProgress: Set<string> = new Set();
    private handled: Set<string> = new Set(); // Persisted set of handled uniqueKeys
    private queueFilePath: string;
    private handledFilePath: string;
    private persistInterval: NodeJS.Timeout | null = null;

    constructor(options: RequestQueueOptions = {}) {
        const queueDir = options.queueDir || path.join(process.cwd(), '.queue');
        if (!fs.existsSync(queueDir)) {
            fs.mkdirSync(queueDir, { recursive: true });
        }
        this.queueFilePath = path.join(queueDir, 'queue.json');
        this.handledFilePath = path.join(queueDir, 'handled.json');

        this.loadState();

        // Auto-persist state periodically
        if (options.persistIntervalMs !== 0) {
            this.persistInterval = setInterval(() => this.persistState(), options.persistIntervalMs || 10000);
        }
    }

    /**
     * Compute a unique key for a URL to ensure deduplication
     */
    private computeUniqueKey(url: string): string {
        // Simple normalization: remove query params if needed, or just hash
        // For Twitter, usually the URL path is enough unique identity
        return createHash('md5').update(url).digest('hex');
    }

    /**
     * Add a request to the queue
     */
    async addRequest(task: Omit<RequestTask, 'id' | 'uniqueKey' | 'retryCount'> & { uniqueKey?: string }): Promise<void> {
        const uniqueKey = task.uniqueKey || this.computeUniqueKey(task.url);

        // Deduplication check
        if (this.handled.has(uniqueKey)) {
            // Already handled, skip
            return;
        }

        // Check if already in queue
        if (this.queue.some(t => t.uniqueKey === uniqueKey)) {
            return;
        }

        const newTask: RequestTask = {
            ...task,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            uniqueKey,
            retryCount: 0,
            priority: task.priority || 0
        };

        this.queue.push(newTask);
        // Sort by priority (descending)
        this.queue.sort((a, b) => b.priority - a.priority);

        console.log(`[RequestQueue] Added task: ${task.url} (Priority: ${newTask.priority})`);
    }

    /**
     * Get the next task to process
     */
    fetchNextRequest(): RequestTask | null {
        if (this.queue.length === 0) return null;

        const task = this.queue.shift(); // Get highest priority task
        if (task) {
            this.inProgress.add(task.uniqueKey);
            return task;
        }
        return null;
    }

    /**
     * Mark a task as successfully handled
     */
    async markRequestHandled(task: RequestTask): Promise<void> {
        this.inProgress.delete(task.uniqueKey);
        this.handled.add(task.uniqueKey);
        // Immediate persist for handled set is safer
        this.persistState();
    }

    /**
     * Reclaim a failed task (retry)
     */
    async reclaimRequest(task: RequestTask, error?: Error): Promise<void> {
        this.inProgress.delete(task.uniqueKey);

        if (task.retryCount < 3) {
            task.retryCount++;
            // Penalty: lower priority slightly or keep same? 
            // Let's push it back to queue
            this.queue.push(task);
            this.queue.sort((a, b) => b.priority - a.priority);
            console.log(`[RequestQueue] Reclaimed task (Retry ${task.retryCount}): ${task.url}`);
        } else {
            console.error(`[RequestQueue] Task failed permanently after 3 retries: ${task.url}`);
            // Optionally move to a "dead letter queue"
        }
    }

    /**
     * Persist queue state to disk
     */
    persistState(): void {
        try {
            fs.writeFileSync(this.queueFilePath, JSON.stringify(this.queue, null, 2));
            // Convert Set to Array for JSON serialization
            fs.writeFileSync(this.handledFilePath, JSON.stringify(Array.from(this.handled), null, 2));
        } catch (e) {
            console.error('[RequestQueue] Failed to persist state:', e);
        }
    }

    /**
     * Load queue state from disk
     */
    loadState(): void {
        try {
            if (fs.existsSync(this.queueFilePath)) {
                const data = fs.readFileSync(this.queueFilePath, 'utf-8');
                this.queue = JSON.parse(data);
            }
            if (fs.existsSync(this.handledFilePath)) {
                const data = fs.readFileSync(this.handledFilePath, 'utf-8');
                const handledArray = JSON.parse(data);
                this.handled = new Set(handledArray);
            }
            console.log(`[RequestQueue] Loaded state: ${this.queue.length} pending, ${this.handled.size} handled.`);
        } catch (e) {
            console.error('[RequestQueue] Failed to load state:', e);
        }
    }

    /**
     * Check if queue is empty and no tasks in progress
     */
    isFinished(): boolean {
        return this.queue.length === 0 && this.inProgress.size === 0;
    }

    /**
     * Stop the auto-persist interval
     */
    close(): void {
        if (this.persistInterval) {
            clearInterval(this.persistInterval);
            this.persistState(); // Final save
        }
    }
}
