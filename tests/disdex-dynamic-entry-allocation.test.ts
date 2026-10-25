import assert from "node:assert/strict";
import test from "node:test";

import {
    allocateDynamicEntryGross,
    calculateBtPriorBonus,
    scoreDynamicEntryCandidate,
    type DynamicBtPriorMetrics,
    type DynamicEntryCandidate,
} from "../lib/disdex-dynamic-entry-allocation";

const STRONG_PENGU_PRIOR: DynamicBtPriorMetrics = {
    returnPct: 80,
    profitFactor: 3,
    winRatePct: 80,
    maxDrawdownPct: 0,
    tradeCount: 100,
    observationDays: 180,
};

function candidate(overrides: Partial<DynamicEntryCandidate> & Pick<DynamicEntryCandidate, "id" | "marketFitScore">): DynamicEntryCandidate {
    return {
        strategy: "IDLE",
        symbol: "ETHUSDT",
        side: "LONG",
        assetClass: "CRYPTO",
        targetGross: 0.8,
        minGross: 0.2,
        maxGross: 1,
        ...overrides,
    };
}

function allocationInput(candidates: DynamicEntryCandidate[], limits: Partial<{
    cryptoGrossAvailable: number;
    stockGrossAvailable: number;
    totalGrossAvailable: number;
    equityUsd: number;
    strategyGrossAvailable: Readonly<Record<string, number>>;
}> = {}) {
    return {
        candidates,
        cryptoGrossAvailable: 2,
        stockGrossAvailable: 2,
        totalGrossAvailable: 2,
        equityUsd: 1_000,
        ...limits,
    };
}

test("market fit beats the PENGU BT prior when the score gap exceeds its cap", () => {
    const nonPengu = candidate({ id: "idle", marketFitScore: 60 });
    const pengu = candidate({ id: "pengu", strategy: "PENGU", symbol: "PENGUUSDT", marketFitScore: 49, btPrior: STRONG_PENGU_PRIOR });

    assert.ok(scoreDynamicEntryCandidate(nonPengu).finalScore > scoreDynamicEntryCandidate(pengu).finalScore);
    assert.ok(scoreDynamicEntryCandidate(pengu).btPriorBonus <= 10);
});

test("PENGU BT prior wins a near tie and its bonus is capped", () => {
    const nonPengu = candidate({ id: "idle", marketFitScore: 50 });
    const pengu = candidate({ id: "pengu", strategy: "PENGU", symbol: "PENGUUSDT", marketFitScore: 45, btPrior: STRONG_PENGU_PRIOR });

    assert.ok(scoreDynamicEntryCandidate(pengu).finalScore > scoreDynamicEntryCandidate(nonPengu).finalScore);
    assert.equal(calculateBtPriorBonus(STRONG_PENGU_PRIOR, 4), 4);
    assert.equal(calculateBtPriorBonus(STRONG_PENGU_PRIOR), 10);
});

test("few trades dampen the BT prior and drawdown lowers the bonus", () => {
    const weakSample = calculateBtPriorBonus({ ...STRONG_PENGU_PRIOR, tradeCount: 10 });
    const largeDrawdown = calculateBtPriorBonus({ ...STRONG_PENGU_PRIOR, maxDrawdownPct: 40 });

    assert.ok(weakSample < calculateBtPriorBonus(STRONG_PENGU_PRIOR));
    assert.ok(largeDrawdown < calculateBtPriorBonus(STRONG_PENGU_PRIOR));
    assert.equal(calculateBtPriorBonus({ ...STRONG_PENGU_PRIOR, tradeCount: -10 }), 0);
});

test("all candidates receive their minimum when class and total residuals permit it", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "crypto-a", marketFitScore: 10 }),
        candidate({ id: "crypto-b", marketFitScore: 8 }),
        candidate({ id: "stock-a", marketFitScore: 6, assetClass: "STOCK" }),
    ], { cryptoGrossAvailable: 0.8, stockGrossAvailable: 0.4, totalGrossAvailable: 1.2 }));

    assert.deepEqual(result.allocations.map(({ id }) => id), ["crypto-a", "crypto-b", "stock-a"]);
    assert.ok(result.allocations.every(({ allocatedGross }) => allocatedGross >= 0.2));
});

