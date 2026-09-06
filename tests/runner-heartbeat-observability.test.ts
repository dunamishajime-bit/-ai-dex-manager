import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { loadRunnerHeartbeatObservability } from "../lib/server/runner-heartbeat-observability";

test("fresh HEALTHY LIVE heartbeat is reported as LIVE with its runtime SHA", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-runner-heartbeat-"));
  const heartbeatPath = join(directory, "heartbeat.json");
  const now = Date.now();
  await writeFile(heartbeatPath, JSON.stringify({
    runnerId: "V12_X1_ALL",
    runtimeSha: "1094ebf",
    expectedSha: "1094ebf",
    mode: "LIVE",
    liveEnabled: true,
    safetyState: "HEALTHY",
    heartbeatAt: now,
    status: "capacity-blocked",
  }));

  try {
    const result = await loadRunnerHeartbeatObservability(heartbeatPath, "V12_X1_ALL", now);
    assert.equal(result.status, "LIVE");
    assert.equal(result.runtimeSha, "1094ebf");
    assert.equal(result.releaseShaVerified, true);
    assert.equal(result.runnerStatus, "capacity-blocked");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("heartbeat fails closed when runtime SHA differs from the expected deployed SHA", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-runner-heartbeat-"));
  const heartbeatPath = join(directory, "heartbeat.json");
  const now = Date.now();
  await writeFile(heartbeatPath, JSON.stringify({
    runnerId: "PENGU_V8",
    runtimeSha: "old-sha",
    expectedSha: "new-sha",
    mode: "LIVE",
    liveEnabled: true,
    safetyState: "HEALTHY",
    heartbeatAt: now,
  }));

  try {
    const result = await loadRunnerHeartbeatObservability(heartbeatPath, "PENGU_V8", now);
    assert.equal(result.status, "STALE");
    assert.equal(result.releaseShaVerified, false);
    assert.match(result.reason, /SHA/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
