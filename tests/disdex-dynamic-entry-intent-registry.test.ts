import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileDynamicEntryIntentRegistry } from "../lib/disdex-dynamic-entry-intent-registry";
import { deriveAccountReservationId, FileAccountOrderLock, type AccountReservationInput } from "../lib/disdex-account-order-lock";
import { readPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";
import { createStrictEntryApproval } from "../lib/disdex-strict-entry-approval";

function capsFor(...intents: Array<{ strategy: string; symbol: string; side: "LONG" | "SHORT" }>) {
    return {
        strategyGrossAvailable: Object.fromEntries([...new Set(intents.map((intent) => intent.strategy))].map((strategy) => [strategy, 1])),
        positionGrossAvailable: Object.fromEntries(intents.map((intent) => [`${intent.strategy}|${intent.symbol.toUpperCase()}|${intent.side}`, 1])),
    };
}

function withTestMetadata(intent: any, submittedAt: number) {
    return { ...intent, signalTs: intent.signalTs ?? submittedAt, idempotencyKey: intent.idempotencyKey ?? intent.id };
}

async function submitIntent(registry: FileDynamicEntryIntentRegistry, intent: any, submittedAt: number) {
    return registry.submit(withTestMetadata(intent, submittedAt), submittedAt);
}

function approvalFor(intent: any, now: number, activePositions: any[] = []) {
    const candidate = withTestMetadata(intent, now);
    const accepted = {
        idempotencyKey: candidate.idempotencyKey,
        strategy: candidate.strategy,
        symbol: candidate.symbol,
        side: candidate.side,
        signalTs: candidate.signalTs,
        gross: candidate.targetGross,
        notionalUsd: candidate.targetGross * 1_000,
        minGross: candidate.minGross,
        maxGross: candidate.maxGross,
    } as any;
    const plan = {
        status: "planned" as const,
        accepted: [accepted],
        rejected: [],
        reductions: [],
        activePositions,
        equityAfterReductions: 1_000,
        totals: { totalGross: candidate.targetGross, cryptoGross: candidate.assetClass === "CRYPTO" ? candidate.targetGross : 0, stockGross: candidate.assetClass === "STOCK" ? candidate.targetGross : 0 },
    };
    return createStrictEntryApproval({
        cycleId: candidate.cycleId,
        candidate,
        plan,
        now,
        maxAgeMs: 30_000,
        snapshot: {
            capturedAt: now,
            account: { equityUsd: 1_000, availableBalanceUsd: 1_000, updatedAt: now },
            positions: activePositions, openOrders: [], pendingReservationIds: [],
            entryCeiling: { cryptoGrossCap: 3, totalGrossCap: 4.25 },
            sharedDailyRisk: { schema: "disdex-shared-crypto-daily-risk/v1", accountScope: "ASTER_FUTURES", updatedAt: now, tripped: false, sourceComplete: true },
            portfolioDdGovernor: { schema: "disdex-portfolio-dd-governor/v1", updatedAt: now, currentDrawdownPct: 0, twrIndex: 1, twrPeak: 1 },
            unmanagedOpenOrders: { checkedAt: now, count: 0 },
            marginGuard: { checkedAt: now, healthy: true },
            protectiveStops: { checkedAt: now, requiredPositionIds: [], verifiedPositionIds: [] },
        },
    });
}

test("registry decision retains causal producer identity and score provenance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-intent-metadata-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "idle-cycle", id: "idle-key", idempotencyKey: "idle-key", signalTs: 10_000,
            strategy: "IDLE_PRIORITY_SHORT", symbol: "ETHUSDT", side: "SHORT" as const,
            assetClass: "CRYPTO" as const, marketFitScore: 7, scoreSource: "IDLE_COMPLETED_REL24_RET12_V1",
            targetGross: 0.3, minGross: 0.1, maxGross: 0.3 };
        const submitted = await submitIntent(registry, intent, 10_050);
        assert.equal(submitted.signalTs, 10_000);
        assert.equal(submitted.idempotencyKey, "idle-key");
        assert.equal(submitted.scoreSource, "IDLE_COMPLETED_REL24_RET12_V1");
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const decision = await registry.allocateCycle({ cycleId: intent.cycleId, now: 10_050,
            cryptoGrossAvailable: 0.3, stockGrossAvailable: 0, totalGrossAvailable: 0.3,
            equityUsd: 1_000, lock, quality102CausalV1Ready: false, ...capsFor(intent), strictPlannerApprovals: [approvalFor(intent, 10_050)] });
        assert.equal(decision.allocations[0]?.signalTs, 10_000);
        assert.equal(decision.allocations[0]?.idempotencyKey, "idle-key");
        assert.equal(decision.approvalSource, "REGISTRY_ALLOCATION");
        const pending = await readPendingExposureRegistry(join(dir, "pending.json"));
        assert.equal(decision.allocations[0]?.reservationId, pending.entries[0]?.reservationId);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("registry refuses reservation without a current strict planner approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-strict-approval-required-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "strict-required", id: "idle-key", strategy: "IDLE_PRIORITY_SHORT", symbol: "ETHUSDT", side: "SHORT" as const,
            assetClass: "CRYPTO" as const, marketFitScore: 7, targetGross: 0.3, minGross: 0.1, maxGross: 0.3 };
        await submitIntent(registry, intent, 10_050);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: intent.cycleId, now: 10_050,
            cryptoGrossAvailable: 0.3, stockGrossAvailable: 0, totalGrossAvailable: 0.3,
            equityUsd: 1_000, lock, quality102CausalV1Ready: false, ...capsFor(intent), strictPlannerApprovals: [] }), /DYNAMIC_ENTRY_STRICT_APPROVAL_REQUIRED/);
        assert.equal((await lock.document()).reservations.length, 0);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("cycle allocation is idempotent and ignores expired intents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-intent-registry-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"), 1_000);
        const freshIntent = { cycleId: "cycle-1", id: "fresh", strategy: "V12", symbol: "ETHUSDT", side: "LONG", assetClass: "CRYPTO", marketFitScore: 4, targetGross: 0.2, minGross: 0.1, maxGross: 0.2, apiKey: "must-not-persist" } as never;
        await submitIntent(registry, freshIntent, 10_000);
        assert.equal((await readFile(join(dir, "intents.json"), "utf8")).includes("must-not-persist"), false);
        const expiredIntent = { cycleId: "cycle-1", id: "expired", strategy: "V12", symbol: "BTCUSDT", side: "LONG", assetClass: "CRYPTO", marketFitScore: 9, targetGross: 0.2, minGross: 0.1, maxGross: 0.2 };
        await submitIntent(registry, expiredIntent, 8_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const capInputs = capsFor({ strategy: "V12", symbol: "ETHUSDT", side: "LONG" });
        const first = await registry.allocateCycle({ cycleId: "cycle-1", now: 10_000, cryptoGrossAvailable: 0.2, stockGrossAvailable: 0, totalGrossAvailable: 0.2, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs, strictPlannerApprovals: [approvalFor(freshIntent, 10_000)] });
        const again = await registry.allocateCycle({ cycleId: "cycle-1", now: 10_000, cryptoGrossAvailable: 0, stockGrossAvailable: 0, totalGrossAvailable: 0, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs, strictPlannerApprovals: [approvalFor(freshIntent, 10_000)] });
        assert.deepEqual(again, first);
        assert.deepEqual(first.allocations.map(({ id }) => id), ["fresh"]);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("competing native strict approvals are never resized at reservation time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-intent-claim-"));
    try {
        const path = join(dir, "intents.json");
        const a = new FileDynamicEntryIntentRegistry(path);
        const b = new FileDynamicEntryIntentRegistry(path);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const intent = (id: string) => ({ cycleId: "same", id, strategy: "V12", symbol: `${id}USDT`, side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 3, targetGross: 0.8, minGross: 0.2, maxGross: 0.8 });
        await submitIntent(a, intent("a"), 20_000);
        await submitIntent(b, intent("b"), 20_000);
        const capInputs = capsFor({ strategy: "V12", symbol: "aUSDT", side: "LONG" }, { strategy: "V12", symbol: "bUSDT", side: "LONG" });
        capInputs.strategyGrossAvailable.V12 = 0.3;
        const [left, right] = await Promise.all([
            a.allocateCycle({ cycleId: "same", now: 20_000, cryptoGrossAvailable: 0.5, stockGrossAvailable: 0.2, totalGrossAvailable: 0.6, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs, strictPlannerApprovals: [approvalFor(intent("a"), 20_000), approvalFor(intent("b"), 20_000)] }),
            b.allocateCycle({ cycleId: "same", now: 20_000, cryptoGrossAvailable: 0.5, stockGrossAvailable: 0.2, totalGrossAvailable: 0.6, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capInputs, strictPlannerApprovals: [approvalFor(intent("a"), 20_000), approvalFor(intent("b"), 20_000)] }),
        ]);
        assert.equal(left.decisionId, right.decisionId);
        assert.deepEqual(left, right);
        assert.ok(left.allocations.reduce((n, row) => n + row.allocatedGross, 0) <= 0.6 + 1e-9);
        assert.ok(left.allocations.reduce((n, row) => n + row.allocatedGross, 0) <= 0.3 + 1e-9);
        assert.equal(left.allocations.length, 0);
        assert.equal((await lock.document()).reservations.filter((row) => row.status === "RESERVED").length, 0);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("normal reservation exception releases acquired rows and closes the journal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-reservation-exception-"));
    try {
        const path = join(dir, "intents.json");
        const registry = new FileDynamicEntryIntentRegistry(path);
        const first = { cycleId: "exception", id: "a", strategy: "V12", symbol: "ETHUSDT", side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 3, targetGross: 0.3, minGross: 0.1, maxGross: 0.3 };
        const second = { cycleId: "exception", id: "b", strategy: "V12", symbol: "BTCUSDT", side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 2, targetGross: 0.3, minGross: 0.1, maxGross: 0.3 };
        await submitIntent(registry, first, 50_000);
        await submitIntent(registry, second, 50_000);
        const released: string[] = [];
        let reservations = 0;
        const lock = {
            document: async () => ({ schema: "disdex-account-lock/v1", accountScope: "ASTER_FUTURES", ownerId: "test-owner", leaseId: "lease", acquiredAt: 50_000, expiresAt: 60_000, reservations: [] }),
            reserve: async (input: AccountReservationInput) => {
                reservations += 1;
                if (reservations === 2) throw new Error("TEST_RESERVE_FAILURE");
                return { ...input, reservationId: deriveAccountReservationId("lease", input), createdAt: 50_000, status: "RESERVED" as const };
            },
            releaseReservation: async (id: string) => { released.push(id); },
        } as any;
        await assert.rejects(() => registry.allocateCycle({ cycleId: "exception", now: 50_000, cryptoGrossAvailable: 0.6, stockGrossAvailable: 0, totalGrossAvailable: 0.6, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capsFor(first, second), strictPlannerApprovals: [approvalFor(first, 50_000), approvalFor(second, 50_000)] }), /TEST_RESERVE_FAILURE/);
        assert.equal(released.length, 2); // Includes an ID reserved before the call that threw.
        const persisted = JSON.parse(await readFile(path, "utf8"));
        assert.deepEqual(new Set(released), new Set(persisted.reservations.map((row: { reservationId: string }) => row.reservationId)));
        assert.equal(persisted.reservations.every((row: { status: string }) => row.status === "RELEASED"), true);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("historical QUALITY102 is rejected before reservation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-quality102-block-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const intent = { cycleId: "quality102", id: "q102", strategy: "QUALITY102", symbol: "SOLUSDT", side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 8, targetGross: 0.5, minGross: 0.1, maxGross: 0.5 };
        await submitIntent(registry, intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: "quality102", now: 30_000, cryptoGrossAvailable: 1, stockGrossAvailable: 0, totalGrossAvailable: 1, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capsFor(intent), strictPlannerApprovals: [] }), /QUALITY102_LIVE_BLOCKED_FAIL_CLOSED/);
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
        await submitIntent(registry, intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: "causal-not-ready", now: 30_000, cryptoGrossAvailable: 1, stockGrossAvailable: 0, totalGrossAvailable: 1, equityUsd: 1_000, lock, quality102CausalV1Ready: false, ...capsFor(intent), strictPlannerApprovals: [] }), /QUALITY102_CAUSAL_V1_NOT_READY/);
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
        await submitIntent(registry, intent, 30_000);
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
        await submitIntent(registry, intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({ cycleId: "missing-cap-entry", now: 30_000, cryptoGrossAvailable: 1, stockGrossAvailable: 0, totalGrossAvailable: 1, equityUsd: 1_000, lock, quality102CausalV1Ready: true, strategyGrossAvailable: {}, positionGrossAvailable: {}, strictPlannerApprovals: [] }), /DYNAMIC_ENTRY_AUTHORITATIVE_CAP_MISSING/);
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
        await submitIntent(registry, intent, 30_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const decision = await registry.allocateCycle({ cycleId: "stock-cycle", now: 30_000, cryptoGrossAvailable: 0, stockGrossAvailable: 0.4, totalGrossAvailable: 0.4, equityUsd: 1_000, lock, quality102CausalV1Ready: true, ...capsFor(intent), strictPlannerApprovals: [approvalFor(intent, 30_000)] });
        assert.equal(decision.allocations[0]?.assetClass, "STOCK");
        assert.equal((await lock.document()).reservations[0]?.sleeve, "STOCK");
        assert.equal((await readPendingExposureRegistry(join(dir, "pending.json"))).entries[0]?.sleeve, "STOCK");
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("restart reconciliation releases only an orphan with fresh no-live evidence and preserves a potentially live reservation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-reservation-reconcile-"));
    try {
        const registryPath = join(dir, "intents.json");
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const safe = await lock.reserve({ strategyId: "V12", symbol: "ETHUSDT", side: "LONG", sleeve: "CRYPTO", gross: 0.1, notionalUsd: 100 });
        const live = await lock.reserve({ strategyId: "V12", symbol: "BTCUSDT", side: "LONG", sleeve: "CRYPTO", gross: 0.1, notionalUsd: 100 });
        await writeFile(registryPath, JSON.stringify({
            schema: "disdex-dynamic-entry-intents/v1", intents: [], decisions: [], reservations: [
                { reservationKey: "safe-key", cycleId: "safe-cycle", intentId: "safe", strategy: "V12", symbol: "ETHUSDT", side: "LONG", assetClass: "CRYPTO", gross: 0.1, notionalUsd: 100, status: "RESERVATION_PENDING", createdAt: 40_000, updatedAt: 40_000, reservationId: safe.reservationId, strictApprovalToken: "safe-token" },
                { reservationKey: "live-key", cycleId: "live-cycle", intentId: "live", strategy: "V12", symbol: "BTCUSDT", side: "LONG", assetClass: "CRYPTO", gross: 0.1, notionalUsd: 100, status: "RESERVATION_PENDING", createdAt: 40_000, updatedAt: 40_000, reservationId: live.reservationId, strictApprovalToken: "live-token" },
            ],
        }), "utf8");
        const result = await new FileDynamicEntryIntentRegistry(registryPath).reconcileReservations({
            now: 40_100,
            lock,
            evidenceFor: (record) => ({
                capturedAt: 40_100,
                accountSnapshotFresh: true,
                openOrdersSnapshotFresh: true,
                pendingExposureSnapshotFresh: true,
                protectionSnapshotFresh: true,
                liveOrder: record.symbol === "BTCUSDT",
                livePosition: false,
                pendingExposure: record.symbol === "BTCUSDT",
                unmanagedOpenOrders: 0,
                protectiveStopsVerified: true,
            }),
        });
        assert.deepEqual(result.map((row) => row.status), ["RELEASED", "REQUIRES_REVIEW"]);
        const lockDocument = await lock.document();
        assert.equal(lockDocument.reservations.find((row) => row.reservationId === safe.reservationId)?.status, "RELEASED");
        assert.equal(lockDocument.reservations.find((row) => row.reservationId === live.reservationId)?.status, "RESERVED");
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("durable journal records deterministic ID before reserve, and exception after lock write releases it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-durable-crash-window-"));
    try {
        const path = join(dir, "intents.json");
        const registry = new FileDynamicEntryIntentRegistry(path);
        const intent = { cycleId: "crash-window", id: "a", strategy: "V12", symbol: "ETHUSDT", side: "LONG" as const,
            assetClass: "CRYPTO" as const, marketFitScore: 5, targetGross: 0.3, minGross: 0.1, maxGross: 0.3 };
        await submitIntent(registry, intent, 50_000);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        let persistedId = "";
        const interrupted = {
            ...lock,
            reserve: async (input: AccountReservationInput) => {
                const rows = JSON.parse(await readFile(path, "utf8")).reservations;
                assert.equal(rows.length, 1);
                persistedId = rows[0].reservationId;
                assert.equal(persistedId, deriveAccountReservationId(lock.leaseId, input));
                await lock.reserve(input); // Both account lock and pending exposure have been written.
                throw new Error("SIMULATED_CRASH_AFTER_RESERVE_WRITE");
            },
        };
        await assert.rejects(() => registry.allocateCycle({
            cycleId: intent.cycleId, now: 50_000, cryptoGrossAvailable: 0.3, stockGrossAvailable: 0,
            totalGrossAvailable: 0.3, equityUsd: 1_000, lock: interrupted,
            quality102CausalV1Ready: true, ...capsFor(intent), strictPlannerApprovals: [approvalFor(intent, 50_000)],
        }), /SIMULATED_CRASH_AFTER_RESERVE_WRITE/);
        assert.ok(persistedId);
        const record = JSON.parse(await readFile(path, "utf8")).reservations[0];
        assert.equal(record.reservationId, persistedId);
        assert.equal(record.status, "RELEASED");
        assert.equal((await lock.document()).reservations.find((row) => row.reservationId === persistedId)?.status, "RELEASED");
        assert.equal((await readPendingExposureRegistry(join(dir, "pending.json"))).entries.some((row) =>
            row.reservationId === persistedId && row.status !== "RELEASED"), false);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("legacy unresolved journal without reservation ID remains REQUIRES_REVIEW even with fresh no-live evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-legacy-missing-id-"));
    try {
        const path = join(dir, "intents.json");
        await writeFile(path, JSON.stringify({
            schema: "disdex-dynamic-entry-intents/v1", intents: [], decisions: [],
            reservations: [{ reservationKey: "unknown", cycleId: "legacy", intentId: "a",
                strategy: "V12", symbol: "ETHUSDT", side: "LONG", assetClass: "CRYPTO",
                gross: 0.3, notionalUsd: 300, status: "RESERVATION_PENDING",
                createdAt: 30_000, updatedAt: 30_000, strictApprovalToken: "old" }],
        }));
        const registry = new FileDynamicEntryIntentRegistry(path);
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const results = await registry.reconcileReservations({ now: 30_100, lock, evidenceFor: () => ({
            capturedAt: 30_100, accountSnapshotFresh: true, openOrdersSnapshotFresh: true,
            pendingExposureSnapshotFresh: true, protectionSnapshotFresh: true,
            liveOrder: false, livePosition: false, pendingExposure: false,
            unmanagedOpenOrders: 0, protectiveStopsVerified: true,
        }) });
        assert.equal(results[0]?.status, "REQUIRES_REVIEW");
        assert.equal(results[0]?.reason, "RECONCILIATION_RESERVATION_ID_UNKNOWN");
        assert.equal(JSON.parse(await readFile(path, "utf8")).reservations[0].status, "REQUIRES_REVIEW");
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("reservation identity is distinct between cycles with otherwise identical orders", () => {
    const request = { reservationKey: "cycleA|intent", strategyId: "V12", symbol: "ETHUSDT",
        side: "LONG" as const, sleeve: "CRYPTO" as const, gross: 0.3, notionalUsd: 300 };
    const first = deriveAccountReservationId("lease", request);
    const second = deriveAccountReservationId("lease", { ...request, reservationKey: "cycleB|intent" });
    assert.notEqual(first, second);
});


test("restart after a persisted reserve with unfinalized journal releases only confirmed orphan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-manual-crash-restart-"));
    try {
        const path = join(dir, "intents.json");
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const request: AccountReservationInput = {
            reservationKey: "crashed-cycle-unique-key", strategyId: "V12", symbol: "ETHUSDT",
            side: "LONG", sleeve: "CRYPTO", gross: 0.3, notionalUsd: 300,
        };
        const id = deriveAccountReservationId(lock.leaseId, request);
        const journal = {
            schema: "disdex-dynamic-entry-intents/v1", intents: [], decisions: [],
            reservations: [{
                reservationKey: request.reservationKey, reservationId: id, cycleId: "crashed-cycle", intentId: "a",
                strategy: "V12", symbol: "ETHUSDT", side: "LONG", assetClass: "CRYPTO",
                gross: 0.3, notionalUsd: 300, status: "RESERVATION_PENDING",
                createdAt: 50_000, updatedAt: 50_000, strictApprovalToken: "strict",
            }],
        };
        await writeFile(path, JSON.stringify(journal));
        const reserved = await lock.reserve(request);
        assert.equal(reserved.reservationId, id);
        assert.equal((await lock.document()).reservations.find((row) => row.reservationId === id)?.status, "RESERVED");
        // Restart the registry: the process has lost every in-memory reservationId.
        const restarted = new FileDynamicEntryIntentRegistry(path);
        const results = await restarted.reconcileReservations({
            now: 50_100, lock, evidenceFor: () => ({
                capturedAt: 50_100, accountSnapshotFresh: true, openOrdersSnapshotFresh: true,
                pendingExposureSnapshotFresh: true, protectionSnapshotFresh: true,
                liveOrder: false, livePosition: false, pendingExposure: false,
                unmanagedOpenOrders: 0, protectiveStopsVerified: true,
            }),
        });
        assert.equal(results[0]?.status, "RELEASED");
        assert.equal(results[0]?.reservationId, id);
        assert.equal((await lock.document()).reservations.find((row) => row.reservationId === id)?.status, "RELEASED");
        assert.equal((await readPendingExposureRegistry(join(dir, "pending.json"))).entries.some((row) =>
            row.reservationId === id && row.status !== "RELEASED"), false);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("account lock refuses to overwrite a previously reserved deterministic ID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-replay-prevention-"));
    try {
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const request: AccountReservationInput = {
            reservationKey: "unique-once", strategyId: "V12", symbol: "ETHUSDT",
            side: "LONG", sleeve: "CRYPTO", gross: 0.3, notionalUsd: 300,
        };
        const first = await lock.reserve(request);
        await assert.rejects(() => lock.reserve(request), /ACCOUNT_RESERVATION_ALREADY_EXISTS_RECONCILIATION_REQUIRED/);
        assert.equal((await lock.document()).reservations.filter((row) => row.status === "RESERVED").length, 1);
        assert.equal((await readPendingExposureRegistry(join(dir, "pending.json"))).entries.filter((row) => row.status !== "RELEASED").length, 1);
        await lock.releaseReservation(first.reservationId);
        await assert.rejects(() => lock.reserve(request), /ACCOUNT_RESERVATION_ALREADY_EXISTS_RECONCILIATION_REQUIRED/);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("unresolved prior-cycle journal cannot be overwritten by another allocation for that cycle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-unresolved-guard-"));
    try {
        const path = join(dir, "intents.json");
        const registry = new FileDynamicEntryIntentRegistry(path);
        const intent = { cycleId: "unsafe-retry", id: "a", strategy: "V12", symbol: "ETHUSDT", side: "LONG" as const,
            assetClass: "CRYPTO" as const, marketFitScore: 5, targetGross: 0.3, minGross: 0.1, maxGross: 0.3 };
        await submitIntent(registry, intent, 50_000);
        const doc = JSON.parse(await readFile(path, "utf8"));
        doc.reservations.push({
            reservationKey: "unsafe", cycleId: "unsafe-retry", intentId: "a", strategy: "V12",
            symbol: "ETHUSDT", side: "LONG", assetClass: "CRYPTO", gross: 0.3, notionalUsd: 300,
            status: "RESERVATION_PENDING", strictApprovalToken: "old", createdAt: 50_000, updatedAt: 50_000,
        });
        await writeFile(path, JSON.stringify(doc));
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000, join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        await assert.rejects(() => registry.allocateCycle({
            cycleId: intent.cycleId, now: 50_000, cryptoGrossAvailable: 0.3, stockGrossAvailable: 0,
            totalGrossAvailable: 0.3, equityUsd: 1_000, lock, quality102CausalV1Ready: true,
            ...capsFor(intent), strictPlannerApprovals: [approvalFor(intent, 50_000)],
        }), /DYNAMIC_ENTRY_CYCLE_RECONCILIATION_REQUIRED/);
        assert.equal(JSON.parse(await readFile(path, "utf8")).reservations[0]?.status, "RESERVATION_PENDING");
        assert.equal((await lock.document()).reservations.length, 0);
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("another strategy holding does not activate rejected Score distribution; strict native order remains", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disdex-overlap-strict-integration-"));
    try {
        const registry = new FileDynamicEntryIntentRegistry(join(dir, "intents.json"));
        const low = { cycleId: "overlap-score", id: "low", strategy: "V12", symbol: "ETHUSDT",
            side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 5,
            targetGross: 0.5, maxGross: 0.5, minGross: 0.2 };
        const high = { cycleId: "overlap-score", id: "high", strategy: "QUALITY102_CAUSAL_V1", symbol: "AVAXUSDT",
            side: "LONG" as const, assetClass: "CRYPTO" as const, marketFitScore: 98,
            targetGross: 0.5, maxGross: 0.5, minGross: 0.2 };
        await submitIntent(registry, low, 50_000);
        await submitIntent(registry, high, 50_000);
        const held = { id: "live-fet-id", strategy: "FET_RESIDUAL" as const,
            symbol: "FETUSDT", side: "LONG" as const, quantity: 7,
            entryPrice: 1, markPrice: 1, entryTs: 10_000, updatedAt: 40_000 };
        const lock = await new FileAccountOrderLock(join(dir, "account.lock"), 60_000,
            join(dir, "pending.json")).acquire("test-owner");
        assert.ok(lock);
        const result = await registry.allocateCycle({
            cycleId: low.cycleId, now: 50_000, cryptoGrossAvailable: 0.6,
            stockGrossAvailable: 0, totalGrossAvailable: 0.6, equityUsd: 1_000,
            lock, quality102CausalV1Ready: true, ...capsFor(low, high),
            strictPlannerApprovals: [
                approvalFor(low, 50_000, [held]),
                approvalFor(high, 50_000, [held]),
            ],
        });
        assert.equal(result.allocations.length, 1);
        assert.equal(result.allocations[0].id, "low");
        assert.ok(Math.abs(result.allocations[0].allocatedGross - 0.5) < 1e-9);
        assert.equal(result.allocations[0].finalScore, 0);
        assert.equal(result.allocations[0].btPriorBonus, 0);
        assert.ok(result.rejected.some((row) => row.id === "high"));
        assert.ok(result.allocations.every((row) => row.reservationId.length > 0));
        await lock.release();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
