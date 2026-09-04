import assert from "node:assert/strict";
import { resolveV12X1AllRuntime, V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { buildV12Signal, protectiveLevels, resampleV12H1ToH2, sizeV12Position } from "@/lib/v12-x1-all";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { buildSharedCryptoDailyRiskState, validateSharedCryptoDailyRisk } from "@/lib/disdex-shared-crypto-daily-risk";
import { buildV12RunnerHeartbeat } from "./disdex-v12-x1-all-live-runner";

const start = 1_700_000_000_000 - (1_700_000_000_000 % 7_200_000);
const h1 = Array.from({ length: 4 }, (_, i) => ({ ts: start + i * 3_600_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10, closed: true }));
const h2 = resampleV12H1ToH2(h1);
assert.equal(h2.length, 2);
assert.equal(h2[0].sourceCount, 2);
assert.equal(resampleV12H1ToH2(h1.filter((_, i) => i !== 2)).length, 1);
const oddLeadingH1 = Array.from({ length: 5 }, (_, i) => ({ ts: start + 3_600_000 + i * 3_600_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10, closed: true }));
assert.equal(resampleV12H1ToH2(oddLeadingH1).length, 2);
assert.equal(resolveV12X1AllRuntime({}).mode, "SHADOW");
assert.equal(resolveV12X1AllRuntime({}).enabled, false);
assert.equal(V12_X1_ALL.multiplier, 1);
const sized = sizeV12Position(1000, 100, 2, "LONG");
assert.ok(sized.requestedGross > 0 && sized.requestedGross <= 1);
const levels = protectiveLevels(100, 2, "LONG");
assert.ok(levels.initialStop < 100 && levels.takeProfit > 100);
assert.equal(classifyAsterSymbol("AVAXUSDT").sleeve, "V12");
assert.equal(classifyAsterSymbol("PENGUUSDT").sleeve, "PENGU_DUAL_LS_V2");
assert.equal(classifyAsterSymbol("METAUSDT").sleeve, "V11_EQ");
assert.equal(classifyAsterSymbol("NOT_A_SYMBOL").tradable, false);
const now = Date.now();
const risk = buildSharedCryptoDailyRiskState({ accountScope: "ASTER_FUTURES", utcDay: new Date(now).toISOString().slice(0, 10), strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1"], lossPct: 0, maximumLossPct: 5, tripped: false, updatedAt: now, realizedPnl: 0, unrealizedPnl: 0, fees: 0, funding: 0, netDailyPnl: 0, referenceEquity: 100, sourceComplete: true });
assert.equal(validateSharedCryptoDailyRisk(risk, now).ok, true);
const v12Heartbeat = buildV12RunnerHeartbeat({ status: "held", reason: "fixture-held" }, now, {
    mode: "LIVE",
    liveTradingEnabled: true,
    liveExecutionEnabled: true,
});
assert.equal(v12Heartbeat.runnerId, "V12");
assert.equal(v12Heartbeat.schema, "disdex-runner-heartbeat/v1");
assert.equal(v12Heartbeat.mode, "LIVE");
console.log("V12_X1_ALL_SELFTEST_PASS", JSON.stringify({ strategyId: V12_X1_ALL.strategyId, bars: h2.length }));