test("remaining gross follows score and target headroom while respecting candidate and pool caps", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "high", marketFitScore: 10, targetGross: 0.8, maxGross: 0.7 }),
        candidate({ id: "low", marketFitScore: 5, targetGross: 0.8, maxGross: 1 }),
        candidate({ id: "stock", marketFitScore: 9, targetGross: 0.8, maxGross: 1, assetClass: "STOCK" }),
    ], { cryptoGrossAvailable: 0.9, stockGrossAvailable: 0.8, totalGrossAvailable: 1.2 }));

    const high = result.allocations.find(({ id }) => id === "high")!;
    const low = result.allocations.find(({ id }) => id === "low")!;
    assert.ok(high.allocatedGross > low.allocatedGross);
    assert.ok(high.allocatedGross <= 0.7);
    assert.ok(result.allocations.filter(({ assetClass }) => assetClass === "CRYPTO").reduce((sum, allocation) => sum + allocation.allocatedGross, 0) <= 0.9 + 1e-9);
    assert.ok(result.allocations.filter(({ assetClass }) => assetClass === "STOCK").reduce((sum, allocation) => sum + allocation.allocatedGross, 0) <= 0.8 + 1e-9);
    assert.ok(result.allocations.reduce((sum, allocation) => sum + allocation.allocatedGross, 0) <= 1.2 + 1e-9);
});

test("candidates below minimum gross or minimum notional are rejected deterministically", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "gross-floor", marketFitScore: 10, minGross: 0.2 }),
        candidate({ id: "notional-floor", marketFitScore: 9, assetClass: "STOCK", minGross: 0.1, minNotionalUsd: 200 }),
    ], { cryptoGrossAvailable: 0.1, stockGrossAvailable: 0.15, totalGrossAvailable: 1 }));

    assert.deepEqual(result.rejected, [
        { id: "gross-floor", reason: "MIN_GROSS_NOT_MET" },
        { id: "notional-floor", reason: "MIN_NOTIONAL_NOT_MET" },
    ]);
    assert.equal(result.allocations.length, 0);
});

test("a minimum notional cannot pass when equity is not positive", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "notional-without-equity", marketFitScore: 10, minGross: 0.1, minNotionalUsd: 100 }),
    ], { equityUsd: 0 }));

    assert.deepEqual(result.rejected, [{ id: "notional-without-equity", reason: "MIN_NOTIONAL_NOT_MET" }]);
    assert.equal(result.allocations.length, 0);
});

test("recovered V12 raw signal score cannot compete directly with 0..100 scores", () => {
    assert.throws(() => scoreDynamicEntryCandidate(candidate({
        id: "v12-raw", strategy: "V12", scoreSource: "V12_COMPLETED_SIGNAL_SCORE_V1",
        marketFitScore: 0.7,
    })), /UNCALIBRATED_V12_MARKET_FIT_SCORE/);
});

test("dynamic allocator rejects non-finite and out-of-scale scores, rather than silently ranking", () => {
    for (const invalidScore of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 100.1]) {
        assert.throws(() => allocateDynamicEntryGross(allocationInput([
            candidate({ id: "invalid", marketFitScore: invalidScore }),
        ])), /MARKET_FIT_SCORE_OUT_OF_RANGE/);
    }
});

test("eligible secondary candidate consumes residual without exceeding the individual target", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "first", marketFitScore: 90, minGross: 0.1, targetGross: 0.3, maxGross: 0.3 }),
        candidate({ id: "second", marketFitScore: 80, minGross: 0.1, targetGross: 0.8, maxGross: 0.8 }),
    ], { cryptoGrossAvailable: 1.1, totalGrossAvailable: 1.1 }));
    assert.equal(result.allocations.length, 2);
    assert.ok(Math.abs(result.allocations.reduce((sum, x) => sum + x.allocatedGross, 0) - 1.1) < 1e-9);
    assert.ok(result.allocations.find((x) => x.id === "first")!.allocatedGross <= 0.3);
    assert.ok(result.allocations.find((x) => x.id === "second")!.allocatedGross <= 0.8);
});

test("explicit 0..100 V12 score remains eligible, but raw Idle return magnitude does not", () => {
    assert.equal(scoreDynamicEntryCandidate(candidate({
        id: "v12-validated", strategy: "V12", scoreSource: "V12_COMPLETED_SIGNAL_SCORE_V1",
        marketFitScore: 37,
    })).finalScore, 37);
    assert.equal(scoreDynamicEntryCandidate(candidate({
        id: "idle-raw", strategy: "IDLE_PRIORITY_SHORT", scoreSource: "IDLE_COMPLETED_REL24_RET12_V1",
        marketFitScore: 7,
    })).finalScore, 50);
});

