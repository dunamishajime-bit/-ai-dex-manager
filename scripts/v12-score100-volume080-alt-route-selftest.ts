import assert from "node:assert/strict";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { evaluateV12EntryQuality, evaluateV12WinRateGateFromFeatures, selectV12Top3Candidates } from "@/lib/v12-x1-all";

// Proposed Score/Volume thresholds. This is a research branch: no runner is activated.
assert.equal(V12_X1_ALL.neutralScoreThreshold, 1.0);
assert.equal(V12_X1_ALL.minimumVolumeRatio, 0.80);

// Normal path: exact inclusive floor. Neutral requires normal score.
const base={regime:"NEUTRAL" as const,strongRegime:false,side:"LONG" as const,momentum:.04,atrRatio:.018};
assert.equal(evaluateV12EntryQuality({...base,score:.99999}),false);
assert.equal(evaluateV12EntryQuality({...base,score:1.0}),true);

// Strong BTC directional path is currently disjoint from normal:
// [0.15, 0.70] plus ATR/price >=1.4%; (0.70,1.00) is a gap.
const strong={regime:"LONG" as const,strongRegime:true,side:"LONG" as const,momentum:.06,atrRatio:.014};
assert.equal(evaluateV12EntryQuality({...strong,score:.149999}),false);
assert.equal(evaluateV12EntryQuality({...strong,score:.15}),true);
assert.equal(evaluateV12EntryQuality({...strong,score:.70}),true);
assert.equal(evaluateV12EntryQuality({...strong,score:.700001}),false);
assert.equal(evaluateV12EntryQuality({...strong,score:.999999}),false);
assert.equal(evaluateV12EntryQuality({...strong,score:1.0}),true);
assert.equal(evaluateV12EntryQuality({...strong,score:.20,atrRatio:.01399}),false);
assert.equal(evaluateV12EntryQuality({...strong,score:.50,side:"SHORT",momentum:-.06}),false);

// User-selected non-strong directional rescue: score >=0.35, momentum >=5.4%
// and ATR/price >=1.4%. Strong-Regime rescue remains exactly unchanged.
const relaxed={regime:"LONG" as const,strongRegime:false,side:"LONG" as const,momentum:.054,atrRatio:.014};
assert.equal(V12_X1_ALL.relaxedRegimeMinimumScore,.35);
assert.equal(evaluateV12EntryQuality({...relaxed,score:.01}),false);
assert.equal(evaluateV12EntryQuality({...relaxed,score:.349999}),false);
assert.equal(evaluateV12EntryQuality({...relaxed,score:.35}),true);
assert.equal(evaluateV12EntryQuality({...relaxed,score:.20,momentum:.05399}),false);
assert.equal(evaluateV12EntryQuality({...relaxed,score:.20,atrRatio:.01399}),false);
assert.equal(evaluateV12EntryQuality({...relaxed,score:1.0,momentum:.023,atrRatio:.006}),true);

// Top3 third position remains score >= 0.70, even under relaxed path.
assert.equal(V12_X1_ALL.rank3MinimumScore,.70);
// The return shape is deliberately unchanged; selection tests cover 3rd-slot floor.
const samples=[1.5,1.2,.69,.7].map((score,i)=>({symbol:"X"+i,side:"LONG" as const,momentum:.06,volatility:.03,atr:1,volumeRatio:1,score}));
const selection=selectV12Top3Candidates(samples.sort((a,b)=>b.score-a.score));
assert.equal(selection.length,3);
assert.equal(selection[2].candidate.score,.70);

// Win-rate Gate remains independent from score and volume floors.
const features={ret6h:.01,ret24h:.03,btc12h:.025,btc24h:.025,btcEr12:.3,btcEr24:.5,rel24h:.005,previousVolumeRatio:.75};
const hc=evaluateV12WinRateGateFromFeatures(features,1);
assert.equal(hc.reason,"ALLOW_HC175");
assert.equal(hc.entryGrossMultiplier,1.75);
assert.equal(V12_X1_ALL.falseBurstBtcEr24Max,.20);
assert.equal(V12_X1_ALL.highConfidenceGrossMultiplier,1.75);
assert.equal(V12_X1_ALL.maxHoldBars,23);
assert.equal(V12_X1_ALL.cooldownBars,1);
console.log("V12_SCORE100_VOLUME080_ALT_ROUTE_SELFTEST_PASS",JSON.stringify({
normalScore:V12_X1_ALL.neutralScoreThreshold,
minimumVolumeRatio:V12_X1_ALL.minimumVolumeRatio,
unchangedStrongScore:[V12_X1_ALL.strongRegimeQualityScoreMinimum,V12_X1_ALL.strongRegimeQualityScoreMaximum],
strongScoreGapAbove:.70,
relaxedMomentumPct:V12_X1_ALL.relaxedRegimeMinimumMomentumPct,
relaxedScoreMin:V12_X1_ALL.relaxedRegimeMinimumScore,
winRateGate:"UNCHANGED",liveActivation:false
}));
