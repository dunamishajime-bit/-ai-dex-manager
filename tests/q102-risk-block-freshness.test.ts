import assert from "node:assert/strict";
import test from "node:test";

import { refreshQ102StateAfterRiskBlock } from "../lib/disdex-quality102-causal-v1-runner";
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
