import assert from "node:assert/strict";
import test from "node:test";

import { QUALITY102_HOUR_MS } from "../lib/disdex-quality102-causal-pipeline";
import { quality102EntryOpenRange } from "../lib/disdex-quality102-causal-v1-market-data";

test("Q102 entry-open range has a non-empty one-hour server query window", () => {
    const startTime = Date.parse("2026-09-06T08:00:00.000Z");
    assert.deepEqual(quality102EntryOpenRange(startTime), {
        startTime,
        endTime: startTime + QUALITY102_HOUR_MS - 1,
    });
});

test("Q102 entry-open range rejects invalid timestamps", () => {
    assert.throws(() => quality102EntryOpenRange(0), /QUALITY102_INVALID_ENTRY_OPEN_TIMESTAMP/);
    assert.throws(() => quality102EntryOpenRange(Number.NaN), /QUALITY102_INVALID_ENTRY_OPEN_TIMESTAMP/);
});
