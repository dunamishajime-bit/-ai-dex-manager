import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { createInitialPerpPopulation, createNextPerpPopulation } from "../lib/research-lab/perp/evolution";
import type {
  PerpBacktestResult,
  PerpExecutionAssumptions,
  PerpFundingPoint,
  PerpMarketData,
  PerpStrategyGenome,
} from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const TRAIN_END = Date.UTC(2024, 2, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 120 * 24 * HOUR;
const STARTING_EQUITY = 10_000;

const UNIVERSE = [
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "PENGU",
  "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
];

const ROUNDS = 16;
const POPULATION = 20;
const ELITES = 5;
const INTERNAL_POOL = 12;
const EXTERNAL_FINALISTS = 5;
const SEED = 290816;
const TARGET_MONTHLY = 6;

const DELAY_HOURS = 1;
const DELAY_FEE_BPS_PER_SIDE = 10;
const DELAY_SLIPPAGE_BPS_PER_SIDE = 5;

const NORMAL: PerpExecutionAssumptions = {
  feeBpsPerSide: 5,
  slippageBpsPerSide: 0,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};

function clampGenome(genome: PerpStrategyGenome): PerpStrategyGenome {
  return {
    ...genome,
    symbols: [...UNIVERSE],
    parameters: { ...genome.parameters, leverage: 1.0, maxMarginUsagePct: 100 },
  };
}

function w(label: string, startTs: number, endTs: number) { return { label, startTs, endTs }; }

function pfFromPnls(pnls: number[]) {
  const gp = pnls.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const gl = Math.abs(pnls.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
}

function pfWithoutBestPnls(pnls: number[]) {
  const values = [...pnls];
  if (values.length) values.splice(values.indexOf(Math.max(...values)), 1);
  return pfFromPnls(values);
}

function pfWithoutBest(result: PerpBacktestResult) {
  return pfWithoutBestPnls(result.trades.map((t) => t.netPnl));
}

function firstFundingIndexAfter(points: PerpFundingPoint[], ts: number) {
  let low = 0, high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((points[middle]?.ts ?? Number.POSITIVE_INFINITY) <= ts) low = middle + 1;
    else high = middle;
  }
  return low;
}

function fundingRateBetween(points: PerpFundingPoint[], fromExclusive: number, toInclusive: number) {
  let index = firstFundingIndexAfter(points, fromExclusive);
  let total = 0;
  while (index < points.length) {
    const point = points[index];
    if (!point || point.ts > toInclusive) break;
    total += point.rate;
    index += 1;
  }
  return total;
}

type RawIndexes = Record<string, Map<number, number>>;
type DelaySummary = {
  valid: boolean;
  trades: number;
  endingEquity: number;
  returnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  profitFactorWithoutBest: number;
  winRatePct: number;
};

function buildIndexes(data: PerpMarketData): RawIndexes {
  return Object.fromEntries(Object.entries(data.bySymbol).map(([symbol, rows]) => [symbol, new Map(rows.map((row, i) => [row.ts, i]))]));
}

function invalidDelay(): DelaySummary {
  return {
    valid: false, trades: 0, endingEquity: 0, returnPct: -100, cagrPct: -100,
    maxDrawdownPct: 100, profitFactor: 0, profitFactorWithoutBest: 0, winRatePct: 0,
  };
}

function delayedReplay(input: {
  original: PerpBacktestResult;
  data: PerpMarketData;
  indexes: RawIndexes;
  startTs: number;
  endTs: number;
}): DelaySummary {
  const feeRate = DELAY_FEE_BPS_PER_SIDE / 10_000;
  const slipRate = DELAY_SLIPPAGE_BPS_PER_SIDE / 10_000;
  let balance = STARTING_EQUITY;
  let peak = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  const pnls: number[] = [];

  for (const trade of input.original.trades) {
    const rows = input.data.bySymbol[trade.symbol] ?? [];
    const index = input.indexes[trade.symbol];
    if (!index) return invalidDelay();
    const entryTs = trade.entryTs + DELAY_HOURS * HOUR;
    const exitTs = trade.exitTs + DELAY_HOURS * HOUR;
    const entryIndex = index.get(entryTs);
    const exitIndex = index.get(exitTs);
    if (entryIndex == null || exitIndex == null || exitIndex < entryIndex) return invalidDelay();
    const entryRaw = rows[entryIndex]?.open;
    const exitRaw = rows[exitIndex]?.open;
    if (!(entryRaw > 0) || !(exitRaw > 0)) return invalidDelay();

    const direction = trade.side === "long" ? 1 : -1;
    const entryPrice = entryRaw * (trade.side === "long" ? 1 + slipRate : 1 - slipRate);
    const exitPrice = exitRaw * (trade.side === "long" ? 1 - slipRate : 1 + slipRate);
    const effectiveLeverage = Math.min(1, trade.effectiveLeverage);
    const notional = balance * effectiveLeverage;
    if (!(notional > 0)) return invalidDelay();
    const quantity = notional / entryPrice;
    const entryFee = notional * feeRate;
    const fundingPoints = input.data.fundingBySymbol[trade.symbol] ?? [];
    const totalFundingRate = fundingRateBetween(fundingPoints, entryTs, exitTs);
    const fundingCost = notional * totalFundingRate * direction;
    const grossPnl = direction * quantity * (exitPrice - entryPrice);
    const exitFee = quantity * exitPrice * feeRate;
    const netPnl = grossPnl - entryFee - exitFee - fundingCost;
    const balanceBefore = balance;

    for (let i = entryIndex; i <= exitIndex; i += 1) {
      const row = rows[i];
      if (!row || row.ts > exitTs) break;
      const accruedRate = fundingRateBetween(fundingPoints, entryTs, row.ts);
      const accruedFunding = notional * accruedRate * direction;
      const unrealized = direction * quantity * (row.close - entryPrice);
      const estimatedExitFee = quantity * row.close * feeRate;
      const equity = Math.max(0, balanceBefore - entryFee - accruedFunding + unrealized - estimatedExitFee);
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 100);
    }

    balance = Math.max(0, balanceBefore + netPnl);
    peak = Math.max(peak, balance);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - balance) / peak) * 100 : 100);
    pnls.push(netPnl);
    if (balance <= 0) return invalidDelay();
  }

  const years = (input.endTs - input.startTs) / (365.25 * 24 * HOUR);
  return {
    valid: true,
    trades: pnls.length,
    endingEquity: balance,
    returnPct: (balance / STARTING_EQUITY - 1) * 100,
    cagrPct: (Math.pow(balance / STARTING_EQUITY, 1 / years) - 1) * 100,
    maxDrawdownPct,
    profitFactor: pfFromPnls(pnls),
    profitFactorWithoutBest: pfWithoutBestPnls(pnls),
    winRatePct: pnls.length ? pnls.filter((x) => x > 0).length / pnls.length * 100 : 0,
  };
}

