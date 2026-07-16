import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";
import type { BacktestResult } from "@/lib/backtest/types";

import { buildExecutionStressMetrics, metricsFromBacktestResult } from "./metrics";
import type {
  ResearchCacheStats,
  ResearchLabConfig,
  StrategyBacktestAdapter,
  StrategyGenome,
  StrategyValidationReport,
  TemporalWindow,
  ValidationSegmentResult,
} from "./types";
import {
  buildTemporalValidationPlan,
  completeValidationReport,
  stressGateReasons,
  walkForwardGateReasons,
} from "./validation";

function optionsFromGenome(genome: StrategyGenome, activeWindow: TemporalWindow): HybridVariantOptions {
  const parameters = genome.parameters;
  const trendOnly = genome.family === "trend" || genome.family === "breakout" || genome.family === "momentum_rotation";
  const rangeOnly = genome.family === "range" || genome.family === "mean_reversion";
  const rangeSymbols = genome.markets.filter((symbol) => ["ETH", "SOL", "AVAX"].includes(symbol));

  return {
    label: `research-lab:${genome.id}:${activeWindow.label}`,
    backtestStartTs: activeWindow.startTs,
    backtestEndTs: activeWindow.endTs,
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

function stableGenomeKey(genome: StrategyGenome, activeWindow: TemporalWindow) {
  return JSON.stringify({
    family: genome.family,
    markets: [...genome.markets].sort(),
    parameters: genome.parameters,
    startTs: activeWindow.startTs,
    endTs: activeWindow.endTs,
  });
}

function segment(
  label: string,
  activeWindow: TemporalWindow,
  result: BacktestResult,
  targetMonthlyReturnPct: number,
): ValidationSegmentResult {
  return {
    label,
    window: activeWindow,
    metrics: metricsFromBacktestResult(result, targetMonthlyReturnPct),
  };
}

export class HybridBacktestResearchAdapter implements StrategyBacktestAdapter {
  private readonly resultCache = new Map<string, Promise<BacktestResult>>();
  private hits = 0;
  private misses = 0;

  private runCached(genome: StrategyGenome, activeWindow: TemporalWindow) {
    const key = stableGenomeKey(genome, activeWindow);
    const cached = this.resultCache.get(key);
    if (cached) {
      this.hits += 1;
      return cached;
    }

    this.misses += 1;
    const running = runHybridBacktest("RETQ22", optionsFromGenome(genome, activeWindow));
    this.resultCache.set(key, running);
    running.catch(() => this.resultCache.delete(key));
    return running;
  }

  getCacheStats(): ResearchCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.resultCache.size,
    };
  }

  async evaluate(genome: StrategyGenome, config: ResearchLabConfig) {
    const plan = buildTemporalValidationPlan(config);
    const result = await this.runCached(genome, plan.train);
    return {
      metrics: metricsFromBacktestResult(result, config.thresholds.targetAverageMonthlyReturnPct),
      validationLevel: "single_pass" as const,
    };
  }

  async validate(
    genome: StrategyGenome,
    config: ResearchLabConfig,
  ): Promise<StrategyValidationReport> {
    const plan = buildTemporalValidationPlan(config);
    const target = config.thresholds.targetAverageMonthlyReturnPct;
    const [trainResult, validationResult, oosResult, ...walkForwardResults] = await Promise.all([
      this.runCached(genome, plan.train),
      this.runCached(genome, plan.validation),
      this.runCached(genome, plan.oos),
      ...plan.walkForward.map((fold) => this.runCached(genome, fold.test)),
    ]);

    const walkForward = plan.walkForward.map((fold, index) => {
      const result = walkForwardResults[index];
      if (!result) throw new Error(`Walk-forward result missing for ${fold.label}`);
      const test = segment(fold.label, fold.test, result, target);
      const reasons = walkForwardGateReasons(test.metrics, config.thresholds);
      return {
        label: fold.label,
        trainWindow: fold.train,
        test,
        passed: reasons.length === 0,
        reasons,
      };
    });

    const stress = config.stressExtraRoundTripCostBps.map((extraRoundTripCostBps) => {
      const metrics = buildExecutionStressMetrics(oosResult, target, extraRoundTripCostBps);
      const reasons = stressGateReasons(metrics, config.thresholds);
      return {
        label: `oos-extra-cost-${extraRoundTripCostBps}bps`,
        extraRoundTripCostBps,
        metrics,
        passed: reasons.length === 0,
        reasons,
      };
    });

    return completeValidationReport(
      {
        plan,
        train: segment("train", plan.train, trainResult, target),
        validation: segment("validation", plan.validation, validationResult, target),
        oos: segment("oos", plan.oos, oosResult, target),
        walkForward,
        stress,
      },
      config.thresholds,
    );
  }
}
