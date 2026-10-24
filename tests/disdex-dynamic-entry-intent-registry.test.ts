import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileDynamicEntryIntentRegistry } from "../lib/disdex-dynamic-entry-intent-registry";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";

test("cycle allocation is idempotent and ignores expired intents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-intent-registry-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"), 1_000);
        await registry.submit({ cycleId: "cycle-1", id: "fresh", strategy: "V12", symbol: "ETHUSDT", side: "LONG", assetClass: "CRYPTO", marketFitScore: 4, targetGross: 0.2, minGross: 0.1, maxGross: 0.2, apiKey: "must-not-persist" } as never, 10_000);
        assert.equal((await readFile(join(dir, "intents.json"), "utf8")).includes("must-not-persist"), false);
        await registry.submit({ cycleId: "cycle-1", id: "expired", strategy: "V12", symbol: "BTCUSDT", side: "LONG", assetClass: "CRYPTO", marketFitScore: 9, targetGross: 0.2, minGross: 0.1, maxGross: 0.2 }, 8_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const first = await registry.allocateCycle({ cycleId: "cycle-1", now: 10_000, cryptoGrossAvailable: 0.2, stockGrossAvailable: 0, totalGrossAvailable: 0.2, equityUsd: 1_000, lock });
        const again = await registry.allocateCycle({ cycleId: "cycle-1", now: 10_000, cryptoGrossAvailable: 0, stockGrossAvailable: 0, totalGrossAvailable: 0, equityUsd: 1_000, lock });
        assert.deepEqual(again, first);
        assert.deepEqual(first.allocations.map(({ id }) => id), ["fresh"]);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("competing allocator claims publish only one bounded decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-intent-claim-"));
    try {
        const path = join(dir, "intents.json");
        const a = new FileDynamicEntryIntentRegistry(path);
        const b = new FileDynamicEntryIntentRegistry(path);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const intent = (id: string) => ({ cycleId: "same", id, strategy: "V12", symbol: `${id}USDT`, side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 3, targetGross: 0.8, minGross: 0.2, maxGross: 0.8 });
        await a.submit(intent("a"), 20_000);
        await b.submit(intent("b"), 20_000);
        const [left, right] = await Promise.all([
            a.allocateCycle({ cycleId: "same", now: 20_000, cryptoGrossAvailable: 0.5, stockGrossAvailable: 0.2, totalGrossAvailable: 0.6, equityUsd: 1_000, lock, strategyGrossAvailable: { V12: 0.3 } }),
            b.allocateCycle({ cycleId: "same", now: 20_000, cryptoGrossAvailable: 0.5, stockGrossAvailable: 0.2, totalGrossAvailable: 0.6, equityUsd: 1_000, lock, strategyGrossAvailable: { V12: 0.3 } }),
        ]);
        assert.equal(left.decisionId, right.decisionId);
        assert.deepEqual(left, right);
        assert.ok(left.allocations.reduce((n, row) => n + row.allocatedGross, 0) <= 0.6 + 1e-9);
        assert.ok(left.allocations.reduce((n, row) => n + row.allocatedGross, 0) <= 0.3 + 1e-9);
        assert.equal((await lock.document()).reservations.filter((row) => row.status === "RESERVED").length, 1);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
