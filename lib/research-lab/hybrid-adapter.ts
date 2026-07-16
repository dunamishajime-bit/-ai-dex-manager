import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";
import type { BacktestResult, PeriodReturnRow } from "@/lib/backtest/types";

import type { ResearchLabConfig, ResearchMetrics, StrategyBacktestAdapter, StrategyGenome } from "./types";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], center = mean(values)) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function compoundReturnPct(rows: PeriodReturnRow[]) {
  const multiplier = rows.reduce((value, row) => value * (1 + row.return_pct / 100), 1);
  return (multiplier - 1) * 100;
}

function calculateSharpe(monthlyReturnsPct: number[]) {
  const avg = mean(monthlyReturnsPct);
  const deviation = standardDeviation(monthlyReturnsPct, avg);
  if (deviation <= 0) return avg > 0 ? 10 : 0;
  return (avg / deviation) * Math.sqrt(12);
}

function calculateSortino(monthlyReturnsPct: number[]) {
  const avg = mean(monthlyReturnsPct);
  const downside = monthlyReturnsPct.filter((value) => value < 0);
  const downsideDeviation = Math.sqrt(mean(downside.map((value) => value ** 2)));
  if (downsideDeviation <= 0) return avg > 0 ? 10 : 0;
  return (avg / downsideDeviation) * Math.sqrt(12);
}

function calculateTemporalStability(result: BacktestResult) {
  const monthly = result.monthly_returns.map((row) => row.return_pct);
  const annual = result.annual_returns.map((row) => row.return_pct);
  const positiveMonthRatio = monthly.length ? monthly.filter((value) => value > 0).length / monthly.length : 0;
  const positiveYearRatio = annual.length ? annual.filter((value) => value > 0).length / annual.length : 0;
  const annualAverage = Math.abs(mean(annual));
  const dispersion = annualAverage > 0 ? standardDeviation(annual) / annualAverage : 2;
  const dispersionScore = clamp01(1 - dispersion / 2.5);
  return clamp01(positiveMonthRatio * 0.45 + positiveYearRatio * 0.35 + dispersionScore * 0.2);
}

function calculateRecentPeriodScore(result: BacktestResult) {
  const recentRows = result.monthly_returns.slice(-12);
  if (!recentRows.length) return 0;
  const recentReturn = compoundReturnPct(recentRows);
  const benchmark = Math.max(12, Math.abs(result.summary.cagr_pct));
  return clamp01(0.5 + recentReturn / (benchmark * 2));
}

function metricsFromResult(result: BacktestResult): ResearchMetrics {
  const monthlyReturns = result.monthly_returns.map((row) => row.return_pct);
  const positiveMonthPct = monthlyReturns.length
    ? (monthlyReturns.filter((value) => value > 0).length / monthlyReturns.length) * 100
    : 0;

  return {
    cagrPct: result.summary.cagr_pct,
    maxDrawdownPct: Math.abs(result.summary.max_drawdown_pct),
    sharpe: calculateSharpe(monthlyReturns),
    sortino: calculateSortino(monthlyReturns),
    profitFactor: result.summary.profit_factor,
    winRatePct: result.summary.win_rate_pct,
    tradeCount: result.summary.trade_count,
    exposurePct: result.summary.exposure_pct,
    positiveMonthPct,
    worstMonthPct: monthlyReturns.length ? Math.min(...monthlyReturns) : 0,
    temporalStabilityScore: calculateTemporalStability(result),
    recentPeriodScore: calculateRecentPeriodScore(result),
  };
}

function optionsFromGenome(genome: StrategyGenome, config: ResearchLabConfig): HybridVariantOptions {
  const parameters = genome.parameters;
  const trendOnly = genome.family === "trend" || genome.family === "breakout" || genome.family === "momentum_rotation";
  const rangeOnly = genome.family === "range" || genome.family === "mean_reversion";
  const rangeSymbols = genome.markets.filter((symbol) => ["ETH", "SOL", "AVAX"].includes(symbol));

  return {
    label: `research-lab:${genome.id}`,
    backtestStartTs: config.startTs,
    backtestEndTs: config.endTs,
    disableTrend: rangeOnly,
    forceRangeOnly: rangeOnly,
    rangeSymbols: (trendOnly ? [] : rangeSymbols.length ? rangeSymbols : ["ETH", "SOL"]) as HybridVariantOptions["rangeSymbols"],
    expandedTrendSymbols: genome.markets,
    trendDecisionTimeframe: parameters.trendDecisionTimeframe,
    trendExitCheckTimeframe: parameters.trendExitCheckTimeframe,
    trendAlloc: parameters.trendAlloc,
    rangeAlloc: parameters.rangeAlloc,
    rangeEntryMode: parameters.rangeEntryMode,
    trendExitSma: parameters.trendExitSma,
    trendBreakoutLookbackBars: parameters.trendBreakoutLookbackBars,
    trendBreakoutMinPct: parameters.trendBreakoutMinPct,
    trendMinVolumeRatio: parameters.trendMinVolumeRatio,
    trendMinMomAccel: parameters.trendMinMomAccel,
    trendMinEfficiencyRatio: parameters.trendMinEfficiencyRatio,
    trendProfitTrailActivationPct: parameters.trendProfitTrailActivationPct,
    trendProfitTrailRetracePct: parameters.trendProfitTrailRetracePct,
    rangeEntryBestMom20Below: parameters.rangeEntryBestMom20Below,
    rangeEntryBtcAdxBelow: parameters.rangeEntryBtcAdxBelow,
    rangeOverheatMax: parameters.rangeOverheatMax,
    rangeExitMom20Above: parameters.rangeExitMom20Above,
    rangeMaxHoldBars: parameters.rangeMaxHoldBars,
    trendRotationWhileHolding: parameters.trendRotationWhileHolding,
    trendRotationScoreGap: parameters.trendRotationScoreGap,
    trendRotationRequireConsecutiveBars: parameters.trendRotationRequireConsecutiveBars,
  };
}

export class HybridBacktestResearchAdapter implements StrategyBacktestAdapter {
  async evaluate(genome: StrategyGenome, config: ResearchLabConfig) {
    const result = await runHybridBacktest("RETQ22", optionsFromGenome(genome, config));
    return {
      metrics: metricsFromResult(result),
      validationLevel: "single_pass" as const,
    };
  }
}