function normalSummary(result: PerpBacktestResult) {
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
    liquidationCount: result.risk.liquidationCount,
    longTrades: result.risk.longTrades,
    shortTrades: result.risk.shortTrades,
  };
}

function trainEligibility(normal: PerpBacktestResult, delay: DelaySummary) {
  return normal.metrics.tradeCount >= 16
    && normal.metrics.maxDrawdownPct <= 35
    && normal.metrics.profitFactor >= 1.15
    && normal.risk.liquidationCount === 0
    && normal.risk.maximumEffectiveLeverage <= 1.000001
    && delay.valid
    && delay.cagrPct > 0
    && delay.profitFactor >= 1.05
    && delay.profitFactorWithoutBest >= 0.95
    && delay.maxDrawdownPct <= 35;
}

function trainScore(normal: PerpBacktestResult, delay: DelaySummary) {
  if (!trainEligibility(normal, delay)) return -1_000_000 + Math.min(normal.metrics.cagrPct, delay.cagrPct);
  const floorCagr = Math.min(normal.metrics.cagrPct, delay.cagrPct);
  const floorPf = Math.min(normal.metrics.profitFactor, delay.profitFactor);
  const worstDd = Math.max(normal.metrics.maxDrawdownPct, delay.maxDrawdownPct);
  return floorCagr + 5 * Math.min(3, floorPf - 1) + 2 * Math.min(4, normal.metrics.sharpe) - 0.5 * worstDd;
}

