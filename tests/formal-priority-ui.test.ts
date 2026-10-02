import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sanitizeFormalPriority } from "../lib/server/formal-priority-observability";
import { deriveTradeHistoryAttribution } from "../lib/trade-history-attribution";
const target = { strategy: { v12: { rank12DefaultGross: 1, rank12ReducedGross: 0.5,
  rank12ReducedSymbols: ["DOGEUSDT", "LTCUSDT"], rank3GrossCap: 0.5, rank3ResidualOnly: true,
  sameSymbolCooldown: "ACTUAL_VENUE_EXIT_FILL_TIMESTAMP_PLUS_2H", q102PriorityHandoffFamilies: ["PB", "REV", "HIGH_VOL"],
  q102PriorityHandoffRankOrder: [3, 2, 1] } } };
test("priority API exposes actual source contract and per-symbol fill evidence without secrets", () => {
  const snapshot = sanitizeFormalPriority(target, { runtimeCommitSha: "a".repeat(40), privateKey: "DO_NOT_EXPORT",
    symbolCooldownUntilTs: { ETHUSDT: 10000 }, symbolLastExitTs: { ETHUSDT: 2800 },
    lastPriorityHandoff: { symbol: "ETHUSDT", family: "PB", victimRank: 2, freedGross: 0.8, reason: "Q102_PRIORITY_PREEMPT:PB:V12_R2" } },
    { pending: { family: "PB", gross: 2.5 } }, "a".repeat(40), 5000);
  assert.equal(snapshot.contractAvailable, true);
  assert.equal(snapshot.policy.rank3Gross, 0.5);
  assert.equal(snapshot.q102.handoffEligible, true);
  assert.deepEqual(snapshot.cooldowns, [{ symbol: "ETHUSDT", actualExitTs: 2800, cooldownUntil: 10000, active: true }]);
  assert.equal(JSON.stringify(snapshot).includes("DO_NOT_EXPORT"), false);
});
test("old deployed contract is not displayed as the new approved LIVE contract", () => {
  const snapshot = sanitizeFormalPriority({ strategy: { v12: { rank3GrossCap: 0.1 } } }, {}, {}, "a".repeat(40));
  assert.equal(snapshot.contractAvailable, false);
  assert.equal(snapshot.formalBacktest, null);
  assert.equal(snapshot.q102.handoffEligible, false);
});
test("Q102 priority exits retain victim rank and are never classified TEST ORDER", () => {
  for (const family of ["PB", "REV", "HIGH_VOL"]) {
    const attr = deriveTradeHistoryAttribution({ source: "local-ledger", strategyId: "V12_X1.00_ALL",
      reason: `Q102_PRIORITY_PREEMPT:${family}:V12_R2`, netPnlUsd: -5 });
    assert.equal(attr.classification, "alternate-route");
    assert.equal(attr.ranking, 2);
    assert.match(attr.routeLabel!, /Priority Handoff/);
  }
});
test("formal status stays authenticated/read-only and mobile layout retains overflow protection", () => {
  const api = readFileSync("app/api/system/formal-priority-status/route.ts", "utf8");
  const component = readFileSync("components/features/FormalPriorityPanel.tsx", "utf8");
  assert.match(api, /disdex_auth/);
  assert.match(api, /tradingMutation: 0/);
  assert.match(component, /min-w-0/);
  assert.match(component, /overflow-wrap:anywhere/);
  assert.match(component, /Historical L2未検証/);
  assert.doesNotMatch(api + component, /placeOrder\(|cancelOrder\(|executeMarket\(/);
});
