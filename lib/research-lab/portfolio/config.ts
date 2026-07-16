import { DEFAULT_PERP_SYMBOLS } from "../perp/config";
import type { PerpResearchProfile } from "../perp/types";
import type { PortfolioResearchConfig, PortfolioThresholds } from "./types";

const BALANCED_THRESHOLDS: PortfolioThresholds = {
  targetAverageMonthlyReturnPct: 30,
  discoveryMinAverageMonthlyReturnPct: 7,
  discoveryMaxDrawdownPct: 25,
  discoveryMinSharpe: 1.1,
  discoveryMinProfitFactor: 1.2,
  discoveryMinTrades: 40,
  discoveryMinAverageGrossExposure: 0.5,
  finalMinOosAverageMonthlyReturnPct: 30,
  finalMaxOosDrawdownPct: 25,
  finalMinOosTrades: 30,
  finalMinWalkForwardPassRatePct: 60,
  finalMinOosRetentionRatio: 0.5,
  finalMinStressAverageMonthlyReturnPct: 20,
  finalMinStressRetentionRatio: 0.5,
  finalMaxConsecutiveLosses: 10,
  finalMinAverageActivePositions: 1.25,
  requireBothDirections: true,
  requireZeroLiquidations: true,
};

const ATTACK_THRESHOLDS: PortfolioThresholds = {
  ...BALANCED_THRESHOLDS,
  discoveryMinAverageMonthlyReturnPct: 12,
  discoveryMaxDrawdownPct: 35,
  discoveryMinSharpe: 0.8,
  discoveryMinProfitFactor: 1.05,
  discoveryMinTrades: 60,
  discoveryMinAverageGrossExposure: 1.1,
  finalMaxOosDrawdownPct: 35,
  finalMaxConsecutiveLosses: 14,
  finalMinAverageActivePositions: 1.5,
};

const BASE_EXECUTION = {
  feeBpsPerSide: 6,
  slippageBpsPerSide: 5,
  adverseFundingBpsPer8h: 0.5,
  maintenanceMarginRate: 0.005,
};

const STRESS_EXECUTIONS: PortfolioResearchConfig["stressExecutions"] = [
  {
    label: "moderate-cost",
    execution: {
      feeBpsPerSide: 10,
      slippageBpsPerSide: 10,
      adverseFundingBpsPer8h: 2,
      maintenanceMarginRate: 0.005,
    },
  },
  {
    label: "severe-cost",
    execution: {
      feeBpsPerSide: 15,
      slippageBpsPerSide: 20,
      adverseFundingBpsPer8h: 4,
      maintenanceMarginRate: 0.005,
    },
  },
  {
    label: "extreme-cost",
    execution: {
      feeBpsPerSide: 20,
      slippageBpsPerSide: 30,
      adverseFundingBpsPer8h: 8,
      maintenanceMarginRate: 0.0075,
    },
  },
];

export const BALANCED_PORTFOLIO_CONFIG: PortfolioResearchConfig = {
  profile: "balanced",
  rounds: 20,
  populationPerRound: 5,
  eliteCount: 3,
  finalistCount: 5,
  seed: 5703,
  maxConcurrency: 1,
  startTs: Date.UTC(2023, 0, 1),
  endTs: Date.UTC(2026, 6, 1),
  symbols: DEFAULT_PERP_SYMBOLS,
  minimumSleeves: 2,
  maximumSleeves: 3,
  baseExecution: BASE_EXECUTION,
  stressExecutions: STRESS_EXECUTIONS,
  walkForwardFolds: 3,
  thresholds: BALANCED_THRESHOLDS,
};

export const ATTACK_PORTFOLIO_CONFIG: PortfolioResearchConfig = {
  ...BALANCED_PORTFOLIO_CONFIG,
  profile: "attack",
  rounds: 30,
  eliteCount: 4,
  finalistCount: 8,
  seed: 5713,
  thresholds: ATTACK_THRESHOLDS,
};

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function decimalEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function dateEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : fallback;
}

function profileEnv(): PerpResearchProfile {
  return process.env.PORTFOLIO_RESEARCH_PROFILE === "balanced" ? "balanced" : "attack";
}

export function portfolioResearchConfigFromEnvironment(): PortfolioResearchConfig {
  const profile = profileEnv();
  const base = profile === "attack" ? ATTACK_PORTFOLIO_CONFIG : BALANCED_PORTFOLIO_CONFIG;
  const symbols = process.env.PORTFOLIO_RESEARCH_SYMBOLS
    ?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return {
    ...base,
    profile,
    rounds: integerEnv("PORTFOLIO_RESEARCH_ROUNDS", base.rounds, 1, 1000),
    populationPerRound: integerEnv("PORTFOLIO_RESEARCH_POPULATION", base.populationPerRound, 1, 100),
    eliteCount: integerEnv("PORTFOLIO_RESEARCH_ELITES", base.eliteCount, 1, 20),
    finalistCount: integerEnv("PORTFOLIO_RESEARCH_FINALISTS", base.finalistCount, 1, 50),
    seed: integerEnv("PORTFOLIO_RESEARCH_SEED", base.seed, 1, 2_147_483_647),
    maxConcurrency: integerEnv("PORTFOLIO_RESEARCH_CONCURRENCY", base.maxConcurrency, 1, 4),
    startTs: dateEnv("PORTFOLIO_RESEARCH_START_DATE", base.startTs),
    endTs: dateEnv("PORTFOLIO_RESEARCH_END_DATE", base.endTs),
    symbols: symbols?.length ? symbols : base.symbols,
    minimumSleeves: integerEnv("PORTFOLIO_RESEARCH_MIN_SLEEVES", base.minimumSleeves, 2, 3) as 2 | 3,
    maximumSleeves: integerEnv("PORTFOLIO_RESEARCH_MAX_SLEEVES", base.maximumSleeves, 2, 3) as 2 | 3,
    walkForwardFolds: integerEnv("PORTFOLIO_RESEARCH_WALK_FORWARD_FOLDS", base.walkForwardFolds, 1, 8),
    thresholds: {
      ...base.thresholds,
      targetAverageMonthlyReturnPct: decimalEnv(
        "PORTFOLIO_RESEARCH_TARGET_MONTHLY_PCT",
        base.thresholds.targetAverageMonthlyReturnPct,
        1,
        200,
      ),
      finalMinOosAverageMonthlyReturnPct: decimalEnv(
        "PORTFOLIO_RESEARCH_FINAL_OOS_MONTHLY_PCT",
        base.thresholds.finalMinOosAverageMonthlyReturnPct,
        1,
        200,
      ),
      finalMinStressAverageMonthlyReturnPct: decimalEnv(
        "PORTFOLIO_RESEARCH_FINAL_STRESS_MONTHLY_PCT",
        base.thresholds.finalMinStressAverageMonthlyReturnPct,
        0,
        200,
      ),
    },
  };
}
