import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADOPTED_FIVE_MINUTE_MS,
  HYPE_RENDER_TAO_OCT22_POLICY,
  evaluateAdoptedHypeLongEntry,
  evaluateAdoptedTaoIdleShortEntry,
  evaluateAdoptedRenderIdleShortEntry,
  evaluateAdoptedHypeLongExit,
  evaluateAdoptedRenderShortProfitArm,
} from "../lib/hype-render-tao-adopted-policy";

const M5 = ADOPTED_FIVE_MINUTE_MS;
const decisionTs = 1800000000000 - 1800000000000 % M5;
const last = decisionTs - M5;

function candles(lookback: number, price: number, retPct: number) {
  const begin = last - lookback * M5;
  return Array.from({ length: lookback + 1 }, (_, i) => ({
    openTs: begin + i * M5,
    close: price * (1 + (retPct / 100) * i / lookback),
  }));
}

const BTC_3H = candles(36, 100, 0.5);
const HYPE_3H = candles(36, 100, 2.6);

test("adoption JSON matches the typed policy and the formal 3-rule economic anchors", () => {
  const cfg = JSON.parse(readFileSync(resolve("config/research/hype-render-tao-cumulative-adopted-20261022.json"), "utf8"));
  assert.equal(cfg.status, "USER_FORMALLY_ADOPTED_RESEARCH_CONTRACT_PENDING_PRODUCTION_INTEGRATION");
  assert.equal(cfg.sourceResearch.selectedIntegratedCaseId, "TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT");
  assert.equal(cfg.hypeLong.preEntry.btcLastCompletedM5Return3hPctAtMost, HYPE_RENDER_TAO_OCT22_POLICY.hypeLong.btc3hMaxPct);
  assert.equal(cfg.hypeLong.preEntry.hypeMinusBtcLastCompletedM5Return3hPpAtLeast, HYPE_RENDER_TAO_OCT22_POLICY.hypeLong.hypeRelative3hMinPp);
  assert.equal(cfg.hypeLong.earlyAdverseExit.priceReturnFromActualEntryPctAtMost, HYPE_RENDER_TAO_OCT22_POLICY.hypeLong.initialAdversePctAtMost);
  assert.equal(cfg.hypeLong.profitProtection.protectGainFromEntryPct, HYPE_RENDER_TAO_OCT22_POLICY.hypeLong.protectEntryGainPct);
  assert.equal(cfg.idlePriorityShort.tao.requireLastCompletedM5Return1hPctAtMost, HYPE_RENDER_TAO_OCT22_POLICY.taoIdleShort.ret1hPctMax);
  assert.equal(cfg.idlePriorityShort.render.profitProtection.protectGainFromEntryPct, HYPE_RENDER_TAO_OCT22_POLICY.renderIdleShort.protectEntryGainPct);
  assert.equal(cfg.modeledEightStrategyIntegratedBaseline.cost10bps.finalEquityJPY, 239985734.6618664);
  assert.equal(cfg.modeledEightStrategyIntegratedBaseline.cost30bps.finalEquityJPY, 135946895.1553796);
  assert.equal(cfg.implementationState.wiredIntoLiveRunner, false);
  assert.equal(cfg.idlePriorityShort.doNotCreateIdleLongSignals, true);
  assert.deepEqual(cfg.idlePriorityShort.doNotModifySymbols, ["DOTUSDT", "TIAUSDT", "JUPUSDT"]);
});

test("HYPE LONG accepts BTC 0.5% + HYPE-relative 2.1pp", () => {
  const r = evaluateAdoptedHypeLongEntry({ decisionTs, btc: BTC_3H, hype: HYPE_3H });
  assert.equal(r.accepted, true);
  assert.equal(r.reason, "HYPE_ADOPTED_GATE_PASS");
  assert.ok((r.symbolRelativePp ?? 0) >= 2);
});

