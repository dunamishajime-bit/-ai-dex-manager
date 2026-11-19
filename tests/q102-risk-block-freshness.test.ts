import assert from "node:assert/strict";
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
