import { isHypeZecStrategy, type HypeZecStrategy } from "../config/hypeZecLongPolicy";
import { classifyAsterSymbol } from "./disdex-aster-portfolio-classifier";
import type { StrictPortfolioIntent, StrictPortfolioPosition } from "./disdex-strict-portfolio-planner";

const EPSILON = 1e-9;

export type HypeZecReductionPlan = {
  strategy: HypeZecStrategy;
  symbol: string;
  positionId: string;
  reducedQuantity: number;
  reducedFraction: number;
  releasedGross: number;
  reason: "PRIORITY_ENTRY_CAPACITY_PREEMPTION";
};

export type HypeZecPreemptionPlan = {
  status: "planned" | "not-needed" | "blocked";
  reason: string;
  requiredGross: number;
  releasedGross: number;
  reductions: HypeZecReductionPlan[];
};

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function currentNotional(position: StrictPortfolioPosition) {
  return positive(position.quantity) * positive(position.markPrice);
}

function sidecarPosition(position: StrictPortfolioPosition): position is StrictPortfolioPosition & { strategy: HypeZecStrategy } {
  return isHypeZecStrategy(position.strategy)
    && position.side === "LONG"
    && currentNotional(position) > EPSILON;
}

function isPriorityCandidate(intent: StrictPortfolioIntent) {
  return !isHypeZecStrategy(intent.strategy);
}

/**
 * Pure capacity planner. It never submits, cancels, or mutates an order.
 * The caller must re-read venue state and execute the returned reductions
 * under the shared account lock before submitting the priority entry.
 */
export function planHypeZecPreemption(input: {
  equityUsd: number;
  now: number;
  currentCryptoGross: number;
  currentTotalGross: number;
  pendingCryptoGross?: number;
  pendingTotalGross?: number;
  cryptoEntryCap: number;
  totalEntryCap: number;
  active: StrictPortfolioPosition[];
  candidate?: StrictPortfolioIntent;
}): HypeZecPreemptionPlan {
  const equity = positive(input.equityUsd);
  if (!(equity > 0)) return { status: "blocked", reason: "EQUITY_UNAVAILABLE", requiredGross: 0, releasedGross: 0, reductions: [] };
  if (!input.candidate) return { status: "not-needed", reason: "NO_PRIORITY_CANDIDATE", requiredGross: 0, releasedGross: 0, reductions: [] };
  if (!isPriorityCandidate(input.candidate)) return { status: "not-needed", reason: "SIDECAR_CANNOT_PREEMPT_SIDECAR", requiredGross: 0, releasedGross: 0, reductions: [] };
  const candidateGross = Math.max(0, Number(input.candidate.gross));
  if (!(candidateGross > EPSILON)) return { status: "blocked", reason: "CANDIDATE_GROSS_INVALID", requiredGross: 0, releasedGross: 0, reductions: [] };
  const requestedSleeve = input.candidate.strategy === "V52"
    ? "V50_POST_OPEN_BASIS"
    : input.candidate.strategy === "V50_POST_OPEN_BASIS" || input.candidate.strategy === "V11_EQ"
      ? input.candidate.strategy
    : undefined;
  const candidateAssetClass = classifyAsterSymbol(input.candidate.symbol, requestedSleeve).assetClass;
  if (candidateAssetClass !== "CRYPTO" && candidateAssetClass !== "STOCK") {
    return { status: "blocked", reason: "CANDIDATE_ASSET_CLASS_UNRESOLVED", requiredGross: 0, releasedGross: 0, reductions: [] };
  }
  const candidateCryptoGross = candidateAssetClass === "CRYPTO" ? candidateGross : 0;
  const pendingCrypto = Math.max(0, Number(input.pendingCryptoGross || 0));
  const pendingTotal = Math.max(0, Number(input.pendingTotalGross || 0));
  const cryptoRequired = Math.max(0, Number(input.currentCryptoGross) + pendingCrypto + candidateCryptoGross - Number(input.cryptoEntryCap));
  const totalRequired = Math.max(0, Number(input.currentTotalGross) + pendingTotal + candidateGross - Number(input.totalEntryCap));
  const requiredGross = Math.max(cryptoRequired, totalRequired);
  if (!(requiredGross > EPSILON)) return { status: "not-needed", reason: "CAPACITY_AVAILABLE", requiredGross: 0, releasedGross: 0, reductions: [] };

  const candidates = input.active
    .filter(sidecarPosition)
    .sort((left, right) => {
      const strategyOrder = left.strategy.localeCompare(right.strategy);
      return strategyOrder || left.entryTs - right.entryTs || left.id.localeCompare(right.id);
    });
  const capacity = candidates.reduce((sum, position) => sum + currentNotional(position) / equity * 0.5, 0);
  if (capacity + EPSILON < requiredGross) {
    return { status: "blocked", reason: "SIDECAR_HALF_REDUCTION_INSUFFICIENT", requiredGross, releasedGross: 0, reductions: [] };
  }

  const targetGross = Math.min(requiredGross, capacity);
  const totalNotional = candidates.reduce((sum, position) => sum + currentNotional(position), 0);
  const reductions = candidates.map((position) => {
    const positionGross = currentNotional(position) / equity;
    const releasedGross = Math.min(positionGross * 0.5, targetGross * (currentNotional(position) / totalNotional));
    const reducedQuantity = releasedGross * equity / position.markPrice;
    return {
      strategy: position.strategy,
      symbol: position.symbol,
      positionId: position.id,
      reducedQuantity,
      reducedFraction: reducedQuantity / position.quantity,
      releasedGross,
      reason: "PRIORITY_ENTRY_CAPACITY_PREEMPTION" as const,
    };
  }).filter((row) => row.releasedGross > EPSILON);
  const releasedGross = reductions.reduce((sum, row) => sum + row.releasedGross, 0);
  if (releasedGross + EPSILON < requiredGross) {
    return { status: "blocked", reason: "SIDECAR_REDUCTION_PLAN_UNDER_RELEASES_CAPACITY", requiredGross, releasedGross, reductions: [] };
  }
  return { status: "planned", reason: "PRIORITY_ENTRY_REQUIRES_SIDECAR_PREEMPTION", requiredGross, releasedGross, reductions };
}
