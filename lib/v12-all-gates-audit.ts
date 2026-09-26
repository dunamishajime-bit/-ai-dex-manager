import { V12_X1_ALL as C } from "../config/v12X1AllRuntime";
import type { V12Candidate, V12Regime } from "./v12-x1-all";

// Diagnostic-only: never used to authorize an order. Values are computed
// independently so a first failed gate cannot hide later failures.
export type V12CheckStatus = "PASS" | "BLOCK" | "NOT_APPLICABLE" | "NOT_EVALUATED";
export type V12Check = { status: V12CheckStatus; observed?: number; minimum?: number; maximum?: number; detail?: string };
export interface V12AllGateAudit {
  schema: "v12-all-gates-audit/v1";
  checks: Record<string, V12Check>;
  strongScoreGap: boolean;
  strongScoreGapOnlyBaseFailure: boolean;
  independentBasePass: boolean;
  /** This is a selected-candidate overlay, not a fresh executable order. */
  portfolioRank?: number;
}
export type V12GateAuditInput = V12Candidate & {
  atrRatio: number;
  regime: V12Regime;
  strongRegime: boolean;
  portfolioRank?: number;
  winRate?: {allow: boolean; reason: string};
};
const ck = (good: boolean, observed?: number, minimum?: number, maximum?: number, detail?: string): V12Check =>
  ({ status: good ? "PASS" : "BLOCK", ...(observed !== undefined ? {observed} : {}),
    ...(minimum !== undefined ? {minimum} : {}), ...(maximum !== undefined ? {maximum} : {}),
    ...(detail ? {detail} : {}) });
const na = (detail: string): V12Check => ({status:"NOT_APPLICABLE",detail});
const ne = (detail: string): V12Check => ({status:"NOT_EVALUATED",detail});
export function inspectV12AllGateChecks(input: V12GateAuditInput): V12AllGateAudit {
  const {score,side,regime,strongRegime,atrRatio,portfolioRank,winRate} = input;
  const aligned = side === "LONG" ? input.momentum : -input.momentum;
  const edgeMin = C.minimumEdgeToCostRatio * C.normalRoundTripCostBps / 10_000;
  const directional = regime === "NEUTRAL" || regime === side;
  const volumeOk = Number.isFinite(input.volumeRatio) && input.volumeRatio >= C.minimumVolumeRatio;
  const edgeOk = Number.isFinite(aligned) && Math.abs(input.momentum) >= edgeMin;
  const momentumOk = Number.isFinite(aligned) && aligned >= C.minimumMomentumPct;
  const standardOk = Number.isFinite(score) && score >= C.neutralScoreThreshold;
  const strongBandOk = score >= C.strongRegimeQualityScoreMinimum && score <= C.strongRegimeQualityScoreMaximum;
  const strongAtrOk = Number.isFinite(atrRatio) && atrRatio >= C.strongRegimeQualityMinimumAtrRatio;
  const weakMomOk = aligned >= C.relaxedRegimeMinimumMomentumPct;
  const weakAtrOk = Number.isFinite(atrRatio) && atrRatio >= C.relaxedRegimeMinimumAtrRatio;
  // Frozen logic: strong regime has a bounded alternative; weak regime
  // alone can use the momentum route when score is below standard minimum.
  const qualityOk = regime === "NEUTRAL"
    ? C.allowNeutralRegime && standardOk
    : directional && (standardOk || (strongRegime
      ? strongBandOk && strongAtrOk : weakMomOk && weakAtrOk));
  const baseOk = volumeOk && edgeOk && momentumOk && directional && qualityOk;
  const strongScoreGap = strongRegime && directional && score > C.strongRegimeQualityScoreMaximum
    && score < C.neutralScoreThreshold && strongAtrOk;
  const checks: Record<string,V12Check> = {
    volume: ck(volumeOk, input.volumeRatio, C.minimumVolumeRatio),
    edgeToCost: ck(edgeOk, Math.abs(input.momentum), edgeMin),
    momentum: ck(momentumOk, aligned, C.minimumMomentumPct),
    btcDirection: ck(directional, undefined, undefined, undefined, regime),
    scoreStandard: ck(standardOk, score, C.neutralScoreThreshold),
    scoreStrongAlternative: strongRegime && regime !== "NEUTRAL"
      ? ck(strongBandOk, score, C.strongRegimeQualityScoreMinimum, C.strongRegimeQualityScoreMaximum)
      : na("STRONG_REGIME_ONLY"),
    atrStrongAlternative: strongRegime && regime !== "NEUTRAL"
      ? ck(strongAtrOk, atrRatio, C.strongRegimeQualityMinimumAtrRatio) : na("STRONG_REGIME_ONLY"),
    momentumWeakAlternative: !strongRegime && regime !== "NEUTRAL"
      ? ck(weakMomOk, aligned, C.relaxedRegimeMinimumMomentumPct) : na("WEAK_REGIME_ONLY"),
    atrWeakAlternative: !strongRegime && regime !== "NEUTRAL"
      ? ck(weakAtrOk, atrRatio, C.relaxedRegimeMinimumAtrRatio) : na("WEAK_REGIME_ONLY"),
    entryQuality: ck(qualityOk, score, undefined, undefined, regime),
    portfolioSelection: !baseOk ? ne("BASE_GATE_BLOCKED")
      : portfolioRank === undefined ? ck(false,undefined,undefined,undefined,"NOT_TOP3")
      : ck(true,portfolioRank,1,3),
    rank3Score: portfolioRank === 3 ? ck(score >= C.rank3MinimumScore, score, C.rank3MinimumScore)
      : na("NOT_RANK3"),
    winRate: winRate ? ck(winRate.allow, undefined, undefined, undefined, winRate.reason)
      : ne(!baseOk ? "BASE_GATE_BLOCKED" : "NOT_RANKED_OR_UNEVALUATED"),
  };
  return { schema:"v12-all-gates-audit/v1", checks, strongScoreGap,
    strongScoreGapOnlyBaseFailure: strongScoreGap && volumeOk && edgeOk && momentumOk && directional,
    independentBasePass: baseOk, portfolioRank };
}
