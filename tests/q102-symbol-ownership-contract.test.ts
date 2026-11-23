import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseQuality102CausalV1Symbols } from "../scripts/disdex-quality102-causal-v1-live-runner";

const DISJOINT_SYMBOLS = [
  "SUIUSDT",
  "SEIUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "ENAUSDT",
  "ONDOUSDT",
  "FILUSDT",
  "TRXUSDT",
];
const DISJOINT_VALUE = DISJOINT_SYMBOLS.join(",");
const IDLE_OWNED_SYMBOLS = ["TIAUSDT", "JUPUSDT", "RENDERUSDT", "TAOUSDT", "DOTUSDT"];

test("Q102 runtime contract pins a high-vol universe disjoint from Idle ownership", async () => {
  const wiring = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(wiring, new RegExp(`QUALITY102_CAUSAL_V1_SYMBOLS=\\$\\{QUALITY102_DISJOINT_HIGH_VOL_SYMBOLS\\}`));
  assert.match(wiring, /QUALITY102_DISJOINT_HIGH_VOL_SYMBOLS="SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT"/);
  for (const symbol of IDLE_OWNED_SYMBOLS) assert.doesNotMatch(wiring, new RegExp(`QUALITY102_DISJOINT_HIGH_VOL_SYMBOLS=.*${symbol}`));
});

test("Q102 ranking observer uses the same disjoint symbol contract", async () => {
  const unit = await readFile("ops/systemd/disdex-quality102-ranking-observer@.service", "utf8");
  assert.match(unit, new RegExp(`QUALITY102_CAUSAL_V1_SYMBOLS=${DISJOINT_VALUE}`));
  for (const symbol of IDLE_OWNED_SYMBOLS) assert.doesNotMatch(unit, new RegExp(`QUALITY102_CAUSAL_V1_SYMBOLS=.*${symbol}`));
});

test("Q102 parser accepts the production disjoint list and rejects Idle-owned overlap", () => {
  assert.deepEqual(parseQuality102CausalV1Symbols(DISJOINT_VALUE), [...DISJOINT_SYMBOLS].sort());
  assert.throws(
    () => parseQuality102CausalV1Symbols(`${DISJOINT_VALUE},TIAUSDT`),
    /QUALITY102_CAUSAL_V1_SYMBOL_UNSAFE_BASE_OVERLAP/,
  );
});