test("HYPE LONG rejects BTC over +0.6% even if HYPE relative strong", () => {
  const r = evaluateAdoptedHypeLongEntry({
    decisionTs, btc: candles(36, 100, 0.61), hype: candles(36, 100, 4) });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "HYPE_BTC3H_TOO_STRONG");
});

test("HYPE LONG rejects relative 3h below 2pp", () => {
  const r = evaluateAdoptedHypeLongEntry({
    decisionTs, btc: BTC_3H, hype: candles(36, 100, 2.4) });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "HYPE_3H_RELATIVE_NOT_MET");
});

test("HYPE missing closed M5 history fails closed and does not use a future candle", () => {
  const gapped = BTC_3H.filter((_, i) => i !== 20);
  assert.equal(evaluateAdoptedHypeLongEntry({ decisionTs, btc: gapped, hype: HYPE_3H }).accepted, false);
  const formed = [...BTC_3H, { openTs: decisionTs, close: 99999 }];
  assert.equal(evaluateAdoptedHypeLongEntry({ decisionTs, btc: formed, hype: HYPE_3H }).accepted, true);
});

test("duplicate close timestamps fail closed; incorrect boundary fails closed", () => {
  const duplicates = [...BTC_3H, BTC_3H.at(-1)!];
  assert.equal(evaluateAdoptedHypeLongEntry({ decisionTs, btc: duplicates, hype: HYPE_3H }).accepted, false);
  assert.equal(evaluateAdoptedHypeLongEntry({ decisionTs: decisionTs + 1000, btc: BTC_3H, hype: HYPE_3H }).accepted, false);
});

test("TAO Idle SHORT accepts ret1h -1.01% and rejects -0.99%", () => {
  assert.equal(evaluateAdoptedTaoIdleShortEntry({ decisionTs, tao: candles(12, 100, -1.01) }).accepted, true);
  assert.equal(evaluateAdoptedTaoIdleShortEntry({ decisionTs, tao: candles(12, 100, -0.99) }).accepted, false);
});

test("TAO missing M5 historical anchor fails closed", () => {
  assert.equal(evaluateAdoptedTaoIdleShortEntry({
    decisionTs, tao: candles(12, 100, -1.5).slice(1),
  }).accepted, false);
});

