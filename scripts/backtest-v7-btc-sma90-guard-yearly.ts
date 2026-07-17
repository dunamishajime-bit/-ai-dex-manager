import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-btc-sma90-guard-yearly");
const DEFAULT_INITIAL_EQUITY = 10_000;
const WARMUP_DAYS = Number(process.env.BT_WARMUP_DAYS || 90);

const windows = [
  { key: "2022", executionStart: "2022-01-01", executionEnd: "2022-12-31" },
  { key: "2023", executionStart: "2023-01-01", executionEnd: "2023-12-31" },
  { key: "2024", executionStart: "2024-01-01", executionEnd: "2024-12-31" },
  { key: "2025", executionStart: "2025-01-01", executionEnd: "2025-12-31" },
  { key: "2026_ytd", executionStart: "2026-01-01", executionEnd: process.env.BT_END || "2026-05-15" },
];

function parseStart(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function parseEnd(date: string) {
  return Date.parse(`${date}T23:59:59.999Z`);
}

function addDays(ts: number, days: number) {
  return ts + days * 24 * 60 * 60 * 1000;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function symbolRows(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return Object.entries(result.summary.symbol_contribution)
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(Number(pnl)),
      trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
    }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
}

function guardOptions(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
    trendWeakMarketBlockRequireWeak2022: false,
    trendWeakMarketBlockBestMom20Below: null,
    trendWeakMarketBlockBtcAdxBelow: null,
    trendWeakMarketBlockWhenBtcBelowSma90: true,
    trendWeakMarketBlockBtcSma90DistanceBelow: 0,
  };
}

function markdown(rows: Array<{
  key: string;
  start: string;
  end: string;
  startEquity: number;
  endEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  trades: number;
  elapsedSec: number;
  symbols: ReturnType<typeof symbolRows>;
}>) {
  return [
    "# V7 BTC SMA90 Guard Yearly Relay",
    "",
    "- method: engine-direct V7 + BTC below SMA90 non-ETH block",
    "- block symbols: SOL / TWT / UNI / DOGE / AVAX / INJ / PENGU",
    `- warmup: ${WARMUP_DAYS} days`,
    `- final chained End Equity: ${rows.at(-1)?.endEquity.toLocaleString() ?? "n/a"}`,
    "",
    "| period | execution | start equity | end equity | return | MaxDD | PF | trades | sec |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.start} - ${row.end} | ${row.startEquity.toLocaleString()} | ${row.endEquity.toLocaleString()} | ${row.returnPct}% | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.elapsedSec} |`),
    "",
    "## Symbol PnL By Period",
    "",
    ...rows.flatMap((row) => [
      `### ${row.key}`,
      "",
      "| symbol | PnL | trades |",
      "| --- | ---: | ---: |",
      ...row.symbols.map((symbol) => `| ${symbol.symbol} | ${symbol.pnl.toLocaleString()} | ${symbol.trades} |`),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const options = guardOptions(base);
  let carriedEquity = Number(process.env.BT_INITIAL_EQUITY || DEFAULT_INITIAL_EQUITY);
  const rows = [];

  for (const window of windows) {
    const executionStartTs = parseStart(window.executionStart);
    const backtestStartTs = addDays(executionStartTs, -WARMUP_DAYS);
    const backtestEndTs = parseEnd(window.executionEnd);
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...options,
      initialEquity: carriedEquity,
      backtestStartTs,
      backtestExecutionStartTs: executionStartTs,
      backtestEndTs,
      label: `v7_btc_sma90_guard_${window.key}`,
    });
    const row = {
      key: window.key,
      start: window.executionStart,
      end: window.executionEnd,
      startEquity: round(carriedEquity),
      endEquity: round(result.summary.end_equity),
      returnPct: round(((result.summary.end_equity / carriedEquity) - 1) * 100, 2),
      maxDrawdownPct: round(result.summary.max_drawdown_pct, 2),
      profitFactor: round(result.summary.profit_factor, 3),
      trades: result.summary.trade_count,
      elapsedSec: round((Date.now() - started) / 1000, 1),
      symbols: symbolRows(result),
    };
    rows.push(row);
    carriedEquity = result.summary.end_equity;
    await fs.writeFile(path.join(REPORT_DIR, `${window.key}-trades.json`), JSON.stringify(result.trade_pairs, null, 2), "utf8");
    console.log(`${row.key}: start=${row.startEquity} end=${row.endEquity} return=${row.returnPct}% dd=${row.maxDrawdownPct}% pf=${row.profitFactor} trades=${row.trades} sec=${row.elapsedSec}`);
  }

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown(rows), "utf8");
  console.log(markdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
