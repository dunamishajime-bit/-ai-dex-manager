import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Candle1h } from "../lib/backtest/types";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpFundingPoint, PerpMarketData } from "../lib/research-lab/perp/types";

const HOUR = 3_600_000;
const SYMBOLS = ["ETH", "BNB", "SOL", "AVAX", "LINK"] as const;
const START = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 3, 7);
const DATA_START = Date.UTC(2025, 5, 1);
const DATA_END = Date.UTC(2026, 4, 1);
const FEE_BPS = 6;
const SLIPPAGE_BPS = 4;
const STRESS_SLIPPAGE_BPS = 12;

type SymbolName = (typeof SYMBOLS)[number];
type Side = "long" | "short";
type Family = "breakout_retest" | "pullback_reclaim";
type TriggerMode = "breakout" | "pullback" | "both";
type Model = {
  id: string;
  decisionHours: 6 | 12;
  trendMode: "72" | "168" | "dual";
  triggerMode: TriggerMode;
  strict: boolean;
  allowLong: boolean;
  allowShort: boolean;
};
type Exit = {
  id: string;
  hold: number;
  stopAtr: number;
  takeAtr: number;
  breakEvenAtr?: number;
  trailingAtr?: number;
};
type Feature = {
  symbol: SymbolName;
  index: number;
  ts: number;
  close: number;
  fast: number;
  slow: number;
  mom24: number;
  mom72: number;
  mom168: number;
  atr24: number;
  atr168: number;
  volumeRatio: number;
  relative72: number;
  relative168: number;
  longRank: number;
  shortRank: number;
};
type Candidate = {
  symbol: SymbolName;
  side: Side;
  family: Family;
  signalTs: number;
  entryIndex: number;
  entryTs: number;
  atr: number;
  score: number;
};
type Trade = {
  symbol: SymbolName;
  side: Side;
  family: Family;
  entryTs: number;
  exitTs: number;
  hours: number;
  pnl: number;
  stressPnl: number;
};
type Metrics = {
  count: number;
  winRatePct: number | null;
  averagePct: number | null;
  medianPct: number | null;
  profitFactor: number | null;
  stressProfitFactor: number | null;
  stressAveragePct: number | null;
  compoundedReturnPct: number | null;
  maxDrawdownPct: number | null;
  bestPct: number | null;
  worstPct: number | null;
  averageHoldingHours: number | null;
  longCount: number;
  shortCount: number;
  symbolCounts: Record<string, number>;
  familyCounts: Record<string, number>;
};
type Evaluation = {
  modelId: string;
  exit: Exit;
  rawCandidates: number;
  metrics: Metrics;
};
type StabilityEvaluation = {
  aggregate: Evaluation;
  folds: Evaluation[];
  positiveFolds: number;
  nonNegativeStressFolds: number;
  minimumFoldAveragePct: number | null;
  medianFoldAveragePct: number | null;
  minimumFoldProfitFactor: number | null;
  score: number;
};
type ValidationEvaluation = {
  development: StabilityEvaluation;
  validation: Evaluation;
  validationHalves: Evaluation[];
  retentionRatio: number;
  score: number;
  passed: boolean;
  reasons: string[];
};
type Range = { start: number; end: number };

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function indexAtOrBefore(candles: Candle1h[], ts: number) {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].ts <= ts) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function meanClose(candles: Candle1h[], end: number, bars: number) {
  if (end - bars + 1 < 0) return null;
  return average(candles.slice(end - bars + 1, end + 1).map((bar) => bar.close));
}

function momentum(candles: Candle1h[], end: number, bars: number) {
  const previous = end - bars;
  return previous >= 0 && candles[previous].close > 0
    ? ((candles[end].close / candles[previous].close) - 1) * 100
    : null;
}

function atr(candles: Candle1h[], end: number, bars: number) {
  if (end - bars + 1 < 1) return null;
  const values: number[] = [];
  for (let index = end - bars + 1; index <= end; index += 1) {
    const previousClose = candles[index - 1].close;
    values.push(Math.max(
      candles[index].high - candles[index].low,
      Math.abs(candles[index].high - previousClose),
      Math.abs(candles[index].low - previousClose),
    ));
  }
  return average(values);
}

function highest(candles: Candle1h[], start: number, end: number) {
  return start < 0 || end < start ? null : Math.max(...candles.slice(start, end + 1).map((bar) => bar.high));
}

function lowest(candles: Candle1h[], start: number, end: number) {
  return start < 0 || end < start ? null : Math.min(...candles.slice(start, end + 1).map((bar) => bar.low));
}

function volumeRatio(candles: Candle1h[], end: number) {
  if (end < 168) return null;
  const recent = average(candles.slice(end - 23, end + 1).map((bar) => bar.volume));
  const base = average(candles.slice(end - 167, end - 23).map((bar) => bar.volume));
  return base > 0 ? recent / base : null;
}

function funding(points: PerpFundingPoint[], start: number, end: number) {
  return points
    .filter((point) => point.ts >= start && point.ts <= end)
    .reduce((sum, point) => sum + point.rate * 100, 0);
}

