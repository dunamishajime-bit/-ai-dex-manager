import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HISTORICAL_FILL_LINEAGE_BY_ORDER_ID } from "../lib/server/historical-fill-lineage";
import { deriveTradeHistoryAttribution, formatTradeHistoryAttributionLabel } from "../lib/trade-history-attribution";

const files = {
  api: readFileSync("app/api/system/live-performance/route.ts", "utf8"),
  dashboard: readFileSync("components/features/LivePerformanceDashboard.tsx", "utf8"),
  nav: readFileSync("components/features/HistoryAnalyticsNav.tsx", "utf8"),
  sidebar: readFileSync("components/layout/Sidebar.tsx", "utf8"),
  performance: readFileSync("app/performance/page.tsx", "utf8"),
  history: readFileSync("app/history/page.tsx", "utf8"),
  overview: readFileSync("components/features/LivePerformanceOverviewCharts.tsx", "utf8"),
};

test("LIVE performance UI is sourced from actual production analytics, never BT artifacts", () => {
  const combined = Object.values(files).join("\n");
  assert.match(files.api, /loadLivePerformanceAnalytics/);
  assert.match(files.dashboard, /Aster公式の実約定/);
  assert.doesNotMatch(combined, /final-live-governor-monthly-breakdown|research-results|backtest-performance/i);
});

test("existing performance page includes live total asset and PnL charts", () => {
  assert.match(files.performance, /LivePerformanceOverviewCharts/);
});

test("trade history and performance analytics render monetary values in JPY", () => {
  assert.match(files.history, /formatJpyFromUsd/);
  assert.doesNotMatch(files.history, /function formatUsd/);
  assert.match(files.dashboard, /formatJpyMoney/);
  assert.match(files.dashboard, /useCurrency/);
  assert.match(files.overview, /formatJpyMoney/);
  assert.match(files.overview, /useCurrency/);
});

test("trade history exposes total and per-logic performance children", () => {
  for (const path of [
    "/history/performance",
    "/history/v12",
    "/history/pengu",
    "/history/q102",
    "/history/fet",
    "/history/v52",
  ]) {
    assert.ok(files.nav.includes(path), path);
    assert.ok(files.sidebar.includes(path), path);
  }
});

test("V12 V4 UI rollout does not relabel historical V12 Aster fills", () => {
  const entry = HISTORICAL_FILL_LINEAGE_BY_ORDER_ID["1045562381"];
  assert.equal(entry.strategyId, "V12_X1.00_ALL");
  const attribution = deriveTradeHistoryAttribution({
    source: "local-ledger",
    strategyId: String(entry.strategyId),
    reason: String(entry.reason),
  });
  assert.equal(formatTradeHistoryAttributionLabel({ strategyId: String(entry.strategyId), attribution }), "ロジック発火: V12");
});
