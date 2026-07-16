export interface ResearchCycleHistoryPoint {
  cycle: number;
  completedAt: string;
  profile: "attack" | "balanced";
  evaluations: number;
  validated: number;
  finalCandidates: number;
  bestTrainMonthlyPct: number;
  bestOosMonthlyPct: number | null;
  bestOosDrawdownPct: number | null;
  bestWorstStressMonthlyPct: number | null;
}

export interface ResearchEliteSummary {
  id: string;
  family: string;
  thesis: string;
  symbols: string[];
  timeframeHours: number;
  leverage: number;
  riskPerTradePct: number;
  maxMarginUsagePct: number;
  minimumEdgeToCostRatio: number;
  allowLong: boolean;
  allowShort: boolean;
  allowNeutralRegime: boolean;
}

export interface ResearchDashboardPayload {
  generatedAt: string;
  lastRunAt: string | null;
  freshness: "fresh" | "delayed" | "stale" | "unknown";
  cycle: number;
  nextProfile: "attack" | "balanced";
  consecutiveNoCandidate: number;
  bestEver: {
    trainMonthlyPct: number | null;
    oosMonthlyPct: number | null;
    score: number | null;
  };
  latest: ResearchCycleHistoryPoint | null;
  history: ResearchCycleHistoryPoint[];
  elites: ResearchEliteSummary[];
  nextPlan: string[];
  deduplication: {
    historicalFingerprintsLoaded: number;
    newUniqueLogicTested: number;
    duplicateStrategiesSkipped: number;
    replacementCandidatesGenerated: number;
    exhaustedPopulationSlots: number;
    totalUniqueLogic: number;
  };
  targets: {
    oosMonthlyPct: number;
    stressMonthlyPct: number;
  };
  links: {
    actions: string;
    latestReport: string;
    state: string;
    issues: string;
  };
}
