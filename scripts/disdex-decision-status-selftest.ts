import assert from "node:assert/strict";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { normalizeDecisionStatusSnapshot } from "@/lib/server/disdex-decision-status";

const now = Date.parse("2026-08-10T00:00:00.000Z");
const makeItem = (symbol: string, sleeve: "PENGU" | "V52") => ({
  symbol,
  sleeve,
  rank: 1,
  score: 7,
  scoreMax: 10,
  status: "候補に近い",
  side: sleeve === "PENGU" ? "LONG" : "WAIT",
  reason: "テスト用の読み取り専用判定理由",
  checkedAt: "2026-08-09T23:30:00.000Z",
  source: "self-test",
});

const raw = {
  schemaVersion: 1,
  strategyId: config.strategyId,
  checkedAt: "2026-08-09T23:30:00.000Z",
  source: "self-test",
  pengu: { items: config.cryptoSymbols.map((symbol) => makeItem(symbol, "PENGU")) },
  v52: { marketOpen: false, marketLabel: "self-test", items: config.stockSymbols.map((symbol) => makeItem(symbol, "V52")) },
};
const valid = normalizeDecisionStatusSnapshot(raw, now);

assert.equal(valid?.dataAvailable, true);
assert.equal(valid?.readOnly, true);
assert.equal(valid?.pengu.items[0]?.status, "候補に近い");
assert.equal(normalizeDecisionStatusSnapshot({ ...raw, strategyId: "legacy_paused" }, now), null);
assert.equal(normalizeDecisionStatusSnapshot({ ...raw, checkedAt: "2026-08-09T20:00:00.000Z" }, now), null);
assert.equal(normalizeDecisionStatusSnapshot({ ...raw, pengu: { items: [{ ...makeItem("UNKNOWN", "PENGU") }] } }, now), null);

console.log("DISDEX_DECISION_STATUS_SELFTEST_PASS");
console.log("readOnly=true");
console.log("invalidStrategyRejected=true");
console.log("staleSnapshotRejected=true");
console.log("unknownSymbolRejected=true");
