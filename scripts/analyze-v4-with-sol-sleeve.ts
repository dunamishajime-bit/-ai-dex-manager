import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { BacktestResult, EquityPoint, TradePairRow } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v4-with-sol-sleeve");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const START_EQUITY = 10000;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function calcMaxDrawdownPct(points: EquityPoint[]) {
  let peak = points[0]?.equity ?? START_EQUITY;
  let maxDd = 0;
  for (const point of points) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak > 0 ? ((point.equity / peak) - 1) * 100 : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function calcCagrPct(startEquity: number, endEquity: number, startTs: number, endTs: number) {
  const years = Math.max((endTs - startTs) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25);
  return (Math.pow(endEquity / startEquity, 1 / years) - 1) * 100;
}

function calcProfitFactor(trades: TradePairRow[]) {
  let grossProfit = 0;
  let grossLossAbs = 0;
  for (const trade of trades) {
    if (trade.net_pnl > 0) grossProfit += trade.net_pnl;
    if (trade.net_pnl < 0) grossLossAbs += Math.abs(trade.net_pnl);
  }
  if (grossLossAbs === 0) return grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  return grossProfit / grossLossAbs;
}

function calcWinRatePct(trades: TradePairRow[]) {
  if (!trades.length) return 0;
  const wins = trades.filter((trade) => trade.net_pnl > 0).length;
  return (wins / trades.length) * 100;
}

function calcExposurePct(points: EquityPoint[]) {
  if (!points.length) return 0;
  const active = points.filter((point) => point.position_side !== "cash").length;
  return (active / points.length) * 100;
}

function combineEquityCurves(
  baseCurve: EquityPoint[],
  solCurve: EquityPoint[],
  solWeight: number,
): EquityPoint[] {
  const baseWeight = 1 - solWeight;
  const baseStart = baseCurve[0]?.equity ?? START_EQUITY;
  const solStart = solCurve[0]?.equity ?? START_EQUITY;
  const length = Math.min(baseCurve.length, solCurve.length);
  const points: EquityPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const basePoint = baseCurve[index];
    const solPoint = solCurve[index];
    const baseRel = basePoint.equity / baseStart;
    const solRel = solPoint.equity / solStart;
    const equity = START_EQUITY * ((baseWeight * baseRel) + (solWeight * solRel));
    const cash = START_EQUITY * (
      (baseWeight * (basePoint.cash / baseStart)) +
      (solWeight * (solPoint.cash / solStart))
    );
    const activeLabels = [basePoint.position_side !== "cash" ? "base" : null, solPoint.position_side !== "cash" ? "sol" : null]
      .filter(Boolean)
      .join("+");
    points.push({
      ts: basePoint.ts,
      iso_time: basePoint.iso_time,
      equity,
      cash,
      position_symbol: activeLabels || "cash",
      position_side: activeLabels ? "trend" : "cash",
      position_qty: 0,
      position_entry_price: 0,
    });
  }

  return points;
}

function scaleTrades(trades: TradePairRow[], sleeveWeight: number, sleeveLabel: string) {
  return trades.map((trade) => ({
    ...trade,
    trade_id: `${sleeveLabel}:${trade.trade_id}`,
    gross_pnl: trade.gross_pnl * sleeveWeight,
    fee: trade.fee * sleeveWeight,
    net_pnl: trade.net_pnl * sleeveWeight,
  }));
}

function buildBaseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v4_main",
  } satisfies HybridVariantOptions;
}

function buildSolOnlyOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    expandedTrendSymbols: ["SOL"] as const,
    strictExtraTrendSymbols: [] as const,
    strictExtraTrendIdleOnly: false,
    rangeSymbols: [] as const,
    auxRangeSymbols: [] as const,
    trendScoreAdjustmentBySymbol: {},
    label: "sol_only_base",
  } satisfies HybridVariantOptions;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const [baseResult, solResult] = await Promise.all([
    runHybridBacktest("RETQ22", buildBaseOptions()),
    runHybridBacktest("RETQ22", buildSolOnlyOptions()),
  ]);

  const sleeveWeights = [0.15, 0.2, 0.25];
  const rows = sleeveWeights.map((solWeight) => {
    const baseWeight = 1 - solWeight;
    const equityCurve = combineEquityCurves(baseResult.equity_curve, solResult.equity_curve, solWeight);
    const trades = [
      ...scaleTrades(baseResult.trade_pairs, baseWeight, "base"),
      ...scaleTrades(solResult.trade_pairs, solWeight, "sol"),
    ];
    const endEquity = equityCurve.at(-1)?.equity ?? START_EQUITY;
    const maxDrawdownPct = calcMaxDrawdownPct(equityCurve);
    const cagrPct = calcCagrPct(START_EQUITY, endEquity, START_TS, END_TS);
    const profitFactor = calcProfitFactor(trades);
    const winRatePct = calcWinRatePct(trades);
    const exposurePct = calcExposurePct(equityCurve);
    const baseContribution = (baseResult.summary.end_equity - START_EQUITY) * baseWeight;
    const solContribution = (solResult.summary.end_equity - START_EQUITY) * solWeight;

    return {
      solAllocationPct: round(solWeight * 100, 0),
      endEquity: round(endEquity, 2),
      cagrPct: round(cagrPct, 2),
      maxDrawdownPct: round(maxDrawdownPct, 2),
      profitFactor: round(profitFactor, 3),
      winRatePct: round(winRatePct, 2),
      tradeCount: trades.length,
      exposurePct: round(exposurePct, 2),
      baseSleeveContribution: round(baseContribution, 2),
      solSleeveContribution: round(solContribution, 2),
    };
  });

  const payload = {
    setup: {
      startUtc: new Date(START_TS).toISOString(),
      endUtc: new Date(END_TS).toISOString(),
      mainStrategyId: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
      solStandaloneLabel: "sol_only_base",
    },
    baselines: {
      main: {
        endEquity: round(baseResult.summary.end_equity, 2),
        cagrPct: round(baseResult.summary.cagr_pct, 2),
        maxDrawdownPct: round(baseResult.summary.max_drawdown_pct, 2),
        profitFactor: round(baseResult.summary.profit_factor, 3),
        tradeCount: baseResult.summary.trade_count,
      },
      solOnly: {
        endEquity: round(solResult.summary.end_equity, 2),
        cagrPct: round(solResult.summary.cagr_pct, 2),
        maxDrawdownPct: round(solResult.summary.max_drawdown_pct, 2),
        profitFactor: round(solResult.summary.profit_factor, 3),
        tradeCount: solResult.summary.trade_count,
      },
    },
    rows,
  };

  const md = [
    "# V4 With SOL Sleeve",
    "",
    "## Baselines",
    "",
    `- main_v4_end_equity: ${payload.baselines.main.endEquity}`,
    `- main_v4_cagr_pct: ${payload.baselines.main.cagrPct}`,
    `- main_v4_maxdd_pct: ${payload.baselines.main.maxDrawdownPct}`,
    `- sol_only_end_equity: ${payload.baselines.solOnly.endEquity}`,
    `- sol_only_cagr_pct: ${payload.baselines.solOnly.cagrPct}`,
    `- sol_only_maxdd_pct: ${payload.baselines.solOnly.maxDrawdownPct}`,
    "",
    "## Fixed Allocation Overlay",
    "",
    "| SOL alloc % | End Equity | CAGR % | MaxDD % | PF | Win Rate % | Trades | Exposure % | Main sleeve pnl | SOL sleeve pnl |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.solAllocationPct} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.baseSleeveContribution} | ${row.solSleeveContribution} |`,
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
