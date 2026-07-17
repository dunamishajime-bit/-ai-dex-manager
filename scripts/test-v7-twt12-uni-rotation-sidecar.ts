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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-twt12-uni-rotation-sidecar");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

type Variant = {
  key: string;
  sleeveFraction: number;
  rotateIntoUni: boolean;
};

type Signal = {
  ts: number;
  close: number;
  score: number;
  barIndex: number;
};

type SidecarTrade = {
  symbol: "TWT" | "UNI";
  entryTs: number;
  exitTs: number;
  notionalUsd: number;
  netPnl: number;
  netReturnPct: number;
  exitReason: string;
  source: "twt12" | "uni-mirror";
  mainSymbolAtEntry: string;
};

type OpenTwt = {
  kind: "TWT";
  entryTs: number;
  entryPrice: number;
  notionalUsd: number;
  peakPrice: number;
  mainSymbolAtEntry: string;
};

type OpenUniMirror = {
  kind: "UNI";
  entryTs: number;
  entryPrice: number;
  notionalUsd: number;
  exitTs: number;
  exitPrice: number;
  mainSymbolAtEntry: string;
};

type OpenState = OpenTwt | OpenUniMirror;

const VARIANTS: Variant[] = [
  { key: "twt12_75", sleeveFraction: 0.75, rotateIntoUni: false },
  { key: "twt12_75_uni_rotate", sleeveFraction: 0.75, rotateIntoUni: true },
  { key: "twt12_100", sleeveFraction: 1, rotateIntoUni: false },
  { key: "twt12_100_uni_rotate", sleeveFraction: 1, rotateIntoUni: true },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function iso(ts: number) {
  return new Date(ts).toISOString();
}

function baseOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  return {
    ...(buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    ...extra,
  };
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

function cashIsUsable(point: EquityPoint | null) {
  if (!point) return false;
  if (point.cash < 25 || point.equity <= 0) return false;
  if (point.cash / point.equity < 0.05) return false;
  return point.cash > 0;
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

function twt12Signal(candles: Candle1h[], indicators: IndicatorBar[], index: number): Signal | null {
  const lookback = 8;
  if (index < 90) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prevHigh = Math.max(...candles.slice(index - lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const efficiency = pathEfficiency(candles, index, lookback);
  if (!ind.ready) return null;
  if (bar.close <= ind.sma40) return null;
  if (ind.mom20 < 0.01) return null;
  if (breakoutPct < 0.004) return null;
  if (volumeRatio < 0.75) return null;
  if (ind.momAccel < 0.01) return null;
  if (efficiency < 0.16) return null;
  const score = ind.mom20 * 100 + ind.momAccel * 180 + breakoutPct * 150 + Math.min(4, volumeRatio) * 4 + efficiency * 18;
  return { ts: bar.ts, close: bar.close, score, barIndex: index };
}

function slippageRate(symbol: "TWT" | "UNI") {
  return (RECLAIM_HYBRID_SLIPPAGE_BPS[`${symbol}_USDT`] ?? 100) / 10000;
}

function unrealizedPnl(open: OpenState | null, twtBar: Candle1h | null) {
  if (!open) return 0;
  if (open.kind === "UNI") return 0;
  if (!twtBar) return 0;
  return open.notionalUsd * (twtBar.close / open.entryPrice - 1 - FEE_RATE - slippageRate("TWT"));
}

function summarizeTrades(trades: SidecarTrade[]) {
  const bySymbol = new Map<string, { trades: number; pnl: number }>();
  for (const trade of trades) {
    const row = bySymbol.get(trade.symbol) ?? { trades: 0, pnl: 0 };
    row.trades += 1;
    row.pnl += trade.netPnl;
    bySymbol.set(trade.symbol, row);
  }
  return Object.fromEntries([...bySymbol.entries()].map(([symbol, row]) => [symbol, {
    trades: row.trades,
    pnl: round(row.pnl),
  }]));
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", baseOptions({ label: "v7_twt12_uni_rotation_base" }));
  const equityPoints = [...baseline.equity_curve].sort((left, right) => left.ts - right.ts);
  const baselineEnd = baseline.summary.end_equity;

  const uniWindows = baseline.trade_pairs
    .filter((trade) => trade.symbol === "UNI")
    .map((trade) => ({
      entryTs: Date.parse(trade.entry_time),
      exitTs: Date.parse(trade.exit_time),
      entryPrice: trade.entry_price,
      exitPrice: trade.exit_price,
    }))
    .sort((left, right) => left.entryTs - right.entryTs);
  const uniEntryMap = new Map<number, typeof uniWindows[number]>();
  const uniExitMap = new Map<number, typeof uniWindows[number]>();
  for (const window of uniWindows) {
    uniEntryMap.set(window.entryTs, window);
    uniExitMap.set(window.exitTs, window);
  }

  const twt1hRaw = await loadHistoricalCandles({
    symbol: "TWTUSDT",
    cacheRoot: CACHE_ROOT,
    startMs: START_TS - 120 * 24 * 60 * 60 * 1000,
    endMs: END_TS,
    interval: "1h",
  });
  const twt12 = resampleTo12h(twt1hRaw).filter((bar) => bar.ts >= START_TS - 120 * 24 * 60 * 60 * 1000 && bar.ts <= END_TS);
  const twt12Indicators = buildIndicatorBars(twt12);
  const twtIndexByTs = new Map<number, number>();
  const twtBarByTs = new Map<number, Candle1h>();
  const signalByTs = new Map<number, Signal>();

  for (let index = 0; index < twt12.length; index += 1) {
    const bar = twt12[index];
    if (bar.ts < START_TS || bar.ts > END_TS) continue;
    twtIndexByTs.set(bar.ts, index);
    twtBarByTs.set(bar.ts, bar);
    const signal = twt12Signal(twt12, twt12Indicators, index);
    if (signal) signalByTs.set(bar.ts, signal);
  }

  const timelineSet = new Set<number>([
    ...equityPoints.map((point) => point.ts).filter((ts) => ts >= START_TS && ts <= END_TS),
    ...twtBarByTs.keys(),
    ...uniEntryMap.keys(),
    ...uniExitMap.keys(),
  ]);
  const timeline = [...timelineSet].sort((left, right) => left - right);

  const rows = VARIANTS.map((variant) => {
    const trades: SidecarTrade[] = [];
    let realizedPnl = 0;
    let open: OpenState | null = null;
    const combinedCurve: Array<{ ts: number; equity: number }> = [];

    for (const ts of timeline) {
      if (ts < START_TS || ts > END_TS) continue;
      const point = findPointAtOrBefore(equityPoints, ts);
      if (!point) continue;

      const twtBar = twtBarByTs.get(ts) ?? null;
      const uniEntry = uniEntryMap.get(ts) ?? null;
      const uniExit = uniExitMap.get(ts) ?? null;

      if (open?.kind === "UNI" && uniExit && open.exitTs === uniExit.exitTs) {
        const netReturnPct = open.exitPrice / open.entryPrice - 1 - ((FEE_RATE + slippageRate("UNI")) * 2);
        const netPnl = open.notionalUsd * netReturnPct;
        realizedPnl += netPnl;
        trades.push({
          symbol: "UNI",
          entryTs: open.entryTs,
          exitTs: open.exitTs,
          notionalUsd: open.notionalUsd,
          netPnl,
          netReturnPct: netReturnPct * 100,
          exitReason: "uni-main-exit",
          source: "uni-mirror",
          mainSymbolAtEntry: open.mainSymbolAtEntry,
        });
        open = null;
      }

      if (open?.kind === "TWT" && twtBar) {
        open.peakPrice = Math.max(open.peakPrice, twtBar.high);
        const currentIndex = twtIndexByTs.get(ts) ?? -1;
        const ind = currentIndex >= 0 ? twt12Indicators[currentIndex] : null;
        const holdingHours = (ts - open.entryTs) / (60 * 60 * 1000);
        const grossReturn = twtBar.close / open.entryPrice - 1;
        const retraceFromPeak = open.peakPrice > 0 ? twtBar.close / open.peakPrice - 1 : 0;
        let exitReason: string | null = null;
        if (grossReturn <= -0.08) exitReason = "twt-hard-stop";
        if (!exitReason && grossReturn >= 0.05 && retraceFromPeak <= -0.025) exitReason = "twt-profit-trail";
        if (!exitReason && holdingHours >= 24 && ind && twtBar.close < ind.sma40 && ind.mom20 < 0) exitReason = "twt-weak-exit";
        if (!exitReason && holdingHours >= 48) exitReason = "twt-max-hold";

        if (variant.rotateIntoUni && uniEntry) {
          const twtExitReturnPct = twtBar.close / open.entryPrice - 1 - ((FEE_RATE + slippageRate("TWT")) * 2);
          const twtExitPnl = open.notionalUsd * twtExitReturnPct;
          realizedPnl += twtExitPnl;
          trades.push({
            symbol: "TWT",
            entryTs: open.entryTs,
            exitTs: ts,
            notionalUsd: open.notionalUsd,
            netPnl: twtExitPnl,
            netReturnPct: twtExitReturnPct * 100,
            exitReason: "rotate-to-uni-main",
            source: "twt12",
            mainSymbolAtEntry: open.mainSymbolAtEntry,
          });

          const uniNotionalUsd = open.notionalUsd * (1 + twtExitReturnPct);
          open = uniNotionalUsd >= 25
            ? {
                kind: "UNI",
                entryTs: uniEntry.entryTs,
                entryPrice: uniEntry.entryPrice,
                notionalUsd: uniNotionalUsd,
                exitTs: uniEntry.exitTs,
                exitPrice: uniEntry.exitPrice,
                mainSymbolAtEntry: point.position_symbol,
              }
            : null;
          exitReason = null;
        }

        if (exitReason) {
          const netReturnPct = grossReturn - ((FEE_RATE + slippageRate("TWT")) * 2);
          const netPnl = open.notionalUsd * netReturnPct;
          realizedPnl += netPnl;
          trades.push({
            symbol: "TWT",
            entryTs: open.entryTs,
            exitTs: ts,
            notionalUsd: open.notionalUsd,
            netPnl,
            netReturnPct: netReturnPct * 100,
            exitReason,
            source: "twt12",
            mainSymbolAtEntry: open.mainSymbolAtEntry,
          });
          open = null;
        }
      }

      const currentEquity = point.equity + realizedPnl + unrealizedPnl(open, twtBar);
      combinedCurve.push({ ts, equity: currentEquity });

      if (open || !cashIsUsable(point)) continue;
      const signal = signalByTs.get(ts);
      if (!signal) continue;
      if (point.position_symbol.toUpperCase() === "TWT") continue;

      const notionalUsd = Math.max(0, point.cash * variant.sleeveFraction);
      if (notionalUsd < 25) continue;
      open = {
        kind: "TWT",
        entryTs: signal.ts,
        entryPrice: signal.close,
        notionalUsd,
        peakPrice: signal.close,
        mainSymbolAtEntry: point.position_symbol,
      };
    }

    const lastEquity = (equityPoints.at(-1)?.equity ?? baselineEnd) + realizedPnl;
    let peak = combinedCurve[0]?.equity ?? lastEquity;
    let maxDd = 0;
    for (const point of combinedCurve) {
      peak = Math.max(peak, point.equity);
      maxDd = Math.min(maxDd, point.equity / peak - 1);
    }
    const gains = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
    const losses = trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);

    return {
      variant: variant.key,
      endEquity: round(lastEquity),
      delta: round(lastEquity - baselineEnd),
      maxDdPct: round(maxDd * 100),
      pf: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : 0,
      winPct: round((trades.filter((trade) => trade.netPnl > 0).length / Math.max(1, trades.length)) * 100, 1),
      trades: trades.length,
      bySymbol: summarizeTrades(trades),
      rotateCount: trades.filter((trade) => trade.exitReason === "rotate-to-uni-main").length,
      uniMirrorTrades: trades.filter((trade) => trade.symbol === "UNI").length,
      allTrades: trades,
    };
  }).sort((left, right) => right.endEquity - left.endEquity);

  const md = [
    "# V7 TWT12 UNI Rotation Sidecar",
    "",
    `- period: ${iso(START_TS)} - ${iso(END_TS)}`,
    "- baseline: current V7 live-equivalent engine-direct with cash rescue profile",
    "- sidecar: TWT rebound_12h only, using remaining USDT sleeve",
    "- UNI rotation: when TWT sleeve is open and main V7 enters UNI, close TWT sleeve and mirror the main UNI trade with the sleeve capital until the main UNI exit",
    `- baseline end equity: ${round(baselineEnd).toLocaleString()}`,
    "",
    "| variant | End Equity | vs baseline | MaxDD | PF | win % | trades | rotate-to-UNI | UNI mirror trades | by symbol |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.variant} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDdPct}% | ${row.pf} | ${row.winPct}% | ${row.trades} | ${row.rotateCount} | ${row.uniMirrorTrades} | ${JSON.stringify(row.bySymbol)} |`),
    "",
    "## Top Trades",
    "",
    "| variant | symbol | entry | exit | notional | net % | pnl | reason |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows.flatMap((row) =>
      row.allTrades
        .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl))
        .slice(0, 12)
        .map((trade) => `| ${row.variant} | ${trade.symbol} | ${iso(trade.entryTs)} | ${iso(trade.exitTs)} | ${round(trade.notionalUsd).toLocaleString()} | ${round(trade.netReturnPct, 2)}% | ${round(trade.netPnl).toLocaleString()} | ${trade.exitReason} |`),
    ),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: {
      endEquity: round(baseline.summary.end_equity),
      maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
      profitFactor: round(baseline.summary.profit_factor, 3),
      trades: baseline.summary.trade_count,
    },
    rows,
  }, null, 2), "utf8");

  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
