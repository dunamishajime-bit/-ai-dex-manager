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

test("official symbol inference preserves the strategy lineage without inventing a subroute", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "official-fill",
    strategyId: "V12",
    reason: "Aster official fill / V12 / LONG / Entry / taker",
  });

  assert.deepEqual(attribution, {
    classification: "logic",
    logicLabel: "V12",
    evidence: "symbol-inference",
  });
});

test("a negative-PnL fill is never labeled test-order merely because it lost money", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "official-fill",
    reason: "Aster official fill / unclassified",
    realizedPnlUsd: -0.25,
  });

  assert.deepEqual(attribution, {
    classification: "unknown",
    evidence: "unavailable",
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
    [{ logicLabel: "V12" }, "v12"],
    [{ logicLabel: "V12", routeLabel: "Strong Quality" }, "v12-strong"],
    [{ logicLabel: "V12", routeLabel: "Relaxed Momentum+ATR" }, "v12-relaxed"],
    [{ logicLabel: "Q102 / CAUSAL_V4", routeLabel: "HIGH_VOL" }, "q102-high-vol"],
    [{ logicLabel: "Q102 / CAUSAL_V4", routeLabel: "BRK" }, "q102-brk"],
    [{ logicLabel: "PENGU", routeLabel: "Long V2 Final" }, "pengu-long-v2"],
    [{ logicLabel: "PENGU", routeLabel: "Recovery V8" }, "recovery-v8"],
    [{ logicLabel: "PENGU", routeLabel: "Short V20" }, "short-v20"],
    [{ logicLabel: "PENGU", routeLabel: "V64 Dynamic Long" }, "v64-dynamic"],
    [{ logicLabel: "V52", routeLabel: "V50" }, "v52-v50"],
  ] as const;
  for (const [labels, expected] of cases) {
    assert.equal(getTradeHistoryAttributionTone({ classification: "logic", ...labels, evidence: "explicit" }), expected);
  }
  assert.equal(getTradeHistoryAttributionTone({ classification: "test-order", evidence: "explicit" }), "test-order");
  assert.equal(getTradeHistoryAttributionTone({ classification: "unknown", evidence: "unavailable" }), "unknown");
});
