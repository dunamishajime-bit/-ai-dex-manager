import assert from "node:assert/strict";
import {
    applyWin80Ultra90Top1Selection,
    classifyMainStrategyCandidate,
    resolveWin80Ultra90Overlap,
} from "../lib/win80-ultra90-main-strategy";

const base = {
    executionStatus: "Pass",
    resistanceStatus: "Open",
    triggerState: "Triggered",
    conditionalReferencePass: false,
    autoTradeExcludedReason: undefined,
    metrics: { rr: 1.6, adx1h: 24, macd1h: 1, macd6h: 1 },
};

const win80 = {
    ...base,
    symbol: "SUI",
    marketScore: 84,
    confidence: 86,
    triggerProgressRatio: 0.82,
    volumeRatio: 1.1,
    eventPriority: 70,
};

const ultra90 = {
    ...base,
    symbol: "PENGU",
    marketScore: 94,
    confidence: 94,
    triggerProgressRatio: 0.94,
    volumeRatio: 1.4,
    eventPriority: 92,
};

assert.equal(classifyMainStrategyCandidate(win80), "WIN80");
assert.equal(classifyMainStrategyCandidate(ultra90), "ULTRA90");
assert.equal(classifyMainStrategyCandidate({ ...win80, marketScore: 72 }), "BLOCKED");

const selected = applyWin80Ultra90Top1Selection([win80, ultra90]);
assert.equal(selected.length, 1);
assert.equal(selected[0].symbol, "PENGU");
assert.equal((selected[0] as typeof ultra90 & { allocationWeight: number }).allocationWeight, 1);

const normalSplit = resolveWin80Ultra90Overlap({
    current: { symbol: "BONK", pnlPct: 3.2, usdValue: 100 },
    incoming: win80,
});
assert.equal(normalSplit.action, "SPLIT_50");
assert.equal(normalSplit.sourceSellFraction, 0.5);

const normalReject = resolveWin80Ultra90Overlap({
    current: { symbol: "BONK", pnlPct: -0.4, usdValue: 100 },
    incoming: win80,
});
assert.equal(normalReject.action, "REJECT");

const ultraSwitch = resolveWin80Ultra90Overlap({
    current: { symbol: "BONK", pnlPct: -0.4, usdValue: 100 },
    incoming: ultra90,
});
assert.equal(ultraSwitch.action, "SWITCH_70");
assert.equal(ultraSwitch.sourceSellFraction, 0.7);
assert.equal(ultraSwitch.retainedAllocation, 0.3);

const sameSymbol = resolveWin80Ultra90Overlap({
    current: { symbol: "PENGU", pnlPct: 5, usdValue: 100 },
    incoming: ultra90,
});
assert.equal(sameSymbol.action, "HOLD_SAME");

console.log("WIN80_ULTRA90_MAIN_SELFTEST_OK");
