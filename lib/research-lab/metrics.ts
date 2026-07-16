import type { BacktestResult, PeriodReturnRow } from "@/lib/backtest/types";

import type { ResearchMetrics } from "./types";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function standardDeviation(values: number[], center = mean(values)) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function compoundReturnPct(values: number[]) {
  const multiplier = values.reduce((value, monthlyReturn) => value * Math.max(0.000001, 1 + monthlyReturn / 100), 1);
  return (multiplier - 1) * 100;
}

function annualizedReturnPct(monthlyReturnsPct: number[]) {
  if (!monthlyReturnsPct.length) return 0;
  const multiplier = monthlyReturnsPct.reduce(
    (value, monthlyReturn) => value * Math.max(0.000001, 1 + monthlyReturn / 100),
    1,
  );
  return (Math.pow(multiplier, 12 / monthlyReturnsPct.length) - 1) * 100;
}

function calculateMaxDrawdownPct(monthlyReturnsPct: number[]) {
  let equity = 1;
  let highWaterMark = 1;
  let maxDrawdown = 0;
  for (const monthlyReturn of monthlyReturnsPct) {
    equity *= Math.max(0.000001, 1 + monthlyReturn / 100);
    highWaterMark = Math.max(highWaterMark, equity);
    maxDrawdown = Math.max(maxDrawdown, (highWaterMark - equity) / highWaterMark);
  }
  return maxDrawdown * 100;
}

function calculateSharpe(monthlyReturnsPct: number[]) {
  const average = mean(monthlyReturnsPct);
  const deviation = standardDeviation(monthlyReturnsPct, average);
  if (deviation <= 0) return average > 0 ? 10 : 0;
  return (average / deviation) * Math.sqrt(12);
}

function calculateSortino(monthlyReturnsPct: number[]) {
  const average = mean(monthlyReturnsPct);
  const downside = monthlyReturnsPct.filter((value) => value < 0);
  const downsideDeviation = Math.sqrt(mean(downside.map((value) => value ** 2)));
  if (downsideDeviation <= 0) return average > 0 ? 10 : 0;
  return (average / downsideDeviation) * Math.sqrt(12);
}

function calculateTargetHitRate(monthlyReturnsPct: number[], targetMonthlyReturnPct: number) {
  if (!monthlyReturnsPct.length) return 0;
  return (monthlyReturnsPct.filter((value) => value >= targetMonthlyReturnPct).length / monthlyReturnsPct.length) * 100;
}

function calculateRolling3MonthTargetHitRate(monthlyReturnsPct: number[], targetMonthlyReturnPct: number) {
  if (monthlyReturnsPct.length < 3) return 0;
  let hits = 0;
  let samples = 0;
  for (let index = 2; index < monthlyReturnsPct.length; index += 1) {
    const values = monthlyReturnsPct.slice(index - 2, index + 1);
    const multiplier = values.reduce((value, monthlyReturn) => value * Math.max(0.000001, 1 + monthlyReturn / 100), 1);
    const monthlyEquivalent = (Math.pow(multiplier, 1 / 3) - 1) * 100;
    if (monthlyEquivalent >= targetMonthlyReturnPct) hits += 1;
    samples += 1;
  }
  return samples ? (hits / samples) * 100 : 0;
}

function calculateTemporalStability(monthlyReturnsPct: number[], annualReturnsPct: number[]) {
  const positiveMonthRatio = monthlyReturnsPct.length
    ? monthlyReturnsPct.filter((value) => value > 0).length / monthlyReturnsPct.length
    : 0;
  const positiveYearRatio = annualReturnsPct.length
    ? annualReturnsPct.filter((value) => value > 0).length / annualReturnsPct.length
    : positiveMonthRatio;
  const annualAverage = Math.abs(mean(annualReturnsPct));
  const dispersion = annualReturnsPct.length > 1 && annualAverage > 0
    ? standardDeviation(annualReturnsPct) / annualAverage
    : standardDeviation(monthlyReturnsPct) / Math.max(1, Math.abs(mean(monthlyReturnsPct)));
  const dispersionScore = clamp01(1 - dispersion / 2.5);
  return clamp01(positiveMonthRatio * 0.45 + positiveYearRatio * 0.35 + dispersionScore * 0.2);
}

