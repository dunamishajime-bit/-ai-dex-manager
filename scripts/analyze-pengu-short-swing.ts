import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { resampleToHours, sma } from "../lib/backtest/indicators";
import type { Candle12h } from "../lib/backtest/types";

type Variant = {
  key: string;
  thesis: string;
  timeframeHours: number;
  lookback: number;
  breakoutPct: number;
  minVolumeRatio: number;
  minShortMom: number;
  requireDow: boolean;
  allowTrendlineReclaim: boolean;
  trailActivationPct: number;
  trailRetracePct: number;
  stopLossPct: number;
  maxHoldBars: number;
};

type Position = {
  entryTs: number;
  entryIndex: number;
  entryPrice: number;
  qty: number;
  peakPrice: number;
  reason: string;
} | null;

type Trade = {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  netPnl: number;
  returnPct: number;
  holdingBars: number;
  entryReason: string;
  exitReason: string;
};

const START_TS = Date.UTC(2023, 0, 1, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59);
const BASE_EQUITY = 10_000;
const FEE_RATE = 0.003;
const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-short-swing");

const VARIANTS: Variant[] = [
  {
    key: "resistance_dow_4h",
    thesis: "4H resistance breakout plus Dow higher-high/higher-low confirmation.",
    timeframeHours: 4,
    lookback: 12,
    breakoutPct: 0.004,
    minVolumeRatio: 1.05,
    minShortMom: 0.015,
    requireDow: true,
    allowTrendlineReclaim: false,
    trailActivationPct: 0.08,
    trailRetracePct: 0.035,
    stopLossPct: 0.055,
    maxHoldBars: 12,
  },
  {
    key: "trendline_reclaim_4h",
    thesis: "4H falling trendline reclaim, looser Dow gate for earlier entry.",
    timeframeHours: 4,
    lookback: 10,
    breakoutPct: 0.001,
    minVolumeRatio: 0.95,
    minShortMom: 0.004,
    requireDow: false,
    allowTrendlineReclaim: true,
    trailActivationPct: 0.065,
    trailRetracePct: 0.03,
    stopLossPct: 0.05,
    maxHoldBars: 10,
  },
  {
    key: "hybrid_two_day_swing_4h",
    thesis: "4H hybrid breakout/reclaim with two-day profit protection.",
    timeframeHours: 4,
    lookback: 12,
    breakoutPct: 0.0025,
    minVolumeRatio: 1,
    minShortMom: 0.008,
    requireDow: false,
    allowTrendlineReclaim: true,
    trailActivationPct: 0.06,
    trailRetracePct: 0.025,
    stopLossPct: 0.045,
    maxHoldBars: 12,
  },
  {
    key: "aggressive_two_day_swing_4h",
    thesis: "4H aggressive early entry with fastest stop/trailing.",
    timeframeHours: 4,
    lookback: 8,
    breakoutPct: 0.001,
    minVolumeRatio: 0.9,
    minShortMom: 0.003,
    requireDow: false,
    allowTrendlineReclaim: true,
    trailActivationPct: 0.045,
    trailRetracePct: 0.022,
    stopLossPct: 0.04,
    maxHoldBars: 8,
  },
  {
    key: "resistance_dow_6h",
    thesis: "6H resistance breakout plus Dow confirmation, reducing 4H noise.",
    timeframeHours: 6,
    lookback: 8,
    breakoutPct: 0.006,
    minVolumeRatio: 1.05,
    minShortMom: 0.012,
    requireDow: true,
    allowTrendlineReclaim: false,
    trailActivationPct: 0.075,
    trailRetracePct: 0.03,
    stopLossPct: 0.05,
    maxHoldBars: 8,
  },
  {
    key: "hybrid_two_day_swing_6h",
    thesis: "6H hybrid breakout/reclaim, balancing early entry and noise control.",
    timeframeHours: 6,
    lookback: 10,
    breakoutPct: 0.004,
    minVolumeRatio: 1,
    minShortMom: 0.01,
    requireDow: false,
    allowTrendlineReclaim: true,
    trailActivationPct: 0.065,
    trailRetracePct: 0.028,
    stopLossPct: 0.045,
    maxHoldBars: 8,
  },
  {
    key: "resistance_dow_12h_fast",
    thesis: "12H resistance breakout plus Dow confirmation, max 48-hour hold.",
    timeframeHours: 12,
    lookback: 5,
    breakoutPct: 0.008,
    minVolumeRatio: 1.05,
    minShortMom: 0.018,
    requireDow: true,
    allowTrendlineReclaim: false,
    trailActivationPct: 0.08,
    trailRetracePct: 0.035,
    stopLossPct: 0.055,
    maxHoldBars: 4,
  },
  {
    key: "resistance_dow_12h_3day",
    thesis: "12H resistance breakout plus Dow confirmation, max 72-hour hold.",
    timeframeHours: 12,
    lookback: 5,
    breakoutPct: 0.008,
    minVolumeRatio: 1.05,
    minShortMom: 0.018,
    requireDow: true,
    allowTrendlineReclaim: false,
    trailActivationPct: 0.08,
    trailRetracePct: 0.035,
    stopLossPct: 0.055,
    maxHoldBars: 6,
  },
  {
    key: "resistance_dow_12h_loose_trail",
    thesis: "12H resistance breakout plus Dow confirmation, looser trailing for meme extensions.",
    timeframeHours: 12,
    lookback: 5,
    breakoutPct: 0.008,
    minVolumeRatio: 1.05,
    minShortMom: 0.018,
    requireDow: true,
    allowTrendlineReclaim: false,
    trailActivationPct: 0.11,
    trailRetracePct: 0.05,
    stopLossPct: 0.06,
    maxHoldBars: 8,
  },
  {
    key: "resistance_break_12h_no_dow",
    thesis: "12H resistance breakout without strict Dow confirmation, checking whether earlier entry helps.",
    timeframeHours: 12,
    lookback: 5,
    breakoutPct: 0.008,
    minVolumeRatio: 1.05,
    minShortMom: 0.018,
    requireDow: false,
    allowTrendlineReclaim: false,
    trailActivationPct: 0.08,
    trailRetracePct: 0.035,
    stopLossPct: 0.055,
    maxHoldBars: 4,
  },
  {
    key: "hybrid_12h_two_to_three_day",
    thesis: "12H breakout/reclaim with 2-3 day profit protection.",
    timeframeHours: 12,
    lookback: 6,
    breakoutPct: 0.006,
    minVolumeRatio: 1,
    minShortMom: 0.015,
    requireDow: false,
    allowTrendlineReclaim: true,
    trailActivationPct: 0.075,
    trailRetracePct: 0.032,
    stopLossPct: 0.05,
    maxHoldBars: 6,
  },
];

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function fmtIso(ts: number) {
  return new Date(ts).toISOString();
}