function selectionEligibility(normal: PerpBacktestResult, delay: DelaySummary) {
  return normal.metrics.tradeCount >= 8
    && normal.metrics.maxDrawdownPct <= 30
    && normal.metrics.profitFactor >= 1.10
    && normal.risk.liquidationCount === 0
    && normal.risk.maximumEffectiveLeverage <= 1.000001
    && delay.valid
    && delay.cagrPct > 0
    && delay.profitFactor >= 1.05
    && delay.profitFactorWithoutBest >= 0.95
    && delay.maxDrawdownPct <= 35;
}

function internalScore(input: {
  trainNormal: PerpBacktestResult;
  trainDelay: DelaySummary;
  selectionNormal: PerpBacktestResult;
  selectionDelay: DelaySummary;
}) {
  if (!selectionEligibility(input.selectionNormal, input.selectionDelay)) {
    return -1_000_000 + Math.min(input.trainDelay.cagrPct, input.selectionDelay.cagrPct);
  }
  const floorCagr = Math.min(
    input.trainNormal.metrics.cagrPct,
    input.trainDelay.cagrPct,
    input.selectionNormal.metrics.cagrPct,
    input.selectionDelay.cagrPct,
  );
  const floorPf = Math.min(
    input.trainNormal.metrics.profitFactor,
    input.trainDelay.profitFactor,
    input.selectionNormal.metrics.profitFactor,
    input.selectionDelay.profitFactor,
  );
  const worstDd = Math.max(
    input.trainNormal.metrics.maxDrawdownPct,
    input.trainDelay.maxDrawdownPct,
    input.selectionNormal.metrics.maxDrawdownPct,
    input.selectionDelay.maxDrawdownPct,
  );
  return floorCagr + 6 * Math.min(3, floorPf - 1) - 0.4 * worstDd;
}

function finalGate(input: {
  dev: PerpBacktestResult;
  val: PerpBacktestResult;
  evaluation: PerpBacktestResult;
  combined: PerpBacktestResult;
  delayedDev: DelaySummary;
  delayedVal: DelaySummary;
  delayedEval: DelaySummary;
  delayedCombined: DelaySummary;
}) {
  const normalAnnual = [input.dev.metrics.cagrPct, input.val.metrics.cagrPct, input.evaluation.metrics.cagrPct];
  const delayedAnnual = [input.delayedDev.cagrPct, input.delayedVal.cagrPct, input.delayedEval.cagrPct];
  const normalSorted = [...normalAnnual].sort((a, b) => a - b);
  const checks = {
    everyAnnualNormalAtLeast80: normalAnnual.every((x) => x >= 80),
    medianAnnualNormalAtLeast100: (normalSorted[1] ?? -999) >= 100,
    combinedNormalCagrAtLeast100: input.combined.metrics.cagrPct >= 100,
    combinedNormalPfAtLeast1p40: input.combined.metrics.profitFactor >= 1.40,
    combinedNormalPfWithoutBestAtLeast1p25: pfWithoutBest(input.combined) >= 1.25,
    combinedNormalDDAtMost40: input.combined.metrics.maxDrawdownPct <= 40,
    tradesAtLeast24: input.combined.metrics.tradeCount >= 24,
    oneXMaximum: input.combined.risk.maximumEffectiveLeverage <= 1.000001,
    zeroLiquidations: input.combined.risk.liquidationCount === 0,
    delayedStressCagrAtLeast45: input.delayedCombined.cagrPct >= 45,
    delayedStressPfAtLeast1p08: input.delayedCombined.profitFactor >= 1.08,
    delayedStressPfWithoutBestAtLeast1: input.delayedCombined.profitFactorWithoutBest >= 1,
    delayedStressDDAtMost50: input.delayedCombined.maxDrawdownPct <= 50,
    atLeastTwoDelayedPositiveAnnualPeriods: delayedAnnual.filter((x) => x > 0).length >= 2,
    worstDelayedAnnualPeriodAboveMinus25: Math.min(...delayedAnnual) > -25,
  };
  return { checks, historicalCandidatePass: Object.values(checks).every(Boolean) };
}

