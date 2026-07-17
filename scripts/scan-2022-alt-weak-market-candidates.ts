import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { buildIndicatorBars, resampleTo12h } from "../lib/backtest/indicators";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2022-alt-candidate-scan");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0);
const END_TS = Date.UTC(2022, 11, 31, 23, 59, 59, 999);
const CACHE_ROOT = path.join(process.cwd(), ".cache", "v7-alt-2022-scan");
const FEE = 0.003;

const SYMBOLS = [
  "BNB", "XRP", "ADA", "DOT", "LTC", "BCH", "TRX", "LINK", "SHIB", "CAKE",
  "XVS", "MATIC", "NEAR", "FTM", "EOS", "AXS", "ALPACA", "DODO", "AAVE", "ATOM",
  "SFP", "DOGE", "ETH", "SOL", "TWT", "UNI", "AVAX",
];

type Variant = {
  key: string;
  minMom20: number;
  minAccel: number;
  minVolumeRatio: number;
  minEfficiency: number;
  breakoutLookback: number;
  breakoutPct: number;
  trailAct: number;
  trailRetrace: number;
  maxHold: number;
};

const VARIANTS: Variant[] = [
  { key: "quality_12h", minMom20: 0.03, minAccel: 0.005, minVolumeRatio: 0.9, minEfficiency: 0.18, breakoutLookback: 8, breakoutPct: 0.01, trailAct: 0.12, trailRetrace: 0.06, maxHold: 10 },
  { key: "fast_12h", minMom20: 0.015, minAccel: 0, minVolumeRatio: 0.8, minEfficiency: 0.12, breakoutLookback: 6, breakoutPct: 0.006, trailAct: 0.06, trailRetrace: 0.035, maxHold: 6 },
  { key: "strict_big_12h", minMom20: 0.06, minAccel: 0.01, minVolumeRatio: 1.05, minEfficiency: 0.22, breakoutLookback: 10, breakoutPct: 0.018, trailAct: 0.18, trailRetrace: 0.08, maxHold: 14 },
  { key: "rebound_12h", minMom20: 0.01, minAccel: 0.01, minVolumeRatio: 0.75, minEfficiency: 0.16, breakoutLookback: 5, breakoutPct: 0.004, trailAct: 0.05, trailRetrace: 0.025, maxHold: 4 },
];

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

async function loadSymbol(symbol: string) {
  const candles = await loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: START_TS,
    endMs: END_TS,
    interval: "1h",
  });
  if (candles.length < 500) return null;
  const bars = buildIndicatorBars(resampleTo12h(candles));
  return bars.filter((bar) => bar.ready);
}

function runSymbol(symbol: string, bars: Awaited<ReturnType<typeof loadSymbol>> extends infer T ? NonNullable<T> : never, variant: Variant) {
  let cash = 10_000;
  let qty = 0;
  let entry = 0;
  let peak = 0;
  let hold = 0;
  let wins = 0;
  let trades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const equity: number[] = [cash];
  const events: Array<{ entryTime: string; exitTime: string; pnl: number; exitReason: string }> = [];
  let openTime = "";

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
        events.push({ entryTime: openTime, exitTime: new Date(bar.ts).toISOString(), pnl, exitReason });
      }
    }

    if (qty <= 0) {
      const prev = bars.slice(index - variant.breakoutLookback, index);
      const recentHigh = Math.max(...prev.map((item) => item.high));
      const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
      const efficiency = Math.abs(bar.mom20) > 0 ? Math.abs(bar.close / bar.open - 1) / Math.abs(bar.mom20) : 0;
      const breakout = recentHigh > 0 ? bar.close / recentHigh - 1 : 0;
      const ok =
        bar.close > bar.sma40 &&
        bar.mom20 >= variant.minMom20 &&
        bar.momAccel >= variant.minAccel &&
        volumeRatio >= variant.minVolumeRatio &&
        efficiency >= variant.minEfficiency &&
        breakout >= variant.breakoutPct;
      if (ok) {
        entry = bar.open;
        qty = (cash * (1 - FEE)) / entry;
        cash = 0;
        peak = bar.high;
        hold = 0;
        openTime = new Date(bar.ts).toISOString();
      }
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
    events.push({ entryTime: openTime, exitTime: new Date(bar.ts).toISOString(), pnl, exitReason: "periodEnd" });
    equity.push(cash);
  }

  return {
    symbol,
    variant: variant.key,
    end: round(cash),
    pnl: round(cash - 10_000),
    dd: round(maxDrawdown(equity), 2),
    pf: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : grossProfit > 0 ? 999 : 0,
    trades,
    winRate: trades > 0 ? round((wins / trades) * 100, 1) : 0,
    events,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  for (const symbol of SYMBOLS) {
    try {
      const bars = await loadSymbol(symbol);
      if (!bars) {
        console.log(`${symbol}: no data`);
        continue;
      }
      for (const variant of VARIANTS) {
        const result = runSymbol(symbol, bars, variant);
        rows.push(result);
        console.log(`${symbol} ${variant.key}: end=${result.end} pnl=${result.pnl} dd=${result.dd}% pf=${result.pf} trades=${result.trades}`);
      }
    } catch (error) {
      console.log(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  rows.sort((left, right) => right.pnl - left.pnl || right.pf - left.pf);
  await fs.writeFile(path.join(REPORT_DIR, "results.json"), JSON.stringify(rows, null, 2), "utf8");
  const lines = [
    "# 2022 Alt Weak Market Candidate Scan",
    "",
    "| rank | symbol | variant | End | PnL | MaxDD | PF | Trades | Win% |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.slice(0, 40).map((row, index) => `| ${index + 1} | ${row.symbol} | ${row.variant} | ${row.end.toLocaleString()} | ${row.pnl.toLocaleString()} | ${row.dd}% | ${row.pf} | ${row.trades} | ${row.winRate}% |`),
  ];
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