function models(): Model[] {
  return [
    { id: "CONSENSUS_DUAL_BOTH_BALANCED_6H", decisionHours: 6, trendMode: "dual", triggerMode: "both", strict: false, allowLong: true, allowShort: true },
    { id: "CONSENSUS_DUAL_BOTH_STRICT_6H", decisionHours: 6, trendMode: "dual", triggerMode: "both", strict: true, allowLong: true, allowShort: true },
    { id: "CONSENSUS_DUAL_BREAKOUT_BALANCED_6H", decisionHours: 6, trendMode: "dual", triggerMode: "breakout", strict: false, allowLong: true, allowShort: true },
    { id: "CONSENSUS_DUAL_PULLBACK_BALANCED_6H", decisionHours: 6, trendMode: "dual", triggerMode: "pullback", strict: false, allowLong: true, allowShort: true },
    { id: "CONSENSUS_168_BOTH_BALANCED_12H", decisionHours: 12, trendMode: "168", triggerMode: "both", strict: false, allowLong: true, allowShort: true },
    { id: "CONSENSUS_168_BOTH_STRICT_12H", decisionHours: 12, trendMode: "168", triggerMode: "both", strict: true, allowLong: true, allowShort: true },
    { id: "CONSENSUS_DUAL_LONG_ONLY_6H", decisionHours: 6, trendMode: "dual", triggerMode: "both", strict: false, allowLong: true, allowShort: false },
    { id: "CONSENSUS_DUAL_SHORT_ONLY_6H", decisionHours: 6, trendMode: "dual", triggerMode: "both", strict: false, allowLong: false, allowShort: true },
  ];
}

function exits(): Exit[] {
  return [
    { id: "ATR_TP3_SL1.5_48H", hold: 48, stopAtr: 1.5, takeAtr: 3 },
    { id: "ATR_TP4_SL1.5_72H", hold: 72, stopAtr: 1.5, takeAtr: 4 },
    { id: "ATR_TP5_SL1.75_96H", hold: 96, stopAtr: 1.75, takeAtr: 5 },
    { id: "ATR_BE2_TRAIL2_TP6_SL1.5_72H", hold: 72, stopAtr: 1.5, takeAtr: 6, breakEvenAtr: 2, trailingAtr: 2 },
    { id: "ATR_BE2_TRAIL2.5_TP7_SL1.75_96H", hold: 96, stopAtr: 1.75, takeAtr: 7, breakEvenAtr: 2, trailingAtr: 2.5 },
    { id: "ATR_BE2.5_TRAIL3_TP8_SL2_120H", hold: 120, stopAtr: 2, takeAtr: 8, breakEvenAtr: 2.5, trailingAtr: 3 },
  ];
}

function splitRange(range: Range, parts: number): Range[] {
  const duration = range.end - range.start + 1;
  return Array.from({ length: parts }, (_, index) => {
    const start = range.start + Math.floor((duration * index) / parts);
    const end = index === parts - 1
      ? range.end
      : range.start + Math.floor((duration * (index + 1)) / parts) - 1;
    return { start, end };
  });
}

function featureAt(data: PerpMarketData, symbol: SymbolName, ts: number): Omit<Feature, "relative72" | "relative168" | "longRank" | "shortRank"> | null {
  const bars = data.bySymbol[symbol] || [];
  const index = indexAtOrBefore(bars, ts);
  if (index < 192 || index >= bars.length - 1 || bars[index].ts !== ts) return null;
  const fast = meanClose(bars, index, 48);
  const slow = meanClose(bars, index, 168);
  const mom24 = momentum(bars, index, 24);
  const mom72 = momentum(bars, index, 72);
  const mom168 = momentum(bars, index, 168);
  const atr24 = atr(bars, index, 24);
  const atr168 = atr(bars, index, 168);
  const volume = volumeRatio(bars, index);
  if ([fast, slow, mom24, mom72, mom168, atr24, atr168, volume].some((value) => value == null)) return null;
  return {
    symbol,
    index,
    ts,
    close: bars[index].close,
    fast: fast!,
    slow: slow!,
    mom24: mom24!,
    mom72: mom72!,
    mom168: mom168!,
    atr24: atr24!,
    atr168: atr168!,
    volumeRatio: volume!,
  };
}

