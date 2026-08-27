import assert from "node:assert/strict";

import { buildDecisionViewModel } from "../lib/ui/disterminal-ui-view-model";

const sample = {
  runtime: {
    checkedAt: "2026-08-27T12:00:00.000Z",
    units: [
      { id: "V12_X1.00_ALL", label: "V12", status: "LIVE" as const },
      { id: "PENGU_DUAL_LS_V2_FINAL", label: "PENGU V2", status: "LIVE" as const },
      { id: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96", label: "V52", status: "LIVE" as const },
    ],
  },
  v12Observability: {
    decision: {
      symbol: "SOLUSDT",
      side: "LONG",
      rank: 1,
      score: 1.12,
      selectionConfirmed: false,
      candidates: [{ symbol: "SOLUSDT", side: "LONG", rank: 1, score: 1.12 }],
    },
    executionTrace: {
      currentStage: "signal-gate-blocked",
      currentStageLabel: "候補順位のみ・発注Signal未成立",
      summary: "BTC regimeの条件未達です。",
      nextAction: "次の確定2時間足で再評価します。",
      steps: [
        { key: "candidate", label: "1. 候補選定", state: "pass" as const, detail: "SOL LONG / Rank 1" },
        { key: "regime", label: "3. Regime / BTC判定", state: "blocked" as const, detail: "BTCの判定基準未達" },
      ],
    },
  },
  penguRuntime: {
    status: "LIVE" as const,
    latestSignal: {
      side: 1,
      decision: { longEligible: true, shortEligible: false, active: true },
    },
    executionTrace: {
      currentStage: "signal-eligible",
      currentStageLabel: "Signal成立・注文Gate確認",
      summary: "PENGU Signalは成立しています。",
      nextAction: "注文Gateを確認します。",
      steps: [],
    },
  },
  v52Top2Observability: {
    status: "LIVE" as const,
    windows: [{
      window: "11:30",
      candidates: [{ symbol: "NVDAUSDT", candidateRank: 1 }],
      entries: [],
      rejections: [{ symbol: "NVDAUSDT", candidateRank: 1, orderBlockedReason: "BASIS_BELOW_65" }],
    }],
  },
  portfolio: {
    positions: [{ symbol: "SOLUSDT", side: "LONG" as const }],
    orders: { count: 0 },
  },
};

const model = buildDecisionViewModel(sample);

assert.equal(model.systemStatus, "LIVE / HEALTHY");
assert.equal(model.strategyCards.length, 3);
assert.equal(model.strategyCards.find((card) => card.id === "V52")?.market, "EQUITY");
assert.equal(model.strategyCards.find((card) => card.id === "V52")?.state, "BLOCKED");
assert.equal(model.penguDirections.find((item) => item.direction === "LONG")?.state, "SIGNAL");
assert.equal(model.penguDirections.find((item) => item.direction === "SHORT")?.state, "OFF");
const v12Attention = model.attentionItems.find((item) => item.strategyId === "V12");
assert.equal(v12Attention?.state, "BLOCKED");
assert.match(v12Attention?.blocker || "", /BTC/);
assert.equal("probability" in (v12Attention || {}), false);

const degraded = buildDecisionViewModel({
  ...sample,
  runtime: {
    ...sample.runtime,
    units: sample.runtime.units.map((unit, index) => index === 2 ? { ...unit, status: "STALE" as const } : unit),
  },
});
assert.equal(degraded.systemStatus, "DEGRADED");

const marketWaiting = buildDecisionViewModel({
  ...sample,
  v52Top2Observability: { status: "LIVE", windows: [{ candidates: [], entries: [], rejections: [] }] },
});
assert.equal(marketWaiting.strategyCards.find((card) => card.id === "V52")?.state, "WATCH");

const stale = buildDecisionViewModel({
  ...sample,
  runtime: {
    ...sample.runtime,
    units: sample.runtime.units.map((unit, index) => index === 1 || index === 2 ? { ...unit, status: "STALE" as const } : unit),
  },
  penguRuntime: { ...sample.penguRuntime, status: "STALE" as const },
  v52Top2Observability: { ...sample.v52Top2Observability, status: "STALE" as const },
});
assert.equal(stale.systemStatus, "DEGRADED");
assert.equal(stale.penguDirections.find((item) => item.direction === "LONG")?.state, "ERROR");
assert.equal(stale.strategyCards.find((card) => card.id === "V52")?.state, "ERROR");

const missingTrace = buildDecisionViewModel({
  ...sample,
  v12Observability: { ...sample.v12Observability, executionTrace: undefined },
});
assert.equal(missingTrace.systemStatus, "DEGRADED");

console.log("DISTerminal UI view-model self-test: PASS");
