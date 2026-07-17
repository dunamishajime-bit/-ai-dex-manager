import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  RECLAIM_HYBRID_SLIPPAGE_BPS,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { buildIndicatorBars, resampleTo12h } from "../lib/backtest/indicators";
import type { Candle1h, EquityPoint, IndicatorBar } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-btc-weak-alt-sidecars");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const DEFAULT_CANDIDATES = [
  "SFP",
  "CAKE",
  "TRX",
  "XVS",
  "ID",
  "DODO",
  "ALPACA",
  "BNB",
  "ANKR",
  "KAVA",
  "LISTA",
  "HOOK",
  "TKO",
  "TLM",
  "ASTER",
] as const;
const CANDIDATES = (process.env.BT_CANDIDATES
  ? process.env.BT_CANDIDATES.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)
  : [...DEFAULT_CANDIDATES]) as readonly SymbolName[];

const PERIODS = [
  { key: "2022", startTs: Date.UTC(2022, 0, 1), endTs: Date.UTC(2022, 11, 31, 23, 59, 59, 999) },
  { key: "2023", startTs: Date.UTC(2023, 0, 1), endTs: Date.UTC(2023, 11, 31, 23, 59, 59, 999) },
  { key: "2024", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 4, 22, 23, 59, 59, 999) },
] as const;

type SymbolName = typeof DEFAULT_CANDIDATES[number];
type Window = { startTs: number; endTs: number };
type Variant = {
  key: string;
  btcWeak: "or" | "and" | "mom";
  minMom20: number;
  minRelMom20: number;
  minMomAccel: number;
  minVolumeRatio: number;
  minEfficiency: number;
  breakoutLookback: number;
  breakoutPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  hardStopPct: number;
  maxHoldHours: number;
};
type Signal = {
  symbol: SymbolName;
  ts: number;
  close: number;
  score: number;
  btcMom20: number;
  relMom20: number;
};
type Trade = {
  symbol: SymbolName;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  notionalUsd: number;
  netPnl: number;
  netReturnPct: number;
  exitReason: string;
  btcMom20: number;
  relMom20: number;
};

const VARIANTS: Variant[] = [
  {
    key: "btcweak_fast_12h",
    btcWeak: "or",
    minMom20: 0.015,
    minRelMom20: 0.04,
    minMomAccel: 0,
    minVolumeRatio: 0.85,
    minEfficiency: 0.12,
    breakoutLookback: 6,
    breakoutPct: 0.006,
    trailActivationPct: 0.06,
    trailRetracePct: 0.035,
    hardStopPct: 0.07,
    maxHoldHours: 72,
  },
  {
    key: "btcweak_quality_12h",
    btcWeak: "or",
    minMom20: 0.03,
    minRelMom20: 0.07,
    minMomAccel: 0.002,
    minVolumeRatio: 1.0,
    minEfficiency: 0.18,
    breakoutLookback: 8,
    breakoutPct: 0.01,
    trailActivationPct: 0.10,
    trailRetracePct: 0.05,
    hardStopPct: 0.08,
    maxHoldHours: 120,
  },
  {
    key: "btcweak_strict_12h",
    btcWeak: "and",
    minMom20: 0.035,
    minRelMom20: 0.10,
    minMomAccel: 0.004,
    minVolumeRatio: 1.05,
    minEfficiency: 0.22,
    breakoutLookback: 8,
    breakoutPct: 0.012,
    trailActivationPct: 0.12,
    trailRetracePct: 0.06,
    hardStopPct: 0.08,
    maxHoldHours: 144,
  },
  {
    key: "btcdown_mom_rebound_12h",
    btcWeak: "mom",
    minMom20: 0.01,
    minRelMom20: 0.06,
    minMomAccel: 0.006,
    minVolumeRatio: 0.8,
    minEfficiency: 0.14,
    breakoutLookback: 5,
    breakoutPct: 0.004,
    trailActivationPct: 0.05,
    trailRetracePct: 0.025,
    hardStopPct: 0.065,
    maxHoldHours: 48,
  },
  {
    key: "btcweak_rel18_quality_12h",
    btcWeak: "or",
    minMom20: 0.05,
    minRelMom20: 0.18,
    minMomAccel: 0.003,
    minVolumeRatio: 0.95,
    minEfficiency: 0.16,
    breakoutLookback: 8,
    breakoutPct: 0.008,
    trailActivationPct: 0.10,
    trailRetracePct: 0.045,
    hardStopPct: 0.075,
    maxHoldHours: 96,
  },
  {
    key: "btcweak_rel20_fasttrail_12h",
    btcWeak: "or",
    minMom20: 0.06,
    minRelMom20: 0.20,
    minMomAccel: 0.004,
    minVolumeRatio: 0.9,
    minEfficiency: 0.14,
    breakoutLookback: 6,
    breakoutPct: 0.006,
    trailActivationPct: 0.07,
    trailRetracePct: 0.03,
    hardStopPct: 0.07,
    maxHoldHours: 72,
  },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(period: typeof PERIODS[number]): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: period.startTs,
    backtestEndTs: period.endTs,
    label: `v7_btc_weak_alt_base_${period.key}`,
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const points = [...result.equity_curve].sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of points) {
    const usable = point.position_side === "cash" && point.cash / Math.max(1, point.equity) >= 0.05;
    if (usable) {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) {
      windows.push({ startTs: start, endTs: prev + 12 * HOUR_MS });
      start = null;
      prev = null;
    }
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + 12 * HOUR_MS });
  return windows;
}

