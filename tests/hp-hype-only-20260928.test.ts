import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { deriveTradeHistoryAttribution, getTradeHistoryAttributionTone } from "@/lib/trade-history-attribution";
import { liveTradeFromOfficialHistoryEntry } from "@/lib/server/live-performance-analytics";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("all HP app/components source removes excluded strategy wording and routes", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")];
  const matches = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /ZEC|\/zec\b/i.test(source) ? [file] : [];
  });
  assert.deepEqual(matches, []);
  assert.equal(existsSync("app/decision-status/zec/page.tsx"), false);
  assert.equal(existsSync("app/api/system/hype-zec-status/route.ts"), false);
});

test("HYPE decision/status route remains read-only and does not expose the excluded sleeve", () => {
  const api = readFileSync("app/api/system/hype-status/route.ts", "utf8");
  const panel = readFileSync("components/features/HypeDecisionPanel.tsx", "utf8");
  assert.match(api, /disdex_auth/);
  assert.match(api, /tradingMutation:0/);
  assert.doesNotMatch(api + panel, /executeMarket\(|placeStopMarket\(|cancelOrder\(/);
  assert.doesNotMatch(api + panel, /ZEC|\/zec\b/i);
  assert.match(panel, /\/decision-status\/hype/);
});

test("HYPE official fills retain explicit attribution and performance category", () => {
  const attribution = deriveTradeHistoryAttribution({
    source: "official-fill",
    strategyId: "HYPE",
    reason: "LIVE validated",
  });
  assert.equal(attribution.evidence, "explicit");
  assert.equal(getTradeHistoryAttributionTone(attribution), "hype");
  const trade = liveTradeFromOfficialHistoryEntry({
    id: "hype",
    action: "BUY",
    sourceSymbol: "USDT",
    destSymbol: "HYPE",
    executedAt: new Date().toISOString(),
    realizedPnlUsd: 0,
    commission: 0,
    strategyId: "HYPE",
    attribution,
  } as TradeHistoryEntry);
  assert.equal(trade.logic, "HYPE");
  assert.equal(trade.logicLabel, "HYPE");
});

test("history and decision navigation keep HYPE but have no excluded route", () => {
  const files = [
    "components/layout/Sidebar.tsx",
    "components/features/HistoryAnalyticsNav.tsx",
    "components/features/DecisionStatusPanel.tsx",
    "app/decision-status/page.tsx",
    "app/history/[logic]/page.tsx",
  ];
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(source, /HYPE/);
  assert.doesNotMatch(source, /ZEC|\/zec\b/i);
});