function buildCandidates(data: PerpMarketData, model: Model, range: Range) {
  const result: Candidate[] = [];
  const btcBars = data.bySymbol.BTC || [];
  const minimumMomentum = model.strict ? 1.5 : 0;
  const minimumVolume = model.strict ? 1.05 : 0.85;
  const minimumBreadth = model.strict ? 4 : 3;
  const maximumRank = model.strict ? 1 : 2;
  const breakoutBars = model.strict ? 96 : 72;
  const maximumExtensionAtr = model.strict ? 0.65 : 1.1;
  const retestToleranceAtr = model.strict ? 0.35 : 0.75;

  for (const btcBar of btcBars) {
    const ts = btcBar.ts;
    if (ts < range.start || ts > range.end || Math.floor(ts / HOUR) % model.decisionHours !== 0) continue;
    const btcIndex = indexAtOrBefore(btcBars, ts);
    if (btcIndex < 192 || btcIndex >= btcBars.length - 1) continue;
    const btcFast = meanClose(btcBars, btcIndex, 48);
    const btcSlow = meanClose(btcBars, btcIndex, 168);
    const btcMom72 = momentum(btcBars, btcIndex, 72);
    const btcMom168 = momentum(btcBars, btcIndex, 168);
    if ([btcFast, btcSlow, btcMom72, btcMom168].some((value) => value == null)) continue;

    const baseFeatures = SYMBOLS
      .map((symbol) => featureAt(data, symbol, ts))
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null);
    if (baseFeatures.length !== SYMBOLS.length) continue;

    const longOrder = [...baseFeatures].sort((left, right) => (right.mom72 - btcMom72!) - (left.mom72 - btcMom72!));
    const shortOrder = [...baseFeatures].sort((left, right) => (left.mom72 - btcMom72!) - (right.mom72 - btcMom72!));
    const longRanks = new Map(longOrder.map((feature, index) => [feature.symbol, index + 1]));
    const shortRanks = new Map(shortOrder.map((feature, index) => [feature.symbol, index + 1]));
    const features: Feature[] = baseFeatures.map((feature) => ({
      ...feature,
      relative72: feature.mom72 - btcMom72!,
      relative168: feature.mom168 - btcMom168!,
      longRank: longRanks.get(feature.symbol)!,
      shortRank: shortRanks.get(feature.symbol)!,
    }));

    const longBreadth = features.filter((feature) => feature.close > feature.slow && feature.fast > feature.slow && feature.mom72 > 0).length;
    const shortBreadth = features.filter((feature) => feature.close < feature.slow && feature.fast < feature.slow && feature.mom72 < 0).length;
    const btcLong = btcBar.close > btcSlow! && btcFast! > btcSlow! && btcMom72! >= minimumMomentum
      && (model.trendMode !== "dual" || btcMom168! > 0);
    const btcShort = btcBar.close < btcSlow! && btcFast! < btcSlow! && btcMom72! <= -minimumMomentum
      && (model.trendMode !== "dual" || btcMom168! < 0);

    for (const feature of features) {
      const bars = data.bySymbol[feature.symbol] || [];
      const current = bars[feature.index];
      const previous = bars[feature.index - 1];
      const entry = bars[feature.index + 1];
      if (!current || !previous || !entry) continue;
      const volatilityRatio = feature.atr168 > 0 ? feature.atr24 / feature.atr168 : 99;
      if (volatilityRatio > (model.strict ? 1.8 : 2.25) || feature.volumeRatio < minimumVolume) continue;

      const common = {
        symbol: feature.symbol,
        signalTs: ts,
        entryIndex: feature.index + 1,
        entryTs: entry.ts,
        atr: feature.atr24,
      };
      const emit = (side: Side, family: Family, score: number) => result.push({
        ...common,
        side,
        family,
        score: round(score, 6),
      });

      const longTrend = model.allowLong && btcLong && longBreadth >= minimumBreadth
        && feature.close > feature.slow && feature.fast > feature.slow
        && feature.mom72 >= minimumMomentum
        && (model.trendMode === "72" || feature.mom168 > 0)
        && feature.relative72 >= 0
        && (model.trendMode !== "dual" || feature.relative168 >= -1)
        && feature.longRank <= maximumRank;
      const shortTrend = model.allowShort && btcShort && shortBreadth >= minimumBreadth
        && feature.close < feature.slow && feature.fast < feature.slow
        && feature.mom72 <= -minimumMomentum
        && (model.trendMode === "72" || feature.mom168 < 0)
        && feature.relative72 <= 0
        && (model.trendMode !== "dual" || feature.relative168 <= 1)
        && feature.shortRank <= maximumRank;

      if (model.triggerMode === "breakout" || model.triggerMode === "both") {
        const priorHigh = highest(bars, feature.index - breakoutBars - 1, feature.index - 2);
        const priorLow = lowest(bars, feature.index - breakoutBars - 1, feature.index - 2);
        if (longTrend && priorHigh != null) {
          const extension = (current.close - priorHigh) / feature.atr24;
          const confirmed = previous.close > priorHigh && current.close > priorHigh;
          const retested = current.low <= priorHigh + feature.atr24 * retestToleranceAtr;
          if (confirmed && retested && extension >= 0 && extension <= maximumExtensionAtr && current.close >= current.open) {
            emit("long", "breakout_retest", feature.mom72 + feature.mom168 * 0.35 + feature.relative72 * 1.5
              + (maximumRank + 1 - feature.longRank) * 3 + feature.volumeRatio * 2 + longBreadth * 1.5 - extension * 2);
          }
        }
        if (shortTrend && priorLow != null) {
          const extension = (priorLow - current.close) / feature.atr24;
          const confirmed = previous.close < priorLow && current.close < priorLow;
          const retested = current.high >= priorLow - feature.atr24 * retestToleranceAtr;
          if (confirmed && retested && extension >= 0 && extension <= maximumExtensionAtr && current.close <= current.open) {
            emit("short", "breakout_retest", -feature.mom72 + -feature.mom168 * 0.35 + -feature.relative72 * 1.5
              + (maximumRank + 1 - feature.shortRank) * 3 + feature.volumeRatio * 2 + shortBreadth * 1.5 - extension * 2);
          }
        }
      }

      if (model.triggerMode === "pullback" || model.triggerMode === "both") {
        const lookback = model.strict ? 18 : 12;
        const recentLow = lowest(bars, feature.index - lookback, feature.index - 1);
        const recentHigh = highest(bars, feature.index - lookback, feature.index - 1);
        const longTouched = recentLow != null && recentLow <= feature.fast + feature.atr24 * (model.strict ? 0.15 : 0.4);
        const shortTouched = recentHigh != null && recentHigh >= feature.fast - feature.atr24 * (model.strict ? 0.15 : 0.4);
        const longReclaim = current.close > feature.fast && current.close > previous.high
          && (!model.strict || previous.close <= feature.fast);
        const shortReclaim = current.close < feature.fast && current.close < previous.low
          && (!model.strict || previous.close >= feature.fast);
        if (longTrend && longTouched && longReclaim) {
          const extension = Math.max(0, (current.close - feature.fast) / feature.atr24);
          if (extension <= maximumExtensionAtr * 1.5) {
            emit("long", "pullback_reclaim", feature.mom72 + feature.mom168 * 0.35 + feature.relative72 * 1.5
              + (maximumRank + 1 - feature.longRank) * 3 + feature.volumeRatio * 2 + longBreadth * 1.5 - extension);
          }
        }
        if (shortTrend && shortTouched && shortReclaim) {
          const extension = Math.max(0, (feature.fast - current.close) / feature.atr24);
          if (extension <= maximumExtensionAtr * 1.5) {
            emit("short", "pullback_reclaim", -feature.mom72 + -feature.mom168 * 0.35 + -feature.relative72 * 1.5
              + (maximumRank + 1 - feature.shortRank) * 3 + feature.volumeRatio * 2 + shortBreadth * 1.5 - extension);
          }
        }
      }
    }
  }

  return result.sort((left, right) => left.signalTs - right.signalTs || right.score - left.score);
}

