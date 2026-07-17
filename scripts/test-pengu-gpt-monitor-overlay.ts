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
import { buildIndicatorBars, latestIndicatorAtOrBefore, resampleTo12h, resampleToHours } from "../lib/backtest/indicators";
import type { BacktestResult, Candle1h, EquityPoint, TradePairRow } from "../lib/backtest/types";

type Window = { startTs: number; endTs: number };
type IndexedCandle = Candle1h & {
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

type MonitorConfig = {
  key: string;
  alertLookbackHours: number;
  breakoutPct: number;
  maxLineExtensionPct: number;
  minVolumeRatio: number;
  minMom20: number;
  minMomAccel: number;
  minEfficiency6: number;
  min4hMom20: number;
  min4hAdx14: number;
  monitorHours: number;
  entryLineBufferPct: number;
  entryRebreakPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  hardStopPct: number;
  lineStopPct: number;
  maxHoldHours: number;
};

type OverlayEvent = {
  variant: string;
  baseSymbol: string;
  baseEntryTime: string;
  baseExitTime: string;
  alertTime: string;
  entryTime: string;
  exitTime: string;
  exitReason: string;
  holdHours: number;
  line: number;
  entryPrice: number;
  exitPrice: number;
  penguReturnPct: number;
  baseReturnPct: number;
  capital: number;
  penguPnl: number;
  baseWindowPnl: number;
  deltaPnl: number;
};

type StandaloneEvent = {
  variant: string;
  alertTime: string;
  entryTime: string;
  exitTime: string;
  exitReason: string;
  holdHours: number;
  line: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  pnlOn10k: number;
};

const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-gpt-monitor-overlay");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 22, 23, 59, 59, 999);
const REPORT_SUFFIX = process.env.BT_START || process.env.BT_END
  ? `-${process.env.BT_START ?? "start"}-${process.env.BT_END ?? "end"}`
  : "";

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rollingSma(values: readonly number[], index: number, period: number) {
  if (index + 1 < period) return 0;
  return average(values.slice(index + 1 - period, index + 1));
}

function index1h(candles: readonly Candle1h[]): IndexedCandle[] {
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
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      UNI: 8,
      TWT: 8,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      UNI: 0.012,
      TWT: 0.012,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      UNI: 1.01,
      TWT: 1.01,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      UNI: 0.0005,
      TWT: 0.0005,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      UNI: 0.17,
      TWT: 0.17,
    },
    trendPrioritySymbols: ["TWT"],
    trendPriorityMaxScoreGap: null,
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
    trendSymbolBlockWindows: {
      ...(base.trendSymbolBlockWindows ?? {}),
      UNI: nonCashWindows,
      TWT: nonCashWindows,
    },
  } satisfies HybridVariantOptions;
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

function shouldAlert(
  pengu: readonly IndexedCandle[],
  index: number,
  config: MonitorConfig,
  trend4h: ReturnType<typeof buildIndicatorBars>,
  trend12h: ReturnType<typeof buildIndicatorBars>,
) {
  const current = pengu[index];
  const previous = pengu[index - 1];
  if (!current || !previous || index < Math.max(120, config.alertLookbackHours + 1)) return null;
  if (current.sma25 <= 0 || current.sma99 <= 0) return null;

  const recent = pengu.slice(index - config.alertLookbackHours, index);
  const line = Math.max(...recent.map((bar) => bar.high));
  const brokeLine = current.close > line * (1 + config.breakoutPct) && previous.close <= line * (1 + config.breakoutPct * 0.5);
  const maUp = current.close > current.sma25 && current.sma7 > current.sma25 && current.sma25 > pengu[index - 6].sma25;
  const notTooLate = current.close / line - 1 <= config.maxLineExtensionPct;
  const momentumOk = current.mom20 >= config.minMom20 && current.momAccel >= config.minMomAccel;
  const volumeOk = current.volumeRatio >= config.minVolumeRatio;
  const efficient = current.efficiency6 >= config.minEfficiency6;
  const bar4h = latestIndicatorAtOrBefore(trend4h, current.ts);
  const bar12h = latestIndicatorAtOrBefore(trend12h, current.ts);
  const largerTrendOk = !!bar4h && !!bar12h &&
    bar4h.ready &&
    bar4h.close > bar4h.sma40 &&
    bar4h.mom20 >= config.min4hMom20 &&
    bar4h.adx14 >= config.min4hAdx14 &&
    bar12h.close > bar12h.sma40;

  return brokeLine && maUp && notTooLate && momentumOk && volumeOk && efficient && largerTrendOk ? line : null;
}

