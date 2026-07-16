import type { ResearchLabConfig, ResearchLabThresholds } from "./types";

export const DEFAULT_RESEARCH_THRESHOLDS: ResearchLabThresholds = {
  minCagrPct: 40,
  maxDrawdownPct: 25,
  minSharpe: 1.3,
  minSortino: 1.5,
  minProfitFactor: 1.35,
  minTradeCount: 30,
  minAverageMonthlyReturnPct: 3,
  minMedianMonthlyReturnPct: 1,
  minPositiveMonthPct: 55,
  minTemporalStabilityScore: 0.55,
  minRecentPeriodScore: 0.45,
  targetAverageMonthlyReturnPct: 30,
  finalMinOosAverageMonthlyReturnPct: 30,
  finalMinStressAverageMonthlyReturnPct: 20,
  minTargetMonthlyHitRatePct: 20,
  minOosRetentionRatio: 0.5,
  minStressRetentionRatio: 0.5,
  maxOosDrawdownPct: 30,
  minWalkForwardPassRatePct: 60,
};

export const SMOKE_RESEARCH_CONFIG: ResearchLabConfig = {
  rounds: 2,
  populationPerRound: 3,
  eliteCount: 2,
  finalValidationCount: 2,
  maxConcurrency: 1,
  seed: 5601,
  walkForwardFolds: 2,
  stressExtraRoundTripCostBps: [20, 50],
  thresholds: DEFAULT_RESEARCH_THRESHOLDS,
};

export const PRODUCTION_RESEARCH_CONFIG: ResearchLabConfig = {
  rounds: 100,
  populationPerRound: 5,
  eliteCount: 2,
  finalValidationCount: 10,
  maxConcurrency: 1,
  seed: 5601,
  walkForwardFolds: 3,
  stressExtraRoundTripCostBps: [20, 50, 100],
  thresholds: DEFAULT_RESEARCH_THRESHOLDS,
};

export function researchConfigFromEnvironment(): ResearchLabConfig {
  const production = process.env.RESEARCH_PROFILE === "production";
  const base = production ? PRODUCTION_RESEARCH_CONFIG : SMOKE_RESEARCH_CONFIG;
  const numberFromEnv = (name: string, fallback: number, min: number, max: number) => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
  };
  const decimalFromEnv = (name: string, fallback: number, min: number, max: number) => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const dateFromEnv = (name: string, fallback?: number) => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const costsFromEnv = () => {
    const raw = process.env.RESEARCH_STRESS_COST_BPS;
    if (!raw) return base.stressExtraRoundTripCostBps;
    const parsed = raw
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 500);
    return parsed.length ? parsed : base.stressExtraRoundTripCostBps;
  };

  return {
    ...base,
    rounds: numberFromEnv("RESEARCH_ROUNDS", base.rounds, 1, 1000),
    populationPerRound: numberFromEnv("RESEARCH_POPULATION", base.populationPerRound, 1, 500),
    eliteCount: numberFromEnv("RESEARCH_ELITES", base.eliteCount, 1, 50),
    finalValidationCount: numberFromEnv("RESEARCH_FINALISTS", base.finalValidationCount, 1, 100),
    maxConcurrency: numberFromEnv("RESEARCH_CONCURRENCY", base.maxConcurrency, 1, 4),
    seed: numberFromEnv("RESEARCH_SEED", base.seed, 1, 2_147_483_647),
    walkForwardFolds: numberFromEnv("RESEARCH_WALK_FORWARD_FOLDS", base.walkForwardFolds, 1, 8),
    stressExtraRoundTripCostBps: costsFromEnv(),
    startTs: dateFromEnv("RESEARCH_START_DATE", base.startTs),
    endTs: dateFromEnv("RESEARCH_END_DATE", base.endTs),
    thresholds: {
      ...base.thresholds,
      targetAverageMonthlyReturnPct: decimalFromEnv(
        "RESEARCH_TARGET_MONTHLY_PCT",
        base.thresholds.targetAverageMonthlyReturnPct,
        1,
        200,
      ),
      finalMinOosAverageMonthlyReturnPct: decimalFromEnv(
        "RESEARCH_FINAL_OOS_MONTHLY_PCT",
        base.thresholds.finalMinOosAverageMonthlyReturnPct,
        1,
        200,
      ),
      finalMinStressAverageMonthlyReturnPct: decimalFromEnv(
        "RESEARCH_FINAL_STRESS_MONTHLY_PCT",
        base.thresholds.finalMinStressAverageMonthlyReturnPct,
        0,
        200,
      ),
    },
  };
}
