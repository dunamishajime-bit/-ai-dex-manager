import { defaultPolymarketConfig } from "./config";
import type { PolymarketConfig, PolymarketScore } from "./types";

export function shouldEscalateToAI(score: PolymarketScore, config: PolymarketConfig = defaultPolymarketConfig) {
  if (!config.aiEscalationEnabled) return false;
  if (score.decision === "Reject" && score.rejectReason) return false;
  const borderline = score.finalScore >= config.aiEscalationScoreMin && score.finalScore <= config.aiEscalationScoreMax;
  const weakEvidence = score.evidenceScore < 60;
  const mediumRisk = score.riskScore >= 45 && score.riskScore <= 65;
  return Boolean(
    borderline ||
      score.market.conflictingSources ||
      score.market.complexRules ||
      weakEvidence ||
      mediumRisk ||
      score.market.newCategory
  );
}

export function buildAIPromptPayload(score: PolymarketScore) {
  return {
    marketId: score.market.marketId,
    title: score.market.title,
    category: score.market.category,
    deadlineIso: score.market.deadlineIso,
    recommendedSide: score.market.recommendedSide,
    entryPrice: score.entryPrice,
    estimatedProbability: score.market.estimatedProbability,
    edge: score.market.edge,
    expectedReturn: score.market.expectedReturn,
    liquidityUsd: score.market.liquidityUsd,
    spread: score.market.spread,
    evidenceScore: score.evidenceScore,
    ruleClarityScore: score.ruleClarityScore,
    riskScore: score.riskScore,
    oppositionScore: score.oppositionScore,
    finalScore: score.finalScore,
    ruleDecision: score.decision,
    rejectReason: score.rejectReason,
    notes: score.market.notes || []
  };
}

export function runAIReviewMock(score: PolymarketScore) {
  const risk = score.riskScore >= 70 ? "low" : score.riskScore >= 50 ? "medium" : "high";
  const decision = risk === "high" ? "Reject" : score.finalScore >= 85 ? "Entry" : "Watch";
  return {
    decision,
    confidence: Math.round(score.confidence),
    risk,
    reason: "Mock AI review. Replace this adapter with Telegram GPT-5.4/OpenAI/other model when API wiring is enabled.",
    opposition: score.oppositionScore < 60 ? "Opposition remains meaningful." : "No strong opposition."
  };
}

export function applyAIEscalation(score: PolymarketScore, config: PolymarketConfig = defaultPolymarketConfig): PolymarketScore {
  if (!shouldEscalateToAI(score, config)) return score;
  const review = runAIReviewMock(score);
  return {
    ...score,
    aiEscalated: true,
    aiReviewResult: `${review.decision} / confidence ${review.confidence} / risk ${review.risk}: ${review.reason}`,
    decision: review.decision as PolymarketScore["decision"],
    rejectReason: review.decision === "Reject" ? "ai_review_reject" : score.rejectReason
  };
}
