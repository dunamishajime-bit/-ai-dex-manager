import assert from "node:assert/strict";
import test from "node:test";

import { allocateOverlapConditionalGross, hasFreshOtherStrategyHolding } from "../lib/disdex-overlap-residual-allocation";
import type { DynamicEntryCandidate } from "../lib/disdex-dynamic-entry-allocation";
import type { StrictEntryApproval } from "../lib/disdex-strict-entry-approval";

const NOW = 50_000;

function candidate(id: string, strategy: string, score: number, targetGross = 0.5): DynamicEntryCandidate {
    return {
        id, strategy, symbol: id.toUpperCase() + "USDT", side: "LONG",
        assetClass: "CRYPTO", marketFitScore: score,
        targetGross, minGross: 0.2, maxGross: targetGross,
    };
}

function approval(row: DynamicEntryCandidate, holdings: Array<{ strategy: string; quantity?: number; id?: string; updatedAt?: number }> = [],
                  capturedAt = NOW - 1): StrictEntryApproval {
    const positions = holdings.map((p, i) => ({
        id: p.id ?? String(i + 1), strategy: p.strategy,
        symbol: "ETHUSDT", side: "LONG", quantity: p.quantity ?? 1,
        entryPrice: 1, markPrice: 1, updatedAt: p.updatedAt ?? capturedAt,
    }));
    return {
        candidateId: row.id,
        snapshot: { capturedAt, positions, pendingReservationIds: ["pending-does-not-count"] },
        plan: { activePositions: positions, accepted: [] },
    } as unknown as StrictEntryApproval;
}

function input(rows: DynamicEntryCandidate[], approvals: StrictEntryApproval[], caps?: Record<string, number>) {
    return {
        candidates: rows,
        strictPlannerApprovals: approvals,
        cryptoGrossAvailable: 0.6,
        stockGrossAvailable: 0,
        totalGrossAvailable: 0.6,
        equityUsd: 1000,
        strategyGrossAvailable: caps ?? Object.fromEntries(rows.map((x) => [x.strategy, 1])),
        positionGrossAvailable: Object.fromEntries(rows.map((x) => [x.strategy + "|" + x.symbol + "|" + x.side, 1])),
        now: NOW, snapshotMaxAgeMs: 1000,
    };
}

test("no existing holdings: native approvals, quantities and order are unchanged regardless of score", () => {
    const low = candidate("a", "V12", 1, 0.6);
    const high = candidate("b", "Q102", 99);
    const result = allocateOverlapConditionalGross(input([high, low], [approval(low), approval(high)]));
    assert.deepEqual(result.allocations.map((r) => [r.id, r.allocatedGross, r.btPriorBonus, r.finalScore]),
        [["a", 0.6, 0, 0]]);
    assert.ok(result.rejected.some((r) => r.id === "b"));
});

test("existing same-strategy holding does not enable the score mode", () => {
    const row = candidate("v12", "V12", 99);
    const own = approval(row, [{ strategy: "V12", quantity: 1 }]);
    assert.equal(hasFreshOtherStrategyHolding(row, own, NOW, 1000), false);
    const result = allocateOverlapConditionalGross(input([row], [own]));
    assert.equal(result.allocations[0].allocatedGross, 0.5);
    assert.equal(result.allocations[0].finalScore, 0);
});

test("existing different strategy enables only score based residual distribution", () => {
    const low = candidate("a", "V12", 1, 0.6);
    const high = candidate("b", "Q102", 99, 0.5);
    const approvals = [approval(low, [{ strategy: "FET" }]), approval(high, [{ strategy: "FET" }])];
    const result = allocateOverlapConditionalGross(input([high, low], approvals));
    assert.equal(result.allocations.length, 2);
    assert.ok(result.allocations.find((r) => r.id === "b")!.allocatedGross >
        result.allocations.find((r) => r.id === "a")!.allocatedGross);
    assert.equal(result.allocations.reduce((total, row) => total + row.allocatedGross, 0) <= 0.6 + 1e-9, true);
    assert.ok(result.allocations.some((r) => r.finalScore > 0));
});

test("mixed mode protects approved legacy size ahead of overlap optimization", () => {
    const first = candidate("a", "V12", 1, 0.4);
    const other = candidate("b", "Q102", 99, 0.5);
    const result = allocateOverlapConditionalGross(input([first, other], [
        approval(first, [{ strategy: "V12" }]),
        approval(other, [{ strategy: "V12" }]),
    ]));
    assert.equal(result.allocations.find((r) => r.id === "a")?.allocatedGross, 0.4);
    assert.ok(Math.abs(result.allocations.find((r) => r.id === "b")!.allocatedGross - 0.2) < 1e-9);
});

test("stale positions, zero-size positions, missing plan corroboration and pending-only never turn on score", () => {
    const row = candidate("q102", "Q102", 99);
    const noHold = approval(row);
    const stale = approval(row, [{ strategy: "V12" }], 47_000);
    const zero = approval(row, [{ strategy: "V12", quantity: 0 }]);
    const inconsistent = approval(row, [{ strategy: "V12" }]);
    inconsistent.plan.activePositions = [];
    for (const a of [noHold, stale, zero, inconsistent]) {
        assert.equal(hasFreshOtherStrategyHolding(row, a, NOW, 1000), false);
        const result = allocateOverlapConditionalGross(input([row], [a]));
        assert.equal(result.allocations[0]?.finalScore, 0);
    }
});

test("snapshot refresh validates long-held position without requiring recent entry timestamp", () => {
    const row = candidate("q102", "Q102", 99);
    const a = approval(row, [{ strategy: "PENGU_DUAL_LS_V2", updatedAt: 1000 }]);
    assert.equal(hasFreshOtherStrategyHolding(row, a, NOW, 1000), true);
});

test("invalid archived score defaults to native planner when overlap exists", () => {
    const row = { ...candidate("v12", "V12", 2), scoreSource: "V12_COMPLETED_SIGNAL_SCORE_V1" };
    const result = allocateOverlapConditionalGross(input([row], [approval(row, [{ strategy: "Q102" }])]));
    assert.equal(result.allocations[0].finalScore, 0);
    assert.equal(result.allocations[0].allocatedGross, 0.5);
});

test("hard strategy limit and native minimum remain binding with another strategy held", () => {
    const row = candidate("v12", "V12", 99, 0.5);
    const result = allocateOverlapConditionalGross(input([row], [approval(row, [{ strategy: "FET" }])], { V12: 0.1 }));
    assert.equal(result.allocations.length, 0);
    assert.ok(result.rejected.length > 0);
});
