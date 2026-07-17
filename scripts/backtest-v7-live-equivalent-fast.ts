import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-live-equivalent-fast");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
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

function cashWindowCachePath(baseOptions: unknown) {
  const payload = JSON.stringify({
    v: 1,
    startTs: START_TS,
    endTs: END_TS,
    baseOptions,
  });
  const key = crypto.createHash("sha1").update(payload).digest("hex");
  return path.join(process.cwd(), ".cache", "hybrid-live-equivalent-windows", `${key}.json`);
}

async function loadCashWindowSnapshot(baseOptions: unknown) {
  try {
    const raw = await fs.readFile(cashWindowCachePath(baseOptions), "utf8");
    return JSON.parse(raw) as { cashOnlyWindows: Window[]; nonCashWindows: Window[] };
  } catch {
    return null;
  }
}

async function saveCashWindowSnapshot(
  baseOptions: unknown,
  snapshot: { cashOnlyWindows: Window[]; nonCashWindows: Window[] },
) {
  const filePath = cashWindowCachePath(baseOptions);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot), "utf8");
}

function summarize(result: Awaited<ReturnType<typeof import("../lib/backtest/hybrid-engine").runHybridBacktest>>, elapsedMs: number) {
  const symbolRows = Object.entries(result.summary.symbol_contribution)
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(Number(pnl)),
      trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
    }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
  const penguPairs = result.trade_pairs.filter((row) => row.symbol === "PENGU");

  return {
    start: new Date(START_TS).toISOString(),
    end: new Date(END_TS).toISOString(),
    elapsedSec: round(elapsedMs / 1000, 1),
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguTrades: penguPairs.length,
    penguWins: penguPairs.filter((row) => row.net_pnl > 0).length,
    penguLosses: penguPairs.filter((row) => row.net_pnl <= 0).length,
    symbols: symbolRows,
  };
}

function toMarkdown(summary: ReturnType<typeof summarize>, cacheEnabled: boolean) {
  return [
    "# V7 Live Equivalent Fast Backtest",
    "",
    "- method: engine-direct live-equivalent V7",
    "- cash rescue: full-time TWT-only rescue options",
    `- frame snapshot: ${cacheEnabled ? "enabled" : "disabled"}`,
    "",
    "## Period",
    "",
    `- Start: ${summary.start}`,
    `- End: ${summary.end}`,
    `- Elapsed: ${summary.elapsedSec}s`,
    "",
    "## Summary",
    "",
    `- End Equity: ${summary.endEquity.toLocaleString()}`,
    `- CAGR: ${summary.cagrPct}%`,
    `- MaxDD: ${summary.maxDrawdownPct}%`,
    `- PF: ${summary.profitFactor}`,
    `- Trades: ${summary.trades}`,
    `- Exposure: ${summary.exposurePct}%`,
    `- PENGU W/L: ${summary.penguWins}/${summary.penguLosses}`,
    "",
    "## Symbol PnL",
    "",
    "| symbol | PnL | trades |",
    "| --- | ---: | ---: |",
    ...summary.symbols.map((row) => `| ${row.symbol} | ${row.pnl.toLocaleString()} | ${row.trades} |`),
    "",
  ].join("\n");
}

async function main() {
  const [
    strategy,
    engine,
  ] = await Promise.all([
    import("../config/reclaimHybridStrategy"),
    import("../lib/backtest/hybrid-engine"),
  ]);
  const {
    RECLAIM_HYBRID_EXECUTION_PROFILE,
    buildReclaimHybridVariantOptions,
    buildReclaimHybridCashRescueVariantOptions,
  } = strategy;
  const { analyzeHybridDecisionWindow, runHybridBacktest } = engine;

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };
  const rescue: import("../lib/backtest/hybrid-engine").HybridVariantOptions = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };

  const started = Date.now();
  const options = {
    ...rescue,
    label: "v7_live_equivalent_fast",
  };
  const result = await runHybridBacktest("RETQ22", options);
  const summary = summarize(result, Date.now() - started);
  const markdown = toMarkdown(summary, process.env.BT_USE_FRAME_SNAPSHOT === "1");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(result.trade_pairs, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
