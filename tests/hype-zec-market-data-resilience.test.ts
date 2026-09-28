import test from "node:test";
import assert from "node:assert/strict";

import type { AsterKline, AsterV3Client } from "../lib/aster-v3-client";
import { HypeZecAsterMarketDataProvider } from "../lib/hype-zec-long-market-data";
import { HypeZecLongRunner, type HypeZecLongRunnerDependencies } from "../lib/hype-zec-long-runner";
import type { HypeZecLongRunnerState } from "../lib/hype-zec-long-runner-state";

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

function rows(intervalMs: number, volume = "10"): AsterKline[] {
  return [0, 1, 2].map((index) => [
    NOW - (3 - index) * intervalMs,
    "100",
    "101",
    "99",
    "100.5",
    volume,
    0,
    "0",
    0,
    "0",
    "0",
    "0",
  ] as AsterKline);
}

test("HYPE-only market data does not fetch unused ZEC history and accepts zero-volume candles", async () => {
  const calls: string[] = [];
  const client = {
    getKlines: async (symbol: string, interval: string) => {
      calls.push(`${symbol}:${interval}`);
      if (symbol === "ZECUSDT") throw new Error("unused ZEC endpoint must not be called");
      const intervalMs = interval === "1m" ? 60_000 : interval === "15m" ? 15 * 60_000 : 60 * 60_000;
      return rows(intervalMs, symbol === "HYPEUSDT" && interval === "1h" ? "0" : "10");
    },
  } as unknown as AsterV3Client;

  const data = await new HypeZecAsterMarketDataProvider(client, {
    symbols: ["HYPEUSDT"],
    now: () => NOW,
  }).load();

  assert.equal(data.zec15m.length, 0);
  assert.equal(data.zec1m.length, 0);
  assert.equal(data.hype1h.at(-1)?.volume, 0);
  assert.equal(calls.some((call) => call.startsWith("ZECUSDT:")), false);
});

test("transient market-data validation failure is a recoverable HOLD and does not persist manual review", async () => {
  const state: HypeZecLongRunnerState = {
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: "a".repeat(40),
    mode: "SHADOW",
    updatedAt: NOW,
    failures: [],
  };
  let saved: HypeZecLongRunnerState | undefined;
  const stateStore = {
    load: async () => ({ ...(saved || state), failures: [...(saved || state).failures] }),
    save: async (next: HypeZecLongRunnerState) => { saved = next; },
  };
  let executeCalls = 0;
  const dependencies = {
    marketData: { load: async () => { throw new Error("HYPE_ZEC_MARKET_DATA_ROW_INVALID"); } },
    executor: {
      getAccountSnapshot: async () => ({ asset: "USDT", walletBalance: 100, availableBalance: 100, updatedAt: NOW }),
      getPositions: async () => [],
      getOpenOrders: async () => [],
      executeMarket: async () => { executeCalls += 1; throw new Error("must not execute"); },
    },
    adapter: {},
    stateStore,
    lock: { acquire: async () => ({ document: async () => undefined, release: async () => undefined }) },
    runtime: {
      mode: "SHADOW",
      enabled: true,
      liveExecutionEnabled: false,
      productionConfigLiveEnabled: false,
      operatorArmed: false,
      runtimeSha: "a".repeat(40),
      statePath: "runner.json",
      pendingExposurePath: "pending.json",
      maximumGross: 1.5,
      maximumReductionFraction: 0.5,
      hypeRiskPct: 5,
      zecRiskPct: 4.5,
      maximumEntryDelayMs: 60_000,
      maximumSlippageBps: 20,
      feeBpsPerSide: 4,
      fundingBps: 2,
      cryptoGrossCap: 3,
      totalGrossCap: 4.25,
      signalMode: "TREND",
      symbols: ["HYPEUSDT"],
    },
    now: () => NOW,
  } as unknown as HypeZecLongRunnerDependencies;

  const result = await new HypeZecLongRunner(dependencies).tick();
  assert.equal(result.status, "held");
  assert.match(result.message, /MARKET_DATA/);
  assert.equal(saved?.manualReview, undefined);
  assert.equal(executeCalls, 0);
});

test("unknown runner failures remain manual-review fail-closed", async () => {
  const state: HypeZecLongRunnerState = {
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: "a".repeat(40),
    mode: "SHADOW",
    updatedAt: NOW,
    failures: [],
  };
  let saved: HypeZecLongRunnerState | undefined;
  const dependencies = {
    marketData: { load: async () => { throw new Error("ASTER_AUTH_FAILURE"); } },
    executor: {
      getAccountSnapshot: async () => ({ asset: "USDT", walletBalance: 100, availableBalance: 100, updatedAt: NOW }),
      getPositions: async () => [],
      getOpenOrders: async () => [],
    },
    adapter: {},
    stateStore: {
      load: async () => saved || state,
      save: async (next: HypeZecLongRunnerState) => { saved = next; },
    },
    lock: { acquire: async () => ({ document: async () => undefined, release: async () => undefined }) },
    runtime: {
      mode: "SHADOW",
      enabled: true,
      liveExecutionEnabled: false,
      productionConfigLiveEnabled: false,
      operatorArmed: false,
      runtimeSha: "a".repeat(40),
      statePath: "runner.json",
      pendingExposurePath: "pending.json",
      maximumGross: 1.5,
      maximumReductionFraction: 0.5,
      hypeRiskPct: 5,
      zecRiskPct: 4.5,
      maximumEntryDelayMs: 60_000,
      maximumSlippageBps: 20,
      feeBpsPerSide: 4,
      fundingBps: 2,
      cryptoGrossCap: 3,
      totalGrossCap: 4.25,
      signalMode: "TREND",
      symbols: ["HYPEUSDT"],
    },
    now: () => NOW,
  } as unknown as HypeZecLongRunnerDependencies;

  const result = await new HypeZecLongRunner(dependencies).tick();
  assert.equal(result.status, "manual-review");
  assert.match(result.message, /RUNNER_FAIL_CLOSED:ASTER_AUTH_FAILURE/);
  assert.match(saved?.manualReview || "", /RUNNER_FAIL_CLOSED/);
});
