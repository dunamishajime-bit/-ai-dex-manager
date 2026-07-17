import { createHash } from "node:crypto";

import { getStrategyUniverseSeed } from "@/config/strategyUniverse";
import type { Candle1h } from "@/lib/backtest/types";
import {
  buildContinuousStrategyMonitor,
  type ContinuousMonitorRuntimeState,
  type MarketSnapshot,
  type PriceSample,
  type StrategyEngineInput,
} from "@/lib/cycle-strategy";
import {
  classifyMainStrategyCandidate,
  WIN80_ULTRA90_MAIN_STRATEGY,
  type MainStrategyTier,
} from "@/lib/win80-ultra90-main-strategy";

import type { PerpFundingPoint, PerpMarketData } from "./types";

const HOUR_MS = 60 * 60 * 1000;

export interface MainStrategySnapshotReplayConfig {
  datasetId: string;
  symbols: string[];
  startTs: number;
  endTs: number;
  intervalHours: number;
  warmupHours: number;
  sameSymbolCooldownHours: number;
  feeBpsPerSide: number;
  slippageBpsPerSide: number;
  stressSlippageBpsPerSide: number;
  historyHours: number;
  maxEventsStored: number;
}

export interface MainStrategySnapshotReplayEvent {
  snapshotTs: number;
  snapshotIso: string;
  symbol: string;
  tier: Exclude<MainStrategyTier, "BLOCKED">;
  score: number;
  confidencePct: number;
  triggerState: string;
  triggerProgressPct: number;
  rr: number;
  volumeRatio: number;
  entryTs: number;
  entryPrice: number;
  forward24hPct: number;
  forward72hPct: number;
  forward168hPct: number;
  stress72hPct: number;
  funding72hPct: number;
  mfe72hPct: number;
  mae72hPct: number;
  snapshotFingerprint: string;
}

export interface MainStrategySnapshotReplayMetrics {
  sampleCount: number;
  winRate24hPct: number | null;
  winRate72hPct: number | null;
  winRate168hPct: number | null;
  average24hPct: number | null;
  average72hPct: number | null;
  average168hPct: number | null;
  median72hPct: number | null;
  profitFactor72h: number | null;
  stressAverage72hPct: number | null;
  eventSequenceMaxDrawdownPct: number | null;
  best72hPct: number | null;
  worst72hPct: number | null;
  averageMfe72hPct: number | null;
  averageMae72hPct: number | null;
}

export interface MainStrategySnapshotReplayArtifact {
  version: 1;
  datasetId: string;
  strategyId: string;
  generatedAt: string;
  source: PerpMarketData["source"];
  period: {
    startTs: number;
    endTs: number;
    startIso: string;
    endIso: string;
  };
  symbols: string[];
  intervalHours: number;
  warmupHours: number;
  snapshotCount: number;
  selectedSignalCount: number;
  noSignalSnapshotCount: number;
  incompleteOutcomeCount: number;
  costs: {
    feeBpsPerSide: number;
    slippageBpsPerSide: number;
    stressSlippageBpsPerSide: number;
  };
  metrics: MainStrategySnapshotReplayMetrics;
  signalCountsBySymbol: Record<string, number>;
  limitations: string[];
  fingerprint: string;
  events: MainStrategySnapshotReplayEvent[];
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function nullableMetric(values: number[], reducer: (items: number[]) => number) {
  return values.length ? round(reducer(values)) : null;
}

function winRate(values: number[]) {
  return values.length ? round((values.filter((value) => value > 0).length / values.length) * 100, 2) : null;
}

function profitFactor(values: number[]) {
  if (!values.length) return null;
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return wins > 0 ? 999 : null;
  return round(wins / losses, 3);
}

function eventSequenceMaxDrawdown(values: number[]) {
  if (!values.length) return null;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of values) {
    equity *= Math.max(0.01, 1 + value / 100);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, ((equity / peak) - 1) * 100);
  }
  return round(maxDrawdown);
}

function fundingPct(points: PerpFundingPoint[], startTs: number, endTs: number) {
  return points
    .filter((point) => point.ts >= startTs && point.ts <= endTs)
    .reduce((sum, point) => sum + point.rate * 100, 0);
}

function costPct(feeBpsPerSide: number, slippageBpsPerSide: number) {
  return ((feeBpsPerSide + slippageBpsPerSide) * 2) / 100;
}

