import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const observer = read("lib/server/fet-runtime-observability.ts");
const route = read("app/api/system/fet-status/route.ts");
const api = read("app/api/system/decision-status/route.ts");
const panel = read("components/features/FetDecisionPanel.tsx");
const overview = read("components/features/DecisionStatusPanel.tsx");
const page = read("app/decision-status/fet/page.tsx");
const home = read("app/page.tsx");
const positions = read("app/positions/page.tsx");
const badge = read("components/layout/LiveRuntimeBadge.tsx");
const sidebar = read("components/layout/Sidebar.tsx");

test("FET has a dedicated page, overview navigation and both dashboard surfaces", () => {
  assert.match(page, /FetDecisionPanel/);
  assert.match(page, /LivePerformanceDashboard logic="FET"/);
  assert.match(overview, /\/decision-status\/fet/);
  assert.match(home, /FetDecisionPanel compact/);
  assert.match(positions, /FetDecisionPanel compact/);
  assert.match(sidebar, /FET/);
  assert.match(badge, /FET_BRK48_RESIDUAL/);
});

test("FET status is served only to authenticated users, read-only, uncached", () => {
  assert.match(route, /disdex_auth/);
  assert.match(route, /loadFetRuntimeObservability/);
  assert.match(route, /private, no-store/);
  assert.match(observer, /tradingMutation: 0/);
  assert.match(api, /runtime\.units\.push/);
  assert.match(api, /id: "FET_BRK48_RESIDUAL"/);
  assert.doesNotMatch(observer + route + panel, /executeMarket\s*\(|cancelOrder\s*\(|placeOrder\s*\(/);
});

test("FET cannot be shown LIVE on stale, mismatched or unverified state", () => {
  assert.match(observer, /fet-brk48-residual\/state\.json/);
  assert.match(observer, /fet-brk48-residual\.json/);
  assert.match(observer, /runtimeCommitSha !== expectedRuntimeSha/);
  assert.match(observer, /Date\.now\(\) - updatedAt > MAX_AGE_MS/);
  assert.match(observer, /heartbeat\.runnerId !== "FET_BRK48_RESIDUAL"/);
  assert.match(observer, /heartbeatSafetyState !== "HEALTHY"/);
  assert.match(observer, /killSwitchActive !== false/);
  assert.match(observer, /manualReview \|\| pending/);
  assert.match(observer, /stopOrderIdRecorded/);
  assert.match(panel, /実注文の照合は別途必要/);
});

test("FET gross comes from current Production config, not a hard-coded UI number", () => {
  assert.match(observer, /CURRENT_CONFIG/);
  assert.match(observer, /configNumber\(config, "maximumGross"\)/);
  assert.match(panel, /snapshot\?\.maximumGross/);
  assert.doesNotMatch(panel, /2\.25x|2\.25/);
});


test("FET detail recomputes BRK48 read-only gates from current Production config and public 1h klines", () => {
  assert.match(observer, /\/fapi\/v3\/klines/);
  assert.match(observer, /lookbackHours/);
  assert.match(observer, /volumeMedianHours/);
  assert.match(observer, /minimumVolumeRatio/);
  assert.match(observer, /decisionEntryHourModulo/);
  assert.match(observer, /signalEligible/);
  assert.match(panel, /FET BRK48 LONG 現在判定/);
  assert.match(panel, /Breakout距離/);
  assert.match(panel, /Volume Ratio/);
  assert.match(panel, /利益保護/);
});

test("decision status and FET detail are mobile-safe for long runtime reasons and identifiers", () => {
  assert.match(overview, /overflow-x-hidden/);
  assert.match(overview, /overflow-wrap:anywhere/);
  assert.match(overview, /grid-cols-\[36px_minmax\(0,1fr\)_56px\]/);
  assert.match(panel, /overflow-x-hidden/);
  assert.match(panel, /overflow-wrap:anywhere/);
  assert.match(page, /overflow-x-hidden/);
});
