import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  resolveV12DecisionSnapshotPath,
  sanitizeV12DecisionSnapshot,
} from "@/lib/v12-decision-snapshot-writer";

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
assert.match(decisionStatus, /readOnly/);
assert.match(decisionStatus, /loadDecisionStatus/);
assert.match(decisionStatus, /type Sleeve = "V12"/);
assert.match(decisionStatus, /ASTER_BASE_URL/);

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
assert.match(v12Observability, /isAbsolute/);

const v12Writer = fs.readFileSync(path.join(root, "lib/v12-decision-snapshot-writer.ts"), "utf8");
assert.match(v12Writer, /V12_DECISION_SNAPSHOT_PATH/);
assert.match(v12Writer, /rename/);
assert.equal(resolveV12DecisionSnapshotPath({ V12_DECISION_SNAPSHOT_PATH: "/var/lib/disdex/v12-x1-all/decision-snapshot.json" }), "/var/lib/disdex/v12-x1-all/decision-snapshot.json");
assert.throws(
  () => resolveV12DecisionSnapshotPath({ V12_DECISION_SNAPSHOT_PATH: ".runtime-state/v12-decision-snapshot.json" }),
  /MUST_BE_ABSOLUTE/,
);
const sanitized = sanitizeV12DecisionSnapshot({
  strategyId: "spoofed",
  symbol: "ethusdt",
  side: "LONG",
  rank: 1,
  score: 4.2,
  momentum: 0.12,
  volumeRatio: 1.4,
  btcRegime: "LONG",
  candidates: [
    { symbol: "eth", rank: 1, score: 4.2, momentum: 0.12, volumeRatio: 1.4, privateKey: "must-not-escape" },
    { symbol: "sol", score: 2.1 },
  ],
}, () => 1_750_000_000_000);
assert.equal(sanitized.strategyId, "V12_X1.00_ALL");
assert.equal(sanitized.candidates.length, 2);
assert.equal(sanitized.candidates[0].rank, 1);
assert.equal(sanitized.candidates[1].rank, undefined);
assert.equal("privateKey" in sanitized, false);
assert.equal("privateKey" in sanitized.candidates[0], false);

const strategyTypes = fs.readFileSync(path.join(root, "lib/trade-history-types.ts"), "utf8");
assert.match(strategyTypes, /PENGU_V2/);
assert.match(asterHistory, /strategyId: strategyForSymbol/);

console.log("DISTERMINAL_READONLY_SURFACE_SELFTEST_PASS");
