import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-runner10-uni");
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

function yearWindow(year: number) {
  return [{ startTs: Date.UTC(year, 0, 1), endTs: Date.UTC(year + 1, 0, 1) }];
}

function monthWindow(year: number, startMonth: number, endMonthExclusive: number) {
  return [{ startTs: Date.UTC(year, startMonth - 1, 1), endTs: Date.UTC(year, endMonthExclusive - 1, 1) }];
}

function mergeSymbolMap<T>(
  base: Record<string, T> | undefined,
  patch: Record<string, T>,
) {
  return { ...(base ?? {}), ...patch };
}

function summarize(
  key: string,
  note: string,
  result: Awaited<ReturnType<typeof runHybridBacktest>>,
  elapsedMs: number,
) {
  const trades = result.trade_pairs ?? [];
  const uniTrades = trades.filter((trade) => trade.symbol === "UNI");
  const uniWins = uniTrades.filter((trade) => trade.net_pnl > 0).length;
  return {
    key,
    note,
    endEquity: round(result.summary.end_equity),
    maxDD: round(result.summary.max_drawdown_pct),
    pf: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    uniPnl: round(result.summary.symbol_contribution.UNI ?? 0),
    uniTrades: uniTrades.length,
    uniWinRate: uniTrades.length ? round((uniWins / uniTrades.length) * 100, 1) : 0,
    elapsedSec: round(elapsedMs / 1000, 1),
    symbolPnl: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution)
        .sort((left, right) => Math.abs(Number(right[1])) - Math.abs(Number(left[1])))
        .map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

function toMarkdown(rows: ReturnType<typeof summarize>[]) {
  const base = rows.find((row) => row.key === "runner10_current_uni") ?? rows[0];
  return [
    "# V7 Runner10 UNI Test",
    "",
    "- method: engine-direct",
    "- base: current V7 + DD -25% + PENGU/APE/COS runner retrace 10%",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "## Summary",
    "",
    "| pattern | End Equity | vs base | MaxDD | PF | Trades | Exposure | UNI PnL | UNI trades | UNI win% | note |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => {
      const diff = row.endEquity - base.endEquity;
      return `| ${row.key} | ${row.endEquity.toLocaleString()} | ${diff.toLocaleString()} | ${row.maxDD}% | ${row.pf} | ${row.trades} | ${row.exposurePct}% | ${row.uniPnl.toLocaleString()} | ${row.uniTrades} | ${row.uniWinRate}% | ${row.note} |`;
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
    portfolioDrawdownCashExitPct: -25,
    idleBreakoutProfitTrailRetracePct: 0.10,
  };

  const variants: Variant[] = [
    {
      key: "runner10_current_uni",
      note: "runner戻し10%、UNI現行",
      patch: {},
    },
    {
      key: "uni_off",
      note: "UNIのpengu-off-rotationを停止",
      patch: { penguOffRotationEntry: false },
    },
    {
      key: "uni_2024_only",
      note: "UNIを2024年だけ許可",
      patch: { penguOffRotationAllowedWindowsBySymbol: { UNI: yearWindow(2024) } },
    },
    {
      key: "uni_2024_q4_only",
      note: "UNIを2024年10-12月だけ許可",
      patch: { penguOffRotationAllowedWindowsBySymbol: { UNI: monthWindow(2024, 10, 13) } },
    },
    {
      key: "uni_scoregap_10",
      note: "UNI乗り換えScore差を5から10へ",
      patch: { penguOffRotationScoreGap: 10 },
    },
    {
      key: "uni_scoregap_15",
      note: "UNI乗り換えScore差を15へ",
      patch: { penguOffRotationScoreGap: 15 },
    },
    {
      key: "uni_strict_breakout",
      note: "UNI条件強化 breakout2.4%, volume1.2, eff0.2",
      patch: {
        trendBreakoutMinPctBySymbol: mergeSymbolMap(baseOptions.trendBreakoutMinPctBySymbol, { UNI: 0.024 }),
        trendMinVolumeRatioBySymbol: mergeSymbolMap(baseOptions.trendMinVolumeRatioBySymbol, { UNI: 1.2 }),
        trendMinEfficiencyRatioBySymbol: mergeSymbolMap(baseOptions.trendMinEfficiencyRatioBySymbol, { UNI: 0.2 }),
      },
    },
    {
      key: "uni_strict_mom",
      note: "UNI条件強化 momAccel0.004, volume1.2, eff0.2",
      patch: {
        trendMinMomAccelBySymbol: mergeSymbolMap(baseOptions.trendMinMomAccelBySymbol, { UNI: 0.004 }),
        trendMinVolumeRatioBySymbol: mergeSymbolMap(baseOptions.trendMinVolumeRatioBySymbol, { UNI: 1.2 }),
        trendMinEfficiencyRatioBySymbol: mergeSymbolMap(baseOptions.trendMinEfficiencyRatioBySymbol, { UNI: 0.2 }),
      },
    },
    {
      key: "uni_2024_strict",
      note: "UNI 2024限定 + breakout2.4%, volume1.2, eff0.2",
      patch: {
        penguOffRotationAllowedWindowsBySymbol: { UNI: yearWindow(2024) },
        trendBreakoutMinPctBySymbol: mergeSymbolMap(baseOptions.trendBreakoutMinPctBySymbol, { UNI: 0.024 }),
        trendMinVolumeRatioBySymbol: mergeSymbolMap(baseOptions.trendMinVolumeRatioBySymbol, { UNI: 1.2 }),
        trendMinEfficiencyRatioBySymbol: mergeSymbolMap(baseOptions.trendMinEfficiencyRatioBySymbol, { UNI: 0.2 }),
      },
    },
    {
      key: "uni_2024_scoregap10",
      note: "UNI 2024限定 + Score差10",
      patch: {
        penguOffRotationAllowedWindowsBySymbol: { UNI: yearWindow(2024) },
        penguOffRotationScoreGap: 10,
      },
    },
    {
      key: "uni_notional_30pct_proxy",
      note: "UNI最大建玉を初期資金30%相当へ制限",
      patch: { penguOffRotationMaxNotionalUsdBySymbol: { UNI: 3000 } },
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

  rows.sort((left, right) => right.endEquity - left.endEquity);
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
