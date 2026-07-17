import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE, buildReclaimHybridCashRescueVariantOptions } from "../config/reclaimHybridStrategy";
import { fetchBinanceKlines } from "../lib/backtest/binance-source";
import type { Candle1h } from "../lib/backtest/types";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-time-bias-12h-offset");
const JST_OFFSET_HOURS = 9;
const HOUR_MS = 60 * 60 * 1000;
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.now();

type BucketStats = {
  key: string;
  count: number;
  avgRetPct: number;
  avgAbsRetPct: number;
  avgRangePct: number;
  avgForward12hPct: number;
  bigUpCount: number;
  bigRangeCount: number;
  bigUpRatePct: number;
  bigRangeRatePct: number;
};

type EnrichedBar = Candle1h & {
  retPct: number;
  absRetPct: number;
  rangePct: number;
  forward12hPct: number;
  jstHour: number;
  jstWeekday: number;
  jstDay: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function jstDate(ts: number) {
  return new Date(ts + JST_OFFSET_HOURS * HOUR_MS);
}

function weekdayLabel(day: number) {
  return ["日", "月", "火", "水", "木", "金", "土"][day] ?? String(day);
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}時`;
}

function offsetToJstPair(offsetHours: number) {
  return [((offsetHours + JST_OFFSET_HOURS) % 24 + 24) % 24, ((offsetHours + JST_OFFSET_HOURS + 12) % 24 + 24) % 24];
}

function summarizeBucket(key: string, rows: EnrichedBar[]): BucketStats {
  const bigUpCount = rows.filter((bar) => bar.retPct >= 3 || bar.forward12hPct >= 6).length;
  const bigRangeCount = rows.filter((bar) => bar.rangePct >= 6).length;
  return {
    key,
    count: rows.length,
    avgRetPct: round(avg(rows.map((bar) => bar.retPct)), 3),
    avgAbsRetPct: round(avg(rows.map((bar) => bar.absRetPct)), 3),
    avgRangePct: round(avg(rows.map((bar) => bar.rangePct)), 3),
    avgForward12hPct: round(avg(rows.map((bar) => bar.forward12hPct)), 3),
    bigUpCount,
    bigRangeCount,
    bigUpRatePct: round((bigUpCount / Math.max(rows.length, 1)) * 100, 2),
    bigRangeRatePct: round((bigRangeCount / Math.max(rows.length, 1)) * 100, 2),
  };
}

function groupStats(rows: EnrichedBar[], keyOf: (bar: EnrichedBar) => string) {
  const buckets = new Map<string, EnrichedBar[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = buckets.get(key) || [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, bucket]) => summarizeBucket(key, bucket));
}

function scoreStats(row: BucketStats) {
  return row.bigUpRatePct * 3 + row.avgForward12hPct * 2 + row.avgRangePct + row.avgRetPct;
}

function buildRows(candles: Candle1h[]) {
  const byTs = new Map(candles.map((bar) => [bar.ts, bar]));
  const rows: EnrichedBar[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const bar = candles[index];
    const forward = byTs.get(bar.ts + 12 * HOUR_MS);
    const date = jstDate(bar.ts);
    const retPct = previous.close > 0 ? ((bar.close / previous.close) - 1) * 100 : 0;
    rows.push({
      ...bar,
      retPct,
      absRetPct: Math.abs(retPct),
      rangePct: bar.open > 0 ? ((bar.high - bar.low) / bar.open) * 100 : 0,
      forward12hPct: forward && bar.close > 0 ? ((forward.close / bar.close) - 1) * 100 : 0,
      jstHour: date.getUTCHours(),
      jstWeekday: date.getUTCDay(),
      jstDay: date.getUTCDate(),
    });
  }
  return rows;
}

function markdownStats(title: string, rows: BucketStats[], limit = 10) {
  return [
    `## ${title}`,
    "",
    "| bucket | count | avgRet% | avgAbs% | avgRange% | avgFwd12h% | bigUp% | bigRange% |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.slice(0, limit).map((row) => `| ${row.key} | ${row.count} | ${row.avgRetPct} | ${row.avgAbsRetPct} | ${row.avgRangePct} | ${row.avgForward12hPct} | ${row.bigUpRatePct} | ${row.bigRangeRatePct} |`),
    "",
  ].join("\n");
}

function candidateOffsets(hourStats: BucketStats[]) {
  const byHour = new Map(hourStats.map((row) => [Number(row.key), row]));
  return Array.from({ length: 12 }, (_, offset) => {
    const [hourA, hourB] = offsetToJstPair(offset);
    const statA = byHour.get(hourA) || summarizeBucket(String(hourA), []);
    const statB = byHour.get(hourB) || summarizeBucket(String(hourB), []);
    const score = round((scoreStats(statA) + scoreStats(statB)) / 2, 3);
    return {
      offset,
      jstPair: `${hourLabel(hourA)} / ${hourLabel(hourB)}`,
      score,
      avgForward12hPct: round((statA.avgForward12hPct + statB.avgForward12hPct) / 2, 3),
      bigUpRatePct: round((statA.bigUpRatePct + statB.bigUpRatePct) / 2, 2),
      avgRangePct: round((statA.avgRangePct + statB.avgRangePct) / 2, 3),
    };
  }).sort((left, right) => right.score - left.score);
}

