"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setShouldStopScraping = setShouldStopScraping;
exports.getShouldStopScraping = getShouldStopScraping;
exports.resetShouldStopScraping = resetShouldStopScraping;
/**
 * Lightweight shared stop-flag utilities.
 * Decouples stop-signal state from server bootstrap so it can be reused without side effects.
 */
let shouldStopScraping = false;
function setShouldStopScraping(value) {
    shouldStopScraping = value;
}
function getShouldStopScraping() {
    return shouldStopScraping;
}
function resetShouldStopScraping() {
    shouldStopScraping = false;
}