function buildLegacyBreakoutCandidates(data: PerpMarketData, range: Range) {
  const result: Candidate[] = [];
  const btc = data.bySymbol.BTC || [];
  for (const symbol of SYMBOLS) {
    const bars = data.bySymbol[symbol] || [];
    for (let index = 192; index < bars.length - 1; index += 1) {
      const current = bars[index];
      if (current.ts < range.start || current.ts > range.end || Math.floor(current.ts / HOUR) % 6 !== 0) continue;
      const btcIndex = indexAtOrBefore(btc, current.ts);
      if (btcIndex < 192) continue;
      const symbolFast = meanClose(bars, index, 48);
      const symbolSlow = meanClose(bars, index, 168);
      const btcFast = meanClose(btc, btcIndex, 48);
      const btcSlow = meanClose(btc, btcIndex, 168);
      const symbolMomentum = momentum(bars, index, 168);
      const btcMomentum = momentum(btc, btcIndex, 168);
      const volatility = atr(bars, index, 24);
      const volume = volumeRatio(bars, index);
      if ([symbolFast, symbolSlow, btcFast, btcSlow, symbolMomentum, btcMomentum, volatility, volume].some((value) => value == null)) continue;
      const relative = symbolMomentum! - btcMomentum!;
      const longTrend = current.close > symbolSlow! && symbolFast! > symbolSlow! && btc[btcIndex].close > btcSlow!
        && btcFast! > btcSlow! && symbolMomentum! >= 0 && btcMomentum! >= 0 && relative >= 0;
      const shortTrend = current.close < symbolSlow! && symbolFast! < symbolSlow! && btc[btcIndex].close < btcSlow!
        && btcFast! < btcSlow! && symbolMomentum! <= 0 && btcMomentum! <= 0 && relative <= 0;
      const priorHigh = highest(bars, index - 72, index - 1);
      const priorLow = lowest(bars, index - 72, index - 1);
      if (volume! < 0.9 || priorHigh == null || priorLow == null) continue;
      const common = { symbol, signalTs: current.ts, entryIndex: index + 1, entryTs: bars[index + 1].ts, atr: volatility! };
      if (longTrend && current.close > priorHigh) result.push({ ...common, side: "long", family: "breakout_retest", score: round(((current.close - priorHigh) / volatility!) * 4 + Math.max(0, relative) + volume! * 3) });
      if (shortTrend && current.close < priorLow) result.push({ ...common, side: "short", family: "breakout_retest", score: round(((priorLow - current.close) / volatility!) * 4 + Math.max(0, -relative) + volume! * 3) });
    }
  }
  return result.sort((left, right) => left.signalTs - right.signalTs || right.score - left.score);
}

function simulate(candidate: Candidate, exit: Exit, data: PerpMarketData): Trade | null {
  const bars = data.bySymbol[candidate.symbol] || [];
  const entry = bars[candidate.entryIndex];
  if (!entry || entry.ts !== candidate.entryTs || entry.open <= 0) return null;
  const initialStop = candidate.side === "long"
    ? entry.open - candidate.atr * exit.stopAtr
    : entry.open + candidate.atr * exit.stopAtr;
  const take = candidate.side === "long"
    ? entry.open + candidate.atr * exit.takeAtr
    : entry.open - candidate.atr * exit.takeAtr;
  const last = Math.min(bars.length - 1, candidate.entryIndex + exit.hold - 1);
  if (last <= candidate.entryIndex) return null;

  let exitIndex = last;
  let exitPrice = bars[last].close;
  let favorableExtreme = entry.open;
  for (let index = candidate.entryIndex; index <= last; index += 1) {
    let dynamicStop = initialStop;
    if (exit.breakEvenAtr != null) {
      const breakEvenReached = candidate.side === "long"
        ? favorableExtreme >= entry.open + candidate.atr * exit.breakEvenAtr
        : favorableExtreme <= entry.open - candidate.atr * exit.breakEvenAtr;
      if (breakEvenReached) dynamicStop = entry.open;
    }
    if (exit.trailingAtr != null) {
      const trailing = candidate.side === "long"
        ? favorableExtreme - candidate.atr * exit.trailingAtr
        : favorableExtreme + candidate.atr * exit.trailingAtr;
      dynamicStop = candidate.side === "long" ? Math.max(dynamicStop, trailing) : Math.min(dynamicStop, trailing);
    }
    const stopHit = candidate.side === "long" ? bars[index].low <= dynamicStop : bars[index].high >= dynamicStop;
    const takeHit = candidate.side === "long" ? bars[index].high >= take : bars[index].low <= take;
    if (stopHit) {
      exitIndex = index;
      exitPrice = dynamicStop;
      break;
    }
    if (takeHit) {
      exitIndex = index;
      exitPrice = take;
      break;
    }
    favorableExtreme = candidate.side === "long"
      ? Math.max(favorableExtreme, bars[index].high)
      : Math.min(favorableExtreme, bars[index].low);
  }

  const exitTs = bars[exitIndex].ts + HOUR - 1;
  const gross = candidate.side === "long"
    ? ((exitPrice / entry.open) - 1) * 100
    : ((entry.open / exitPrice) - 1) * 100;
  const fundingCost = funding(data.fundingBySymbol[candidate.symbol] || [], candidate.entryTs, exitTs)
    * (candidate.side === "long" ? 1 : -1);
  return {
    symbol: candidate.symbol,
    side: candidate.side,
    family: candidate.family,
    entryTs: candidate.entryTs,
    exitTs,
    hours: Math.max(1, Math.ceil((exitTs - candidate.entryTs + 1) / HOUR)),
    pnl: gross - ((FEE_BPS + SLIPPAGE_BPS) * 2) / 100 - fundingCost,
    stressPnl: gross - ((FEE_BPS + STRESS_SLIPPAGE_BPS) * 2) / 100 - fundingCost,
  };
}

