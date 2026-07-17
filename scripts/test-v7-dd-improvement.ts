import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-dd-improvement");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 22, 23, 59, 59, 999);

type Variant = {
  key: string;
  note: string;
  patch: Partial<HybridVariantOptions>;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeTrendAlloc(
  base: HybridVariantOptions,
  extra: Record<string, number>,
): Record<string, number> {
  return {
    ...(base.trendAllocBySymbol ?? {}),
    ...extra,
  };
}

function summarize(
  key: string,
  note: string,
  result: Awaited<ReturnType<typeof runHybridBacktest>>,
  elapsedMs: number,
) {
  return {
    key,
    note,
    endEquity: round(result.summary.end_equity),
    maxDD: round(result.summary.max_drawdown_pct),
    pf: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    elapsedSec: round(elapsedMs / 1000, 1),
    symbolPnl: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution)
        .sort((left, right) => Math.abs(Number(right[1])) - Math.abs(Number(left[1])))
        .map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

function toMarkdown(rows: ReturnType<typeof summarize>[]) {
  const base = rows[0];
  return [
    "# V7 MaxDD Improvement Test",
    "",
    "- method: engine-direct",
    "- profile: current V7 live-equivalent cash rescue",
    "- target: improve MaxDD around -41.17%",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "## Summary",
    "",
    "| pattern | End Equity | vs base | MaxDD | DD改善 | PF | Trades | Exposure | note |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => {
      const diff = row.endEquity - base.endEquity;
      const ddImprove = row.maxDD - base.maxDD;
      return `| ${row.key} | ${row.endEquity.toLocaleString()} | ${diff.toLocaleString()} | ${row.maxDD}% | ${round(ddImprove)}pt | ${row.pf} | ${row.trades} | ${row.exposurePct}% | ${row.note} |`;
    }),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.key}`,
      "",
      "| symbol | PnL |",
      "| --- | ---: |",
      ...Object.entries(row.symbolPnl).map(([symbol, pnl]) => `| ${symbol} | ${Number(pnl).toLocaleString()} |`),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseOptions: HybridVariantOptions = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };

  const variants: Variant[] = [
    {
      key: "current_v7",
      note: "現行実装相当",
      patch: {},
    },
    {
      key: "portfolio_dd_cash_35",
      note: "DD -35%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -35 },
    },
    {
      key: "portfolio_dd_cash_30",
      note: "DD -30%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -30 },
    },
    {
      key: "portfolio_dd_cash_25",
      note: "DD -25%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -25 },
    },
    {
      key: "portfolio_dd_cash_28",
      note: "DD -28%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -28 },
    },
    {
      key: "portfolio_dd_cash_26",
      note: "DD -26%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -26 },
    },
    {
      key: "portfolio_dd_cash_24",
      note: "DD -24%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -24 },
    },
    {
      key: "portfolio_dd_cash_22",
      note: "DD -22%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -22 },
    },
    {
      key: "portfolio_dd_cash_20",
      note: "DD -20%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -20 },
    },
    {
      key: "portfolio_dd_cash_18",
      note: "DD -18%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -18 },
    },
    {
      key: "portfolio_dd_cash_15",
      note: "DD -15%到達でUSDT退避",
      patch: { portfolioDrawdownCashExitPct: -15 },
    },
    {
      key: "entry_block_dd_30",
      note: "DD -30%以下で新規エントリー停止",
      patch: { portfolioDrawdownEntryBlockPct: -30 },
    },
    {
      key: "entry_block_dd_25",
      note: "DD -25%以下で新規エントリー停止",
      patch: { portfolioDrawdownEntryBlockPct: -25 },
    },
    {
      key: "idle_trail_26_10",
      note: "PENGU/APE/COS runner 戻し12%から10%へ",
      patch: { idleBreakoutProfitTrailRetracePct: 0.10 },
    },
    {
      key: "idle_trail_22_10",
      note: "runner 起動26%から22%、戻し10%",
      patch: {
        idleBreakoutProfitTrailActivationPct: 0.22,
        idleBreakoutProfitTrailRetracePct: 0.10,
      },
    },
    {
      key: "idle_trail_20_09",
      note: "runner 起動20%、戻し9%",
      patch: {
        idleBreakoutProfitTrailActivationPct: 0.20,
        idleBreakoutProfitTrailRetracePct: 0.09,
      },
    },
    {
      key: "idle_maxhold_48",
      note: "runner 最大保有72hから48h",
      patch: { idleBreakoutMaxHoldBars: 48 },
    },
    {
      key: "idle_weak_fast",
      note: "runner 弱退出を早める",
      patch: {
        idleBreakoutWeakExitMinHoldBars: 8,
        idleBreakoutWeakExitMom20Below: 0.04,
        idleBreakoutWeakExitMomAccelBelow: -0.005,
      },
    },
    {
      key: "idle_alloc_85",
      note: "PENGU/APE/COSだけ85%建玉",
      patch: {
        trendAllocBySymbol: mergeTrendAlloc(baseOptions, { PENGU: 0.85, APE: 0.85, COS: 0.85 }),
      },
    },
    {
      key: "idle_alloc_75",
      note: "PENGU/APE/COSだけ75%建玉",
      patch: {
        trendAllocBySymbol: mergeTrendAlloc(baseOptions, { PENGU: 0.75, APE: 0.75, COS: 0.75 }),
      },
    },
    {
      key: "dd30_plus_idle_alloc85",
      note: "DD -30%退避 + runner 85%建玉",
      patch: {
        portfolioDrawdownCashExitPct: -30,
        trendAllocBySymbol: mergeTrendAlloc(baseOptions, { PENGU: 0.85, APE: 0.85, COS: 0.85 }),
      },
    },
    {
      key: "dd35_plus_idle_trail22_10",
      note: "DD -35%退避 + runner 22/10",
      patch: {
        portfolioDrawdownCashExitPct: -35,
        idleBreakoutProfitTrailActivationPct: 0.22,
        idleBreakoutProfitTrailRetracePct: 0.10,
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...baseOptions,
      ...variant.patch,
      label: variant.key,
    });
    const row = summarize(variant.key, variant.note, result, Date.now() - started);
    rows.push(row);
    console.log(row);
  }

  rows.sort((left, right) => {
    const ddRank = right.maxDD - left.maxDD;
    if (Math.abs(ddRank) > 0.001) return ddRank;
    return right.endEquity - left.endEquity;
  });

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
