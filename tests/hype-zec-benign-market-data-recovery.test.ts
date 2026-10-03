import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recoverHypeZecBenignMarketDataState } from "../scripts/disdex-hype-zec-benign-market-data-recovery";
import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";
import type { HypeZecLongRunnerState } from "../lib/hype-zec-long-runner-state";

const SHA = "a".repeat(40);

function shadowRuntime() {
  return {
    mode: "SHADOW" as const,
    enabled: true,
    liveExecutionEnabled: false,
    productionConfigLiveEnabled: false,
    operatorArmed: false,
    runtimeSha: SHA,
    statePath: "unused",
    pendingExposurePath: "unused",
    sharedRiskPath: "unused",
    maximumGross: 1,
    maximumReductionFraction: 0.5,
    hypeRiskPct: 5,
    zecRiskPct: 4.5,
    maximumEntryDelayMs: 60_000,
    maximumSlippageBps: 20,
    feeBpsPerSide: 4,
    fundingBps: 2,
    cryptoGrossCap: 3,
    totalGrossCap: 4.25,
    signalMode: "LEGACY" as const,
    symbols: ["HYPEUSDT", "ZECUSDT"] as const,
  };
}

function flatState(manualReview?: string): HypeZecLongRunnerState {
  return {
    schema: "disdex-hype-zec-long/v1" as const,
    runtimeCommitSha: SHA,
    mode: "SHADOW" as const,
    updatedAt: 1,
    positions: undefined,
    pending: undefined,
    manualReview,
    failures: [],
  };
}

function runnerForMarketFailure(state: ReturnType<typeof flatState>, error: string, stage: "market" | "account" | "post-market" = "market") {
  let saved = state;
  let marketLoads = 0;
  const runtime = shadowRuntime();
  if (stage === "post-market") {
    Object.defineProperty(runtime, "symbols", { get() { throw new Error(error); } });
  }
  const runner = new HypeZecLongRunner({
    marketData: {
      load: async () => {
        marketLoads += 1;
        if (stage === "post-market") return {} as never;
        throw new Error(error);
      },
    },
    executor: {
      getAccountSnapshot: async () => {
        if (stage === "account") throw new Error(error);
        return { availableBalance: 100, walletBalance: 100, asset: "USDT", updatedAt: Date.now() };
      },
      getPositions: async () => [],
      getOpenOrders: async () => [],
    } as never,
    adapter: {} as never,
    stateStore: {
      load: async () => saved,
      save: async (next: typeof saved) => { saved = next; },
    } as never,
    lock: {
      acquire: async () => ({ release: async () => undefined }),
    } as never,
    runtime,
    now: () => 1_700_000_000_000,
    logger: { info() {}, warn() {}, error() {} },
  });
  return { runner, getSaved: () => saved, getMarketLoads: () => marketLoads };
}

test("recovers only the flat known market-row manual review and keeps an exact backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-benign-recovery-"));
  try {
    const statePath = join(root, "runner.json");
    const original = {
      schema: "disdex-hype-zec-long/v1",
      runtimeCommitSha: SHA,
      mode: "LIVE",
      updatedAt: 1,
      positions: null,
      pending: null,
      manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:HYPE_ZEC_MARKET_DATA_ROW_INVALID",
      failures: [],
      unknownField: "preserve",
    };
    await writeFile(statePath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o600 });
    const result = await recoverHypeZecBenignMarketDataState({ statePath, expectedSha: SHA });
    assert.equal(result.status, "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_PASS");
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(after.runtimeCommitSha, SHA);
    assert.equal(after.manualReview, null);
    assert.equal(after.unknownField, "preserve");
    assert.equal(JSON.parse(await readFile(result.backupPath, "utf8")).manualReview, original.manualReview);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("known benign manual review returns to the next shadow cycle without order mutation", async () => {
  const harness = runnerForMarketFailure(flatState("HYPE_ZEC_RUNNER_FAIL_CLOSED:HYPE_ZEC_MARKET_DATA_ROW_INVALID"), "HYPE_ZEC_MARKET_DATA_ROW_INVALID");
  const result = await harness.runner.tick();
  assert.equal(result.status, "held");
  assert.equal(result.message, "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY");
  assert.equal(harness.getSaved().manualReview, undefined);
  assert.equal(harness.getMarketLoads(), 1);
});

