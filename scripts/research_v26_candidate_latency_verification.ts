import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import type { PerpBacktestResult, PerpExecutionAssumptions, PerpFundingPoint, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 120 * 24 * HOUR;
const STARTING_EQUITY = 10_000;
const DELAY_HOURS = 1;
const FEE_BPS_PER_SIDE = 10;
const SLIPPAGE_BPS_PER_SIDE = 5;
const TARGET_MONTHLY = 6;

const UNIVERSE = [
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "PENGU",
  "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
];

// Frozen V26 winner. This is copied byte-for-byte from V26 artifact finalist
// bp11-0015. No parameter may be changed by this verification.
const WINNER: PerpStrategyGenome = {
  id: "bp11-0015",
  generation: 11,
  parentIds: ["bp10-0012", "bp10-0007"],
  createdBy: "quant-regime",
  family: "relative_strength",
  thesis: "ボラティリティ調整後の相対強弱で最も優位な銘柄を選ぶ。Profile=balanced、担当=quant-regime",
  symbols: [...UNIVERSE],
  parameters: {
    timeframeHours: 2,
    leverage: 1,
    riskPerTradePct: 3.19,
    maxMarginUsagePct: 100,
    btcRegimeSmaBars: 53,
    btcRegimeMomentumBars: 52,
    regimeThresholdPct: 0.0377,
    momentumBars: 45,
    breakoutBars: 18,
    breakoutBufferPct: 0.0233,
    minimumMomentumPct: 0.0227,
    minimumVolumeRatio: 0.9845,
    minimumEdgeToCostRatio: 6.0879,
    volatilityLookbackBars: 15,
    volatilityPenalty: 2.3953,
    atrBars: 31,
    stopAtr: 2.477,
    takeProfitAtr: 3.1995,
    trailingAtr: 0.4,
    maxHoldBars: 23,
    rebalanceBars: 20,
    cooldownBars: 1,
    allowLong: true,
    allowShort: true,
    allowNeutralRegime: true,
    neutralScoreThreshold: 1.4649,
  },
};

const NORMAL: PerpExecutionAssumptions = {
  feeBpsPerSide: 5,
  slippageBpsPerSide: 0,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};

const ENGINE_STRESS: PerpExecutionAssumptions = {
  feeBpsPerSide: 10,
  slippageBpsPerSide: 5,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};

const EXPECTED = {
  developmentCagrPct: 106.21179473771285,
  validationCagrPct: 178.74576179489767,
  evaluationCagrPct: 110.33410240242264,
  combinedCagrPct: 129.46327604510532,
  combinedPf: 3.121050836553375,
  combinedPfWithoutBest: 3.035121025612018,
  combinedMaxDrawdownPct: 5.643103665753599,
  combinedTrades: 794,
  engineStressCagrPct: 52.202219566335195,
};

function w(label: string, startTs: number, endTs: number) { return { label, startTs, endTs }; }

function assertNear(label: string, actual: number, expected: number, tolerance = 1e-8) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`FROZEN_WINNER_REPRO_FAIL:${label}:actual=${actual}:expected=${expected}`);
  }
}

