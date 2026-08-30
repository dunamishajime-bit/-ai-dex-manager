import assert from "node:assert/strict";

import { buildDecisionViewModel, type DecisionViewInput } from "../lib/ui/disterminal-ui-view-model";

const input = {
  runtime: {
    checkedAt: "2026-08-31T21:10:00.000Z",
    units: [
      { id: "V12_X1.00_ALL", label: "V12", status: "LIVE" as const },
      { id: "PENGU_DUAL_LS_V2_FINAL", label: "PENGU", status: "LIVE" as const },
      { id: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96", label: "V52", status: "LIVE" as const },
    ],
  },
  v52: { marketOpen: false, marketLabel: "米国株式市場 09:30–16:00（ニューヨーク時間）", items: [] },
  v52Top2Observability: {
    status: "LIVE" as const,
    referenceOrdersAllowed: false,
    referenceHealth: { ready: false, reason: "REFERENCE_SOURCE_OR_QUOTE_QUALITY_NOT_READY" },
    killSwitchActive: false,
    windows: [
      { candidates: [], entries: [], rejections: [] },
      { candidates: [], entries: [], rejections: [] },
      { candidates: [], entries: [], rejections: [] },
    ],
  },
} as DecisionViewInput & { v52: { marketOpen: boolean; marketLabel: string; items: unknown[] } };

const model = buildDecisionViewModel(input);
const v52 = model.strategyCards.find((card) => card.id === "V52");

assert.ok(v52, "V52 strategy card must exist");
assert.equal(v52.observedCandidates, null, "market-closed V52 must not be reported as zero candidates");
assert.equal(v52.state, "OFF", "market-closed V52 must be OFF");
assert.equal(v52.stageLabel, "対象時間外", "market-closed V52 must explain why candidates are not evaluated");
assert.match(v52.detail, /対象時間外/);

const openInput = {
  ...input,
  v52: { ...input.v52, marketOpen: true },
  v52Top2Observability: {
    ...input.v52Top2Observability,
    referenceOrdersAllowed: true,
    referenceHealth: { ready: true, reason: "REFERENCE_FRESHNESS_READY" },
    windows: [
      { candidates: [{ candidateRank: 1, symbol: "AMZNUSDT" }], entries: [], rejections: [] },
      { candidates: [], entries: [], rejections: [] },
      { candidates: [], entries: [], rejections: [] },
    ],
  },
};
const openModel = buildDecisionViewModel(openInput);
const openV52 = openModel.strategyCards.find((card) => card.id === "V52");

assert.ok(openV52, "open-market V52 strategy card must exist");
assert.equal(openV52.observedCandidates, 1, "open-market V52 must preserve real candidate count");

console.log("V52 candidate count market-closed self-test: PASS");