function findPointAtOrBefore(points: EquityPoint[], ts: number) {
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
  return best >= 0 ? points[best] : null;
}

function findIndicatorAtOrBefore(indicators: IndicatorBar[], ts: number) {
  let lo = 0;
  let hi = indicators.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (indicators[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? indicators[best] : null;
}

function cashIsUsable(point: EquityPoint | null) {
  if (!point) return false;
  if (point.cash < 25 || point.equity <= 0) return false;
  return point.cash / point.equity >= 0.05;
}

function inWindows(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function pathEfficiency(candles: Candle1h[], index: number, lookback: number) {
  if (index < lookback) return 0;
  const start = candles[index - lookback].close;
  const end = candles[index].close;
  const path = candles.slice(index - lookback + 1, index + 1).reduce((sum, bar, offset) => {
    const prev = candles[index - lookback + offset].close;
    return sum + Math.abs(bar.close / prev - 1);
  }, 0);
  return path > 0 ? Math.abs(end / start - 1) / path : 0;
}

function btcWeakOk(bar: IndicatorBar | null, mode: Variant["btcWeak"]) {
  if (!bar?.ready) return false;
  if (mode === "and") return bar.close < bar.sma40 && bar.mom20 < 0;
  if (mode === "mom") return bar.mom20 < 0;
  return bar.close < bar.sma40 || bar.mom20 < 0;
}

function slippageRate(symbol: string) {
  return (RECLAIM_HYBRID_SLIPPAGE_BPS[`${symbol}_USDT`] ?? 120) / 10000;
}

async function load12h(symbol: string, period: typeof PERIODS[number]) {
  const candles = await loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: period.startTs - 160 * 24 * HOUR_MS,
    endMs: period.endTs,
    interval: "1h",
  });
  if (candles.length < 300) return null;
  const bars = resampleTo12h(candles).filter((bar) => bar.ts >= period.startTs - 120 * 24 * HOUR_MS && bar.ts <= period.endTs);
  const indicators = buildIndicatorBars(bars);
  return { bars, indicators };
}

function signalAt(
  symbol: SymbolName,
  bars: Candle1h[],
  indicators: IndicatorBar[],
  index: number,
  btc: IndicatorBar | null,
  variant: Variant,
): Signal | null {
  if (index < Math.max(90, variant.breakoutLookback + 1)) return null;
  if (!btcWeakOk(btc, variant.btcWeak)) return null;
  const bar = bars[index];
  const ind = indicators[index];
  if (!ind.ready) return null;
  const prev = bars.slice(index - variant.breakoutLookback, index);
  const recentHigh = Math.max(...prev.map((item) => item.high));
  const breakoutPct = recentHigh > 0 ? bar.close / recentHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const efficiency = pathEfficiency(bars, index, variant.breakoutLookback);
  const relMom20 = ind.mom20 - (btc?.mom20 ?? 0);
  const ok =
    bar.close > ind.sma40 &&
    ind.mom20 >= variant.minMom20 &&
    relMom20 >= variant.minRelMom20 &&
    ind.momAccel >= variant.minMomAccel &&
    volumeRatio >= variant.minVolumeRatio &&
    efficiency >= variant.minEfficiency &&
    breakoutPct >= variant.breakoutPct;
  if (!ok) return null;
  const score = ind.mom20 * 120 + relMom20 * 80 + ind.momAccel * 180 + breakoutPct * 150 + Math.min(4, volumeRatio) * 3 + efficiency * 20 + ind.adx14 * 0.1;
  return { symbol, ts: bar.ts, close: bar.close, score, btcMom20: btc?.mom20 ?? 0, relMom20 };
}

function simulate(input: {
  variant: Variant;
  points: EquityPoint[];
  cashWindows: Window[];
  btcIndicators: IndicatorBar[];
  data: Map<SymbolName, { bars: Candle1h[]; indicators: IndicatorBar[] }>;
}) {
  const signals: Signal[] = [];
  const priceBySymbolTs = new Map<string, Candle1h>();
  for (const symbol of CANDIDATES) {
    const item = input.data.get(symbol);
    if (!item) continue;
    for (let index = 0; index < item.bars.length; index += 1) {
      const bar = item.bars[index];
      priceBySymbolTs.set(`${symbol}:${bar.ts}`, bar);
      if (!inWindows(bar.ts, input.cashWindows)) continue;
      const point = findPointAtOrBefore(input.points, bar.ts);
      if (!cashIsUsable(point)) continue;
      const btc = findIndicatorAtOrBefore(input.btcIndicators, bar.ts);
      const signal = signalAt(symbol, item.bars, item.indicators, index, btc, input.variant);
      if (signal) signals.push(signal);
    }
  }

  const timeline = [...new Set([
    ...signals.map((signal) => signal.ts),
    ...Array.from(priceBySymbolTs.values()).map((bar) => bar.ts),
  ])].sort((left, right) => left - right);
  const trades: Trade[] = [];
  let open: (Trade & { peakPrice: number; maxExitTs: number }) | null = null;

  for (const ts of timeline) {
    if (open) {
      const bar = priceBySymbolTs.get(`${open.symbol}:${ts}`);
      if (bar) {
        open.peakPrice = Math.max(open.peakPrice, bar.high);
        const grossReturn = bar.close / open.entryPrice - 1;
        const drawdown = bar.low / open.entryPrice - 1;
        const retrace = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
        let exitReason: string | null = null;
        if (drawdown <= -input.variant.hardStopPct) exitReason = "hard-stop";
        if (!exitReason && grossReturn >= input.variant.trailActivationPct && retrace <= -input.variant.trailRetracePct) exitReason = "profit-trail";
        if (!exitReason && ts >= open.maxExitTs) exitReason = "max-hold";
        const point = findPointAtOrBefore(input.points, ts);
        if (!exitReason && !cashIsUsable(point)) exitReason = "cash-window-end";
        if (exitReason) {
          const netReturnPct = bar.close / open.entryPrice - 1 - (slippageRate(open.symbol) + FEE_RATE) * 2;
          trades.push({
            ...open,
            exitTs: ts,
            exitPrice: bar.close,
            netReturnPct,
            netPnl: open.notionalUsd * netReturnPct,
            exitReason,
          });
          open = null;
        }
      }
      continue;
    }

    const best = signals.filter((signal) => signal.ts === ts).sort((left, right) => right.score - left.score)[0];
    if (!best) continue;
    const point = findPointAtOrBefore(input.points, ts);
    if (!cashIsUsable(point)) continue;
    const notionalUsd = Math.min(300, point!.cash);
    if (notionalUsd < 25) continue;
    open = {
      symbol: best.symbol,
      entryTs: best.ts,
      exitTs: best.ts,
      entryPrice: best.close,
      exitPrice: best.close,
      notionalUsd,
      netPnl: 0,
      netReturnPct: 0,
      exitReason: "open",
      btcMom20: best.btcMom20,
      relMom20: best.relMom20,
      peakPrice: best.close,
      maxExitTs: best.ts + input.variant.maxHoldHours * HOUR_MS,
    };
  }

  return trades;
}

function summarizeTrades(trades: Trade[], baseEnd: number) {
  const pnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const gains = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const losses = trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);
  const hours = trades.reduce((sum, trade) => sum + Math.max(0, trade.exitTs - trade.entryTs) / HOUR_MS, 0);
  return {
    endWithSidecar: round(baseEnd + pnl, 2),
    pnl: round(pnl, 2),
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pf: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : 0,
    addedDays: round(hours / 24, 2),
    bySymbol: Object.fromEntries(CANDIDATES.map((symbol) => [
      symbol,
      {
        trades: trades.filter((trade) => trade.symbol === symbol).length,
        pnl: round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.netPnl, 0), 2),
      },
    ]).filter(([, value]) => value.trades > 0 || value.pnl !== 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const details: Record<string, Trade[]> = {};

  for (const period of PERIODS) {
    const base = await runHybridBacktest("RETQ22", baseOptions(period));
    const points = [...base.equity_curve].sort((left, right) => left.ts - right.ts);
    const cashWindows = cashWindowsFromBaseline(base);
    const btc = await load12h("BTC", period);
    if (!btc) throw new Error(`BTC data missing for ${period.key}`);
    const data = new Map<SymbolName, { bars: Candle1h[]; indicators: IndicatorBar[] }>();
    for (const symbol of CANDIDATES) {
      try {
        const loaded = await load12h(symbol, period);
        if (loaded) data.set(symbol, loaded);
      } catch (error) {
        console.log(`${period.key} ${symbol}: no data (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    for (const variant of VARIANTS) {
      const trades = simulate({
        variant,
        points,
        cashWindows,
        btcIndicators: btc.indicators,
        data,
      });
      const summary = summarizeTrades(trades, base.summary.end_equity);
      const row = {
        period: period.key,
        variant: variant.key,
        baseEnd: round(base.summary.end_equity, 2),
        baseCashPct: round(100 - base.summary.exposure_pct, 2),
        cashWindows: cashWindows.length,
        ...summary,
      };
      rows.push(row);
      details[`${period.key}_${variant.key}`] = trades;
      console.log(`${period.key} ${variant.key}: pnl=${summary.pnl} trades=${summary.trades} win=${summary.winPct}% pf=${summary.pf}`);
    }
  }

  rows.sort((left, right) => right.pnl - left.pnl);
  const md = [
    "# V7 BTC-Weak Alt Sidecar Scan",
    "",
    "- method: engine-direct V7 live-equivalent cash windows + sidecar simulation",
    "- scope: USDT/cash waiting periods only",
    "- candidates: SFP / CAKE / TRX / XVS / ID / DODO / ALPACA / BNB / ANKR / KAVA / LISTA / HOOK / TKO / TLM / ASTER",
    "- cap: max 300 USDT per sidecar position",
    "- intent: find BNB Chain candidates that move while BTC is weak",
    "",
    "| rank | period | variant | base end | end + sidecar | pnl | trades | win % | PF | base USDT % | added days | by symbol |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.period} | ${row.variant} | ${row.baseEnd} | ${row.endWithSidecar} | ${row.pnl} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.baseCashPct} | ${row.addedDays} | ${JSON.stringify(row.bySymbol)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify({ rows, details }, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