function highSince(bars: Candle12h[], from: number, to: number) {
  return Math.max(...bars.slice(from, to).map((bar) => bar.high));
}

function lowSince(bars: Candle12h[], from: number, to: number) {
  return Math.min(...bars.slice(from, to).map((bar) => bar.low));
}

function regressionProjected(values: number[], nextX: number) {
  if (values.length < 3) return null;
  const xs = values.map((_, index) => index);
  const avgX = average(xs);
  const avgY = average(values);
  const denominator = xs.reduce((sum, x) => sum + ((x - avgX) ** 2), 0);
  if (denominator <= 0) return null;
  const slope = xs.reduce((sum, x, index) => sum + ((x - avgX) * (values[index] - avgY)), 0) / denominator;
  const intercept = avgY - slope * avgX;
  return { projected: intercept + slope * nextX, slope };
}

function recentPivots(bars: Candle12h[], endIndex: number, side: "high" | "low") {
  const pivots: Array<{ index: number; value: number }> = [];
  for (let i = 2; i <= endIndex - 2; i += 1) {
    const value = side === "high" ? bars[i].high : bars[i].low;
    const left = [bars[i - 2], bars[i - 1]];
    const right = [bars[i + 1], bars[i + 2]];
    const ok = side === "high"
      ? left.every((bar) => value > bar.high) && right.every((bar) => value > bar.high)
      : left.every((bar) => value < bar.low) && right.every((bar) => value < bar.low);
    if (ok) pivots.push({ index: i, value });
  }
  return pivots.slice(-3);
}

