import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