test("RENDER veto requires both bullish BTC6h and positive BTC-relative strength", () => {
  const result = evaluateAdoptedRenderIdleShortEntry({
    decisionTs, btc: candles(72, 100, 0.2), render: candles(72, 100, 1.1),
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "RENDER_BTC6H_AND_RELATIVE6H_BOTH_POSITIVE_VETO");
});

test("RENDER SHORT remains eligible when BTC6h down even if RENDER relative is positive", () => {
  const r = evaluateAdoptedRenderIdleShortEntry({
    decisionTs, btc: candles(72, 100, -0.2), render: candles(72, 100, 0.1),
  });
  assert.equal(r.accepted, true);
});

test("RENDER SHORT remains eligible when BTC6h up but RENDER relative is nonpositive", () => {
  const r = evaluateAdoptedRenderIdleShortEntry({
    decisionTs, btc: candles(72, 100, 0.2), render: candles(72, 100, -0.1),
  });
  assert.equal(r.accepted, true);
});

test("RENDER 6h gate requires exact contiguous completed M5 data for both assets", () => {
  assert.equal(evaluateAdoptedRenderIdleShortEntry({
    decisionTs, btc: candles(72, 100, 0.2), render: candles(72, 100, 1).slice(1),
  }).accepted, false);
  assert.equal(evaluateAdoptedRenderIdleShortEntry({
    decisionTs, btc: candles(72, 100, 0.2).slice(0, -1), render: candles(72, 100, 1),
  }).accepted, false);
});

test("HYPE early adverse LONG exit needs 1h, MFE strictly <0.3%, and adverse -1%", () => {
  const common = {
    entryPrice: 100,
    maxFavorableExcursionPct: 0.2,
    currentReturnFromEntryPct: -1.01,
    confirmedCloseReturnPct: -1.01,
    stopAlreadyArmed: false,
  };
  assert.equal(evaluateAdoptedHypeLongExit({ ...common, elapsedMinutes: 60 }).kind, "CLOSE_LONG");
  assert.equal(evaluateAdoptedHypeLongExit({ ...common, elapsedMinutes: 59 }).kind, "KEEP");
  assert.equal(evaluateAdoptedHypeLongExit({ ...common, elapsedMinutes: 60, maxFavorableExcursionPct: 0.3 }).kind, "KEEP");
  assert.equal(evaluateAdoptedHypeLongExit({ ...common, elapsedMinutes: 60, currentReturnFromEntryPct: -0.99 }).kind, "KEEP");
});

test("HYPE confirmed M5 profit +3% arms +1.5%-from-entry stop", () => {
  const ret = evaluateAdoptedHypeLongExit({
    entryPrice: 100, elapsedMinutes: 10, maxFavorableExcursionPct: 3,
    currentReturnFromEntryPct: 3, confirmedCloseReturnPct: 3.01, stopAlreadyArmed: false,
  });
  assert.equal(ret.kind, "ARM_PROTECTIVE_STOP");
  if (ret.kind === "ARM_PROTECTIVE_STOP") assert.ok(Math.abs(ret.stopPrice - 101.5) < 1e-9);
});

test("HYPE and RENDER protection do not re-arm or loosen existing stop", () => {
  const hype = evaluateAdoptedHypeLongExit({
    entryPrice: 100, elapsedMinutes: 60, maxFavorableExcursionPct: 3,
    currentReturnFromEntryPct: 2, confirmedCloseReturnPct: 3.1, stopAlreadyArmed: true,
  });
  assert.equal(hype.kind, "KEEP");
  const render = evaluateAdoptedRenderShortProfitArm({
    entryPrice: 100, confirmedClose: 98.4, existingProtectiveStopPrice: 98.0,
  });
  assert.equal(render.kind, "KEEP");
});

test("RENDER confirmed +1.5% arm places 0.25%-below-entry protective BUY price", () => {
  const r = evaluateAdoptedRenderShortProfitArm({ entryPrice: 100, confirmedClose: 98.49 });
  assert.equal(r.kind, "ARM_PROTECTIVE_STOP");
  if (r.kind === "ARM_PROTECTIVE_STOP") assert.ok(Math.abs(r.stopPrice - 99.75) < 1e-9);
  assert.equal(evaluateAdoptedRenderShortProfitArm({ entryPrice: 100, confirmedClose: 98.51 }).kind, "KEEP");
});

test("invalid M5/price inputs cannot arm a new stop", () => {
  const r = evaluateAdoptedRenderShortProfitArm({ entryPrice: 100, confirmedClose: Number.NaN });
  assert.equal(r.kind, "KEEP");
  const h = evaluateAdoptedHypeLongExit({
    entryPrice: 100, elapsedMinutes: 0, maxFavorableExcursionPct: Number.NaN,
    currentReturnFromEntryPct: 1, confirmedCloseReturnPct: 1, stopAlreadyArmed: false,
  });
  assert.equal(h.kind, "KEEP");
});

test("new pure module does not expose long entries for Idle TAO/RENDER or create HYPE shorts", () => {
  assert.equal(HYPE_RENDER_TAO_OCT22_POLICY.hypeLong.symbol, "HYPEUSDT");
  assert.equal(HYPE_RENDER_TAO_OCT22_POLICY.taoIdleShort.symbol, "TAOUSDT");
  assert.equal(HYPE_RENDER_TAO_OCT22_POLICY.renderIdleShort.symbol, "RENDERUSDT");
  assert.equal(HYPE_RENDER_TAO_OCT22_POLICY.liveActivation, "PENDING_IMPLEMENTATION_AND_VENUE_CERTIFICATION");
});
