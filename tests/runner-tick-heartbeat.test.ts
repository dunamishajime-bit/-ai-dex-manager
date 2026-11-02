import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runnerTickHeartbeatPath,
  runnerTickHeartbeatTemporaryPath,
  writeRunnerTickHeartbeat,
} from "../lib/disdex-runner-tick-heartbeat";

const SHA = "a".repeat(40);
const UNIT = `disdex-v12-v4@${SHA}.service`;

test("tick filenames match the deployed runner pin contract", () => {
  const mappings: Record<string, string> = {
    V12_V4: "v12-v4.json", V12_V4_MONITOR: "v12-v4-monitor.json",
    PENGU_V8: "pengu-v8.json", QUALITY102_CAUSAL_V1: "quality102-causal-v1.json",
    V52: "v52.json", FET_BRK48_RESIDUAL: "fet-brk48-residual.json",
    HYPE_TREND_LONG: "hype-trend-long.json", IDLE_PRIORITY_SHORT: "idle-priority-short.json",
  };
  for (const [runner, file] of Object.entries(mappings)) {
    assert.equal(runnerTickHeartbeatPath("root", runner), join("root", "ticks", file));
  }
});

test("a V4 writer marker is accepted by the supervisor identity validator", async () => {
  const { validateRunnerTick } = await import("../scripts/ops/root/disdex-runner-health-snapshot-v2.mjs");
  const root = await mkdtemp(join(tmpdir(), "disdex-v4-contract-"));
  const now = Date.now();
  const cwd = `/home/deploy/disdex-trading/releases/${SHA}`;
  const marker = await writeRunnerTickHeartbeat({ root, runnerId: "V12_V4", runtimeSha: SHA,
    serviceUnit: UNIT, workingDirectory: cwd, mainPid: 4321, tickStartedAt: now - 10,
    tickCompletedAt: now, status: "no-signal", newOrdersAllowed: false });
  const parsed = JSON.parse(await readFile(join(root, "ticks", "v12-v4.json"), "utf8"));
  assert.deepEqual(parsed, marker);
  assert.equal(validateRunnerTick(parsed, { runnerId: "V12_V4", pin: { sha: SHA,
    serviceUnit: UNIT, releaseRoot: cwd }, pid: 4321, cwd, now }).tickCompletedAt, now);
});

test("writes an atomic runner tick marker with the release identity and counters", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-runner-tick-"));
  const marker = await writeRunnerTickHeartbeat({
    root,
    runnerId: "V12_V4",
    runtimeSha: SHA,
    serviceUnit: UNIT,
    tickStartedAt: 1_000,
    tickCompletedAt: 1_250,
    status: "no-signal",
    newOrdersAllowed: false,
    reason: "NO_NATIVE_ENTRY_CANDIDATES",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  });

  assert.equal(marker.schema, "disdex-runner-tick/v1");
  assert.equal(marker.runnerId, "V12_V4");
  assert.equal(marker.runtimeSha, SHA);
  assert.equal(marker.expectedSha, SHA);
  assert.equal(marker.serviceUnit, UNIT);
  assert.equal(marker.mainPid, process.pid);
  assert.equal(marker.workingDirectory, process.cwd());
  assert.equal(marker.outcome, "no-signal");
  assert.equal(marker.newOrdersAllowed, false);
  assert.equal(marker.tickCompletedAt, 1_250);
  assert.equal(await readFile(runnerTickHeartbeatPath(root, "V12_V4"), "utf8"), `${JSON.stringify(marker, null, 2)}\n`);
  assert.deepEqual(await readdir(join(root, "ticks")), ["v12-v4.json"]);
});

test("replaces an existing marker without leaving temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-runner-tick-"));
  const common = {
    root,
    runnerId: "PENGU_V8",
    runtimeSha: SHA,
    serviceUnit: `disdex-pengu-dual-ls-v2@${SHA}.service`,
    tickStartedAt: 2_000,
    tickCompletedAt: 2_001,
    status: "held",
    newOrdersAllowed: false,
    reason: "PENGU_OPEN_ORDER_HOLD",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  } as const;
  await writeRunnerTickHeartbeat(common);
  const second = await writeRunnerTickHeartbeat({ ...common, tickCompletedAt: 2_500, reason: "PENGU_RATE_BUDGET_DEFERRED" });
  assert.equal(second.tickCompletedAt, 2_500);
  assert.deepEqual(await readdir(join(root, "ticks")), ["pengu-v8.json"]);
  assert.match(await readFile(join(root, "ticks", "pengu-v8.json"), "utf8"), /PENGU_RATE_BUDGET_DEFERRED/);
});

