import type { V12ObservedCandidate } from "@/lib/v12-x1-all";
import { TOP3_FET_Q102_CANDIDATE } from "@/config/top3FetQ102Candidate";

export interface V12Top3ShadowSelection {
  base: V12ObservedCandidate[];
  rank3?: V12ObservedCandidate;
  rank3RequestedGross: number;
  blockedReason?: string;
}

export function selectV12Top3ShadowCandidates(
  candidates: readonly V12ObservedCandidate[],
): V12Top3ShadowSelection {
  const eligible = [...candidates]
    .filter((row) => row.signalEligible)
    .sort((a, b) => a.rank - b.rank || b.score - a.score || a.symbol.localeCompare(b.symbol));

  const base = eligible.slice(0, TOP3_FET_Q102_CANDIDATE.v12.baseMaximumPositions);
  const rank3 = eligible.find((row) =>
    row.rank >= 3
    && row.score >= TOP3_FET_Q102_CANDIDATE.v12.rank3MinimumScore
    && !base.some((head) => head.symbol === row.symbol),
  );

  return {
    base,
    rank3,
    rank3RequestedGross: rank3 ? TOP3_FET_Q102_CANDIDATE.v12.rank3GrossCap : 0,
    blockedReason: rank3 ? undefined : "NO_ELIGIBLE_RANK3_SCORE_070",
  };
}