async function runBacktests(offsets: number[]) {
  const { runHybridBacktest } = await import("../lib/backtest/hybrid-engine");
  const baseOptions = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };

  const out = [];
  for (const offset of offsets) {
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...baseOptions,
      trendDecisionOffsetHours: offset,
      label: `v7_12h_offset_${offset}`,
    });
    out.push({
      offset,
      jstPair: offsetToJstPair(offset).map(hourLabel).join(" / "),
      elapsedSec: round((Date.now() - started) / 1000, 1),
      endEquity: round(result.summary.end_equity),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      trades: result.summary.trade_count,
      penguPnl: round(Number(result.summary.symbol_contribution.PENGU || 0)),
      penguTrades: result.trade_pairs.filter((trade) => trade.symbol === "PENGU").length,
    });
    console.log(`offset ${offset} (${out.at(-1)?.jstPair}) endEquity=${out.at(-1)?.endEquity.toLocaleString()} elapsed=${out.at(-1)?.elapsedSec}s`);
  }
  return out.sort((left, right) => right.endEquity - left.endEquity);
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const candles = await fetchBinanceKlines("PENGUUSDT", Date.UTC(2024, 6, 1), END_TS, "1h");
  const rows = buildRows(candles).filter((row) => row.close > 0);
  const hourStats = groupStats(rows, (bar) => String(bar.jstHour)).sort((left, right) => scoreStats(right) - scoreStats(left));
  const weekdayStats = groupStats(rows, (bar) => weekdayLabel(bar.jstWeekday)).sort((left, right) => scoreStats(right) - scoreStats(left));
  const dayStats = groupStats(rows, (bar) => String(bar.jstDay)).sort((left, right) => scoreStats(right) - scoreStats(left));
  const weekdayHourStats = groupStats(rows, (bar) => `${weekdayLabel(bar.jstWeekday)} ${hourLabel(bar.jstHour)}`)
    .filter((row) => row.count >= 20)
    .sort((left, right) => scoreStats(right) - scoreStats(left));
  const offsetCandidates = candidateOffsets(hourStats);
  const envOffsets = process.env.BT_OFFSETS
    ? process.env.BT_OFFSETS.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 0 && value <= 11)
    : null;
  const offsetsToTest = envOffsets?.length
    ? [...new Set(envOffsets)].sort((left, right) => left - right)
    : [...new Set([0, ...offsetCandidates.slice(0, 5).map((row) => row.offset), ...Array.from({ length: 12 }, (_, index) => index)])]
      .sort((left, right) => left - right);
  const backtests = await runBacktests(offsetsToTest);

  const markdown = [
    "# PENGU Time Bias and 12H Offset Backtest",
    "",
    "- method: Binance PENGUUSDT 1h stats + engine-direct V7 live-equivalent backtest",
    "- baseline offset: UTC 0/12 = JST 09/21",
    `- stats period: ${new Date(candles[0]?.ts || Date.UTC(2024, 6, 1)).toISOString()} ～ ${new Date(candles.at(-1)?.ts || END_TS).toISOString()}`,
    `- backtest period: ${new Date(START_TS).toISOString()} ～ ${new Date(END_TS).toISOString()}`,
    "",
    markdownStats("JST Hour Ranking", hourStats, 12),
    markdownStats("Weekday Ranking", weekdayStats, 7),
    markdownStats("Day Of Month Ranking", dayStats, 12),
    markdownStats("Weekday x Hour Ranking", weekdayHourStats, 15),
    "## 12H Offset Candidates From Stats",
    "",
    "| offset UTC hour | JST decision pair | statScore | avgFwd12h% | bigUp% | avgRange% |",
    "| ---: | --- | ---: | ---: | ---: | ---: |",
    ...offsetCandidates.map((row) => `| ${row.offset} | ${row.jstPair} | ${row.score} | ${row.avgForward12hPct} | ${row.bigUpRatePct} | ${row.avgRangePct} |`),
    "",
    "## Engine-Direct Backtest",
    "",
    "| rank | offset UTC hour | JST decision pair | End Equity | diff vs JST09/21 | MaxDD | PF | trades | PENGU PnL | PENGU trades | elapsed |",
    "| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...backtests.map((row, index) => {
      const baseline = backtests.find((item) => item.offset === 0)?.endEquity ?? 0;
      return `| ${index + 1} | ${row.offset} | ${row.jstPair} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.penguTrades} | ${row.elapsedSec}s |`;
    }),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify({ hourStats, weekdayStats, dayStats, weekdayHourStats, offsetCandidates, backtests }, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
