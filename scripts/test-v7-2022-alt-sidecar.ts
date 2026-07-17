import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import { resampleToHours } from "../lib/backtest/indicators";
import type { BacktestResult, Candle1h, TradePairRow } from "../lib/backtest/types";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2022-alt-sidecar");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const PERIODS = [
  { key: "2022", startTs: Date.UTC(2022, 0, 1), endTs: Date.UTC(2022, 11, 31, 23, 59, 59, 999) },
  { key: "2023", startTs: Date.UTC(2023, 0, 1), endTs: Date.UTC(2023, 11, 31, 23, 59, 59, 999) },
  { key: "2024", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
] as const;
const REQUESTED_PERIOD = process.env.BT_PERIOD || "";

const SYMBOLS = ["TWT", "MATIC", "ALPACA", "UNI", "DOGE", "SFP", "AAVE", "LINK", "AVAX"] as const;
const BAD_REPLACEMENT_SYMBOLS = new Set(["SOL", "TWT"]);

const QUOTE_LOSS_PCT: Record<string, number> = {
  TWT: 0.35,
  MATIC: 0.45,
  ALPACA: 0.75,
  UNI: 0.6,
  DOGE: 0.25,
  SFP: 0.45,
  AAVE: 0.7,
  LINK: 0.5,
  AVAX: 0.55,
};

const VARIANTS = [
  {
    key: "rebound_12h_like",
    maxHoldHours: 48,
    lookback: 5,
    breakoutPct: 0.004,
    minVolRatio: 0.75,
    minMom6: -0.015,
    minMom24: 0.004,
    minFourHourMom: -0.01,
    minScore: 6,
    trailActivationPct: 0.05,
    trailRetracePct: 0.025,
    hardStopPct: 0.075,
    weakExitMinHours: 8,
    maxOneHourJump: 0.18,
  },
  {
    key: "fast_1h_quality",
    maxHoldHours: 24,
    lookback: 8,
    breakoutPct: 0.008,
    minVolRatio: 0.9,
    minMom6: 0.008,
    minMom24: 0.018,
    minFourHourMom: 0.008,
    minScore: 10,
    trailActivationPct: 0.07,
    trailRetracePct: 0.035,
    hardStopPct: 0.07,
    weakExitMinHours: 6,
    maxOneHourJump: 0.16,
  },
  {
    key: "confirmed_1h",
    maxHoldHours: 72,
    lookback: 10,
    breakoutPct: 0.012,
    minVolRatio: 1.05,
    minMom6: 0.015,
    minMom24: 0.035,
    minFourHourMom: 0.02,
    minScore: 14,
    trailActivationPct: 0.1,
    trailRetracePct: 0.05,
    hardStopPct: 0.08,
    weakExitMinHours: 10,
    maxOneHourJump: 0.14,
  },
] as const;

type Window = { startTs: number; endTs: number; source: string; removedPnl?: number };
type Signal = { symbol: string; variant: string; ts: number; close: number; score: number };
type SimTrade = {
  symbol: string;
  variant: string;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  netReturnPct: number;
  grossReturnPct: number;
  score: number;
  exitReason: string;
  windowSource: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function cashWindowsFromBaseline(result: BacktestResult) {
  const points = [...result.equity_curve].sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of points) {
    if (point.position_side === "cash") {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS, source: "cash" });
    start = null;
    prev = null;
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS, source: "cash" });
  return windows.filter((window) => window.endTs - window.startTs >= HOUR_MS);
}

function badTradeWindows(result: BacktestResult) {
  return result.trade_pairs
    .filter((trade) => BAD_REPLACEMENT_SYMBOLS.has(trade.symbol) && trade.net_pnl < 0)
    .map((trade) => ({
      startTs: Date.parse(trade.entry_time),
      endTs: Date.parse(trade.exit_time),
      source: `replace_bad_${trade.symbol}`,
      removedPnl: trade.net_pnl,
    }))
    .filter((window) => Number.isFinite(window.startTs) && Number.isFinite(window.endTs) && window.endTs > window.startTs);
}

