import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { buildIndicatorBars, resampleToHours } from "../lib/backtest/indicators";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { IndicatorBar } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-mito-candidate");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2024, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 22, 23, 59, 59, 999);

type Case = {
  key: string;
  symbols: string[];
  opts: Partial<HybridVariantOptions>;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_mito_engine_direct",
    ...extra,
  };
}

const currentRunner: Partial<HybridVariantOptions> = {
  idleBreakoutEntryWhileCash: true,
  idleBreakoutEntryTimeframe: "1h",
  idleBreakoutAllowTradeGateOff: true,
  idleBreakoutBreakoutLookbackBars: 12,
  idleBreakoutBreakoutMinPct: 0.02,
  idleBreakoutMinVolumeRatio: 1.2,
  idleBreakoutMinMomAccel: -0.002,
  idleBreakoutMinEfficiencyRatio: 0.12,
  idleBreakoutProfitTrailActivationPct: 0.26,
  idleBreakoutProfitTrailRetracePct: 0.10,
  idleBreakoutMaxHoldBars: 72,
  idleBreakoutWeakExitMom20Below: 0.02,
  idleBreakoutWeakExitMomAccelBelow: -0.01,
  idleBreakoutWeakExitMinHoldBars: 10,
  idleBreakoutWeakExitRequireCloseBelowSma40: true,
};

const mitoFast: Partial<HybridVariantOptions> = {
  ...currentRunner,
  idleBreakoutBreakoutLookbackBars: 8,
  idleBreakoutBreakoutMinPct: 0.016,
  idleBreakoutMinVolumeRatio: 1.15,
  idleBreakoutProfitTrailActivationPct: 0.18,
  idleBreakoutProfitTrailRetracePct: 0.085,
  idleBreakoutMaxHoldBars: 48,
  idleBreakoutWeakExitMinHoldBars: 8,
};

const mitoPriorityFast: Partial<HybridVariantOptions> = {
  ...mitoFast,
  trendScoreAdjustmentBySymbol: {
    ...(RECLAIM_HYBRID_EXECUTION_PROFILE.trendScoreAdjustmentBySymbol ?? {}),
    MITO: 999,
  },
};

const cases: Case[] = [
  { key: "current_v7", symbols: [], opts: {} },
  { key: "mito_current_runner", symbols: ["MITO"], opts: currentRunner },
  { key: "mito_fast48", symbols: ["MITO"], opts: mitoFast },
  { key: "current_plus_mito_runner", symbols: ["PENGU", "APE", "COS", "MITO"], opts: currentRunner },
  { key: "current_plus_mito_fast48", symbols: ["PENGU", "APE", "COS", "MITO"], opts: mitoFast },
  { key: "current_plus_mito_fast48_mito_priority", symbols: ["PENGU", "APE", "COS", "MITO"], opts: mitoPriorityFast },
];

