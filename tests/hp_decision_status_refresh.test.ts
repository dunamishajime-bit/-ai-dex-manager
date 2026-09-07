import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const source = (path: string) => readFile(resolve(root, path), "utf8");

test("decision status auto-refreshes every 10 minutes", async () => {
  const panel = await source("components/features/DecisionStatusPanel.tsx");
  assert.match(panel, /10 \* 60 \* 1000/);
  assert.match(panel, /自動再確認：10分ごと/);
  assert.doesNotMatch(panel, /3 \* 60 \* 60 \* 1000|自動再確認：3時間ごと/);
});

test("manual refresh bypasses the decision-status cache", async () => {
  const panel = await source("components/features/DecisionStatusPanel.tsx");
  assert.match(panel, /\?refresh=1/);
  const route = await source("app/api/system/decision-status/route.ts");
  assert.match(route, /searchParams\.get\("refresh"\) === "1"/);
});

test("server cache is shorter than the 10-minute UI interval", async () => {
  const status = await source("lib/server/disdex-decision-status.ts");
  assert.match(status, /CACHE_TTL_MS = 2 \* 60 \* 1000/);
  assert.match(status, /refreshIntervalMinutes: 10/);
});

test("runner state remains primary truth when heartbeat is unavailable", async () => {
  const route = await source("app/api/system/decision-status/route.ts");
  assert.doesNotMatch(route, /v12Heartbeat\.status === "UNAVAILABLE"\s*\?\s*"UNAVAILABLE"/);
  assert.match(route, /v12Fresh\s*\?\s*"LIVE"\s*:\s*"STALE"/);
  assert.match(route, /penguRuntime\.status/);
});

test("Quality102 UI reflects the active 1.0x Causal V4 cap", async () => {
  const config = await source("lib/disterminal-live-config.ts");
  const quality = await source("lib/server/quality102-runtime-observability.ts");
  const panel = await source("components/features/DecisionStatusPanel.tsx");
  assert.match(config, /quality102Runtime:[\s\S]*strategyGrossCap: 1/);
  assert.match(quality, /strategyGrossCap: 1/);
  assert.match(panel, /Q102は最大1\.00x/);
});