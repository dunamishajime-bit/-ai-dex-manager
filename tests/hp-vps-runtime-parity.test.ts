import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getTradeHistory } from "../app/api/system/trade-history/route";
import { assessRuntimeLineage, type CurrentProductionRuntime } from "../lib/server/current-production-runtime";

const releaseSha = "a".repeat(40);
const now = 1_800_000_000_000;

function lineage(overrides: Partial<CurrentProductionRuntime["runtimeLineage"]["units"]["v12"]> = {}): CurrentProductionRuntime["runtimeLineage"] {
  const unit = { runtimeSha: releaseSha, expectedSha: releaseSha, updatedAt: now, matchesCurrent: true, ...overrides };
  return {
    synchronized: true,
    units: { v12: unit, pengu: unit, quality102: unit, v52: unit, fet: unit, hype: unit },
  };
}

test("decision status reads current VPS runtime and refreshes every 30 seconds", async () => {
  const [server, route] = await Promise.all([
    readFile("lib/server/disdex-decision-status.ts", "utf8"),
    readFile("app/api/system/decision-status/route.ts", "utf8"),
  ]);
  assert.match(server, /loadCurrentProductionRuntime/);
  assert.match(server, /CACHE_TTL_MS = 25_000/);
  assert.match(server, /runtimeSnapshot\(checkedAt, currentRuntime\)/);
  assert.match(route, /loadV12V4HpObservability/);
  assert.match(route, /v12V4/);
  assert.match(route, /private, no-store, max-age=0/);
});

test("trade history keeps official Aster provenance in the read-only API contract", async () => {
  const [route, history] = await Promise.all([
    readFile("app/api/system/trade-history/route.ts", "utf8"),
    readFile("lib/server/aster-trade-history.ts", "utf8"),
  ]);
  assert.match(route, /historySource/);
  assert.match(route, /officialHistory/);
  assert.match(route, /historyRange: "90d"/);
  assert.match(history, /source: "aster"/);
  assert.match(history, /Aster official fill/);
});

test("runtime lineage fails closed for SHA mismatch, stale, future, and missing heartbeats", () => {
  assert.equal(assessRuntimeLineage(lineage(), now).synchronized, true);
  assert.match(assessRuntimeLineage(lineage({ runtimeSha: "b".repeat(40), matchesCurrent: false }), now).errors.join(" / "), /RUNTIME_SHA_MISMATCH/);
  assert.match(assessRuntimeLineage(lineage({ updatedAt: now - 3 * 60 * 60 * 1000 - 1 }), now).errors.join(" / "), /STALE/);
  assert.match(assessRuntimeLineage(lineage({ updatedAt: now + 1 }), now).errors.join(" / "), /FUTURE/);
  assert.match(assessRuntimeLineage(lineage({ updatedAt: undefined }), now).errors.join(" / "), /MISSING/);
  assert.equal(assessRuntimeLineage(lineage({ error: "ENOENT" }), now).synchronized, false);
});

test("anonymous trade history fails closed before exposing runtime lineage", async () => {
  const response = await getTradeHistory(new NextRequest("http://localhost/api/system/trade-history"));
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.readOnly, true);
  assert.equal(body.tradingMutation, 0);
  assert.equal("runtime" in body, false);
  assert.match(response.headers.get("Cache-Control") || "", /private/);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});