const requestedCases = new Set(
  (process.env.CASES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const selectedCases = requestedCases.size
  ? cases.filter((testCase) => requestedCases.has(testCase.key))
  : cases;

function maxCloseInRange(series: IndicatorBar[], start: number, end: number) {
  return Math.max(...series.slice(Math.max(0, start), Math.max(0, end)).map((bar) => bar.close));
}

function calcEfficiencyRatio(series: IndicatorBar[], index: number, lookback: number) {
  if (index - lookback < 0) return 0;
  const net = Math.abs(series[index].close - series[index - lookback].close);
  let path = 0;
  for (let offset = index - lookback + 1; offset <= index; offset += 1) {
    path += Math.abs(series[offset].close - series[offset - 1].close);
  }
  return path > 0 ? net / path : 0;
}

function latestIndexAtOrBefore(series: IndicatorBar[], ts: number) {
  let lo = 0;
  let hi = series.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

async function auditMitoOverlaps(
  result: Awaited<ReturnType<typeof runHybridBacktest>>,
  options: Partial<HybridVariantOptions>,
) {
  const mitoEntries = result.trade_pairs
    .filter((trade) => trade.symbol === "MITO" && trade.entry_reason.includes("idle-breakout-entry"))
    .map((trade) => ({ ...trade, entryTs: Date.parse(trade.entry_time) }));
  if (!mitoEntries.length) return null;

  const symbols = ["PENGU", "APE", "COS", "MITO"];
  const indicators = new Map<string, IndicatorBar[]>();
  for (const symbol of symbols) {
    const candles = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      interval: "1h",
      startMs: START_TS - 120 * 24 * 60 * 60 * 1000,
      endMs: END_TS,
      cacheRoot: CACHE_ROOT,
    });
    indicators.set(symbol, buildIndicatorBars(resampleToHours(candles, 1)));
  }

  const lookback = options.idleBreakoutBreakoutLookbackBars ?? 12;
  const breakoutMin = options.idleBreakoutBreakoutMinPct ?? 0.02;
  const minVolumeRatio = options.idleBreakoutMinVolumeRatio ?? 1.2;
  const minMomAccel = options.idleBreakoutMinMomAccel ?? -0.002;
  const minEfficiency = options.idleBreakoutMinEfficiencyRatio ?? 0.12;
  const scoreAdjustment = options.trendScoreAdjustmentBySymbol ?? {};

  const rows = mitoEntries.map((trade) => {
    const evaluations = symbols.map((symbol) => {
      const series = indicators.get(symbol) ?? [];
      const index = latestIndexAtOrBefore(series, trade.entryTs);
      const bar = index >= 0 ? series[index] : null;
      if (!bar || !bar.ready) return { symbol, eligible: false, score: null, reason: "not-ready" };
      const prevHigh = lookback == null || index - lookback < 0 ? 0 : maxCloseInRange(series, index - lookback, index);
      const breakoutOk = lookback == null || prevHigh <= 0 ? true : bar.close > prevHigh * (1 + breakoutMin);
      const distanceFromSmaPct = bar.sma40 > 0 ? (bar.close / bar.sma40 - 1) * 100 : 0;
      const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
      const efficiencyRatio = calcEfficiencyRatio(series, index, 6);
      const eligible = bar.close > bar.sma40
        && bar.mom20 > 0
        && breakoutOk
        && volumeRatio >= minVolumeRatio
        && bar.momAccel >= minMomAccel
        && efficiencyRatio >= minEfficiency;
      const score = bar.mom20 * 100
        + distanceFromSmaPct
        + bar.adx14 / 5
        + (scoreAdjustment[symbol] ?? 0);
      return {
        symbol,
        eligible,
        score: round(score, 4),
        mom20: round(bar.mom20, 4),
        momAccel: round(bar.momAccel, 4),
        volumeRatio: round(volumeRatio, 4),
        efficiencyRatio: round(efficiencyRatio, 4),
        close: bar.close,
      };
    }).sort((left, right) => Number(right.score ?? -9999) - Number(left.score ?? -9999));
    return {
      entryTime: trade.entry_time,
      exitTime: trade.exit_time,
      netPnl: round(trade.net_pnl),
      eligibleCompetitors: evaluations.filter((row) => row.eligible && row.symbol !== "MITO").map((row) => row.symbol),
      mitoRankByScore: evaluations.findIndex((row) => row.symbol === "MITO") + 1,
      evaluations,
    };
  });

  const summary = {
    mitoTrades: rows.length,
    overlappedTrades: rows.filter((row) => row.eligibleCompetitors.length > 0).length,
    competitorCounts: Object.fromEntries(symbols
      .filter((symbol) => symbol !== "MITO")
      .map((symbol) => [symbol, rows.filter((row) => row.eligibleCompetitors.includes(symbol)).length])),
  };
  await fs.writeFile(path.join(REPORT_DIR, "mito-overlap-audit.json"), JSON.stringify({ summary, rows }, null, 2), "utf8");
  const md = [
    "# MITO Overlap Audit",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    `- MITO idle trades: ${summary.mitoTrades}`,
    `- MITO entries with another eligible candidate: ${summary.overlappedTrades}`,
    `- competitor counts: ${JSON.stringify(summary.competitorCounts)}`,
    "",
    "| entry | MITO rank | competitors | MITO net PnL | top evaluations |",
    "| --- | ---: | --- | ---: | --- |",
    ...rows.map((row) => `| ${row.entryTime} | ${row.mitoRankByScore} | ${row.eligibleCompetitors.join(", ") || "-"} | ${row.netPnl} | ${row.evaluations.slice(0, 4).map((item) => `${item.symbol}:${item.eligible ? "Y" : "n"}:${item.score}`).join(" / ")} |`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "mito-overlap-audit.md"), md, "utf8");
  return summary;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  for (const testCase of selectedCases) {
    console.log(`running ${testCase.key}`);
    const result = await runHybridBacktest("RETQ22", baseOptions({
      ...testCase.opts,
      idleBreakoutSymbols: testCase.symbols.length
        ? testCase.symbols
        : RECLAIM_HYBRID_EXECUTION_PROFILE.idleBreakoutSymbols,
      label: testCase.key,
    }));
    const audit = process.env.AUDIT_MITO_OVERLAPS === "1" && testCase.key.includes("mito")
      ? await auditMitoOverlaps(result, testCase.opts)
      : null;
    const symbols = ["MITO", "PENGU", "APE", "COS", "TWT", "ETH", "SOL", "DOGE"];
    rows.push({
      key: testCase.key,
      endEquity: result.summary.end_equity,
      maxDd: result.summary.max_drawdown_pct,
      pf: result.summary.profit_factor,
      trades: result.summary.trade_count,
      symbols: Object.fromEntries(symbols.map((symbol) => [
        symbol,
        {
          trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
          pnl: round(result.trade_pairs
            .filter((trade) => trade.symbol === symbol)
            .reduce((sum, trade) => sum + trade.net_pnl, 0)),
        },
      ])),
      audit,
    });
  }
  const base = rows[0].endEquity;
  const md = [
    "# V7 MITO Candidate Engine-Direct Backtest",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: runHybridBacktest engine-direct, MITO idleBreakout candidate checks",
    "- note: validation only; no production config changed.",
    "",
    "| case | End Equity | vs current | MaxDD | PF | trades | symbols |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.key} | ${round(row.endEquity)} | ${round(row.endEquity - base)} | ${round(row.maxDd)}% | ${round(row.pf, 3)} | ${row.trades} | ${JSON.stringify(row.symbols)} |`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "engine-direct.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "engine-direct.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
