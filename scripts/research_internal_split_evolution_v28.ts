import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { createInitialPerpPopulation, createNextPerpPopulation } from "../lib/research-lab/perp/evolution";
import type { PerpBacktestResult, PerpExecutionAssumptions, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const TRAIN_END = Date.UTC(2024, 2, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 120 * 24 * HOUR;

const UNIVERSE = [
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "PENGU",
  "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
];

const ROUNDS = 16;
const POPULATION = 20;
const ELITES = 5;
const INTERNAL_POOL = 12;
const EXTERNAL_FINALISTS = 5;
const SEED = 280816;
const TARGET_MONTHLY = 6.0;

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

function trainScore(result: PerpBacktestResult) {
  const m = result.metrics;
  const hardReject =
    m.tradeCount < 16 ||
    m.maxDrawdownPct > 35 ||
    m.profitFactor < 1.15 ||
    result.risk.liquidationCount > 0 ||
    result.risk.maximumEffectiveLeverage > 1.000001;
  if (hardReject) return -1_000_000 + m.cagrPct;
  return m.cagrPct
    + 7 * Math.min(4, m.sharpe)
    + 3 * Math.min(6, m.sortino)
    + 0.1 * m.positiveMonthPct
    - 0.7 * m.maxDrawdownPct
    + 4 * Math.min(3, m.profitFactor - 1);
}

function internalEligible(result: PerpBacktestResult) {
  return result.metrics.tradeCount >= 8
    && result.metrics.maxDrawdownPct <= 30
    && result.metrics.profitFactor >= 1.10
    && result.risk.liquidationCount === 0
    && result.risk.maximumEffectiveLeverage <= 1.000001;
}

function internalScore(train: PerpBacktestResult, selection: PerpBacktestResult) {
  if (!internalEligible(selection)) return -1_000_000 + Math.min(train.metrics.cagrPct, selection.metrics.cagrPct);
  // Preregistered primary criterion: reward the weaker of Train/Selection CAGR.
  // PF and DD only break ties; no external V/E information enters this score.
  const floorCagr = Math.min(train.metrics.cagrPct, selection.metrics.cagrPct);
  const floorPf = Math.min(train.metrics.profitFactor, selection.metrics.profitFactor);
  const worstDd = Math.max(train.metrics.maxDrawdownPct, selection.metrics.maxDrawdownPct);
  return floorCagr + 6 * Math.min(3, floorPf - 1) - 0.5 * worstDd;
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
  const sorted = [...annual].sort((a, b) => a - b);
  const stressAnnual = input.stress.annualReturnsPct;
  const checks = {
    everyAnnualAtLeast80: annual.every((x) => x >= 80),
    medianAnnualAtLeast100: (sorted[1] ?? -999) >= 100,
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
  const trainWindow = window("train", START, TRAIN_END);
  const selectionWindow = window("internal-selection", TRAIN_END, DEV_END);
  const devWindow = window("development-full", START, DEV_END);
  const valWindow = window("external-validation", DEV_END, VAL_END);
  const evalWindow = window("external-evaluation", VAL_END, END);
  const combinedWindow = window("combined3y", START, END);

  let population = createInitialPerpPopulation(POPULATION, SEED, "balanced").map(clampGenome);
  const rounds: Array<Record<string, unknown>> = [];
  let finalTrainRanked: Array<{ genome: PerpStrategyGenome; train: PerpBacktestResult; score: number }> = [];

  for (let generation = 0; generation < ROUNDS; generation += 1) {
    const ranked = population.map((genome) => {
      const train = runPerpBacktest({ genome, data, window: trainWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
      return { genome, train, score: trainScore(train) };
    }).sort((a, b) => b.score - a.score || b.train.metrics.cagrPct - a.train.metrics.cagrPct || a.genome.id.localeCompare(b.genome.id));

    finalTrainRanked = ranked;
    rounds.push({
      generation,
      bestId: ranked[0]?.genome.id ?? null,
      bestTrainScore: ranked[0]?.score ?? null,
      bestTrain: ranked[0] ? summarize(ranked[0].train) : null,
      eligibleCount: ranked.filter((x) => x.score > -900_000).length,
    });

    if (generation + 1 < ROUNDS) {
      population = createNextPerpPopulation({
        elites: ranked.slice(0, ELITES).map((x) => x.genome),
        count: POPULATION,
        generation: generation + 1,
        seed: SEED,
        profile: "balanced",
      }).map(clampGenome);
    }
  }

  // First non-Train read: Internal Selection only. External V/E are still untouched.
  const internalRanked = finalTrainRanked.slice(0, INTERNAL_POOL).map(({ genome, train, score }) => {
    const selection = runPerpBacktest({ genome, data, window: selectionWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    return {
      genome,
      train,
      trainScore: score,
      selection,
      selectionEligible: internalEligible(selection),
      internalScore: internalScore(train, selection),
    };
  }).sort((a, b) => b.internalScore - a.internalScore || b.selection.metrics.cagrPct - a.selection.metrics.cagrPct || a.genome.id.localeCompare(b.genome.id));

  const externalPool = internalRanked.slice(0, EXTERNAL_FINALISTS);

  // External Validation/Evaluation are first touched here, after Train evolution
  // and Internal Selection ranking are fully frozen and complete.
  const finalists = externalPool.map((candidate) => {
    const dev = runPerpBacktest({ genome: candidate.genome, data, window: devWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const val = runPerpBacktest({ genome: candidate.genome, data, window: valWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const evaluation = runPerpBacktest({ genome: candidate.genome, data, window: evalWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const combined = runPerpBacktest({ genome: candidate.genome, data, window: combinedWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const stress = runPerpBacktest({ genome: candidate.genome, data, window: combinedWindow, execution: STRESS, targetMonthlyReturnPct: TARGET_MONTHLY });
    return {
      genome: candidate.genome,
      trainScore: candidate.trainScore,
      internalScore: candidate.internalScore,
      train: summarize(candidate.train),
      internalSelection: summarize(candidate.selection),
      developmentFull: summarize(dev),
      validation: summarize(val),
      evaluation: summarize(evaluation),
      combined3Y: summarize(combined),
      combined3YStress: summarize(stress),
      historicalGate: robustGate({ dev, val, eval: evaluation, combined, stress }),
    };
  }).sort((a, b) =>
    Number(b.historicalGate.historicalCandidatePass) - Number(a.historicalGate.historicalCandidatePass)
    || b.combined3Y.cagrPct - a.combined3Y.cagrPct);

  const out = {
    researchLine: "V28_INTERNAL_SPLIT_EVOLUTION_1X",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    liveEligible: false,
    freshOosRead: false,
    freshOosConsumed: false,
    precommit: "docs/implementation/V28_INTERNAL_SPLIT_EVOLUTION_PRECOMMIT_20260816.md",
    target: { main3YCagrPct: 100, annualFloorPct: 80, grossExposureCapPct: 100, leverageMultiplier: 1.0 },
    methodology: {
      rounds: ROUNDS,
      population: POPULATION,
      elites: ELITES,
      internalPool: INTERNAL_POOL,
      externalFinalists: EXTERNAL_FINALISTS,
      seed: SEED,
      trainData: "2023-07-01 <= t < 2024-03-01",
      internalSelectionData: "2024-03-01 <= t < 2024-07-01",
      validationFirstRead: "after all Train generations and Internal Selection ranking finish",
      evaluationFirstRead: "after all Train generations and Internal Selection ranking finish",
      allGenomesForcedLeverage: 1.0,
      allGenomesForcedUniverse: UNIVERSE,
      symbolSpecificParameters: false,
      yearSpecificParameters: false,
    },
    execution: { normal: NORMAL, stress: STRESS },
    universe: UNIVERSE,
    rounds,
    internalSelection: internalRanked.map((x) => ({
      genomeId: x.genome.id,
      family: x.genome.family,
      trainScore: x.trainScore,
      internalScore: x.internalScore,
      selectionEligible: x.selectionEligible,
      train: summarize(x.train),
      selection: summarize(x.selection),
    })),
    finalists,
    historicalCandidatePass: finalists.some((x) => x.historicalGate.historicalCandidatePass),
  };

  const root = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "internal-split-evolution-v28.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