function mergeWindows(windows: readonly Window[]) {
  return [...windows].sort((left, right) => left.startTs - right.startTs);
}

function windowFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs);
}

function buildIndex(candles: Candle1h[]) {
  const index = new Map<number, number>();
  candles.forEach((bar, offset) => index.set(bar.ts, offset));
  return index;
}

function signalFor(symbol: string, candles: Candle1h[], fourHourCandles: Candle1h[], index: number, variant: typeof VARIANTS[number]) {
  if (index < Math.max(30, variant.lookback + 1)) return null;
  const bar = candles[index];
  const prevHigh = Math.max(...candles.slice(index - variant.lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
  const volRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
  const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
  const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
  const oneHourJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
  const fourHour = [...fourHourCandles].reverse().find((item) => item.ts <= bar.ts);
  const fourHourIndex = fourHour ? fourHourCandles.findIndex((item) => item.ts === fourHour.ts) : -1;
  const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0
    ? fourHour!.close / fourHourCandles[fourHourIndex - 3].close - 1
    : 0;
  if (breakoutPct < variant.breakoutPct) return null;
  if (volRatio < variant.minVolRatio) return null;
  if (mom6 < variant.minMom6) return null;
  if (mom24 < variant.minMom24) return null;
  if (fourHourMom < variant.minFourHourMom) return null;
  if (oneHourJump > variant.maxOneHourJump) return null;
  const score = mom6 * 100 + mom24 * 75 + fourHourMom * 90 + breakoutPct * 150 + Math.min(3, volRatio) * 2;
  return score >= variant.minScore ? { symbol, variant: variant.key, ts: bar.ts, close: bar.close, score } : null;
}

function simulate(candlesBySymbol: Map<string, Candle1h[]>, windows: readonly Window[]) {
  const activeWindows = mergeWindows(windows);
  const indexBySymbol = new Map<string, Map<number, number>>();
  const fourHourBySymbol = new Map<string, Candle1h[]>();
  const tsSet = new Set<number>();
  for (const [symbol, candles] of candlesBySymbol) {
    indexBySymbol.set(symbol, buildIndex(candles));
    fourHourBySymbol.set(symbol, resampleToHours(candles, 4));
    candles.forEach((bar) => {
      if (windowFor(bar.ts, activeWindows)) tsSet.add(bar.ts);
    });
  }

  const trades: SimTrade[] = [];
  let open: (SimTrade & { peakPrice: number; troughPrice: number; maxExitTs: number }) | null = null;

  for (const ts of [...tsSet].sort((left, right) => left - right)) {
    const currentWindow = windowFor(ts, activeWindows);
    if (!currentWindow) continue;
    if (open) {
      const candles = candlesBySymbol.get(open.symbol) ?? [];
      const index = indexBySymbol.get(open.symbol)?.get(ts);
      if (index == null) continue;
      const bar = candles[index];
      const variant = VARIANTS.find((item) => item.key === open.variant) ?? VARIANTS[0];
      open.peakPrice = Math.max(open.peakPrice, bar.high);
      open.troughPrice = Math.min(open.troughPrice, bar.low);
      const holdingHours = (ts - open.entryTs) / HOUR_MS;
      const profitFromEntry = bar.close / open.entryPrice - 1;
      const drawdownFromEntry = bar.low / open.entryPrice - 1;
      const retraceFromPeak = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
      const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
      const mom6 = index >= 6 ? bar.close / candles[index - 6].close - 1 : 0;
      let exitReason: string | null = null;
      if (drawdownFromEntry <= -variant.hardStopPct) exitReason = "hard-stop";
      if (!exitReason && profitFromEntry >= variant.trailActivationPct && retraceFromPeak <= -variant.trailRetracePct) exitReason = "profit-trail";
      if (!exitReason && holdingHours >= variant.weakExitMinHours && bar.close < sma20 && mom6 < 0) exitReason = "weak-exit";
      if (!exitReason && (ts >= open.maxExitTs || !currentWindow || ts >= currentWindow.endTs)) exitReason = "max-hold-or-window-end";
      if (!exitReason) continue;

      const grossReturnPct = bar.close / open.entryPrice - 1;
      const quoteLossPct = Math.max(0, QUOTE_LOSS_PCT[open.symbol] ?? 1);
      const netReturnPct = grossReturnPct - (quoteLossPct / 100) * 2 - FEE_RATE * 2;
      trades.push({
        ...open,
        exitTs: ts,
        exitPrice: bar.close,
        grossReturnPct,
        netReturnPct,
        exitReason,
      });
      open = null;
      continue;
    }

    const signals: Signal[] = [];
    for (const [symbol, candles] of candlesBySymbol) {
      const index = indexBySymbol.get(symbol)?.get(ts);
      if (index == null) continue;
      for (const variant of VARIANTS) {
        const signal = signalFor(symbol, candles, fourHourBySymbol.get(symbol) ?? [], index, variant);
        if (signal) signals.push(signal);
      }
    }
    signals.sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    const bestVariant = VARIANTS.find((item) => item.key === best.variant) ?? VARIANTS[0];
    const maxExitTs = Math.min(ts + bestVariant.maxHoldHours * HOUR_MS, currentWindow.endTs);
    if (maxExitTs <= ts) continue;
    open = {
      symbol: best.symbol,
      variant: best.variant,
      entryTs: ts,
      exitTs: ts,
      entryPrice: best.close,
      exitPrice: best.close,
      netReturnPct: 0,
      grossReturnPct: 0,
      score: best.score,
      exitReason: "open",
      windowSource: currentWindow.source,
      peakPrice: best.close,
      troughPrice: best.close,
      maxExitTs,
    };
  }
  return trades;
}

function summarize(trades: readonly SimTrade[], capUsd: number) {
  const pnl = trades.reduce((sum, trade) => sum + capUsd * trade.netReturnPct, 0);
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + capUsd * trade.netReturnPct, 0);
  const grossLoss = trades
    .filter((trade) => trade.netReturnPct < 0)
    .reduce((sum, trade) => sum + Math.abs(capUsd * trade.netReturnPct), 0);
  const bySymbol = Object.fromEntries(
    SYMBOLS.map((symbol) => {
      const rows = trades.filter((trade) => trade.symbol === symbol);
      return [symbol, round(rows.reduce((sum, trade) => sum + capUsd * trade.netReturnPct, 0))];
    }).filter(([, pnlBySymbol]) => Math.abs(Number(pnlBySymbol)) > 0),
  );
  return {
    trades: trades.length,
    pnl: round(pnl),
    winPct: round((wins.length / Math.max(1, trades.length)) * 100, 1),
    pf: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    bySymbol,
  };
}

function losingPnl(trades: readonly TradePairRow[]) {
  return round(trades.filter((trade) => BAD_REPLACEMENT_SYMBOLS.has(trade.symbol) && trade.net_pnl < 0).reduce((sum, trade) => sum + trade.net_pnl, 0));
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const tradeRows = [];
  const baseOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);

  const activePeriods = REQUESTED_PERIOD ? PERIODS.filter((period) => period.key === REQUESTED_PERIOD) : PERIODS;
  for (const period of activePeriods) {
    const baseline = await runHybridBacktest("RETQ22", {
      ...baseOptions,
      initialEquity: 10_000,
      backtestStartTs: period.startTs,
      backtestExecutionStartTs: period.startTs,
      backtestEndTs: period.endTs,
      label: `v7_2022_alt_sidecar_base_${period.key}`,
    });

    const candlesBySymbol = new Map<string, Candle1h[]>();
    for (const symbol of SYMBOLS) {
      const candles = await loadHistoricalCandles({
        symbol: `${symbol}USDT`,
        cacheRoot: CACHE_ROOT,
        startMs: period.startTs - 160 * HOUR_MS,
        endMs: period.endTs,
        interval: "1h",
      }).catch(() => []);
      if (candles.length > 0) candlesBySymbol.set(symbol, candles.filter((bar) => bar.ts >= period.startTs - 160 * HOUR_MS && bar.ts <= period.endTs));
    }

    const scenarios = [
      { key: "cash_windows_only", windows: cashWindowsFromBaseline(baseline), replacement: false },
      { key: "replace_bad_sol_twt_only", windows: badTradeWindows(baseline), replacement: true },
      { key: "cash_plus_replace_bad_sol_twt", windows: [...cashWindowsFromBaseline(baseline), ...badTradeWindows(baseline)], replacement: true },
    ];
    const badLoss = losingPnl(baseline.trade_pairs);
    rows.push({
      period: period.key,
      scenario: "replace_bad_sol_twt_with_cash",
      baselineEnd: round(baseline.summary.end_equity),
      baselineDd: round(baseline.summary.max_drawdown_pct, 2),
      baselineTrades: baseline.summary.trade_count,
      badSolTwtLoss: badLoss,
      windows: badTradeWindows(baseline).length,
      removedPnl: badLoss,
      cap300: { trades: 0, pnl: 0, winPct: 0, pf: 0, bySymbol: {} },
      cap1000: { trades: 0, pnl: 0, winPct: 0, pf: 0, bySymbol: {} },
      estimatedEnd300: round(baseline.summary.end_equity - badLoss),
    });

    for (const scenario of scenarios) {
      const trades = simulate(candlesBySymbol, scenario.windows);
      const cap300 = summarize(trades, 300);
      const cap1000 = summarize(trades, 1000);
      const removedPnl = scenario.replacement
        ? round(scenario.windows.reduce((sum, window) => sum + (window.removedPnl ?? 0), 0))
        : 0;
      const estimatedEnd300 = round(baseline.summary.end_equity - removedPnl + cap300.pnl);
      rows.push({
        period: period.key,
        scenario: scenario.key,
        baselineEnd: round(baseline.summary.end_equity),
        baselineDd: round(baseline.summary.max_drawdown_pct, 2),
        baselineTrades: baseline.summary.trade_count,
        badSolTwtLoss: badLoss,
        windows: scenario.windows.length,
        removedPnl,
        cap300,
        cap1000,
        estimatedEnd300,
      });
      tradeRows.push(...trades.map((trade) => ({ period: period.key, scenario: scenario.key, ...trade })));
      console.log(`${period.key} ${scenario.key}: trades=${cap300.trades} cap300=${cap300.pnl} estimatedEnd=${estimatedEnd300}`);
    }
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  const md = [
    "# V7 2022 Alt Sidecar Screen",
    "",
    "- method: V7 engine-direct baseline windows + ranked 1h sidecar simulation",
    "- sidecar cap: 300 / 1000 USDT, quote value loss charged on entry and exit",
    "- replacement scenario is an estimate: it removes losing SOL/TWT PnL, then adds sidecar PnL in those windows.",
    "",
    "| period | scenario | V7 End | V7 DD | bad SOL/TWT loss | windows | removed PnL | trades | win % | PF | cap300 PnL | cap300 est End | cap1000 PnL | cap300 by symbol |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row: any) => `| ${row.period} | ${row.scenario} | ${row.baselineEnd.toLocaleString()} | ${row.baselineDd}% | ${row.badSolTwtLoss.toLocaleString()} | ${row.windows} | ${row.removedPnl.toLocaleString()} | ${row.cap300.trades} | ${row.cap300.winPct}% | ${row.cap300.pf} | ${row.cap300.pnl.toLocaleString()} | ${row.estimatedEnd300.toLocaleString()} | ${row.cap1000.pnl.toLocaleString()} | ${JSON.stringify(row.cap300.bySymbol)} |`),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
