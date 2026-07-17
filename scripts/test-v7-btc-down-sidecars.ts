import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  RECLAIM_HYBRID_SLIPPAGE_BPS,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { buildIndicatorBars, resampleTo12h, resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h, EquityPoint, IndicatorBar } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-btc-down-sidecars");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Number(process.env.BT_START_TS ?? Date.UTC(2022, 0, 1));
const END_TS = Number(process.env.BT_END_TS ?? Date.UTC(2026, 4, 22, 23, 59, 59, 999));
const HOUR_MS = 60 * 60 * 1000;
const TWELVE_HOUR_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

type Window = { startTs: number; endTs: number };
type RegimeKey = "no_btc_filter" | "btc_weak_or" | "btc_weak_and" | "btc_down_mom";
type VariantKey = "twt12_existing" | "bio_dusk_existing" | "twt12_plus_bio_dusk_existing";
type Signal = { source: "TWT12" | "BIO_DUSK"; symbol: "TWT" | "BIO" | "DUSK"; ts: number; close: number; score: number };
type Trade = {
  source: "TWT12" | "BIO_DUSK";
  symbol: "TWT" | "BIO" | "DUSK";
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  notionalUsd: number;
  netReturnPct: number;
  netPnl: number;
  exitReason: string;
  btcCloseBelowSma40: boolean;
  btcMom20: number;
};

const BTC_REGIMES: Record<RegimeKey, (bar: IndicatorBar | null) => boolean> = {
  no_btc_filter: () => true,
  btc_weak_or: (bar) => !!bar?.ready && (bar.close < bar.sma40 || bar.mom20 < 0),
  btc_weak_and: (bar) => !!bar?.ready && bar.close < bar.sma40 && bar.mom20 < 0,
  btc_down_mom: (bar) => !!bar?.ready && bar.mom20 < 0,
};

const VARIANTS: Record<VariantKey, readonly Signal["source"][]> = {
  twt12_existing: ["TWT12"],
  bio_dusk_existing: ["BIO_DUSK"],
  twt12_plus_bio_dusk_existing: ["TWT12", "BIO_DUSK"],
};

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

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_btc_down_sidecar_base",
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

function slippageRate(symbol: string) {
  return (RECLAIM_HYBRID_SLIPPAGE_BPS[`${symbol}_USDT`] ?? 100) / 10000;
}

async function loadCandles(symbol: string, interval: "1h") {
  return loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: START_TS - 180 * 24 * HOUR_MS,
    endMs: END_TS,
    interval,
  });
}

