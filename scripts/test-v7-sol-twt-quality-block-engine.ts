import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-sol-twt-quality-block-engine");
const START_TS = process.env.BT_START ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`) : Date.UTC(2022, 0, 1);
const END_TS = process.env.BT_END ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`) : Date.UTC(2026, 3, 29, 23, 59, 59, 999);

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

async function runOne(key: string, overrides: HybridVariantOptions) {
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", {
    ...base,
    ...overrides,
    initialEquity: 10_000,
    backtestStartTs: START_TS,
    backtestExecutionStartTs: START_TS,
    backtestEndTs: END_TS,
    label: `v7_sol_twt_quality_${key}`,
  });
  return {
    key,
    end: round(result.summary.end_equity),
    dd: round(result.summary.max_drawdown_pct, 2),
    pf: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposure: round(result.summary.exposure_pct, 2),
    elapsedSec: round((Date.now() - started) / 1000, 1),
    symbols: symbolRows(result),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const variants: Array<{ key: string; overrides: HybridVariantOptions }> = [
    { key: "current", overrides: {} },
    {
      key: "sol_overheat15_twt_adx35",
      overrides: {
        trendSymbolQualityBlockBySymbol: {
          SOL: { minMom20: 0.08, maxOverheatPct: 0.15, mode: "all" },
          TWT: { minMom20: 0.05, maxAdx14: 35, mode: "all" },
        },
      },
    },
    {
      key: "sol_sma15_twt_adx35",
      overrides: {
        trendSymbolQualityBlockBySymbol: {
          SOL: { minMom20: 0.08, maxSmaDistancePct: 0.15, mode: "all" },
          TWT: { minMom20: 0.05, maxAdx14: 35, mode: "all" },
        },
      },
    },
  ];
  const requestedVariant = process.env.BT_VARIANT || "";
  const activeVariants = requestedVariant ? variants.filter((variant) => variant.key === requestedVariant) : variants;
  const rows = [];
  for (const variant of activeVariants) {
    const row = await runOne(variant.key, variant.overrides);
    rows.push(row);
    console.log(`${row.key}: end=${row.end} dd=${row.dd}% pf=${row.pf} trades=${row.trades} sec=${row.elapsedSec}`);
  }
  const baseline = rows[0]?.end ?? 0;
  const md = [
    "# V7 SOL/TWT Quality Block Engine Test",
    "",
    `Period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | End Equity | vs current | MaxDD | PF | Trades | Exposure | sec |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.end.toLocaleString()} | ${round(row.end - baseline).toLocaleString()} | ${row.dd}% | ${row.pf} | ${row.trades} | ${row.exposure}% | ${row.elapsedSec} |`),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.key}`,
      "",
      "| symbol | pnl | trades |",
      "| --- | ---: | ---: |",
      ...row.symbols.map((symbol) => `| ${symbol.symbol} | ${symbol.pnl.toLocaleString()} | ${symbol.trades} |`),
      "",
    ]),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
