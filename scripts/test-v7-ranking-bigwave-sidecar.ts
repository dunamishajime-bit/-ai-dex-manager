import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-ranking-bigwave-sidecar");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const CANDIDATES = [
  "BIO",
  "PROVE",
  "ALLO",
  "ZBT",
  "ZKC",
  "BANK",
  "TOWNS",
  "0G",
  "FF",
  "HOLO",
  "THE",
  "MITO",
] as const;

const CANDIDATE_GROUPS = [
  { key: "all12", symbols: CANDIDATES },
  { key: "prior4", symbols: ["BIO", "PROVE", "ALLO", "ZBT"] as const },
  { key: "low_quote", symbols: ["PROVE", "ALLO", "TOWNS", "FF", "MITO"] as const },
  { key: "bio_zbt_ff_mito", symbols: ["BIO", "ZBT", "FF", "MITO"] as const },
  { key: "bio_zbt", symbols: ["BIO", "ZBT"] as const },
  { key: "bio_only", symbols: ["BIO"] as const },
] as const;

const PERIODS = [
  { key: "2024-H1", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 5, 30, 23, 59, 59, 999) },
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: END_TS },
  { key: "2025", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2024-2026", startTs: START_TS, endTs: END_TS },
];

const VARIANTS = [
  {
    key: "bigwave_24h",
    maxHoldHours: 24,
    lookback: 8,
    breakoutPct: 0.012,
    minVolRatio: 1.12,
    minMom6: 0.025,
    minMom24: 0.04,
    minFourHourMom: 0.025,
    trailActivationPct: 0.12,
    trailRetracePct: 0.06,
    hardStopPct: 0.08,
    weakExitMinHours: 6,
    minScore: 11,
  },
  {
    key: "bigwave_48h",
    maxHoldHours: 48,
    lookback: 10,
    breakoutPct: 0.015,
    minVolRatio: 1.18,
    minMom6: 0.035,
    minMom24: 0.065,
    minFourHourMom: 0.04,
    trailActivationPct: 0.2,
    trailRetracePct: 0.1,
    hardStopPct: 0.1,
    weakExitMinHours: 10,
    minScore: 15,
  },
  {
    key: "runner_72h",
    maxHoldHours: 72,
    lookback: 12,
    breakoutPct: 0.018,
    minVolRatio: 1.22,
    minMom6: 0.04,
    minMom24: 0.08,
    minFourHourMom: 0.055,
    trailActivationPct: 0.28,
    trailRetracePct: 0.14,
    hardStopPct: 0.12,
    weakExitMinHours: 12,
    minScore: 18,
  },
  {
    key: "mega_120h",
    maxHoldHours: 120,
    lookback: 16,
    breakoutPct: 0.022,
    minVolRatio: 1.28,
    minMom6: 0.05,
    minMom24: 0.1,
    minFourHourMom: 0.07,
    trailActivationPct: 0.35,
    trailRetracePct: 0.18,
    hardStopPct: 0.14,
    weakExitMinHours: 18,
    minScore: 22,
  },
] as const;

const QUOTE_LOSS_PCT: Record<string, number> = {
  BIO: 0.6979,
  PROVE: 0.1761,
  ALLO: 0.0945,
  ZBT: 0.7178,
  ZKC: 0.5781,
  BANK: 0.4,
  TOWNS: 0.1608,
  "0G": 0.4084,
  FF: 0.1627,
  HOLO: 0.3578,
  THE: 0.6352,
  MITO: 0.1331,
};

type Window = { startTs: number; endTs: number };
type Signal = {
  symbol: string;
  ts: number;
  score: number;
  close: number;
  mom6: number;
  mom24: number;
  volRatio: number;
  breakoutPct: number;
  fourHourMom: number;
};

type Trade = {
  symbol: string;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  quoteLossPct: number;
  score: number;
  exitReason: string;
  maxRunupPct: number;
  maxDrawdownPct: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function baseOptions(period: { startTs: number; endTs: number }): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: period.startTs,
    backtestEndTs: period.endTs,
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const points = result.equity_curve.sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of points) {
    if (point.position_side === "cash") {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) {
      windows.push({ startTs: start, endTs: prev + STEP_MS });
      start = null;
      prev = null;
    }
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS });
  return windows.filter((window) => window.endTs - window.startTs >= HOUR_MS);
}