function entrySignal(bars: Candle12h[], index: number, variant: Variant) {
  if (index < Math.max(45, variant.lookback + 8)) return null;
  const bar = bars[index];
  const prev = bars[index - 1];
  const priorStart = Math.max(0, index - variant.lookback);
  const resistance = highSince(bars, priorStart, index);
  const support = lowSince(bars, priorStart, index);
  const closes = bars.slice(0, index + 1).map((item) => item.close);
  const volumes = bars.slice(0, index + 1).map((item) => item.volume);
  const sma10 = sma(closes, 10);
  const sma20 = sma(closes, 20);
  const volumeAvg20 = average(volumes.slice(-20));
  const volumeRatio = volumeAvg20 > 0 ? bar.volume / volumeAvg20 : 0;
  const shortMom = bar.close / bars[index - 2].close - 1;
  const longMom = bar.close / bars[index - 6].close - 1;

  const highs = recentPivots(bars, index - 1, "high");
  const lows = recentPivots(bars, index - 1, "low");
  const higherHigh = highs.length >= 2 ? highs.at(-1)!.value > highs.at(-2)!.value : bar.close > resistance;
  const higherLow = lows.length >= 2 ? lows.at(-1)!.value > lows.at(-2)!.value : bar.low > support * 1.01;
  const dowOk = higherHigh && higherLow;

  const breakoutOk =
    bar.close > resistance * (1 + variant.breakoutPct) &&
    prev.close <= resistance * (1 + variant.breakoutPct * 0.8);

  const highTrend = regressionProjected(
    bars.slice(index - variant.lookback, index).map((item) => item.high),
    variant.lookback,
  );
  const prevHighTrend = regressionProjected(
    bars.slice(index - variant.lookback - 1, index - 1).map((item) => item.high),
    variant.lookback,
  );
  const trendlineReclaimOk = Boolean(
    variant.allowTrendlineReclaim &&
    highTrend &&
    prevHighTrend &&
    highTrend.slope < 0 &&
    bar.close > highTrend.projected * 1.002 &&
    prev.close <= prevHighTrend.projected * 1.004 &&
    bar.close > sma10 &&
    shortMom >= variant.minShortMom,
  );

  const structureOk = variant.requireDow ? dowOk : (dowOk || higherLow || bar.close > sma20);
  const activityOk = volumeRatio >= variant.minVolumeRatio && shortMom >= variant.minShortMom && longMom > -0.08;
  const entryOk = structureOk && activityOk && (breakoutOk || trendlineReclaimOk);
  if (!entryOk) return null;

  const reason = [
    breakoutOk ? "resistance-break" : null,
    trendlineReclaimOk ? "trendline-reclaim" : null,
    dowOk ? "dow-hh-hl" : "light-structure",
    `vol${volumeRatio.toFixed(2)}`,
    `mom${(shortMom * 100).toFixed(2)}%`,
  ].filter(Boolean).join("|");

  return { reason };
}

function exitSignal(bars: Candle12h[], index: number, position: NonNullable<Position>, variant: Variant) {
  const bar = bars[index];
  const holdingBars = index - position.entryIndex;
  const returnPct = bar.close / position.entryPrice - 1;
  const drawdownFromPeak = bar.close / position.peakPrice - 1;
  const closes = bars.slice(0, index + 1).map((item) => item.close);
  const sma10 = sma(closes, 10);
  const priorLow = lowSince(bars, Math.max(0, index - 4), index);

  if (returnPct <= -variant.stopLossPct) return "hard-stop";
  if (returnPct >= variant.trailActivationPct && drawdownFromPeak <= -variant.trailRetracePct) return "profit-trail";
  if (holdingBars >= 2 && returnPct > 0 && bar.close < sma10) return "sma10-profit-exit";
  if (holdingBars >= 2 && bar.close < priorLow * 0.995) return "micro-structure-break";
  if (holdingBars >= variant.maxHoldBars) return "two-day-time-exit";
  return null;
}

function calcMaxDrawdown(equity: Array<{ equity: number }>) {
  let peak = equity[0]?.equity ?? BASE_EQUITY;
  let worst = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    worst = Math.min(worst, (point.equity / peak - 1) * 100);
  }
  return worst;
}

