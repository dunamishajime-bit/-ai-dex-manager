import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Candle1h } from "../lib/backtest/types";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpFundingPoint, PerpMarketData } from "../lib/research-lab/perp/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DATA_START = Date.UTC(2022, 8, 1);
const DEVELOPMENT_START = Date.UTC(2023, 0, 1);
const VALIDATION_START = Date.UTC(2024, 0, 1);
const HOLDOUT_START = Date.UTC(2025, 0, 1);
const END = Date.UTC(2026, 6, 1);
const SYMBOLS = ["ETH", "BNB", "SOL", "LINK", "AVAX"] as const;
const CORE = ["ETH", "BNB", "SOL"] as const;
const NORMAL_COST_BPS_PER_SIDE = 10;
const STRESS_COST_BPS_PER_SIDE = 30;
const ALLOCATION = 0.9;

type SymbolName = (typeof SYMBOLS)[number];
type SideFamily = "LONG_CASH" | "DUAL";
type UniverseId = "CORE3" | "BROAD5";
type TimeframeHours = 12 | 24;
type Window = { id: string; start: number; end: number };
type Bar = Candle1h & { count: number };
type WeightMap = Record<string, number>;
type Model = {
  id: string;
  timeframeHours: TimeframeHours;
  family: SideFamily;
  universeId: UniverseId;
  symbols: SymbolName[];
  regimeDays: 30 | 42 | 60;
  momentumDays: 10 | 20 | 30;
  rebalanceDays: 3.5 | 5.5 | 7;
  topK: 1 | 2;
};
type Cycle = {
  startTs: number;
  endTs: number;
  returnPct: number;
  stressReturnPct: number;
};
type Metrics = {
  cycles: number;
  winRatePct: number | null;
  averageCyclePct: number | null;
  medianCyclePct: number | null;
  profitFactor: number | null;
  stressProfitFactor: number | null;
  compoundedReturnPct: number;
  stressCompoundedReturnPct: number;
  cagrPct: number;
  stressCagrPct: number;
  maxDrawdownPct: number;
  stressMaxDrawdownPct: number;
  positiveMonthPct: number | null;
  exposurePct: number;
  turnover: number;
  bestCyclePct: number | null;
  worstCyclePct: number | null;
  bestCycleProfitSharePct: number | null;
  profitFactorWithoutBest: number | null;
  annualReturnsPct: Record<string, number>;
  halfYearReturnsPct: Record<string, number>;
};
type Evaluation = {
  model: Model;
  window: Window;
  metrics: Metrics;
};
type PairEvaluation = {
  development: Evaluation;
  validation: Evaluation;
  retention: number;
  neighborCount: number;
  neighborhoodScore: number;
};

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const productReturnPct = (returnsPct: number[]) => (returnsPct.reduce((equity, value) => equity * Math.max(0.001, 1 + value / 100), 1) - 1) * 100;

function resample(candles: Candle1h[], timeframeHours: TimeframeHours): Bar[] {
  const bucketMs = timeframeHours * HOUR;
  const groups = new Map<number, Candle1h[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.ts / bucketMs) * bucketMs;
    const current = groups.get(bucket) ?? [];
    current.push(candle);
    groups.set(bucket, current);
  }
  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .filter(([, rows]) => rows.length === timeframeHours)
    .map(([ts, rows]) => ({
      ts,
      open: rows[0].open,
      high: Math.max(...rows.map((row) => row.high)),
      low: Math.min(...rows.map((row) => row.low)),
      close: rows.at(-1)!.close,
      volume: rows.reduce((sum, row) => sum + row.volume, 0),
      quoteVolume: rows.reduce((sum, row) => sum + (row.quoteVolume ?? 0), 0),
      trades: rows.reduce((sum, row) => sum + (row.trades ?? 0), 0),
      count: rows.length,
    }));
}

function indexMap(bars: Bar[]) {
  return new Map(bars.map((bar, index) => [bar.ts, index]));
}

function sma(bars: Bar[], end: number, length: number) {
  if (length <= 0 || end - length + 1 < 0) return null;
  return mean(bars.slice(end - length + 1, end + 1).map((bar) => bar.close));
}

function momentumPct(bars: Bar[], end: number, length: number) {
  const prior = end - length;
  if (prior < 0 || bars[prior].close <= 0) return null;
  return ((bars[end].close / bars[prior].close) - 1) * 100;
}

