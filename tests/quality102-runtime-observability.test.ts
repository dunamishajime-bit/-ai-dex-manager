import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import { loadQuality102RuntimeObservability, quality102Policy } from "../lib/server/quality102-runtime-observability";
import { DIST_TERMINAL_LIVE_CONFIG as liveConfig } from "../lib/disterminal-live-config";

test("Quality102 runtime policy exposes the production caps and universe", () => {
  assert.equal(quality102Policy.strategyGrossCap, 0.5);
  assert.equal(quality102Policy.cryptoGrossCap, 2);
  assert.equal(quality102Policy.totalGrossCap, 2.5);
  assert.equal(quality102Policy.symbols.length, 22);
  assert.equal(quality102Policy.symbols.includes("SUIUSDT"), true);
  assert.equal(quality102Policy.symbols.includes("TAOUSDT"), true);
  assert.equal(quality102Policy.symbols.includes("DOTUSDT"), true);
  assert.equal(quality102Policy.symbols.includes("UNIUSDT"), true);
  assert.equal(liveConfig.sharedCryptoGross, 2);
  assert.equal(liveConfig.quality102Runtime.strategyGrossCap, 0.5);
  assert.equal(liveConfig.quality102Runtime.selectorMode, "CAUSAL_V4");
  assert.equal(liveConfig.quality102Runtime.brkLiveEnabled, true);
  assert.equal(liveConfig.quality102Runtime.symbols.length, 22);
});

test("Quality102 observability fails closed when its state path is not configured", async () => {
  const previousStatePath = process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
  delete process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
  try {
    const result = await loadQuality102RuntimeObservability();
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.ok, false);
    assert.equal(result.readOnly, true);
    assert.equal(result.tradingMutation, 0);
  } finally {
    if (previousStatePath === undefined) delete process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
    else process.env.QUALITY102_CAUSAL_V1_STATE_PATH = previousStatePath;
  }
});

test("Quality102 observability accepts a fresh HEALTHY heartbeat and exposes its full causal universe", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-q102-observability-"));
  const statePath = join(directory, "state.json");
  const heartbeatPath = join(directory, "heartbeat.json");
  const now = Date.now();
  await writeFile(statePath, JSON.stringify({ mode: "LIVE", updatedAt: now, runtimeCommitSha: "ad7" }));
  await writeFile(heartbeatPath, JSON.stringify({
    mode: "LIVE",
    safetyState: "HEALTHY",
    updatedAt: now,
    runtimeSha: "ad7",
    expectedSha: "ad7",
    quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false },
    symbols: [
      "AAVEUSDT", "APTUSDT", "ARBUSDT", "AVAXUSDT", "DOGEUSDT", "DOTUSDT",
      "ENAUSDT", "FETUSDT", "FILUSDT", "JUPUSDT", "LDOUSDT", "NEARUSDT",
      "ONDOUSDT", "OPUSDT", "RENDERUSDT", "SEIUSDT", "SOLUSDT", "SUIUSDT",
      "TAOUSDT", "TIAUSDT", "TRXUSDT", "UNIUSDT",
    ],
  }));
  const previous = {
    state: process.env.QUALITY102_CAUSAL_V1_STATE_PATH,
    heartbeat: process.env.QUALITY102_CAUSAL_V1_HEARTBEAT_PATH,
  };
  process.env.QUALITY102_CAUSAL_V1_STATE_PATH = statePath;
  process.env.QUALITY102_CAUSAL_V1_HEARTBEAT_PATH = heartbeatPath;
  try {
    const result = await loadQuality102RuntimeObservability();
    assert.equal(result.status, "LIVE");
    assert.equal(result.caps.strategyGrossCap, 0.5);
    assert.equal(result.historicalSelectorParity, false);
    assert.equal(result.brkLiveEnabled, false);
    assert.equal(result.safetyState, "HEALTHY");
    assert.equal(result.symbols.length, 22);
    assert.equal(result.symbols.includes("UNIUSDT"), true);
  } finally {
    if (previous.state === undefined) delete process.env.QUALITY102_CAUSAL_V1_STATE_PATH;
    else process.env.QUALITY102_CAUSAL_V1_STATE_PATH = previous.state;
    if (previous.heartbeat === undefined) delete process.env.QUALITY102_CAUSAL_V1_HEARTBEAT_PATH;
    else process.env.QUALITY102_CAUSAL_V1_HEARTBEAT_PATH = previous.heartbeat;
    await rm(directory, { recursive: true, force: true });
  }
});
