import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { buildIndicatorBars, resampleTo12h } from "../lib/backtest/indicators";
import type { IndicatorBar } from "../lib/backtest/types";

const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const REPORT_DIR = path.join(process.cwd(), "reports", "twt-standalone-full");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const FEE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const VARIANTS = [
  { key: "rebound_12h", minMom20: 0.01, minAccel: 0.01, minVolumeRatio: 0.75, minEfficiency: 0.16, breakoutLookback: 5, breakoutPct: 0.004, trailAct: 0.05, trailRetrace: 0.025, maxHold: 4 },
  { key: "fast_12h", minMom20: 0.015, minAccel: 0, minVolumeRatio: 0.8, minEfficiency: 0.12, breakoutLookback: 6, breakoutPct: 0.006, trailAct: 0.06, trailRetrace: 0.035, maxHold: 6 },
  { key: "quality_12h", minMom20: 0.03, minAccel: 0.005, minVolumeRatio: 0.9, minEfficiency: 0.18, breakoutLookback: 8, breakoutPct: 0.01, trailAct: 0.12, trailRetrace: 0.06, maxHold: 10 },
] as const;

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

function runVariant(bars: IndicatorBar[], variant: typeof VARIANTS[number]) {
  let cash = 10_000;
  let qty = 0;
  let entry = 0;
  let peak = 0;
  let hold = 0;
  let wins = 0;
  let trades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let openTime = "";
  const equity: number[] = [cash];
  const events: Array<{ entryTime: string; exitTime: string; pnl: number; returnPct: number; exitReason: string }> = [];

  for (let index = Math.max(90, variant.breakoutLookback + 1); index < bars.length; index += 1) {
    const bar = bars[index];
    if (!bar) continue;
    if (qty > 0) {
      hold += 1;
      peak = Math.max(peak, bar.high);
      let exitReason = "";
      if (bar.close >= entry * (1 + variant.trailAct) && bar.close <= peak * (1 - variant.trailRetrace)) exitReason = "trail";
      if (!exitReason && hold >= variant.maxHold) exitReason = "maxHold";
      if (!exitReason && bar.close < bar.sma40 && bar.mom20 < 0) exitReason = "weak";
      if (exitReason) {
        const proceeds = qty * bar.open * (1 - FEE);
        const cost = qty * entry * (1 + FEE);
        const pnl = proceeds - cost;
        cash = proceeds;
        qty = 0;
        trades += 1;
        if (pnl > 0) {
          wins += 1;
          grossProfit += pnl;
        } else {
          grossLoss += Math.abs(pnl);
        }
        events.push({ entryTime: openTime, exitTime: new Date(bar.ts).toISOString(), pnl, returnPct: pnl / Math.max(1, cost), exitReason });
      }
    }

    if (qty <= 0 && signalOk(bars, index, variant)) {
      entry = bar.open;
      qty = (cash * (1 - FEE)) / entry;
      cash = 0;
      peak = bar.high;
      hold = 0;
      openTime = new Date(bar.ts).toISOString();
    }

    equity.push(qty > 0 ? qty * bar.close * (1 - FEE) : cash);
  }

  if (qty > 0) {
    const bar = bars.at(-1)!;
    const proceeds = qty * bar.close * (1 - FEE);
    const cost = qty * entry * (1 + FEE);
    const pnl = proceeds - cost;
    cash = proceeds;
    trades += 1;
    if (pnl > 0) {
      wins += 1;
      grossProfit += pnl;
    } else {
      grossLoss += Math.abs(pnl);
    }
    events.push({ entryTime: openTime, exitTime: new Date(bar.ts).toISOString(), pnl, returnPct: pnl / Math.max(1, cost), exitReason: "periodEnd" });
    equity.push(cash);
  }

  return {
    variant: variant.key,
    end: round(cash),
    pnl: round(cash - 10_000),
    returnPct: round((cash / 10_000 - 1) * 100, 2),
    dd: round(maxDrawdown(equity), 2),
    pf: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : grossProfit > 0 ? 999 : 0,
    trades,
    winRate: trades > 0 ? round((wins / trades) * 100, 1) : 0,
    events,
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
  const bars = buildIndicatorBars(resampleTo12h(candles)).filter((bar) => bar.ready && bar.ts >= START_TS && bar.ts <= END_TS);
  const rows = VARIANTS.map((variant) => runVariant(bars, variant)).sort((left, right) => right.end - left.end);
  const md = [
    "# TWT Standalone Full",
    "",
    `Period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: TWT only / standalone full compound / 12h bars",
    "",
    "| variant | End Equity | PnL | Return | MaxDD | PF | Trades | Win% |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.variant} | ${row.end.toLocaleString()} | ${row.pnl.toLocaleString()} | ${row.returnPct}% | ${row.dd}% | ${row.pf} | ${row.trades} | ${row.winRate}% |`),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