function pfFromPnls(pnls: number[]) {
  const gp = pnls.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const gl = Math.abs(pnls.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
}

function pfWithoutBest(pnls: number[]) {
  const values = [...pnls];
  if (values.length) values.splice(values.indexOf(Math.max(...values)), 1);
  return pfFromPnls(values);
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

function rawIndex(rows: { ts: number }[]) { return new Map(rows.map((row, index) => [row.ts, index])); }

function delayedReplay(input: {
  original: PerpBacktestResult;
  data: Awaited<ReturnType<typeof loadPerpMarketData>>;
  startTs: number;
  endTs: number;
}) {
  const feeRate = FEE_BPS_PER_SIDE / 10_000;
  const slipRate = SLIPPAGE_BPS_PER_SIDE / 10_000;
  const indexes = Object.fromEntries(Object.entries(input.data.bySymbol).map(([s, rows]) => [s, rawIndex(rows)]));
  let balance = STARTING_EQUITY;
  let peak = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  const replayTrades: Array<Record<string, number | string>> = [];
  const pnls: number[] = [];

  for (const trade of input.original.trades) {
    const rows = input.data.bySymbol[trade.symbol] ?? [];
    const index = indexes[trade.symbol] as Map<number, number> | undefined;
    if (!index) throw new Error(`DELAY_INDEX_MISSING:${trade.symbol}`);

    const entryTs = trade.entryTs + DELAY_HOURS * HOUR;
    const exitTs = trade.exitTs + DELAY_HOURS * HOUR;
    const entryIndex = index.get(entryTs);
    const exitIndex = index.get(exitTs);
    if (entryIndex == null || exitIndex == null) {
      throw new Error(`DELAY_FILL_MISSING:${trade.symbol}:${entryTs}:${exitTs}`);
    }
    const entryRaw = rows[entryIndex]?.open;
    const exitRaw = rows[exitIndex]?.open;
    if (!(entryRaw > 0) || !(exitRaw > 0)) throw new Error(`DELAY_BAD_PRICE:${trade.symbol}`);

    const direction = trade.side === "long" ? 1 : -1;
    const entryPrice = entryRaw * (trade.side === "long" ? 1 + slipRate : 1 - slipRate);
    const exitPrice = exitRaw * (trade.side === "long" ? 1 - slipRate : 1 + slipRate);
    const effectiveLeverage = Math.min(1, trade.effectiveLeverage);
    const notional = balance * effectiveLeverage;
    const quantity = notional / entryPrice;
    const entryFee = notional * feeRate;
    const fundingRate = fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, exitTs);
    const fundingCost = notional * fundingRate * direction;
    const grossPnl = direction * quantity * (exitPrice - entryPrice);
    const exitFee = quantity * exitPrice * feeRate;
    const netPnl = grossPnl - entryFee - exitFee - fundingCost;
    const balanceBefore = balance;

    // Hourly mark-to-market from the delayed entry onward. Current-equity
    // accounting mirrors the Research Lab engine: entry fee and accrued
    // funding are deducted, unrealized PnL is marked, and estimated exit fee
    // is reserved at the current mark.
    for (let i = entryIndex; i <= exitIndex; i += 1) {
      const row = rows[i];
      if (!row || row.ts > exitTs) break;
      const mark = row.close;
      const accruedRate = fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, row.ts);
      const accruedFunding = notional * accruedRate * direction;
      const unrealized = direction * quantity * (mark - entryPrice);
      const estimatedExitFee = quantity * mark * feeRate;
      const equity = Math.max(0, balanceBefore - entryFee - accruedFunding + unrealized - estimatedExitFee);
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 100);
    }

    balance = Math.max(0, balanceBefore + netPnl);
    peak = Math.max(peak, balance);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - balance) / peak) * 100 : 100);
    pnls.push(netPnl);
    replayTrades.push({
      symbol: trade.symbol,
      side: trade.side,
      originalEntryTs: trade.entryTs,
      originalExitTs: trade.exitTs,
      delayedEntryTs: entryTs,
      delayedExitTs: exitTs,
      effectiveLeverage,
      entryPrice,
      exitPrice,
      grossPnl,
      entryFee,
      exitFee,
      fundingCost,
      netPnl,
      balanceBefore,
      balanceAfter: balance,
    });
  }

  const years = (input.endTs - input.startTs) / (365.25 * 24 * HOUR);
  return {
    trades: replayTrades.length,
    endingEquity: balance,
    returnPct: (balance / STARTING_EQUITY - 1) * 100,
    cagrPct: (Math.pow(balance / STARTING_EQUITY, 1 / years) - 1) * 100,
    maxDrawdownPct,
    profitFactor: pfFromPnls(pnls),
    profitFactorWithoutBest: pfWithoutBest(pnls),
    winRatePct: pnls.length ? pnls.filter((x) => x > 0).length / pnls.length * 100 : 0,
    replayTrades,
  };
}

function normalSummary(result: PerpBacktestResult) {
  return {
    cagrPct: result.metrics.cagrPct,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
    profitFactor: result.metrics.profitFactor,
    tradeCount: result.metrics.tradeCount,
    endingEquity: result.risk.endingEquity,
    maximumEffectiveLeverage: result.risk.maximumEffectiveLeverage,
    liquidationCount: result.risk.liquidationCount,
  };
}