test("requires explicit order permission and rejects SHA identity drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-runner-tick-"));
  await assert.rejects(() => writeRunnerTickHeartbeat({
    root, runnerId: "V12_V4", runtimeSha: SHA, serviceUnit: UNIT,
    tickStartedAt: 1_000, tickCompletedAt: 1_250, status: "observing",
    reason: "MONITOR", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0,
  } as any), /PERMISSION_INVALID/);
  await assert.rejects(() => writeRunnerTickHeartbeat({
    root, runnerId: "V12_V4", runtimeSha: SHA, expectedSha: "b".repeat(40),
    serviceUnit: UNIT, tickStartedAt: 1_000, tickCompletedAt: 1_250,
    status: "observing", newOrdersAllowed: false, reason: "MONITOR",
    ordersSent: 0, cancelsSent: 0, positionChangesSent: 0,
  }), /EXPECTED_SHA_MISMATCH/);
});

test("same-PID same-millisecond writers use independent temporary inodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-runner-tick-collision-"));
  const finalPath = runnerTickHeartbeatPath(root, "V52");
  const temporaryPaths = Array.from({ length: 80 }, () => runnerTickHeartbeatTemporaryPath(finalPath));
  assert.equal(new Set(temporaryPaths).size, temporaryPaths.length);
  assert.ok(temporaryPaths.every((temporaryPath) => temporaryPath.endsWith(".tmp")));
});

test("80 concurrent writes leave one complete marker without temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-runner-tick-80-"));
  const common = { root, runnerId: "V12_V4", runtimeSha: SHA, serviceUnit: UNIT,
    tickStartedAt: 1_000, tickCompletedAt: 1_001, status: "no-signal", newOrdersAllowed: false } as const;
  await Promise.all(Array.from({ length: 80 }, (_, i) => writeRunnerTickHeartbeat({ ...common, reason: `cycle-${i}` })));
  const files = await readdir(join(root, "ticks"));
  assert.deepEqual(files, ["v12-v4.json"]);
  const marker = JSON.parse(await readFile(join(root, "ticks", "v12-v4.json"), "utf8"));
  assert.match(marker.reason, /^cycle-\d+$/);
  assert.equal(marker.runtimeSha, SHA);
});

test("rejects invalid identity, timestamps, and mutation counters", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-runner-tick-"));
  await assert.rejects(() => writeRunnerTickHeartbeat({
    root,
    runnerId: "V12_V4",
    runtimeSha: "not-a-sha",
    serviceUnit: UNIT,
    tickStartedAt: 1_000,
    tickCompletedAt: 1_250,
    status: "locked",
    newOrdersAllowed: false,
    reason: "LOCK_BUSY",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  await assert.rejects(() => writeRunnerTickHeartbeat({
    root,
    runnerId: "V12_V4",
    runtimeSha: SHA,
    serviceUnit: UNIT,
    tickStartedAt: 1_250,
    tickCompletedAt: 1_000,
    status: "locked",
    newOrdersAllowed: false,
    reason: "LOCK_BUSY",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  await assert.rejects(() => writeRunnerTickHeartbeat({
    root,
    runnerId: "V12_V4",
    runtimeSha: SHA,
    serviceUnit: UNIT,
    tickStartedAt: 1_000,
    tickCompletedAt: 1_250,
    status: "locked",
    newOrdersAllowed: false,
    reason: "LOCK_BUSY",
    ordersSent: -1,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  await assert.rejects(() => writeRunnerTickHeartbeat({
    root,
    runnerId: "V12_V4",
    runtimeSha: SHA,
    serviceUnit: UNIT,
    tickStartedAt: 0,
    tickCompletedAt: 1_250,
    status: "locked",
    newOrdersAllowed: false,
    reason: "LOCK_BUSY",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  await assert.rejects(() => writeRunnerTickHeartbeat({
    root,
    runnerId: [] as any,
    runtimeSha: SHA,
    serviceUnit: UNIT,
    tickStartedAt: 1_000,
    tickCompletedAt: 1_250,
    status: "locked",
    newOrdersAllowed: false,
    reason: "LOCK_BUSY",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    } as any));
});

test("all TypeScript production Runner loops record their completed tick", () => {
  const entrypoints = [
    "scripts/v12-v4-production-runner.ts",
    "scripts/disdex-v12-x1-all-live-runner.ts",
    "scripts/disdex-pengu-dual-ls-v2-live-runner.ts",
    "scripts/disdex-quality102-causal-v1-live-runner.ts",
    "scripts/disdex-fet-brk48-live-runner.ts",
    "scripts/disdex-hype-zec-long-live-runner.ts",
    "scripts/disdex-idle-priority-short-live-runner.ts",
  ];
  for (const entrypoint of entrypoints) {
    const source = readFileSync(entrypoint, "utf8");
    assert.match(source, /writeRunnerTickHeartbeat/);
    assert.match(source, /tickStartedAt/);
    assert.match(source, /tickCompletedAt/);
  }
});
