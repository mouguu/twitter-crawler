"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stop_signal_1 = require("../../core/stop-signal");
describe('stop-signal', () => {
    afterEach(() => {
        (0, stop_signal_1.resetShouldStopScraping)();
    });
    test('defaults to false and can be toggled', () => {
        expect((0, stop_signal_1.getShouldStopScraping)()).toBe(false);
        (0, stop_signal_1.setShouldStopScraping)(true);
        expect((0, stop_signal_1.getShouldStopScraping)()).toBe(true);
    });
    test('reset clears the flag', () => {
        (0, stop_signal_1.setShouldStopScraping)(true);
        (0, stop_signal_1.resetShouldStopScraping)();
        expect((0, stop_signal_1.getShouldStopScraping)()).toBe(false);
    });
});
