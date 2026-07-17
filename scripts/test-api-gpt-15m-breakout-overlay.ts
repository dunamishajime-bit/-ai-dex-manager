import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import type { BacktestResult, Candle1h, EquityPoint } from "../lib/backtest/types";

type Window = { startTs: number; endTs: number };
type IndexedBar = Candle1h & {
  sma7: number;
  sma25: number;
  sma99: number;
  mom20: number;
  mom20Prev: number;
  momAccel: number;
  volAvg20: number;
  volumeRatio: number;
  efficiency6: number;
};
type Pattern = {
  key: string;
  alertLookbackHours: number;
  resistanceBelowMaxPct: number;
  resistanceAboveMaxPct: number;
  minVolTrend: number;
  minMom20: number;
  minMomAccel: number;
  minEfficiency6: number;
  maxOverheatSma25: number;
  requireStackedMa: boolean;
  requireHhHl: boolean;
  monitorMinutes: number;
  entryMode: "prebreak_or_breakout" | "breakout_only" | "prebreak_strict";
  breakoutPct15m: number;
  prebreakDistancePct: number;
  min15mVolumeRatio: number;
  trailActivationPct: number;
  trailRetracePct: number;
  hardStopPct: number;
  lineStopPct: number;
  maxHoldMinutes: number;
  allowedSymbols?: readonly string[];
  baseWeakMode?: "none" | "soft" | "strict";
  baseMom20Max?: number;
  baseMomAccelMax?: number;
};
type CandidateEvent = {
  pattern: string;
  symbol: string;
  baseSymbol: string;
  alertTs: number;
  entryTs: number;
  exitTs: number;
  exitReason: string;
  holdHours: number;
  line: number;
  entryPrice: number;
  exitPrice: number;
  candidateReturnPct: number;
  baseReturnPct: number;
  capital: number;
  candidatePnl: number;
  baseWindowPnl: number;
  deltaPnl: number;
  alertScore: number;
};
type ExtensionEvent = {
  pattern: string;
  symbol: "PENGU";
  baselineExitReason: string;
  originalExitTs: number;
  extensionExitTs: number;
  extensionExitReason: string;
  extraHoldHours: number;
  originalExitPrice: number;
  extensionExitPrice: number;
  extensionReturnPct: number;
  baselineWindowReturnPct: number;
  capital: number;
  extensionPnl: number;
  baselineWindowPnl: number;
  deltaPnl: number;
};

const HOUR_MS = 60 * 60 * 1000;
const MIN15_MS = 15 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 22, 23, 59, 59, 999);
const REPORT_DIR = path.join(process.cwd(), "reports", "api-gpt-15m-breakout-overlay");
const CACHE_DIR = path.join(process.cwd(), ".cache", "api-gpt-15m-breakout-overlay");
const SYMBOLS = ["PENGU", "DOGE", "UNI", "TWT", "INJ", "ETH", "SOL", "AVAX"] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rollingSma(values: readonly number[], index: number, period: number) {
  return index + 1 >= period ? average(values.slice(index + 1 - period, index + 1)) : 0;
}

function indexBars(candles: readonly Candle1h[]): IndexedBar[] {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  return candles.map((candle, index) => {
    const changes = [];
    for (let cursor = Math.max(1, index - 5); cursor <= index; cursor += 1) {
      changes.push(Math.abs(closes[cursor] - closes[cursor - 1]));
    }
    const directMove = index >= 6 ? Math.abs(candle.close - closes[index - 6]) : 0;
    const totalMove = changes.reduce((sum, value) => sum + value, 0);
    const mom20 = index >= 20 ? candle.close / closes[index - 20] - 1 : 0;
    const mom20Prev = index >= 21 ? closes[index - 1] / closes[index - 21] - 1 : 0;
    const volAvg20 = index >= 19 ? average(volumes.slice(index - 19, index + 1)) : 0;
    return {
      ...candle,
      sma7: rollingSma(closes, index, 7),
      sma25: rollingSma(closes, index, 25),
      sma99: rollingSma(closes, index, 99),
      mom20,
      mom20Prev,
      momAccel: mom20 - mom20Prev,
      volAvg20,
      volumeRatio: volAvg20 > 0 ? candle.volume / volAvg20 : 0,
      efficiency6: totalMove > 0 ? directMove / totalMove : 0,
    };
  });
}

