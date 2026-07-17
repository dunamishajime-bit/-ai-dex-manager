import fs from "fs/promises";
import path from "path";

import {
  buildReclaimHybridVariantOptions,
  RECLAIM_HYBRID_EXECUTION_PROFILE,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

type Window = {
  key: string;
  start: string;
  end: string;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-long-hold-rollup");
const WINDOWS: Window[] = [
  { key: "2024-07_to_2024-10", start: "2024-07-01", end: "2024-10-31" },
  { key: "2024-11_to_2025-02", start: "2024-11-01", end: "2025-02-28" },
  { key: "2025-03_to_2025-06", start: "2025-03-01", end: "2025-06-30" },
  { key: "2025-07_to_2025-10", start: "2025-07-01", end: "2025-10-31" },
  { key: "2025-11_to_2026-02", start: "2025-11-01", end: "2026-02-28" },
  { key: "2026-03_to_2026-04", start: "2026-03-01", end: "2026-04-23" },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguPnl: round(result.summary.symbol_contribution.PENGU ?? 0),
    penguTrades: result.trade_pairs.filter((row) => row.symbol === "PENGU").length,
  };
}

function isoStart(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function isoEnd(date: string) {
  return Date.parse(`${date}T23:59:59.999Z`);
}

async function runForWindow(window: Window) {
  const baseProfile = buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const common: HybridVariantOptions = {
    ...baseProfile,
    backtestStartTs: isoStart(window.start),
    backtestEndTs: isoEnd(window.end),
  };

  const preIdle: HybridVariantOptions = {
    ...common,
    idleBreakoutEntryWhileCash: false,
    idleBreakoutSymbols: undefined,
    label: `pre_idle_${window.key}`,
  };

  const withLongHold: HybridVariantOptions = {
    ...common,
    label: `with_long_hold_${window.key}`,
  };

  const [baselineResult, candidateResult] = await Promise.all([
    runHybridBacktest("RETQ22", preIdle),
    runHybridBacktest("RETQ22", withLongHold),
  ]);

  const baseline = summarize(baselineResult);
  const candidate = summarize(candidateResult);

  return {
    window: window.key,
    start: window.start,
    end: window.end,
    baseline,
    candidate,
    deltaEndEquity: round(candidate.endEquity - baseline.endEquity),
    deltaPenguPnl: round(candidate.penguPnl - baseline.penguPnl),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  for (const window of WINDOWS) {
    console.log(`running ${window.key}`);
    rows.push(await runForWindow(window));
  }

  const markdown = [
    "# PENGU Long Hold Rollup",
    "",
    "## Summary",
    "",
    "| period | baseline end | candidate end | delta | baseline DD | candidate DD | baseline PF | candidate PF | baseline PENGU | candidate PENGU | baseline PENGU trades | candidate PENGU trades |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => [
      `${row.start} .. ${row.end}`,
      row.baseline.endEquity.toLocaleString(),
      row.candidate.endEquity.toLocaleString(),
      row.deltaEndEquity.toLocaleString(),
      row.baseline.maxDrawdownPct,
      row.candidate.maxDrawdownPct,
      row.baseline.profitFactor,
      row.candidate.profitFactor,
      row.baseline.penguPnl.toLocaleString(),
      row.candidate.penguPnl.toLocaleString(),
      row.baseline.penguTrades,
      row.candidate.penguTrades,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
