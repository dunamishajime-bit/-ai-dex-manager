import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recoverHypeZecBenignMarketDataState } from "../scripts/disdex-hype-zec-benign-market-data-recovery";
import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";

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

function flatState(manualReview?: string) {
  return {
    schema: "disdex-hype-zec-long/v1" as const,
    runtimeCommitSha: SHA,
    mode: "SHADOW" as const,
    updatedAt: 1,
    positions: null,
    pending: undefined,
    manualReview,
    failures: [],
  };
}

function runnerForMarketFailure(state: ReturnType<typeof flatState>, error: string) {
  let saved = state;
  let marketLoads = 0;
  const runner = new HypeZecLongRunner({
    marketData: {
      load: async () => {
        marketLoads += 1;
        throw new Error(error);
      },
    },
    executor: {
      getAccountSnapshot: async () => ({ availableBalance: 100, walletBalance: 100, asset: "USDT", updatedAt: Date.now() }),
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
    runtime: shadowRuntime(),
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

