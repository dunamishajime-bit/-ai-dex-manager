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

test("HP and operator activation use the same explicit deployment/operator target identity", async () => {
  const [routeSource, snapshotSource, wiringSource, targetSource, evidenceSource, gateSource] = await Promise.all([
    readFile("app/api/system/runner-health/route.ts", "utf8"),
    readFile("scripts/ops/root/disdex-runner-health-snapshot-current.mjs", "utf8"),
    readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8"),
    readFile("docs/production/current-live-target.json", "utf8"),
    readFile("scripts/ops/root/disdex-multisha-release-evidence.mjs", "utf8"),
    readFile("scripts/ops/root/disdex-live-operator-activation-gate.mjs", "utf8"),
  ]);
  const target = JSON.parse(targetSource) as {
    deploymentTarget?: string;
    operatorTarget?: string;
    formalBacktest?: { selectedCase?: string };
  };

  assert.equal(target.deploymentTarget, "professional-dismanager.net");
  assert.equal(target.operatorTarget, target.formalBacktest?.selectedCase);
  assert.match(snapshotSource, /DISDEX_HEALTH_SNAPSHOT_DEPLOYMENT_TARGET/);
  assert.match(snapshotSource, /DISDEX_HEALTH_SNAPSHOT_OPERATOR_TARGET/);
  assert.match(snapshotSource, /targetIdentity/);
  assert.match(routeSource, /DISDEX_HP_DEPLOYMENT_TARGET/);
  assert.match(routeSource, /DISDEX_HP_OPERATOR_TARGET/);
  assert.match(routeSource, /TARGET_IDENTITY_MISMATCH/);
  assert.match(wiringSource, /DEPLOYMENT_TARGET="professional-dismanager\.net"/);
  assert.match(wiringSource, /DISDEX_HEALTH_SNAPSHOT_DEPLOYMENT_TARGET=\$\{DEPLOYMENT_TARGET\}/);
  assert.match(wiringSource, /DISDEX_HEALTH_SNAPSHOT_OPERATOR_TARGET=\$\{OPERATOR_TARGET\}/);
  assert.match(evidenceSource, /operatorTarget/);
  assert.match(gateSource, /target/);
});