function asBinanceUrl(symbol: string, interval: string, startMs: number, endMs: number) {
  return `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
}

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number) {
  const cacheFile = path.join(CACHE_DIR, `${symbol}-${interval}-${startMs}-${endMs}.json`);
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8")) as Candle1h[];
  } catch {
    const all: Candle1h[] = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const response = await fetch(asBinanceUrl(symbol, interval, cursor, endMs), { cache: "no-store" });
      if (!response.ok) throw new Error(`Binance klines failed: ${symbol} ${interval} ${response.status}`);
      const rows = await response.json() as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) continue;
        all.push({
          ts: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        });
      }
      const last = rows.at(-1);
      const nextTs = Number(Array.isArray(last) ? last[6] : 0) + 1;
      if (!Number.isFinite(nextTs) || nextTs <= cursor) break;
      cursor = nextTs;
    }
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(all), "utf8");
    return all.sort((left, right) => left.ts - right.ts);
  }
}

function buildCashOnlyWindows(points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>) {
  const cashPoints = points
    .filter((point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash")
    .sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }
    if (prev != null && point.ts - prev <= STEP_MS) {
      prev = point.ts;
      continue;
    }
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
    start = point.ts;
    prev = point.ts;
  }
  if (start != null) windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  return windows;
}

function invertWindows(windows: readonly Window[], startTs: number, endTs: number) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;
  for (const window of sorted) {
    if (window.startTs > cursor) inverted.push({ startTs: cursor, endTs: window.startTs });
    cursor = Math.max(cursor, window.endTs);
  }
  if (cursor < endTs) inverted.push({ startTs: cursor, endTs });
  return inverted.filter((window) => window.endTs > window.startTs);
}

function applyCashOnlyUniTwt(base: HybridVariantOptions, nonCashWindows: readonly Window[]) {
  return {
    ...base,
    expandedTrendSymbols: [...new Set([...(base.expandedTrendSymbols ?? []), "UNI", "TWT"])],
    trendBreakoutLookbackBarsBySymbol: { ...(base.trendBreakoutLookbackBarsBySymbol ?? {}), UNI: 8, TWT: 8 },
    trendBreakoutMinPctBySymbol: { ...(base.trendBreakoutMinPctBySymbol ?? {}), UNI: 0.012, TWT: 0.012 },
    trendMinVolumeRatioBySymbol: { ...(base.trendMinVolumeRatioBySymbol ?? {}), UNI: 1.01, TWT: 1.01 },
    trendMinMomAccelBySymbol: { ...(base.trendMinMomAccelBySymbol ?? {}), UNI: 0.0005, TWT: 0.0005 },
    trendMinEfficiencyRatioBySymbol: { ...(base.trendMinEfficiencyRatioBySymbol ?? {}), UNI: 0.17, TWT: 0.17 },
    trendPrioritySymbols: ["TWT"],
    trendPriorityMaxScoreGap: null,
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
    trendSymbolBlockWindows: { ...(base.trendSymbolBlockWindows ?? {}), UNI: nonCashWindows, TWT: nonCashWindows },
  } satisfies HybridVariantOptions;
}

function findIndexAtOrAfter(candles: readonly Candle1h[], ts: number) {
  let lo = 0;
  let hi = candles.length - 1;
  let best = candles.length;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid].ts >= ts) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

function priceAtOrBefore(candles: readonly Candle1h[], ts: number) {
  let lo = 0;
  let hi = candles.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? candles[best].close : null;
}

function equityAtOrBefore(points: readonly EquityPoint[], ts: number) {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? points[best].equity : 10_000;
}

function alertLine(bars1h: readonly IndexedBar[], index: number, pattern: Pattern) {
  const current = bars1h[index];
  if (!current || index < Math.max(120, pattern.alertLookbackHours + 1)) return null;
  if (current.sma7 <= 0 || current.sma25 <= 0 || current.sma99 <= 0) return null;
  const previous = bars1h[index - 1];
  const recent = bars1h.slice(index - pattern.alertLookbackHours, index);
  const line = Math.max(...recent.map((bar) => bar.high));
  const distance = current.close / line - 1;
  const closeNearResistance = distance >= -pattern.resistanceBelowMaxPct && distance <= pattern.resistanceAboveMaxPct;
  const stacked = current.sma7 > current.sma25 && (!pattern.requireStackedMa || current.sma25 > current.sma99);
  const maUp = current.sma7 > bars1h[index - 4].sma7 && current.sma25 > bars1h[index - 8].sma25;
  const aboveSma = current.close > current.sma25;
  const recentVolume = average(bars1h.slice(index - 6, index + 1).map((bar) => bar.volume));
  const previousVolume = average(bars1h.slice(index - 24, index - 6).map((bar) => bar.volume));
  const volumeTrend = previousVolume > 0 ? recentVolume / previousVolume : 0;
  const recentHigh = Math.max(...bars1h.slice(index - 12, index + 1).map((bar) => bar.high));
  const priorHigh = Math.max(...bars1h.slice(index - 24, index - 12).map((bar) => bar.high));
  const recentLow = Math.min(...bars1h.slice(index - 12, index + 1).map((bar) => bar.low));
  const priorLow = Math.min(...bars1h.slice(index - 24, index - 12).map((bar) => bar.low));
  const hhhl = recentHigh > priorHigh && recentLow > priorLow;
  const improving = current.mom20 > pattern.minMom20 &&
    current.momAccel > pattern.minMomAccel &&
    current.efficiency6 > pattern.minEfficiency6 &&
    current.mom20 > previous.mom20Prev;
  const overheatOk = current.close / current.sma25 - 1 <= pattern.maxOverheatSma25;
  const ok = closeNearResistance &&
    stacked &&
    maUp &&
    aboveSma &&
    volumeTrend >= pattern.minVolTrend &&
    (!pattern.requireHhHl || hhhl) &&
    improving &&
    overheatOk;
  if (!ok) return null;
  const alertScore = (1 - Math.abs(distance)) * 20 + volumeTrend * 8 + current.mom20 * 100 + current.efficiency6 * 10 + (hhhl ? 8 : 0);
  return { line, alertScore };
}

function find15mEntry(bars15m: readonly IndexedBar[], alertTs: number, line: number, pattern: Pattern) {
  const startIndex = findIndexAtOrAfter(bars15m, alertTs);
  const endTs = alertTs + pattern.monitorMinutes * 60 * 1000;
  const endIndex = Math.min(bars15m.length - 2, findIndexAtOrAfter(bars15m, endTs));
  for (let index = startIndex; index <= endIndex; index += 1) {
    const bar = bars15m[index];
    const prev = bars15m[index - 1];
    if (!bar || !prev || bar.sma25 <= 0) continue;
    const prebreak = bar.close < line &&
      line / bar.close - 1 <= pattern.prebreakDistancePct &&
      bar.close > bar.open &&
      bar.close > bar.sma25 &&
      bar.sma7 > bar.sma25 &&
      bar.volumeRatio >= pattern.min15mVolumeRatio;
    const breakout = bar.close > line * (1 + pattern.breakoutPct15m) &&
      prev.close <= line * (1 + pattern.breakoutPct15m * 0.5) &&
      bar.volumeRatio >= pattern.min15mVolumeRatio;
    const enabled = pattern.entryMode === "breakout_only"
      ? breakout
      : pattern.entryMode === "prebreak_strict"
        ? prebreak && bar.low > bars15m[Math.max(0, index - 4)].low
        : prebreak || breakout;
    if (enabled) {
      const next = bars15m[index + 1];
      return next ? { index: index + 1, price: next.open, reason: breakout ? "15m-breakout" : "15m-prebreak" } : null;
    }
  }
  return null;
}

function find15mExit(bars15m: readonly IndexedBar[], entryIndex: number, entryPrice: number, line: number, pattern: Pattern) {
  let peak = entryPrice;
  const maxIndex = Math.min(bars15m.length - 1, entryIndex + Math.round(pattern.maxHoldMinutes / 15));
  for (let index = entryIndex + 1; index <= maxIndex; index += 1) {
    const bar = bars15m[index];
    peak = Math.max(peak, bar.high);
    const trailArmed = peak / entryPrice - 1 >= pattern.trailActivationPct;
    const trailExit = trailArmed && bar.close <= peak * (1 - pattern.trailRetracePct);
    const hardStop = bar.close <= entryPrice * (1 - pattern.hardStopPct);
    const lineStop = bar.close <= line * (1 - pattern.lineStopPct);
    const timedOut = index === maxIndex;
    if (trailExit || hardStop || lineStop || timedOut) {
      const next = bars15m[Math.min(index + 1, bars15m.length - 1)];
      return {
        index: Math.min(index + 1, bars15m.length - 1),
        price: next.open,
        reason: trailExit ? "profit-trail" : hardStop ? "hard-stop" : lineStop ? "line-break" : "max-hold",
      };
    }
  }
  return { index: maxIndex, price: bars15m[maxIndex].close, reason: "max-hold" };
}

function findPenguExtensionExit(bars15m: readonly IndexedBar[], startIndex: number, startPrice: number, pattern: Pattern) {
  let peak = startPrice;
  const maxIndex = Math.min(bars15m.length - 1, startIndex + Math.round(pattern.maxHoldMinutes / 15));
  for (let index = startIndex + 1; index <= maxIndex; index += 1) {
    const bar = bars15m[index];
    const prev = bars15m[index - 1];
    peak = Math.max(peak, bar.high);
    const trailArmed = peak / startPrice - 1 >= pattern.trailActivationPct;
    const trailExit = trailArmed && bar.close <= peak * (1 - pattern.trailRetracePct);
    const hardStop = bar.close <= startPrice * (1 - pattern.hardStopPct);
    const trendFade = bar.sma25 > 0 && prev.sma25 > 0 &&
      bar.close < bar.sma25 &&
      bar.sma7 < bar.sma25 &&
      bar.momAccel < 0;
    const timedOut = index === maxIndex;
    if (trailExit || hardStop || trendFade || timedOut) {
      const next = bars15m[Math.min(index + 1, bars15m.length - 1)];
      return {
        index: Math.min(index + 1, bars15m.length - 1),
        price: next.open,
        reason: trailExit ? "profit-trail" : hardStop ? "hard-stop" : trendFade ? "trend-fade" : "max-hold",
      };
    }
  }
  return { index: maxIndex, price: bars15m[maxIndex].close, reason: "max-hold" };
}

function isPenguStillStrong(bars1h: readonly IndexedBar[], ts: number, pattern: Pattern) {
  const index = Math.min(findIndexAtOrAfter(bars1h, ts), bars1h.length - 1);
  const bar = bars1h[index];
  if (!bar || index < 120 || bar.sma25 <= 0 || bar.sma99 <= 0) return false;
  const recentVolume = average(bars1h.slice(Math.max(0, index - 6), index + 1).map((item) => item.volume));
  const previousVolume = average(bars1h.slice(Math.max(0, index - 24), Math.max(0, index - 6)).map((item) => item.volume));
  const volumeTrend = previousVolume > 0 ? recentVolume / previousVolume : 0;
  return bar.close > bar.sma25 &&
    bar.sma7 > bar.sma25 &&
    bar.sma25 > bars1h[Math.max(0, index - 8)].sma25 &&
    bar.mom20 >= pattern.minMom20 &&
    bar.efficiency6 >= pattern.minEfficiency6 &&
    volumeTrend >= pattern.minVolTrend &&
    bar.close / bar.sma25 - 1 <= pattern.maxOverheatSma25;
}

function baseWeakOk(baseBars: readonly IndexedBar[], ts: number, pattern: Pattern) {
  if (!pattern.baseWeakMode || pattern.baseWeakMode === "none") return true;
  const index = findIndexAtOrAfter(baseBars, ts);
  const bar = baseBars[Math.min(index, baseBars.length - 1)];
  if (!bar || bar.sma25 <= 0) return false;
  const mom20Max = pattern.baseMom20Max ?? 0.12;
  const accelMax = pattern.baseMomAccelMax ?? 0.005;
  const soft = bar.mom20 <= mom20Max || bar.momAccel <= accelMax || bar.close < bar.sma25;
  const strict = (bar.mom20 <= mom20Max && bar.momAccel <= accelMax) || bar.close < bar.sma25;
  return pattern.baseWeakMode === "strict" ? strict : soft;
}

function simulatePattern(input: {
  pattern: Pattern;
  baseline: BacktestResult;
  hourly: Map<string, IndexedBar[]>;
  min15: Map<string, IndexedBar[]>;
  raw1h: Map<string, Candle1h[]>;
}) {
  const events: CandidateEvent[] = [];
  let blockedUntil = START_TS;
  for (const pair of input.baseline.trade_pairs) {
    const pairStart = Date.parse(pair.entry_time);
    const pairEnd = Date.parse(pair.exit_time);
    if (!Number.isFinite(pairStart) || !Number.isFinite(pairEnd) || pairEnd <= pairStart || pairEnd <= blockedUntil) continue;
    let best: CandidateEvent | null = null;
    for (const symbol of SYMBOLS) {
      if (symbol === pair.symbol) continue;
      if (input.pattern.allowedSymbols && !input.pattern.allowedSymbols.includes(symbol)) continue;
      const oneHour = input.hourly.get(symbol) ?? [];
      const fifteen = input.min15.get(symbol) ?? [];
      const baseBars = input.hourly.get(pair.symbol) ?? [];
      const startIndex = findIndexAtOrAfter(oneHour, Math.max(pairStart, blockedUntil));
      const endIndex = findIndexAtOrAfter(oneHour, pairEnd);
      for (let index = startIndex; index < endIndex; index += 1) {
        const alert = alertLine(oneHour, index, input.pattern);
        if (!alert) continue;
        if (!baseWeakOk(baseBars, oneHour[index].ts, input.pattern)) continue;
        const entry = find15mEntry(fifteen, oneHour[index].ts, alert.line, input.pattern);
        if (!entry || fifteen[entry.index].ts >= pairEnd) continue;
        const exit = find15mExit(fifteen, entry.index, entry.price, alert.line, input.pattern);
        const exitTs = fifteen[exit.index].ts;
        const baseRaw = input.raw1h.get(pair.symbol) ?? [];
        const baseEntryPrice = priceAtOrBefore(baseRaw, fifteen[entry.index].ts);
        const baseExitPrice = priceAtOrBefore(baseRaw, exitTs);
        if (!baseEntryPrice || !baseExitPrice) continue;
        const capital = equityAtOrBefore(input.baseline.equity_curve, fifteen[entry.index].ts);
        const candidateReturn = exit.price / entry.price - 1 - FEE_RATE * 2;
        const baseReturn = baseExitPrice / baseEntryPrice - 1;
        const event: CandidateEvent = {
          pattern: input.pattern.key,
          symbol,
          baseSymbol: pair.symbol,
          alertTs: oneHour[index].ts,
          entryTs: fifteen[entry.index].ts,
          exitTs,
          exitReason: exit.reason,
          holdHours: round((exitTs - fifteen[entry.index].ts) / HOUR_MS, 2),
          line: alert.line,
          entryPrice: entry.price,
          exitPrice: exit.price,
          candidateReturnPct: candidateReturn * 100,
          baseReturnPct: baseReturn * 100,
          capital,
          candidatePnl: capital * candidateReturn,
          baseWindowPnl: capital * baseReturn,
          deltaPnl: capital * (candidateReturn - baseReturn),
          alertScore: alert.alertScore,
        };
        if (!best || event.entryTs < best.entryTs || (event.entryTs === best.entryTs && event.alertScore > best.alertScore)) {
          best = event;
        }
        break;
      }
    }
    if (best) {
      events.push(best);
      blockedUntil = best.exitTs;
    }
  }
  return {
    key: input.pattern.key,
    eventCount: events.length,
    adjustedEndEquityApprox: input.baseline.summary.end_equity + events.reduce((sum, event) => sum + event.deltaPnl, 0),
    totalDeltaPnl: events.reduce((sum, event) => sum + event.deltaPnl, 0),
    totalCandidatePnl: events.reduce((sum, event) => sum + event.candidatePnl, 0),
    totalBaseWindowPnl: events.reduce((sum, event) => sum + event.baseWindowPnl, 0),
    avgHoldHours: events.length ? average(events.map((event) => event.holdHours)) : 0,
    winEvents: events.filter((event) => event.deltaPnl > 0).length,
    bySymbol: Object.fromEntries(SYMBOLS.map((symbol) => [
      symbol,
      round(events.filter((event) => event.symbol === symbol).reduce((sum, event) => sum + event.deltaPnl, 0)),
    ])),
    events,
  };
}

function simulatePenguHoldExtension(input: {
  pattern: Pattern;
  baseline: BacktestResult;
  hourly: Map<string, IndexedBar[]>;
  min15: Map<string, IndexedBar[]>;
}) {
  const events: ExtensionEvent[] = [];
  const pengu1h = input.hourly.get("PENGU") ?? [];
  const pengu15m = input.min15.get("PENGU") ?? [];
  for (const pair of input.baseline.trade_pairs.filter((item) => item.symbol === "PENGU")) {
    const exitTs = Date.parse(pair.exit_time);
    if (!Number.isFinite(exitTs) || !isPenguStillStrong(pengu1h, exitTs, input.pattern)) continue;
    const startIndex = findIndexAtOrAfter(pengu15m, exitTs);
    if (startIndex >= pengu15m.length - 1) continue;
    const startPrice = pengu15m[startIndex].open || pair.exit_price;
    const exit = findPenguExtensionExit(pengu15m, startIndex, startPrice, input.pattern);
    if (exit.index <= startIndex) continue;
    const extensionExitTs = pengu15m[exit.index].ts;
    const capital = equityAtOrBefore(input.baseline.equity_curve, exitTs);
    const baselineStartEquity = equityAtOrBefore(input.baseline.equity_curve, exitTs);
    const baselineEndEquity = equityAtOrBefore(input.baseline.equity_curve, extensionExitTs);
    const extensionReturn = exit.price / startPrice - 1 - FEE_RATE;
    const baselineWindowPnl = baselineEndEquity - baselineStartEquity;
    const extensionPnl = capital * extensionReturn;
    events.push({
      pattern: input.pattern.key,
      symbol: "PENGU",
      baselineExitReason: pair.exit_reason,
      originalExitTs: exitTs,
      extensionExitTs,
      extensionExitReason: exit.reason,
      extraHoldHours: round((extensionExitTs - exitTs) / HOUR_MS, 2),
      originalExitPrice: startPrice,
      extensionExitPrice: exit.price,
      extensionReturnPct: extensionReturn * 100,
      baselineWindowReturnPct: baselineStartEquity > 0 ? (baselineWindowPnl / baselineStartEquity) * 100 : 0,
      capital,
      extensionPnl,
      baselineWindowPnl,
      deltaPnl: extensionPnl - baselineWindowPnl,
    });
  }
  return {
    key: `${input.pattern.key}_pengu_hold_extension`,
    eventCount: events.length,
    adjustedEndEquityApprox: input.baseline.summary.end_equity + events.reduce((sum, event) => sum + event.deltaPnl, 0),
    totalDeltaPnl: events.reduce((sum, event) => sum + event.deltaPnl, 0),
    totalExtensionPnl: events.reduce((sum, event) => sum + event.extensionPnl, 0),
    totalBaselineWindowPnl: events.reduce((sum, event) => sum + event.baselineWindowPnl, 0),
    avgExtraHoldHours: events.length ? average(events.map((event) => event.extraHoldHours)) : 0,
    winEvents: events.filter((event) => event.deltaPnl > 0).length,
    events,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const production = applyCashOnlyUniTwt(base, invertWindows(buildCashOnlyWindows(decisionWindow), START_TS, END_TS));
  const baseline = await runHybridBacktest("RETQ22", { ...production, label: "current_v7_api_gpt_15m_base" });

  const raw1h = new Map<string, Candle1h[]>();
  const hourly = new Map<string, IndexedBar[]>();
  const min15 = new Map<string, IndexedBar[]>();
  const needed = Array.from(new Set([...SYMBOLS, ...baseline.trade_pairs.map((pair) => pair.symbol)]));
  for (const symbol of needed) {
    const oneHour = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      cacheRoot: CACHE_DIR,
      startMs: START_TS,
      endMs: END_TS,
    });
    raw1h.set(symbol, oneHour);
    hourly.set(symbol, indexBars(oneHour));
    min15.set(symbol, indexBars(await fetchKlines(`${symbol}USDT`, "15m", START_TS, END_TS)));
  }

  const patterns: Pattern[] = [
    {
      key: "a_balanced_prebreak_breakout",
      alertLookbackHours: 72,
      resistanceBelowMaxPct: 0.035,
      resistanceAboveMaxPct: 0.018,
      minVolTrend: 1.08,
      minMom20: 0.035,
      minMomAccel: 0.001,
      minEfficiency6: 0.28,
      maxOverheatSma25: 0.16,
      requireStackedMa: false,
      requireHhHl: true,
      monitorMinutes: 360,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.002,
      prebreakDistancePct: 0.018,
      min15mVolumeRatio: 1.1,
      trailActivationPct: 0.075,
      trailRetracePct: 0.045,
      hardStopPct: 0.045,
      lineStopPct: 0.03,
      maxHoldMinutes: 2880,
    },
    {
      key: "b_strict_breakout_after_confirm",
      alertLookbackHours: 96,
      resistanceBelowMaxPct: 0.025,
      resistanceAboveMaxPct: 0.012,
      minVolTrend: 1.18,
      minMom20: 0.05,
      minMomAccel: 0.004,
      minEfficiency6: 0.34,
      maxOverheatSma25: 0.12,
      requireStackedMa: true,
      requireHhHl: true,
      monitorMinutes: 300,
      entryMode: "breakout_only",
      breakoutPct15m: 0.0035,
      prebreakDistancePct: 0.012,
      min15mVolumeRatio: 1.25,
      trailActivationPct: 0.08,
      trailRetracePct: 0.05,
      hardStopPct: 0.04,
      lineStopPct: 0.025,
      maxHoldMinutes: 2160,
    },
    {
      key: "c_early_watch_prebreak",
      alertLookbackHours: 48,
      resistanceBelowMaxPct: 0.055,
      resistanceAboveMaxPct: 0.025,
      minVolTrend: 1.02,
      minMom20: 0.02,
      minMomAccel: -0.002,
      minEfficiency6: 0.22,
      maxOverheatSma25: 0.2,
      requireStackedMa: false,
      requireHhHl: false,
      monitorMinutes: 720,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.0015,
      prebreakDistancePct: 0.028,
      min15mVolumeRatio: 1.0,
      trailActivationPct: 0.065,
      trailRetracePct: 0.045,
      hardStopPct: 0.05,
      lineStopPct: 0.035,
      maxHoldMinutes: 2880,
    },
    {
      key: "d_prebreak_strict_hhhl",
      alertLookbackHours: 72,
      resistanceBelowMaxPct: 0.04,
      resistanceAboveMaxPct: 0.008,
      minVolTrend: 1.12,
      minMom20: 0.035,
      minMomAccel: 0.002,
      minEfficiency6: 0.3,
      maxOverheatSma25: 0.13,
      requireStackedMa: true,
      requireHhHl: true,
      monitorMinutes: 480,
      entryMode: "prebreak_strict",
      breakoutPct15m: 0.002,
      prebreakDistancePct: 0.02,
      min15mVolumeRatio: 1.08,
      trailActivationPct: 0.07,
      trailRetracePct: 0.045,
      hardStopPct: 0.04,
      lineStopPct: 0.028,
      maxHoldMinutes: 2160,
    },
    {
      key: "e_balanced_only_when_current_soft_weak",
      alertLookbackHours: 72,
      resistanceBelowMaxPct: 0.035,
      resistanceAboveMaxPct: 0.018,
      minVolTrend: 1.08,
      minMom20: 0.035,
      minMomAccel: 0.001,
      minEfficiency6: 0.28,
      maxOverheatSma25: 0.16,
      requireStackedMa: false,
      requireHhHl: true,
      monitorMinutes: 360,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.002,
      prebreakDistancePct: 0.018,
      min15mVolumeRatio: 1.1,
      trailActivationPct: 0.075,
      trailRetracePct: 0.045,
      hardStopPct: 0.045,
      lineStopPct: 0.03,
      maxHoldMinutes: 2880,
      baseWeakMode: "soft",
      baseMom20Max: 0.10,
      baseMomAccelMax: 0.004,
    },
    {
      key: "f_balanced_pengu_twt_inj_when_current_weak",
      alertLookbackHours: 72,
      resistanceBelowMaxPct: 0.035,
      resistanceAboveMaxPct: 0.018,
      minVolTrend: 1.08,
      minMom20: 0.035,
      minMomAccel: 0.001,
      minEfficiency6: 0.28,
      maxOverheatSma25: 0.16,
      requireStackedMa: false,
      requireHhHl: true,
      monitorMinutes: 360,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.002,
      prebreakDistancePct: 0.018,
      min15mVolumeRatio: 1.1,
      trailActivationPct: 0.075,
      trailRetracePct: 0.045,
      hardStopPct: 0.045,
      lineStopPct: 0.03,
      maxHoldMinutes: 2880,
      allowedSymbols: ["PENGU", "TWT", "INJ"],
      baseWeakMode: "soft",
      baseMom20Max: 0.10,
      baseMomAccelMax: 0.004,
    },
    {
      key: "g_balanced_only_when_current_strict_weak",
      alertLookbackHours: 72,
      resistanceBelowMaxPct: 0.035,
      resistanceAboveMaxPct: 0.018,
      minVolTrend: 1.08,
      minMom20: 0.035,
      minMomAccel: 0.001,
      minEfficiency6: 0.28,
      maxOverheatSma25: 0.16,
      requireStackedMa: false,
      requireHhHl: true,
      monitorMinutes: 360,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.002,
      prebreakDistancePct: 0.018,
      min15mVolumeRatio: 1.1,
      trailActivationPct: 0.075,
      trailRetracePct: 0.045,
      hardStopPct: 0.045,
      lineStopPct: 0.03,
      maxHoldMinutes: 2880,
      baseWeakMode: "strict",
      baseMom20Max: 0.08,
      baseMomAccelMax: 0.002,
    },
    {
      key: "h_pengu_only_balanced_prebreak_breakout",
      alertLookbackHours: 72,
      resistanceBelowMaxPct: 0.035,
      resistanceAboveMaxPct: 0.018,
      minVolTrend: 1.08,
      minMom20: 0.035,
      minMomAccel: 0.001,
      minEfficiency6: 0.28,
      maxOverheatSma25: 0.16,
      requireStackedMa: false,
      requireHhHl: true,
      monitorMinutes: 360,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.002,
      prebreakDistancePct: 0.018,
      min15mVolumeRatio: 1.1,
      trailActivationPct: 0.075,
      trailRetracePct: 0.045,
      hardStopPct: 0.045,
      lineStopPct: 0.03,
      maxHoldMinutes: 2880,
      allowedSymbols: ["PENGU"],
    },
    {
      key: "i_pengu_only_when_current_soft_weak",
      alertLookbackHours: 72,
      resistanceBelowMaxPct: 0.035,
      resistanceAboveMaxPct: 0.018,
      minVolTrend: 1.08,
      minMom20: 0.035,
      minMomAccel: 0.001,
      minEfficiency6: 0.28,
      maxOverheatSma25: 0.16,
      requireStackedMa: false,
      requireHhHl: true,
      monitorMinutes: 360,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.002,
      prebreakDistancePct: 0.018,
      min15mVolumeRatio: 1.1,
      trailActivationPct: 0.075,
      trailRetracePct: 0.045,
      hardStopPct: 0.045,
      lineStopPct: 0.03,
      maxHoldMinutes: 2880,
      allowedSymbols: ["PENGU"],
      baseWeakMode: "soft",
      baseMom20Max: 0.10,
      baseMomAccelMax: 0.004,
    },
    {
      key: "j_pengu_only_breakout_confirm",
      alertLookbackHours: 96,
      resistanceBelowMaxPct: 0.025,
      resistanceAboveMaxPct: 0.012,
      minVolTrend: 1.18,
      minMom20: 0.05,
      minMomAccel: 0.004,
      minEfficiency6: 0.34,
      maxOverheatSma25: 0.12,
      requireStackedMa: true,
      requireHhHl: true,
      monitorMinutes: 300,
      entryMode: "breakout_only",
      breakoutPct15m: 0.0035,
      prebreakDistancePct: 0.012,
      min15mVolumeRatio: 1.25,
      trailActivationPct: 0.08,
      trailRetracePct: 0.05,
      hardStopPct: 0.04,
      lineStopPct: 0.025,
      maxHoldMinutes: 2160,
      allowedSymbols: ["PENGU"],
    },
    {
      key: "k_pengu_only_early_watch",
      alertLookbackHours: 48,
      resistanceBelowMaxPct: 0.055,
      resistanceAboveMaxPct: 0.025,
      minVolTrend: 1.02,
      minMom20: 0.02,
      minMomAccel: -0.002,
      minEfficiency6: 0.22,
      maxOverheatSma25: 0.2,
      requireStackedMa: false,
      requireHhHl: false,
      monitorMinutes: 720,
      entryMode: "prebreak_or_breakout",
      breakoutPct15m: 0.0015,
      prebreakDistancePct: 0.028,
      min15mVolumeRatio: 1.0,
      trailActivationPct: 0.065,
      trailRetracePct: 0.045,
      hardStopPct: 0.05,
      lineStopPct: 0.035,
      maxHoldMinutes: 2880,
      allowedSymbols: ["PENGU"],
    },
  ];

  const results = patterns.map((pattern) => simulatePattern({ pattern, baseline, hourly, min15, raw1h }));
  const penguExtensionPatterns = patterns.filter((pattern) => ["h_pengu_only_balanced_prebreak_breakout", "j_pengu_only_breakout_confirm", "k_pengu_only_early_watch"].includes(pattern.key));
  const extensionResults = penguExtensionPatterns.map((pattern) => simulatePenguHoldExtension({ pattern, baseline, hourly, min15 }));
  const rows = results.map((result) => ({
    key: result.key,
    events: result.eventCount,
    adjustedEndEquityApprox: round(result.adjustedEndEquityApprox),
    deltaPnl: round(result.totalDeltaPnl),
    candidatePnl: round(result.totalCandidatePnl),
    originalHeldPnl: round(result.totalBaseWindowPnl),
    avgHoldHours: round(result.avgHoldHours, 1),
    winEvents: result.winEvents,
    bySymbol: result.bySymbol,
  }));
  const extensionRows = extensionResults.map((result) => ({
    key: result.key,
    events: result.eventCount,
    adjustedEndEquityApprox: round(result.adjustedEndEquityApprox),
    deltaPnl: round(result.totalDeltaPnl),
    extensionPnl: round(result.totalExtensionPnl),
    baselineWindowPnl: round(result.totalBaselineWindowPnl),
    avgExtraHoldHours: round(result.avgExtraHoldHours, 1),
    winEvents: result.winEvents,
  }));
  const recentEvents = results.flatMap((result) => result.events)
    .filter((event) => event.alertTs >= Date.UTC(2026, 3, 17))
    .sort((left, right) => left.alertTs - right.alertTs);
  const largestEvents = results.flatMap((result) => result.events)
    .sort((left, right) => Math.abs(right.deltaPnl) - Math.abs(left.deltaPnl))
    .slice(0, 40);
  const extensionEvents = extensionResults.flatMap((result) => result.events)
    .sort((left, right) => Math.abs(right.deltaPnl) - Math.abs(left.deltaPnl));

  const md = [
    "# API-GPT 15m Breakout Overlay",
    "",
    "Current V7 logic is unchanged. This simulates a GPT/API monitor that promotes symbols from 1H warning to 15m entry monitoring near resistance.",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- baseline_end_equity: ${round(baseline.summary.end_equity)}`,
    `- baseline_max_dd_pct: ${round(baseline.summary.max_drawdown_pct)}`,
    `- baseline_pf: ${round(baseline.summary.profit_factor, 3)}`,
    "",
    "## Summary",
    "",
    "| pattern | events | approx end equity | delta pnl | monitor pnl | original-held pnl | avg hold h | win events |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.events} | ${row.adjustedEndEquityApprox} | ${row.deltaPnl} | ${row.candidatePnl} | ${row.originalHeldPnl} | ${row.avgHoldHours} | ${row.winEvents} |`),
    "",
    "## PENGU Hold Extension Summary",
    "",
    "| pattern | events | approx end equity | delta pnl | extension pnl | baseline-window pnl | avg extra hold h | win events |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...extensionRows.map((row) => `| ${row.key} | ${row.events} | ${row.adjustedEndEquityApprox} | ${row.deltaPnl} | ${row.extensionPnl} | ${row.baselineWindowPnl} | ${row.avgExtraHoldHours} | ${row.winEvents} |`),
    "",
    "## Delta By Entered Symbol",
    "",
    "| pattern | PENGU | DOGE | UNI | TWT | INJ | ETH | SOL | AVAX |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.bySymbol.PENGU ?? 0} | ${row.bySymbol.DOGE ?? 0} | ${row.bySymbol.UNI ?? 0} | ${row.bySymbol.TWT ?? 0} | ${row.bySymbol.INJ ?? 0} | ${row.bySymbol.ETH ?? 0} | ${row.bySymbol.SOL ?? 0} | ${row.bySymbol.AVAX ?? 0} |`),
    "",
    "## Recent Events Since 2026-04-17",
    "",
    "| pattern | symbol | base | alert | entry | exit | hold h | reason | monitor % | base % | delta pnl |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: |",
    ...recentEvents.map((event) => `| ${event.pattern} | ${event.symbol} | ${event.baseSymbol} | ${new Date(event.alertTs).toISOString()} | ${new Date(event.entryTs).toISOString()} | ${new Date(event.exitTs).toISOString()} | ${event.holdHours} | ${event.exitReason} | ${round(event.candidateReturnPct, 2)} | ${round(event.baseReturnPct, 2)} | ${round(event.deltaPnl)} |`),
    "",
    "## Largest Delta Events",
    "",
    "| pattern | symbol | base | alert | entry | exit | hold h | reason | monitor % | base % | delta pnl |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: |",
    ...largestEvents.map((event) => `| ${event.pattern} | ${event.symbol} | ${event.baseSymbol} | ${new Date(event.alertTs).toISOString()} | ${new Date(event.entryTs).toISOString()} | ${new Date(event.exitTs).toISOString()} | ${event.holdHours} | ${event.exitReason} | ${round(event.candidateReturnPct, 2)} | ${round(event.baseReturnPct, 2)} | ${round(event.deltaPnl)} |`),
    "",
    "## PENGU Hold Extension Events",
    "",
    "| pattern | original exit | extension exit | extra h | original reason | extension reason | extension % | baseline-window % | delta pnl |",
    "| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: |",
    ...extensionEvents.map((event) => `| ${event.pattern} | ${new Date(event.originalExitTs).toISOString()} | ${new Date(event.extensionExitTs).toISOString()} | ${event.extraHoldHours} | ${event.baselineExitReason} | ${event.extensionExitReason} | ${round(event.extensionReturnPct, 2)} | ${round(event.baselineWindowReturnPct, 2)} | ${round(event.deltaPnl)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ baseline: baseline.summary, rows, extensionRows, results, extensionResults }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify({ baseline: baseline.summary, rows, extensionRows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
