import assert from "node:assert/strict";
import test from "node:test";

import { buildQuality102CausalV4Signal } from "../lib/disdex-quality102-causal-v4-signal";
import type { Quality102Candle } from "../lib/disdex-quality102-causal-pipeline";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 5, 13, 0, 5);
const ENTRY_TS = Math.floor(NOW / HOUR) * HOUR;

function signalInput(occupancy: { activePosition: boolean; unresolvedPendingEntry: boolean; basePositionActive: boolean }) {
    const count = 181 * 24;
    const start = ENTRY_TS - count * HOUR;
    const rows: Quality102Candle[] = Array.from({ length: count }, (_, index) => ({
        timestampMs: start + index * HOUR,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        quoteVolume: 1000,
        baseVolume: 100,
    }));
    rows[rows.length - 25] = { ...rows[rows.length - 25], close: 100 };
    rows[rows.length - 1] = { ...rows[rows.length - 1], close: 94, high: 101, low: 94 };
    return {
        history: {
            candlesBySymbol: { FETUSDT: rows },
            entryOpenBySymbol: { FETUSDT: { timestampMs: ENTRY_TS, open: 125 } },
        },
        decisionTs: NOW,
        sleeveOccupancy: occupancy,
    };
}

test("causal V4 keeps a natural signal when only a base sleeve is active", () => {
    const result = buildQuality102CausalV4Signal(signalInput({
        activePosition: false,
        unresolvedPendingEntry: false,
        basePositionActive: true,
    }));
    assert.equal(result.side, 1);
    assert.equal(result.symbol, "FETUSDT");
});

test("causal V4 still blocks its own active position or unresolved pending entry", () => {
    for (const occupancy of [
        { activePosition: true, unresolvedPendingEntry: false, basePositionActive: false },
        { activePosition: false, unresolvedPendingEntry: true, basePositionActive: false },
    ]) {
        const result = buildQuality102CausalV4Signal(signalInput(occupancy));
        assert.equal(result.side, 0);
        assert.equal(result.reason, "QUALITY102_CAUSAL_V1_SLOT_OCCUPIED");
    }
});
