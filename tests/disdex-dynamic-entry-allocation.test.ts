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
