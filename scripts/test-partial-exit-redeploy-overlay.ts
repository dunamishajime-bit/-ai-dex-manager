import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { analyzeHybridDecisionWindow } from "../lib/backtest/hybrid-engine";

type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number };
type TradePair = {
  trade_id: string;
  symbol: string;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  net_pnl: number;
  fee: number;
  exit_reason: string;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-partial-redeploy-overlay");
const TRADES_PATH = path.join(process.cwd(), "reports", "v7-live-equivalent-fast", "trades.json");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const SYMBOLS = ["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "TWT"] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function loadCandles(symbol: string) {
  const remoteDir = path.join(process.cwd(), ".cache", "backtest-binance", "remote");
  const files = await fs.readdir(remoteDir);
  const prefix = `${symbol}USDT-`;
  const candidates = files
    .filter((file) => file.startsWith(prefix) && file.endsWith("-v1.json"))
    .sort((left, right) => right.localeCompare(left));
  if (!candidates.length) return [] as Candle[];
  return readJson<Candle[]>(path.join(remoteDir, candidates[0]));
}

function candleAtOrAfter(candles: Candle[], ts: number) {
  let lo = 0;
  let hi = candles.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid].ts >= ts) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best >= 0 ? candles[best] : null;
}

function latestDecision<T extends { ts: number }>(points: T[], ts: number) {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? points[best] : null;
}

function firstDecisionAfter<T extends { ts: number }>(points: T[], ts: number, maxTs: number) {
  const start = points.findIndex((point) => point.ts >= ts);
  if (start < 0) return null;
  for (let index = start; index < points.length; index += 1) {
    if (points[index].ts > maxTs) return null;
    return points[index];
  }
  return null;
}

function baseTradeId(partialId: string) {
  return partialId.replace(/-partial$/, "");
}

