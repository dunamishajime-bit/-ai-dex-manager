import assert from "node:assert/strict";
import { DISDEX_PENGU_DUAL_ENGINE_V46, DISDEX_V46_RUNTIME } from "../config/disdexV46Runtime";
import { selectDisDexV46Executor } from "../lib/disdex-v46-live-gates";
import { DisDexV46LiveExecutionSafetyExecutor } from "../lib/disdex-v46-live-execution-safety";
import { assertEquityContinuity, calculateEquity, positionsMatch, projectedGrossAfterPending } from "../lib/disdex-v46-live-safety";
import { buildDisDexV35RebalanceActions } from "../lib/disdex-v35-portfolio-runner";
import { evaluateDisDexPenguV46Decision, type DisDexPenguV46DecisionFeatures } from "../lib/pengu-dual-engine-v46";
import type { DirectTradeExecutor } from "../lib/direct-trade-executor";

async function main() {

const liveExecutor = { id: "live" };
const paperExecutor = { id: "paper" };
assert.throws(
    () => selectDisDexV46Executor({ runnerMode: "live", liveExecutionEnabled: false, productionConfigLiveEnabled: true, liveExecutor, paperExecutor }),
    /Both DISDEX_V46_LIVE_EXECUTION_ENABLED=true/,
);
assert.equal(
    selectDisDexV46Executor({ runnerMode: "live", liveExecutionEnabled: true, productionConfigLiveEnabled: true, liveExecutor, paperExecutor }),
    liveExecutor,
);
assert.equal(
    selectDisDexV46Executor({ runnerMode: "paper", liveExecutionEnabled: false, productionConfigLiveEnabled: true, liveExecutor, paperExecutor }),
    paperExecutor,
);

assert.equal(DISDEX_V46_RUNTIME.mode, "LIVE");
assert.equal(DISDEX_V46_RUNTIME.liveTradingEnabled, true);
assert.equal(DISDEX_V46_RUNTIME.maximumGross, 2);
assert.equal(DISDEX_V46_RUNTIME.cashReservePct, 2);
assert.equal(DISDEX_V46_RUNTIME.closeUnmanagedPositions, false);
assert.equal(DISDEX_V46_RUNTIME.livePromotionBasis, "MANUAL_OPERATOR_OVERRIDE");
assert.equal(DISDEX_PENGU_DUAL_ENGINE_V46.longGross, 0.15);
assert.equal(DISDEX_PENGU_DUAL_ENGINE_V46.shortGross, 0.15);
assert.equal(DISDEX_PENGU_DUAL_ENGINE_V46.fundingCap, 0.0003);
assert.equal(DISDEX_PENGU_DUAL_ENGINE_V46.evidence.pristineForwardEvidence, false);

const quote = (symbol: string) => ({
    symbol,
    bidPrice: 10,
    askPrice: 10.01,
    bidQuantity: 100_000,
    askQuantity: 100_000,
    midPrice: 10,
    spreadBps: 10,
    updatedAt: Date.now(),
});
const rebalance = buildDisDexV35RebalanceActions({
    account: { walletBalance: 1000, availableBalance: 1000, asset: "USDT", updatedAt: Date.now() },
    positions: [],
    quotes: Object.fromEntries(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"].map((symbol) => [symbol, quote(symbol)])),
    targetWeights: { BTCUSDT: 1.5, ETHUSDT: 1.5, BNBUSDT: 1.5 },
    config: { cashReservePct: 2, maxGross: 2, minOrderNotionalUsd: 5, rebalanceTolerancePct: 0.1, closeUnmanagedPositions: false },
});
const scaledGross = Object.values(rebalance.targetWeights).reduce((sum, value) => sum + Math.abs(Number(value || 0)), 0);
assert.ok(scaledGross <= 2 + 1e-9, "raw target gross must be proportionally capped at 2.0");

const unmanaged = buildDisDexV35RebalanceActions({
    account: { walletBalance: 1000, availableBalance: 1000, asset: "USDT", updatedAt: Date.now() },
    positions: [{ symbol: "DOGEUSDT", quantity: 10, entryPrice: 10, markPrice: 10, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 100, positionSide: "BOTH", leverage: 1, updatedAt: Date.now() }],
    quotes: { DOGEUSDT: quote("DOGEUSDT") },
    targetWeights: {},
    config: { cashReservePct: 2, maxGross: 2, minOrderNotionalUsd: 5, rebalanceTolerancePct: 0.1, closeUnmanagedPositions: false },
});
assert.equal(unmanaged.actions.some((action) => action.symbol === "DOGEUSDT"), false, "unmanaged positions must not be auto-closed");

const flip = buildDisDexV35RebalanceActions({
    account: { walletBalance: 1000, availableBalance: 1000, asset: "USDT", updatedAt: Date.now() },
    positions: [{ symbol: "PENGUUSDT", quantity: 1000, entryPrice: 0.01, markPrice: 0.01, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 10, positionSide: "BOTH", leverage: 1, updatedAt: Date.now() }],
    quotes: { PENGUUSDT: { ...quote("PENGUUSDT"), bidPrice: 0.0099, askPrice: 0.0101, midPrice: 0.01 } },
    targetWeights: { PENGUUSDT: -0.15 },
    config: { cashReservePct: 0, maxGross: 2, minOrderNotionalUsd: 5, rebalanceTolerancePct: 0.1, closeUnmanagedPositions: false },
});
assert.equal(flip.actions[0]?.reduceOnly, true, "sign flip must begin with reduce-only");
assert.equal(flip.actions.some((action) => action.symbol === "PENGUUSDT" && !action.reduceOnly), false, "opposite entry must wait for a later tick");

const featureBase: DisDexPenguV46DecisionFeatures = {
    volumeRatio: 1,
    fundingRate: null,
    btcCloseAboveSma168: false,
    btcMomentum72hPct: -2,
    penguCloseAboveSma72: false,
    penguCloseAboveSma168: false,
    penguSma168Rising48h: false,
    penguMomentum6hPct: -2,
    penguMomentum6hLag12Pct: -1,
    penguMomentum24hPct: -3,
    penguMomentum120hPct: -5,
    relativeMomentum48hPct: -2,
    relativeMomentum120hPct: -4,
    rsi14: 35,
    priorLow24h: 11,
    close: 10,
};
const fundingMissingShort = evaluateDisDexPenguV46Decision(featureBase);
assert.equal(fundingMissingShort.side, -1, "Funding missing must block Long but keep an eligible Short available");
const fundingMissingLong = evaluateDisDexPenguV46Decision({ ...featureBase, penguCloseAboveSma72: true, penguCloseAboveSma168: true, penguSma168Rising48h: true, penguMomentum6hPct: 2, penguMomentum6hLag12Pct: -1, penguMomentum24hPct: 3, penguMomentum120hPct: 5, relativeMomentum48hPct: 2, relativeMomentum120hPct: 2, rsi14: 60 });
assert.equal(fundingMissingLong.longEligible, false);

const position = { symbol: "BTCUSDT", quantity: 1, entryPrice: 100, markPrice: 100, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 100, positionSide: "BOTH" as const, leverage: 1, updatedAt: Date.now() };
assert.equal(positionsMatch([{ symbol: "BTCUSDT", quantity: 1, positionSide: "BOTH", notionalUsd: 100, entryPrice: 100, markPrice: 100, updatedAt: Date.now() }], [position]), true);
assert.throws(() => assertEquityContinuity(100, 300), /abnormally/);
assert.throws(() => projectedGrossAfterPending(100, [{ ...position, notionalUsd: 250 }], { symbol: "PENGUUSDT", targetNotionalUsd: 1, reduceOnly: false }, 2), /exceeds maximum/);
assert.equal(calculateEquity({ walletBalance: 100, availableBalance: 100, asset: "USDT", updatedAt: Date.now() }, []).equity, 100);

let executeCalls = 0;
const fakeExecutor: DirectTradeExecutor = {
    async getAccountSnapshot() { return { walletBalance: 100, availableBalance: 100, asset: "USDT", updatedAt: Date.now() }; },
    async getPositions() { return [{ ...position, notionalUsd: 250 }]; },
    async getOpenOrders() { return []; },
    async getMarketQuote(symbol) { return quote(symbol); },
    async normalizeMarketQuantity(symbol, quantity, referencePrice) { return { symbol, quantity, quantityText: String(quantity), minQuantity: 0, maxQuantity: 1_000_000, stepSize: 1, minNotional: 0, notional: quantity * referencePrice }; },
    async executeMarket() { executeCalls += 1; throw new Error("must not execute in gross guard test"); },
    async reconcileOrder() { throw new Error("not used"); },
};
const guarded = new DisDexV46LiveExecutionSafetyExecutor(fakeExecutor, { maximumGross: 2 });
await assert.rejects(() => guarded.executeMarket({ requestId: "t", clientOrderId: "v46-test", symbol: "PENGUUSDT", side: "BUY", quantity: 1, positionSide: "BOTH", reduceOnly: false, expectedPrice: 10, maxSlippageBps: 35, reason: "selftest" }), /gross guard/);
assert.equal(executeCalls, 0, "gross guard must run before the order mutation call");

console.log("DISDEX_V46_LIVE_PREFLIGHT_SELFTEST_OK");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
