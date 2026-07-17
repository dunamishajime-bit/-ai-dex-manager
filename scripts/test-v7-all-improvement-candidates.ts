import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-all-improvement-candidates");
const START_TS = Date.UTC(2022, 0, 1);
const END_TS = Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const CURRENT_V7_END_EQUITY = 153_074_698.82;
const PATTERN = process.env.PATTERN ? new Set(process.env.PATTERN.split(",").map((value) => value.trim()).filter(Boolean)) : null;

type Case = [string, Partial<HybridVariantOptions>, string];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  return {
    ...(buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    ...extra,
  };
}

function mergeAlloc(extra: Partial<HybridVariantOptions>, alloc: Record<string, number>): Partial<HybridVariantOptions> {
  return {
    ...extra,
    trendAllocBySymbol: {
      ...(extra.trendAllocBySymbol ?? {}),
      ...alloc,
    },
  };
}

function withTwtPartial(rule: {
  baseTakeProfitPct: number;
  strongTakeProfitPct: number;
  runnerTrailActivationPct: number;
  runnerTrailRetracePct: number;
  stopAfterPartialPct?: number;
}): Partial<HybridVariantOptions> {
  const current = RECLAIM_HYBRID_EXECUTION_PROFILE.partialExitBySymbol ?? {};
  return {
    partialExitBySymbol: {
      ...current,
      TWT: {
        ...(current.TWT ?? {
          fraction: 0.5,
          strongMinMomAccel: 0.02,
          strongMinVolumeRatio: 1.25,
        }),
        fraction: 0.5,
        strongMinMomAccel: 0.02,
        strongMinVolumeRatio: 1.25,
        ...rule,
      },
    },
  };
}