function isInsideWindow(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEndFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

async function loadCandidateCandles(startTs: number, endTs: number) {
  const out = new Map<string, Candle1h[]>();
  for (const symbol of CANDIDATES) {
    const candles = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      cacheRoot: CACHE_ROOT,
      startMs: Math.max(START_TS, startTs - 120 * HOUR_MS),
      endMs: endTs,
      interval: "1h",
    }).catch(() => []);
    out.set(symbol, candles.filter((bar) => bar.ts >= startTs - 120 * HOUR_MS && bar.ts <= endTs));
    console.log(`${symbol}: ${out.get(symbol)?.length ?? 0} candles`);
  }
  return out;
}

function candleIndexByTs(candles: Candle1h[]) {
  const map = new Map<number, number>();
  candles.forEach((bar, index) => map.set(bar.ts, index));
  return map;
}

function buildSignal(
  symbol: string,
  candles: Candle1h[],
  index: number,
  fourHourCandles: Candle1h[],
  variant: typeof VARIANTS[number],
): Signal | null {
  if (index < Math.max(30, variant.lookback + 1)) return null;
  const bar = candles[index];
  const prevBars = candles.slice(index - variant.lookback, index);
  const prevHigh = Math.max(...prevBars.map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
  const volRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
  const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
  const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;

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

  const score =
    mom6 * 120
    + mom24 * 80
    + fourHourMom * 100
    + breakoutPct * 180
    + Math.min(3, volRatio) * 2
    - Math.max(0, bar.close / candles[index - 1].close - 1 - 0.18) * 80;

  if (score < variant.minScore) return null;
  return { symbol, ts: bar.ts, score, close: bar.close, mom6, mom24, volRatio, breakoutPct, fourHourMom };
}

function simulateVariant(
  candlesBySymbol: Map<string, Candle1h[]>,
  windows: readonly Window[],
  variant: typeof VARIANTS[number],
  candidates: readonly string[],
): Trade[] {
  const indexMaps = new Map<string, Map<number, number>>();
  const fourHourBySymbol = new Map<string, Candle1h[]>();
  const allTs = new Set<number>();

  for (const [symbol, candles] of candlesBySymbol) {
    indexMaps.set(symbol, candleIndexByTs(candles));
    fourHourBySymbol.set(symbol, resampleToHours(candles, 4));
    candles.forEach((bar) => {
      if (isInsideWindow(bar.ts, windows)) allTs.add(bar.ts);
    });
  }

  const trades: Trade[] = [];
  let open: (Trade & { peakPrice: number; troughPrice: number; maxExitTs: number }) | null = null;

  for (const ts of [...allTs].sort((left, right) => left - right)) {
    if (open) {
      const candles = candlesBySymbol.get(open.symbol) ?? [];
      const index = indexMaps.get(open.symbol)?.get(ts);
      if (index == null) continue;
      const bar = candles[index];
      open.peakPrice = Math.max(open.peakPrice, bar.high);
      open.troughPrice = Math.min(open.troughPrice, bar.low);
      const holdingHours = (ts - open.entryTs) / HOUR_MS;
      const profitFromEntry = bar.close / open.entryPrice - 1;
      const drawdownFromEntry = bar.low / open.entryPrice - 1;
      const retraceFromPeak = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
      let exitReason: string | null = null;

      if (drawdownFromEntry <= -variant.hardStopPct) exitReason = "hard-stop";
      if (!exitReason && profitFromEntry >= variant.trailActivationPct && retraceFromPeak <= -variant.trailRetracePct) {
        exitReason = "profit-trail";
      }
      const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
      const mom6 = index >= 6 ? bar.close / candles[index - 6].close - 1 : 0;
      if (!exitReason && holdingHours >= variant.weakExitMinHours && bar.close < sma20 && mom6 < 0) {
        exitReason = "weak-exit";
      }
      if (!exitReason && (ts >= open.maxExitTs || !isInsideWindow(ts, windows))) exitReason = "max-hold-or-window-end";

      if (exitReason) {
        const grossReturnPct = bar.close / open.entryPrice - 1;
        const quoteLossPct = QUOTE_LOSS_PCT[open.symbol] ?? 1;
        const netReturnPct = grossReturnPct - (quoteLossPct / 100) * 2 - FEE_RATE * 2;
        trades.push({
          ...open,
          exitTs: ts,
          exitPrice: bar.close,
          grossReturnPct,
          netReturnPct,
          quoteLossPct,
          exitReason,
          maxRunupPct: open.peakPrice / open.entryPrice - 1,
          maxDrawdownPct: open.troughPrice / open.entryPrice - 1,
        });
        open = null;
      }
      continue;
    }

    const signals: Signal[] = [];
    for (const symbol of candidates) {
      const candles = candlesBySymbol.get(symbol) ?? [];
      const index = indexMaps.get(symbol)?.get(ts);
      if (index == null) continue;
      const signal = buildSignal(symbol, candles, index, fourHourBySymbol.get(symbol) ?? [], variant);
      if (signal) signals.push(signal);
    }
    signals.sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    const maxExitTs = Math.min(ts + variant.maxHoldHours * HOUR_MS, windowEndFor(ts, windows));
    if (maxExitTs <= ts) continue;
    open = {
      symbol: best.symbol,
      entryTs: ts,
      exitTs: ts,
      entryPrice: best.close,
      exitPrice: best.close,
      grossReturnPct: 0,
      netReturnPct: 0,
      quoteLossPct: QUOTE_LOSS_PCT[best.symbol] ?? 1,
      score: best.score,
      exitReason: "open",
      maxRunupPct: 0,
      maxDrawdownPct: 0,
      peakPrice: best.close,
      troughPrice: best.close,
      maxExitTs,
    };
  }

  return trades;
}

function summarizeTrades(trades: Trade[], baselineEndEquity: number) {
  const notionals = [100, 300, 500, 1000];
  const byNotional = Object.fromEntries(notionals.map((notional) => {
    const pnl = trades.reduce((sum, trade) => sum + notional * trade.netReturnPct, 0);
    return [String(notional), {
      pnl: round(pnl),
      endEquity: round(baselineEndEquity + pnl),
    }];
  }));
  const wins = trades.filter((trade) => trade.netReturnPct > 0).length;
  const grossProfit = trades.filter((trade) => trade.netReturnPct > 0).reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netReturnPct <= 0).reduce((sum, trade) => sum + trade.netReturnPct, 0));
  return {
    trades: trades.length,
    winRatePct: round((wins / Math.max(1, trades.length)) * 100),
    avgNetReturnPct: round(average(trades.map((trade) => trade.netReturnPct)) * 100, 3),
    bestNetReturnPct: round(Math.max(0, ...trades.map((trade) => trade.netReturnPct)) * 100, 2),
    worstNetReturnPct: round(Math.min(0, ...trades.map((trade) => trade.netReturnPct)) * 100, 2),
    profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    byNotional,
    bySymbol: Object.fromEntries(CANDIDATES.map((symbol) => {
      const rows = trades.filter((trade) => trade.symbol === symbol);
      return [symbol, {
        trades: rows.length,
        avgNetReturnPct: round(average(rows.map((trade) => trade.netReturnPct)) * 100, 3),
        cap300Pnl: round(rows.reduce((sum, trade) => sum + 300 * trade.netReturnPct, 0)),
      }];
    }).filter(([, value]) => value.trades > 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const candlesBySymbol = await loadCandidateCandles(START_TS, END_TS);
  const rows = [];
  const tradeRows: Array<{ period: string; variant: string } & Trade> = [];

  for (const period of PERIODS) {
    const baseline = await runHybridBacktest("RETQ22", {
      ...baseOptions(period),
      label: `v7_base_${period.key}`,
    });
    const windows = cashWindowsFromBaseline(baseline);
    const filteredCandles = new Map<string, Candle1h[]>();
    for (const [symbol, candles] of candlesBySymbol) {
      filteredCandles.set(symbol, candles.filter((bar) => bar.ts >= period.startTs - 120 * HOUR_MS && bar.ts <= period.endTs));
    }

    for (const group of CANDIDATE_GROUPS) {
      for (const variant of VARIANTS) {
        const trades = simulateVariant(filteredCandles, windows, variant, group.symbols);
        const summary = summarizeTrades(trades, baseline.summary.end_equity);
        rows.push({
          period: period.key,
          group: group.key,
          variant: variant.key,
          baselineEndEquity: round(baseline.summary.end_equity),
          baselineMaxDrawdownPct: round(baseline.summary.max_drawdown_pct),
          baselineTrades: baseline.summary.trade_count,
          baselineExposurePct: round(baseline.summary.exposure_pct),
          baselineCashPct: round(100 - baseline.summary.exposure_pct),
          cashWindows: windows.length,
          ...summary,
        });
        tradeRows.push(...trades.map((trade) => ({ period: period.key, group: group.key, variant: variant.key, ...trade })));
        console.log(`${period.key} ${group.key} ${variant.key}: trades=${summary.trades} cap300=${summary.byNotional["300"].pnl} end=${summary.byNotional["300"].endEquity}`);
      }
    }
  }

  rows.sort((left, right) =>
    String(left.period).localeCompare(String(right.period))
    || (right.byNotional["300"].pnl - left.byNotional["300"].pnl),
  );

  const md = [
    "# V7 Ranking Big-Wave Sidecar",
    "",
    "- method: V7 engine-direct baseline cash windows + Binance 1h candles via existing backtest data loader",
    "- assumption: V7 production logic remains unchanged; sidecar can enter only while V7 is cash/USDT",
    "- candidates: BIO / PROVE / ALLO / ZBT / ZKC / BANK / TOWNS / 0G / FF / HOLO / THE / MITO",
    "- quote cost: latest q300 value loss is charged twice, entry and exit, plus normal fee twice",
    "",
    "| period | group | variant | V7 end | trades | win % | avg net % | PF | cap100 pnl | cap100 end | cap300 pnl | cap300 end | cap500 pnl | cap500 end | cap1000 pnl | cap1000 end |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row: any) => `| ${row.period} | ${row.group} | ${row.variant} | ${row.baselineEndEquity} | ${row.trades} | ${row.winRatePct} | ${row.avgNetReturnPct} | ${row.profitFactor} | ${row.byNotional["100"].pnl} | ${row.byNotional["100"].endEquity} | ${row.byNotional["300"].pnl} | ${row.byNotional["300"].endEquity} | ${row.byNotional["500"].pnl} | ${row.byNotional["500"].endEquity} | ${row.byNotional["1000"].pnl} | ${row.byNotional["1000"].endEquity} |`),
    "",
    "## Best cap300 by period",
    "",
    ...PERIODS.map((period) => {
      const best = rows.filter((row) => row.period === period.key).sort((left, right) => right.byNotional["300"].pnl - left.byNotional["300"].pnl)[0] as any;
      return `- ${period.key}: ${best?.group ?? "-"}/${best?.variant ?? "-"} cap300 PnL ${best?.byNotional["300"].pnl ?? 0}, End Equity ${best?.byNotional["300"].endEquity ?? 0}, trades ${best?.trades ?? 0}`;
    }),
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  const tradesMd = [
    "# V7 Ranking Big-Wave Sidecar Trades",
    "",
    "| period | group | variant | symbol | entry | exit | gross % | net % | quote loss % | max runup % | max drawdown % | score | exit |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...tradeRows.map((trade) => `| ${trade.period} | ${trade.group} | ${trade.variant} | ${trade.symbol} | ${new Date(trade.entryTs).toISOString()} | ${new Date(trade.exitTs).toISOString()} | ${round(trade.grossReturnPct * 100, 2)} | ${round(trade.netReturnPct * 100, 2)} | ${trade.quoteLossPct} | ${round(trade.maxRunupPct * 100, 2)} | ${round(trade.maxDrawdownPct * 100, 2)} | ${round(trade.score, 2)} | ${trade.exitReason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.md"), tradesMd, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