function realizedVolPct(bars: Bar[], end: number, length: number) {
  if (end - length < 0) return null;
  const returns: number[] = [];
  for (let index = end - length + 1; index <= end; index += 1) {
    const previous = bars[index - 1]?.close;
    const close = bars[index]?.close;
    if (previous > 0 && close > 0) returns.push(Math.log(close / previous));
  }
  return standardDeviation(returns) * Math.sqrt(Math.max(1, returns.length)) * 100;
}

function volumeRatio(bars: Bar[], end: number, recent = 10, base = 40) {
  if (end - base + 1 < 0 || recent >= base) return null;
  const recentAverage = mean(bars.slice(end - recent + 1, end + 1).map((bar) => bar.volume));
  const baseAverage = mean(bars.slice(end - base + 1, end - recent + 1).map((bar) => bar.volume));
  return baseAverage > 0 ? recentAverage / baseAverage : null;
}

function fundingPct(points: PerpFundingPoint[], startTs: number, endTs: number) {
  return points
    .filter((point) => point.ts >= startTs && point.ts < endTs)
    .reduce((sum, point) => sum + point.rate * 100, 0);
}

function modelList(): Model[] {
  const models: Model[] = [];
  for (const timeframeHours of [12, 24] as const) {
    for (const family of ["LONG_CASH", "DUAL"] as const) {
      for (const universeId of ["CORE3", "BROAD5"] as const) {
        const symbols = [...(universeId === "CORE3" ? CORE : SYMBOLS)] as SymbolName[];
        for (const regimeDays of [30, 42, 60] as const) {
          for (const momentumDays of [10, 20, 30] as const) {
            for (const rebalanceDays of [3.5, 5.5, 7] as const) {
              for (const topK of [1, 2] as const) {
                models.push({
                  id: `MH_${timeframeHours}H_${family}_${universeId}_R${regimeDays}_M${momentumDays}_B${rebalanceDays}_K${topK}`,
                  timeframeHours,
                  family,
                  universeId,
                  symbols,
                  regimeDays,
                  momentumDays,
                  rebalanceDays,
                  topK,
                });
              }
            }
          }
        }
      }
    }
  }
  return models;
}

function structuralKey(model: Model) {
  return `${model.timeframeHours}:${model.family}:${model.universeId}:${model.topK}`;
}

function isNeighbor(left: Model, right: Model) {
  return structuralKey(left) === structuralKey(right)
    && Math.abs(left.regimeDays - right.regimeDays) <= 18
    && Math.abs(left.momentumDays - right.momentumDays) <= 10
    && Math.abs(left.rebalanceDays - right.rebalanceDays) <= 2;
}

function targetWeights(input: {
  model: Model;
  ts: number;
  barsBySymbol: Record<string, Bar[]>;
  indexesBySymbol: Record<string, Map<number, number>>;
}) {
  const { model, ts, barsBySymbol, indexesBySymbol } = input;
  const btcBars = barsBySymbol.BTC;
  const btcIndex = indexesBySymbol.BTC.get(ts);
  if (btcIndex == null) return {} as WeightMap;
  const barsPerDay = 24 / model.timeframeHours;
  const regimeBars = Math.max(10, Math.round(model.regimeDays * barsPerDay));
  const momentumBars = Math.max(5, Math.round(model.momentumDays * barsPerDay));
  const assetSmaBars = Math.max(10, Math.round(22 * barsPerDay));
  const btcAverage = sma(btcBars, btcIndex, regimeBars);
  const btcMomentum = momentumPct(btcBars, btcIndex, momentumBars);
  if (btcAverage == null || btcMomentum == null) return {} as WeightMap;
  const btcClose = btcBars[btcIndex].close;
  const bull = btcClose > btcAverage && btcMomentum > 0;
  const bear = btcClose < btcAverage && btcMomentum < 0;
  const longCandidates: Array<{ symbol: SymbolName; score: number }> = [];
  const shortCandidates: Array<{ symbol: SymbolName; score: number }> = [];
  let longBreadth = 0;
  let shortBreadth = 0;

  for (const symbol of model.symbols) {
    const bars = barsBySymbol[symbol];
    const index = indexesBySymbol[symbol].get(ts);
    if (index == null) continue;
    const average = sma(bars, index, assetSmaBars);
    const momentum = momentumPct(bars, index, momentumBars);
    const volatility = realizedVolPct(bars, index, momentumBars);
    const volume = volumeRatio(bars, index);
    if (average == null || momentum == null || volatility == null || volume == null) continue;
    const close = bars[index].close;
    const relative = momentum - btcMomentum;
    const liquidityPass = volume >= 0.7;
    const longPass = close > average && momentum > 0;
    const shortPass = close < average && momentum < 0;
    if (longPass) longBreadth += 1;
    if (shortPass) shortBreadth += 1;
    if (longPass && liquidityPass) {
      longCandidates.push({ symbol, score: momentum + relative * 0.3 - volatility * 0.18 + Math.min(2, volume) });
    }
    if (shortPass && liquidityPass) {
      shortCandidates.push({ symbol, score: -momentum - relative * 0.3 - volatility * 0.18 + Math.min(2, volume) });
    }
  }

  const breadthThreshold = model.universeId === "CORE3" ? 1 / 3 : 0.4;
  const longBreadthRatio = longBreadth / model.symbols.length;
  const shortBreadthRatio = shortBreadth / model.symbols.length;
  let selected: Array<{ symbol: SymbolName; score: number }> = [];
  let direction = 0;
  if (bull && longBreadthRatio >= breadthThreshold) {
    selected = longCandidates.sort((left, right) => right.score - left.score).slice(0, model.topK);
    direction = 1;
  } else if (model.family === "DUAL" && bear && shortBreadthRatio >= breadthThreshold) {
    selected = shortCandidates.sort((left, right) => right.score - left.score).slice(0, model.topK);
    direction = -1;
  }
  if (!selected.length) return {} as WeightMap;
  const each = (ALLOCATION / selected.length) * direction;
  return Object.fromEntries(selected.map((item) => [item.symbol, each]));
}

