import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-next-profit-levers");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 22, 23, 59, 59, 999);
const PATTERN = process.env.PATTERN
  ? new Set(process.env.PATTERN.split(",").map((value) => value.trim()).filter(Boolean))
  : null;

type Variant = {
  key: string;
  note: string;
  patch: Partial<HybridVariantOptions>;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeMap<T>(base: Record<string, T> | undefined, patch: Record<string, T>) {
  return { ...(base ?? {}), ...patch };
}

function dropSymbol(symbols: readonly string[] | undefined, symbol: string) {
  return (symbols ?? []).filter((item) => item.toUpperCase() !== symbol.toUpperCase());
}

function blockFrom(year: number, monthIndex = 0) {
  return [{ startTs: Date.UTC(year, monthIndex, 1), endTs: END_TS + 1 }];
}

function blockAll() {
  return [{ startTs: START_TS, endTs: END_TS + 1 }];
}

function blockOutsideRecurringMonths(months: readonly number[]) {
  const allowed = new Set(months);
  const windows: { startTs: number; endTs: number }[] = [];
  for (let year = 2022; year <= 2026; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const monthNumber = month + 1;
      if (allowed.has(monthNumber)) continue;
      const startTs = Date.UTC(year, month, 1);
      const endTs = Date.UTC(year, month + 1, 1);
      if (endTs <= START_TS || startTs > END_TS) continue;
      windows.push({ startTs: Math.max(startTs, START_TS), endTs: Math.min(endTs, END_TS + 1) });
    }
  }
  return windows;
}

function summarize(
  key: string,
  note: string,
  result: Awaited<ReturnType<typeof runHybridBacktest>>,
  elapsedMs: number,
) {
  const trades = result.trade_pairs ?? [];
  const bySymbol = Object.entries(result.summary.symbol_contribution)
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(Number(pnl)),
      trades: trades.filter((trade) => trade.symbol === symbol).length,
    }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));

  return {
    key,
    note,
    endEquity: round(result.summary.end_equity),
    maxDD: round(result.summary.max_drawdown_pct),
    pf: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    elapsedSec: round(elapsedMs / 1000, 1),
    pnl: Object.fromEntries(bySymbol.map((row) => [row.symbol, row.pnl])),
    bySymbol,
  };
}

