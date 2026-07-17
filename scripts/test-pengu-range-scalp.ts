import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { analyzeHybridDecisionWindow, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import type { Candle1h } from "../lib/backtest/types";

type Window = { startTs: number; endTs: number };
type Trade = {
  entryTs: number;
  exitTs: number;
  entry: number;
  exit: number;
  pnlPct: number;
  reason: string;
  holdBars: number;
};
type Params = {
  key: string;
  lookback: number;
  entryBand: number;
  minRangePct: number;
  maxRangePct: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldBars: number;
  cooldownBars: number;
  minQuoteVolume: number;
  partialTakeProfitPct?: number;
  partialFraction?: number;
  partialStopPct?: number;
  profitTrailActivationPct?: number;
  profitTrailRetracePct?: number;
  minTrendMomPct?: number;
  maxTrendMomPct?: number;
  requireCloseAboveSma?: number;
  minVolumeRatio?: number;
  minPathPct?: number;
  minCrosses?: number;
  armLookback?: number;
  armMinRangePct?: number;
  armMaxRangePct?: number;
  armMinQuoteVolume?: number;
  armMinTrendMomPct?: number;
  armMaxTrendMomPct?: number;
  armRequireCloseAboveSma?: number;
  armMinPathPct?: number;
  armMinCrosses?: number;
  armMaxBars?: number;
  stopDisarmBars?: number;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-range-scalp");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2024, 6, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const RECENT_START_TS = Date.now() - 3 * 24 * 60 * 60 * 1000;
const STEP_MS = 12 * 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildCashOnlyWindows(points: Array<{ ts: number; decision: { desiredSymbol: string; desiredSide: string } }>) {
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

function cachePath(baseOptions: HybridVariantOptions) {
  const payload = JSON.stringify({ v: 1, startTs: START_TS, endTs: END_TS, baseOptions });
  const key = crypto.createHash("sha1").update(payload).digest("hex");
  return path.join(process.cwd(), ".cache", "hybrid-live-equivalent-windows", `${key}.json`);
}

async function loadCashWindows() {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const filePath = cachePath(base);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return (JSON.parse(raw) as { cashOnlyWindows: Window[] }).cashOnlyWindows;
  } catch {
    const windows = buildCashOnlyWindows(await analyzeHybridDecisionWindow("RETQ22", base));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ cashOnlyWindows: windows }), "utf8");
    return windows;
  }
}

function inWindows(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts < window.endTs);
}

