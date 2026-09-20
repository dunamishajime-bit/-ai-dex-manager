import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileV12X1AllRunnerStateStore, type V12ActivePositionState } from "@/lib/v12-x1-all-runner-state";

function active(symbol: string, gross: number): V12ActivePositionState {
    const positionId = `position-${symbol}`;
    return {
        symbol,
        side: "LONG",
        quantity: 1,
        gross,
        baseQuantity: 1,
        baseGross: gross,
        dynamicQuantity: 0,
        dynamicGross: 0,
        positionId,
        entryPrice: 100,
        atrAtEntry: 2,
        entrySignalTs: 1,
        holdingBars: 0,
        peakPrice: 100,
        troughPrice: 100,
        protection: { strategyId: "V12_X1.00_ALL", symbol, side: "LONG", positionId, quantity: 1, entryPrice: 100, atrAtEntry: 2, initialStop: 95, lastAckStop: 95, takeProfit: 110, peakOrTrough: 100 },
    };
}

test("legacy active state migrates in memory to one activePositions row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v12-top2-state-"));
    try {
        const path = join(dir, "state.json");
        const legacy = active("ETHUSDT", 1);
        await writeFile(path, JSON.stringify({ schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: 1, active: legacy }));
        const loaded = await new FileV12X1AllRunnerStateStore(path, "LIVE").load();
        assert.deepEqual(loaded.activePositions, [legacy]);
        assert.equal(loaded.active?.positionId, legacy.positionId);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test("three distinct positions persist but duplicate, fourth, or aggregate over-cap fail closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v12-top2-state-"));
    try {
        const path = join(dir, "state.json");
        const store = new FileV12X1AllRunnerStateStore(path, "LIVE");
        const first = active("ETHUSDT", 1);
        const second = active("SOLUSDT", 0.5);
        const third = { ...active("LINKUSDT", 0.1), entryRank: 3 as const, baseQuantity: 0, baseGross: 0, dynamicQuantity: 1, dynamicGross: 0.1 };
        await store.save({ schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: 1, active: first, activePositions: [first, second, third] });
        assert.equal((await store.load()).activePositions?.length, 3);
        const thirdBase = active("LINKUSDT", 0.1);
        const secondRank3 = { ...active("AAVEUSDT", 0.05), entryRank: 3 as const, baseQuantity: 0, baseGross: 0, dynamicQuantity: 1, dynamicGross: 0.05 };
        const oversizedRank3 = { ...third, gross: 0.11, dynamicGross: 0.11 };
        for (const invalid of [[first, first], [first, second, third, active("AAVEUSDT", 0.1)], [first, active("SOLUSDT", 0.51), third], [first, second, thirdBase], [first, third, secondRank3], [first, second, oversizedRank3]]) {
            await writeFile(path, JSON.stringify({ schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: 1, active: first, activePositions: invalid }));
            await assert.rejects(() => store.load(), /V12_STATE_/);
        }
    } finally { await rm(dir, { recursive: true, force: true }); }
});
