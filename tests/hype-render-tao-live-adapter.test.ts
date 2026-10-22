import assert from "node:assert/strict";
import test from "node:test";
import {
  gateAdoptedHypeLongEntry,
  gateAdoptedIdleShortEntry,
  evaluateAdoptedHypeLongExit,
  evaluateAdoptedRenderShortProfitArm,
  chooseMoreProtectiveRenderShortStop,
} from "../lib/hype-render-tao-live-adapter";
import type { ClosedFiveMinuteClose } from "../lib/hype-render-tao-adopted-policy";
import { resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";
import { resolveIdlePriorityShortRuntime } from "../config/idlePriorityShortRuntime";

const M5 = 300_000;
const decisionTs = 1_800_000_000_000 - (1_800_000_000_000 % M5);

function closes(lookback: number, endPrice: number, returnPct: number): ClosedFiveMinuteClose[] {
  const end = decisionTs - M5;
  const begin = end - lookback * M5;
  const startPrice = endPrice / (1 + returnPct / 100);
  return Array.from({ length: lookback + 1 }, (_, index) => ({
    openTs: begin + index * M5,
    close: startPrice * (1 + returnPct / 100 * index / lookback),
  }));
}

test("HYPE adapter keeps the native rejection and applies the adopted M5 gate only after it", () => {
  const rejected = gateAdoptedHypeLongEntry({
    nativeAccepted: false,
    decisionTs,
    btc: closes(36, 100, 0.5),
    hype: closes(36, 102.6, 2.6),
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "HYPE_NATIVE_ENTRY_NOT_ACCEPTED");

  const accepted = gateAdoptedHypeLongEntry({
    nativeAccepted: true,
    decisionTs,
    btc: closes(36, 100, 0.5),
    hype: closes(36, 102.6, 2.6),
  });
  assert.equal(accepted.accepted, true);
});

test("Idle adapter never turns a LONG candidate into an adopted SHORT", () => {
  const result = gateAdoptedIdleShortEntry({
    symbol: "TAOUSDT",
    nativeAccepted: true,
    nativeSide: "LONG",
    decisionTs,
    tao: closes(12, 98.99, -1.01),
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "IDLE_ADOPTED_SHORT_SIDE_REQUIRED");
});

test("TAO and RENDER gates are scoped to the Idle SHORT owner", () => {
  const tao = gateAdoptedIdleShortEntry({
    symbol: "TAOUSDT",
    nativeAccepted: true,
    nativeSide: "SHORT",
    decisionTs,
    tao: closes(12, 98.99, -1.01),
  });
  assert.equal(tao.accepted, true);

  const render = gateAdoptedIdleShortEntry({
    symbol: "RENDERUSDT",
    nativeAccepted: true,
    nativeSide: "SHORT",
    decisionTs,
    btc: closes(72, 100.2, 0.2),
    render: closes(72, 101.1, 1.1),
  });
  assert.equal(render.accepted, false);
  assert.equal(render.reason, "RENDER_BTC6H_AND_RELATIVE6H_BOTH_POSITIVE_VETO");
});

test("live adapter exposes the adopted exit decisions without changing their causal inputs", () => {
  assert.equal(evaluateAdoptedHypeLongExit({
    entryPrice: 100,
    elapsedMinutes: 60,
    maxFavorableExcursionPct: 0.2,
    currentReturnFromEntryPct: -1.01,
    confirmedCloseReturnPct: -1.01,
    stopAlreadyArmed: false,
  }).kind, "CLOSE_LONG");
  const render = evaluateAdoptedRenderShortProfitArm({ entryPrice: 100, confirmedClose: 98.49 });
  assert.equal(render.kind, "ARM_PROTECTIVE_STOP");
  if (render.kind === "ARM_PROTECTIVE_STOP") assert.equal(render.stopPrice, 99.75);
});

test("the adopted policy is opt-in and independently visible in HYPE and Idle runtime configuration", () => {
  assert.equal(resolveHypeZecLongRuntime({ NODE_ENV: "test" }).adoptedHypeRenderTaoEnabled, false);
  assert.equal(resolveIdlePriorityShortRuntimeWithEnv({ NODE_ENV: "test", DISDEX_RUNTIME_SHA: "a".repeat(40) }).adoptedHypeRenderTaoEnabled, false);
  assert.equal(resolveHypeZecLongRuntime({ NODE_ENV: "test", DISDEX_HYPE_RENDER_TAO_ADOPTED_ENABLED: "true" }).adoptedHypeRenderTaoEnabled, true);
  assert.equal(resolveIdlePriorityShortRuntimeWithEnv({ NODE_ENV: "test", DISDEX_RUNTIME_SHA: "a".repeat(40), DISDEX_HYPE_RENDER_TAO_ADOPTED_ENABLED: "true" }).adoptedHypeRenderTaoEnabled, true);
});

test("RENDER short floor never loosens an existing more protective trail", () => {
  assert.equal(chooseMoreProtectiveRenderShortStop(99.5, 99.75), 99.5);
  assert.equal(chooseMoreProtectiveRenderShortStop(100.25, 99.75), 99.75);
  assert.equal(chooseMoreProtectiveRenderShortStop(undefined, 99.75), 99.75);
});

function resolveIdlePriorityShortRuntimeWithEnv(env: NodeJS.ProcessEnv) {
  const previous = process.env.DISDEX_HYPE_RENDER_TAO_ADOPTED_ENABLED;
  const previousRuntimeSha = process.env.DISDEX_RUNTIME_SHA;
  try {
    process.env.DISDEX_HYPE_RENDER_TAO_ADOPTED_ENABLED = env.DISDEX_HYPE_RENDER_TAO_ADOPTED_ENABLED;
    process.env.DISDEX_RUNTIME_SHA = env.DISDEX_RUNTIME_SHA;
    return resolveIdlePriorityShortRuntime();
  } finally {
    if (previous === undefined) delete process.env.DISDEX_HYPE_RENDER_TAO_ADOPTED_ENABLED;
    else process.env.DISDEX_HYPE_RENDER_TAO_ADOPTED_ENABLED = previous;
    if (previousRuntimeSha === undefined) delete process.env.DISDEX_RUNTIME_SHA;
    else process.env.DISDEX_RUNTIME_SHA = previousRuntimeSha;
  }
}