async function main() {
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });
  const periods = {
    development: [START, DEV_END],
    validation: [DEV_END, VAL_END],
    evaluation: [VAL_END, END],
  } as const;
  const normals: Record<string, PerpBacktestResult> = {};
  const delayed: Record<string, ReturnType<typeof delayedReplay>> = {};

  for (const [label, [startTs, endTs]] of Object.entries(periods)) {
    const normal = runPerpBacktest({ genome: WINNER, data, window: w(label, startTs, endTs), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    normals[label] = normal;
    delayed[label] = delayedReplay({ original: normal, data, startTs, endTs });
  }
  const combined = runPerpBacktest({ genome: WINNER, data, window: w("combined3y", START, END), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
  const engineStress = runPerpBacktest({ genome: WINNER, data, window: w("combined3y-engine-stress", START, END), execution: ENGINE_STRESS, targetMonthlyReturnPct: TARGET_MONTHLY });
  const delayedCombined = delayedReplay({ original: combined, data, startTs: START, endTs: END });

  // Fail closed if the frozen candidate does not reproduce the V26 artifact.
  assertNear("developmentCagrPct", normals.development.metrics.cagrPct, EXPECTED.developmentCagrPct);
  assertNear("validationCagrPct", normals.validation.metrics.cagrPct, EXPECTED.validationCagrPct);
  assertNear("evaluationCagrPct", normals.evaluation.metrics.cagrPct, EXPECTED.evaluationCagrPct);
  assertNear("combinedCagrPct", combined.metrics.cagrPct, EXPECTED.combinedCagrPct);
  assertNear("combinedPf", combined.metrics.profitFactor, EXPECTED.combinedPf);
  if (combined.metrics.tradeCount !== EXPECTED.combinedTrades) throw new Error(`FROZEN_WINNER_TRADECOUNT_FAIL:${combined.metrics.tradeCount}`);
  assertNear("engineStressCagrPct", engineStress.metrics.cagrPct, EXPECTED.engineStressCagrPct);

  const annualNormal = [normals.development.metrics.cagrPct, normals.validation.metrics.cagrPct, normals.evaluation.metrics.cagrPct];
  const annualDelay = [delayed.development.cagrPct, delayed.validation.cagrPct, delayed.evaluation.cagrPct];
  const sortedNormal = [...annualNormal].sort((a, b) => a - b);
  const checks = {
    everyAnnualNormalAtLeast80: annualNormal.every((x) => x >= 80),
    medianAnnualNormalAtLeast100: (sortedNormal[1] ?? -999) >= 100,
    combinedNormalCagrAtLeast100: combined.metrics.cagrPct >= 100,
    combinedNormalPfAtLeast1p40: combined.metrics.profitFactor >= 1.40,
    combinedNormalDDAtMost40: combined.metrics.maxDrawdownPct <= 40,
    delayedStressCagrAtLeast45: delayedCombined.cagrPct >= 45,
    delayedStressPfAtLeast1p08: delayedCombined.profitFactor >= 1.08,
    delayedStressPfWithoutBestAtLeast1: delayedCombined.profitFactorWithoutBest >= 1,
    delayedStressDDAtMost50: delayedCombined.maxDrawdownPct <= 50,
    atLeastTwoDelayedStressPositiveAnnualPeriods: annualDelay.filter((x) => x > 0).length >= 2,
    worstDelayedStressAnnualPeriodAboveMinus25: Math.min(...annualDelay) > -25,
    oneXMaximum: combined.risk.maximumEffectiveLeverage <= 1.000001,
    zeroLiquidations: combined.risk.liquidationCount === 0,
  };

  const out = {
    researchLine: "V26_WINNER_FROZEN_LATENCY_VERIFICATION",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    freshOosRead: false,
    freshOosConsumed: false,
    sourceV26RunId: 31916776783,
    sourceV26ArtifactId: 9255222752,
    winnerSelectionProvenance: {
      developmentFinalistPoolSelectedBeforeValidation: true,
      developmentFinalistPoolSize: 8,
      winnerValidationCagrRankWithinFinalists: 1,
      validationCagrPct: normals.validation.metrics.cagrPct,
      evaluationReadAfterFinalistPoolWasFrozen: true,
    },
    frozenGenome: WINNER,
    normal: {
      development: normalSummary(normals.development),
      validation: normalSummary(normals.validation),
      evaluation: normalSummary(normals.evaluation),
      combined3Y: normalSummary(combined),
    },
    engineStress30bpsNoExtraLatency: normalSummary(engineStress),
    delayedExecutionStress: {
      delayHours: DELAY_HOURS,
      feeBpsPerSide: FEE_BPS_PER_SIDE,
      slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE,
      totalNominalRoundTripFrictionBps: 2 * (FEE_BPS_PER_SIDE + SLIPPAGE_BPS_PER_SIDE),
      method: "freeze normal signal/exit timestamps, shift every fill +1h, reprice on raw 1H opens, preserve original effective leverage, recompute actual funding and hourly MTM DD",
      development: { ...delayed.development, replayTrades: undefined },
      validation: { ...delayed.validation, replayTrades: undefined },
      evaluation: { ...delayed.evaluation, replayTrades: undefined },
      combined3Y: { ...delayedCombined, replayTrades: undefined },
    },
    verificationChecks: checks,
    historicalTargetVerifiedWithOneHourDelay: Object.values(checks).every(Boolean),
  };

  const root = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "v26-winner-latency-verification.json"), JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile(path.join(root, "v26-winner-latency-trades.jsonl"), delayedCombined.replayTrades.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
