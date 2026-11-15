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
  V12_V4_RECOVERY_C_APPROVED_REQUESTED_GROSS,
  V12_V4_D_APPROVED_GROSS_BY_ROUTE,
  resolveV12V4V2RequestedGross,
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

test("all 41 V4 route Gross values preserve unaffected tiers, adopt C9 and D3", () => {
  const counts = { S: 0, A: 0, B: 0, C: 0, D: 0, core: 0 };
  const raised: string[] = [];
  assert.equal(V12_V4_RECOVERY_C_APPROVED_REQUESTED_GROSS, 0.25);
  for (const route of V12_V4_V2_PRIORITY) {
    const expected = route.route === "FAILED_BREAK_REV_SHORT_6H" ? 0.81 :
      route.tier === "D" ? (V12_V4_D_APPROVED_GROSS_BY_ROUTE[route.route] ?? 0.05) :
      route.tier === "C" ? 0.25 : Math.min(1, route.gross * 1.5);
    const actual = resolveV12V4V2RequestedGross(route.route, 0.81);
    assert.ok(Math.abs(actual - expected) < 1e-12, route.route);
    if (route.route === "FAILED_BREAK_REV_SHORT_6H") {
      counts.core += 1;
      continue;
    }
    counts[route.tier] += 1;
    if (route.tier === "C") raised.push(route.route);
  }
  assert.deepEqual(counts, { S: 9, A: 5, B: 10, C: 9, D: 7, core: 1 });
  assert.deepEqual(Object.keys(V12_V4_D_APPROVED_GROSS_BY_ROUTE).sort(),
    ["REC_G3_LATE_BTC_REL", "REC_X13_TP1.5_SL1_H24", "CONT_SHORT_MID_AGE24_48"].sort());
  assert.equal(resolveV12V4V2RequestedGross("REC_G3_LATE_BTC_REL", .5), .25);
  assert.equal(resolveV12V4V2RequestedGross("REC_X13_TP1.5_SL1_H24", .5), .15);
  assert.equal(resolveV12V4V2RequestedGross("CONT_SHORT_MID_AGE24_48", .5), .15);
  assert.equal(resolveV12V4V2RequestedGross("REC_X14_TIME_48H", .5), .05);
  assert.equal(resolveV12V4V2RequestedGross("REC_Y15_REV_D0_T3", .5), .05);
  assert.equal(resolveV12V4V2RequestedGross("REC_Y18_REV_D2_T18", .5), .05);
  assert.equal(resolveV12V4V2RequestedGross("REC_X07_TIME_6H", .5), .05);
  assert.deepEqual(raised.sort(), [
    "REC_X02_TIME_36H", "REC_X04_TIME_24H", "REC_X06_TIME_12H",
    "REC_X09_TIME_48H", "REC_G1_MID_REL_LOWVOL",
    "REC_G2_EARLY_BTC_OPPOSE_VOL", "REC_Y08_REV_D0_T6",
    "REC_Y17_REV_D1_T3", "REC_Y19_REV_D1_TP2_SL1_H36",
  ].sort());
  assert.equal(resolveV12V4V2RequestedGross("FAILED_BREAK_REV_SHORT_6H", 0.63), 0.63);
  assert.throws(() => resolveV12V4V2RequestedGross("ROUTE_DOES_NOT_EXIST", 0.81), /UNKNOWN_ROUTE/);
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
