import { TOP3_FET_Q102_CANDIDATE } from "@/config/top3FetQ102Candidate";
import { quality102GrossForFamily } from "@/config/integratedProductionRiskPolicy";

export interface Q102PortfolioDdGovernorState {
  twrIndex: number;
  twrPeak: number;
  closedEventCount: number;
}

export interface Q102PortfolioDdGovernorDecision {
  family: string;
  baseRequestedGross: number;
  requestedGross: number;
  currentDrawdownPct: number;
  boostEnabled: boolean;
  reason: "DD_WITHIN_0P30_BOOST_TO_3P0" | "DD_ABOVE_0P30_USE_BASE";
}

export function initialQ102PortfolioDdGovernorState(): Q102PortfolioDdGovernorState {
  return { twrIndex: 1, twrPeak: 1, closedEventCount: 0 };
}

export function applyClosedEventReturn(
  state: Q102PortfolioDdGovernorState,
  eventReturn: number,
): Q102PortfolioDdGovernorState {
  if (!Number.isFinite(eventReturn) || eventReturn <= -1) {
    throw new Error(`Q102_DD_GOVERNOR_EVENT_RETURN_INVALID:${eventReturn}`);
  }
  const twrIndex = state.twrIndex * Math.max(0.000001, 1 + eventReturn);
  return {
    twrIndex,
    twrPeak: Math.max(state.twrPeak, twrIndex),
    closedEventCount: state.closedEventCount + 1,
  };
}

export function q102PortfolioDrawdownPct(state: Q102PortfolioDdGovernorState): number {
  return Math.max(0, (1 - state.twrIndex / Math.max(1e-12, state.twrPeak)) * 100);
}

export function decideQ102PortfolioDdGross(
  family: string,
  state: Q102PortfolioDdGovernorState,
): Q102PortfolioDdGovernorDecision {
  const baseRequestedGross = quality102GrossForFamily(family);
  const currentDrawdownPct = q102PortfolioDrawdownPct(state);
  const boostEnabled = currentDrawdownPct <= TOP3_FET_Q102_CANDIDATE.q102Governor.maximumEntryDrawdownPct;
  return {
    family,
    baseRequestedGross,
    requestedGross: boostEnabled
      ? Math.min(TOP3_FET_Q102_CANDIDATE.q102Governor.maximumGross, Math.max(baseRequestedGross, TOP3_FET_Q102_CANDIDATE.q102Governor.maximumGross))
      : baseRequestedGross,
    currentDrawdownPct,
    boostEnabled,
    reason: boostEnabled ? "DD_WITHIN_0P30_BOOST_TO_3P0" : "DD_ABOVE_0P30_USE_BASE",
  };
}
