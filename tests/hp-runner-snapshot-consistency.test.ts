import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical runner snapshot is atomic, authenticated, and keeps supervisor time separate from decision time", async () => {
  const [snapshotSource, alertSource, routeSource] = await Promise.all([
    readFile("scripts/ops/root/disdex-runner-health-snapshot-current.mjs", "utf8"),
    readFile("scripts/ops/root/disdex-runner-health-alert.ts", "utf8"),
    readFile("app/api/system/runner-health/route.ts", "utf8").catch(() => ""),
  ]);

  assert.match(snapshotSource, /randomUUID\(\)/, "health snapshot publication must not reuse PID+millisecond temp names");
  assert.match(snapshotSource, /flag:\s*["']wx["']/, "health snapshot temp files must be exclusive");
  assert.match(snapshotSource, /disdex-runner-health-snapshot\/v1/, "HP must consume a versioned canonical snapshot");
  assert.match(snapshotSource, /current\.json/, "canonical snapshot must have one stable source path");
  assert.match(snapshotSource, /heartbeatAt/);
  assert.match(snapshotSource, /lastTickAt/);
  assert.match(snapshotSource, /runnerOrderPermissions/);
  assert.match(snapshotSource, /q102/);
  assert.match(snapshotSource, /routeCount/);
  assert.match(snapshotSource, /pending/);
  assert.match(snapshotSource, /cryptoGross/);
  assert.match(snapshotSource, /stockGross/);

  assert.match(alertSource, /lastTickAt/);
  assert.match(alertSource, /expectedSha/);
  assert.match(alertSource, /healthReason/);
  assert.match(alertSource, /tickAgeMs/);
  assert.match(alertSource, /randomUUID\(\)/, "alert state publication must be collision-resistant");
  assert.match(alertSource, /flag:\s*["']wx["']/);

  assert.notEqual(routeSource, "", "authenticated HP runner-health route must exist");
  assert.match(routeSource, /disdex_auth/);
  assert.match(routeSource, /status:\s*401/);
  assert.match(routeSource, /disdex-runner-health-snapshot\/v1/);
  assert.match(routeSource, /status:\s*503/);
});

test("HP source does not authorize anonymous or stale/anonymous snapshot data", async () => {
  const [routeSource, idleRouteSource] = await Promise.all([
    readFile("app/api/system/runner-health/route.ts", "utf8"),
    readFile("app/api/system/idle-priority-status/route.ts", "utf8"),
  ]);
  assert.match(routeSource, /cache-control/i);
  assert.match(routeSource, /no-store/i);
  assert.match(idleRouteSource, /disdex_auth/);
  assert.match(idleRouteSource, /status:\s*401/);
});
