import assert from "node:assert/strict";

import type { Candle1h } from "../lib/backtest/types";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { runPerpResearch } from "../lib/research-lab/perp/orchestrator";
import type {
  PerpFundingPoint,
  PerpMarketData,
  PerpResearchConfig,
  PerpStrategyGenome,
} from "../lib/research-lab/perp/types";

const HOUR_MS = 60 * 60 * 1000;
const START_TS = Date.UTC(2023, 0, 1);
const HOURS = 24 * 365 * 2;

function syntheticCandles(input: {
  startPrice: number;
  trendMultiplier: number;
  phase: number;
}): Candle1h[] {
  const candles: Candle1h[] = [];
  let price = input.startPrice;

  for (let index = 0; index < HOURS; index += 1) {
    const regimeBlock = Math.floor(index / (24 * 45));
    const regimeDirection = regimeBlock % 2 === 0 ? 1 : -1;
    const cycle = Math.sin((index + input.phase) / 37) * 0.0015;
    const fastCycle = Math.sin((index + input.phase) / 9) * 0.0008;
    const drift = regimeDirection * 0.00045 * input.trendMultiplier;
    const shock = index % (24 * 31) === 0 ? regimeDirection * 0.012 * input.trendMultiplier : 0;
    const open = price;
    const close = Math.max(0.01, open * Math.exp(drift + cycle + fastCycle + shock));
    const range = Math.max(0.003, Math.abs(drift + cycle + fastCycle) * 5 + 0.004);
    const high = Math.max(open, close) * (1 + range);
    const low = Math.min(open, close) * (1 - range);
    const volumeBoost = index % (24 * 31) < 12 ? 2.4 : 1;

    candles.push({
      ts: START_TS + index * HOUR_MS,
      open,
      high,
      low,
      close,
      volume: (1_000 + 250 * Math.sin((index + input.phase) / 13)) * volumeBoost,
    });
    price = close;
  }

  return candles;
}

function syntheticFunding(phase: number): PerpFundingPoint[] {
  const points: PerpFundingPoint[] = [];
  for (let hour = 8; hour < HOURS; hour += 8) {
    const regimeBlock = Math.floor(hour / (24 * 45));
    const direction = regimeBlock % 2 === 0 ? 1 : -1;
    const cycle = Math.sin((hour + phase) / 48) * 0.00002;
    points.push({
      ts: START_TS + hour * HOUR_MS,
      rate: direction * 0.00008 + cycle,
    });
  }
  return points;
}

function marketData(): PerpMarketData {
  return {
    startTs: START_TS,
    endTs: START_TS + HOURS * HOUR_MS,
    source: "synthetic",
    bySymbol: {
      BTC: syntheticCandles({ startPrice: 20_000, trendMultiplier: 1, phase: 0 }),
      ETH: syntheticCandles({ startPrice: 1_500, trendMultiplier: 1.35, phase: 4 }),
      SOL: syntheticCandles({ startPrice: 30, trendMultiplier: 1.75, phase: 11 }),
    },
    fundingBySymbol: {
      BTC: syntheticFunding(0),
      ETH: syntheticFunding(4),
      SOL: syntheticFunding(11),
    },
  };
}

const genome: PerpStrategyGenome = {
  id: "perp-selftest-fixed",
  generation: 0,
  parentIds: [],
  createdBy: "quant-regime",
  family: "dual_direction",
  thesis: "合成相場でLong/Short・実Funding・コスト・清算計算を確認する",
  symbols: ["ETH", "SOL"],
  parameters: {
    timeframeHours: 4,
    leverage: 2,
    riskPerTradePct: 1,
    maxMarginUsagePct: 75,
    btcRegimeSmaBars: 18,
    btcRegimeMomentumBars: 6,
    regimeThresholdPct: 0.001,
    momentumBars: 5,
    breakoutBars: 4,
    breakoutBufferPct: 0,
    minimumMomentumPct: 0.002,
    minimumVolumeRatio: 0.5,
    minimumEdgeToCostRatio: 0.5,
    volatilityLookbackBars: 8,
    volatilityPenalty: 0.25,
    atrBars: 8,
    stopAtr: 1.8,
    takeProfitAtr: 3.5,
    trailingAtr: 2.2,
    maxHoldBars: 30,
    rebalanceBars: 3,
    cooldownBars: 1,
    allowLong: true,
    allowShort: true,
    allowNeutralRegime: true,
    neutralScoreThreshold: 0.05,
  },
};