function candidateFor(
  decision: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>[number] | null,
  sourceSymbol: string,
  mode: "best_any" | "no_eth_doge" | "twt_pengu_sol",
) {
  if (!decision) return null;
  const allowed =
    mode === "no_eth_doge"
      ? new Set(["SOL", "AVAX", "PENGU", "INJ", "TWT"])
      : mode === "twt_pengu_sol"
        ? new Set(["TWT", "PENGU", "SOL"])
        : null;
  return [...decision.trendEvaluations]
    .filter((item) => item.eligible)
    .filter((item) => item.symbol !== sourceSymbol)
    .filter((item) => !allowed || allowed.has(item.symbol))
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0] ?? null;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const trades = await readJson<TradePair[]>(TRADES_PATH);
  const options = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", options);
  const candles = Object.fromEntries(await Promise.all(
    SYMBOLS.map(async (symbol) => [symbol, await loadCandles(symbol)]),
  )) as Record<typeof SYMBOLS[number], Candle[]>;

  const byId = new Map(trades.map((trade) => [trade.trade_id, trade]));
  const partials = trades.filter((trade) => trade.trade_id.endsWith("-partial"));
  const modes = ["best_any", "no_eth_doge", "twt_pengu_sol"] as const;
  const horizons = [
    { key: "runner_exit", ms: null },
    { key: "12h", ms: 12 * 60 * 60 * 1000 },
    { key: "24h", ms: 24 * 60 * 60 * 1000 },
    { key: "48h", ms: 48 * 60 * 60 * 1000 },
    { key: "72h", ms: 72 * 60 * 60 * 1000 },
  ] as const;
  const independentHorizons = [
    { key: "independent12h", ms: 12 * 60 * 60 * 1000 },
    { key: "independent24h", ms: 24 * 60 * 60 * 1000 },
    { key: "independent48h", ms: 48 * 60 * 60 * 1000 },
    { key: "independent72h", ms: 72 * 60 * 60 * 1000 },
  ] as const;
  const waits = [
    { key: "now", ms: 0 },
    { key: "wait48h", ms: 48 * 60 * 60 * 1000 },
    { key: "wait96h", ms: 96 * 60 * 60 * 1000 },
  ] as const;
  const rows = [];
  const details = [];

  for (const mode of modes) {
    for (const wait of waits) {
    for (const horizon of [...horizons, ...independentHorizons]) {
    const label = `${mode}_${wait.key}_${horizon.key}`;
    let pnl = 0;
    let count = 0;
    let wins = 0;
    let losses = 0;
    const bySymbol: Record<string, { trades: number; pnl: number }> = {};

    for (const partial of partials) {
      const base = byId.get(baseTradeId(partial.trade_id));
      if (!base) continue;
      const entryTs = Date.parse(partial.exit_time);
      const baseExitTs = Date.parse(base.exit_time);
      const independent = horizon.key.startsWith("independent");
      const maxEntryTs = independent
        ? entryTs + wait.ms
        : Math.min(baseExitTs - 1, entryTs + wait.ms);
      if (maxEntryTs < entryTs) continue;
      let decision = wait.ms === 0
        ? latestDecision(decisionWindow, entryTs)
        : null;
      if (wait.ms > 0) {
        const startIndex = decisionWindow.findIndex((point) => point.ts >= entryTs);
        if (startIndex >= 0) {
          for (let pointIndex = startIndex; pointIndex < decisionWindow.length; pointIndex += 1) {
            const point = decisionWindow[pointIndex];
            if (point.ts > maxEntryTs) break;
            if (candidateFor(point, partial.symbol, mode)) {
              decision = point;
              break;
            }
          }
        }
      }
      const candidate = candidateFor(decision, partial.symbol, mode);
      if (!candidate || !(candidate.symbol in candles)) continue;
      const sidecarEntryTs = wait.ms === 0 ? entryTs : decision!.ts;
      const exitTs = horizon.ms == null
        ? baseExitTs
        : independent
          ? sidecarEntryTs + horizon.ms
          : Math.min(baseExitTs, sidecarEntryTs + horizon.ms);
      if (!(exitTs > sidecarEntryTs)) continue;
      const entryBar = candleAtOrAfter(candles[candidate.symbol as typeof SYMBOLS[number]], sidecarEntryTs);
      const exitBar = candleAtOrAfter(candles[candidate.symbol as typeof SYMBOLS[number]], exitTs);
      if (!entryBar || !exitBar || entryBar.open <= 0 || exitBar.open <= 0) continue;

      const redeployCash = partial.exit_price * partial.qty * (1 - FEE_RATE);
      const finalCash = redeployCash * (exitBar.open / entryBar.open) * ((1 - FEE_RATE) / (1 + FEE_RATE));
      const sidecarPnl = finalCash - redeployCash;
      pnl += sidecarPnl;
      count += 1;
      if (sidecarPnl > 0) wins += 1;
      if (sidecarPnl < 0) losses += 1;
      bySymbol[candidate.symbol] ??= { trades: 0, pnl: 0 };
      bySymbol[candidate.symbol].trades += 1;
      bySymbol[candidate.symbol].pnl += sidecarPnl;
      details.push({
        mode: label,
        sourceTrade: partial.trade_id,
        sourceSymbol: partial.symbol,
        redeploySymbol: candidate.symbol,
        entryTime: new Date(entryBar.ts).toISOString(),
        exitTime: new Date(exitBar.ts).toISOString(),
        redeployCash: round(redeployCash),
        entryPrice: entryBar.open,
        exitPrice: exitBar.open,
        pnl: round(sidecarPnl),
        candidateScore: round(candidate.score, 3),
        candidateReason: candidate.reasons.join("|"),
      });
    }

    rows.push({
      mode: label,
      trades: count,
      pnl: round(pnl),
      projectedEndEquity: round(30_587_452.10 + pnl),
      wins,
      losses,
      symbols: Object.entries(bySymbol)
        .map(([symbol, value]) => ({ symbol, trades: value.trades, pnl: round(value.pnl) }))
        .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl)),
    });
    }
    }
  }

  const markdown = [
    "# V7 Partial Exit Redeploy Overlay",
    "",
    "Base: TWT-only full-time rescue V7 live-equivalent result.",
    "Method: after a `*-partial` exit, redeploy the sold half into the strongest eligible different symbol and close it by each horizon.",
    "",
    "| mode | overlay trades | overlay PnL | projected End Equity | wins | losses |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.mode} | ${row.trades} | ${row.pnl.toLocaleString()} | ${row.projectedEndEquity.toLocaleString()} | ${row.wins} | ${row.losses} |`),
    "",
    ...rows.flatMap((row) => [
      `## ${row.mode}`,
      "",
      "| redeploy symbol | trades | PnL |",
      "| --- | ---: | ---: |",
      ...row.symbols.map((symbol) => `| ${symbol.symbol} | ${symbol.trades} | ${symbol.pnl.toLocaleString()} |`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "details.json"), JSON.stringify(details, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
