import type {
  PerpResearchConfig,
  PerpResearchProfile,
  PerpResearchThresholds,
} from "./types";

export const DEFAULT_PERP_SYMBOLS = [
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "XRP",
  "ADA",
  "AVAX",
  "LINK",
  "LTC",
  "ATOM",
  "AAVE",
  "NEAR",
  "INJ",
];

export const BALANCED_PERP_THRESHOLDS: PerpResearchThresholds = {
  targetAverageMonthlyReturnPct: 30,
  discoveryMinAverageMonthlyReturnPct: 5,
  discoveryMaxDrawdownPct: 25,
  discoveryMinSharpe: 1.1,
  discoveryMinProfitFactor: 1.25,
  discoveryMinTrades: 20,
  targetAverageEffectiveLeverage: 0.75,
  finalMinOosAverageMonthlyReturnPct: 30,
  finalMaxOosDrawdownPct: 25,
  finalMinOosTrades: 12,
  finalMinWalkForwardPassRatePct: 60,
  finalMinOosRetentionRatio: 0.5,
  finalMinStressAverageMonthlyReturnPct: 20,
  finalMinStressRetentionRatio: 0.5,
  finalMaxConsecutiveLosses: 8,
  requireBothDirections: true,
  requireZeroLiquidations: true,
};

export const ATTACK_PERP_THRESHOLDS: PerpResearchThresholds = {
  ...BALANCED_PERP_THRESHOLDS,
  discoveryMinAverageMonthlyReturnPct: 8,
  discoveryMaxDrawdownPct: 35,
  discoveryMinSharpe: 0.8,
  discoveryMinProfitFactor: 1.1,
  discoveryMinTrades: 30,
  targetAverageEffectiveLeverage: 1.75,
  finalMaxOosDrawdownPct: 35,
  finalMaxConsecutiveLosses: 10,
};

const BASE_EXECUTION = {
  feeBpsPerSide: 6,
  slippageBpsPerSide: 5,
  adverseFundingBpsPer8h: 0.5,
  maintenanceMarginRate: 0.005,
};

const STRESS_EXECUTIONS: PerpResearchConfig["stressExecutions"] = [
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

export const BALANCED_PERP_RESEARCH_CONFIG: PerpResearchConfig = {
  profile: "balanced",
  rounds: 20,
  populationPerRound: 5,
  eliteCount: 3,
  finalistCount: 5,
  seed: 5603,
  maxConcurrency: 1,
  startTs: Date.UTC(2023, 0, 1),
  endTs: Date.UTC(2026, 6, 1),
  symbols: DEFAULT_PERP_SYMBOLS,
  baseExecution: BASE_EXECUTION,
  stressExecutions: STRESS_EXECUTIONS,
  walkForwardFolds: 3,
  thresholds: BALANCED_PERP_THRESHOLDS,
};

export const ATTACK_PERP_RESEARCH_CONFIG: PerpResearchConfig = {
  ...BALANCED_PERP_RESEARCH_CONFIG,
  profile: "attack",
  rounds: 30,
  eliteCount: 4,
  finalistCount: 8,
  seed: 5613,
  thresholds: ATTACK_PERP_THRESHOLDS,
};

export const DEFAULT_PERP_RESEARCH_CONFIG = BALANCED_PERP_RESEARCH_CONFIG;
export const DEFAULT_PERP_THRESHOLDS = BALANCED_PERP_THRESHOLDS;

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
  return process.env.PERP_RESEARCH_PROFILE === "attack" ? "attack" : "balanced";
}

export function perpResearchConfigFromEnvironment(): PerpResearchConfig {
  const profile = profileEnv();
  const base = profile === "attack" ? ATTACK_PERP_RESEARCH_CONFIG : BALANCED_PERP_RESEARCH_CONFIG;
  const symbols = process.env.PERP_RESEARCH_SYMBOLS
    ?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return {
    ...base,
    profile,
    rounds: integerEnv("PERP_RESEARCH_ROUNDS", base.rounds, 1, 1000),
    populationPerRound: integerEnv("PERP_RESEARCH_POPULATION", base.populationPerRound, 1, 200),
    eliteCount: integerEnv("PERP_RESEARCH_ELITES", base.eliteCount, 1, 20),
    finalistCount: integerEnv("PERP_RESEARCH_FINALISTS", base.finalistCount, 1, 50),
    seed: integerEnv("PERP_RESEARCH_SEED", base.seed, 1, 2_147_483_647),
    maxConcurrency: integerEnv("PERP_RESEARCH_CONCURRENCY", base.maxConcurrency, 1, 4),
    startTs: dateEnv("PERP_RESEARCH_START_DATE", base.startTs),
    endTs: dateEnv("PERP_RESEARCH_END_DATE", base.endTs),
    symbols: symbols?.length ? symbols : base.symbols,
    walkForwardFolds: integerEnv("PERP_RESEARCH_WALK_FORWARD_FOLDS", base.walkForwardFolds, 1, 8),
    thresholds: {
      ...base.thresholds,
      targetAverageMonthlyReturnPct: decimalEnv(
        "PERP_RESEARCH_TARGET_MONTHLY_PCT",
        base.thresholds.targetAverageMonthlyReturnPct,
        1,
        200,
      ),
      targetAverageEffectiveLeverage: decimalEnv(
        "PERP_RESEARCH_TARGET_EFFECTIVE_LEVERAGE",
        base.thresholds.targetAverageEffectiveLeverage,
        0.1,
        5,
      ),
      finalMinOosAverageMonthlyReturnPct: decimalEnv(
        "PERP_RESEARCH_FINAL_OOS_MONTHLY_PCT",
        base.thresholds.finalMinOosAverageMonthlyReturnPct,
        1,
        200,
      ),
      finalMinStressAverageMonthlyReturnPct: decimalEnv(
        "PERP_RESEARCH_FINAL_STRESS_MONTHLY_PCT",
        base.thresholds.finalMinStressAverageMonthlyReturnPct,
        0,
        200,
      ),
    },
  };
}
