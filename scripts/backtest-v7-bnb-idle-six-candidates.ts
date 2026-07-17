import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-bnb-idle-six-candidates");
const STEP_MS = 12 * 60 * 60 * 1000;
const CANDIDATES = ["XPL", "GPS", "NIGHT", "BARD", "SOLV", "TUT"] as const;

const PERIODS = [
  { key: "2024-H1", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 5, 30, 23, 59, 59, 999) },
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 3, 23, 23, 59, 59, 999) },
];

type Window = { startTs: number; endTs: number };

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(period: typeof PERIODS[number]): HybridVariantOptions {
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
  if (start != null && prev != null) {
    windows.push({ startTs: start, endTs: prev + STEP_MS });
  }
  return windows.filter((window) => window.endTs - window.startTs >= STEP_MS);
}

function candidateOptions(base: HybridVariantOptions, windows: readonly Window[], symbols: readonly string[]) {
  return {
    ...base,
    strictExtraTrendSymbols: symbols,
    strictExtraTrendAllowedWindows: windows,
    strictExtraTrendIdleOnly: true,
    strictExtraTrendDecisionTimeframe: "12h",
    strictExtraTrendExitCheckTimeframe: "12h",
    strictExtraTrendMinEfficiencyRatio: 0.2,
    strictExtraTrendMinVolumeRatio: 1.08,
    strictExtraTrendTrailActivationPct: 0.12,
    strictExtraTrendTrailRetracePct: 0.06,
    strictExtraTrendHardStopLossPct: 10,
    strictExtraTrendMaxHoldBars: 8,
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>, symbols: readonly string[]) {
  return {
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    candidatePnl: round(symbols.reduce((total, symbol) => total + (result.summary.symbol_contribution[symbol] ?? 0), 0)),
    candidateTrades: result.trade_pairs.filter((trade) => symbols.includes(trade.symbol)).length,
    bySymbol: Object.fromEntries(symbols.map((symbol) => [
      symbol,
      {
        pnl: round(result.summary.symbol_contribution[symbol] ?? 0),
        trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
      },
    ])),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];

  for (const period of PERIODS) {
    const base = baseOptions(period);
    const baseline = await runHybridBacktest("RETQ22", {
      ...base,
      label: `v7_base_${period.key}`,
    });
    const windows = cashWindowsFromBaseline(baseline);
    rows.push({
      period: period.key,
      variant: "v7_current",
      symbols: [],
      cashWindows: windows.length,
      summary: summarize(baseline, []),
    });

    for (const symbol of CANDIDATES) {
      const result = await runHybridBacktest("RETQ22", {
        ...candidateOptions(base, windows, [symbol]),
        label: `v7_idle_${symbol.toLowerCase()}_${period.key}`,
      });
      rows.push({
        period: period.key,
        variant: `idle_${symbol}`,
        symbols: [symbol],
        cashWindows: windows.length,
        summary: summarize(result, [symbol]),
        deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
      });
      console.log(`${period.key} ${symbol}: ${round(result.summary.end_equity)} delta=${round(result.summary.end_equity - baseline.summary.end_equity)}`);
    }

    const basket = await runHybridBacktest("RETQ22", {
      ...candidateOptions(base, windows, CANDIDATES),
      label: `v7_idle_six_basket_${period.key}`,
    });
    rows.push({
      period: period.key,
      variant: "idle_six_basket",
      symbols: [...CANDIDATES],
      cashWindows: windows.length,
      summary: summarize(basket, CANDIDATES),
      deltaEndEquity: round(basket.summary.end_equity - baseline.summary.end_equity),
    });
    console.log(`${period.key} basket: ${round(basket.summary.end_equity)} delta=${round(basket.summary.end_equity - baseline.summary.end_equity)}`);
  }

  const md = [
    "# V7 BNB Idle Six Candidate Backtest",
    "",
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    "- candidates: XPL / GPS / NIGHT / BARD / SOLV / TUT",
    "- entry scope: V7 cash windows only",
    "- logic: strict extra trend, 12h decision, volume >= 1.08, efficiency >= 0.20, trail 12%/6%, hard stop 10%, max hold 8 bars",
    "",
    "| period | variant | end equity | delta | MaxDD % | PF | trades | exposure % | candidate PnL | candidate trades |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.period} | ${row.variant} | ${row.summary.endEquity} | ${row.deltaEndEquity ?? 0} | ${row.summary.maxDrawdownPct} | ${row.summary.profitFactor} | ${row.summary.trades} | ${row.summary.exposurePct} | ${row.summary.candidatePnl} | ${row.summary.candidateTrades} |`),
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "backtest.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "backtest.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
