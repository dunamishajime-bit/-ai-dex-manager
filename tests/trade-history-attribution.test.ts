import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveTradeHistoryAttribution,
  formatTradeHistoryAttributionLabel,
  getTradeHistoryAttributionTone,
} from "../lib/trade-history-attribution";

test("explicit low-ranking alternate route is shown as an alternate route", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "local-ledger",
    strategyId: "V12",
    reason: "V12 alternate route / Recovery V8 / rank=13 / route-backed entry",
    realizedPnlUsd: -0.4,
  });

  assert.deepEqual(attribution, {
    classification: "alternate-route",
    logicLabel: "V12",
    routeLabel: "Recovery V8",
    ranking: 13,
    evidence: "explicit",
  });
});

test("official symbol inference does not claim a confirmed firing route", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "official-fill",
    strategyId: "V12",
    reason: "Aster official fill / V12 / LONG / Entry / taker",
  });

  assert.deepEqual(attribution, {
    classification: "unknown",
    logicLabel: "V12",
    evidence: "symbol-inference",
  });
});

test("a negative-PnL order without logic evidence is labeled as a test order", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "official-fill",
    reason: "Aster official fill / unclassified",
    realizedPnlUsd: -0.25,
  });

  assert.deepEqual(attribution, {
    classification: "test-order",
    evidence: "negative-pnl-no-logic",
  });
});

test("a losing order with explicit logic evidence remains a logic order", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "local-ledger",
    strategyId: "Q102",
    reason: "QUALITY102_CAUSAL_V1 CAUSAL_V4 entry rank=1",
    realizedPnlUsd: -0.25,
  });

  assert.deepEqual(attribution, {
    classification: "logic",
    logicLabel: "Q102 / CAUSAL_V4",
    ranking: 1,
    evidence: "explicit",
  });
});

test("recovered or manually probed fills are labeled as test orders", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "local-ledger",
    reason: "recovered:onchain-swap manual probe",
    realizedPnlUsd: 0.2,
  });

  assert.equal(attribution.classification, "test-order");
  assert.equal(attribution.evidence, "explicit");
});

test("history label makes a low-ranking alternate route visible", () => {
  assert.equal(
    formatTradeHistoryAttributionLabel({
      strategyId: "V12",
      attribution: {
        classification: "alternate-route",
        logicLabel: "V12",
        routeLabel: "Recovery V8",
        ranking: 13,
        evidence: "explicit",
      },
    }),
    "別ルート発火: V12 / Recovery V8 / Rank13",
  );
});

test("history logic names receive distinct stable color tones", () => {
  const cases = [
    ["V12", "v12"],
    ["Q102 / CAUSAL_V4", "q102"],
    ["PENGU / Recovery V8", "recovery-v8"],
    ["PENGU / Short V20", "short-v20"],
    ["PENGU / V64 Dynamic Long", "v64-dynamic"],
    ["V52", "v52"],
  ] as const;
  for (const [logicLabel, expected] of cases) {
    assert.equal(getTradeHistoryAttributionTone({ classification: "logic", logicLabel, evidence: "explicit" }), expected);
  }
  assert.equal(getTradeHistoryAttributionTone({ classification: "test-order", evidence: "explicit" }), "test-order");
  assert.equal(getTradeHistoryAttributionTone({ classification: "unknown", evidence: "unavailable" }), "unknown");
});
