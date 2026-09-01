import assert from "node:assert/strict";
import {
    markToMarketReducePosition,
    planStrictPortfolio,
    type StrictPortfolioPosition,
} from "../lib/disdex-strict-portfolio-planner";
import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";

const NOW = 1_800_000_000_000;

function position(input: Partial<StrictPortfolioPosition> & Pick<StrictPortfolioPosition, "id" | "strategy" | "symbol" | "quantity" | "entryPrice" | "markPrice">): StrictPortfolioPosition {
    const markSource = input.markSource ?? (input.strategy === "QUALITY102" ? "BINANCE_VISION_USDM_1M_OPEN" : undefined);
    return {
        side: input.side || (input.quantity < 0 ? "SHORT" : "LONG"),
        entryTs: input.entryTs ?? NOW - 3_600_000,
        updatedAt: input.updatedAt ?? NOW,
        feeBpsPerSide: input.feeBpsPerSide ?? 0,
        fundingPerDay: input.fundingPerDay ?? 0,
        markSource,
        markSourceEvidence: input.markSourceEvidence ?? (markSource === "BINANCE_VISION_USDM_1M_OPEN"
            ? { source: "BINANCE_VISION_USDM_1M_OPEN", timestamp: NOW, crossChecked: true }
            : undefined),
        ...input,
    };
}

function totals(active: StrictPortfolioPosition[], equity = 1000) {
    return active.reduce((out, row) => {
        const gross = Math.abs(row.quantity * row.markPrice) / equity;
        const crypto = row.strategy === "V12" || row.strategy === "PENGU_DUAL_LS_V2" || row.strategy === "QUALITY102";
        out.total += gross;
        if (crypto) out.crypto += gross;
        else out.stock += gross;
        return out;
    }, { total: 0, crypto: 0, stock: 0 });
}

assert.equal(STRICT_BT33404708902.sourceRun, "33404708902");
assert.equal(STRICT_BT33404708902.sourceSha, "aec066fefd761b12f07e6927b5f2a524f88ca08b");

const at199 = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [
        position({ id: "v12", strategy: "V12", symbol: "ETHUSDT", quantity: 150, entryPrice: 1, markPrice: 10 }),
        position({ id: "pengu", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", quantity: 49, entryPrice: 1, markPrice: 10 }),
    ],
    intents: [],
});
assert.equal(at199.status, "planned");
assert.ok(at199.totals.cryptoGross < 2);

const at200 = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [
        position({ id: "v12", strategy: "V12", symbol: "ETHUSDT", quantity: 150, entryPrice: 1, markPrice: 10 }),
        position({ id: "pengu", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", quantity: 50, entryPrice: 1, markPrice: 10 }),
    ],
    intents: [],
});
assert.equal(at200.status, "planned");
assert.equal(at200.totals.cryptoGross, 2);

const overCrypto = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [
        position({ id: "v12", strategy: "V12", symbol: "ETHUSDT", quantity: 150, entryPrice: 1, markPrice: 10 }),
        position({ id: "pengu", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", quantity: 51, entryPrice: 1, markPrice: 10 }),
    ],
    intents: [],
});
assert.equal(overCrypto.status, "blocked");
assert.match(overCrypto.reason || "", /CRYPTO_GROSS/);

const at249 = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [
        position({ id: "v12", strategy: "V12", symbol: "ETHUSDT", quantity: 100, entryPrice: 1, markPrice: 10 }),
        position({ id: "stock", strategy: "V52", symbol: "NVDAUSDT", quantity: 149, entryPrice: 1, markPrice: 10 }),
    ],
    intents: [],
});
assert.equal(at249.status, "planned");
assert.ok(at249.totals.totalGross < 2.5);

const at250 = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [
        position({ id: "v12", strategy: "V12", symbol: "ETHUSDT", quantity: 100, entryPrice: 1, markPrice: 10 }),
        position({ id: "stock", strategy: "V52", symbol: "NVDAUSDT", quantity: 150, entryPrice: 1, markPrice: 10 }),
    ],
    intents: [],
});
assert.equal(at250.status, "planned");
assert.equal(at250.totals.totalGross, 2.5);

const overTotal = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [
        position({ id: "v12", strategy: "V12", symbol: "ETHUSDT", quantity: 100, entryPrice: 1, markPrice: 10 }),
        position({ id: "stock", strategy: "V52", symbol: "NVDAUSDT", quantity: 151, entryPrice: 1, markPrice: 10 }),
    ],
    intents: [],
});
assert.equal(overTotal.status, "blocked");
assert.match(overTotal.reason || "", /TOTAL_GROSS/);

const overQualityCap = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [position({ id: "q102-over", strategy: "QUALITY102", symbol: "SOLUSDT", quantity: 51, entryPrice: 1, markPrice: 10 })],
    intents: [],
});
assert.equal(overQualityCap.status, "blocked");
assert.match(overQualityCap.reason || "", /QUALITY102_GROSS_OVER_CAP/);

