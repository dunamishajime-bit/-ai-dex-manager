import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-inj-spring-engine-direct");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 29, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(
  label: string,
  result: Awaited<ReturnType<typeof import("../lib/backtest/hybrid-engine").runHybridBacktest>>,
  elapsedMs: number,
) {
  const symbolRows = Object.entries(result.summary.symbol_contribution)
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(Number(pnl)),
      trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
    }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
  const injSpringTrades = result.trade_pairs.filter((trade) => trade.sub_variant === "inj-spring-cash");

  return {
    label,
    start: new Date(START_TS).toISOString(),
    end: new Date(END_TS).toISOString(),
    elapsedSec: round(elapsedMs / 1000, 1),
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    injSpringTrades: injSpringTrades.length,
    injSpringPnl: round(injSpringTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    injSpringWins: injSpringTrades.filter((trade) => trade.net_pnl > 0).length,
    symbols: symbolRows,
  };
}

function toMarkdown(summaries: ReturnType<typeof summarize>[]) {
  const [base, variant] = summaries;
  const diff = variant && base ? round(variant.endEquity - base.endEquity) : 0;
  const diffPct = variant && base ? round((variant.endEquity / base.endEquity - 1) * 100, 3) : 0;
  return [
    "# V7 + INJ Spring Cash Engine-Direct Backtest",
    "",
    "- method: engine-direct V7 live-equivalent",
    "- added logic: INJ spring cash no-cap quote1%",
    "- entry: USDT/cash only, Feb-May, 1h halfback rebreak, alt breadth gate",
    "- exit: V7 existing exits remain active, plus hard stop 8.5%, trail 34% / 12%, max hold 50 days",
    "- frame snapshot: enabled",
    "",
    "## Period",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "",
    "## Summary",
    "",
    "| pattern | End Equity | diff | diff % | MaxDD | PF | Trades | INJ spring trades | INJ spring PnL |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summaries.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${row.label === "baseline" ? "0" : diff.toLocaleString()} | ${row.label === "baseline" ? "0%" : `${diffPct}%`} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.injSpringTrades} | ${row.injSpringPnl.toLocaleString()} |`),
    "",
    "## Variant Symbol PnL",
    "",
    "| symbol | PnL | trades |",
    "| --- | ---: | ---: |",
    ...(variant?.symbols ?? []).map((row) => `| ${row.symbol} | ${row.pnl.toLocaleString()} | ${row.trades} |`),
    "",
  ].join("\n");
}

async function main() {
  const [strategy, engine] = await Promise.all([
    import("../config/reclaimHybridStrategy"),
    import("../lib/backtest/hybrid-engine"),
  ]);
  const { RECLAIM_HYBRID_EXECUTION_PROFILE, buildReclaimHybridCashRescueVariantOptions } = strategy;
  const { runHybridBacktest } = engine;

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseOptions: import("../lib/backtest/hybrid-engine").HybridVariantOptions = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };
  const variantOptions: import("../lib/backtest/hybrid-engine").HybridVariantOptions = {
    ...baseOptions,
    label: "v7_plus_inj_spring_cash_nocap_quote1pct",
    injSpringCashEntry: true,
    injSpringCashQuoteCostPct: 0.01,
    injSpringCashHardStopLossPct: 0.085,
    injSpringCashTrailActivationPct: 0.34,
    injSpringCashTrailRetracePct: 0.12,
    injSpringCashMaxHoldBars: 24 * 50,
  };

  const rows = [];
  for (const [label, options] of [
    ["baseline", baseOptions],
    ["v7_plus_inj_spring_cash_nocap_quote1pct", variantOptions],
  ] as const) {
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", options);
    rows.push(summarize(label, result, Date.now() - started));
    await fs.writeFile(path.join(REPORT_DIR, `${label}-trades.json`), JSON.stringify(result.trade_pairs, null, 2), "utf8");
  }

  const markdown = toMarkdown(rows);
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