function twtSignal(candles12h: Candle1h[], indicators: IndicatorBar[], index: number): Signal | null {
  const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar;
  if (!cfg.enabled || index < 90) return null;
  const bar = candles12h[index];
  const ind = indicators[index];
  const prevHigh = Math.max(...candles12h.slice(index - cfg.lookbackBars, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const efficiency = pathEfficiency(candles12h, index, cfg.lookbackBars);
  if (!ind.ready) return null;
  if (bar.close <= ind.sma40) return null;
  if (ind.mom20 < cfg.minMom20) return null;
  if (breakoutPct < cfg.breakoutMinPct) return null;
  if (volumeRatio < cfg.minVolumeRatio) return null;
  if (ind.momAccel < cfg.minMomAccel) return null;
  if (efficiency < cfg.minEfficiencyRatio) return null;
  if (ind.adx14 < cfg.minAdx14) return null;
  const score = ind.mom20 * 100 + ind.momAccel * 180 + breakoutPct * 150 + Math.min(4, volumeRatio) * 4 + efficiency * 18 + ind.adx14 * 0.15;
  return { source: "TWT12", symbol: "TWT", ts: bar.ts, close: bar.close, score };
}

function bioDuskSignal(symbol: "BIO" | "DUSK", candles: Candle1h[], fourHourCandles: Candle1h[], index: number): Signal | null {
  const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
  const activeFrom = Date.parse(cfg.activeFrom[symbol]);
  if (!cfg.enabled || !cfg.symbols.includes(symbol) || index < Math.max(30, cfg.lookbackBars + 1)) return null;
  const bar = candles[index];
  if (bar.ts < activeFrom) return null;
  const prevHigh = Math.max(...candles.slice(index - cfg.lookbackBars, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
  const volRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
  const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
  const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
  const oneHourJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
  const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 1;
  const fourHour = [...fourHourCandles].reverse().find((item) => item.ts <= bar.ts);
  const fourHourIndex = fourHour ? fourHourCandles.findIndex((item) => item.ts === fourHour.ts) : -1;
  const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0
    ? fourHour!.close / fourHourCandles[fourHourIndex - 3].close - 1
    : 0;
  if (breakoutPct < cfg.breakoutMinPct) return null;
  if (volRatio < cfg.minVolumeRatio) return null;
  if (mom6 < cfg.minMom6) return null;
  if (mom24 < cfg.minMom24) return null;
  if (fourHourMom < cfg.minFourHourMom) return null;
  if (oneHourJump > cfg.maxOneHourJump) return null;
  if (closeLocation < cfg.minCloseLocation) return null;
  const score = mom6 * 120 + mom24 * 90 + fourHourMom * 120 + breakoutPct * 180 + Math.min(3.5, volRatio) * 2 + closeLocation * 4;
  return score >= cfg.minScore ? { source: "BIO_DUSK", symbol, ts: bar.ts, close: bar.close, score } : null;
}

function summarize(trades: Trade[], baseEnd: number) {
  const pnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const gains = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const losses = trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);
  const hours = trades.reduce((sum, trade) => sum + Math.max(0, trade.exitTs - trade.entryTs) / HOUR_MS, 0);
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pf: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : 0,
    pnl: round(pnl, 2),
    endWithSidecar: round(baseEnd + pnl, 2),
    addedDays: round(hours / 24, 2),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = await runHybridBacktest("RETQ22", baseOptions());
  const points = base.equity_curve.sort((left, right) => left.ts - right.ts);
  const cashPct = round(100 - base.summary.exposure_pct, 2);

  const [btc1h, twt1h, bio1h, dusk1h] = await Promise.all([
    loadCandles("BTC", "1h"),
    loadCandles("TWT", "1h"),
    loadCandles("BIO", "1h").catch(() => []),
    loadCandles("DUSK", "1h").catch(() => []),
  ]);
  const btc12hIndicators = buildIndicatorBars(resampleTo12h(btc1h));
  const twt12h = resampleTo12h(twt1h);
  const twt12hIndicators = buildIndicatorBars(twt12h);
  const bio4h = resampleToHours(bio1h, 4);
  const dusk4h = resampleToHours(dusk1h, 4);

  const rawSignals: Signal[] = [];
  for (let index = 0; index < twt12h.length; index += 1) {
    const signal = twtSignal(twt12h, twt12hIndicators, index);
    if (signal) rawSignals.push(signal);
  }
  for (let index = 0; index < bio1h.length; index += 1) {
    const signal = bioDuskSignal("BIO", bio1h, bio4h, index);
    if (signal) rawSignals.push(signal);
  }
  for (let index = 0; index < dusk1h.length; index += 1) {
    const signal = bioDuskSignal("DUSK", dusk1h, dusk4h, index);
    if (signal) rawSignals.push(signal);
  }

  const priceBySymbolTs = new Map<string, Candle1h>();
  for (const bar of twt12h) priceBySymbolTs.set(`TWT:${bar.ts}`, bar);
  for (const bar of bio1h) priceBySymbolTs.set(`BIO:${bar.ts}`, bar);
  for (const bar of dusk1h) priceBySymbolTs.set(`DUSK:${bar.ts}`, bar);

  const rows = [];
  const details: Record<string, Trade[]> = {};
  for (const [variantKey, sources] of Object.entries(VARIANTS) as Array<[VariantKey, readonly Signal["source"][]]>) {
    for (const [regimeKey, regimeOk] of Object.entries(BTC_REGIMES) as Array<[RegimeKey, (bar: IndicatorBar | null) => boolean]>) {
      const signals = rawSignals
        .filter((signal) => sources.includes(signal.source))
        .filter((signal) => signal.ts >= START_TS && signal.ts <= END_TS)
        .filter((signal) => {
          const point = findPointAtOrBefore(points, signal.ts);
          if (!cashIsUsable(point)) return false;
          const btc = findIndicatorAtOrBefore(btc12hIndicators, signal.ts);
          return regimeOk(btc);
        })
        .sort((left, right) => left.ts === right.ts ? right.score - left.score : left.ts - right.ts);

      const trades: Trade[] = [];
      let open: (Trade & { peakPrice: number; maxExitTs: number }) | null = null;
      const timeline = [...new Set([...signals.map((signal) => signal.ts), ...rawSignals.map((signal) => signal.ts)])].sort((left, right) => left - right);

      for (const ts of timeline) {
        if (open) {
          const bar = priceBySymbolTs.get(`${open.symbol}:${ts}`);
          if (bar) {
            open.peakPrice = Math.max(open.peakPrice, bar.high);
            const cfg = open.source === "TWT12"
              ? RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar
              : RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
            const grossReturn = bar.close / open.entryPrice - 1;
            const drawdown = bar.low / open.entryPrice - 1;
            const retrace = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
            let exitReason: string | null = null;
            if (drawdown <= -cfg.hardStopPct) exitReason = "hard-stop";
            if (!exitReason && grossReturn >= cfg.profitTrailActivationPct && retrace <= -cfg.profitTrailRetracePct) exitReason = "profit-trail";
            if (!exitReason && ts >= open.maxExitTs) exitReason = "max-hold";
            const point = findPointAtOrBefore(points, ts);
            if (!exitReason && !cashIsUsable(point)) exitReason = "cash-window-end";
            if (exitReason) {
              const slip = slippageRate(open.symbol);
              const netReturnPct = bar.close / open.entryPrice - 1 - (slip + FEE_RATE) * 2;
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

        const candidates = signals.filter((signal) => signal.ts === ts).sort((left, right) => right.score - left.score);
        const best = candidates[0];
        if (!best) continue;
        const point = findPointAtOrBefore(points, best.ts);
        if (!cashIsUsable(point)) continue;
        const btc = findIndicatorAtOrBefore(btc12hIndicators, best.ts);
        const cfg = best.source === "TWT12"
          ? RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar
          : RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
        const notionalUsd = best.source === "TWT12"
          ? Math.max(0, point!.cash * RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar.sleeveFraction)
          : Math.min(
            RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar.maxNotionalUsdBySymbol?.[best.symbol as "BIO" | "DUSK"]
              ?? RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar.maxNotionalUsd,
            point!.cash,
          );
        if (notionalUsd < 25) continue;
        open = {
          source: best.source,
          symbol: best.symbol,
          entryTs: best.ts,
          exitTs: best.ts,
          entryPrice: best.close,
          exitPrice: best.close,
          notionalUsd,
          netReturnPct: 0,
          netPnl: 0,
          exitReason: "open",
          peakPrice: best.close,
          maxExitTs: best.ts + cfg.maxHoldHours * HOUR_MS,
          btcCloseBelowSma40: !!btc?.ready && btc.close < btc.sma40,
          btcMom20: btc?.mom20 ?? 0,
        };
      }

      const summary = summarize(trades, base.summary.end_equity);
      const key = `${variantKey}_${regimeKey}`;
      details[key] = trades;
      rows.push({
        variant: variantKey,
        btcRegime: regimeKey,
        baseEnd: round(base.summary.end_equity, 2),
        baseCashPct: cashPct,
        ...summary,
        bySymbol: Object.fromEntries(["TWT", "BIO", "DUSK"].map((symbol) => [
          symbol,
          {
            trades: trades.filter((trade) => trade.symbol === symbol).length,
            pnl: round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.netPnl, 0), 2),
          },
        ])),
      });
      console.log(`${key}: pnl=${summary.pnl} trades=${summary.trades} win=${summary.winPct}% pf=${summary.pf}`);
    }
  }

  rows.sort((left, right) => right.pnl - left.pnl);
  const md = [
    "# V7 BTC-Down Sidecars",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue profile",
    "- test: existing TWT 12H sleeve and existing BIO/DUSK 1H sidecar, only while V7 has usable USDT/cash",
    `- period: ${iso(START_TS)} - ${iso(END_TS)}`,
    `- base end equity: ${round(base.summary.end_equity, 2)}`,
    `- base cash/USDT pct: ${cashPct}%`,
    "",
    "| rank | variant | BTC regime | end + sidecar | pnl | trades | win % | PF | added days | by symbol |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.variant} | ${row.btcRegime} | ${row.endWithSidecar} | ${row.pnl} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.addedDays} | ${JSON.stringify(row.bySymbol)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify({ rows, details }, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