function weightsEqual(left: WeightMap, right: WeightMap) {
  const symbols = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const symbol of symbols) {
    if (Math.abs((left[symbol] ?? 0) - (right[symbol] ?? 0)) > 1e-9) return false;
  }
  return true;
}

function turnover(left: WeightMap, right: WeightMap) {
  const symbols = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...symbols].reduce((sum, symbol) => sum + Math.abs((right[symbol] ?? 0) - (left[symbol] ?? 0)), 0);
}

function exposure(weights: WeightMap) {
  return Object.values(weights).reduce((sum, weight) => sum + Math.abs(weight), 0);
}

function groupReturns(rows: Array<{ ts: number; returnPct: number }>, key: (ts: number) => string) {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const group = key(row.ts);
    const values = grouped.get(group) ?? [];
    values.push(row.returnPct);
    grouped.set(group, values);
  }
  return Object.fromEntries([...grouped.entries()].map(([group, values]) => [group, round(productReturnPct(values))]));
}

function profitFactor(values: number[]) {
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses > 0) return wins / losses;
  return wins > 0 ? 999 : null;
}

function buildMetrics(input: {
  window: Window;
  rows: Array<{ ts: number; returnPct: number; stressReturnPct: number; exposure: number; turnover: number }>;
  cycles: Cycle[];
}) : Metrics {
  const { window, rows, cycles } = input;
  const returns = rows.map((row) => row.returnPct);
  const stressReturns = rows.map((row) => row.stressReturnPct);
  const cycleReturns = cycles.map((cycle) => cycle.returnPct);
  const stressCycleReturns = cycles.map((cycle) => cycle.stressReturnPct);
  let equity = 1;
  let stressEquity = 1;
  let peak = 1;
  let stressPeak = 1;
  let drawdown = 0;
  let stressDrawdown = 0;
  for (let index = 0; index < returns.length; index += 1) {
    equity *= Math.max(0.001, 1 + returns[index] / 100);
    stressEquity *= Math.max(0.001, 1 + stressReturns[index] / 100);
    peak = Math.max(peak, equity);
    stressPeak = Math.max(stressPeak, stressEquity);
    drawdown = Math.min(drawdown, ((equity / peak) - 1) * 100);
    stressDrawdown = Math.min(stressDrawdown, ((stressEquity / stressPeak) - 1) * 100);
  }
  const years = Math.max(1 / 12, (window.end - window.start) / (365.25 * DAY));
  const cagr = (Math.pow(Math.max(0.001, equity), 1 / years) - 1) * 100;
  const stressCagr = (Math.pow(Math.max(0.001, stressEquity), 1 / years) - 1) * 100;
  const monthly = groupReturns(rows, (ts) => {
    const date = new Date(ts);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const annual = groupReturns(rows, (ts) => String(new Date(ts).getUTCFullYear()));
  const halfYear = groupReturns(rows, (ts) => {
    const date = new Date(ts);
    return `${date.getUTCFullYear()}-H${date.getUTCMonth() < 6 ? 1 : 2}`;
  });
  const monthlyValues = Object.values(monthly);
  const best = cycleReturns.length ? Math.max(...cycleReturns) : null;
  const positiveProfit = cycleReturns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const bestShare = best != null && best > 0 && positiveProfit > 0 ? (best / positiveProfit) * 100 : null;
  const withoutBest = best == null ? [] : cycleReturns.filter((value, index) => index !== cycleReturns.indexOf(best));
  return {
    cycles: cycles.length,
    winRatePct: cycles.length ? round((cycleReturns.filter((value) => value > 0).length / cycles.length) * 100, 2) : null,
    averageCyclePct: cycles.length ? round(mean(cycleReturns)) : null,
    medianCyclePct: cycles.length ? round(median(cycleReturns)) : null,
    profitFactor: cycleReturns.length ? round(profitFactor(cycleReturns) ?? 0, 3) : null,
    stressProfitFactor: stressCycleReturns.length ? round(profitFactor(stressCycleReturns) ?? 0, 3) : null,
    compoundedReturnPct: round((equity - 1) * 100),
    stressCompoundedReturnPct: round((stressEquity - 1) * 100),
    cagrPct: round(cagr),
    stressCagrPct: round(stressCagr),
    maxDrawdownPct: round(drawdown),
    stressMaxDrawdownPct: round(stressDrawdown),
    positiveMonthPct: monthlyValues.length ? round((monthlyValues.filter((value) => value > 0).length / monthlyValues.length) * 100, 2) : null,
    exposurePct: rows.length ? round(mean(rows.map((row) => row.exposure)) * 100, 2) : 0,
    turnover: round(rows.reduce((sum, row) => sum + row.turnover, 0), 4),
    bestCyclePct: best == null ? null : round(best),
    worstCyclePct: cycleReturns.length ? round(Math.min(...cycleReturns)) : null,
    bestCycleProfitSharePct: bestShare == null ? null : round(bestShare, 2),
    profitFactorWithoutBest: withoutBest.length ? round(profitFactor(withoutBest) ?? 0, 3) : null,
    annualReturnsPct: annual,
    halfYearReturnsPct: halfYear,
  };
}

function evaluate(input: {
  model: Model;
  window: Window;
  data: PerpMarketData;
  barsCache: Map<number, Record<string, Bar[]>>;
}) : Evaluation {
  const { model, window, data, barsCache } = input;
  let barsBySymbol = barsCache.get(model.timeframeHours);
  if (!barsBySymbol) {
    barsBySymbol = Object.fromEntries(["BTC", ...SYMBOLS].map((symbol) => [symbol, resample(data.bySymbol[symbol] ?? [], model.timeframeHours)]));
    barsCache.set(model.timeframeHours, barsBySymbol);
  }
  const indexesBySymbol = Object.fromEntries(Object.entries(barsBySymbol).map(([symbol, bars]) => [symbol, indexMap(bars)]));
  const btcBars = barsBySymbol.BTC;
  const firstIndex = btcBars.findIndex((bar) => bar.ts >= window.start);
  const lastIndex = btcBars.findLastIndex((bar) => bar.ts < window.end);
  if (firstIndex < 0 || lastIndex <= firstIndex) {
    return { model, window, metrics: buildMetrics({ window, rows: [], cycles: [] }) };
  }
  const rebalanceBars = Math.max(1, Math.round(model.rebalanceDays * 24 / model.timeframeHours));
  let weights: WeightMap = {};
  let pending: WeightMap | null = null;
  let cycleStart = -1;
  let cycleReturns: number[] = [];
  let cycleStressReturns: number[] = [];
  const rows: Array<{ ts: number; returnPct: number; stressReturnPct: number; exposure: number; turnover: number }> = [];
  const cycles: Cycle[] = [];

  const closeCycle = (endTs: number) => {
    if (cycleStart < 0 || !cycleReturns.length) return;
    cycles.push({
      startTs: cycleStart,
      endTs,
      returnPct: productReturnPct(cycleReturns),
      stressReturnPct: productReturnPct(cycleStressReturns),
    });
    cycleStart = -1;
    cycleReturns = [];
    cycleStressReturns = [];
  };

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const btcBar = btcBars[index];
    let barTurnover = 0;
    if (pending) {
      if (!weightsEqual(weights, pending)) {
        closeCycle(btcBar.ts - 1);
        barTurnover = turnover(weights, pending);
        weights = pending;
        if (exposure(weights) > 0) cycleStart = btcBar.ts;
      }
      pending = null;
    }
    let grossPct = 0;
    let portfolioFundingPct = 0;
    for (const [symbol, weight] of Object.entries(weights)) {
      const symbolIndex = indexesBySymbol[symbol]?.get(btcBar.ts);
      const bar = symbolIndex == null ? null : barsBySymbol[symbol]?.[symbolIndex];
      if (!bar || bar.open <= 0) continue;
      grossPct += weight * (((bar.close / bar.open) - 1) * 100);
      portfolioFundingPct += weight * fundingPct(data.fundingBySymbol[symbol] ?? [], bar.ts, bar.ts + model.timeframeHours * HOUR);
    }
    const normalCostPct = barTurnover * NORMAL_COST_BPS_PER_SIDE / 100;
    const stressCostPct = barTurnover * STRESS_COST_BPS_PER_SIDE / 100;
    const returnPct = grossPct - portfolioFundingPct - normalCostPct;
    const stressReturnPct = grossPct - portfolioFundingPct - stressCostPct;
    rows.push({ ts: btcBar.ts, returnPct, stressReturnPct, exposure: exposure(weights), turnover: barTurnover });
    if (cycleStart >= 0) {
      cycleReturns.push(returnPct);
      cycleStressReturns.push(stressReturnPct);
    }

    const currentTarget = targetWeights({ model, ts: btcBar.ts, barsBySymbol, indexesBySymbol });
    const currentExposed = exposure(weights) > 0;
    const regimeExit = currentExposed && exposure(currentTarget) === 0;
    const scheduled = ((btcBar.ts - DEVELOPMENT_START) / (model.timeframeHours * HOUR)) % rebalanceBars === 0;
    if (scheduled || regimeExit) pending = currentTarget;
  }

  const finalTurnover = exposure(weights);
  if (finalTurnover > 0 && rows.length) {
    const final = rows.at(-1)!;
    final.returnPct -= finalTurnover * NORMAL_COST_BPS_PER_SIDE / 100;
    final.stressReturnPct -= finalTurnover * STRESS_COST_BPS_PER_SIDE / 100;
    final.turnover += finalTurnover;
    if (cycleReturns.length) {
      cycleReturns[cycleReturns.length - 1] -= finalTurnover * NORMAL_COST_BPS_PER_SIDE / 100;
      cycleStressReturns[cycleStressReturns.length - 1] -= finalTurnover * STRESS_COST_BPS_PER_SIDE / 100;
    }
  }
  closeCycle(window.end - 1);
  return { model, window, metrics: buildMetrics({ window, rows, cycles }) };
}

function developmentPass(item: Evaluation) {
  const m = item.metrics;
  return m.cycles >= 12
    && m.cagrPct >= 12
    && (m.profitFactor ?? 0) >= 1.15
    && (m.stressProfitFactor ?? 0) >= 1
    && m.maxDrawdownPct >= -35
    && (m.positiveMonthPct ?? 0) >= 45
    && (m.annualReturnsPct["2023"] ?? -100) > 0;
}

function validationPass(development: Evaluation, validation: Evaluation) {
  const m = validation.metrics;
  const retention = development.metrics.cagrPct > 0 ? m.cagrPct / development.metrics.cagrPct : -1;
  return m.cycles >= 12
    && m.cagrPct >= 8
    && (m.profitFactor ?? 0) >= 1.1
    && (m.stressProfitFactor ?? 0) >= 1
    && m.maxDrawdownPct >= -35
    && (m.positiveMonthPct ?? 0) >= 45
    && (m.annualReturnsPct["2024"] ?? -100) > 0
    && retention >= 0.25;
}

function holdoutPass(item: Evaluation | null) {
  if (!item) return false;
  const m = item.metrics;
  return m.cycles >= 20
    && m.cagrPct >= 15
    && (m.profitFactor ?? 0) >= 1.15
    && (m.stressProfitFactor ?? 0) >= 1
    && m.maxDrawdownPct >= -35
    && (m.positiveMonthPct ?? 0) >= 50
    && (m.annualReturnsPct["2025"] ?? -100) > 0
    && (m.annualReturnsPct["2026"] ?? -100) > 0
    && (m.bestCycleProfitSharePct ?? 100) <= 40
    && (m.profitFactorWithoutBest ?? 0) >= 1;
}

function table(items: Evaluation[]) {
  return [
    "| Model | N | Win | CAGR | Stress CAGR | PF | Stress PF | Compound | DD | Positive months | Best share | PF ex-best |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...items.map((item) => {
      const m = item.metrics;
      return `| ${item.model.id} | ${m.cycles} | ${m.winRatePct?.toFixed(2) ?? "—"}% | ${m.cagrPct.toFixed(2)}% | ${m.stressCagrPct.toFixed(2)}% | ${m.profitFactor?.toFixed(2) ?? "—"} | ${m.stressProfitFactor?.toFixed(2) ?? "—"} | ${m.compoundedReturnPct.toFixed(2)}% | ${m.maxDrawdownPct.toFixed(2)}% | ${m.positiveMonthPct?.toFixed(2) ?? "—"}% | ${m.bestCycleProfitSharePct?.toFixed(2) ?? "—"}% | ${m.profitFactorWithoutBest?.toFixed(2) ?? "—"} |`;
    }),
  ].join("\n");
}

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR || ".research-state");
  const data = await loadPerpMarketData({ symbols: ["BTC", ...SYMBOLS], startTs: DATA_START, endTs: END });
  const windows = {
    development: { id: "DEVELOPMENT_2023", start: DEVELOPMENT_START, end: VALIDATION_START },
    validation: { id: "VALIDATION_2024", start: VALIDATION_START, end: HOLDOUT_START },
    holdout: { id: "FROZEN_HOLDOUT_2025_2026H1", start: HOLDOUT_START, end: END },
  } satisfies Record<string, Window>;
  const models = modelList();
  const barsCache = new Map<number, Record<string, Bar[]>>();
  const development = models.map((model) => evaluate({ model, window: windows.development, data, barsCache }));
  const developmentPassed = development.filter(developmentPass);
  const validationByModel = new Map<string, Evaluation>();
  const pairCandidates: PairEvaluation[] = [];
  for (const developmentItem of developmentPassed) {
    const validation = evaluate({ model: developmentItem.model, window: windows.validation, data, barsCache });
    validationByModel.set(developmentItem.model.id, validation);
    if (!validationPass(developmentItem, validation)) continue;
    pairCandidates.push({
      development: developmentItem,
      validation,
      retention: round(validation.metrics.cagrPct / developmentItem.metrics.cagrPct, 4),
      neighborCount: 0,
      neighborhoodScore: 0,
    });
  }

  for (const item of pairCandidates) {
    const neighbors = pairCandidates.filter((other) => isNeighbor(item.development.model, other.development.model));
    item.neighborCount = neighbors.length;
    item.neighborhoodScore = round(median(neighbors.map((neighbor) => Math.min(neighbor.development.metrics.cagrPct, neighbor.validation.metrics.cagrPct))), 4);
  }

  const robustPairs = pairCandidates
    .filter((item) => item.neighborCount >= 3)
    .sort((left, right) => right.neighborhoodScore - left.neighborhoodScore
      || right.neighborCount - left.neighborCount
      || left.validation.metrics.turnover - right.validation.metrics.turnover);
  const selected = robustPairs[0] ?? null;
  const holdout = selected
    ? evaluate({ model: selected.validation.model, window: windows.holdout, data, barsCache })
    : null;
  const passed = holdoutPass(holdout);
  const status = !developmentPassed.length
    ? "NO_DEVELOPMENT_EDGE"
    : !pairCandidates.length
      ? "NO_VALIDATION_EDGE"
      : !selected
        ? "NO_PARAMETER_NEIGHBORHOOD"
        : passed
          ? "PAPER_CANDIDATE_ONLY"
          : "HOLDOUT_REJECTED";
  const fingerprint = createHash("sha256").update(JSON.stringify({
    windows,
    models,
    source: data.source,
    bars: ["BTC", ...SYMBOLS].map((symbol) => [symbol, data.bySymbol[symbol]?.length ?? 0, data.bySymbol[symbol]?.[0]?.ts, data.bySymbol[symbol]?.at(-1)?.ts]),
  })).digest("hex");
  const result = {
    version: 3,
    strategyId: "MULTI_HORIZON_REGIME_ROTATION_V3",
    generatedAt: new Date().toISOString(),
    status,
    productionChanged: false,
    realTradingEnabled: false,
    fingerprint,
    source: {
      market: data.source,
      period: { start: DATA_START, end: END },
      models: models.length,
      developmentPassed: developmentPassed.length,
      validationPassed: pairCandidates.length,
      robustNeighborhoodCandidates: robustPairs.length,
    },
    selected: selected ? {
      model: selected.development.model,
      neighborCount: selected.neighborCount,
      neighborhoodScore: selected.neighborhoodScore,
      retention: selected.retention,
      development: selected.development,
      validation: selected.validation,
      frozenHoldout: holdout,
      holdoutPassed: passed,
      paperEligible: passed,
      liveEligible: false,
      liveBlockReasons: [
        "Aster実約定Spread/Slippage未検証",
        "Forward Paper 100 trades未達",
        "通貨別Forward 30 trades未達",
        "本番CIO承認前",
      ],
    } : null,
    topDevelopment: [...development].sort((left, right) => right.metrics.cagrPct - left.metrics.cagrPct).slice(0, 10),
    topValidationPairs: [...pairCandidates].sort((left, right) => right.neighborhoodScore - left.neighborhoodScore).slice(0, 15),
    limitations: [
      "Binance USD-M 1h OHLCV/Fundingを12h/24hへ集約しており、Aster板データではありません。",
      "2023 Development、2024 Validation、2025-2026H1 Frozen Holdoutの順に固定しています。",
      "432モデルを検証するため、多重検定対策として3近傍以上のパラメータ安定性を必須にしています。",
      "HoldoutはDevelopment・Validation・近傍安定性を通過した1案だけ評価します。",
      "Paper候補になっても実売買には進めず、Forward Paperと実約定コスト検証が必要です。",
      "本番コード、VPS、.env、実売買runnerは変更していません。",
    ],
  };

  const selectedRows = result.selected
    ? [result.selected.development, result.selected.validation, ...(result.selected.frozenHoldout ? [result.selected.frozenHoldout] : [])]
    : [];
  const report = [
    "# Multi-Horizon Regime Rotation V3",
    "",
    `- Status: **${status}**`,
    `- Models: ${models.length}`,
    `- Development passed: ${developmentPassed.length}`,
    `- Validation passed: ${pairCandidates.length}`,
    `- Robust parameter neighborhoods: ${robustPairs.length}`,
    "- Production changed: NO",
    "- Real trading: DISABLED",
    "",
    "## Design",
    "",
    "- 12h / 24h slow regime rotation",
    "- BTC SMA and momentum regime",
    "- Cross-sectional risk-adjusted momentum",
    "- CORE3 / BROAD5",
    "- Top1 / Top2",
    "- Long/Cash and symmetric Dual direction",
    "- Next-bar execution, actual funding, normal and stress costs",
    "- 2023 Development / 2024 Validation / 2025-2026H1 Frozen Holdout",
    "",
    "## Selected",
    "",
    ...(result.selected ? [
      `- Model: **${result.selected.model.id}**`,
      `- Neighbor count: ${result.selected.neighborCount}`,
      `- Neighborhood score: ${result.selected.neighborhoodScore}`,
      `- Development-to-Validation retention: ${(result.selected.retention * 100).toFixed(1)}%`,
      `- Frozen Holdout pass: **${result.selected.holdoutPassed ? "YES" : "NO"}**`,
      `- Paper eligible: **${result.selected.paperEligible ? "YES" : "NO"}**`,
      "",
      table(selectedRows),
    ] : ["No model passed Development, Validation, and parameter-neighborhood stability." ]),
    "",
    "## Development leaders",
    "",
    table(result.topDevelopment),
    "",
    "## Validation / neighborhood leaders",
    "",
    pairCandidates.length ? table(result.topValidationPairs.map((item) => item.validation)) : "Validation pass candidate: none",
    "",
    "## Verdict",
    "",
    passed
      ? "A multi-year, parameter-neighborhood-stable candidate passed the untouched Frozen Holdout. It may proceed only to Forward Paper; Live remains blocked."
      : "No strategy is promoted. The current production strategy remains frozen and Live remains blocked.",
    "",
    "## Limitations",
    "",
    ...result.limitations.map((item) => `- ${item}`),
  ].join("\n");

  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "multi-horizon-regime-rotation-v3.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "multi-horizon-regime-rotation-v3.md"), report, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\n${report}`, "utf8");
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