function forwardOutcome(input: {
  candles: Candle1h[];
  currentIndex: number;
  hours: number;
  feeBpsPerSide: number;
  slippageBpsPerSide: number;
  funding: PerpFundingPoint[];
}) {
  const entryIndex = input.currentIndex + 1;
  const exitIndex = input.currentIndex + input.hours;
  const entry = input.candles[entryIndex];
  const exit = input.candles[exitIndex];
  if (!entry || !exit || entry.open <= 0 || exit.close <= 0) return null;
  const rawPct = ((exit.close / entry.open) - 1) * 100;
  const fundingCostPct = fundingPct(input.funding, entry.ts, exit.ts + HOUR_MS - 1);
  return {
    entryTs: entry.ts,
    entryPrice: entry.open,
    returnPct: rawPct - costPct(input.feeBpsPerSide, input.slippageBpsPerSide) - fundingCostPct,
    fundingCostPct,
  };
}

function extrema72h(candles: Candle1h[], currentIndex: number, entryPrice: number) {
  const window = candles.slice(currentIndex + 1, currentIndex + 73);
  if (!window.length || entryPrice <= 0) return { mfePct: 0, maePct: 0 };
  const high = Math.max(...window.map((candle) => candle.high));
  const low = Math.min(...window.map((candle) => candle.low));
  return {
    mfePct: ((high / entryPrice) - 1) * 100,
    maePct: ((low / entryPrice) - 1) * 100,
  };
}

function findIndexAtOrBefore(candles: Candle1h[], targetTs: number, fromIndex: number) {
  let index = Math.max(0, Math.min(fromIndex, candles.length - 1));
  while (index + 1 < candles.length && candles[index + 1].ts <= targetTs) index += 1;
  while (index > 0 && candles[index].ts > targetTs) index -= 1;
  return candles[index]?.ts <= targetTs ? index : -1;
}

function rollingQuoteVolume(candles: Candle1h[]) {
  return candles.reduce((sum, candle) => sum + Math.max(0, finite(candle.quoteVolume, candle.volume * candle.close)), 0);
}

function rollingTrades(candles: Candle1h[]) {
  return candles.reduce((sum, candle) => sum + Math.max(0, finite(candle.trades)), 0);
}

function buildSnapshot(input: {
  data: PerpMarketData;
  symbols: string[];
  referenceCandleTs: number;
  indexes: Record<string, number>;
  historyHours: number;
  slippageBpsPerSide: number;
}): StrategyEngineInput | null {
  const marketSnapshots: Record<string, MarketSnapshot | undefined> = {};
  const priceHistory: Record<string, PriceSample[] | undefined> = {};
  for (const baseSymbol of input.symbols) {
    const candles = input.data.bySymbol[baseSymbol] || [];
    const currentIndex = findIndexAtOrBefore(candles, input.referenceCandleTs, input.indexes[baseSymbol] ?? 0);
    input.indexes[baseSymbol] = Math.max(0, currentIndex);
    if (currentIndex < 24) continue;
    const current = candles[currentIndex];
    const historyStart = Math.max(0, currentIndex - input.historyHours + 1);
    const history = candles.slice(historyStart, currentIndex + 1);
    const rolling24 = candles.slice(Math.max(0, currentIndex - 23), currentIndex + 1);
    const previous24 = candles[currentIndex - 24];
    const seed = getStrategyUniverseSeed(baseSymbol);
    if (!seed || !current || !previous24 || current.close <= 0 || previous24.close <= 0) continue;
    const quoteVolume24h = rollingQuoteVolume(rolling24);
    const trades24h = rollingTrades(rolling24);
    const txns1h = trades24h > 0 ? Math.max(1, Math.round(trades24h / Math.max(1, rolling24.length))) : 0;
    const executionLiquidityUsd = Math.max(quoteVolume24h * 0.005, quoteVolume24h / Math.max(1, rolling24.length));
    marketSnapshots[seed.symbol] = {
      price: current.close,
      change24h: ((current.close / previous24.close) - 1) * 100,
      chain: seed.chain,
      displaySymbol: seed.displaySymbol,
      volume: quoteVolume24h,
      liquidity: Math.max(seed.liquidityUsd, executionLiquidityUsd),
      spreadBps: input.slippageBpsPerSide * 2,
      marketCap: seed.marketCapUsd,
      tokenAgeDays: seed.tokenAgeDays,
      txns1h,
      dexPairFound: true,
      executionSupported: true,
      executionChain: seed.chain,
      executionRouteKind: "native",
      executionSource: "binance-usdm-historical-snapshot",
      executionLiquidityUsd,
      executionVolume24hUsd: quoteVolume24h,
      executionTxns1h: txns1h,
      source: "binance-usdm-historical-snapshot",
    };
    priceHistory[seed.symbol] = history.map((candle) => ({
      ts: candle.ts + HOUR_MS - 1,
      price: candle.close,
    }));
  }
  if (!Object.keys(marketSnapshots).length) return null;
  return {
    referenceTs: input.referenceCandleTs + HOUR_MS - 1,
    marketSnapshots,
    priceHistory,
    positions: [],
    cyclePerformance: [],
  };
}

