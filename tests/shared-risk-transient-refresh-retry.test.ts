import assert from "node:assert/strict";
import test from "node:test";

import { runSharedRiskRefreshLoop } from "@/lib/disdex-shared-crypto-risk-refresh-loop";

test("daemon retries a transient refresh failure without terminating", async () => {
  let calls = 0;
  let stop = false;
  const waits: number[] = [];
  const failures: number[] = [];
  const successes: string[] = [];
  let now = 1_000;

  const result = await runSharedRiskRefreshLoop({
    daemon: true,
    intervalMs: 30_000,
    retryMs: 5_000,
    now: () => now,
    shouldStop: () => stop,
    wait: async (ms) => { waits.push(ms); now += ms; },
    refresh: async () => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed");
      return "ok";
    },
    onFailure: (_error, context) => { failures.push(context.consecutiveFailures); },
    onSuccess: (value) => {
      successes.push(value);
      stop = true;
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [5_000]);
  assert.deepEqual(failures, [1]);
  assert.deepEqual(successes, ["ok"]);
  assert.equal(result.successes, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.consecutiveFailures, 0);
});

test("daemon keeps retrying consecutive failures using the bounded retry cadence", async () => {
  let calls = 0;
  let stop = false;
  const waits: number[] = [];
  const contexts: number[] = [];

  const result = await runSharedRiskRefreshLoop({
    daemon: true,
    intervalMs: 30_000,
    retryMs: 5_000,
    shouldStop: () => stop,
    wait: async (ms) => { waits.push(ms); },
    refresh: async () => {
      calls += 1;
      throw new Error("fetch failed");
    },
    onFailure: (_error, context) => {
      contexts.push(context.consecutiveFailures);
      if (context.consecutiveFailures === 3) stop = true;
    },
    onSuccess: () => { throw new Error("unexpected success"); },
  });

  assert.equal(calls, 3);
  assert.deepEqual(waits, [5_000, 5_000]);
  assert.deepEqual(contexts, [1, 2, 3]);
  assert.equal(result.successes, 0);
  assert.equal(result.failures, 3);
  assert.equal(result.consecutiveFailures, 3);
});

test("one-shot mode still surfaces refresh failure to the caller", async () => {
  await assert.rejects(
    runSharedRiskRefreshLoop({
      daemon: false,
      intervalMs: 30_000,
      retryMs: 5_000,
      shouldStop: () => false,
      wait: async () => undefined,
      refresh: async () => { throw new Error("fetch failed"); },
      onFailure: () => undefined,
      onSuccess: () => undefined,
    }),
    /fetch failed/,
  );
});