async function main() {
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });
  const indexes = buildIndexes(data);
  const trainWindow = w("train", START, TRAIN_END);
  const selectionWindow = w("internal-selection", TRAIN_END, DEV_END);
  const devWindow = w("development-full", START, DEV_END);
  const valWindow = w("external-validation", DEV_END, VAL_END);
  const evalWindow = w("external-evaluation", VAL_END, END);
  const combinedWindow = w("combined3y", START, END);

  let population = createInitialPerpPopulation(POPULATION, SEED, "balanced").map(clampGenome);
  const rounds: Array<Record<string, unknown>> = [];
  let finalTrainRanked: Array<{
    genome: PerpStrategyGenome;
    normal: PerpBacktestResult;
    delay: DelaySummary;
    score: number;
  }> = [];

  for (let generation = 0; generation < ROUNDS; generation += 1) {
    const ranked = population.map((genome) => {
      const normal = runPerpBacktest({ genome, data, window: trainWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
      const delay = delayedReplay({ original: normal, data, indexes, startTs: START, endTs: TRAIN_END });
      return { genome, normal, delay, score: trainScore(normal, delay) };
    }).sort((a, b) => b.score - a.score || b.delay.cagrPct - a.delay.cagrPct || a.genome.id.localeCompare(b.genome.id));

    finalTrainRanked = ranked;
    rounds.push({
      generation,
      bestId: ranked[0]?.genome.id ?? null,
      bestScore: ranked[0]?.score ?? null,
      bestNormalCagrPct: ranked[0]?.normal.metrics.cagrPct ?? null,
      bestDelayedCagrPct: ranked[0]?.delay.cagrPct ?? null,
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

  const internalRanked = finalTrainRanked.slice(0, INTERNAL_POOL).map((candidate) => {
    const selectionNormal = runPerpBacktest({ genome: candidate.genome, data, window: selectionWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const selectionDelay = delayedReplay({ original: selectionNormal, data, indexes, startTs: TRAIN_END, endTs: DEV_END });
    const score = internalScore({
      trainNormal: candidate.normal,
      trainDelay: candidate.delay,
      selectionNormal,
      selectionDelay,
    });
    return { ...candidate, selectionNormal, selectionDelay, internalScore: score };
  }).sort((a, b) => b.internalScore - a.internalScore || b.selectionDelay.cagrPct - a.selectionDelay.cagrPct || a.genome.id.localeCompare(b.genome.id));

  const externalPool = internalRanked.slice(0, EXTERNAL_FINALISTS);

  // External V/E are first evaluated here, after latency-aware Train evolution
  // and Internal Selection ranking are complete and frozen.
  const finalists = externalPool.map((candidate) => {
    const dev = runPerpBacktest({ genome: candidate.genome, data, window: devWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const val = runPerpBacktest({ genome: candidate.genome, data, window: valWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const evaluation = runPerpBacktest({ genome: candidate.genome, data, window: evalWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const combined = runPerpBacktest({ genome: candidate.genome, data, window: combinedWindow, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    const delayedDev = delayedReplay({ original: dev, data, indexes, startTs: START, endTs: DEV_END });
    const delayedVal = delayedReplay({ original: val, data, indexes, startTs: DEV_END, endTs: VAL_END });
    const delayedEval = delayedReplay({ original: evaluation, data, indexes, startTs: VAL_END, endTs: END });
    const delayedCombined = delayedReplay({ original: combined, data, indexes, startTs: START, endTs: END });
    return {
      genome: candidate.genome,
      trainScore: candidate.score,
      internalScore: candidate.internalScore,
      trainNormal: normalSummary(candidate.normal),
      trainDelayed: candidate.delay,
      internalNormal: normalSummary(candidate.selectionNormal),
      internalDelayed: candidate.selectionDelay,
      development: normalSummary(dev),
      validation: normalSummary(val),
      evaluation: normalSummary(evaluation),
      combined3Y: normalSummary(combined),
      delayedDevelopment: delayedDev,
      delayedValidation: delayedVal,
      delayedEvaluation: delayedEval,
      delayedCombined3Y: delayedCombined,
      historicalGate: finalGate({ dev, val, evaluation, combined, delayedDev, delayedVal, delayedEval, delayedCombined }),
    };
  }).sort((a, b) =>
    Number(b.historicalGate.historicalCandidatePass) - Number(a.historicalGate.historicalCandidatePass)
    || b.delayedCombined3Y.cagrPct - a.delayedCombined3Y.cagrPct
    || b.combined3Y.cagrPct - a.combined3Y.cagrPct);

  const out = {
    researchLine: "V29_LATENCY_AWARE_INTERNAL_SPLIT_EVOLUTION_1X",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    liveEligible: false,
    freshOosRead: false,
    freshOosConsumed: false,
    precommit: "docs/implementation/V29_LATENCY_AWARE_INTERNAL_SPLIT_PRECOMMIT_20260816.md",
    target: { main3YCagrPct: 100, annualFloorPct: 80, grossExposureCapPct: 100, leverageMultiplier: 1.0 },
    latencyStress: {
      delayHours: DELAY_HOURS,
      feeBpsPerSide: DELAY_FEE_BPS_PER_SIDE,
      slippageBpsPerSide: DELAY_SLIPPAGE_BPS_PER_SIDE,
      totalNominalRoundTripFrictionBps: 2 * (DELAY_FEE_BPS_PER_SIDE + DELAY_SLIPPAGE_BPS_PER_SIDE),
      pathPolicy: "normal decision path frozen; every fill shifted +1H and repriced on raw 1H open",
    },
    methodology: {
      rounds: ROUNDS,
      population: POPULATION,
      elites: ELITES,
      internalPool: INTERNAL_POOL,
      externalFinalists: EXTERNAL_FINALISTS,
      seed: SEED,
      trainData: "2023-07-01 <= t < 2024-03-01",
      internalSelectionData: "2024-03-01 <= t < 2024-07-01",
      validationFirstRead: "after latency-aware Train evolution and Internal Selection ranking finish",
      evaluationFirstRead: "after latency-aware Train evolution and Internal Selection ranking finish",
      allGenomesForcedLeverage: 1.0,
      allGenomesForcedUniverse: UNIVERSE,
      symbolSpecificParameters: false,
      yearSpecificParameters: false,
    },
    universe: UNIVERSE,
    rounds,
    internalSelection: internalRanked.map((x) => ({
      genomeId: x.genome.id,
      family: x.genome.family,
      trainScore: x.score,
      internalScore: x.internalScore,
      trainNormal: normalSummary(x.normal),
      trainDelayed: x.delay,
      selectionNormal: normalSummary(x.selectionNormal),
      selectionDelayed: x.selectionDelay,
    })),
    finalists,
    historicalCandidatePass: finalists.some((x) => x.historicalGate.historicalCandidatePass),
  };

  const root = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "latency-aware-internal-split-v29.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
