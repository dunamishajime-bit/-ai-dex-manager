import test from "node:test";
import assert from "node:assert/strict";

import {
  V12_V4_CAPS,
  admitV12V4ShadowCandidates,
  buildV12V4ShadowSnapshot,
  evaluateV12V4Routes,
  type V12V4Features,
  type V12V4VirtualLeg,
} from "../lib/v12-multilogic-v4-shadow";

const TS = Date.UTC(2026, 9, 9, 0, 0, 0);

function base(overrides: Partial<V12V4Features> = {}): V12V4Features {
  return {
    symbol: "XRPUSDT",
    sourceSide: "SHORT",
    sourceSignalTs: TS,
    age: 80,
    sret6: 0.002,
    ema12Dist: 0.2,
    btc6: 0.01,
    btc24: 0.01,
    rel12: 0.01,
    rel24: 0.01,
    break24Atr: -0.2,
    volRatio: 0.8,
    er24: 0.2,
    rangeLoc24: 0.5,
    pullback12Atr: 0.8,
    compression: 1,
    bodyAtr: 0.2,
    clv: 0.7,
    ...overrides,
  };
}

test("G5 is shadow-only, 0.10x, fixed 48h exit", () => {
  const rows = evaluateV12V4Routes(base());
  const g5 = rows.find((x) => x.route === "REC_G5_SLOW_TREND");
  assert.ok(g5);
  assert.equal(g5.orderEnabled, false);
  assert.equal(g5.shadow, true);
  assert.equal(g5.requestedGross, 0.10);
  assert.equal(g5.plannedExitPolicy, "TIME_48H_FIXED_REFINED");
});

test("robust complement has 0.25x cap and no real order flag", () => {
  const rows = evaluateV12V4Routes(base({ age: 30, sret6: 0.01, ema12Dist: 1.2 }));
  const robust = rows.find((x) => x.route === "CONT_SHORT_MID_AGE24_48");
  assert.ok(robust);
  assert.equal(robust.requestedGross, 0.25);
  assert.equal(robust.orderEnabled, false);
});

test("REC_Y flips source side and applies entry delay from catalog", () => {
  const rows = evaluateV12V4Routes(base({
    sourceSide: "LONG",
    age: 4,
    sret6: 0.01,
    ema12Dist: 0.25,
    btc6: 0.01,
    btc24: -0.01,
    er24: 0.2,
    volRatio: 0.8,
    rel12: 0.01,
    rel24: 0.01,
  }));
  const rev = rows.find((x) => x.family === "RECOVERY_Y_REVERSAL");
  assert.ok(rev);
  assert.equal(rev.sourceSide, "LONG");
  assert.equal(rev.effectiveSide, "SHORT");
  assert.equal(rev.orderEnabled, false);
  assert.equal(rev.eligibleEntryTs, TS + rev.entryDelayHours * 3_600_000);
});

test("same-symbol same-side virtual legs are admitted", () => {
  const candidates = evaluateV12V4Routes(base()).filter((x) => x.family === "RECOVERY_G").slice(0, 2);
  assert.ok(candidates.length >= 1);
  const duplicate = { ...candidates[0], route: candidates[0].route + "_TEST2" };
  const result = admitV12V4ShadowCandidates([candidates[0], duplicate]);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 0);
});

test("opposite side is rejected unless REC_Y can preempt X/G", () => {
  const x = evaluateV12V4Routes(base()).find((c) => c.family === "RECOVERY_G")!;
  const seed: V12V4VirtualLeg = {
    ...x,
    virtualLegId: "seed",
    postMinLiftGross: 0.1,
    decision: "ACCEPTED_SHADOW",
    reason: "seed",
    preemptedVirtualLegIds: [],
  };
  const opposite = { ...x, sourceSide: "LONG" as const, effectiveSide: "LONG" as const, route: "REC_X_FAKE", family: "RECOVERY_X" };
  const rejected = admitV12V4ShadowCandidates([opposite], { activeLegs: [seed] });
  assert.equal(rejected.accepted.length, 0);
  assert.equal(rejected.rejected[0].reason, "OPPOSITE_SYMBOL_ACTIVE");

  const recY = { ...opposite, route: "REC_Y_FAKE", family: "RECOVERY_Y_REVERSAL" };
  const accepted = admitV12V4ShadowCandidates([recY], { activeLegs: [seed] });
  assert.equal(accepted.accepted.length, 1);
  assert.deepEqual(accepted.accepted[0].preemptedVirtualLegIds, ["seed"]);
});

test("core is protected from REC_Y preemption", () => {
  const coreCandidate = evaluateV12V4Routes(base({
    sourceSide: "LONG",
    freshUpward90hOnset: true,
    structuralUpBreak: true,
    failedBelowWithin6h: true,
    oppositeClvBodyConfirm: true,
  })).find((x) => x.route === "FAILED_BREAK_REV_SHORT_6H")!;
  const core: V12V4VirtualLeg = {
    ...coreCandidate,
    virtualLegId: "core",
    postMinLiftGross: 0.5,
    decision: "ACCEPTED_SHADOW",
    reason: "seed",
    preemptedVirtualLegIds: [],
  };
  const recY = { ...coreCandidate, route: "REC_Y_FAKE", family: "RECOVERY_Y_REVERSAL", sourceSide: "SHORT" as const, effectiveSide: "LONG" as const, requestedGross: 0.1 };
  const result = admitV12V4ShadowCandidates([recY], { activeLegs: [core] });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reason, "OPPOSITE_SYMBOL_ACTIVE");
});

test("Min-Lift cannot exceed 0.30x and caps remain frozen", () => {
  const g5 = evaluateV12V4Routes(base()).find((x) => x.route === "REC_G5_SLOW_TREND")!;
  const pass = admitV12V4ShadowCandidates([g5], { venueMinimumGrossBySymbol: { XRPUSDT: 0.22 } });
  assert.equal(pass.accepted[0].postMinLiftGross, 0.22);
  assert.equal(pass.accepted[0].reason, "ACCEPTED_WITH_MIN_LIFT");

  const fail = admitV12V4ShadowCandidates([g5], { venueMinimumGrossBySymbol: { XRPUSDT: 0.31 } });
  assert.equal(fail.accepted.length, 0);
  assert.equal(fail.rejected[0].reason, "VENUE_MIN_LIFT_EXCEEDS_0.30X");

  assert.deepEqual(V12_V4_CAPS, {
    recoveryRouteSlots: 16,
    recoveryFamilyGross: 1,
    normalRecoveryGross: 0.1,
    robustMaxGross: 0.25,
    minLiftMaxGross: 0.3,
    v12Gross: 2,
    cryptoGross: 3,
    totalGross: 4.25,
  });
});

test("snapshot proves zero real-order enabled V4 rows", () => {
  const snapshot = buildV12V4ShadowSnapshot({ observations: [base()] });
  assert.equal(snapshot.orderEnabled, false);
  assert.equal(snapshot.tradingMutation, 0);
  assert.equal(snapshot.counts.realOrderEnabledV4, 0);
  assert.ok(snapshot.candidates.every((x) => x.orderEnabled === false));
  assert.ok(snapshot.accepted.every((x) => x.orderEnabled === false));
});
