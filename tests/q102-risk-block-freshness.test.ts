import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDisDexV96KillSwitch } from "../lib/disdex-v96-live-risk-controls";
import test from "node:test";

import { refreshQ102StateAfterRiskBlock, refreshQ102FlatStateAfterVerifiedReconciliation } from "../lib/disdex-quality102-causal-v1-runner";
import type { Quality102CausalV1State } from "../lib/disdex-quality102-causal-v1-state";

test("risk-blocked Q102 refreshes state freshness without creating exposure", () => {
    const state = {
        strategyId: "QUALITY102_CAUSAL_V1",
        mode: "LIVE",
        runtimeCommitSha: "face9dca0458a515c99f901edf63ecde64298da4",
        updatedAt: 1_000,
        lastReconciledAt: 900,
        lastProcessedReferenceTs: 800,
        pending: undefined,
        position: undefined,
    } as unknown as Quality102CausalV1State;

    const refreshed = refreshQ102StateAfterRiskBlock(state, 2_000);

    assert.equal(refreshed.updatedAt, 2_000);
    assert.equal(refreshed.lastReconciledAt, 2_000);
    assert.equal(refreshed.lastProcessedReferenceTs, 800);
    assert.equal(refreshed.pending, undefined);
    assert.equal(refreshed.position, undefined);
});

test("verified flat Q102 reconciliation refreshes peer freshness without clearing ownership", () => {
    const state = {
        strategyId: "QUALITY102_CAUSAL_V1",
        mode: "LIVE",
        runtimeCommitSha: "face9dca0458a515c99f901edf63ecde64298da4",
        updatedAt: 1_000,
        lastReconciledAt: 900,
        lastCompletedIdempotencyKey: "previous-entry",
        failures: [],
    } as unknown as Quality102CausalV1State;
    const refreshed = refreshQ102FlatStateAfterVerifiedReconciliation(state, 2_000);
    assert.equal(refreshed.updatedAt, 2_000);
    assert.equal(refreshed.lastReconciledAt, 2_000);
    assert.equal(refreshed.lastCompletedIdempotencyKey, "previous-entry");
    assert.equal(refreshed.position, undefined);
    assert.equal(refreshed.pending, undefined);
});

test("Q102 cannot claim verified flat freshness with unresolved exposure", () => {
    const initial = { updatedAt: 1_000 } as Quality102CausalV1State;
    for (const exposure of [{ pending: { phase: "submitted" } }, { position: { symbol: "FETUSDT" } }]) {
        const state = { ...initial, ...exposure } as Quality102CausalV1State;
        assert.throws(
            () => refreshQ102FlatStateAfterVerifiedReconciliation(state, 2_000),
            /Q102_FRESHNESS_REQUIRES_VERIFIED_FLAT_STATE/,
        );
        assert.equal(state.updatedAt, 1_000);
    }
});

test("known STABLE4 global protected hold is accepted only with Q102 opt-in and blocks flatten", async () => {
    const root = await mkdtemp(join(tmpdir(), "q102-stable4-hold-"));
    const path = join(root, "shared-switch.json");
    const payload = {
        active: true,
        strategyId: "STABLE4_H48_CUTOVER",
        scope: "GLOBAL",
        action: "HOLD_PROTECTED",
        operator: "disdex-stable4-formal-owner-hold",
        reason: "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
        activatedAt: "2026-11-17T10:48:29.132+00:00",
        recoverable: false,
    };
    try {
        await writeFile(path, JSON.stringify(payload));
        await assert.rejects(readDisDexV96KillSwitch(path), /active but invalid/);
        const hold = await readDisDexV96KillSwitch(path, { acceptStable4GlobalHold: true });
        assert.equal(hold?.active, true);
        assert.equal(hold?.action, "HOLD_PROTECTED");
        for (const patch of [
            { action: "FLATTEN_MANAGED" },
            { scope: "V52_REFERENCE_ONLY" },
            { operator: "other-owner" },
            { reason: "UNKNOWN" },
            { strategyId: "FOREIGN" },
        ]) {
            await writeFile(path, JSON.stringify({ ...payload, ...patch }));
            await assert.rejects(
                readDisDexV96KillSwitch(path, { acceptStable4GlobalHold: true }),
                /active but invalid/,
            );
        }
        await writeFile(path, JSON.stringify({ action: "HOLD_PROTECTED" }));
        await assert.rejects(
            readDisDexV96KillSwitch(path, { acceptStable4GlobalHold: true }),
            /active but invalid/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