function calculateRecentPeriodScore(monthlyReturnsPct: number[], cagrPct: number) {
  const recent = monthlyReturnsPct.slice(-12);
  if (!recent.length) return 0;
  const recentReturn = compoundReturnPct(recent);
  const benchmark = Math.max(12, Math.abs(cagrPct));
  return clamp01(0.5 + recentReturn / (benchmark * 2));
}

export function researchMetricsFromSeries(input: {
  monthlyReturnsPct: number[];
  annualReturnsPct?: number[];
  targetMonthlyReturnPct: number;
  profitFactor: number;
  winRatePct: number;
  tradeCount: number;
  exposurePct: number;
  cagrPct?: number;
  maxDrawdownPct?: number;
}): ResearchMetrics {
  const monthlyReturns = input.monthlyReturnsPct;
  const annualReturns = input.annualReturnsPct ?? [];
  const cagrPct = input.cagrPct ?? annualizedReturnPct(monthlyReturns);
  return {
    cagrPct,
    maxDrawdownPct: input.maxDrawdownPct ?? calculateMaxDrawdownPct(monthlyReturns),
    sharpe: calculateSharpe(monthlyReturns),
    sortino: calculateSortino(monthlyReturns),
    profitFactor: input.profitFactor,
    winRatePct: input.winRatePct,
    tradeCount: input.tradeCount,
    exposurePct: input.exposurePct,
    averageMonthlyReturnPct: mean(monthlyReturns),
    medianMonthlyReturnPct: median(monthlyReturns),
    positiveMonthPct: monthlyReturns.length
      ? (monthlyReturns.filter((value) => value > 0).length / monthlyReturns.length) * 100
      : 0,
    targetMonthlyHitRatePct: calculateTargetHitRate(monthlyReturns, input.targetMonthlyReturnPct),
    rolling3MonthTargetHitRatePct: calculateRolling3MonthTargetHitRate(monthlyReturns, input.targetMonthlyReturnPct),
    bestMonthPct: monthlyReturns.length ? Math.max(...monthlyReturns) : 0,
    worstMonthPct: monthlyReturns.length ? Math.min(...monthlyReturns) : 0,
    temporalStabilityScore: calculateTemporalStability(monthlyReturns, annualReturns),
    recentPeriodScore: calculateRecentPeriodScore(monthlyReturns, cagrPct),
  };
}

export function metricsFromBacktestResult(result: BacktestResult, targetMonthlyReturnPct: number) {
  return researchMetricsFromSeries({
    monthlyReturnsPct: result.monthly_returns.map((row) => row.return_pct),
    annualReturnsPct: result.annual_returns.map((row) => row.return_pct),
    targetMonthlyReturnPct,
    profitFactor: result.summary.profit_factor,
    winRatePct: result.summary.win_rate_pct,
    tradeCount: result.summary.trade_count,
    exposurePct: result.summary.exposure_pct,
    cagrPct: result.summary.cagr_pct,
    maxDrawdownPct: Math.abs(result.summary.max_drawdown_pct),
  });
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function tradeCountByExitMonth(result: BacktestResult) {
  const counts = new Map<string, number>();
  for (const trade of result.trade_pairs) {
    const key = monthKey(trade.exit_time);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function buildExecutionStressMetrics(
  result: BacktestResult,
  targetMonthlyReturnPct: number,
  extraRoundTripCostBps: number,
) {
  const exits = tradeCountByExitMonth(result);
  const stressedRows: PeriodReturnRow[] = result.monthly_returns.map((row) => ({
    ...row,
    return_pct: row.return_pct - (exits.get(row.period) ?? 0) * (extraRoundTripCostBps / 100),
  }));
  const stressedMonthly = stressedRows.map((row) => row.return_pct);
  const stressedCagr = annualizedReturnPct(stressedMonthly);
  const baseCagr = result.summary.cagr_pct;
  const retention = baseCagr > 0 ? clamp01(stressedCagr / baseCagr) : 0;
  const stressedProfitFactor = Math.max(0, 1 + (result.summary.profit_factor - 1) * retention);

  return researchMetricsFromSeries({
    monthlyReturnsPct: stressedMonthly,
    targetMonthlyReturnPct,
    profitFactor: stressedProfitFactor,
    winRatePct: result.summary.win_rate_pct,
    tradeCount: result.summary.trade_count,
    exposurePct: result.summary.exposure_pct,
    cagrPct: stressedCagr,
    maxDrawdownPct: calculateMaxDrawdownPct(stressedMonthly),
  });
}
