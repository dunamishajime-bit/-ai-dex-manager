import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
