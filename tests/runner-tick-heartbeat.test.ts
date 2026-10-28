import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runnerTickHeartbeatPath,
  writeRunnerTickHeartbeat,
} from "../lib/disdex-runner-tick-heartbeat";

const SHA = "a".repeat(40);
const UNIT = `disdex-v12-v4@${SHA}.service`;

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
    reason: "NO_NATIVE_ENTRY_CANDIDATES",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  });

  assert.equal(marker.schema, "disdex-runner-tick-heartbeat/v1");
  assert.equal(marker.runnerId, "V12_V4");
  assert.equal(marker.runtimeSha, SHA);
  assert.equal(marker.serviceUnit, UNIT);
  assert.equal(marker.tickCompletedAt, 1_250);
  assert.equal(await readFile(runnerTickHeartbeatPath(root, "V12_V4"), "utf8"), `${JSON.stringify(marker, null, 2)}\n`);
  assert.deepEqual(await readdir(join(root, "ticks")), ["V12_V4.json"]);
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
    reason: "PENGU_OPEN_ORDER_HOLD",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  } as const;
  await writeRunnerTickHeartbeat(common);
  const second = await writeRunnerTickHeartbeat({ ...common, tickCompletedAt: 2_500, reason: "PENGU_RATE_BUDGET_DEFERRED" });
  assert.equal(second.tickCompletedAt, 2_500);
  assert.deepEqual(await readdir(join(root, "ticks")), ["PENGU_V8.json"]);
  assert.match(await readFile(join(root, "ticks", "PENGU_V8.json"), "utf8"), /PENGU_RATE_BUDGET_DEFERRED/);
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
