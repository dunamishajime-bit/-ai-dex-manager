import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import { buildIndicatorBars, resampleTo12h } from "../lib/backtest/indicators";
import type { BacktestResult, IndicatorBar } from "../lib/backtest/types";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-twt-2022-dedicated");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "v7-alt-2022-scan");
const START_TS = Date.UTC(2022, 0, 1);
const END_TS = Date.UTC(2022, 11, 31, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const QUOTE_LOSS_PCT = 0.35;

const VARIANTS = [
  { key: "rebound_12h", minMom20: 0.01, minAccel: 0.01, minVolumeRatio: 0.75, minEfficiency: 0.16, breakoutLookback: 5, breakoutPct: 0.004, trailAct: 0.05, trailRetrace: 0.025, maxHold: 4 },
  { key: "fast_12h", minMom20: 0.015, minAccel: 0, minVolumeRatio: 0.8, minEfficiency: 0.12, breakoutLookback: 6, breakoutPct: 0.006, trailAct: 0.06, trailRetrace: 0.035, maxHold: 6 },
  { key: "quality_12h", minMom20: 0.03, minAccel: 0.005, minVolumeRatio: 0.9, minEfficiency: 0.18, breakoutLookback: 8, breakoutPct: 0.01, trailAct: 0.12, trailRetrace: 0.06, maxHold: 10 },
] as const;

type Window = { startTs: number; endTs: number; source: string; removedPnl?: number };
type Trade = {
  variant: string;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  netReturnPct: number;
  pnl: number;
  exitReason: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function maxDrawdown(equity: number[]) {
  let peak = equity[0] || 0;
  let dd = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    if (peak > 0) dd = Math.min(dd, value / peak - 1);
  }
  return dd * 100;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function cashWindowsFromBaseline(result: BacktestResult) {
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of [...result.equity_curve].sort((left, right) => left.ts - right.ts)) {
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
  return windows.filter((window) => window.endTs > window.startTs);
}

function badTradeWindows(result: BacktestResult) {
  return result.trade_pairs
    .filter((trade) => ["SOL", "TWT"].includes(trade.symbol) && trade.net_pnl < 0)
    .map((trade) => ({
      startTs: Date.parse(trade.entry_time),
      endTs: Date.parse(trade.exit_time),
      source: `bad_${trade.symbol}`,
      removedPnl: trade.net_pnl,
    }))
    .filter((window) => Number.isFinite(window.startTs) && Number.isFinite(window.endTs) && window.endTs > window.startTs);
}

function inWindow(ts: number, windows?: readonly Window[]) {
  if (!windows) return true;
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEnd(ts: number, windows?: readonly Window[]) {
  if (!windows) return END_TS;
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

function signalOk(bars: IndicatorBar[], index: number, variant: typeof VARIANTS[number]) {
  const bar = bars[index];
  if (!bar || !bar.ready || index < Math.max(90, variant.breakoutLookback + 1)) return false;
  const prev = bars.slice(index - variant.breakoutLookback, index);
  const recentHigh = Math.max(...prev.map((item) => item.high));
  const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
  const efficiency = Math.abs(bar.mom20) > 0 ? Math.abs(bar.close / bar.open - 1) / Math.abs(bar.mom20) : 0;
  const breakout = recentHigh > 0 ? bar.close / recentHigh - 1 : 0;
  return bar.close > bar.sma40
    && bar.mom20 >= variant.minMom20
    && bar.momAccel >= variant.minAccel
    && volumeRatio >= variant.minVolumeRatio
    && efficiency >= variant.minEfficiency
    && breakout >= variant.breakoutPct;
}

function simulateStandalone(bars: IndicatorBar[], variant: typeof VARIANTS[number], windows?: readonly Window[], initialEquity = 10_000, capUsd?: number) {
  let cash = initialEquity;
  let qty = 0;
  let entry = 0;
  let entrySpend = 0;
  let peak = 0;
  let hold = 0;
  let entryTs = 0;
  const equity = [cash];
  const trades: Trade[] = [];
  const useCap = capUsd != null;

  for (let index = Math.max(90, variant.breakoutLookback + 1); index < bars.length; index += 1) {
    const bar = bars[index];
    if (!bar || !inWindow(bar.ts, windows)) {
      if (qty > 0 && windows && bar) {
        const proceeds = qty * bar.open * (1 - FEE);
        const cost = qty * entry * (1 + FEE);
        const pnl = proceeds - cost;
        cash = useCap ? cash + entrySpend + pnl : proceeds;
        trades.push({ variant: variant.key, entryTs, exitTs: bar.ts, entryPrice: entry, exitPrice: bar.open, netReturnPct: pnl / Math.max(1, cost), pnl, exitReason: "window-end" });
        qty = 0;
        entrySpend = 0;
      }
      equity.push(qty > 0 ? cash + qty * bar.close * (1 - FEE) : cash);
      continue;
    }
    if (qty > 0) {
      hold += 1;
      peak = Math.max(peak, bar.high);
      let exitReason = "";
      if (bar.close >= entry * (1 + variant.trailAct) && bar.close <= peak * (1 - variant.trailRetrace)) exitReason = "trail";
      if (!exitReason && hold >= variant.maxHold) exitReason = "maxHold";
      if (!exitReason && bar.close < bar.sma40 && bar.mom20 < 0) exitReason = "weak";
      if (!exitReason && windows && bar.ts >= windowEnd(bar.ts, windows)) exitReason = "window-end";
      if (exitReason) {
        const proceeds = qty * bar.open * (1 - FEE);
        const cost = qty * entry * (1 + FEE);
        const pnl = proceeds - cost;
        cash = useCap ? cash + entrySpend + pnl : proceeds;
        trades.push({ variant: variant.key, entryTs, exitTs: bar.ts, entryPrice: entry, exitPrice: bar.open, netReturnPct: pnl / Math.max(1, cost), pnl, exitReason });
        qty = 0;
        entrySpend = 0;
      }
    }

    if (qty <= 0 && signalOk(bars, index, variant)) {
      const spend = useCap ? Math.min(capUsd!, cash) : cash;
      if (spend > 0) {
        entry = bar.open;
        qty = (spend * (1 - FEE - (useCap ? QUOTE_LOSS_PCT / 100 : 0))) / entry;
        entrySpend = spend;
        if (useCap) cash -= spend;
        else cash = 0;
        peak = bar.high;
        hold = 0;
        entryTs = bar.ts;
      }
    }

    equity.push(qty > 0 ? cash + qty * bar.close * (1 - FEE) : cash);
  }

  if (qty > 0) {
    const bar = bars.at(-1)!;
    const proceeds = qty * bar.close * (1 - FEE);
    const cost = qty * entry * (1 + FEE);
    const pnl = proceeds - cost;
    cash = useCap ? cash + entrySpend + pnl : proceeds;
    trades.push({ variant: variant.key, entryTs, exitTs: bar.ts, entryPrice: entry, exitPrice: bar.close, netReturnPct: pnl / Math.max(1, cost), pnl, exitReason: "periodEnd" });
    equity.push(cash);
  }

  const wins = trades.filter((trade) => trade.pnl > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));
  return {
    end: round(cash),
    pnl: round(cash - initialEquity),
    dd: round(maxDrawdown(equity), 2),
    trades: trades.length,
    winRate: round((wins.length / Math.max(1, trades.length)) * 100, 1),
    pf: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    tradesList: trades,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const candles = await loadHistoricalCandles({
    symbol: "TWTUSDT",
    cacheRoot: CACHE_ROOT,
    startMs: START_TS,
    endMs: END_TS,
    interval: "1h",
  });
  const bars = buildIndicatorBars(resampleTo12h(candles)).filter((bar) => bar.ready);
  const baseline = await runHybridBacktest("RETQ22", {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    initialEquity: 10_000,
    backtestStartTs: START_TS,
    backtestExecutionStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_twt_2022_dedicated_base",
  });
  const cashWindows = cashWindowsFromBaseline(baseline);
  const badWindows = badTradeWindows(baseline);
  const badLoss = badWindows.reduce((sum, window) => sum + (window.removedPnl ?? 0), 0);

  const rows = [];
  const allTrades: Record<string, Trade[]> = {};
  for (const variant of VARIANTS) {
    const standalone = simulateStandalone(bars, variant);
    const cashCap300 = simulateStandalone(bars, variant, cashWindows, 10_000, 300);
    const badCap300 = simulateStandalone(bars, variant, badWindows, 10_000, 300);
    rows.push({
      variant: variant.key,
      mode: "standalone_full_compound",
      baselineEnd: round(baseline.summary.end_equity),
      ...standalone,
      estimatedV7End: null,
    });
    rows.push({
      variant: variant.key,
      mode: "v7_cash_windows_cap300",
      baselineEnd: round(baseline.summary.end_equity),
      ...cashCap300,
      estimatedV7End: round(baseline.summary.end_equity + cashCap300.pnl),
    });
    rows.push({
      variant: variant.key,
      mode: "replace_bad_sol_twt_cap300",
      baselineEnd: round(baseline.summary.end_equity),
      removedBadPnl: round(badLoss),
      ...badCap300,
      estimatedV7End: round(baseline.summary.end_equity - badLoss + badCap300.pnl),
    });
    allTrades[`${variant.key}-standalone`] = standalone.tradesList;
    allTrades[`${variant.key}-cash`] = cashCap300.tradesList;
    allTrades[`${variant.key}-bad`] = badCap300.tradesList;
  }

  const md = [
    "# TWT 2022 Dedicated Check",
    "",
    "- method: TWT 12h dedicated logic vs V7 2022 windows",
    `- V7 2022 baseline End: ${round(baseline.summary.end_equity).toLocaleString()}`,
    `- V7 losing SOL/TWT PnL removed in replacement estimate: ${round(badLoss).toLocaleString()}`,
    "",
    "| variant | mode | End/PnL | DD | PF | Trades | Win% | estimated V7 End |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row: any) => `| ${row.variant} | ${row.mode} | ${row.mode === "standalone_full_compound" ? row.end.toLocaleString() : row.pnl.toLocaleString()} | ${row.dd}% | ${row.pf} | ${row.trades} | ${row.winRate}% | ${row.estimatedV7End == null ? "-" : row.estimatedV7End.toLocaleString()} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(allTrades, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
