import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveDisDexStable4Mode } from "../config/disdexStable4Opportunity";
import { Stable4Q102OnlineEngine } from "../lib/disdex-quality102-stable4-online";
import { quality102ExitReasonForState } from "../lib/disdex-quality102-causal-v1-runner";
import type { Quality102CausalV1History, Quality102CausalV1Signal } from "../lib/disdex-quality102-causal-v1-signal";

assert.equal(resolveDisDexStable4Mode({}), "OFF");
assert.equal(resolveDisDexStable4Mode({ DISDEX_STABLE4_MODE: "shadow" }), "SHADOW");
assert.equal(resolveDisDexStable4Mode({ DISDEX_STABLE4_MODE: "LIVE" }), "LIVE");
assert.equal(resolveDisDexStable4Mode({ DISDEX_STABLE4_MODE: "garbage" }), "OFF");

const entryTs = 1_700_000_000_000;
const longPosition: any = {
  symbol: "AVAXUSDT", side: 1, quantity: 1, entryPrice: 100, entryTs,
  hardStop: 0.05, bestPrice: 100, trailActive: false,
  exitPolicy: "STABLE4_STOP5_TP3_H24", maxHoldHours: 24,
};
assert.equal(quality102ExitReasonForState(longPosition, 103.01, entryTs + 60_000), "take_profit_3p0");
assert.equal(quality102ExitReasonForState(longPosition, 94.9, entryTs + 60_000), "hard_stop");
assert.equal(quality102ExitReasonForState(longPosition, 100, entryTs + 24 * 3_600_000), "time");
assert.equal(quality102ExitReasonForState(longPosition, 102.9, entryTs + 60_000), undefined);

const shortPosition: any = { ...longPosition, side: -1 };
assert.equal(quality102ExitReasonForState(shortPosition, 96.99, entryTs + 60_000), "take_profit_3p0");
assert.equal(quality102ExitReasonForState(shortPosition, 105.1, entryTs + 60_000), "hard_stop");

const root = mkdtempSync(join(tmpdir(), "stable4-q102-"));
const recoverySeedPath = resolve("config/stable4/q102-online-recovery-seed-20261114.json");
const avaxSeedPath = resolve("config/stable4/q102-avax-knn-seed-20261114.json");
const emptyHistory: Quality102CausalV1History = {
  candlesBySymbol: {},
  entryOpenBySymbol: {},
} as Quality102CausalV1History;
const weakNative: Quality102CausalV1Signal = {
  strategyId: "QUALITY102_CAUSAL_V1",
  referenceTs: entryTs,
  side: -1,
  symbol: "UNIUSDT",
  family: "MR",
  variant: "MR72_Z1.5_H24",
  layer: "S3",
  requestedGross: 0.75,
  reason: "NATIVE_WEAK",
  dataCutoffTs: entryTs - 3_600_000,
  hardStop: 0.08,
  maxHoldHours: 24,
  exitPolicy: "FIXED_HOLD_STOP",
  brkEnabled: false,
};
const strongNative: Quality102CausalV1Signal = {
  ...weakNative,
  symbol: "APTUSDT",
  variant: "REV24_T0.05_H24",
  reason: "NATIVE_STRONG",
};

try {
  const shadow = new Stable4Q102OnlineEngine({
    mode: "SHADOW", recoverySeedPath, avaxSeedPath, statePath: join(root, "shadow.json"),
  });
  assert.equal(shadow.select(weakNative, emptyHistory, entryTs).signal.side, -1, "SHADOW must preserve native weak route");

  const live = new Stable4Q102OnlineEngine({
    mode: "LIVE", recoverySeedPath, avaxSeedPath, statePath: join(root, "live.json"),
  });
  const suppressed = live.select(weakNative, emptyHistory, entryTs).signal;
  assert.equal(suppressed.side, 0, "LIVE must WAIT weak route without qualified online proposal");
  assert.equal(suppressed.reason, "STABLE4_Q102_WEAK_ROUTE_WAIT");
  assert.equal(live.select(strongNative, emptyHistory, entryTs).signal.reason, "NATIVE_STRONG", "LIVE must preserve non-weak native route");

  const badSeed = join(root, "bad-seed.json");
  writeFileSync(badSeed, JSON.stringify({ schemaVersion: 1, rows: [{ bad: true }] }), "utf8");
  assert.throws(() => new Stable4Q102OnlineEngine({
    mode: "LIVE", recoverySeedPath: badSeed, avaxSeedPath, statePath: join(root, "bad.json"),
  }), /STABLE4_Q102_RECOVERY_SEED_ROW_INVALID/);

  const badState = join(root, "bad-state.json");
  writeFileSync(badState, JSON.stringify({ schemaVersion: 999 }), "utf8");
  assert.throws(() => new Stable4Q102OnlineEngine({
    mode: "LIVE", recoverySeedPath, avaxSeedPath, statePath: badState,
  }), /STABLE4_Q102_ONLINE_STATE_INVALID/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("STABLE4_Q102_SELFTEST_PASS");