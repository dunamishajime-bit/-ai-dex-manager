import test from "node:test";
import assert from "node:assert/strict";
import {
  buildV12V4V2ShadowSnapshot,
  evaluateV12V4V2Routes,
  V12_V4_V2_BT,
  V12_V4_V2_CAPS,
  V12_V4_V2_POLICY,
  V12_V4_V2_PRIORITY,
  V12_V4_V2_STATUS,
  V12_V4_FIRST_PASS_REPAIRS,
  V12_V4_SECOND_PASS_REPAIRS,
  type V12V4V2Features,
} from "../lib/v12-v4-v2-shadow";
import { buildV12V4ShadowSnapshot, V12_V4_CAPS } from "../lib/v12-multilogic-v4-shadow";

const T = Date.UTC(2026, 9, 9, 0);
function base(extra: Partial<V12V4V2Features> = {}): V12V4V2Features {
  return {
    symbol: "XRPUSDT",
    sourceSide: "SHORT", sourceSignalTs: T,
    age: 80, sret6: .002, ema12Dist: .2,
    btc6: .01, btc24: .01, rel12: .01, rel24: .01, break24Atr: -.2,
    volRatio: .8, er24: .2, rangeLoc24: .5, pullback12Atr: .8,
    compression: 1, bodyAtr: .2, clv: .7,
    ...extra,
  };
}

test("V2_M150 case reproduces exact four caps and frozen 41 full-year ranked routes", () => {
  assert.equal(V12_V4_V2_POLICY, "V2_M150_D05_CORE_NATIVE");
  assert.deepEqual([
    V12_V4_V2_CAPS.recoveryFamilyGross, V12_V4_V2_CAPS.v12Gross,
    V12_V4_V2_CAPS.cryptoGross, V12_V4_V2_CAPS.totalGross,
  ], [2.5, 3.0, 3.5, 4.75]);
  assert.equal(V12_V4_V2_PRIORITY.length, 41);
  assert.equal(new Set(V12_V4_V2_PRIORITY.map((x) => x.route)).size, 41);
  assert.equal(V12_V4_V2_PRIORITY[0].route, "REC_X01_TIME_24H");
  assert.equal(V12_V4_V2_PRIORITY[0].priority_order, 1);
  assert.equal(V12_V4_V2_PRIORITY[0].n30, 19);
  assert.equal(V12_V4_V2_PRIORITY.at(-1)?.tier, "D");
  assert.equal(Object.keys(V12_V4_FIRST_PASS_REPAIRS).length, 8);
  assert.equal(Object.keys(V12_V4_SECOND_PASS_REPAIRS).length, 6);
  assert.deepEqual([V12_V4_CAPS.recoveryFamilyGross, V12_V4_CAPS.v12Gross], [1, 2]);
});

test("G5 uses same frozen fixed48 exit but full-year hindsight rank/tier sizing", () => {
  const input = base();
  const result = evaluateV12V4V2Routes([input]);
  const g5 = result.candidates.find((x) => x.route === "REC_G5_SLOW_TREND");
  assert.ok(g5);
  const rank = V12_V4_V2_PRIORITY.find((x) => x.route === g5.route)!;
  assert.equal(g5.rank, rank.priority_order + 3);
  assert.equal(g5.requestedGross, rank.tier === "D" ? .05 : Math.min(1, rank.gross * 1.5));
  assert.equal(g5.plannedExitPolicy, "TIME_48H_FIXED_REFINED");
  assert.equal(g5.orderEnabled, false);
});

test("V2 entry repairs reject missing entry-bar features for second-pass route, never fabricating a pass", () => {
  const result = evaluateV12V4V2Routes([base({ sourceSide: "LONG",
    freshUpward90hOnset: true, structuralUpBreak: true,
    failedBelowWithin6h: true, oppositeClvBodyConfirm: true,
  })]);
  assert.ok(result.filtered.some((x) =>
    x.route === "FAILED_BREAK_REV_SHORT_6H" &&
    x.reason === "SECOND_PASS_ENTRY_FEATURES_MISSING"));
  assert.equal(result.candidates.some((x) => x.route === "FAILED_BREAK_REV_SHORT_6H"), false);
});

test("V2 simulation snapshots are always isolated shadow and never place a live order", () => {
  const x = buildV12V4V2ShadowSnapshot({ observations: [base()], capturedAt: "2026-10-09T01:00:00.000Z" });
  assert.equal(x.policyId, V12_V4_V2_POLICY);
  assert.equal(x.promotionStatus, V12_V4_V2_STATUS);
  assert.equal(x.orderEnabled, false);
  assert.equal(x.tradingMutation, 0);
  assert.equal(x.counts.realOrderEnabledV4, 0);
  assert.ok(x.accepted.every((r) => !r.orderEnabled && r.shadow));
  assert.deepEqual([
    x.caps.recoveryFamilyGross, x.caps.v12Gross, x.caps.cryptoGross, x.caps.totalGross
  ], [2.5, 3.0, 3.5, 4.75]);
});

test("research BT 10bps fails DD 20pct limit; original V4 cap unchanged", () => {
  assert.equal(V12_V4_V2_BT.costs["10bps"].finalEquityJpy, 291326102.6203428);
  assert.equal(V12_V4_V2_BT.costs["30bps"].finalEquityJpy, 174749524);
  assert.ok(V12_V4_V2_BT.costs["10bps"].dd < -.2);
  const legacy = buildV12V4ShadowSnapshot({ observations: [base()] });
  assert.equal(legacy.caps.totalGross, 4.25);
  assert.equal(legacy.orderEnabled, false);
});