function symbolRows(trades: Array<{ symbol: string; net_pnl: number }>) {
  const rows = new Map<string, { symbol: string; trades: number; pnl: number }>();
  for (const trade of trades) {
    const row = rows.get(trade.symbol) ?? { symbol: trade.symbol, trades: 0, pnl: 0 };
    row.trades += 1;
    row.pnl += trade.net_pnl;
    rows.set(trade.symbol, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, pnl: round(row.pnl) }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
}

async function runCase(label: string, extra: Partial<HybridVariantOptions>, group: string) {
  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", baseOptions({ ...extra, label }));
  const trades = result.trade_pairs;
  return {
    group,
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: round(trades.filter((trade) => trade.symbol === "PENGU").reduce((sum, trade) => sum + trade.net_pnl, 0)),
    twtPnl: round(trades.filter((trade) => trade.symbol === "TWT").reduce((sum, trade) => sum + trade.net_pnl, 0)),
    ethPnl: round(trades.filter((trade) => trade.symbol === "ETH").reduce((sum, trade) => sum + trade.net_pnl, 0)),
    dogePnl: round(trades.filter((trade) => trade.symbol === "DOGE").reduce((sum, trade) => sum + trade.net_pnl, 0)),
    symbolRows: symbolRows(trades),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows.find((row) => row.label === "current_v7")?.endEquity ?? CURRENT_V7_END_EQUITY;
  const best = [...rows].sort((left, right) => right.endEquity - left.endEquity)[0];
  return [
    "# V7 All Improvement Candidates",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- baseline: currently implemented V7, ETH 20% + DOGE 1/3, BIO/DUSK sidecar remains live-side small overlay",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    best ? `- best: ${best.label} (${best.group}) End Equity ${best.endEquity.toLocaleString()}` : "",
    "",
    "| group | pattern | End Equity | vs current | MaxDD | PF | trades | exposure | PENGU | ETH | DOGE | TWT | elapsed |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.group} | ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.ethPnl.toLocaleString()} | ${row.dogePnl.toLocaleString()} | ${row.twtPnl.toLocaleString()} | ${row.elapsedSec}s |`),
    "",
    "## Best By Group",
    "",
    ...[...new Set(rows.map((row) => row.group))].map((group) => {
      const bestInGroup = rows.filter((row) => row.group === group).sort((left, right) => right.endEquity - left.endEquity)[0];
      return `- ${group}: ${bestInGroup.label} End ${bestInGroup.endEquity.toLocaleString()} / vs current ${round(bestInGroup.endEquity - baseline).toLocaleString()}`;
    }),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "",
      "| symbol | pnl | trades |",
      "| --- | ---: | ---: |",
      ...row.symbolRows.map((symbol) => `| ${symbol.symbol} | ${symbol.pnl.toLocaleString()} | ${symbol.trades} |`),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const cases: Case[] = [
    ["current_v7", {}, "baseline"],

    ["alloc_eth10_doge25", mergeAlloc({}, { ETH: 0.10, DOGE: 0.25 }), "alloc-grid"],
    ["alloc_eth10_doge33", mergeAlloc({}, { ETH: 0.10, DOGE: 1 / 3 }), "alloc-grid"],
    ["alloc_eth10_doge40", mergeAlloc({}, { ETH: 0.10, DOGE: 0.40 }), "alloc-grid"],
    ["alloc_eth15_doge25", mergeAlloc({}, { ETH: 0.15, DOGE: 0.25 }), "alloc-grid"],
    ["alloc_eth15_doge33", mergeAlloc({}, { ETH: 0.15, DOGE: 1 / 3 }), "alloc-grid"],
    ["alloc_eth15_doge40", mergeAlloc({}, { ETH: 0.15, DOGE: 0.40 }), "alloc-grid"],
    ["alloc_eth20_doge20", mergeAlloc({}, { ETH: 0.20, DOGE: 0.20 }), "alloc-grid"],
    ["alloc_eth20_doge25", mergeAlloc({}, { ETH: 0.20, DOGE: 0.25 }), "alloc-grid"],
    ["alloc_eth20_doge33", mergeAlloc({}, { ETH: 0.20, DOGE: 1 / 3 }), "alloc-grid"],
    ["alloc_eth20_doge40", mergeAlloc({}, { ETH: 0.20, DOGE: 0.40 }), "alloc-grid"],

    ["pengu_override_eth_only", { penguStrongOverrideCurrentSymbols: ["ETH"] }, "pengu-15m-scope"],
    ["pengu_override_eth_sol", { penguStrongOverrideCurrentSymbols: ["ETH", "SOL"] }, "pengu-15m-scope"],
    ["pengu_override_eth_inj", { penguStrongOverrideCurrentSymbols: ["ETH", "INJ"] }, "pengu-15m-scope"],
    ["pengu_override_eth_sol_inj", { penguStrongOverrideCurrentSymbols: ["ETH", "SOL", "INJ"] }, "pengu-15m-scope"],
    ["pengu_override_add_avax", { penguStrongOverrideCurrentSymbols: ["ETH", "SOL", "INJ", "AVAX"] }, "pengu-15m-scope"],
    ["pengu_override_add_doge", { penguStrongOverrideCurrentSymbols: ["ETH", "SOL", "INJ", "DOGE"] }, "pengu-15m-scope"],
    ["pengu_override_add_avax_doge", { penguStrongOverrideCurrentSymbols: ["ETH", "SOL", "INJ", "AVAX", "DOGE"] }, "pengu-15m-scope"],
    ["pengu_override_gap20", { penguStrongOverrideCurrentSymbols: ["ETH", "SOL", "INJ"], penguStrongOverrideScoreGap: 20 }, "pengu-15m-scope"],

    ["twt_partial_10_20_trail6", withTwtPartial({ baseTakeProfitPct: 0.10, strongTakeProfitPct: 0.20, runnerTrailActivationPct: 0.20, runnerTrailRetracePct: 0.06, stopAfterPartialPct: 0.03 }), "twt-exit"],
    ["twt_partial_12_22_trail8", withTwtPartial({ baseTakeProfitPct: 0.12, strongTakeProfitPct: 0.22, runnerTrailActivationPct: 0.22, runnerTrailRetracePct: 0.08, stopAfterPartialPct: 0.04 }), "twt-exit"],
    ["twt_partial_15_25_trail8", withTwtPartial({ baseTakeProfitPct: 0.15, strongTakeProfitPct: 0.25, runnerTrailActivationPct: 0.25, runnerTrailRetracePct: 0.08, stopAfterPartialPct: 0.05 }), "twt-exit"],
    ["twt_partial_18_28_trail10", withTwtPartial({ baseTakeProfitPct: 0.18, strongTakeProfitPct: 0.28, runnerTrailActivationPct: 0.28, runnerTrailRetracePct: 0.10, stopAfterPartialPct: 0.06 }), "twt-exit"],

    ["combo_alloc_eth10_doge40_twt15", {
      ...mergeAlloc({}, { ETH: 0.10, DOGE: 0.40 }),
      ...withTwtPartial({ baseTakeProfitPct: 0.15, strongTakeProfitPct: 0.25, runnerTrailActivationPct: 0.25, runnerTrailRetracePct: 0.08, stopAfterPartialPct: 0.05 }),
    }, "combo"],
  ].filter(([label]) => !PATTERN || PATTERN.has(label));

  const rows = [];
  for (const [label, extra, group] of cases) {
    console.log(`running ${label}`);
    rows.push(await runCase(label, extra, group));
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.json"), JSON.stringify(rows, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.md"), toMarkdown(rows), "utf8");
  }

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