function simulate(candles: Candle1h[], windows: readonly Window[], params: Params) {
  let equity = 10_000;
  let cooldownUntil = -1;
  let armedUntil = params.armMaxBars == null ? Number.POSITIVE_INFINITY : -1;
  let stoppedUntil = -1;
  let position: null | {
    entry: number;
    entryTs: number;
    entryIndex: number;
    remaining: number;
    realizedPnlPct: number;
    partialTaken: boolean;
    peak: number;
  } = null;
  const trades: Trade[] = [];

  for (let index = params.lookback + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!inWindows(candle.ts, windows)) {
      if (position) {
        const pnlPct = (candle.open / position.entry - 1) - FEE_RATE * 2;
        equity *= 1 + pnlPct;
        trades.push({
          entryTs: position.entryTs,
          exitTs: candle.ts,
          entry: position.entry,
          exit: candle.open,
          pnlPct,
          reason: "window-end",
          holdBars: index - position.entryIndex,
        });
        position = null;
        cooldownUntil = index + params.cooldownBars;
      }
      continue;
    }

    if (position) {
      const take = position.entry * (1 + params.takeProfitPct);
      const baseStop = position.entry * (1 - params.stopLossPct);
      const partialStop = params.partialStopPct != null && position.partialTaken
        ? position.entry * (1 + params.partialStopPct)
        : baseStop;
      const trailStop = params.profitTrailActivationPct != null && params.profitTrailRetracePct != null
        && position.peak >= position.entry * (1 + params.profitTrailActivationPct)
        ? position.peak * (1 - params.profitTrailRetracePct)
        : null;
      const stop = Math.max(partialStop, trailStop ?? partialStop);
      const holdBars = index - position.entryIndex;
      let exit: number | null = null;
      let reason = "";
      if (candle.low <= stop) {
        exit = stop;
        reason = "stop";
      } else if (candle.high >= take) {
        exit = take;
        reason = "take";
      } else if (holdBars >= params.maxHoldBars) {
        exit = candle.close;
        reason = "time";
      }
      if (exit == null && params.partialTakeProfitPct != null && params.partialFraction != null && !position.partialTaken) {
        const partialTake = position.entry * (1 + params.partialTakeProfitPct);
        if (candle.high >= partialTake) {
          const fraction = Math.min(Math.max(params.partialFraction, 0), position.remaining);
          position.realizedPnlPct += fraction * ((partialTake / position.entry - 1) - FEE_RATE * 2);
          position.remaining -= fraction;
          position.partialTaken = true;
        }
      }
      position.peak = Math.max(position.peak, candle.high);
      if (exit != null) {
        const pnlPct = position.realizedPnlPct + position.remaining * ((exit / position.entry - 1) - FEE_RATE * 2);
        equity *= 1 + pnlPct;
        trades.push({ entryTs: position.entryTs, exitTs: candle.ts, entry: position.entry, exit, pnlPct, reason, holdBars });
        if (reason === "stop" && params.stopDisarmBars != null) {
          stoppedUntil = index + params.stopDisarmBars;
          armedUntil = -1;
        }
        position = null;
        cooldownUntil = index + params.cooldownBars;
      }
      continue;
    }

    if (index < cooldownUntil) continue;
    if (params.armMaxBars != null) {
      if (index < stoppedUntil) continue;
      const armLookback = params.armLookback ?? Math.max(params.lookback, 24);
      if (index >= armLookback + 1) {
        const armPrior = candles.slice(index - armLookback, index);
        const armHigh = Math.max(...armPrior.map((row) => row.high));
        const armLow = Math.min(...armPrior.map((row) => row.low));
        const armWidthPct = armHigh / armLow - 1;
        const armQuoteVolume = candle.volume * candle.close;
        let armOk = true;
        if (params.armMinRangePct != null && armWidthPct < params.armMinRangePct) armOk = false;
        if (params.armMaxRangePct != null && armWidthPct > params.armMaxRangePct) armOk = false;
        if (params.armMinQuoteVolume != null && armQuoteVolume < params.armMinQuoteVolume) armOk = false;
        if (params.armRequireCloseAboveSma != null) {
          const armTrendBars = candles.slice(index - params.armRequireCloseAboveSma, index);
          if (armTrendBars.length < params.armRequireCloseAboveSma) {
            armOk = false;
          } else {
            const armSma = armTrendBars.reduce((sum, row) => sum + row.close, 0) / armTrendBars.length;
            if (candle.close < armSma) armOk = false;
          }
        }
        if (params.armMinTrendMomPct != null || params.armMaxTrendMomPct != null) {
          const trendLookback = candles[index - Math.min(index, 96)];
          const trendMomPct = trendLookback ? candle.close / trendLookback.close - 1 : 0;
          if (params.armMinTrendMomPct != null && trendMomPct < params.armMinTrendMomPct) armOk = false;
          if (params.armMaxTrendMomPct != null && trendMomPct > params.armMaxTrendMomPct) armOk = false;
        }
        if (params.armMinPathPct != null) {
          let armPathPct = 0;
          for (let i = 1; i < armPrior.length; i += 1) {
            armPathPct += Math.abs(armPrior[i].close / armPrior[i - 1].close - 1);
          }
          if (armPathPct < params.armMinPathPct) armOk = false;
        }
        if (params.armMinCrosses != null) {
          const armMid = (armHigh + armLow) / 2;
          let armCrosses = 0;
          let prev = armPrior[0].close >= armMid;
          for (const row of armPrior.slice(1)) {
            const cur = row.close >= armMid;
            if (cur !== prev) armCrosses += 1;
            prev = cur;
          }
          if (armCrosses < params.armMinCrosses) armOk = false;
        }
        if (armOk) armedUntil = Math.max(armedUntil, index + params.armMaxBars);
      }
      if (index > armedUntil) continue;
    }
    const prior = candles.slice(index - params.lookback, index);
    const trendBars = params.requireCloseAboveSma
      ? candles.slice(index - params.requireCloseAboveSma, index)
      : [];
    if (params.requireCloseAboveSma && trendBars.length < params.requireCloseAboveSma) continue;
    if (params.requireCloseAboveSma) {
      const sma = trendBars.reduce((sum, row) => sum + row.close, 0) / trendBars.length;
      if (candle.close < sma) continue;
    }
    if (params.minTrendMomPct != null) {
      const trendLookback = candles[index - Math.min(index, 96)];
      if (!trendLookback || candle.close / trendLookback.close - 1 < params.minTrendMomPct) continue;
    }
    if (params.maxTrendMomPct != null) {
      const trendLookback = candles[index - Math.min(index, 96)];
      if (!trendLookback || candle.close / trendLookback.close - 1 > params.maxTrendMomPct) continue;
    }
    const high = Math.max(...prior.map((row) => row.high));
    const low = Math.min(...prior.map((row) => row.low));
    const widthPct = high / low - 1;
    if (params.minPathPct != null) {
      let pathPct = 0;
      for (let i = 1; i < prior.length; i += 1) {
        pathPct += Math.abs(prior[i].close / prior[i - 1].close - 1);
      }
      if (pathPct < params.minPathPct) continue;
    }
    if (params.minCrosses != null) {
      const mid = (high + low) / 2;
      let crosses = 0;
      let prev = prior[0].close >= mid;
      for (const row of prior.slice(1)) {
        const cur = row.close >= mid;
        if (cur !== prev) crosses += 1;
        prev = cur;
      }
      if (crosses < params.minCrosses) continue;
    }
    const quoteVolume = candle.volume * candle.close;
    if (params.minVolumeRatio != null) {
      const avgQuoteVolume = prior.reduce((sum, row) => sum + row.volume * row.close, 0) / prior.length;
      if (quoteVolume / avgQuoteVolume < params.minVolumeRatio) continue;
    }
    if (widthPct < params.minRangePct || widthPct > params.maxRangePct) continue;
    if (quoteVolume < params.minQuoteVolume) continue;

    const lowerTrigger = low + (high - low) * params.entryBand;
    const bounced = candle.low <= lowerTrigger && candle.close > lowerTrigger;
    const notBreakingDown = candle.close > low * 1.002;
    if (bounced && notBreakingDown) {
      position = {
        entry: candle.close,
        entryTs: candle.ts,
        entryIndex: index,
        remaining: 1,
        realizedPnlPct: 0,
        partialTaken: false,
        peak: candle.high,
      };
    }
  }

  if (position) {
    const last = candles.at(-1)!;
    const pnlPct = position.realizedPnlPct + position.remaining * ((last.close / position.entry - 1) - FEE_RATE * 2);
    equity *= 1 + pnlPct;
    trades.push({
      entryTs: position.entryTs,
      exitTs: last.ts,
      entry: position.entry,
      exit: last.close,
      pnlPct,
      reason: "end",
      holdBars: candles.length - 1 - position.entryIndex,
    });
  }

  const wins = trades.filter((trade) => trade.pnlPct > 0);
  const losses = trades.filter((trade) => trade.pnlPct <= 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlPct, 0));
  return {
    key: params.key,
    endEquity: round(equity),
    returnPct: round((equity / 10_000 - 1) * 100),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? round((wins.length / trades.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : grossWin > 0 ? 999 : 0,
    avgPnlPct: trades.length ? round((trades.reduce((sum, trade) => sum + trade.pnlPct, 0) / trades.length) * 100, 3) : 0,
    maxLossPct: trades.length ? round(Math.min(...trades.map((trade) => trade.pnlPct)) * 100, 3) : 0,
    takeCount: trades.filter((trade) => trade.reason === "take").length,
    stopCount: trades.filter((trade) => trade.reason === "stop").length,
    timeCount: trades.filter((trade) => trade.reason === "time").length,
    windowEndCount: trades.filter((trade) => trade.reason === "window-end").length,
    tradesRaw: trades,
  };
}

function toMarkdown(title: string, rows: ReturnType<typeof simulate>[]) {
  return [
    `# ${title}`,
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "- Method: PENGU 15m range scalp on V7 base USDT/cash windows.",
    "",
    "| variant | End Equity | return % | PF | trades | W/L | win % | avg pnl % | max loss % | take/stop/time/window |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => [
      row.key,
      row.endEquity.toLocaleString(),
      row.returnPct,
      row.profitFactor,
      row.trades,
      `${row.wins}/${row.losses}`,
      row.winRatePct,
      row.avgPnlPct,
      row.maxLossPct,
      `${row.takeCount}/${row.stopCount}/${row.timeCount}/${row.windowEndCount}`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const candles = await loadHistoricalCandles({
    symbol: "PENGUUSDT",
    cacheRoot: path.join(process.cwd(), ".cache", "binance"),
    startMs: Math.min(START_TS, RECENT_START_TS),
    endMs: END_TS,
    interval: "15m",
  });
  const cashWindows = await loadCashWindows();
  const recentWindow = [{ startTs: RECENT_START_TS, endTs: END_TS }];
  const params: Params[] = [];
  for (const lookback of [8, 12, 16, 24]) {
    for (const takeProfitPct of [0.008, 0.01, 0.012, 0.016]) {
      for (const stopLossPct of [0.008, 0.01, 0.012, 0.014]) {
        for (const maxHoldBars of [4, 6, 8]) {
          params.push({
            key: `fast_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.28,
            minRangePct: 0.012,
            maxRangePct: 0.08,
            takeProfitPct,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 1,
            minQuoteVolume: 75_000,
          });
          params.push({
            key: `fast_upvol_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.28,
            minRangePct: 0.012,
            maxRangePct: 0.08,
            takeProfitPct,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 2,
            minQuoteVolume: 150_000,
            minTrendMomPct: 0.005,
            requireCloseAboveSma: 32,
            minVolumeRatio: 0.8,
          });
          params.push({
            key: `fast_tight_upvol_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.22,
            minRangePct: 0.018,
            maxRangePct: 0.07,
            takeProfitPct,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 2,
            minQuoteVolume: 250_000,
            minTrendMomPct: 0.01,
            requireCloseAboveSma: 32,
            minVolumeRatio: 1.0,
          });
          params.push({
            key: `postpump_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.24,
            minRangePct: 0.018,
            maxRangePct: 0.14,
            takeProfitPct,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 2,
            minQuoteVolume: 300_000,
            minTrendMomPct: 0.08,
            maxTrendMomPct: 0.45,
            requireCloseAboveSma: 32,
            minVolumeRatio: 0.9,
            minPathPct: 0.04,
            minCrosses: 2,
          });
          params.push({
            key: `hotrange_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.3,
            minRangePct: 0.025,
            maxRangePct: 0.18,
            takeProfitPct,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 2,
            minQuoteVolume: 500_000,
            minTrendMomPct: 0.12,
            maxTrendMomPct: 0.6,
            requireCloseAboveSma: 32,
            minVolumeRatio: 1.0,
            minPathPct: 0.055,
            minCrosses: 2,
          });
          params.push({
            key: `short_armed_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.28,
            minRangePct: 0.012,
            maxRangePct: 0.08,
            takeProfitPct,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 2,
            minQuoteVolume: 150_000,
            minVolumeRatio: 0.8,
            armLookback: 24,
            armMinRangePct: 0.04,
            armMaxRangePct: 0.18,
            armMinQuoteVolume: 350_000,
            armMinTrendMomPct: 0.05,
            armMaxTrendMomPct: 0.6,
            armRequireCloseAboveSma: 32,
            armMinPathPct: 0.06,
            armMinCrosses: 2,
            armMaxBars: 8,
            stopDisarmBars: 48,
          });
          params.push({
            key: `short_armed_strict_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.24,
            minRangePct: 0.018,
            maxRangePct: 0.07,
            takeProfitPct,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 2,
            minQuoteVolume: 250_000,
            minVolumeRatio: 1.0,
            armLookback: 32,
            armMinRangePct: 0.055,
            armMaxRangePct: 0.2,
            armMinQuoteVolume: 500_000,
            armMinTrendMomPct: 0.08,
            armMaxTrendMomPct: 0.65,
            armRequireCloseAboveSma: 32,
            armMinPathPct: 0.085,
            armMinCrosses: 3,
            armMaxBars: 6,
            stopDisarmBars: 96,
          });
          for (const partialTakeProfitPct of [0.016, 0.02, 0.024]) {
            params.push({
              key: `short_half_tp${Math.round(partialTakeProfitPct * 1000)}_lb${lookback}_tp${Math.round(takeProfitPct * 1000)}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
              lookback,
              entryBand: 0.24,
              minRangePct: 0.018,
              maxRangePct: 0.07,
              takeProfitPct,
              stopLossPct,
              maxHoldBars,
              cooldownBars: 2,
              minQuoteVolume: 250_000,
              minVolumeRatio: 1.0,
              partialTakeProfitPct,
              partialFraction: 0.5,
              partialStopPct: 0.006,
              profitTrailActivationPct: 0.03,
              profitTrailRetracePct: 0.018,
              armLookback: 32,
              armMinRangePct: 0.055,
              armMaxRangePct: 0.2,
              armMinQuoteVolume: 500_000,
              armMinTrendMomPct: 0.08,
              armMaxTrendMomPct: 0.65,
              armRequireCloseAboveSma: 32,
              armMinPathPct: 0.085,
              armMinCrosses: 3,
              armMaxBars: 6,
              stopDisarmBars: 96,
            });
          }
        }
      }
    }
  }
  for (const lookback of [8, 12, 16, 24]) {
    for (const partialTakeProfitPct of [0.012, 0.016, 0.02]) {
      for (const stopLossPct of [0.01, 0.012, 0.014]) {
        for (const maxHoldBars of [4, 6, 8, 12]) {
          params.push({
            key: `short_half_runner_pt${Math.round(partialTakeProfitPct * 1000)}_lb${lookback}_sl${Math.round(stopLossPct * 1000)}_h${maxHoldBars}`,
            lookback,
            entryBand: 0.24,
            minRangePct: 0.018,
            maxRangePct: 0.075,
            takeProfitPct: 0.08,
            stopLossPct,
            maxHoldBars,
            cooldownBars: 2,
            minQuoteVolume: 250_000,
            minVolumeRatio: 1.0,
            partialTakeProfitPct,
            partialFraction: 0.5,
            partialStopPct: 0.006,
            profitTrailActivationPct: Math.max(0.024, partialTakeProfitPct + 0.008),
            profitTrailRetracePct: 0.018,
            armLookback: 32,
            armMinRangePct: 0.055,
            armMaxRangePct: 0.2,
            armMinQuoteVolume: 500_000,
            armMinTrendMomPct: 0.08,
            armMaxTrendMomPct: 0.65,
            armRequireCloseAboveSma: 32,
            armMinPathPct: 0.085,
            armMinCrosses: 3,
            armMaxBars: 6,
            stopDisarmBars: 96,
          });
        }
      }
    }
  }

  const rows = params
    .map((param) => simulate(candles.filter((candle) => candle.ts >= START_TS && candle.ts <= END_TS), cashWindows, param))
    .sort((left, right) => right.endEquity - left.endEquity);
  const recentRows = params
    .map((param) => simulate(candles.filter((candle) => candle.ts >= RECENT_START_TS && candle.ts <= END_TS), recentWindow, param))
    .sort((left, right) => right.endEquity - left.endEquity);

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), [
    toMarkdown("V7 PENGU Range Scalp Historical Cash Windows", rows.slice(0, 30)),
    "## Recent 3 Days",
    "",
    toMarkdown("PENGU Range Scalp Recent 3 Days", recentRows.slice(0, 30)),
  ].join("\n"), "utf8");
  const trimRows = (items: typeof rows) => items.map(({ tradesRaw: _tradesRaw, ...row }) => row);
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify({ rows: trimRows(rows), recentRows: trimRows(recentRows) }, null, 2), "utf8");
  console.log(toMarkdown("V7 PENGU Range Scalp Historical Cash Windows", rows.slice(0, 15)));
  console.log(toMarkdown("PENGU Range Scalp Recent 3 Days", recentRows.slice(0, 15)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
