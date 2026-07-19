import { analyzeDisDexV46Settlement, type DisDexV46ExecutionRecord } from "../lib/disdex-v46-settlement-analysis";
import type { DisDexPenguV46History } from "../lib/pengu-dual-engine-v46";

const history = {
    core12h: { BTCUSDT: [], ETHUSDT: [], BNBUSDT: [], SOLUSDT: [] },
    btc1h: [{ openTime: 1_000, closeTime: 3_000, open: 100, high: 103, low: 99, close: 101, volume: 1 }],
    pengu1h: [],
    penguFunding: [],
} satisfies DisDexPenguV46History;

const profit: DisDexV46ExecutionRecord = {
    idempotencyKey: "selftest-profit",
    clientOrderId: "v46-selftest-profit",
    symbol: "BTCUSDT",
    side: "SELL",
    reduceOnly: true,
    status: "FILLED",
    requestedQuantity: 1,
    executedQuantity: 1,
    averagePrice: 101,
    quoteQuantity: 101,
    completedAt: 3_000,
    referenceTs: 1_000,
    targetWeight: 0,
    reason: "selftest profit exit",
    positionBefore: { signedQuantity: 1, entryPrice: 100, markPrice: 102, notionalUsd: 100, observedAt: 1_000 },
};

const loss: DisDexV46ExecutionRecord = {
    ...profit,
    idempotencyKey: "selftest-loss",
    clientOrderId: "v46-selftest-loss",
    side: "SELL",
    averagePrice: 99,
    reason: "selftest loss exit",
};

const profitAnalysis = analyzeDisDexV46Settlement(profit, history, 4_000);
const lossAnalysis = analyzeDisDexV46Settlement(loss, history, 4_000);
if (!profitAnalysis || profitAnalysis.outcome !== "PROFIT" || (profitAnalysis.opportunityLeftPct ?? 0) <= 0) {
    throw new Error("Profit settlement analysis did not identify captured-vs-MFE opportunity.");
}
if (!lossAnalysis || lossAnalysis.outcome !== "LOSS" || !lossAnalysis.improvementProposal.includes("BT/OOS")) {
    throw new Error("Loss settlement analysis did not produce an improvement proposal.");
}

console.log("DISDEX_V46_SETTLEMENT_ANALYSIS_SELFTEST_OK");