function findEntry(pengu: readonly IndexedCandle[], alertIndex: number, line: number, config: MonitorConfig) {
  const endIndex = Math.min(pengu.length - 2, alertIndex + config.monitorHours);
  for (let index = alertIndex + 1; index <= endIndex; index += 1) {
    const bar = pengu[index];
    const previous = pengu[index - 1];
    const pullbackConfirm = bar.low <= line * (1 + config.entryLineBufferPct) &&
      bar.close >= line * (1 + config.breakoutPct * 0.5) &&
      bar.close > bar.open;
    const rebreakConfirm = bar.close > Math.max(previous.high, line) * (1 + config.entryRebreakPct) &&
      bar.volumeRatio >= Math.max(1.05, config.minVolumeRatio * 0.75);
    if (pullbackConfirm || rebreakConfirm) {
      const next = pengu[index + 1];
      return next ? { index: index + 1, price: next.open, reason: pullbackConfirm ? "pullback-confirm" : "rebreak-confirm" } : null;
    }
  }
  return null;
}

function findExit(pengu: readonly IndexedCandle[], entryIndex: number, entryPrice: number, line: number, config: MonitorConfig) {
  let peak = entryPrice;
  const maxIndex = Math.min(pengu.length - 1, entryIndex + config.maxHoldHours);
  for (let index = entryIndex + 1; index <= maxIndex; index += 1) {
    const bar = pengu[index];
    peak = Math.max(peak, bar.high);
    const trailArmed = peak / entryPrice - 1 >= config.trailActivationPct;
    const trailExit = trailArmed && bar.close <= peak * (1 - config.trailRetracePct);
    const hardStop = bar.close <= entryPrice * (1 - config.hardStopPct);
    const lineStop = bar.close <= line * (1 - config.lineStopPct);
    const timedOut = index === maxIndex;
    if (trailExit || hardStop || lineStop || timedOut) {
      const next = pengu[Math.min(index + 1, pengu.length - 1)];
      const reason = trailExit ? "profit-trail" : hardStop ? "hard-stop" : lineStop ? "line-break" : "max-hold";
      return { index: Math.min(index + 1, pengu.length - 1), price: next.open, reason };
    }
  }
  const finalIndex = Math.min(entryIndex + config.maxHoldHours, pengu.length - 1);
  return { index: finalIndex, price: pengu[finalIndex].close, reason: "max-hold" };
}