test("same-strategy simultaneous minimum orders cannot exceed residual strategy gross", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "a", strategy: "IDLE", marketFitScore: 95, minGross: 0.6, targetGross: 0.8 }),
        candidate({ id: "b", strategy: "IDLE", marketFitScore: 80, minGross: 0.6, targetGross: 0.8 }),
        candidate({ id: "c", strategy: "Q102", marketFitScore: 75, minGross: 0.1, targetGross: 0.5 }),
    ], {
        cryptoGrossAvailable: 1.6, totalGrossAvailable: 1.6,
        strategyGrossAvailable: { IDLE: 0.75, Q102: 0.5 },
    }));
    assert.equal(result.allocations.filter((x) => x.strategy === "IDLE").length, 1);
    assert.ok(result.allocations.filter((x) => x.strategy === "IDLE").reduce((a, b) => a + b.allocatedGross, 0) <= 0.75 + 1e-9);
    assert.ok(result.allocations.some((x) => x.strategy === "Q102"));
    assert.ok(result.rejected.some((x) => x.id === "b"));
});
test("water-fill redistributes bounded same-strategy headroom into other eligible strategies", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "a", strategy: "IDLE", marketFitScore: 90, minGross: 0.2, targetGross: 0.9 }),
        candidate({ id: "b", strategy: "IDLE", marketFitScore: 80, minGross: 0.2, targetGross: 0.9 }),
        candidate({ id: "c", strategy: "Q102", marketFitScore: 70, minGross: 0.1, targetGross: 0.9 }),
    ], { cryptoGrossAvailable: 1.6, totalGrossAvailable: 1.6,
        strategyGrossAvailable: { IDLE: 0.5, Q102: 0.9 } }));
    assert.ok(result.allocations.filter((x) => x.strategy === "IDLE").reduce((a, b) => a + b.allocatedGross, 0) <= 0.5 + 1e-9);
    assert.ok(result.allocations.find((x) => x.id === "c")!.allocatedGross > 0.5);
    assert.ok(result.allocations.reduce((a, b) => a + b.allocatedGross, 0) <= 1.4 + 1e-9);
    assert.ok(result.residual.totalGross >= -1e-9);
});
test("registry-bound gross calculation rejects a strategy absent from the snapshot", () => {
    const result = allocateDynamicEntryGross(allocationInput([
        candidate({ id: "unknown", strategy: "RENDER", marketFitScore: 90 }),
    ], { strategyGrossAvailable: { IDLE: 0.5 } }));
    assert.equal(result.allocations.length, 0);
    assert.deepEqual(result.rejected, [{ id: "unknown", reason: "STRATEGY_GROSS_UNAVAILABLE" }]);
});

test("same-position score candidates share one hard position cap and release surplus to other symbols", () => {
    const result = allocateDynamicEntryGross({
        candidates: [
            candidate({ id: "a", strategy: "V12", symbol: "ETHUSDT", marketFitScore: 95, minGross: 0.2, targetGross: 0.6 }),
            candidate({ id: "b", strategy: "V12", symbol: "ETHUSDT", marketFitScore: 90, minGross: 0.2, targetGross: 0.6 }),
            candidate({ id: "c", strategy: "Q102", symbol: "AVAXUSDT", marketFitScore: 80, minGross: 0.2, targetGross: 0.8 }),
        ],
        cryptoGrossAvailable: 1.1, stockGrossAvailable: 0, totalGrossAvailable: 1.1,
        equityUsd: 1000,
        strategyGrossAvailable: { V12: 0.8, Q102: 0.8 },
        positionGrossAvailable: { "V12|ETHUSDT|LONG": 0.3, "Q102|AVAXUSDT|LONG": 0.8 },
    });
    assert.ok(result.allocations.filter((row) => row.symbol === "ETHUSDT")
        .reduce((sum, row) => sum + row.allocatedGross, 0) <= 0.3 + 1e-9);
    assert.equal(result.allocations.some((row) => row.id === "b"), false);
    assert.ok(result.allocations.find((row) => row.id === "c")!.allocatedGross >= 0.7);
    assert.ok(result.allocations.reduce((sum, row) => sum + row.allocatedGross, 0) <= 1.1 + 1e-9);
});
