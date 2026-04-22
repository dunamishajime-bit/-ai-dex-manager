import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { TradePairRow } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v6-sol-impact");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const SYMBOLS = ["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ"] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeBySymbol<T extends number>(
  base: Record<string, T> | undefined,
  additions: Record<string, T>,
) {
  return {
    ...(base ?? {}),
    ...additions,
  };
}

function periodKey(isoTime: string) {
  return isoTime.slice(0, 7);
}

function summarizeBySymbol(rows: TradePairRow[]) {
  return Object.fromEntries(
    SYMBOLS.map((symbol) => {
      const trades = rows.filter((row) => row.symbol === symbol);
      return [
        symbol,
        {
          tradeCount: trades.length,
          wins: trades.filter((row) => row.net_pnl > 0).length,
          losses: trades.filter((row) => row.net_pnl <= 0).length,
          totalNetPnl: round(trades.reduce((sum, row) => sum + row.net_pnl, 0)),
        },
      ];
    }),
  );
}

function summarizeMonthly(rows: TradePairRow[]) {
  const byMonth = new Map<string, TradePairRow[]>();
  for (const row of rows) {
    const key = periodKey(row.exit_time);
    const bucket = byMonth.get(key) ?? [];
    bucket.push(row);
    byMonth.set(key, bucket);
  }

  return Object.fromEntries(
    [...byMonth.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, monthRows]) => [
        month,
        {
          totalNetPnl: round(monthRows.reduce((sum, row) => sum + row.net_pnl, 0)),
          bySymbol: Object.fromEntries(
            SYMBOLS.map((symbol) => [
              symbol,
              round(monthRows.filter((row) => row.symbol === symbol).reduce((sum, row) => sum + row.net_pnl, 0)),
            ]),
          ),
        },
      ]),
  );
}

function topDeltas(
  baseRows: TradePairRow[],
  variantRows: TradePairRow[],
) {
  const baseMonthly = summarizeMonthly(baseRows);
  const variantMonthly = summarizeMonthly(variantRows);
  const months = [...new Set([...Object.keys(baseMonthly), ...Object.keys(variantMonthly)])].sort();
  return months
    .map((month) => {
      const baseValue = baseMonthly[month]?.totalNetPnl ?? 0;
      const variantValue = variantMonthly[month]?.totalNetPnl ?? 0;
      return {
        month,
        baseNetPnl: round(baseValue),
        variantNetPnl: round(variantValue),
        deltaNetPnl: round(variantValue - baseValue),
        symbolDelta: Object.fromEntries(
          SYMBOLS.map((symbol) => {
            const delta = (variantMonthly[month]?.bySymbol?.[symbol] ?? 0) - (baseMonthly[month]?.bySymbol?.[symbol] ?? 0);
            return [symbol, round(delta)];
          }),
        ),
      };
    })
    .sort((left, right) => left.deltaNetPnl - right.deltaNetPnl)
    .slice(0, 12);
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseOptions: HybridVariantOptions = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "base_v6",
  };

  const solFilterOptions: HybridVariantOptions = {
    ...baseOptions,
    trendMinEfficiencyRatioBySymbol: mergeBySymbol(baseOptions.trendMinEfficiencyRatioBySymbol, { SOL: 0.24 }),
    trendMinVolumeRatioBySymbol: mergeBySymbol(baseOptions.trendMinVolumeRatioBySymbol, { SOL: 0.6 }),
    label: "sol_100pct_eff_vol",
  };

  const [base, variant] = await Promise.all([
    runHybridBacktest("RETQ22", baseOptions),
    runHybridBacktest("RETQ22", solFilterOptions),
  ]);

  const payload = {
    setup: {
      startUtc: new Date(START_TS).toISOString(),
      endUtc: new Date(END_TS).toISOString(),
      strategyId: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
    },
    base: {
      endEquity: round(base.summary.end_equity),
      cagrPct: round(base.summary.cagr_pct),
      maxDrawdownPct: round(base.summary.max_drawdown_pct),
      profitFactor: round(base.summary.profit_factor, 3),
      bySymbol: summarizeBySymbol(base.trade_pairs),
    },
    variant: {
      endEquity: round(variant.summary.end_equity),
      cagrPct: round(variant.summary.cagr_pct),
      maxDrawdownPct: round(variant.summary.max_drawdown_pct),
      profitFactor: round(variant.summary.profit_factor, 3),
      bySymbol: summarizeBySymbol(variant.trade_pairs),
    },
    deltas: {
      bySymbol: Object.fromEntries(
        SYMBOLS.map((symbol) => [
          symbol,
          {
            tradeCountDelta:
              (variant.trade_pairs.filter((row) => row.symbol === symbol).length) -
              (base.trade_pairs.filter((row) => row.symbol === symbol).length),
            totalNetPnlDelta:
              round(
                variant.trade_pairs.filter((row) => row.symbol === symbol).reduce((sum, row) => sum + row.net_pnl, 0) -
                base.trade_pairs.filter((row) => row.symbol === symbol).reduce((sum, row) => sum + row.net_pnl, 0),
              ),
          },
        ]),
      ),
      worstMonths: topDeltas(base.trade_pairs, variant.trade_pairs),
    },
  };

  const md = [
    "# V6 SOL Impact Analysis",
    "",
    `- start_utc: ${payload.setup.startUtc}`,
    `- end_utc: ${payload.setup.endUtc}`,
    `- strategy_id: ${payload.setup.strategyId}`,
    "",
    "## Summary",
    "",
    `- base end equity: ${payload.base.endEquity}`,
    `- sol_100pct_eff_vol end equity: ${payload.variant.endEquity}`,
    `- equity delta: ${round(payload.variant.endEquity - payload.base.endEquity)}`,
    "",
    "## Symbol Delta",
    "",
    "| symbol | trade count delta | pnl delta |",
    "| --- | ---: | ---: |",
    ...SYMBOLS.map((symbol) => `| ${symbol} | ${payload.deltas.bySymbol[symbol].tradeCountDelta} | ${payload.deltas.bySymbol[symbol].totalNetPnlDelta} |`),
    "",
    "## Worst Monthly Deltas",
    "",
    ...payload.deltas.worstMonths.map(
      (row) =>
        `- ${row.month}: total ${row.deltaNetPnl} (base ${row.baseNetPnl} -> variant ${row.variantNetPnl}) / ${SYMBOLS.map((symbol) => `${symbol} ${row.symbolDelta[symbol]}`).join(" / ")}`,
    ),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
