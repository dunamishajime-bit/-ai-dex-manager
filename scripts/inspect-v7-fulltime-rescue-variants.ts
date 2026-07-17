import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-fulltime-rescue-inspection");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildCashOnlyWindows(points: Array<{ ts: number; decision: { desiredSymbol: string; desiredSide: string } }>) {
  const cashPoints = points
    .filter((point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash")
    .sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }
    if (prev != null && point.ts - prev <= STEP_MS) {
      prev = point.ts;
      continue;
    }
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
    start = point.ts;
    prev = point.ts;
  }

  if (start != null) windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  return windows;
}

function invertWindows(windows: readonly Window[], startTs: number, endTs: number) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;
  for (const window of sorted) {
    if (window.startTs > cursor) inverted.push({ startTs: cursor, endTs: window.startTs });
    cursor = Math.max(cursor, window.endTs);
  }
  if (cursor < endTs) inverted.push({ startTs: cursor, endTs });
  return inverted.filter((window) => window.endTs > window.startTs);
}

async function main() {
  const strategy = await import("../config/reclaimHybridStrategy");
  const engine = await import("../lib/backtest/hybrid-engine");
  const {
    RECLAIM_HYBRID_EXECUTION_PROFILE,
    buildReclaimHybridVariantOptions,
    buildReclaimHybridCashRescueVariantOptions,
  } = strategy;
  const { analyzeHybridDecisionWindow, runHybridBacktest } = engine;

  const baseOptions = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };
  const fullRescue = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };
  const twtOnly = {
    ...fullRescue,
    expandedTrendSymbols: fullRescue.expandedTrendSymbols.filter((symbol) => symbol !== "UNI"),
    trendPrioritySymbols: ["TWT"],
    trendRotationCurrentSymbols: fullRescue.trendRotationCurrentSymbols.filter((symbol) => symbol !== "UNI"),
  };
  const uniOnly = {
    ...fullRescue,
    expandedTrendSymbols: fullRescue.expandedTrendSymbols.filter((symbol) => symbol !== "TWT"),
    trendPrioritySymbols: [],
    trendRotationCurrentSymbols: fullRescue.trendRotationCurrentSymbols,
  };
  const baseDecisionWindow = await analyzeHybridDecisionWindow("RETQ22", baseOptions);
  const cashOnlyWindows = buildCashOnlyWindows(baseDecisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const cashOnlyUniTwt = {
    ...fullRescue,
    trendSymbolBlockWindows: {
      UNI: nonCashWindows,
      TWT: nonCashWindows,
    },
  };
  const cashOnlyTwt = {
    ...twtOnly,
    trendSymbolBlockWindows: {
      TWT: nonCashWindows,
    },
  };

  const variants = [
    { label: "cash_windows_uni_twt", options: cashOnlyUniTwt },
    { label: "cash_windows_twt_only", options: cashOnlyTwt },
    { label: "full_time_uni_twt", options: fullRescue },
    { label: "full_time_twt_only", options: twtOnly },
    { label: "full_time_uni_only", options: uniOnly },
  ];

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];

  for (const variant of variants) {
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...variant.options,
      label: variant.label,
    });
    const symbolRows = Object.entries(result.summary.symbol_contribution)
      .map(([symbol, pnl]) => ({
        symbol,
        pnl: round(Number(pnl)),
        trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
      }))
      .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
    rows.push({
      label: variant.label,
      elapsedSec: round((Date.now() - started) / 1000, 1),
      endEquity: round(result.summary.end_equity),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      trades: result.summary.trade_count,
      exposurePct: round(result.summary.exposure_pct),
      symbols: symbolRows,
    });
    await fs.writeFile(
      path.join(REPORT_DIR, `${variant.label}.trades.json`),
      JSON.stringify(result.trade_pairs, null, 2),
      "utf8",
    );
  }

  const markdown = [
    "# V7 Full-Time Rescue Inspection",
    "",
    `Period: ${new Date(START_TS).toISOString()} to ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | End Equity | MaxDD | PF | Trades | Exposure |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% |`),
    "",
    ...rows.flatMap((row) => [
      `## ${row.label}`,
      "",
      "| symbol | PnL | trades |",
      "| --- | ---: | ---: |",
      ...row.symbols.map((symbol) => `| ${symbol.symbol} | ${symbol.pnl.toLocaleString()} | ${symbol.trades} |`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