function toMarkdown(rows: ReturnType<typeof summarize>[]) {
  const baseline = rows.find((row) => row.key === "current_v7") ?? rows[0];
  return [
    "# V7 Next Profit Lever Scan",
    "",
    "- method: engine-direct",
    "- base: current V7 live-equivalent cash rescue profile",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "| pattern | End Equity | vs current | MaxDD | PF | trades | exposure | PENGU | APE | COS | TWT | SOL | ETH | DOGE | note |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => {
      const diff = baseline ? row.endEquity - baseline.endEquity : 0;
      return `| ${row.key} | ${row.endEquity.toLocaleString()} | ${round(diff).toLocaleString()} | ${row.maxDD}% | ${row.pf} | ${row.trades} | ${row.exposurePct}% | ${Number(row.pnl.PENGU ?? 0).toLocaleString()} | ${Number(row.pnl.APE ?? 0).toLocaleString()} | ${Number(row.pnl.COS ?? 0).toLocaleString()} | ${Number(row.pnl.TWT ?? 0).toLocaleString()} | ${Number(row.pnl.SOL ?? 0).toLocaleString()} | ${Number(row.pnl.ETH ?? 0).toLocaleString()} | ${Number(row.pnl.DOGE ?? 0).toLocaleString()} | ${row.note} |`;
    }),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.key}`,
      "",
      "| symbol | pnl | trades |",
      "| --- | ---: | ---: |",
      ...row.bySymbol.map((symbol) => `| ${symbol.symbol} | ${symbol.pnl.toLocaleString()} | ${symbol.trades} |`),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  const base: HybridVariantOptions = {
    ...baseOptions,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };

  const variants: Variant[] = [
    { key: "current_v7", note: "現行V7そのまま", patch: {} },
    {
      key: "twt_no_priority",
      note: "TWT優先採用だけ解除。候補には残す",
      patch: { trendPrioritySymbols: [] },
    },
    {
      key: "twt_removed_from_trend",
      note: "TWTをcash rescueの通常候補から除外",
      patch: {
        expandedTrendSymbols: dropSymbol(base.expandedTrendSymbols, "TWT"),
        trendPrioritySymbols: [],
      },
    },
    {
      key: "twt_block_from_2025",
      note: "TWTを2025年以降だけ停止",
      patch: {
        trendPrioritySymbols: [],
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockFrom(2025) }),
      },
    },
    {
      key: "twt_block_from_2025_jul",
      note: "TWTを2025年7月以降だけ停止",
      patch: {
        trendPrioritySymbols: [],
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockFrom(2025, 6) }),
      },
    },
    {
      key: "twt_block_from_2026",
      note: "TWTを2026年以降だけ停止",
      patch: {
        trendPrioritySymbols: [],
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockFrom(2026) }),
      },
    },
    {
      key: "twt_q4_only",
      note: "TWTを毎年10-12月だけ許可",
      patch: {
        trendPrioritySymbols: [],
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockOutsideRecurringMonths([10, 11, 12]) }),
      },
    },
    {
      key: "twt_q4_priority",
      note: "TWTを毎年10-12月だけ許可し、その期間は優先採用",
      patch: {
        trendPrioritySymbols: ["TWT"],
        trendPriorityMaxScoreGap: null,
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockOutsideRecurringMonths([10, 11, 12]) }),
      },
    },
    {
      key: "twt_q4_priority_gap15",
      note: "TWT Q4優先。ただしトップ候補との差15点以内",
      patch: {
        trendPrioritySymbols: ["TWT"],
        trendPriorityMaxScoreGap: 15,
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockOutsideRecurringMonths([10, 11, 12]) }),
      },
    },
    {
      key: "twt_oct_nov_only",
      note: "TWTを毎年10-11月だけ許可",
      patch: {
        trendPrioritySymbols: [],
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockOutsideRecurringMonths([10, 11]) }),
      },
    },
    {
      key: "twt_nov_only",
      note: "TWTを毎年11月だけ許可",
      patch: {
        trendPrioritySymbols: [],
        trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { TWT: blockOutsideRecurringMonths([11]) }),
      },
    },
    {
      key: "twt_alloc_25",
      note: "TWTだけ建玉25%",
      patch: { trendAllocBySymbol: mergeMap(base.trendAllocBySymbol, { TWT: 0.25 }) },
    },
    {
      key: "twt_alloc_50",
      note: "TWTだけ建玉50%",
      patch: { trendAllocBySymbol: mergeMap(base.trendAllocBySymbol, { TWT: 0.5 }) },
    },
    {
      key: "twt_strict_quality",
      note: "TWT条件を強化 breakout2%, volume1.15, efficiency0.22",
      patch: {
        trendBreakoutMinPctBySymbol: mergeMap(base.trendBreakoutMinPctBySymbol, { TWT: 0.02 }),
        trendMinVolumeRatioBySymbol: mergeMap(base.trendMinVolumeRatioBySymbol, { TWT: 1.15 }),
        trendMinEfficiencyRatioBySymbol: mergeMap(base.trendMinEfficiencyRatioBySymbol, { TWT: 0.22 }),
      },
    },
    {
      key: "twt_very_strict_quality",
      note: "TWT条件をさらに強化 breakout3%, volume1.2, efficiency0.25",
      patch: {
        trendBreakoutMinPctBySymbol: mergeMap(base.trendBreakoutMinPctBySymbol, { TWT: 0.03 }),
        trendMinVolumeRatioBySymbol: mergeMap(base.trendMinVolumeRatioBySymbol, { TWT: 1.2 }),
        trendMinEfficiencyRatioBySymbol: mergeMap(base.trendMinEfficiencyRatioBySymbol, { TWT: 0.25 }),
      },
    },
    {
      key: "sol_wave_off",
      note: "SOL wave override停止",
      patch: { solWaveOverrideEntry: false },
    },
    {
      key: "sol_wave_strict",
      note: "SOL wave条件を強化 breakout1%, volume1.35, efficiency0.18",
      patch: {
        solWaveOverrideBreakoutMinPct: 0.01,
        solWaveOverrideMinVolumeRatio: 1.35,
        solWaveOverrideMinEfficiencyRatio: 0.18,
      },
    },
    {
      key: "runner_retrace_08",
      note: "PENGU/APE/COS runner戻しを8%へ戻す",
      patch: { idleBreakoutProfitTrailRetracePct: 0.08 },
    },
    {
      key: "runner_retrace_12",
      note: "PENGU/APE/COS runner戻しを12%へ緩める",
      patch: { idleBreakoutProfitTrailRetracePct: 0.12 },
    },
    {
      key: "runner_activation_22_retrace_10",
      note: "runner発動を22%へ早め、戻し10%",
      patch: {
        idleBreakoutProfitTrailActivationPct: 0.22,
        idleBreakoutProfitTrailRetracePct: 0.10,
      },
    },
    {
      key: "cos_retrace_12_only",
      note: "COSだけrunner戻し12%",
      patch: { idleBreakoutTieredTrailBySymbol: { COS: [{ activationPct: 0.26, retracePct: 0.12 }] } },
    },
    {
      key: "cos_retrace_14_only",
      note: "COSだけrunner戻し14%",
      patch: { idleBreakoutTieredTrailBySymbol: { COS: [{ activationPct: 0.26, retracePct: 0.14 }] } },
    },
    {
      key: "ape_retrace_12_only",
      note: "APEだけrunner戻し12%",
      patch: { idleBreakoutTieredTrailBySymbol: { APE: [{ activationPct: 0.26, retracePct: 0.12 }] } },
    },
    {
      key: "pengu_retrace_12_only",
      note: "PENGUだけrunner戻し12%",
      patch: { idleBreakoutTieredTrailBySymbol: { PENGU: [{ activationPct: 0.26, retracePct: 0.12 }] } },
    },
    {
      key: "ape_cos_retrace_12",
      note: "APE/COSだけrunner戻し12%",
      patch: {
        idleBreakoutTieredTrailBySymbol: {
          APE: [{ activationPct: 0.26, retracePct: 0.12 }],
          COS: [{ activationPct: 0.26, retracePct: 0.12 }],
        },
      },
    },
    {
      key: "pengu_ape_cos_tiered_wide",
      note: "3銘柄を利益段階で広めに伸ばす",
      patch: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [{ activationPct: 0.26, retracePct: 0.10 }, { activationPct: 0.55, retracePct: 0.16 }],
          APE: [{ activationPct: 0.26, retracePct: 0.12 }, { activationPct: 0.55, retracePct: 0.18 }],
          COS: [{ activationPct: 0.26, retracePct: 0.12 }, { activationPct: 0.55, retracePct: 0.18 }],
        },
      },
    },
    {
      key: "idle_maxhold_96",
      note: "PENGU/APE/COS最大保有96時間",
      patch: { idleBreakoutMaxHoldBars: 96 },
    },
    {
      key: "idle_maxhold_120",
      note: "PENGU/APE/COS最大保有120時間",
      patch: { idleBreakoutMaxHoldBars: 120 },
    },
    {
      key: "idle_weak_exit_later",
      note: "弱退出を遅らせる mom20<0, momAccel<-0.015, 16h",
      patch: {
        idleBreakoutWeakExitMom20Below: 0,
        idleBreakoutWeakExitMomAccelBelow: -0.015,
        idleBreakoutWeakExitMinHoldBars: 16,
      },
    },
    {
      key: "sol_block_all",
      note: "SOLを通常候補から全期間ブロック",
      patch: { trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { SOL: blockAll() }) },
    },
    {
      key: "eth_block_all",
      note: "ETHを通常候補から全期間ブロック",
      patch: { trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { ETH: blockAll() }) },
    },
    {
      key: "sol_eth_block_all",
      note: "SOL/ETHを通常候補から全期間ブロック",
      patch: { trendSymbolBlockWindows: mergeMap(base.trendSymbolBlockWindows, { SOL: blockAll(), ETH: blockAll() }) },
    },
    {
      key: "sol_alloc_50",
      note: "SOLだけ建玉50%",
      patch: { trendAllocBySymbol: mergeMap(base.trendAllocBySymbol, { SOL: 0.5 }) },
    },
    {
      key: "sol_alloc_25",
      note: "SOLだけ建玉25%",
      patch: { trendAllocBySymbol: mergeMap(base.trendAllocBySymbol, { SOL: 0.25 }) },
    },
    {
      key: "eth_alloc_05",
      note: "ETHだけ建玉5%",
      patch: { trendAllocBySymbol: mergeMap(base.trendAllocBySymbol, { ETH: 0.05 }) },
    },
  ].filter((variant) => !PATTERN || PATTERN.has(variant.key));

  const rows = [];
  for (const variant of variants) {
    console.log(`running ${variant.key}`);
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...base,
      ...variant.patch,
      label: variant.key,
    });
    const row = summarize(variant.key, variant.note, result, Date.now() - started);
    rows.push(row);
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.json"), JSON.stringify(rows, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.md"), toMarkdown(rows), "utf8");
    console.log(row);
  }

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
