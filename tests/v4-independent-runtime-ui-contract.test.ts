import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("current runtime accepts an independently promoted V4 primary SHA bound to the current peer", () => {
  const source = read("lib/server/current-production-runtime.ts");
  assert.match(source, /DISDEX_V12_V4_PRIMARY_SHA/);
  assert.match(source, /DISDEX_V12_V4_PEER_SHA/);
  assert.match(source, /CURRENT_V12_PRIMARY_LINEAGE_MISMATCH/);
  assert.match(source, /v12ExpectedSha/);
  assert.match(source, /runtimeSha === v12ExpectedSha && expectedSha === v12ExpectedSha/);
});

test("read-only runner health remains available alongside V4 observability", () => {
  const source = read("app/api/system/runner-health/route.ts");
  assert.match(source, /tradingMutation: 0/);
  assert.match(source, /disdex-v12-v4/);
  assert.match(source, /V4_PINNED_SHA_UNVERIFIED/);
  assert.match(source, /VPS_CURRENT_SYSTEMD/);
});

test("live decision refresh route remains a non-trading cache operation", () => {
  const source = read("app/api/system/auto-trade/refresh-live-decision-cache/route.ts");
  assert.match(source, /refreshActiveLiveDecisionCache/);
  assert.match(source, /stale: false/);
  assert.doesNotMatch(source, /placeMarket|submitOrder|cancelOrder/);
});