function metrics(trades: Trade[]): Metrics {
  const values = trades.map((trade) => trade.pnl);
  const stress = trades.map((trade) => trade.stressPnl);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const stressWins = stress.filter((value) => value > 0);
  const stressLosses = stress.filter((value) => value < 0);
  const profitFactor = losses.length
    ? wins.reduce((sum, value) => sum + value, 0) / Math.abs(losses.reduce((sum, value) => sum + value, 0))
    : wins.length ? 999 : null;
  const stressProfitFactor = stressLosses.length
    ? stressWins.reduce((sum, value) => sum + value, 0) / Math.abs(stressLosses.reduce((sum, value) => sum + value, 0))
    : stressWins.length ? 999 : null;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of values) {
    equity *= Math.max(0.001, 1 + value / 100);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, ((equity / peak) - 1) * 100);
  }
  const countBy = (key: "symbol" | "family") => trades.reduce<Record<string, number>>((result, trade) => {
    result[trade[key]] = (result[trade[key]] || 0) + 1;
    return result;
  }, {});
  return {
    count: values.length,
    winRatePct: values.length ? round((wins.length / values.length) * 100, 2) : null,
    averagePct: values.length ? round(average(values)) : null,
    medianPct: values.length ? round(median(values)) : null,
    profitFactor: profitFactor == null ? null : round(profitFactor, 3),
    stressProfitFactor: stressProfitFactor == null ? null : round(stressProfitFactor, 3),
    stressAveragePct: stress.length ? round(average(stress)) : null,
    compoundedReturnPct: values.length ? round((equity - 1) * 100) : null,
    maxDrawdownPct: values.length ? round(maxDrawdown) : null,
    bestPct: values.length ? round(Math.max(...values)) : null,
    worstPct: values.length ? round(Math.min(...values)) : null,
    averageHoldingHours: trades.length ? round(average(trades.map((trade) => trade.hours)), 2) : null,
    longCount: trades.filter((trade) => trade.side === "long").length,
    shortCount: trades.filter((trade) => trade.side === "short").length,
    symbolCounts: countBy("symbol"),
    familyCounts: countBy("family"),
  };
}

function evaluate(raw: Candidate[], modelId: string, exit: Exit, data: PerpMarketData, maxExitTs: number): Evaluation {
  const trades: Trade[] = [];
  let busyUntil = -Infinity;
  for (let index = 0; index < raw.length;) {
    const signalTs = raw[index].signalTs;
    const sameTime: Candidate[] = [];
    while (index < raw.length && raw[index].signalTs === signalTs) sameTime.push(raw[index++]);
    if (signalTs <= busyUntil) continue;
    const eligible = sameTime.filter((candidate) => candidate.entryTs + exit.hold * HOUR - 1 <= maxExitTs);
    if (!eligible.length) continue;
    const chosen = eligible.sort((left, right) => right.score - left.score)[0];
    const trade = simulate(chosen, exit, data);
    if (trade) {
      trades.push(trade);
      busyUntil = trade.exitTs;
    }
  }
  return { modelId, exit, rawCandidates: raw.length, metrics: metrics(trades) };
}

function stabilityScore(item: StabilityEvaluation) {
  const aggregate = item.aggregate.metrics;
  return (item.minimumFoldAveragePct ?? -10) * 20
    + (item.medianFoldAveragePct ?? -10) * 15
    + Math.min(3, item.minimumFoldProfitFactor ?? 0) * 8
    + item.positiveFolds * 4
    + item.nonNegativeStressFolds * 3
    + (aggregate.averagePct ?? -10) * 8
    + Math.min(4, aggregate.profitFactor ?? 0) * 4
    - Math.abs(aggregate.maxDrawdownPct ?? -100) * 0.25;
}

function developmentPass(item: StabilityEvaluation) {
  const aggregate = item.aggregate.metrics;
  return aggregate.count >= 16
    && (aggregate.averagePct ?? -1) > 0
    && (aggregate.profitFactor ?? 0) >= 1.15
    && (aggregate.stressProfitFactor ?? 0) >= 1
    && (aggregate.maxDrawdownPct ?? -100) >= -25
    && item.positiveFolds >= 3
    && item.nonNegativeStressFolds >= 3
    && (item.minimumFoldAveragePct ?? -99) >= -0.75
    && (item.medianFoldAveragePct ?? -99) > 0;
}

