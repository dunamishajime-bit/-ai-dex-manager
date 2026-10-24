import assert from "node:assert/strict";
import test from "node:test";

import {
    buildLiveEntryCandidate,
    liveEntryScore,
    requireCompatibleExecutionSnapshot,
    requireApprovedLiveGross,
    strictIntentForLiveCandidate,
} from "../lib/disdex-live-entry-approval";

const NOW = 1_700_000_000_000;

test("producer score metadata uses completed signal diagnostics or a named neutral fallback", () => {
    assert.deepEqual(liveEntryScore("FET_RESIDUAL", { volumeRatio: 2, return72h: 0.05 }),
        { value: 65, source: "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1" });
    assert.deepEqual(liveEntryScore("V12", { score: 37 }),
        { value: 37, source: "V12_COMPLETED_SIGNAL_SCORE_V1" });
    assert.deepEqual(liveEntryScore("IDLE_PRIORITY_SHORT", { rel24: -0.04, ret12: -0.03 }),
        { value: 7, source: "IDLE_COMPLETED_REL24_RET12_V1" });
    assert.deepEqual(liveEntryScore("QUALITY102_CAUSAL_V1"),
        { value: 50, source: "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1" });
});

function candidate() {
    return buildLiveEntryCandidate({
        idempotencyKey: "FET|1700000000000|ENTRY",
        strategy: "FET_RESIDUAL",
        symbol: "FETUSDT",
        side: "LONG",
        signalTs: NOW - 10_000,
        score: { value: 62, source: "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1" },
        targetGross: 0.8,
        minGross: 0.05,
        maxGross: 1,
    });
}

test("live candidate retains signal score and complete gross and identity metadata at the strict boundary", () => {
    const row = candidate();
    const intent = strictIntentForLiveCandidate(row, 1_000);
    assert.equal(row.marketFitScore, 62);
    assert.equal(row.scoreSource, "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1");
    assert.deepEqual([row.strategy, row.symbol, row.side, row.signalTs, row.idempotencyKey],
        ["FET_RESIDUAL", "FETUSDT", "LONG", NOW - 10_000, "FET|1700000000000|ENTRY"]);
    assert.deepEqual([intent.gross, intent.notionalUsd, intent.minGross, intent.maxGross], [0.8, 800, 0.05, 1]);
});

test("versioned BT prior is optional and changes score only when supplied", () => {
    const without = candidate();
    assert.equal(without.btPrior, undefined);
    const withPrior = buildLiveEntryCandidate({
        ...candidate(),
        score: { value: 62, source: "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1" },
        btPrior: { version: "frozen-bt/v1", metrics: { returnPct: 40, profitFactor: 2, winRatePct: 60, maxDrawdownPct: 20, tradeCount: 100, observationDays: 180 } },
    });
    assert.equal(withPrior.btPriorVersion, "frozen-bt/v1");
    assert.ok(strictIntentForLiveCandidate(withPrior, 1_000).btPriorBonus! > 0);
});

test("strict approval propagates only the accepted gross and rejects missing or changed approval", () => {
    const row = candidate();
    const intent = strictIntentForLiveCandidate(row, 1_000);
    const context = { candidate: row, now: NOW, snapshotAt: NOW - 100, approvedAt: NOW - 100, maxAgeMs: 5_000 };
    assert.equal(requireApprovedLiveGross({ ...context, approved: { ...intent, gross: 0.3, notionalUsd: 300 } }), 0.3);
    assert.throws(() => requireApprovedLiveGross({ ...context, approved: undefined }), /APPROVAL_MISSING/);
    assert.throws(() => requireApprovedLiveGross({ ...context, approved: { ...intent, idempotencyKey: "other" } }), /APPROVAL_INCOMPATIBLE/);
    assert.throws(() => requireApprovedLiveGross({ ...context, approved: { ...intent, gross: 0.01, notionalUsd: 10 } }), /APPROVAL_BELOW_MINIMUM/);
});

test("approval fails closed when stale or based on a different snapshot", () => {
    const row = candidate();
    const approved = strictIntentForLiveCandidate(row, 1_000);
    const context = { candidate: row, approved, now: NOW, snapshotAt: NOW - 100, approvedAt: NOW - 100, maxAgeMs: 5_000 };
    assert.throws(() => requireApprovedLiveGross({ ...context, approvedAt: NOW - 6_000 }), /APPROVAL_STALE/);
    assert.throws(() => requireApprovedLiveGross({ ...context, snapshotAt: NOW - 6_000 }), /SNAPSHOT_STALE/);
    assert.throws(() => requireApprovedLiveGross({ ...context, snapshotAt: NOW - 50 }), /APPROVAL_INCOMPATIBLE/);
});

test("an allocation cannot execute after the position set, equity, or residual capacity changes incompatibly", () => {
    const base = { approvedGross: 0.3, approvalEquity: 1_000, currentEquity: 1_000,
        approvedAt: NOW - 100, now: NOW, maxAgeMs: 5_000,
        approvalPositions: [{ symbol: "BTCUSDT", side: "LONG", quantity: 1 }],
        currentPositions: [{ symbol: "BTCUSDT", side: "LONG", quantity: 1 }],
        cryptoGrossAvailable: 0.3, totalGrossAvailable: 0.3 };
    assert.equal(requireCompatibleExecutionSnapshot(base), 300);
    assert.throws(() => requireCompatibleExecutionSnapshot({ ...base, currentEquity: 900 }), /SNAPSHOT_INCOMPATIBLE/);
    assert.throws(() => requireCompatibleExecutionSnapshot({ ...base, currentPositions: [] }), /SNAPSHOT_INCOMPATIBLE/);
    assert.throws(() => requireCompatibleExecutionSnapshot({ ...base, cryptoGrossAvailable: 0.29 }), /SNAPSHOT_INCOMPATIBLE/);
    assert.throws(() => requireCompatibleExecutionSnapshot({ ...base, approvedAt: NOW - 6_000 }), /APPROVAL_STALE/);
});