const execution = {
  feeBpsPerSide: 6,
  slippageBpsPerSide: 5,
  adverseFundingBpsPer8h: 1,
  maintenanceMarginRate: 0.005,
};

async function main() {
  const data = marketData();
  const evaluationWindow = {
    label: "selftest",
    startTs: START_TS + 120 * 24 * HOUR_MS,
    endTs: data.endTs,
  };
  const result = runPerpBacktest({
    genome,
    data,
    window: evaluationWindow,
    execution,
    targetMonthlyReturnPct: 30,
  });

  assert.ok(result.trades.length > 0, "合成相場で取引が生成されること");
  assert.ok(result.risk.longTrades > 0, "Long取引が生成されること");
  assert.ok(result.risk.shortTrades > 0, "Short取引が生成されること");
  assert.ok(Number.isFinite(result.metrics.cagrPct));
  assert.ok(Number.isFinite(result.metrics.averageMonthlyReturnPct));
  assert.ok(Number.isFinite(result.metrics.maxDrawdownPct));
  assert.ok(Number.isFinite(result.risk.totalFundingCost));
  assert.ok(result.trades.some((trade) => Math.abs(trade.fundingCost) > 0), "Fundingが損益へ反映されること");
  assert.ok(result.risk.endingEquity >= 0);
  assert.ok(result.risk.maximumEffectiveLeverage <= genome.parameters.leverage + 0.0001);
  assert.ok(result.trades.every((trade) => Number.isFinite(trade.netPnl)));
  assert.ok(result.trades.every((trade) => trade.entryTs <= trade.exitTs));
  assert.ok(result.trades.every((trade) => trade.entryTs >= evaluationWindow.startTs));
  assert.ok(result.trades.every((trade) => trade.exitTs < evaluationWindow.endTs));
  assert.ok(result.equityCurve.every((point) => point.ts >= evaluationWindow.startTs));
  assert.equal(result.equityCurve[0]?.ts, evaluationWindow.startTs);

  const config: PerpResearchConfig = {
    profile: "balanced",
    rounds: 2,
    populationPerRound: 3,
    eliteCount: 2,
    finalistCount: 2,
    seed: 5603,
    maxConcurrency: 1,
    startTs: START_TS,
    endTs: data.endTs,
    symbols: ["BTC", "ETH", "SOL"],
    baseExecution: execution,
    stressExecutions: [
      {
        label: "selftest-stress",
        execution: {
          feeBpsPerSide: 12,
          slippageBpsPerSide: 15,
          adverseFundingBpsPer8h: 3,
          maintenanceMarginRate: 0.0075,
        },
      },
    ],
    walkForwardFolds: 2,
    thresholds: {
      targetAverageMonthlyReturnPct: 30,
      discoveryMinAverageMonthlyReturnPct: -100,
      discoveryMaxDrawdownPct: 100,
      discoveryMinSharpe: -10,
      discoveryMinProfitFactor: 0,
      discoveryMinTrades: 0,
      targetAverageEffectiveLeverage: 0.5,
      finalMinOosAverageMonthlyReturnPct: -100,
      finalMaxOosDrawdownPct: 100,
      finalMinOosTrades: 0,
      finalMinWalkForwardPassRatePct: 0,
      finalMinOosRetentionRatio: 0,
      finalMinStressAverageMonthlyReturnPct: -100,
      finalMinStressRetentionRatio: 0,
      finalMaxConsecutiveLosses: 1_000,
      requireBothDirections: false,
      requireZeroLiquidations: false,
    },
  };

  const research = await runPerpResearch(config, data);
  assert.equal(research.rounds.length, 2);
  assert.equal(research.totalEvaluations, 6);
  assert.ok(research.leaderboard.length > 0);
  assert.ok(research.validatedStrategies > 0);
  assert.ok(research.leaderboard.every((item) => Number.isFinite(item.score)));

  console.log(
    `Perp Research self-test passed: trades=${result.trades.length} long=${result.risk.longTrades} short=${result.risk.shortTrades} funding=${result.risk.totalFundingCost.toFixed(2)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