function validationResult(development: StabilityEvaluation, validation: Evaluation, halves: Evaluation[]) {
  const retentionRatio = (development.aggregate.metrics.averagePct ?? 0) > 0
    ? (validation.metrics.averagePct ?? -1) / development.aggregate.metrics.averagePct!
    : -1;
  const reasons: string[] = [];
  if (validation.metrics.count < 8) reasons.push("Validation N<8");
  if ((validation.metrics.averagePct ?? -1) <= 0) reasons.push("Validation平均<=0");
  if ((validation.metrics.profitFactor ?? 0) < 1.1) reasons.push("Validation PF<1.10");
  if ((validation.metrics.stressProfitFactor ?? 0) < 1) reasons.push("Validation Stress PF<1.00");
  if ((validation.metrics.maxDrawdownPct ?? -100) < -20) reasons.push("Validation DD<-20%");
  if (retentionRatio < 0.25) reasons.push("平均損益Retention<25%");
  if (halves.filter((half) => (half.metrics.averagePct ?? -1) > 0).length < 1) reasons.push("Validation半期の正区間なし");
  if (Math.min(...halves.map((half) => half.metrics.averagePct ?? -99)) < -1) reasons.push("Validation半期平均<-1%");
  const score = Math.min(development.aggregate.metrics.averagePct ?? -10, validation.metrics.averagePct ?? -10) * 15
    + Math.min(development.aggregate.metrics.profitFactor ?? 0, validation.metrics.profitFactor ?? 0) * 6
    + Math.min(development.aggregate.metrics.stressProfitFactor ?? 0, validation.metrics.stressProfitFactor ?? 0) * 6
    + (validation.metrics.compoundedReturnPct ?? -100)
    - Math.abs(validation.metrics.maxDrawdownPct ?? -100) * 0.4
    + halves.filter((half) => (half.metrics.averagePct ?? -1) > 0).length * 3;
  return {
    development,
    validation,
    validationHalves: halves,
    retentionRatio: round(retentionRatio, 4),
    score: round(score, 6),
    passed: reasons.length === 0,
    reasons,
  } satisfies ValidationEvaluation;
}

function evaluationTable(items: Evaluation[]) {
  return [
    "| Model | Exit | Raw | N | L/S | Win | Avg | Median | PF | Stress PF | Compound | DD |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...items.map((item) => `| ${item.modelId} | ${item.exit.id} | ${item.rawCandidates} | ${item.metrics.count} | ${item.metrics.longCount}/${item.metrics.shortCount} | ${item.metrics.winRatePct?.toFixed(2) ?? "—"}% | ${item.metrics.averagePct?.toFixed(2) ?? "—"}% | ${item.metrics.medianPct?.toFixed(2) ?? "—"}% | ${item.metrics.profitFactor?.toFixed(2) ?? "—"} | ${item.metrics.stressProfitFactor?.toFixed(2) ?? "—"} | ${item.metrics.compoundedReturnPct?.toFixed(2) ?? "—"}% | ${item.metrics.maxDrawdownPct?.toFixed(2) ?? "—"}% |`),
  ].join("\n");
}

function stabilityTable(items: StabilityEvaluation[]) {
  return [
    "| Model | Exit | N | Avg | PF | Stress PF | Positive folds | Stress folds | Worst fold avg | Median fold avg | Score |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...items.map((item) => `| ${item.aggregate.modelId} | ${item.aggregate.exit.id} | ${item.aggregate.metrics.count} | ${item.aggregate.metrics.averagePct?.toFixed(2) ?? "—"}% | ${item.aggregate.metrics.profitFactor?.toFixed(2) ?? "—"} | ${item.aggregate.metrics.stressProfitFactor?.toFixed(2) ?? "—"} | ${item.positiveFolds}/4 | ${item.nonNegativeStressFolds}/4 | ${item.minimumFoldAveragePct?.toFixed(2) ?? "—"}% | ${item.medianFoldAveragePct?.toFixed(2) ?? "—"}% | ${item.score.toFixed(2)} |`),
  ].join("\n");
}

