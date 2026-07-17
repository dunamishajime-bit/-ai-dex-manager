import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

type YearWindow = {
  key: string;
  executionStart: string;
  executionEnd: string;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-live-equivalent-yearly-relay");
const DEFAULT_INITIAL_EQUITY = 10_000;
const WARMUP_DAYS = Number(process.env.BT_WARMUP_DAYS || 180);

const windows: YearWindow[] = [
  { key: "2022", executionStart: "2022-01-01", executionEnd: "2022-12-31" },
  { key: "2023", executionStart: "2023-01-01", executionEnd: "2023-12-31" },
  { key: "2024", executionStart: "2024-01-01", executionEnd: "2024-12-31" },
  { key: "2025", executionStart: "2025-01-01", executionEnd: "2025-12-31" },
  { key: "2026_ytd", executionStart: "2026-01-01", executionEnd: process.env.BT_END || "2026-05-15" },
];
const requestedWindows = process.env.BT_WINDOWS
  ? new Set(process.env.BT_WINDOWS.split(",").map((item) => item.trim()).filter(Boolean))
  : null;
const activeWindows = requestedWindows
  ? windows.filter((window) => requestedWindows.has(window.key))
  : windows;

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

function summarizeSymbols(result: Awaited<ReturnType<typeof import("../lib/backtest/hybrid-engine").runHybridBacktest>>) {
  return Object.entries(result.summary.symbol_contribution)
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(Number(pnl)),
      trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
    }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
}

function toMarkdown(rows: Array<{
  key: string;
  start: string;
  end: string;
  warmupStart: string;
  startEquity: number;
  endEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  trades: number;
  elapsedSec: number;
  symbols: ReturnType<typeof summarizeSymbols>;
}>) {
  const final = rows.at(-1);
  const lines = [
    "# V7 Live Equivalent Yearly Relay Backtest",
    "",
    "- method: engine-direct live-equivalent V7",
    "- execution: yearly split with carried End Equity",
    `- warmup: ${WARMUP_DAYS} days before each yearly execution start`,
    `- final chained End Equity: ${final ? final.endEquity.toLocaleString() : "n/a"}`,
    "",
    "## Yearly Relay",
    "",
    "| period | execution | start equity | end equity | return | MaxDD | PF | trades | sec |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.start} - ${row.end} | ${row.startEquity.toLocaleString()} | ${row.endEquity.toLocaleString()} | ${row.returnPct}% | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.elapsedSec} |`),
    "",
    "## Symbol PnL By Period",
    "",
  ];

  for (const row of rows) {
    lines.push(`### ${row.key}`, "");
    lines.push("| symbol | PnL | trades |");
    lines.push("| --- | ---: | ---: |");
    for (const symbol of row.symbols) {
      lines.push(`| ${symbol.symbol} | ${symbol.pnl.toLocaleString()} | ${symbol.trades} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const [
    strategy,
    engine,
  ] = await Promise.all([
    import("../config/reclaimHybridStrategy"),
    import("../lib/backtest/hybrid-engine"),
  ]);
  const {
    RECLAIM_HYBRID_EXECUTION_PROFILE,
    buildReclaimHybridCashRescueVariantOptions,
  } = strategy;
  const { runHybridBacktest } = engine;

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  let carriedEquity = Number(process.env.BT_INITIAL_EQUITY || DEFAULT_INITIAL_EQUITY);
  const rows = [];

  for (const window of activeWindows) {
    const executionStartTs = parseStart(window.executionStart);
    const backtestStartTs = addDays(executionStartTs, -WARMUP_DAYS);
    const backtestEndTs = parseEnd(window.executionEnd);
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...baseOptions,
      initialEquity: carriedEquity,
      backtestStartTs,
      backtestExecutionStartTs: executionStartTs,
      backtestEndTs,
      label: `v7_live_equivalent_yearly_relay_${window.key}`,
    });
    const endEquity = round(result.summary.end_equity);
    const row = {
      key: window.key,
      start: window.executionStart,
      end: window.executionEnd,
      warmupStart: new Date(backtestStartTs).toISOString().slice(0, 10),
      startEquity: round(carriedEquity),
      endEquity,
      returnPct: round(((endEquity / carriedEquity) - 1) * 100, 2),
      maxDrawdownPct: round(result.summary.max_drawdown_pct, 2),
      profitFactor: round(result.summary.profit_factor, 3),
      trades: result.summary.trade_count,
      elapsedSec: round((Date.now() - started) / 1000, 1),
      symbols: summarizeSymbols(result),
    };
    rows.push(row);
    carriedEquity = result.summary.end_equity;
    await fs.writeFile(path.join(REPORT_DIR, `${window.key}-trades.json`), JSON.stringify(result.trade_pairs, null, 2), "utf8");
    console.log(`${window.key}: start=${row.startEquity} end=${row.endEquity} return=${row.returnPct}% dd=${row.maxDrawdownPct}% pf=${row.profitFactor} trades=${row.trades} sec=${row.elapsedSec}`);
  }

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
