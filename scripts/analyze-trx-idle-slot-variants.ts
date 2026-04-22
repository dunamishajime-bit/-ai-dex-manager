import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "trx-idle-slot-variants");
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

function invertWindows(
  windows: readonly { startTs: number; endTs: number }[],
  startTs: number,
  endTs: number,
) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Array<{ startTs: number; endTs: number }> = [];
  let cursor = startTs;
  for (const window of sorted) {
    if (window.startTs > cursor) inverted.push({ startTs: cursor, endTs: window.startTs });
    cursor = Math.max(cursor, window.endTs);
  }
  if (cursor < endTs) inverted.push({ startTs: cursor, endTs: endTs });
  return inverted.filter((window) => window.endTs > window.startTs);
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
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

function buildVariants(
  idleWindows: readonly { startTs: number; endTs: number }[],
  nonIdleWindows: readonly { startTs: number; endTs: number }[],
): VariantSpec[] {
  const base = baseOptions();

  const strictExtras = unique([...(base.strictExtraTrendSymbols ?? []), "TRX"]);
  const expanded = unique([...(base.expandedTrendSymbols ?? []), "TRX"]);

  return [
    {
      key: "strict_extra_12h_soft",
      thesis: "TRX as idle-only strict-extra on 12H with soft trend thresholds.",
      options: {
        ...base,
        strictExtraTrendSymbols: strictExtras,
        strictExtraTrendIdleOnly: true,
        strictExtraTrendAllowedWindows: idleWindows,
        trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TRX", 6),
        trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TRX", 0.008),
        trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TRX", 1.0),
        trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TRX", 0),
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(base.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          TRX: 0.14,
        },
      },
    },
    {
      key: "strict_extra_6h_soft",
      thesis: "TRX as idle-only strict-extra on 6H to catch smoother earlier moves.",
      options: {
        ...base,
        strictExtraTrendSymbols: strictExtras,
        strictExtraTrendIdleOnly: true,
        strictExtraTrendAllowedWindows: idleWindows,
        strictExtraTrendDecisionTimeframe: "6h",
        strictExtraTrendExitCheckTimeframe: "6h",
        trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TRX", 6),
        trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TRX", 0.006),
        trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TRX", 1.0),
        trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TRX", -0.001),
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(base.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          TRX: 0.12,
        },
      },
    },
    {
      key: "expanded_idle_trx_soft",
      thesis: "TRX as expanded trend symbol only during idle windows, with soft TRX trend thresholds.",
      options: {
        ...base,
        expandedTrendSymbols: expanded,
        trendSymbolBlockWindows: {
          ...(base.trendSymbolBlockWindows ?? {}),
          TRX: nonIdleWindows,
        },
        trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TRX", 6),
        trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TRX", 0.008),
        trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TRX", 1.0),
        trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TRX", 0),
        trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, "TRX", 0.14),
      },
    },
    {
      key: "expanded_idle_trx_with_idle_relax",
      thesis: "TRX idle rescue with TRX soft thresholds plus idle-only gate relaxation.",
      options: {
        ...base,
        expandedTrendSymbols: expanded,
        trendSymbolBlockWindows: {
          ...(base.trendSymbolBlockWindows ?? {}),
          TRX: nonIdleWindows,
        },
        trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TRX", 6),
        trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TRX", 0.008),
        trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TRX", 1.0),
        trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TRX", 0),
        trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, "TRX", 0.14),
        idleCashTrendContext: true,
        idleCashTrendAllowTrendGateOff: true,
        idleCashTrendMinMom20: -0.005,
        idleCashTrendMinEfficiencyRatio: 0.14,
      },
    },
  ];
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    ...baseOptions(),
    label: "base_v7_trx_idle_slot_variants",
  });
  const idleWindows = buildIdleWindowsFromEquityCurve(baseline.equity_curve)
    .map((window) => ({ startTs: window.startTs, endTs: window.endTs }));
  const nonIdleWindows = invertWindows(idleWindows, START_TS, END_TS);

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of buildVariants(idleWindows, nonIdleWindows)) {
    const result = await runHybridBacktest("RETQ22", {
      ...variant.options,
      label: variant.key,
    });
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
    "# TRX Idle Slot Variants",
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