function runVariant(bars: Candle12h[], variant: Variant) {
  let cash = BASE_EQUITY;
  let position: Position = null;
  const trades: Trade[] = [];
  const equity: Array<{ ts: number; equity: number }> = [];

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];

    if (position) {
      position.peakPrice = Math.max(position.peakPrice, bar.high);
      const exitReason = exitSignal(bars, index, position, variant);
      if (exitReason) {
        const grossProceeds = position.qty * bar.close;
        const grossPnl = grossProceeds - position.qty * position.entryPrice;
        const fee = (position.qty * position.entryPrice * FEE_RATE) + (grossProceeds * FEE_RATE);
        const netPnl = grossPnl - fee;
        cash += grossProceeds * (1 - FEE_RATE);
        trades.push({
          entryTime: fmtIso(position.entryTs),
          exitTime: fmtIso(bar.ts),
          entryPrice: position.entryPrice,
          exitPrice: bar.close,
          netPnl,
          returnPct: ((bar.close / position.entryPrice) - 1) * 100,
          holdingBars: Math.max(1, index - position.entryIndex),
          entryReason: position.reason,
          exitReason,
        });
        position = null;
      }
    }

    if (!position) {
      const signal = entrySignal(bars, index, variant);
      if (signal) {
        const notional = cash;
        const qty = notional / bar.close;
        cash -= notional * (1 + FEE_RATE);
        position = {
          entryTs: bar.ts,
          entryIndex: index,
          entryPrice: bar.close,
          qty,
          peakPrice: bar.close,
          reason: signal.reason,
        };
      }
    }

    const mark = position ? cash + position.qty * bar.close * (1 - FEE_RATE) : cash;
    equity.push({ ts: bar.ts, equity: mark });
  }

  if (position) {
    const bar = bars.at(-1)!;
    const grossProceeds = position.qty * bar.close;
    const grossPnl = grossProceeds - position.qty * position.entryPrice;
    const fee = (position.qty * position.entryPrice * FEE_RATE) + (grossProceeds * FEE_RATE);
    const netPnl = grossPnl - fee;
    cash += grossProceeds * (1 - FEE_RATE);
    trades.push({
      entryTime: fmtIso(position.entryTs),
      exitTime: fmtIso(bar.ts),
      entryPrice: position.entryPrice,
      exitPrice: bar.close,
      netPnl,
      returnPct: ((bar.close / position.entryPrice) - 1) * 100,
      holdingBars: Math.max(1, bars.length - 1 - position.entryIndex),
      entryReason: position.reason,
      exitReason: "final-close",
    });
    equity.push({ ts: bar.ts, equity: cash });
  }

  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl <= 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const years = (bars.at(-1)!.ts - bars[0]!.ts) / (365.25 * 24 * 60 * 60 * 1000);
  const endEquity = equity.at(-1)?.equity ?? cash;

  return {
    key: variant.key,
    thesis: variant.thesis,
    timeframeHours: variant.timeframeHours,
    startEquity: BASE_EQUITY,
    endEquity,
    cagrPct: ((endEquity / BASE_EQUITY) ** (1 / years) - 1) * 100,
    maxDrawdownPct: calcMaxDrawdown(equity),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    tradeCount: trades.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgHoldHours: trades.length ? average(trades.map((trade) => trade.holdingBars * variant.timeframeHours)) : 0,
    wins: wins.length,
    losses: losses.length,
    exitReasons: Object.fromEntries(
      [...new Set(trades.map((trade) => trade.exitReason))]
        .map((reason) => [
          reason,
          {
            count: trades.filter((trade) => trade.exitReason === reason).length,
            pnl: trades.filter((trade) => trade.exitReason === reason).reduce((sum, trade) => sum + trade.netPnl, 0),
          },
        ]),
    ),
    topTrades: [...trades].sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl)).slice(0, 12),
    trades,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const raw = await loadHistoricalCandles({
    symbol: "PENGUUSDT",
    cacheRoot: path.join(process.cwd(), ".cache", "pengu-only-current"),
    startMs: START_TS,
    endMs: END_TS,
  });
  const rows = VARIANTS.map((variant) => {
    const bars = resampleToHours(raw, variant.timeframeHours).filter((bar) => bar.close > 0);
    return runVariant(bars, variant);
  });

  const best = [...rows].sort((left, right) => right.endEquity - left.endEquity)[0];
  const md = [
    "# PENGU Short Swing Dedicated Logic",
    "",
    "PENGU-only dedicated tests using resistance breakouts, Dow-style higher-high/higher-low checks, falling trendline reclaim, and max two-to-three-day exits.",
    "",
    `Data: ${fmtIso(raw[0]?.ts ?? START_TS)} - ${fmtIso(raw.at(-1)?.ts ?? END_TS)}`,
    "",
    "| variant | tf | end equity | CAGR % | MaxDD % | PF | trades | win % | avg hold h | thesis |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.key} | ${row.timeframeHours}H | ${row.endEquity.toFixed(2)} | ${row.cagrPct.toFixed(2)} | ${row.maxDrawdownPct.toFixed(2)} | ${Number.isFinite(row.profitFactor) ? row.profitFactor.toFixed(3) : "inf"} | ${row.tradeCount} | ${row.winRatePct.toFixed(2)} | ${row.avgHoldHours.toFixed(1)} | ${row.thesis} |`),
    "",
    "## Best Variant Detail",
    "",
    `Best: ${best.key}`,
    "",
    JSON.stringify({
      endEquity: best.endEquity,
      cagrPct: best.cagrPct,
      maxDrawdownPct: best.maxDrawdownPct,
      profitFactor: best.profitFactor,
      tradeCount: best.tradeCount,
      winRatePct: best.winRatePct,
      avgHoldHours: best.avgHoldHours,
      exitReasons: best.exitReasons,
      topTrades: best.topTrades,
    }, null, 2),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  for (const row of rows) {
    console.log(`${row.key}: end=${row.endEquity.toFixed(2)} CAGR=${row.cagrPct.toFixed(2)} MaxDD=${row.maxDrawdownPct.toFixed(2)} PF=${Number.isFinite(row.profitFactor) ? row.profitFactor.toFixed(3) : "inf"} trades=${row.tradeCount}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
