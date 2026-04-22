import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "sol-replacement-candidates");
const FULL_START = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const FULL_END = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const LATEST_START = Date.UTC(2025, 11, 31, 0, 0, 0, 0);
const LATEST_END = Date.UTC(2026, 3, 17, 23, 59, 59, 999);

const CANDIDATES = ["LINK", "NEAR", "LTC", "XRP", "ATOM", "AAVE", "UNI", "ADA", "TRX", "INJ"] as const;

type CandidateSymbol = (typeof CANDIDATES)[number];

type WindowConfig = {
  key: "full" | "latest";
  startTs: number;
  endTs: number;
  title: string;
};

type VariantSummary = {
  label: string;
  replacement: string;
  endEquity: number;
  cagrPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  tradeCount: number;
  winRatePct: number;
  exposurePct: number;
  replacementPnl: number;
  symbolContribution: Record<string, number>;
  error?: string;
};

const WINDOWS: WindowConfig[] = [
  {
    key: "full",
    startTs: FULL_START,
    endTs: FULL_END,
    title: "Full Window",
  },
  {
    key: "latest",
    startTs: LATEST_START,
    endTs: LATEST_END,
    title: "Latest Window",
  },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildReplacementOptions(symbol: CandidateSymbol, window: WindowConfig) {
  const base = buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const expandedTrendSymbols = RECLAIM_HYBRID_EXECUTION_PROFILE.expandedTrendSymbols.map((item) =>
    item === "SOL" ? symbol : item,
  );
  const trendScoreAdjustmentBySymbol = Object.fromEntries(
    Object.entries(RECLAIM_HYBRID_EXECUTION_PROFILE.trendScoreAdjustmentBySymbol).filter(([key]) => key !== "SOL"),
  );

  return {
    ...base,
    expandedTrendSymbols,
    trendScoreAdjustmentBySymbol,
    backtestStartTs: window.startTs,
    backtestEndTs: window.endTs,
    label: `v4_replace_sol_with_${symbol.toLowerCase()}_${window.key}`,
  } as const;
}

function buildBaseOptions(window: WindowConfig) {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: window.startTs,
    backtestEndTs: window.endTs,
    label: `v4_baseline_${window.key}`,
  } as const;
}

function summarizeResult(label: string, replacement: string, summary: any): VariantSummary {
  return {
    label,
    replacement,
    endEquity: round(summary.end_equity),
    cagrPct: round(summary.cagr_pct),
    maxDrawdownPct: round(summary.max_drawdown_pct),
    profitFactor: round(summary.profit_factor, 3),
    tradeCount: summary.trade_count,
    winRatePct: round(summary.win_rate_pct),
    exposurePct: round(summary.exposure_pct),
    replacementPnl: round(summary.symbol_contribution[replacement] ?? 0),
    symbolContribution: Object.fromEntries(
      Object.entries(summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

async function runWindow(window: WindowConfig) {
  const baseline = await runHybridBacktest("RETQ22", buildBaseOptions(window));
  const rows: VariantSummary[] = [
    summarizeResult("baseline_v4", "SOL", baseline.summary),
  ];

  for (const candidate of CANDIDATES) {
    try {
      const result = await runHybridBacktest("RETQ22", buildReplacementOptions(candidate, window));
      rows.push(summarizeResult(`replace_SOL_with_${candidate}`, candidate, result.summary));
    } catch (error) {
      rows.push({
        label: `replace_SOL_with_${candidate}`,
        replacement: candidate,
        endEquity: Number.NEGATIVE_INFINITY,
        cagrPct: 0,
        maxDrawdownPct: 0,
        profitFactor: 0,
        tradeCount: 0,
        winRatePct: 0,
        exposurePct: 0,
        replacementPnl: 0,
        symbolContribution: {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  rows.sort((left, right) => right.endEquity - left.endEquity);

  return {
    window,
    baseline: summarizeResult("baseline_v4", "SOL", baseline.summary),
    rows,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const results = [];
  for (const window of WINDOWS) {
    results.push(await runWindow(window));
  }

  const md = [
    "# SOL Replacement Candidates",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- baseline trend symbols: ${RECLAIM_HYBRID_EXECUTION_PROFILE.expandedTrendSymbols.join(", ")}`,
    `- compared replacements: ${CANDIDATES.join(", ")}`,
    "",
    ...results.flatMap((entry) => [
      `## ${entry.window.title}`,
      "",
      `- start_utc: ${new Date(entry.window.startTs).toISOString()}`,
      `- end_utc: ${new Date(entry.window.endTs).toISOString()}`,
      "",
      "| variant | end equity | CAGR % | MaxDD % | PF | trades | repl pnl |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...entry.rows.map(
        (row) =>
          row.error
            ? `| ${row.label} | error | - | - | - | - | ${row.error.replaceAll("|", "/")} |`
            : `| ${row.label} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.replacementPnl} |`,
      ),
      "",
      "### Symbol Contribution",
      "",
      ...entry.rows.filter((row) => !row.error).map((row) => {
        const topSymbols = Object.entries(row.symbolContribution)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([symbol, pnl]) => `${symbol} ${pnl}`);
        return `- ${row.label}: ${topSymbols.join(" / ")}`;
      }),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(results, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
