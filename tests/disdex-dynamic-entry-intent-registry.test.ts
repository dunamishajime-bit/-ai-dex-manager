import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileDynamicEntryIntentRegistry } from "../lib/disdex-dynamic-entry-intent-registry";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";

function capsFor(...intents: Array<{ strategy: string; symbol: string; side: "LONG" | "SHORT" }>) {
    return {
        strategyGrossAvailable: Object.fromEntries([...new Set(intents.map((intent) => intent.strategy))].map((strategy) => [strategy, 1])),
        positionGrossAvailable: Object.fromEntries(intents.map((intent) => [`${intent.strategy}|${intent.symbol.toUpperCase()}|${intent.side}`, 1])),
    };
}

test("cycle allocation is idempotent and ignores expired intents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-intent-registry-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"), 1_000);
        await registry.submit({ cycleId: "cycle-1", id: "fresh", strategy: "V12", symbol: "ETHUSDT", side: "LONG", assetClass: "CRYPTO", marketFitScore: 4, targetGross: 0.2, minGross: 0.1, maxGross: 0.2, apiKey: "must-not-persist" } as never, 10_000);
        assert.equal((await readFile(join(dir, "intents.json"), "utf8")).includes("must-not-persist"), false);
        await registry.submit({ cycleId: "cycle-1", id: "expired", strategy: "V12", symbol: "BTCUSDT", side: "LONG", assetClass: "CRYPTO", marketFitScore: 9, targetGross: 0.2, minGross: 0.1, maxGross: 0.2 }, 8_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const capInputs = capsFor({ strategy: "V12", symbol: "ETHUSDT", side: "LONG" });
        const first = await registry.allocateCycle({ cycleId: "cycle-1", now: 10_000, cryptoGrossAvailable: 0.2, stockGrossAvailable: 0, totalGrossAvailable: 0.2, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs });
        const again = await registry.allocateCycle({ cycleId: "cycle-1", now: 10_000, cryptoGrossAvailable: 0, stockGrossAvailable: 0, totalGrossAvailable: 0, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs });
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
        const capInputs = capsFor({ strategy: "V12", symbol: "aUSDT", side: "LONG" }, { strategy: "V12", symbol: "bUSDT", side: "LONG" });
        capInputs.strategyGrossAvailable.V12 = 0.3;
        const [left, right] = await Promise.all([
            a.allocateCycle({ cycleId: "same", now: 20_000, cryptoGrossAvailable: 0.5, stockGrossAvailable: 0.2, totalGrossAvailable: 0.6, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs }),
            b.allocateCycle({ cycleId: "same", now: 20_000, cryptoGrossAvailable: 0.5, stockGrossAvailable: 0.2, totalGrossAvailable: 0.6, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs }),
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

test("historical QUALITY102 is rejected before reservation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-quality102-block-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "quality102", id: "q102", strategy: "QUALITY102", symbol: "SOLUSDT", side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 8, targetGross: 0.5, minGross: 0.1, maxGross: 0.5 };
        await registry.submit(intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: "quality102", now: 30_000, cryptoGrossAvailable: 1, stockGrossAvailable: 0, totalGrossAvailable: 1, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capsFor(intent) }), /QUALITY102_LIVE_BLOCKED_FAIL_CLOSED/);
        assert.equal((await lock.document()).reservations.length, 0);
        assert.equal((await readPendingExposureRegistry(join(dir, "pending.json"))).entries.length, 0);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("causal-v1 is rejected before reservation when readiness is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-causal-not-ready-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "causal-not-ready", id: "causal", strategy: "QUALITY102_CAUSAL_V1", symbol: "SOLUSDT", side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 8, targetGross: 0.5, minGross: 0.1, maxGross: 0.5 };
        await registry.submit(intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: "causal-not-ready", now: 30_000, cryptoGrossAvailable: 1, stockGrossAvailable: 0, totalGrossAvailable: 1, equityUsd: 1_000, lock, quality102CausalV1Ready: false, ...capsFor(intent) }), /QUALITY102_CAUSAL_V1_NOT_READY/);
        assert.equal((await lock.document()).reservations.length, 0);
        assert.equal((await readPendingExposureRegistry(join(dir, "pending.json"))).entries.length, 0);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("registry fails closed when authoritative strategy and position caps are omitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-cap-inputs-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "missing-caps", id: "v12", strategy: "V12", symbol: "ETHUSDT", side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 4, targetGross: 0.5, minGross: 0.1, maxGross: 0.5 };
        await registry.submit(intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: "missing-caps", now: 30_000, cryptoGrossAvailable: 1, stockGrossAvailable: 0, totalGrossAvailable: 1, equityUsd: 1_000, lock, quality102CausalV1Ready: true } as never), /DYNAMIC_ENTRY_AUTHORITATIVE_CAPS_REQUIRED/);
        assert.equal((await lock.document()).reservations.length, 0);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("registry fails closed when a candidate cap entry is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-cap-entry-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "missing-cap-entry", id: "v12", strategy: "V12", symbol: "ETHUSDT", side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 4, targetGross: 0.5, minGross: 0.1, maxGross: 0.5 };
        await registry.submit(intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: "missing-cap-entry", now: 30_000, cryptoGrossAvailable: 1, stockGrossAvailable: 0, totalGrossAvailable: 1, equityUsd: 1_000, lock, quality102CausalV1Ready: true, strategyGrossAvailable: {}, positionGrossAvailable: {} }), /DYNAMIC_ENTRY_AUTHORITATIVE_CAP_MISSING/);
        assert.equal((await lock.document()).reservations.length, 0);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("stock allocation records STOCK in the account reservation and pending exposure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-stock-reservation-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "stock-cycle", id: "v52", strategy: "V52", symbol: "NVDAUSDT", side: "LONG" as const, assetClass: "STOCK" as const, marketFitScore: 6, targetGross: 0.4, minGross: 0.1, maxGross: 0.4 };
        await registry.submit(intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const decision = await registry.allocateCycle({ cycleId: "stock-cycle", now: 30_000, cryptoGrossAvailable: 0, stockGrossAvailable: 0.4, totalGrossAvailable: 0.4, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capsFor(intent) });
        assert.equal(decision.allocations[0]?.assetClass, "STOCK");
        assert.equal((await lock.document()).reservations[0]?.sleeve, "STOCK");
        assert.equal((await readPendingExposureRegistry(join(dir, "pending.json"))).entries[0]?.sleeve, "STOCK");
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
