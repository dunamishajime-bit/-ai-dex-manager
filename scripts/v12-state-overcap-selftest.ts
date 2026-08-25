import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    FileV12X1AllRunnerStateStore,
    v12ActivePositionsAggregateGross,
    v12ExistingAggregateGrossOverCap,
    type V12X1AllRunnerState,
} from "../lib/v12-x1-all-runner-state";

function active(symbol: string, positionId: string, gross: number) {
    return {
        symbol,
        side: "LONG" as const,
        quantity: 1,
        gross,
        positionId,
        entryPrice: 100,
        atrAtEntry: 2,
        entrySignalTs: 1,
        holdingBars: 1,
        peakPrice: 100,
        troughPrice: 100,
        protection: {
            strategyId: "V12_X1.00_ALL" as const,
            symbol,
            side: "LONG" as const,
            positionId,
            quantity: 1,
            entryPrice: 100,
            atrAtEntry: 2,
            initialStop: 96,
            lastAckStop: 96,
            takeProfit: 104,
            peakOrTrough: 100,
        },
    };
}

async function main() {
    const root = await mkdtemp(join(tmpdir(), "disdex-v12-state-overcap-"));
    try {
        const store = new FileV12X1AllRunnerStateStore(join(root, "runner.json"), "LIVE");
        const state: V12X1AllRunnerState = {
            schema: "v12-x1-all-runner-state/v1",
            strategyId: "V12_X1.00_ALL",
            mode: "LIVE",
            updatedAt: Date.now(),
            activePositions: [active("BNBUSDT", "b", 1), active("SOLUSDT", "s", 0.5692652358793715)],
        };
        await store.save(state);
        const loaded = await store.load();
        assert.equal(v12ActivePositionsAggregateGross(loaded), 1.5692652358793715);
        assert.equal(v12ExistingAggregateGrossOverCap(loaded), true);
        assert.equal(loaded.activePositions?.length, 2);
        assert.equal(loaded.activePositions?.[0]?.symbol, "BNBUSDT");
        console.log("V12_STATE_OVERCAP_SELFTEST_PASS", JSON.stringify({ ordersSent: 0, positionChangesSent: 0, aggregateGross: v12ActivePositionsAggregateGross(loaded), entryBlocked: true }));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
