import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "trx-idle-dedicated");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const BAR_MS = 12 * 60 * 60 * 1000;

type IdleWindow = {
  startTs: number;
  endTs: number;
  bars: number;
};

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

function buildIdleWindowsFromEquityCurve(
  equityCurve: Awaited<ReturnType<typeof runHybridBacktest>>["equity_curve"],
) {
  const windows: IdleWindow[] = [];
  let windowStartTs: number | null = null;

  for (const point of equityCurve) {
    const isCash = point.position_side === "cash";
    if (isCash && windowStartTs == null) {
      windowStartTs = point.ts;
      continue;
    }

    if (!isCash && windowStartTs != null) {
      const bars = Math.max(1, Math.round((point.ts - windowStartTs) / BAR_MS));
      windows.push({
        startTs: windowStartTs,
        endTs: point.ts,
        bars,
      });
      windowStartTs = null;
    }
  }

  if (windowStartTs != null) {
    const bars = Math.max(1, Math.round((END_TS - windowStartTs) / BAR_MS));
    windows.push({
      startTs: windowStartTs,
      endTs: END_TS,
      bars,
    });
  }

  return windows.filter((window) => window.bars >= 2);
}

function withSymbolMapNumber(
  map: Record<string, number> | undefined,
  symbol: string,
  value: number,
) {
  return {
    ...(map ?? {}),
    [symbol]: value,
  };
}

function buildVariants(idleWindows: readonly { startTs: number; endTs: number }[]): VariantSpec[] {
  const base = baseOptions();
  const nonIdleWindows = (() => {
    const sorted = [...idleWindows].sort((left, right) => left.startTs - right.startTs);
    const windows: Array<{ startTs: number; endTs: number }> = [];
    let cursor = START_TS;
    for (const window of sorted) {
      if (window.startTs > cursor) windows.push({ startTs: cursor, endTs: window.startTs });
      cursor = Math.max(cursor, window.endTs);
    }
    if (cursor < END_TS) windows.push({ startTs: cursor, endTs: END_TS });
    return windows.filter((window) => window.endTs > window.startTs);
  })();

  const common = {
    ...base,
    strictExtraTrendSymbols: ["PENGU", "DOGE", "TRX"],
    strictExtraTrendIdleOnly: true,
    trendSymbolBlockWindows: {
      ...(base.trendSymbolBlockWindows ?? {}),
      TRX: nonIdleWindows,
    },
  } satisfies HybridVariantOptions;

  return [
    {
      key: "trx_idle_balanced",
      thesis: "Balanced idle-only TRX: light breakout, mild acceleration, moderate efficiency.",
      options: {
        ...common,
        trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(common.trendBreakoutLookbackBarsBySymbol, "TRX", 8),
        trendBreakoutMinPctBySymbol: withSymbolMapNumber(common.trendBreakoutMinPctBySymbol, "TRX", 0.012),
        trendMinVolumeRatioBySymbol: withSymbolMapNumber(common.trendMinVolumeRatioBySymbol, "TRX", 1.01),
        trendMinMomAccelBySymbol: withSymbolMapNumber(common.trendMinMomAccelBySymbol, "TRX", 0.0005),
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(common.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          TRX: 0.17,
        },
        label: "trx_idle_balanced",
      },
    },
    {
      key: "trx_idle_soft",
      thesis: "Soft idle-only TRX: easier breakout and lower efficiency to increase trigger count.",
      options: {
        ...common,
        trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(common.trendBreakoutLookbackBarsBySymbol, "TRX", 6),
        trendBreakoutMinPctBySymbol: withSymbolMapNumber(common.trendBreakoutMinPctBySymbol, "TRX", 0.008),
        trendMinVolumeRatioBySymbol: withSymbolMapNumber(common.trendMinVolumeRatioBySymbol, "TRX", 1.0),
        trendMinMomAccelBySymbol: withSymbolMapNumber(common.trendMinMomAccelBySymbol, "TRX", 0),
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(common.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          TRX: 0.14,
        },
        label: "trx_idle_soft",
      },
    },
    {
      key: "trx_idle_soft_fast_exit",
      thesis: "Soft idle-only TRX with earlier failure exit to prevent lingering in weak moves.",
      options: {
        ...common,
        trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(common.trendBreakoutLookbackBarsBySymbol, "TRX", 6),
        trendBreakoutMinPctBySymbol: withSymbolMapNumber(common.trendBreakoutMinPctBySymbol, "TRX", 0.008),
        trendMinVolumeRatioBySymbol: withSymbolMapNumber(common.trendMinVolumeRatioBySymbol, "TRX", 1.0),
        trendMinMomAccelBySymbol: withSymbolMapNumber(common.trendMinMomAccelBySymbol, "TRX", 0),
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(common.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          TRX: 0.14,
        },
        symbolSpecificTrendWeakExitSymbols: [
          ...new Set([...(common.symbolSpecificTrendWeakExitSymbols ?? []), "TRX"]),
        ],
        symbolSpecificTrendWeakExitMom20Below: 0.04,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.001,
        label: "trx_idle_soft_fast_exit",
      },
    },
  ];
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    ...baseOptions(),
    label: "base_v7_trx_idle_dedicated",
  });
  const idleWindows = buildIdleWindowsFromEquityCurve(baseline.equity_curve)
    .map((window) => ({ startTs: window.startTs, endTs: window.endTs }));

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of buildVariants(idleWindows)) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const trades = result.trade_pairs.filter((trade) => trade.symbol === "TRX");
    const wins = trades.filter((trade) => trade.net_pnl > 0).length;
    const losses = trades.filter((trade) => trade.net_pnl <= 0).length;
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      endEquity: round(result.summary.end_equity),
      deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      winRatePct: round(result.summary.win_rate_pct),
      tradeCount: result.summary.trade_count,
      trxTradeCount: trades.length,
      trxWins: wins,
      trxLosses: losses,
      trxPnl: round(result.summary.symbol_contribution.TRX ?? 0),
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  const md = [
    "# TRX Idle Dedicated Logic",
    "",
    "## Baseline",
    "",
    `- end_equity: ${round(baseline.summary.end_equity)}`,
    `- cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    `- trade_count: ${baseline.summary.trade_count}`,
    "",
    "## Variants",
    "",
    "| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TRX trades | wins | losses | TRX pnl | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.trxTradeCount} | ${row.trxWins} | ${row.trxLosses} | ${row.trxPnl} | ${row.exposurePct} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: baseline.summary,
    results: rows,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({
    baseline: {
      endEquity: round(baseline.summary.end_equity),
      cagrPct: round(baseline.summary.cagr_pct),
      maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
      profitFactor: round(baseline.summary.profit_factor, 3),
      tradeCount: baseline.summary.trade_count,
    },
    results: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
