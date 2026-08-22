import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routes = [
  "app/api/system/auto-trade/manual-run/route.ts",
  "app/api/system/auto-trade/run/route.ts",
  "app/api/system/auto-trade/pengu-strong-run/route.ts",
  "app/api/trade/route.ts",
  "app/api/trade/execute/route.ts",
];

const forbidden = [
  "runActiveAutoTrade",
  "runPenguStrongOverrideAutotrade",
  "privateKeyToAccount",
  "sendTransaction",
  "placeOrder",
  "cancelOrder",
];

for (const route of routes) {
  const source = fs.readFileSync(path.join(root, route), "utf8");
  assert.match(source, /disabledTradingRouteResponse/);
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `${route} must not reference ${token}`);
  }
}

const guard = fs.readFileSync(path.join(root, "lib/server/disabled-trading-route.ts"), "utf8");
assert.match(guard, /status:\s*410/);
assert.match(guard, /ordersSent:\s*false/);
assert.match(guard, /readOnly:\s*true/);

const decisionStatus = fs.readFileSync(path.join(root, "lib/server/disdex-decision-status.ts"), "utf8");
assert.equal(decisionStatus.includes("/fapi/v3/klines"), false);
assert.equal(decisionStatus.includes("fetchKlines"), false);
assert.match(decisionStatus, /PENGU_DUAL_LS_V2_FINAL/);
assert.match(decisionStatus, /pengu-dual-ls-v2-final\/runner-live\.json/);
assert.match(decisionStatus, /disdex-v96-v52-live\.service/);
assert.match(decisionStatus, /過去データから推測表示しません/);

const asterHistory = fs.readFileSync(path.join(root, "lib/server/aster-trade-history.ts"), "utf8");
for (const symbol of ["LINKUSDT", "AVAXUSDT", "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT", "AAVEUSDT", "NEARUSDT"]) {
  assert.equal(asterHistory.includes(`\"${symbol}\"`), true, `Aster history must include ${symbol}`);
}
assert.match(asterHistory, /strategyLabelForSymbol/);
assert.match(asterHistory, /PENGU_V2/);

const v12SnapshotRoute = fs.readFileSync(path.join(root, "app/api/system/v12-decision-snapshot/route.ts"), "utf8");
const v12Observability = fs.readFileSync(path.join(root, "lib/server/v12-decision-observability.ts"), "utf8");
assert.match(v12SnapshotRoute, /export async function GET/);
assert.match(v12SnapshotRoute, /tradingMutation:\s*0/);
assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(v12SnapshotRoute), false);
for (const token of forbidden) {
  assert.equal(v12SnapshotRoute.includes(token), false, `V12 decision route must not reference ${token}`);
  assert.equal(v12Observability.includes(token), false, `V12 observability must not reference ${token}`);
}
assert.match(v12Observability, /readFile/);
assert.match(v12Observability, /getPositionRisk/);
assert.match(v12Observability, /tradingMutation:\s*0/);

console.log("DISTERMINAL_READONLY_SURFACE_SELFTEST_PASS");
