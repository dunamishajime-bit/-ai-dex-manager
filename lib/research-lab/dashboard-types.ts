import type { ResearchDiscussionIndexEntry } from "./discussion-types";

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

export interface ChampionDashboardMetric {
  trainMonthlyPct: number;
  oosMonthlyPct: number;
  oosMaxDrawdownPct: number;
  worstStressMonthlyPct: number;
  walkForwardPassRatePct: number;
  oosTrades: number;
  profitFactor: number;
  liquidationCount: number;
}

export interface ChampionDashboardItem {
  slot: "oos" | "stress" | "stability";
  id: string;
  family: string;
  rootCauses: string[];
  noImprovementCycles: number;
  metrics: ChampionDashboardMetric;
}

export interface ChampionExperimentDashboardItem {
  id: string;
  championSlot: "oos" | "stress" | "stability";
  parentStrategyId: string;
  childStrategyId: string;
  hypothesis: string;
  changedParameter: string;
  beforeValue: string;
  afterValue: string;
  accepted: boolean;
  deltaOosMonthlyPct: number;
  deltaWorstStressMonthlyPct: number;
  deltaDrawdownImprovementPct: number;
  compositeImprovement: number;
  reasons: string[];
}

export interface ChampionDeepDashboardSummary {
  mode: "champion_deep";
  cycle: number;
  updatedAt: string | null;
  championCount: number;
  experimentCount: number;
  acceptedExperiments: number;
  champions: ChampionDashboardItem[];
  experiments: ChampionExperimentDashboardItem[];
  nextPlan: string[];
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
  latestDiscussion: ResearchDiscussionIndexEntry | null;
  deepResearch: ChampionDeepDashboardSummary | null;
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
    latestDiscussion: string;
    discussions: string;
    state: string;
    issues: string;
  };
}
