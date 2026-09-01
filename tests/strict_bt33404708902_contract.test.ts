import assert from "node:assert/strict";
import test from "node:test";
import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";
import {
    markToMarketReducePosition,
    planStrictPortfolio,
    type StrictPortfolioPosition,
} from "../lib/disdex-strict-portfolio-planner";
import { evaluateQuality102LiveSelector } from "../lib/disdex-quality102-live-selector";

const NOW = 1_800_000_000_000;

function position(input: Partial<StrictPortfolioPosition> & Pick<StrictPortfolioPosition, "id" | "strategy" | "symbol" | "quantity" | "entryPrice" | "markPrice">): StrictPortfolioPosition {
    return {
        side: input.side || "LONG",
        entryTs: input.entryTs ?? NOW - 3_600_000,
        updatedAt: input.updatedAt ?? NOW,
        feeBpsPerSide: input.feeBpsPerSide ?? 0,
        fundingPerDay: input.fundingPerDay ?? 0,
        ...input,
    };
}

test("source identity and strict caps are immutable", () => {
    assert.equal(STRICT_BT33404708902.sourceRun, "33404708902");
    assert.equal(STRICT_BT33404708902.sourceSha, "aec066fefd761b12f07e6927b5f2a524f88ca08b");
    assert.equal(STRICT_BT33404708902.quality102PositionCap, 0.5);
    assert.equal(STRICT_BT33404708902.cryptoGrossCap, 2);
    assert.equal(STRICT_BT33404708902.totalGrossCap, 2.5);
});

test("all four simultaneous intents admit base strategies before blocking Q102", () => {
    const plan = planStrictPortfolio({
        equity: 1_000,
        now: NOW,
        active: [],
        intents: [
            { idempotencyKey: "q", strategy: "QUALITY102", symbol: "SOLUSDT", side: "LONG", gross: 0.5, notionalUsd: 500, signalTs: NOW },
            { idempotencyKey: "v12", strategy: "V12", symbol: "ETHUSDT", side: "LONG", gross: 1.5, notionalUsd: 1_500, signalTs: NOW },
            { idempotencyKey: "pengu", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", side: "SHORT", gross: 0.75, notionalUsd: 750, signalTs: NOW },
            { idempotencyKey: "v52", strategy: "V52", symbol: "NVDAUSDT", side: "LONG", gross: 1.5, notionalUsd: 1_500, signalTs: NOW },
        ],
    });
    assert.equal(plan.status, "planned");
    assert.deepEqual(plan.accepted.map((intent) => intent.strategy), ["V52", "PENGU_DUAL_LS_V2", "V12"]);
    assert.equal(plan.rejected.find((row) => row.intent.strategy === "QUALITY102")?.reason, "QUALITY102_LIVE_BLOCKED_FAIL_CLOSED");
    assert.ok(plan.totals.cryptoGross <= 2 + 1e-9);
    assert.ok(plan.totals.totalGross <= 2.5 + 1e-9);
});

test("MTM reduction is restart/reconciliation stable and preserves remaining cost basis", () => {
    const input = {
        position: position({
            id: "q102",
            strategy: "QUALITY102",
            symbol: "SOLUSDT",
            side: "SHORT",
            quantity: 10,
            entryPrice: 100,
            markPrice: 90,
            feeBpsPerSide: 5,
            fundingPerDay: 0.001,
        }),
        reduceQuantity: 4,
        markPrice: 90,
        markTs: NOW,
    } as const;
    const first = markToMarketReducePosition(input);
    const afterReload = markToMarketReducePosition({
        ...input,
        position: { ...input.position, quantity: input.position.quantity },
    });
    assert.deepEqual(afterReload, first);
    assert.equal(first.remainingQuantity, 6);
    assert.equal(first.remainingEntryPrice, 100);
    assert.ok(first.realizedPnl > 0);
    assert.ok(first.transactionCost > 0);
    assert.ok(first.fundingCost > 0);
    assert.equal(first.accounting, "MARK_TO_MARKET_REALIZED_PNL");
});

test("a quality position is reduced at its current mark when a base order needs capacity", () => {
    const plan = planStrictPortfolio({
        equity: 1_000,
        now: NOW,
        active: [
            position({ id: "q102", strategy: "QUALITY102", symbol: "SOLUSDT", quantity: 50, entryPrice: 10, markPrice: 10 }),
            position({ id: "pengu", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", quantity: 75, entryPrice: 10, markPrice: 10 }),
        ],
        intents: [{ idempotencyKey: "v52", strategy: "V52", symbol: "NVDAUSDT", side: "LONG", gross: 1.5, notionalUsd: 1_500, signalTs: NOW }],
    });
    assert.equal(plan.status, "planned");
    assert.equal(plan.accepted[0]?.strategy, "V52");
    assert.equal(plan.reductions.length, 1);
    assert.equal(plan.reductions[0]?.accounting, "MARK_TO_MARKET_REALIZED_PNL");
    assert.equal(plan.reductions[0]?.markPrice, 10);
    assert.ok(plan.totals.cryptoGross <= STRICT_BT33404708902.cryptoGrossCap + 1e-9);
    assert.ok(plan.totals.totalGross <= STRICT_BT33404708902.totalGrossCap + 1e-9);
});

test("missing look-ahead proof keeps Quality102 fail-closed", () => {
    const result = evaluateQuality102LiveSelector({
        decisionTs: NOW,
        manifest: {
            sourceKind: "dynamic-selector",
            sourceRun: STRICT_BT33404708902.sourceRun,
            sourceSha: STRICT_BT33404708902.sourceSha,
            noLookahead: false,
            fixedHistoricalTimestamps: false,
            selectorParity: false,
            availableAtTs: NOW - 1,
        },
    });
    assert.equal(result.status, "LIVE_BLOCKED_FAIL_CLOSED");
    assert.equal(result.quality102LiveSelectorParity, false);
    assert.equal(result.quality102LiveBlockedFailClosed, true);
});