function simulateOverlay(input: {
  variant: MonitorConfig;
  baseline: BacktestResult;
  candlesBySymbol: Map<string, Candle1h[]>;
  pengu: IndexedCandle[];
  trend4h: ReturnType<typeof buildIndicatorBars>;
  trend12h: ReturnType<typeof buildIndicatorBars>;
}) {
  const events: OverlayEvent[] = [];
  let blockedUntil = START_TS;
  const eligiblePairs = input.baseline.trade_pairs
    .filter((pair) => !["PENGU", "DOGE"].includes(pair.symbol))
    .sort((left, right) => Date.parse(left.entry_time) - Date.parse(right.entry_time));

  for (const pair of eligiblePairs) {
    const pairStart = Date.parse(pair.entry_time);
    const pairEnd = Date.parse(pair.exit_time);
    if (!Number.isFinite(pairStart) || !Number.isFinite(pairEnd) || pairEnd <= pairStart) continue;
    if (pairEnd <= blockedUntil) continue;

    const startIndex = findIndexAtOrAfter(input.pengu, Math.max(pairStart, blockedUntil));
    const endIndex = findIndexAtOrAfter(input.pengu, pairEnd);
    let selected: OverlayEvent | null = null;

    for (let index = startIndex; index < endIndex; index += 1) {
      const line = shouldAlert(input.pengu, index, input.variant, input.trend4h, input.trend12h);
      if (line == null) continue;
      const entry = findEntry(input.pengu, index, line, input.variant);
      if (!entry || entry.index >= endIndex) continue;
      const exit = findExit(input.pengu, entry.index, entry.price, line, input.variant);
      if (exit.index <= entry.index) continue;

      const baseCandles = input.candlesBySymbol.get(pair.symbol);
      if (!baseCandles) continue;
      const baseEntryPrice = priceAtOrBefore(baseCandles, input.pengu[entry.index].ts);
      const baseExitPrice = priceAtOrBefore(baseCandles, input.pengu[exit.index].ts);
      if (!baseEntryPrice || !baseExitPrice) continue;

      const capital = equityAtOrBefore(input.baseline.equity_curve, input.pengu[entry.index].ts);
      const penguReturn = exit.price / entry.price - 1 - FEE_RATE * 2;
      const baseReturn = baseExitPrice / baseEntryPrice - 1;
      selected = {
        variant: input.variant.key,
        baseSymbol: pair.symbol,
        baseEntryTime: pair.entry_time,
        baseExitTime: pair.exit_time,
        alertTime: new Date(input.pengu[index].ts).toISOString(),
        entryTime: new Date(input.pengu[entry.index].ts).toISOString(),
        exitTime: new Date(input.pengu[exit.index].ts).toISOString(),
        exitReason: exit.reason,
        holdHours: Math.round((input.pengu[exit.index].ts - input.pengu[entry.index].ts) / HOUR_MS),
        line,
        entryPrice: entry.price,
        exitPrice: exit.price,
        penguReturnPct: penguReturn * 100,
        baseReturnPct: baseReturn * 100,
        capital,
        penguPnl: capital * penguReturn,
        baseWindowPnl: capital * baseReturn,
        deltaPnl: capital * (penguReturn - baseReturn),
      };
      break;
    }

    if (selected) {
      events.push(selected);
      blockedUntil = Date.parse(selected.exitTime);
    }
  }

  const delta = events.reduce((sum, event) => sum + event.deltaPnl, 0);
  return {
    key: input.variant.key,
    events,
    eventCount: events.length,
    totalPenguPnl: events.reduce((sum, event) => sum + event.penguPnl, 0),
    totalBaseWindowPnl: events.reduce((sum, event) => sum + event.baseWindowPnl, 0),
    totalDeltaPnl: delta,
    adjustedEndEquityApprox: input.baseline.summary.end_equity + delta,
    avgHoldHours: events.length ? average(events.map((event) => event.holdHours)) : 0,
    winEvents: events.filter((event) => event.deltaPnl > 0).length,
  };
}

function simulateStandalone(input: {
  variant: MonitorConfig;
  pengu: IndexedCandle[];
  trend4h: ReturnType<typeof buildIndicatorBars>;
  trend12h: ReturnType<typeof buildIndicatorBars>;
}) {
  const events: StandaloneEvent[] = [];
  let blockedUntil = START_TS;
  for (let index = findIndexAtOrAfter(input.pengu, START_TS); index < input.pengu.length - 2; index += 1) {
    if (input.pengu[index].ts < blockedUntil) continue;
    const line = shouldAlert(input.pengu, index, input.variant, input.trend4h, input.trend12h);
    if (line == null) continue;
    const entry = findEntry(input.pengu, index, line, input.variant);
    if (!entry) continue;
    const exit = findExit(input.pengu, entry.index, entry.price, line, input.variant);
    const tradeReturn = exit.price / entry.price - 1 - FEE_RATE * 2;
    const event = {
      variant: input.variant.key,
      alertTime: new Date(input.pengu[index].ts).toISOString(),
      entryTime: new Date(input.pengu[entry.index].ts).toISOString(),
      exitTime: new Date(input.pengu[exit.index].ts).toISOString(),
      exitReason: exit.reason,
      holdHours: Math.round((input.pengu[exit.index].ts - input.pengu[entry.index].ts) / HOUR_MS),
      line,
      entryPrice: entry.price,
      exitPrice: exit.price,
      returnPct: tradeReturn * 100,
      pnlOn10k: 10_000 * tradeReturn,
    };
    events.push(event);
    blockedUntil = input.pengu[exit.index].ts;
  }
  return {
    key: input.variant.key,
    events,
    eventCount: events.length,
    totalPnlOn10k: events.reduce((sum, event) => sum + event.pnlOn10k, 0),
    avgHoldHours: events.length ? average(events.map((event) => event.holdHours)) : 0,
    wins: events.filter((event) => event.pnlOn10k > 0).length,
  };
}

