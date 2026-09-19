import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { diagnoseSignalGate } from "../lib/server/v12-decision-observability";

test("V12 UI trusts runner signalEligible over reconstructed metrics", () => {
  const blocked = diagnoseSignalGate({
    symbol: "BNB",
    side: "LONG",
    score: 0.9024,
    momentum: 0.07,
    volumeRatio: 1.13,
    signalEligible: false,
    signalReason: "BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED",
  }, "LONG");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.code, "BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED");

  const eligible = diagnoseSignalGate({
    symbol: "NEAR",
    side: "LONG",
    score: 0.6313,
    momentum: 0.53,
    volumeRatio: 1.29,
    signalEligible: true,
    signalReason: "SIGNAL_ELIGIBLE",
  }, "LONG");
  assert.equal(eligible.status, "pass");
  assert.equal(eligible.code, "SIGNAL_ELIGIBLE");
});

test("positions UI separates entry orders, protection orders and gross headroom", async () => {
  const [page, hook, route] = await Promise.all([
    readFile("app/positions/page.tsx", "utf8"),
    readFile("hooks/useLivePortfolio.ts", "utf8"),
    readFile("app/api/system/live-portfolio/route.ts", "utf8"),
  ]);
  assert.match(page, /資金使用量 \/ 注文余力/);
  assert.match(page, /Crypto Gross余力/);
  assert.match(page, /新規待機注文/);
  assert.match(page, /保護注文/);
  assert.match(page, /STOP_MARKET/);
  assert.match(page, /TAKE_PROFIT_MARKET/);
  assert.match(hook, /entryOrderCount/);
  assert.match(route, /entryOrderCount/);
  assert.match(route, /readV12Usage/);
});

test("decision UI labels runner gate as authoritative", async () => {
  const panel = await readFile("components/features/DecisionStatusPanel.tsx", "utf8");
  assert.match(panel, /実runner Gate/);
  assert.match(panel, /signalEligible=true/);
  assert.match(panel, /Signal Eligible/);
  assert.doesNotMatch(panel, /候補順位のみ \/ 発注Signal未成立/);
});