function validationTable(items: ValidationEvaluation[]) {
  return [
    "| Model | Exit | N | Win | Avg | PF | Stress PF | Retention | Half avg | Pass | Reasons |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...items.map((item) => `| ${item.validation.modelId} | ${item.validation.exit.id} | ${item.validation.metrics.count} | ${item.validation.metrics.winRatePct?.toFixed(2) ?? "—"}% | ${item.validation.metrics.averagePct?.toFixed(2) ?? "—"}% | ${item.validation.metrics.profitFactor?.toFixed(2) ?? "—"} | ${item.validation.metrics.stressProfitFactor?.toFixed(2) ?? "—"} | ${(item.retentionRatio * 100).toFixed(1)}% | ${item.validationHalves.map((half) => `${half.metrics.averagePct?.toFixed(2) ?? "—"}%`).join(" / ")} | ${item.passed ? "YES" : "NO"} | ${item.reasons.join(" / ") || "—"} |`),
  ].join("\n");
}

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR || ".research-state");
  const data = await loadPerpMarketData({ symbols: ["BTC", ...SYMBOLS], startTs: DATA_START, endTs: DATA_END });
  const developmentEnd = START + Math.floor((END - START) * 0.5);
  const validationEnd = START + Math.floor((END - START) * 0.75);
  const ranges = {
    development: { start: START, end: developmentEnd },
    validation: { start: developmentEnd + 1, end: validationEnd },
    holdout: { start: validationEnd + 1, end: END },
    all: { start: START, end: END },
  };
  const developmentFolds = splitRange(ranges.development, 4);
  const validationHalves = splitRange(ranges.validation, 2);
  const modelList = models();
  const exitList = exits();
  const cache = new Map<string, Candidate[]>();
  const getCandidates = (model: Model, range: Range) => {
    const key = `${model.id}:${range.start}:${range.end}`;
    if (!cache.has(key)) cache.set(key, buildCandidates(data, model, range));
    return cache.get(key)!;
  };

  const legacyExit: Exit = { id: "ATR_TP4_SL1.25_48H", hold: 48, stopAtr: 1.25, takeAtr: 4 };
  const legacyBenchmark = {
    development: evaluate(buildLegacyBreakoutCandidates(data, ranges.development), "BREAKOUT_168_BALANCED_V1", legacyExit, data, ranges.development.end),
    validation: evaluate(buildLegacyBreakoutCandidates(data, ranges.validation), "BREAKOUT_168_BALANCED_V1", legacyExit, data, ranges.validation.end),
  };

  const stabilityResults: StabilityEvaluation[] = [];
  for (const model of modelList) {
    for (const exit of exitList) {
      const aggregate = evaluate(getCandidates(model, ranges.development), model.id, exit, data, ranges.development.end);
      const folds = developmentFolds.map((fold) => evaluate(getCandidates(model, fold), model.id, exit, data, fold.end));
      const foldAverages = folds.map((fold) => fold.metrics.averagePct).filter((value): value is number => value != null);
      const foldProfitFactors = folds.map((fold) => fold.metrics.profitFactor).filter((value): value is number => value != null);
      const item: StabilityEvaluation = {
        aggregate,
        folds,
        positiveFolds: folds.filter((fold) => fold.metrics.count >= 2 && (fold.metrics.averagePct ?? -1) > 0 && (fold.metrics.profitFactor ?? 0) >= 1).length,
        nonNegativeStressFolds: folds.filter((fold) => fold.metrics.count >= 2 && (fold.metrics.stressAveragePct ?? -1) >= 0).length,
        minimumFoldAveragePct: foldAverages.length ? round(Math.min(...foldAverages)) : null,
        medianFoldAveragePct: foldAverages.length ? round(median(foldAverages)) : null,
        minimumFoldProfitFactor: foldProfitFactors.length ? round(Math.min(...foldProfitFactors), 3) : null,
        score: 0,
      };
      item.score = round(stabilityScore(item), 6);
      stabilityResults.push(item);
    }
  }

  const developmentStable = stabilityResults.filter(developmentPass).sort((left, right) => right.score - left.score);
  const bestByModel = new Map<string, StabilityEvaluation>();
  for (const item of developmentStable) {
    if (!bestByModel.has(item.aggregate.modelId)) bestByModel.set(item.aggregate.modelId, item);
  }
  const bestPerModel = [...bestByModel.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  const validationDiagnostics: ValidationEvaluation[] = bestPerModel.map((development) => {
    const model = modelList.find((item) => item.id === development.aggregate.modelId)!;
    const validation = evaluate(getCandidates(model, ranges.validation), model.id, development.aggregate.exit, data, ranges.validation.end);
    const halves = validationHalves.map((half) => evaluate(getCandidates(model, half), model.id, development.aggregate.exit, data, half.end));
    return validationResult(development, validation, halves);
  }).sort((left, right) => right.score - left.score);

  const chosen = validationDiagnostics.find((item) => item.passed) ?? null;
  const chosenModel = chosen ? modelList.find((item) => item.id === chosen.validation.modelId)! : null;
  const holdout = chosen && chosenModel
    ? evaluate(getCandidates(chosenModel, ranges.holdout), chosenModel.id, chosen.validation.exit, data, ranges.holdout.end)
    : null;
  const holdoutPassed = Boolean(holdout
    && holdout.metrics.count >= 8
    && (holdout.metrics.averagePct ?? -1) > 0
    && (holdout.metrics.profitFactor ?? 0) >= 1.05
    && (holdout.metrics.stressProfitFactor ?? 0) >= 1
    && (holdout.metrics.maxDrawdownPct ?? -100) >= -20);
  const all = chosen && chosenModel
    ? evaluate(getCandidates(chosenModel, ranges.all), chosenModel.id, chosen.validation.exit, data, ranges.all.end)
    : null;
  const status = !developmentStable.length
    ? "NO_STABLE_DEVELOPMENT_EDGE"
    : !chosen
      ? "NO_ROBUST_IMPROVEMENT"
      : holdoutPassed
        ? "PAPER_CANDIDATE_ONLY"
        : "HOLDOUT_REJECTED";

  const fingerprint = createHash("sha256").update(JSON.stringify({
    source: data.source,
    ranges,
    developmentFolds,
    validationHalves,
    models: modelList,
    exits: exitList,
    bars: ["BTC", ...SYMBOLS].map((symbol) => [symbol, data.bySymbol[symbol]?.length || 0, data.bySymbol[symbol]?.[0]?.ts, data.bySymbol[symbol]?.at(-1)?.ts]),
  })).digest("hex");

  const liveReasons = holdout ? [
    ...(holdout.metrics.count < 100 ? ["Frozen Holdout 100 trades未満"] : []),
    ...SYMBOLS.filter((symbol) => (holdout.metrics.symbolCounts[symbol] || 0) < 30).map((symbol) => `${symbol} OOS ${holdout.metrics.symbolCounts[symbol] || 0}/30 trades`),
    ...((holdout.metrics.winRatePct ?? 0) < 70 ? ["Frozen Holdout勝率70%未達"] : []),
    ...((holdout.metrics.profitFactor ?? 0) < 1.2 ? ["Frozen Holdout PF1.20未達"] : []),
    "Aster実約定Spread/Slippage未検証",
    "Forward Paper未実施",
  ] : ["Validation通過候補なし", "Forward Paper未実施"];

  const result = {
    version: 2,
    generatedAt: new Date().toISOString(),
    strategyId: "STABILITY_CONSENSUS_ROTATION_V2",
    status,
    productionChanged: false,
    realTradingEnabled: false,
    source: {
      fingerprint,
      ranges,
      developmentFolds,
      validationHalves,
      symbols: SYMBOLS,
      models: modelList.length,
      exits: exitList.length,
      combinations: modelList.length * exitList.length,
      developmentStableCount: developmentStable.length,
      validationEvaluatedCount: validationDiagnostics.length,
      validationPassCount: validationDiagnostics.filter((item) => item.passed).length,
      frozenHoldoutEvaluated: holdout !== null,
    },
    architecture: {
      independentFromWin80Signals: true,
      nextBarOpenEntry: true,
      oneGlobalPositionAtATime: true,
      crossSectionalRank: true,
      marketBreadthRequired: true,
      breakoutRetestInsteadOfChase: true,
      developmentFourFoldStabilityRequired: true,
      oneExitPerModelAdvancedToValidation: true,
    },
    legacyBenchmark,
    developmentStableTop10: developmentStable.slice(0, 10),
    validationDiagnostics,
    selected: chosen ? {
      modelId: chosen.validation.modelId,
      exit: chosen.validation.exit,
      development: chosen.development,
      validation: chosen.validation,
      validationHalves: chosen.validationHalves,
      retentionRatio: chosen.retentionRatio,
      frozenHoldout: holdout,
      all,
      holdoutPass: holdoutPassed,
      paperEligible: holdoutPassed,
      liveGatePassed: false,
      liveGateReasons: liveReasons,
    } : null,
    limitations: [
      "同一2025-07-01〜2026-04-07期間内の時系列分割で、完全な将来Forward OOSではありません。",
      "Aster過去Order BookではなくBinance USD-M 1h OHLCV/Fundingを使用しています。",
      "Development内4分割安定性を追加しましたが、短いFoldでは件数が少なく統計誤差が残ります。",
      "HoldoutはValidation通過候補がある場合に限り一度だけ評価します。",
      "本番コード、runner、VPS、.env、実売買フラグは変更していません。",
    ],
  };

  const report = [
    "# STABILITY_CONSENSUS_ROTATION_V2 Research",
    "",
    `- Status: **${status}**`,
    `- Models / exits / combinations: ${modelList.length} / ${exitList.length} / ${modelList.length * exitList.length}`,
    `- Stable Development candidates: ${developmentStable.length}`,
    `- Validation evaluated / passed: ${validationDiagnostics.length} / ${validationDiagnostics.filter((item) => item.passed).length}`,
    `- Frozen Holdout evaluated: ${holdout ? "YES" : "NO"}`,
    "- Production changed: NO",
    "- Real trading: DISABLED",
    "",
    "## Why V2",
    "",
    "V1のDevelopment最良候補はPFが高い一方、中央値がマイナスで少数の大勝に依存していました。V2は追随型Breakoutを避け、Breakout再確認またはPullback回復、BTC整合、市場Breadth、通貨間順位を同時に要求します。さらにDevelopmentを4分割し、3区間以上で正のEdgeが残るモデルだけValidationへ進めます。",
    "",
    "## V1 best-candidate diagnostic",
    "",
    evaluationTable([legacyBenchmark.development, legacyBenchmark.validation]),
    "",
    "## Stable Development candidates",
    "",
    developmentStable.length ? stabilityTable(developmentStable.slice(0, 10)) : "安定性Gateを通過したDevelopment候補はありません。",
    "",
    "## Validation diagnostics",
    "",
    validationDiagnostics.length ? validationTable(validationDiagnostics) : "Validationへ進める候補はありません。",
    "",
    "## Selected",
    "",
    ...(chosen ? [
      `- Model: **${chosen.validation.modelId}**`,
      `- Exit: **${chosen.validation.exit.id}**`,
      `- Frozen Holdout pass: **${holdoutPassed ? "YES" : "NO"}**`,
      `- Paper eligible: **${holdoutPassed ? "YES" : "NO"}**`,
      `- Live gate: **BLOCKED**`,
      `- Reasons: ${liveReasons.join(" / ")}`,
      "",
      evaluationTable([chosen.development.aggregate, chosen.validation, ...(holdout ? [holdout] : [])]),
    ] : ["Development安定性とValidationを連続通過した候補はありませんでした。"]),
    "",
    "## Conclusion",
    "",
    holdoutPassed
      ? "安定性選抜後もValidationとFrozen Holdoutを通過したため、Forward Paper専用候補です。Liveは禁止です。"
      : chosen
        ? "Validation通過後のFrozen Holdoutで再現しなかったため不採用です。"
        : "安定性重視の少数モデルでもValidationまで再現するEdgeは確認できませんでした。Paper・Live採用は禁止です。",
    "",
    "## Limitations",
    "",
    ...result.limitations.map((item) => `- ${item}`),
  ].join("\n");

  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "stability-consensus-rotation-v2.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "stability-consensus-rotation-v2.md"), report, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\n${report}`, "utf8");
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