export function compactMainStrategySnapshotReplay(
  artifact: MainStrategySnapshotReplayArtifact,
): Omit<MainStrategySnapshotReplayArtifact, "events"> & { events: MainStrategySnapshotReplayEvent[] } {
  return {
    ...artifact,
    events: artifact.events.slice(0, 12),
  };
}

export function buildMainStrategySnapshotReplay(input: {
  data: PerpMarketData;
  config: MainStrategySnapshotReplayConfig;
  generatedAt?: string;
}): MainStrategySnapshotReplayArtifact {
  const config = input.config;
  const symbols = config.symbols
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol, index, array) => array.indexOf(symbol) === index)
    .filter((symbol) => Boolean(input.data.bySymbol[symbol]?.length && getStrategyUniverseSeed(symbol)));
  if (symbols.length < 3) {
    throw new Error(`Main strategy snapshot replay requires at least 3 mapped symbols; received ${symbols.join(",") || "none"}.`);
  }

  const intervalMs = Math.max(1, config.intervalHours) * HOUR_MS;
  const warmupMs = Math.max(48, config.warmupHours) * HOUR_MS;
  const firstSnapshotTs = config.startTs + warmupMs;
  const lastSnapshotTs = config.endTs - (168 * HOUR_MS) - HOUR_MS;
  if (lastSnapshotTs <= firstSnapshotTs) throw new Error("Main strategy snapshot replay period is too short.");

  const indexes: Record<string, number> = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  const events: MainStrategySnapshotReplayEvent[] = [];
  const recentTrades: NonNullable<ContinuousMonitorRuntimeState["recentTrades"]> = [];
  const lastSignalTsBySymbol = new Map<string, number>();
  let snapshotCount = 0;
  let noSignalSnapshotCount = 0;
  let incompleteOutcomeCount = 0;

  for (let candleTs = firstSnapshotTs; candleTs <= lastSnapshotTs; candleTs += intervalMs) {
    const strategyInput = buildSnapshot({
      data: input.data,
      symbols,
      referenceCandleTs: candleTs,
      indexes,
      historyHours: config.historyHours,
      slippageBpsPerSide: config.slippageBpsPerSide,
    });
    if (!strategyInput) continue;
    snapshotCount += 1;
    const runtimeState: ContinuousMonitorRuntimeState = {
      openSymbols: [],
      pendingSymbols: [],
      recentTrades: recentTrades.filter((trade) => trade.timestamp >= strategyInput.referenceTs - 7 * 24 * HOUR_MS),
    };
    const monitor = buildContinuousStrategyMonitor(strategyInput, runtimeState);
    const selected = monitor.selected[0];
    const tier = selected ? classifyMainStrategyCandidate(selected) : "BLOCKED";
    if (!selected || tier === "BLOCKED") {
      noSignalSnapshotCount += 1;
      continue;
    }
    const baseSymbol = selected.symbol.toUpperCase().replace(/\.SOL$/, "");
    const lastSignalTs = lastSignalTsBySymbol.get(baseSymbol) ?? 0;
    if (strategyInput.referenceTs - lastSignalTs < config.sameSymbolCooldownHours * HOUR_MS) continue;
    const candles = input.data.bySymbol[baseSymbol] || [];
    const currentIndex = findIndexAtOrBefore(candles, candleTs, indexes[baseSymbol] ?? 0);
    if (currentIndex < 0) continue;
    const funding = input.data.fundingBySymbol[baseSymbol] || [];
    const outcome24 = forwardOutcome({
      candles,
      currentIndex,
      hours: 24,
      feeBpsPerSide: config.feeBpsPerSide,
      slippageBpsPerSide: config.slippageBpsPerSide,
      funding,
    });
    const outcome72 = forwardOutcome({
      candles,
      currentIndex,
      hours: 72,
      feeBpsPerSide: config.feeBpsPerSide,
      slippageBpsPerSide: config.slippageBpsPerSide,
      funding,
    });
    const outcome168 = forwardOutcome({
      candles,
      currentIndex,
      hours: 168,
      feeBpsPerSide: config.feeBpsPerSide,
      slippageBpsPerSide: config.slippageBpsPerSide,
      funding,
    });
    const stress72 = forwardOutcome({
      candles,
      currentIndex,
      hours: 72,
      feeBpsPerSide: config.feeBpsPerSide,
      slippageBpsPerSide: config.stressSlippageBpsPerSide,
      funding,
    });
    if (!outcome24 || !outcome72 || !outcome168 || !stress72) {
      incompleteOutcomeCount += 1;
      continue;
    }
    const extrema = extrema72h(candles, currentIndex, outcome72.entryPrice);
    const snapshotFingerprint = createHash("sha256")
      .update([
        config.datasetId,
        WIN80_ULTRA90_MAIN_STRATEGY.id,
        String(strategyInput.referenceTs),
        baseSymbol,
        selected.marketScore.toFixed(4),
        selected.triggerProgressRatio.toFixed(6),
        outcome72.entryPrice.toFixed(12),
      ].join("|"))
      .digest("hex")
      .slice(0, 20);
    events.push({
      snapshotTs: strategyInput.referenceTs,
      snapshotIso: new Date(strategyInput.referenceTs).toISOString(),
      symbol: baseSymbol,
      tier,
      score: round(selected.marketScore, 2),
      confidencePct: round(finite(selected.confidence), 2),
      triggerState: selected.triggerState,
      triggerProgressPct: round(selected.triggerProgressRatio * 100, 2),
      rr: round(finite(selected.metrics?.rr), 3),
      volumeRatio: round(finite(selected.volumeRatio), 3),
      entryTs: outcome72.entryTs,
      entryPrice: round(outcome72.entryPrice, 10),
      forward24hPct: round(outcome24.returnPct),
      forward72hPct: round(outcome72.returnPct),
      forward168hPct: round(outcome168.returnPct),
      stress72hPct: round(stress72.returnPct),
      funding72hPct: round(outcome72.fundingCostPct),
      mfe72hPct: round(extrema.mfePct),
      mae72hPct: round(extrema.maePct),
      snapshotFingerprint,
    });
    lastSignalTsBySymbol.set(baseSymbol, strategyInput.referenceTs);
    recentTrades.push({ symbol: selected.symbol, action: "BUY", timestamp: strategyInput.referenceTs });
  }

  const completeEvents = events.slice(0, Math.max(1, config.maxEventsStored));
  const values24 = completeEvents.map((event) => event.forward24hPct);
  const values72 = completeEvents.map((event) => event.forward72hPct);
  const values168 = completeEvents.map((event) => event.forward168hPct);
  const stress72 = completeEvents.map((event) => event.stress72hPct);
  const signalCountsBySymbol = completeEvents.reduce<Record<string, number>>((accumulator, event) => {
    accumulator[event.symbol] = (accumulator[event.symbol] || 0) + 1;
    return accumulator;
  }, {});
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      datasetId: config.datasetId,
      source: input.data.source,
      period: [config.startTs, config.endTs],
      symbols,
      snapshots: snapshotCount,
      events: completeEvents.map((event) => event.snapshotFingerprint),
      costs: [config.feeBpsPerSide, config.slippageBpsPerSide, config.stressSlippageBpsPerSide],
    }))
    .digest("hex");

  return {
    version: 1,
    datasetId: config.datasetId,
    strategyId: WIN80_ULTRA90_MAIN_STRATEGY.id,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: input.data.source,
    period: {
      startTs: config.startTs,
      endTs: config.endTs,
      startIso: new Date(config.startTs).toISOString(),
      endIso: new Date(config.endTs).toISOString(),
    },
    symbols,
    intervalHours: config.intervalHours,
    warmupHours: config.warmupHours,
    snapshotCount,
    selectedSignalCount: completeEvents.length,
    noSignalSnapshotCount,
    incompleteOutcomeCount,
    costs: {
      feeBpsPerSide: config.feeBpsPerSide,
      slippageBpsPerSide: config.slippageBpsPerSide,
      stressSlippageBpsPerSide: config.stressSlippageBpsPerSide,
    },
    metrics: {
      sampleCount: completeEvents.length,
      winRate24hPct: winRate(values24),
      winRate72hPct: winRate(values72),
      winRate168hPct: winRate(values168),
      average24hPct: nullableMetric(values24, average),
      average72hPct: nullableMetric(values72, average),
      average168hPct: nullableMetric(values168, average),
      median72hPct: nullableMetric(values72, median),
      profitFactor72h: profitFactor(values72),
      stressAverage72hPct: nullableMetric(stress72, average),
      eventSequenceMaxDrawdownPct: eventSequenceMaxDrawdown(values72),
      best72hPct: nullableMetric(values72, (values) => Math.max(...values)),
      worst72hPct: nullableMetric(values72, (values) => Math.min(...values)),
      averageMfe72hPct: nullableMetric(completeEvents.map((event) => event.mfe72hPct), average),
      averageMae72hPct: nullableMetric(completeEvents.map((event) => event.mae72hPct), average),
    },
    signalCountsBySymbol,
    limitations: [
      "Binance USD-M 1h OHLCV/FundingをStrategyEngineInputへ変換した再現Snapshotであり、Asterの過去Order Bookそのものではありません。",
      "EntryはSnapshot確定後の次1時間足始値。24h/72h/168hは固定Forward Outcomeで、現行runnerの全決済ライフサイクル月利ではありません。",
      "Historical spreadは保存されていないため、fee/slippageは固定仮定を使用します。",
      "同一期間は既に分析済みであり、完全未使用OOSではありません。",
    ],
    fingerprint,
    events: completeEvents,
  };
}
