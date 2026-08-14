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
assert.match(decisionStatus, /stock\/runner-live\.json/);
assert.match(decisionStatus, /RUNNER_HEARTBEAT_MAX_AGE_MS/);
assert.match(decisionStatus, /BLOCKED_DATA_UNAVAILABLE/);
assert.match(decisionStatus, /判定未出力/);
assert.match(decisionStatus, /V52実Runner・参照データGate・注文許可は正常です/);
assert.match(decisionStatus, /WAITING_MARKET_CLOSED/);
assert.match(decisionStatus, /refreshIntervalMinutes: 1/);
assert.match(decisionStatus, /disdex-v96-v52-live\.service/);
assert.match(decisionStatus, /過去データから推測表示しません/);

console.log("DISTERMINAL_READONLY_SURFACE_SELFTEST_PASS");
