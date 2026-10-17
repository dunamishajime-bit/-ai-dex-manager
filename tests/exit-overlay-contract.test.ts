import test from "node:test";
import assert from "node:assert/strict";
import {
  applyIdleProfitTrailBar,
  applyQ102ProfitFloorBar,
  calculateWalletRiskStop,
  moreProtectiveStop,
} from "../lib/disdex-exit-overlay-contract";

const bar = (timestampMs: number, close: number, low = close, high = close) => ({ timestampMs, open: close, high, low, close });

test("Q102 long floor arms only from a confirmed close and protects +0.5%", () => {
  const first = applyQ102ProfitFloorBar({ side: "LONG", entryPrice: 100, bar: bar(300_000, 102) });
  assert.equal(first.reason, "ARMED");
  assert.equal(first.state.armed, true);
  assert.ok(Math.abs((first.state.stopPrice ?? 0) - 100.5) < 1e-9);
  const duplicate = applyQ102ProfitFloorBar({ side: "LONG", entryPrice: 100, state: first.state, bar: bar(300_000, 103) });
  assert.equal(duplicate.reason, "DUPLICATE_OR_OLD_BAR");
  const hit = applyQ102ProfitFloorBar({ side: "LONG", entryPrice: 100, state: first.state, bar: bar(600_000, 101.5, 100.4, 102) });
  assert.equal(hit.stopHit, true);
  assert.ok(Math.abs((hit.triggerPrice ?? 0) - 100.5) < 1e-9);
});

test("Q102 short floor uses the favorable direction and gap-aware trigger", () => {
  const armed = applyQ102ProfitFloorBar({ side: "SHORT", entryPrice: 100, bar: bar(300_000, 98) });
  assert.equal(armed.state.stopPrice, 99.5);
  const gap = applyQ102ProfitFloorBar({ side: "SHORT", entryPrice: 100, state: armed.state, bar: { timestampMs: 600_000, open: 101, high: 101.5, low: 100.8, close: 101 } });
  assert.equal(gap.stopHit, true);
  assert.equal(gap.triggerPrice, 101);
});

test("DOT/RENDER trail arms at +3%, moves only in the protective direction, and survives an old bar", () => {
  const armed = applyIdleProfitTrailBar({ side: "LONG", entryPrice: 100, bar: bar(300_000, 103) });
  assert.equal(armed.reason, "ARMED");
  assert.ok(Math.abs((armed.state.stopPrice ?? 0) - 101.5) < 1e-9);
  const moved = applyIdleProfitTrailBar({ side: "LONG", entryPrice: 100, state: armed.state, bar: bar(600_000, 105) });
  assert.ok(Math.abs((moved.state.stopPrice ?? 0) - 103.5) < 1e-9);
  const old = applyIdleProfitTrailBar({ side: "LONG", entryPrice: 100, state: moved.state, bar: bar(300_000, 90) });
  assert.equal(old.reason, "DUPLICATE_OR_OLD_BAR");
  assert.ok(Math.abs((old.state.stopPrice ?? 0) - 103.5) < 1e-9);
});

test("short trail uses the highest favourable confirmed gain and checks the existing stop first", () => {
  const armed = applyIdleProfitTrailBar({ side: "SHORT", entryPrice: 100, bar: bar(300_000, 96.5) });
  assert.ok(Math.abs((armed.state.stopPrice ?? 0) - 98) < 1e-9);
  const hit = applyIdleProfitTrailBar({ side: "SHORT", entryPrice: 100, state: armed.state, bar: { timestampMs: 600_000, open: 99, high: 99, low: 98.2, close: 98.7 } });
  assert.equal(hit.stopHit, true);
  assert.equal(hit.triggerPrice, 99);
});

test("HYPE wallet-risk stop includes execution costs and uses accepted gross", () => {
  const result = calculateWalletRiskStop({ side: "LONG", entryPrice: 100, equity: 1_000, acceptedGross: 1.5, walletRiskPct: 2, roundTripCostBps: 20 });
  assert.equal(result.notional, 1_500);
  assert.ok(result.stopPrice < 100);
  assert.ok(result.walletLossAtStop <= 20.0000001);
  assert.equal(calculateWalletRiskStop({ side: "LONG", entryPrice: 100, equity: 1_000, acceptedGross: 1.5, walletRiskPct: 2, roundTripCostBps: 20 }).priceLossFraction, result.priceLossFraction);
});

test("overlay stop never loosens the base stop", () => {
  assert.equal(moreProtectiveStop("LONG", 95, 98), 98);
  assert.equal(moreProtectiveStop("LONG", 98, 95), 98);
  assert.equal(moreProtectiveStop("SHORT", 105, 102), 102);
  assert.equal(moreProtectiveStop("SHORT", 102, 105), 102);
});
