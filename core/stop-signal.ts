/**
 * Lightweight shared stop-flag utilities.
 * Decouples stop-signal state from server bootstrap so it can be reused without side effects.
 */
let shouldStopScraping = false;

export function setShouldStopScraping(value: boolean): void {
    shouldStopScraping = value;
}

export function getShouldStopScraping(): boolean {
    return shouldStopScraping;
}

export function resetShouldStopScraping(): void {
    shouldStopScraping = false;
}
