import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-next-profit-levers");
const YEARS = [2022, 2023, 2024, 2025, 2026] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dropSymbol(symbols: readonly string[] | undefined, symbol: string) {
  return (symbols ?? []).filter((item) => item.toUpperCase() !== symbol.toUpperCase());
}

function yearEnd(year: number) {
  return year === 2026 ? Date.UTC(2026, 4, 22, 23, 59, 59, 999) : Date.UTC(year, 11, 31, 23, 59, 59, 999);
}

async function runCase(
  label: string,
  year: number,
  base: HybridVariantOptions,
  patch: Partial<HybridVariantOptions>,
) {
  const result = await runHybridBacktest("RETQ22", {
    ...base,
    ...patch,
    backtestStartTs: Date.UTC(year, 0, 1),
    backtestEndTs: yearEnd(year),
    label: `${label}_${year}`,
  });

  return {
    year,
    label,
    endEquity: round(result.summary.end_equity),
    maxDD: round(result.summary.max_drawdown_pct),
    pf: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    symbols: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const years = [...new Set(rows.map((row) => row.year))].sort();
  return [
    "# V7 Next Profit Lever Yearly Check",
    "",
    "- method: engine-direct yearly independent check",
    "- target: confirm whether removing TWT from cash rescue improves broadly or only one period",
    "",
    "| year | current End | no TWT End | diff | current MaxDD | no TWT MaxDD | current PF | no TWT PF | current trades | no TWT trades |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...years.map((year) => {
      const current = rows.find((row) => row.year === year && row.label === "current_v7");
      const noTwt = rows.find((row) => row.year === year && row.label === "twt_removed_from_trend");
      const diff = current && noTwt ? noTwt.endEquity - current.endEquity : 0;
      return `| ${year} | ${current?.endEquity.toLocaleString() ?? "-"} | ${noTwt?.endEquity.toLocaleString() ?? "-"} | ${round(diff).toLocaleString()} | ${current?.maxDD ?? "-"}% | ${noTwt?.maxDD ?? "-"}% | ${current?.pf ?? "-"} | ${noTwt?.pf ?? "-"} | ${current?.trades ?? "-"} | ${noTwt?.trades ?? "-"} |`;
    }),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.year} ${row.label}`,
      "",
      "| symbol | pnl |",
      "| --- | ---: |",
      ...Object.entries(row.symbols)
        .sort((left, right) => Math.abs(Number(right[1])) - Math.abs(Number(left[1])))
        .map(([symbol, pnl]) => `| ${symbol} | ${Number(pnl).toLocaleString()} |`),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  const variants: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_v7", {}],
    [
      "twt_removed_from_trend",
      {
        expandedTrendSymbols: dropSymbol(base.expandedTrendSymbols, "TWT"),
        trendPrioritySymbols: [],
      },
    ],
  ];

  const rows = [];
  for (const year of YEARS) {
    for (const [label, patch] of variants) {
      console.log(`running ${label} ${year}`);
      rows.push(await runCase(label, year, base, patch));
      await fs.writeFile(path.join(REPORT_DIR, "yearly.partial.json"), JSON.stringify(rows, null, 2), "utf8");
      await fs.writeFile(path.join(REPORT_DIR, "yearly.partial.md"), toMarkdown(rows), "utf8");
    }
  }

  await fs.writeFile(path.join(REPORT_DIR, "yearly.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "yearly.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
