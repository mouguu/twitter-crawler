import { EventEmitter } from 'events';

export interface ScrapeProgressData {
    current: number;
    target: number;
    action: string;
    [key: string]: any;
}

export interface ScrapeCompleteData {
    count: number;
    outputDir: string;
    [key: string]: any;
}

export interface PerformanceUpdateData {
    stats: any;
}

export interface LogMessageData {
    message: string;
    level: string;
    timestamp: Date;
}

export class ScraperEventBus extends EventEmitter {
    public events: {
        SCRAPE_PROGRESS: string;
        SCRAPE_COMPLETE: string;
        SCRAPE_ERROR: string;
        LOG_MESSAGE: string;
        PERFORMANCE_UPDATE: string;
    };

    constructor() {
        super();
        this.events = {
            SCRAPE_PROGRESS: 'scrape:progress',
            SCRAPE_COMPLETE: 'scrape:complete',
            SCRAPE_ERROR: 'scrape:error',
            LOG_MESSAGE: 'log:message',
            PERFORMANCE_UPDATE: 'performance:update'
        };
    }

    emitProgress(data: ScrapeProgressData): void {
        this.emit(this.events.SCRAPE_PROGRESS, data);
    }

    emitComplete(data: ScrapeCompleteData): void {
        this.emit(this.events.SCRAPE_COMPLETE, data);
    }

    emitError(error: Error): void {
        this.emit(this.events.SCRAPE_ERROR, error);
    }

    emitLog(message: string, level: string = 'info'): void {
        this.emit(this.events.LOG_MESSAGE, { message, level, timestamp: new Date() });
    }

    emitPerformance(data: PerformanceUpdateData): void {
        this.emit(this.events.PERFORMANCE_UPDATE, data);
    }
}

export function createEventBus(): ScraperEventBus {
    return new ScraperEventBus();
}

export default new ScraperEventBus();
