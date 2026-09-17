import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AsterV3Client } from "@/lib/aster-v3-client";
import type { PenguDualLsV2RunnerState, PenguDualLsV2RunnerStateStore } from "@/lib/pengu-dual-ls-v2-runner-state";
import { reconcileRecoveryV8Protection } from "@/scripts/disdex-pengu-recovery-v8-reconcile";

const state = () => ({
    version: 2 as const,
    strategyId: "PENGU_DUAL_LS_V2_FINAL" as const,
    mode: "LIVE" as const,
    updatedAt: 1,
    failures: [],
    pending: undefined,
    position: {
        side: 1 as const,
        entryTs: 1_000_000,
        entryPrice: 0.006938,
        quantity: 4354,
        gross: 0.5,
        highWaterMark: 0.006938,
        entryVersion: "RECOVERY_V8" as const,
        recoveryV8: {
            version: "RECOVERY_V8" as const,
            side: 1 as const,
            entryTs: 1_000_000,
            entryPrice: 0.006938,
            quantity: 4354,
            originalQuantity: 4354,
            originalGross: 0.5,
            remainingGross: 0.5,
            partialDefenseTriggered: false,
            highWaterMark: 0.006938,
            protectionLifecycle: "MANUAL_REVIEW" as const,
        },
    },
});

function fakeClient(options: { matchingPosition?: boolean; readBack?: boolean } = {}) {
    const openOrders: Array<Record<string, unknown>> = [];
    let placeCalls = 0;
    const client = {
        getPositions: async () => options.matchingPosition === false
            ? [{ symbol: "PENGUUSDT", positionAmt: "1", entryPrice: "0.006938", markPrice: "0.00699", leverage: "5", marginType: "cross", positionSide: "BOTH" }]
            : [{ symbol: "PENGUUSDT", positionAmt: "4354", entryPrice: "0.006938", markPrice: "0.00699", leverage: "5", marginType: "cross", positionSide: "BOTH" }],
        getOpenOrders: async () => openOrders,
        getExchangeInfo: async () => ({ symbols: [{
            symbol: "PENGUUSDT",
            pricePrecision: 7,
            quantityPrecision: 0,
            filters: [
                { filterType: "PRICE_FILTER", tickSize: "0.0000010" },
                { filterType: "LOT_SIZE", stepSize: "1", minQty: "1" },
            ],
        }] }),
        placeStopMarketOrder: async (input: Record<string, string>) => {
            placeCalls += 1;
            if (options.readBack !== false) {
                openOrders.push({
                    symbol: "PENGUUSDT",
                    clientOrderId: input.newClientOrderId,
                    status: "NEW",
                    side: "SELL",
                    reduceOnly: true,
                    origQty: input.quantity,
                    stopPrice: input.stopPrice,
                });
            }
            return { symbol: "PENGUUSDT", clientOrderId: input.newClientOrderId, status: "NEW", side: "SELL", reduceOnly: true, origQty: input.quantity, stopPrice: input.stopPrice };
        },
        get placeCalls() { return placeCalls; },
    } as unknown as AsterV3Client & { placeCalls: number };
    return client;
}

function store(initial: ReturnType<typeof state>) {
    let current = structuredClone(initial);
    return {
        load: async () => structuredClone(current),
        save: async (next: typeof current) => { current = structuredClone(next); },
        get current() { return current; },
    } as unknown as PenguDualLsV2RunnerStateStore & { current: PenguDualLsV2RunnerState };
}

test("PENGU recovery reconciliation refuses mismatched positions without mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disdex-pengu-reconcile-"));
    const statePath = join(directory, "runner-live.json");
    await writeFile(statePath, JSON.stringify(state()));
    const client = fakeClient({ matchingPosition: false });
    await assert.rejects(() => reconcileRecoveryV8Protection({ client, stateStore: store(state()), statePath, apply: true }), /POSITION_QUANTITY_MISMATCH/);
    assert.equal(client.placeCalls, 0);
});

test("PENGU recovery reconciliation dry-run proves normalized protection without mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disdex-pengu-reconcile-"));
    const statePath = join(directory, "runner-live.json");
    await writeFile(statePath, JSON.stringify(state()));
    const client = fakeClient();
    const result = await reconcileRecoveryV8Protection({ client, stateStore: store(state()), statePath, apply: false });
    assert.equal(result.status, "DRY_RUN_PASS");
    assert.equal(result.quantity, 4354);
    assert.equal(result.stopPrice, 0.006521);
    assert.equal(client.placeCalls, 0);
});

test("PENGU recovery reconciliation updates state only after protective read-back", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disdex-pengu-reconcile-"));
    const statePath = join(directory, "runner-live.json");
    await writeFile(statePath, JSON.stringify(state()));
    const stateStore = store(state());
    const client = fakeClient();
    const result = await reconcileRecoveryV8Protection({ client, stateStore, statePath, apply: true, now: 42 });
    assert.equal(result.status, "APPLIED_PASS");
    assert.equal(result.ordersSent, 1);
    assert.equal(stateStore.current.position!.recoveryV8!.protectionLifecycle, "FULL_HARD_STOP");
    assert.equal(stateStore.current.position!.recoveryV8!.fullHardStopClientOrderId, result.clientOrderId);
    assert.equal(JSON.parse(await readFile(result.backupPath!, "utf8")).position.recoveryV8.protectionLifecycle, "MANUAL_REVIEW");
});

test("PENGU recovery reconciliation leaves state manual-review when read-back fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disdex-pengu-reconcile-"));
    const statePath = join(directory, "runner-live.json");
    await writeFile(statePath, JSON.stringify(state()));
    const stateStore = store(state());
    const client = fakeClient({ readBack: false });
    await assert.rejects(() => reconcileRecoveryV8Protection({ client, stateStore, statePath, apply: true }), /READBACK_COUNT/);
    assert.equal(client.placeCalls, 1);
    assert.equal(stateStore.current.position!.recoveryV8!.protectionLifecycle, "MANUAL_REVIEW");
});