test("a transient known market-row failure on a flat state does not poison the daemon", async () => {
  const harness = runnerForMarketFailure(flatState(), "HYPE_ZEC_MARKET_DATA_ROW_INVALID");
  const result = await harness.runner.tick();
  assert.equal(result.status, "held");
  assert.equal(result.message, "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY");
  assert.equal(harness.getSaved().manualReview, undefined);
});

test("known flat pre-order rate-budget failures hold without poisoning the daemon", async () => {
  for (const error of ["ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT", "ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"]) {
    const harness = runnerForMarketFailure(flatState(), error);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const result = await harness.runner.tick();
      assert.equal(result.status, "held", error);
      assert.equal(result.message, `HYPE_ZEC_RATE_BUDGET_DEFERRED:${error}`);
      assert.equal(harness.getSaved().manualReview, undefined);
      assert.equal(harness.getSaved().pending, undefined);
      assert.equal(harness.getSaved().lastDecision?.accepted, false);
      assert.equal(harness.getSaved().lastDecisionTs, 1_700_000_000_000);
    }
    assert.equal(harness.getMarketLoads(), 3);
  }
});

test("budget deferral never clears an existing manual review", async () => {
  const review = "HYPE_ZEC_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT";
  const harness = runnerForMarketFailure(flatState(review), "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
  assert.equal((await harness.runner.tick()).status, "manual-review");
  assert.equal(harness.getSaved().manualReview, review);
  assert.equal(harness.getMarketLoads(), 0);
});

test("flat pre-request account budget denial is no-entry HOLD, not a permanent review", async () => {
  const harness = runnerForMarketFailure(flatState(), "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT", "account");
  assert.equal((await harness.runner.tick()).status, "held");
  assert.equal(harness.getSaved().manualReview, undefined);
  assert.equal(harness.getSaved().lastDecision?.accepted, false);
  assert.equal(harness.getMarketLoads(), 0);
});

test("account budget denial with owned durable exposure remains manual review", async () => {
  const state: any = { ...flatState(), positions: [{ strategy: "HYPE_LONG", symbol: "HYPEUSDT", quantity: 1 }] };
  const harness = runnerForMarketFailure(state, "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT", "account");
  assert.equal((await harness.runner.tick()).status, "manual-review");
  assert.equal(harness.getSaved().manualReview, "HYPE_ZEC_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
  assert.equal(harness.getSaved().positions?.length, 1);
});

test("budget-shaped errors after the read-only phase cannot be benignly deferred", async () => {
  const harness = runnerForMarketFailure(flatState(), "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT", "post-market");
  assert.equal((await harness.runner.tick()).status, "manual-review");
  assert.equal(harness.getSaved().manualReview, "HYPE_ZEC_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
  assert.equal(harness.getMarketLoads(), 1);
});

test("unknown or malformed pre-order failure still requires manual review", async () => {
  for (const error of ["ASTER_GLOBAL_RATE_BUDGET_MALFORMED", "HTTP 429", "ECONNRESET", "UNKNOWN"]) {
    const harness = runnerForMarketFailure(flatState(), error);
    assert.equal((await harness.runner.tick()).status, "manual-review", error);
    assert.equal(harness.getSaved().manualReview, `HYPE_ZEC_RUNNER_FAIL_CLOSED:${error}`);
  }
});

test("refuses unknown manual review and any active/pending state", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-benign-recovery-refuse-"));
  try {
    const cases = [
      { manualReview: "operator review" },
      { manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:HYPE_ZEC_MARKET_DATA_ROW_INVALID", positions: [{ symbol: "HYPEUSDT" }] },
      { manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:HYPE_ZEC_MARKET_DATA_ROW_INVALID", pending: { action: "ENTRY" } },
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const statePath = join(root, `state-${i}.json`);
      await writeFile(statePath, JSON.stringify({ schema: "disdex-hype-zec-long/v1", runtimeCommitSha: SHA, mode: "LIVE", updatedAt: 1, failures: [], ...cases[i] }));
      await assert.rejects(() => recoverHypeZecBenignMarketDataState({ statePath, expectedSha: SHA }), /HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

