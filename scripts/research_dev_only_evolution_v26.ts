import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { createInitialPerpPopulation, createNextPerpPopulation } from "../lib/research-lab/perp/evolution";
import type { PerpBacktestResult, PerpExecutionAssumptions, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 120 * 24 * HOUR;

const UNIVERSE = [
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "PENGU",
  "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
];

const ROUNDS = 12;
const POPULATION = 16;
const ELITES = 4;
const FINALISTS = 8;
const SEED = 260816;
const TARGET_MONTHLY = 6.0; // approximately 100% annual compounding; scoring metric only.

const NORMAL: PerpExecutionAssumptions = {
  feeBpsPerSide: 5,
  slippageBpsPerSide: 0,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};
const STRESS: PerpExecutionAssumptions = {
  feeBpsPerSide: 10,
  slippageBpsPerSide: 5,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};

function clampGenome(genome: PerpStrategyGenome): PerpStrategyGenome {
  return {
    ...genome,
    symbols: [...UNIVERSE],
    parameters: {
      ...genome.parameters,
      leverage: 1.0,
      maxMarginUsagePct: 100,
    },
  };
}

function window(label: string, startTs: number, endTs: number) {
  return { label, startTs, endTs };
}

function pfWithoutBest(result: PerpBacktestResult) {
  const trades = [...result.trades];
  const best = trades.reduce((bestIndex, trade, index) =>
    bestIndex < 0 || trade.netPnl > trades[bestIndex].netPnl ? index : bestIndex, -1);
  if (best >= 0) trades.splice(best, 1);
  const gp = trades.filter((t) => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const gl = Math.abs(trades.filter((t) => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
  return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
}

function devScore(result: PerpBacktestResult) {
  const m = result.metrics;
  const hardReject =
    m.tradeCount < 20 ||
    m.maxDrawdownPct > 35 ||
    m.profitFactor < 1.20 ||
    result.risk.liquidationCount > 0 ||
    result.risk.maximumEffectiveLeverage > 1.000001;
  if (hardReject) return -1_000_000 + m.cagrPct;
  // Fixed before any V/E evaluation. CAGR is primary; risk/stability only break ties.
  return m.cagrPct
    + 8 * Math.min(4, m.sharpe)
    + 4 * Math.min(6, m.sortino)
    + 0.15 * m.positiveMonthPct
    - 0.75 * m.maxDrawdownPct
    + 5 * Math.min(3, m.profitFactor - 1);
}

function summarize(result: PerpBacktestResult) {
  return {
    cagrPct: result.metrics.cagrPct,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
    sharpe: result.metrics.sharpe,
    sortino: result.metrics.sortino,
    profitFactor: result.metrics.profitFactor,
    profitFactorWithoutBest: pfWithoutBest(result),
    tradeCount: result.metrics.tradeCount,
    winRatePct: result.metrics.winRatePct,
    positiveMonthPct: result.metrics.positiveMonthPct,
    averageMonthlyReturnPct: result.metrics.averageMonthlyReturnPct,
    exposurePct: result.metrics.exposurePct,
    endingEquity: result.risk.endingEquity,
    maximumEffectiveLeverage: result.risk.maximumEffectiveLeverage,
    averageEffectiveLeverage: result.risk.averageEffectiveLeverage,
    liquidationCount: result.risk.liquidationCount,
    longTrades: result.risk.longTrades,
    shortTrades: result.risk.shortTrades,
    maxConsecutiveLosses: result.risk.maxConsecutiveLosses,
    annualReturnsPct: result.annualReturnsPct,
    monthlyReturnsPct: result.monthlyReturnsPct,
  };
}

function robustGate(input: {
  dev: PerpBacktestResult;
  val: PerpBacktestResult;
  eval: PerpBacktestResult;
  combined: PerpBacktestResult;
  stress: PerpBacktestResult;
}) {
  const annual = [input.dev.metrics.cagrPct, input.val.metrics.cagrPct, input.eval.metrics.cagrPct];
  const stressAnnual = input.stress.annualReturnsPct;
  const sorted = [...annual].sort((a, b) => a - b);
  const medianAnnual = sorted[1] ?? -999;
  const checks = {
    everyAnnualAtLeast80: annual.every((x) => x >= 80),
    medianAnnualAtLeast100: medianAnnual >= 100,
    combinedCagrAtLeast100: input.combined.metrics.cagrPct >= 100,
    combinedPfAtLeast1p40: input.combined.metrics.profitFactor >= 1.40,
    combinedPfWithoutBestAtLeast1p25: pfWithoutBest(input.combined) >= 1.25,
    combinedDDAtMost40: input.combined.metrics.maxDrawdownPct <= 40,
    tradesAtLeast24: input.combined.metrics.tradeCount >= 24,
    maxEffectiveLeverageAtMost1: input.combined.risk.maximumEffectiveLeverage <= 1.000001,
    zeroLiquidations: input.combined.risk.liquidationCount === 0,
    stressCagrAtLeast45: input.stress.metrics.cagrPct >= 45,
    stressPfAtLeast1p08: input.stress.metrics.profitFactor >= 1.08,
    stressPfWithoutBestAtLeast1: pfWithoutBest(input.stress) >= 1,
    stressDDAtMost50: input.stress.metrics.maxDrawdownPct <= 50,
    atLeastTwoStressPositiveYears: stressAnnual.filter((x) => x > 0).length >= 2,
    worstStressYearAboveMinus25: stressAnnual.length >= 3 && Math.min(...stressAnnual) > -25,
  };
  return { checks, historicalCandidatePass: Object.values(checks).every(Boolean) };
}

async function main() {
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END });
  const devWindow = window("development", START, DEV_END);
  const valWindow = window("validation", DEV_END, VAL_END);
  const evalWindow = window("evaluation", VAL_END, END);
  const combinedWindow = window("combined3y", START, END);

  let population = createInitialPerpPopulation(POPULATION, SEED, "balanced").map(clampGenome);
  const rounds: Array<Record<string, unknown>> = [];
  let finalRanked: Array<{ genome: PerpStrategyGenome; result: PerpBacktestResult; score: number }> = [];

  for (let generation = 0; generation < ROUNDS; generation += 1) {
    const ranked = population.map((genome) => {
      const result = runPerpBacktest({ genome, data, window: devWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
      return { genome, result, score: devScore(result) };
    }).sort((a, b) => b.score - a.score || b.result.metrics.cagrPct - a.result.metrics.cagrPct || a.genome.id.localeCompare(b.genome.id));

    finalRanked = ranked;
    rounds.push({
      generation,
      bestId: ranked[0]?.genome.id ?? null,
      bestScore: ranked[0]?.score ?? null,
      bestDevelopment: ranked[0] ? summarize(ranked[0].result) : null,
      eligibleCount: ranked.filter((x) => x.score > -900_000).length,
    });

    if (generation + 1 < ROUNDS) {
      const elites = ranked.slice(0, ELITES).map((x) => x.genome);
      population = createNextPerpPopulation({
        elites,
        count: POPULATION,
        generation: generation + 1,
        seed: SEED,
        profile: "balanced",
      }).map(clampGenome);
    }
  }

  // IMPORTANT: V/E are first touched here, after all generations and Development-only ranking are complete.
  const finalists = finalRanked.slice(0, FINALISTS).map(({ genome, result: dev, score }) => {
    const val = runPerpBacktest({ genome, data, window: valWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const evaluation = runPerpBacktest({ genome, data, window: evalWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const combined = runPerpBacktest({ genome, data, window: combinedWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const stress = runPerpBacktest({ genome, data, window: combinedWindow, execution: STRESS, targetMonthlyReturnPct: TARGET_MONTHLY });
    const gate = robustGate({ dev, val, eval: evaluation, combined, stress });
    return {
      genome,
      developmentSelectionScore: score,
      development: summarize(dev),
      validation: summarize(val),
      evaluation: summarize(evaluation),
      combined3Y: summarize(combined),
      combined3YStress: summarize(stress),
      historicalGate: gate,
    };
  }).sort((a, b) =>
    Number(b.historicalGate.historicalCandidatePass) - Number(a.historicalGate.historicalCandidatePass)
    || b.combined3Y.cagrPct - a.combined3Y.cagrPct);

  const out = {
    researchLine: "V26_DEVELOPMENT_ONLY_EVOLUTION_1X",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    liveEligible: false,
    freshOosRead: false,
    freshOosConsumed: false,
    target: { main3YCagrPct: 100, annualFloorPct: 80, grossExposureCapPct: 100, leverageMultiplier: 1.0 },
    methodology: {
      rounds: ROUNDS,
      population: POPULATION,
      elites: ELITES,
      finalists: FINALISTS,
      seed: SEED,
      evolutionData: "2023-07-01 <= t < 2024-07-01 only",
      validationFirstRead: "after all Development generations finish",
      evaluationFirstRead: "after all Development generations finish",
      allGenomesForcedLeverage: 1.0,
      allGenomesForcedUniverse: UNIVERSE,
      symbolSpecificParameters: false,
      yearSpecificParameters: false,
    },
    execution: { normal: NORMAL, stress: STRESS },
    universe: UNIVERSE,
    rounds,
    finalists,
    historicalCandidatePass: finalists.some((x) => x.historicalGate.historicalCandidatePass),
  };

  const root = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "dev-only-evolution-v26.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
