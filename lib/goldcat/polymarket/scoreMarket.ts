import { defaultPolymarketConfig } from "./config";
import type { PolymarketConfig, PolymarketDecision, PolymarketMarketSnapshot, PolymarketScore } from "./types";

function clamp(value: number, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function pctScore(value: number) {
  return clamp(value * 100);
}

function getEntryPrice(market: PolymarketMarketSnapshot) {
  return market.recommendedSide === "YES" ? market.currentYesPrice : market.currentNoPrice;
}

function getRejectReason(market: PolymarketMarketSnapshot, config: PolymarketConfig): string | null {
  const entryPrice = getEntryPrice(market);
  const deadlineMs = Date.parse(market.deadlineIso);
  if (!market.marketId || !market.title) return "missing_market_identity";
  if (market.recommendedSide !== "YES" && market.recommendedSide !== "NO") return "invalid_recommended_side";
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) return "invalid_entry_price";
  if (market.resolutionRisk === "high") return "resolution_risk_high";
  if (!market.liquidityOk) return "liquidity_not_ok";
  if (market.negativeNews) return "negative_news";
  if (market.strongOpposition) return "strong_opposition";
  if (market.edge < config.minEdge) return "edge_too_small";
  if (market.expectedReturn < config.minExpectedReturn) return "expected_return_too_low";
  if (market.liquidityUsd < config.minLiquidityUsd) return "liquidity_too_low";
  if (market.spread > config.maxSpread) return "spread_too_wide";
  if (Number.isFinite(deadlineMs) && deadlineMs < Date.now()) return "deadline_passed";
  return null;
}

function decisionFromScore(finalScore: number, rejectReason: string | null, config: PolymarketConfig): PolymarketDecision {
  if (rejectReason) return "Reject";
  if (finalScore >= config.minFinalScoreForEntry) return "Entry";
  if (finalScore >= config.watchScoreMin) return "Watch";
  return "Reject";
}

export function scorePolymarket(market: PolymarketMarketSnapshot, config = defaultPolymarketConfig): PolymarketScore {
  const entryPrice = getEntryPrice(market);
  const evidenceScore = pctScore(market.evidenceStrength) * 0.45 + pctScore(market.newsSignalStrength) * 0.25 + pctScore(market.xSignalStrength) * 0.2 + (market.primarySources ? 10 : 0);
  const mispricingScore = clamp((market.edge / 0.25) * 100);
  const expectedReturnScore = clamp((market.expectedReturn / 0.6) * 100);
  const liquidityScore = clamp((market.liquidityUsd / 25000) * 70 + (market.volume24h / 10000) * 20 + (market.spread <= 0.03 ? 10 : 0));
  const deadlineMs = Date.parse(market.deadlineIso);
  const hoursToDeadline = Number.isFinite(deadlineMs) ? Math.max(0, (deadlineMs - Date.now()) / 36e5) : 0;
  const timeEdgeScore = clamp(hoursToDeadline <= 72 ? 90 : hoursToDeadline <= 168 ? 75 : 55);
  const ruleClarityScore = pctScore(market.ruleClarity);
  const riskScore = clamp((market.resolutionRisk === "low" ? 85 : 55) - (market.spread > 0.05 ? 15 : 0) - (market.conflictingSources ? 15 : 0));
  const oppositionScore = market.strongOpposition ? 0 : market.resolutionRisk === "low" ? 85 : 60;

  const weighted =
    evidenceScore * config.weights.evidence +
    mispricingScore * config.weights.mispricing +
    expectedReturnScore * config.weights.expectedReturn +
    liquidityScore * config.weights.liquidity +
    timeEdgeScore * config.weights.timeEdge +
    ruleClarityScore * config.weights.ruleClarity +
    riskScore * config.weights.risk;
  const weightTotal = Object.values(config.weights).reduce((sum, value) => sum + value, 0);
  const finalScore = clamp(weighted / weightTotal);
  const rejectReason = getRejectReason(market, config);
  const decision = decisionFromScore(finalScore, rejectReason, config);

  return {
    market,
    entryPrice,
    evidenceScore: clamp(evidenceScore),
    mispricingScore,
    expectedReturnScore,
    liquidityScore,
    timeEdgeScore,
    ruleClarityScore,
    riskScore,
    oppositionScore,
    finalScore,
    decision,
    confidence: clamp((finalScore + evidenceScore + ruleClarityScore) / 3),
    rejectReason,
    aiEscalated: false,
    aiReviewResult: null,
  };
}
