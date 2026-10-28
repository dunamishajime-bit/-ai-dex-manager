import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRunnerTickHeartbeat } from "../scripts/ops/root/disdex-runner-tick-heartbeat.mjs";

const sha = "c".repeat(40);
const runner = {
  runnerId: "V12_V4",
  expectedSha: sha,
  unit: `disdex-v12-v4@${sha}.service`,
  tickMaxAgeMs: 5_000,
};

function marker(overrides = {}) {
  return {
    schema: "disdex-runner-tick-heartbeat/v1",
    runnerId: runner.runnerId,
    runtimeSha: sha,
    serviceUnit: runner.unit,
    tickStartedAt: 9_000,
    tickCompletedAt: 9_500,
    status: "no-signal",
    reason: "NO_NATIVE_ENTRY_CANDIDATES",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    ...overrides,
  };
}

test("accepts a fresh marker and exposes its completed tick", () => {
  const result = validateRunnerTickHeartbeat(runner, marker(), 10_000);
  assert.equal(result.valid, true);
  assert.equal(result.fresh, true);
  assert.equal(result.reason, "");
  assert.equal(result.ageMs, 500);
});

test("rejects marker lineage, service, future, and stale mismatches", () => {
  assert.equal(validateRunnerTickHeartbeat(runner, marker({ runtimeSha: "d".repeat(40) }), 10_000).reason, "RUNNER_TICK_HEARTBEAT_RUNTIME_SHA_MISMATCH");
  assert.equal(validateRunnerTickHeartbeat(runner, marker({ runnerId: "PENGU_V8" }), 10_000).reason, "RUNNER_TICK_HEARTBEAT_RUNNER_ID_MISMATCH");
  assert.equal(validateRunnerTickHeartbeat(runner, marker({ serviceUnit: "wrong.service" }), 10_000).reason, "RUNNER_TICK_HEARTBEAT_SERVICE_UNIT_MISMATCH");
  assert.equal(validateRunnerTickHeartbeat(runner, marker({ tickCompletedAt: 70_001 }), 10_000).reason, "RUNNER_TICK_HEARTBEAT_FUTURE");
  assert.equal(validateRunnerTickHeartbeat(runner, marker({ tickStartedAt: 3_000, tickCompletedAt: 4_000 }), 10_000).reason, "RUNNER_TICK_HEARTBEAT_STALE");
  assert.equal(validateRunnerTickHeartbeat(runner, undefined, 10_000).reason, "RUNNER_TICK_HEARTBEAT_MISSING");
});

test("does not treat a no-signal or held status as stale when the marker is fresh", () => {
  for (const status of ["no-signal", "held", "locked"]) {
    const result = validateRunnerTickHeartbeat(runner, marker({ status }), 10_000);
    assert.equal(result.valid, true, status);
    assert.equal(result.fresh, true, status);
  }
});

test("read-only snapshot reader distinguishes missing and fresh marker files", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-health-tick-"));
  process.env.DISDEX_HEALTH_SNAPSHOT_TICK_ROOT = root;
  const { readRunnerTickHeartbeat } = await import("../scripts/ops/root/disdex-runner-health-snapshot-current.mjs");
  const missing = await readRunnerTickHeartbeat(runner, 10_000);
  assert.equal(missing.present, false);
  assert.equal(missing.reason, "RUNNER_TICK_HEARTBEAT_MISSING");
  await writeFile(join(root, "V12_V4.json"), `${JSON.stringify(marker())}\n`, "utf8");
  const fresh = await readRunnerTickHeartbeat(runner, 10_000);
  assert.equal(fresh.present, true);
  assert.equal(fresh.valid, true);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.marker.tickCompletedAt, 9_500);
});
