import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileHypeZecLongRunnerStateStore, heartbeatHypeZecRateBudgetDeferral } from "../lib/hype-zec-long-runner-state";

test("HYPE/ZEC state store writes an exact SHA-owned 0600 regular file", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-state-"));
  const path = join(root, "runner.json");
  const sha = "a".repeat(40);
  const store = new FileHypeZecLongRunnerStateStore(path, sha, "LIVE");
  const state = await store.load();
  state.lastDecisionTs = 123;
  await store.save(state);
  const metadata = await stat(path);
  assert.equal(metadata.isFile(), true);
  if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).runtimeCommitSha, sha);
});

test("HYPE pending recovery retains the approved gross, reservation, and score provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-approved-"));
  const path = join(root, "runner.json");
  const store = new FileHypeZecLongRunnerStateStore(path, "a".repeat(40), "LIVE");
  const state = await store.load();
  state.pending = { idempotencyKey: "hype-entry", clientOrderId: "hype-entry", action: "ENTRY",
    strategy: "HYPE_LONG", symbol: "HYPEUSDT", side: "BUY", quantity: 1, expectedPrice: 10,
    phase: "submitted", createdAt: 100, updatedAt: 100, reason: "SIGNAL",
    reservationId: "reserved-1", approvedGross: 0.3, marketFitScore: 50,
    scoreSource: "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1" };
  await store.save(state);
  const recovered = await store.load();
  assert.equal(recovered.pending?.approvedGross, 0.3);
  assert.equal(recovered.pending?.reservationId, "reserved-1");
  assert.equal(recovered.pending?.scoreSource, "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1");
});

test("HYPE/ZEC state store rejects a stale runtime SHA", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-state-"));
  const path = join(root, "runner.json");
  const store = new FileHypeZecLongRunnerStateStore(path, "b".repeat(40), "LIVE");
  await assert.rejects(
    () => store.save({
      schema: "disdex-hype-zec-long/v1",
      runtimeCommitSha: "c".repeat(40),
      mode: "LIVE",
      updatedAt: Date.now(),
      failures: [],
    }),
    /RUNTIME_SHA_MISMATCH/,
  );
});

test("HYPE protected rate-budget deferral refreshes heartbeat without clearing protection", () => {
  const now = Date.now();
  const state = {
    schema: "disdex-hype-zec-long/v1" as const,
    runtimeCommitSha: "a".repeat(40),
    mode: "LIVE" as const,
    updatedAt: now - 1_000,
    positions: [{
      strategy: "HYPE_LONG" as const,
      symbol: "HYPEUSDT" as const,
      side: "LONG" as const,
      positionId: "hype-position",
      quantity: 1,
      entryPrice: 10,
      entryTs: now - 10_000,
      signalTs: now - 11_000,
      stopPrice: 9,
      takeProfitPrice: 12,
      stopClientOrderId: "hype-stop",
      takeProfitClientOrderId: "hype-tp",
      stopReadBackAt: now - 1_000,
      peakPrice: 10,
      updatedAt: now - 1_000,
    }],
    failures: [],
  };
  const next = heartbeatHypeZecRateBudgetDeferral(state, "ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007", now);
  assert.equal(next.updatedAt, now);
  assert.deepEqual(next.positions, state.positions);
  assert.equal(next.pending, undefined);
  assert.equal(next.manualReview, undefined);
  assert.equal(next.lastDecisionTs, now);
  assert.equal(next.lastDecision?.reason, "HYPE_ZEC_PROTECTED_RATE_BUDGET_DEFERRED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007");
});

test("HYPE/ZEC state store rejects an invalid mode instead of coercing it to SHADOW", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-state-"));
  const path = join(root, "runner.json");
  const sha = "a".repeat(40);
  await writeFile(path, JSON.stringify({
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: sha,
    mode: "UNKNOWN",
    updatedAt: Date.now(),
    failures: [],
  }), { mode: 0o600 });
  await assert.rejects(() => new FileHypeZecLongRunnerStateStore(path, sha, "SHADOW").load(), /MODE_INVALID/);
});
