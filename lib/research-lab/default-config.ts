import type { ResearchLabConfig, ResearchLabThresholds } from "./types";

export const DEFAULT_RESEARCH_THRESHOLDS: ResearchLabThresholds = {
  minCagrPct: 40,
  maxDrawdownPct: 25,
  minSharpe: 1.3,
  minSortino: 1.5,
  minProfitFactor: 1.35,
  minTradeCount: 30,
  minPositiveMonthPct: 55,
  minTemporalStabilityScore: 0.55,
  minRecentPeriodScore: 0.45,
};

export const SMOKE_RESEARCH_CONFIG: ResearchLabConfig = {
  rounds: 2,
  populationPerRound: 3,
  eliteCount: 2,
  maxConcurrency: 1,
  seed: 5601,
  thresholds: DEFAULT_RESEARCH_THRESHOLDS,
};

export const PRODUCTION_RESEARCH_CONFIG: ResearchLabConfig = {
  rounds: 100,
  populationPerRound: 5,
  eliteCount: 2,
  maxConcurrency: 1,
  seed: 5601,
  thresholds: DEFAULT_RESEARCH_THRESHOLDS,
};

export function researchConfigFromEnvironment(): ResearchLabConfig {
  const production = process.env.RESEARCH_PROFILE === "production";
  const base = production ? PRODUCTION_RESEARCH_CONFIG : SMOKE_RESEARCH_CONFIG;
  const numberFromEnv = (name: string, fallback: number, min: number, max: number) => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
  };
  const dateFromEnv = (name: string, fallback?: number) => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    ...base,
    rounds: numberFromEnv("RESEARCH_ROUNDS", base.rounds, 1, 1000),
    populationPerRound: numberFromEnv("RESEARCH_POPULATION", base.populationPerRound, 1, 500),
    eliteCount: numberFromEnv("RESEARCH_ELITES", base.eliteCount, 1, 50),
    maxConcurrency: numberFromEnv("RESEARCH_CONCURRENCY", base.maxConcurrency, 1, 4),
    seed: numberFromEnv("RESEARCH_SEED", base.seed, 1, 2_147_483_647),
    startTs: dateFromEnv("RESEARCH_START_DATE", base.startTs),
    endTs: dateFromEnv("RESEARCH_END_DATE", base.endTs),
  };
}