const unverifiedQualityMark = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [position({ id: "q102-unverified", strategy: "QUALITY102", symbol: "SOLUSDT", quantity: 10, entryPrice: 10, markPrice: 10, markSource: "LIVE_MARKET_QUOTE" })],
    intents: [],
});
assert.equal(unverifiedQualityMark.status, "blocked");
assert.match(unverifiedQualityMark.reason || "", /QUALITY102_MTM_SOURCE_UNVERIFIED/);

const reductionInput = position({ id: "long", strategy: "QUALITY102", symbol: "SOLUSDT", quantity: 10, entryPrice: 100, markPrice: 120 });
const longReduction = markToMarketReducePosition({ position: reductionInput, reduceQuantity: 2, markPrice: 120, markTs: NOW, feeBpsPerSide: 0, fundingPerDay: 0 });
assert.equal(longReduction.remainingQuantity, 8);
assert.ok(Math.abs(longReduction.realizedPnl - 40) < 1e-9);
assert.equal(longReduction.remainingEntryPrice, 100);
assert.equal(longReduction.markPrice, 120);

const shortReduction = markToMarketReducePosition({
    position: position({ id: "short", strategy: "QUALITY102", symbol: "SOLUSDT", side: "SHORT", quantity: 10, entryPrice: 100, markPrice: 80 }),
    reduceQuantity: 2,
    markPrice: 80,
    markTs: NOW,
    feeBpsPerSide: 0,
    fundingPerDay: 0,
});
assert.ok(Math.abs(shortReduction.realizedPnl - 40) < 1e-9);

const losingReduction = markToMarketReducePosition({ position: reductionInput, reduceQuantity: 2, markPrice: 80, markTs: NOW, feeBpsPerSide: 0, fundingPerDay: 0 });
assert.ok(Math.abs(losingReduction.realizedPnl + 40) < 1e-9);
assert.notEqual(losingReduction.realizedPnl, 0);

const qualityActive = [
    position({ id: "v12", strategy: "V12", symbol: "ETHUSDT", quantity: 75, entryPrice: 1, markPrice: 10 }),
    position({ id: "pengu", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", quantity: 75, entryPrice: 1, markPrice: 10 }),
    position({ id: "q102", strategy: "QUALITY102", symbol: "SOLUSDT", quantity: 50, entryPrice: 8, markPrice: 10 }),
];
const residual = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: qualityActive,
    intents: [{ idempotencyKey: "v52-1", strategy: "V52", symbol: "NVDAUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: NOW }],
});
assert.equal(residual.status, "planned");
assert.equal(residual.accepted.length, 1);
assert.equal(residual.accepted[0].strategy, "V52");
assert.equal(residual.reductions.length, 1);
assert.equal(residual.reductions[0].strategy, "QUALITY102");
assert.ok(residual.totals.cryptoGross <= 2 + 1e-9);
assert.ok(residual.totals.totalGross <= 2.5 + 1e-9);

const qualityIntent = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [],
    intents: [{ idempotencyKey: "q-1", strategy: "QUALITY102", symbol: "SOLUSDT", side: "LONG", gross: 0.5, notionalUsd: 500, signalTs: NOW }],
});
assert.equal(qualityIntent.accepted.length, 0);
assert.equal(qualityIntent.rejected[0]?.reason, "QUALITY102_LIVE_BLOCKED_FAIL_CLOSED");

const duplicate = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [],
    intents: [
        { idempotencyKey: "same", strategy: "V12", symbol: "ETHUSDT", side: "LONG", gross: 0.5, notionalUsd: 500, signalTs: NOW },
        { idempotencyKey: "same", strategy: "V12", symbol: "ETHUSDT", side: "LONG", gross: 0.5, notionalUsd: 500, signalTs: NOW },
    ],
});
assert.equal(duplicate.accepted.length, 1);
assert.equal(duplicate.rejected[0]?.reason, "DUPLICATE_INTENT");

const duplicateTarget = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    active: [],
    intents: [
        { idempotencyKey: "first-key", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", side: "LONG", gross: 0.5, notionalUsd: 500, signalTs: NOW },
        { idempotencyKey: "second-key", strategy: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", side: "LONG", gross: 0.5, notionalUsd: 500, signalTs: NOW },
    ],
});
assert.equal(duplicateTarget.accepted.length, 1);
assert.equal(duplicateTarget.rejected[0]?.reason, "DUPLICATE_INTENT_TARGET");

const stale = planStrictPortfolio({
    equity: 1000,
    now: NOW,
    maxDataAgeMs: 1000,
    active: [position({ id: "stale", strategy: "V12", symbol: "ETHUSDT", quantity: 1, entryPrice: 100, markPrice: 100, updatedAt: NOW - 1001 })],
    intents: [],
});
assert.equal(stale.status, "blocked");
assert.match(stale.reason || "", /STALE_MARK_PRICE/);

console.log("DISDEX_STRICT_BT_GROSS_SELFTEST_PASS", JSON.stringify({
    sourceRun: STRICT_BT33404708902.sourceRun,
    sourceSha: STRICT_BT33404708902.sourceSha,
    reductions: residual.reductions.length,
    gross: residual.totals,
}));