function summarizeBaseline(result: BacktestResult) {
  return {
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    PENGU: round(result.summary.symbol_contribution.PENGU ?? 0),
    DOGE: round(result.summary.symbol_contribution.DOGE ?? 0),
    ETH: round(result.summary.symbol_contribution.ETH ?? 0),
    SOL: round(result.summary.symbol_contribution.SOL ?? 0),
    INJ: round(result.summary.symbol_contribution.INJ ?? 0),
    TWT: round(result.summary.symbol_contribution.TWT ?? 0),
  };
}

async function loadCandles(symbol: string) {
  return loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: path.join(process.cwd(), ".cache", "pengu-gpt-monitor-overlay"),
    startMs: START_TS,
    endMs: END_TS,
  });
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const production = applyCashOnlyUniTwt(base, invertWindows(cashOnlyWindows, START_TS, END_TS));
  const baseline = await runHybridBacktest("RETQ22", { ...production, label: "current_v7_production_overlay_base" });

  const symbols = Array.from(new Set(baseline.trade_pairs.map((pair: TradePairRow) => pair.symbol).concat("PENGU")));
  const candlesBySymbol = new Map<string, Candle1h[]>();
  for (const symbol of symbols) {
    candlesBySymbol.set(symbol, await loadCandles(symbol));
  }

  const penguRaw = candlesBySymbol.get("PENGU") ?? [];
  const pengu = index1h(penguRaw);
  const trend4h = buildIndicatorBars(resampleToHours(penguRaw, 4));
  const trend12h = buildIndicatorBars(resampleTo12h(penguRaw));

  const variants: MonitorConfig[] = [
    {
      key: "api_gpt_breakout_balanced_6h_48h",
      alertLookbackHours: 72,
      breakoutPct: 0.004,
      maxLineExtensionPct: 0.08,
      minVolumeRatio: 1.2,
      minMom20: 0.08,
      minMomAccel: 0.01,
      minEfficiency6: 0.42,
      min4hMom20: 0.06,
      min4hAdx14: 20,
      monitorHours: 6,
      entryLineBufferPct: 0.018,
      entryRebreakPct: 0.003,
      trailActivationPct: 0.08,
      trailRetracePct: 0.055,
      hardStopPct: 0.05,
      lineStopPct: 0.025,
      maxHoldHours: 48,
    },
    {
      key: "api_gpt_breakout_patient_12h_72h",
      alertLookbackHours: 72,
      breakoutPct: 0.003,
      maxLineExtensionPct: 0.10,
      minVolumeRatio: 1.1,
      minMom20: 0.06,
      minMomAccel: 0.005,
      minEfficiency6: 0.36,
      min4hMom20: 0.05,
      min4hAdx14: 18,
      monitorHours: 12,
      entryLineBufferPct: 0.022,
      entryRebreakPct: 0.002,
      trailActivationPct: 0.08,
      trailRetracePct: 0.055,
      hardStopPct: 0.055,
      lineStopPct: 0.03,
      maxHoldHours: 72,
    },
    {
      key: "api_gpt_breakout_strict_6h_72h",
      alertLookbackHours: 96,
      breakoutPct: 0.006,
      maxLineExtensionPct: 0.055,
      minVolumeRatio: 1.45,
      minMom20: 0.10,
      minMomAccel: 0.015,
      minEfficiency6: 0.48,
      min4hMom20: 0.08,
      min4hAdx14: 22,
      monitorHours: 6,
      entryLineBufferPct: 0.014,
      entryRebreakPct: 0.004,
      trailActivationPct: 0.10,
      trailRetracePct: 0.055,
      hardStopPct: 0.045,
      lineStopPct: 0.022,
      maxHoldHours: 72,
    },
    {
      key: "api_gpt_breakout_early_12h_48h",
      alertLookbackHours: 48,
      breakoutPct: 0.0025,
      maxLineExtensionPct: 0.12,
      minVolumeRatio: 1.05,
      minMom20: 0.045,
      minMomAccel: 0.002,
      minEfficiency6: 0.32,
      min4hMom20: 0.035,
      min4hAdx14: 16,
      monitorHours: 12,
      entryLineBufferPct: 0.025,
      entryRebreakPct: 0.0015,
      trailActivationPct: 0.075,
      trailRetracePct: 0.055,
      hardStopPct: 0.06,
      lineStopPct: 0.035,
      maxHoldHours: 48,
    },
  ];

  const results = variants.map((variant) => simulateOverlay({
    variant,
    baseline,
    candlesBySymbol,
    pengu,
    trend4h,
    trend12h,
  }));
  const standalone = variants.map((variant) => simulateStandalone({
    variant,
    pengu,
    trend4h,
    trend12h,
  }));

  const rows = results.map((result) => ({
    key: result.key,
    events: result.eventCount,
    adjustedEndEquityApprox: round(result.adjustedEndEquityApprox),
    deltaPnl: round(result.totalDeltaPnl),
    penguPnl: round(result.totalPenguPnl),
    originalHeldPnl: round(result.totalBaseWindowPnl),
    avgHoldHours: round(result.avgHoldHours, 1),
    winEvents: result.winEvents,
  }));

  const topEvents = results.flatMap((result) => result.events)
    .sort((left, right) => Math.abs(right.deltaPnl) - Math.abs(left.deltaPnl))
    .slice(0, 30);
  const recentStandaloneEvents = standalone.flatMap((result) => result.events)
    .filter((event) => Date.parse(event.alertTime) >= Date.UTC(2026, 3, 17))
    .sort((left, right) => Date.parse(left.alertTime) - Date.parse(right.alertTime));
  const standaloneRows = standalone.map((result) => ({
    key: result.key,
    events: result.eventCount,
    totalPnlOn10k: round(result.totalPnlOn10k),
    avgHoldHours: round(result.avgHoldHours, 1),
    wins: result.wins,
  }));

  const md = [
    "# PENGU API-GPT Monitor Overlay",
    "",
    "現行ロジック本体は変更せず、PENGUの1H API監視がアラート後に短時間監視して入った場合の近似オーバーレイです。",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- baseline_end_equity: ${round(baseline.summary.end_equity)}`,
    `- baseline_max_dd_pct: ${round(baseline.summary.max_drawdown_pct)}`,
    `- baseline_pf: ${round(baseline.summary.profit_factor, 3)}`,
    "",
    "## Summary",
    "",
    "| variant | events | approx end equity | delta pnl | PENGU pnl | original-held pnl | avg hold h | win events |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.events} | ${row.adjustedEndEquityApprox} | ${row.deltaPnl} | ${row.penguPnl} | ${row.originalHeldPnl} | ${row.avgHoldHours} | ${row.winEvents} |`),
    "",
    "## Largest Event Details",
    "",
    "| variant | base | alert | entry | exit | hold h | reason | PENGU % | base % | delta pnl |",
    "| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: |",
    ...topEvents.map((event) => `| ${event.variant} | ${event.baseSymbol} | ${event.alertTime} | ${event.entryTime} | ${event.exitTime} | ${event.holdHours} | ${event.exitReason} | ${round(event.penguReturnPct, 2)} | ${round(event.baseReturnPct, 2)} | ${round(event.deltaPnl)} |`),
    "",
    "## PENGU Standalone Monitor",
    "",
    "| variant | events | total pnl on 10k | avg hold h | wins |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...standaloneRows.map((row) => `| ${row.key} | ${row.events} | ${row.totalPnlOn10k} | ${row.avgHoldHours} | ${row.wins} |`),
    "",
    "## Recent Standalone Alerts Since 2026-04-17",
    "",
    "| variant | alert | entry | exit | hold h | reason | return % | pnl on 10k |",
    "| --- | --- | --- | --- | ---: | --- | ---: | ---: |",
    ...recentStandaloneEvents.map((event) => `| ${event.variant} | ${event.alertTime} | ${event.entryTime} | ${event.exitTime} | ${event.holdHours} | ${event.exitReason} | ${round(event.returnPct, 2)} | ${round(event.pnlOn10k)} |`),
  ].join("\n");

  const output = {
    baseline: summarizeBaseline(baseline),
    rows,
    standaloneRows,
    recentStandaloneEvents,
    results,
    standalone,
  };
  await fs.writeFile(path.join(REPORT_DIR, `result${REPORT_SUFFIX}.json`), JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, `result${REPORT_SUFFIX}.md`), md, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
