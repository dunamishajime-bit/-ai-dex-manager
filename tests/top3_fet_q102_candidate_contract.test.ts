import test from "node:test";
import assert from "node:assert/strict";

import { TOP3_FET_Q102_CANDIDATE } from "@/config/top3FetQ102Candidate";
import { selectV12Top3ShadowCandidates } from "@/lib/v12-top3-candidate-policy";
import { evaluateFetBrk48Long, type FetH1Bar } from "@/lib/fet-brk48-long";
import {
  applyClosedEventReturn,
  decideQ102PortfolioDdGross,
  initialQ102PortfolioDdGovernorState,
  q102PortfolioDrawdownPct,
} from "@/lib/q102-portfolio-dd-governor";
import type { V12ObservedCandidate } from "@/lib/v12-x1-all";

function candidate(rank: number, score: number, eligible = true, symbol = `S${rank}`): V12ObservedCandidate {
  return {
    symbol,
    side: "LONG",
    momentum: 0.06,
    volatility: 0.02,
    atr: 1,
    volumeRatio: 1.1,
    score,
    rank,
    signalEligible: eligible,
    signalReason: eligible ? "SIGNAL_ELIGIBLE" : "BLOCKED",
  };
}

test("candidate contract is shadow-only and matches the frozen research caps", () => {
  assert.equal(TOP3_FET_Q102_CANDIDATE.mode, "SHADOW");
  assert.equal(TOP3_FET_Q102_CANDIDATE.ordersEnabled, false);
  assert.equal(TOP3_FET_Q102_CANDIDATE.v12.maximumPositions, 3);
  assert.equal(TOP3_FET_Q102_CANDIDATE.v12.rank3GrossCap, 0.10);
  assert.equal(TOP3_FET_Q102_CANDIDATE.v12.rank3MinimumScore, 0.70);
  assert.equal(TOP3_FET_Q102_CANDIDATE.fet.maximumGross, 1.25);
  assert.equal(TOP3_FET_Q102_CANDIDATE.q102Governor.maximumGross, 3.0);
  assert.equal(TOP3_FET_Q102_CANDIDATE.q102Governor.maximumEntryDrawdownPct, 0.30);
  assert.equal(TOP3_FET_Q102_CANDIDATE.portfolio.cryptoGrossCap, 3.0);
  assert.equal(TOP3_FET_Q102_CANDIDATE.portfolio.totalGrossCap, 3.5);
});

test("V12 shadow Top3 keeps two eligible heads and adds only score>=0.70 rank3 at 0.10x", () => {
  const selected = selectV12Top3ShadowCandidates([
    candidate(1, 2.0, true, "AVAX"),
    candidate(2, 1.2, true, "ATOM"),
    candidate(3, 0.70, true, "INJ"),
    candidate(4, 0.95, true, "XRP"),
  ]);
  assert.deepEqual(selected.base.map((row) => row.symbol), ["AVAX", "ATOM"]);
  assert.equal(selected.rank3?.symbol, "INJ");
  assert.equal(selected.rank3RequestedGross, 0.10);

  const blocked = selectV12Top3ShadowCandidates([
    candidate(1, 2.0),
    candidate(2, 1.2),
    candidate(3, 0.699999),
  ]);
  assert.equal(blocked.rank3, undefined);
  assert.equal(blocked.rank3RequestedGross, 0);
  assert.equal(blocked.blockedReason, "NO_ELIGIBLE_RANK3_SCORE_070");
});

test("FET BRK48 LONG matches 48h close breakout + 72h median volume x1.2 on the 4h entry grid", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const bars: FetH1Bar[] = Array.from({ length: 75 }, (_, i) => ({
    ts: start + i * 3_600_000,
    open: 100,
    high: i < 73 ? 101 : 103,
    low: 99,
    close: 100,
    volume: 100,
  }));
  // entryIndex 73 is 01:00 UTC because start is 00:00 and 73 % 24 = 1.
  bars[72] = { ...bars[72], close: 102, high: 102.5, volume: 121 };
  const decision = evaluateFetBrk48Long(bars, 73);
  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, "FET_BRK48_LONG_ELIGIBLE");
  assert.equal(decision.requestedGross, 1.25);
  assert.equal(decision.holdHours, 24);
  assert.equal(decision.hardStopPct, 0.05);
  assert.ok((decision.volumeRatio || 0) >= 1.2);

  bars[72] = { ...bars[72], volume: 119 };
  const lowVolume = evaluateFetBrk48Long(bars, 73);
  assert.equal(lowVolume.eligible, false);
  assert.equal(lowVolume.reason, "VOLUME_RATIO_BELOW_1P20");
});

test("Q102 governor boosts to 3.0x only while closed-event TWR DD is <=0.30%", () => {
  let state = initialQ102PortfolioDdGovernorState();
  const atPeak = decideQ102PortfolioDdGross("HIGH_VOL", state);
  assert.equal(atPeak.baseRequestedGross, 1.661);
  assert.equal(atPeak.requestedGross, 3.0);
  assert.equal(atPeak.boostEnabled, true);

  state = applyClosedEventReturn(state, 0.10);
  state = applyClosedEventReturn(state, -0.0025 / 1.10);
  assert.ok(q102PortfolioDrawdownPct(state) <= 0.30 + 1e-9);
  assert.equal(decideQ102PortfolioDdGross("BRK", state).requestedGross, 3.0);

  state = applyClosedEventReturn(state, -0.01);
  const belowPeak = decideQ102PortfolioDdGross("BRK", state);
  assert.ok(belowPeak.currentDrawdownPct > 0.30);
  assert.equal(belowPeak.baseRequestedGross, 2.465);
  assert.equal(belowPeak.requestedGross, 2.465);
  assert.equal(belowPeak.boostEnabled, false);
});
