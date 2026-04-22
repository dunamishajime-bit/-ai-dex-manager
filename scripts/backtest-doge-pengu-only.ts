import path from "path";
import fs from "fs/promises";

import { loadHistoricalCandles } from "@/lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "@/lib/backtest/reporting";
import type { Candle1h, TradePairRow } from "@/lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "doge-pengu-only");
const DATA_START = Date.UTC(2022, 0, 1, 0, 0, 0);
const DATA_END = Date.UTC(2026, 0, 1, 0, 0, 0) - 1;
const BLOCK_ALL_TIME = {
  ETH: [{ startTs: DATA_START, endTs: DATA_END }],
  SOL: [{ startTs: DATA_START, endTs: DATA_END }],
  AVAX: [{ startTs: DATA_START, endTs: DATA_END }],
} satisfies NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]>;

function toIso(ts: number) {
  return new Date(ts).toISOString();
}

function pctChange(from: number, to: number) {
  return from > 0 ? ((to / from) - 1) * 100 : 0;
}

function findIndexByTs(candles: Candle1h[], ts: number) {
  let lo = 0;
  let hi = candles.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function maxHighPct(candles: Candle1h[], startIndex: number, endIndex: number, base: number) {
  let maxHigh = base;
  for (let i = Math.max(0, startIndex); i <= Math.min(candles.length - 1, endIndex); i += 1) {
    maxHigh = Math.max(maxHigh, candles[i].high);
  }
  return pctChange(base, maxHigh);
}

function preEntryMovePct(candles: Candle1h[], entryIndex: number, lookbackBars = 12) {
  const prevIndex = Math.max(0, entryIndex - lookbackBars);
  const prevClose = candles[prevIndex]?.close;
  const entryOpen = candles[entryIndex]?.open;
  if (!prevClose || !entryOpen) return 0;
  return pctChange(prevClose, entryOpen);
}

function classifyLoss(trade: TradePairRow, candles: Candle1h[]) {
  const entryTime = Date.parse(trade.entry_time);
  const exitTime = Date.parse(trade.exit_time);
  const entryIndex = findIndexByTs(candles, entryTime);
  const exitIndex = findIndexByTs(candles, exitTime);
  if (entryIndex < 0 || exitIndex < 0) {
    return {
      entryDelayLike: false,
      exitDelayLike: false,
      preEntryMovePct: 0,
      postEntryBestPct: 0,
    };
  }

  const entryOpen = candles[entryIndex]?.open ?? trade.entry_price;
  const preEntryMove = preEntryMovePct(candles, entryIndex, 12);
  const postEntryBest = maxHighPct(candles, entryIndex, exitIndex, entryOpen);
  const entryDelayLike = preEntryMove >= 2.5 && trade.net_pnl < 0;
  const exitDelayLike =
    postEntryBest >= 2.5 &&
    trade.net_pnl < 0 &&
    (
      trade.exit_reason === "sma40-break" ||
      trade.exit_reason === "sma-break" ||
      trade.exit_reason === "weak-trend-off" ||
      trade.exit_reason === "risk-off" ||
      trade.exit_reason === "end-of-test"
    );

  return {
    entryDelayLike,
    exitDelayLike,
    preEntryMovePct: preEntryMove,
    postEntryBestPct: postEntryBest,
  };
}

async function analyzeSymbol(symbol: "DOGE" | "PENGU") {
  const candles = await loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: path.join(process.cwd(), ".cache", "doge-pengu-only"),
    startMs: DATA_START,
    endMs: DATA_END,
  });

  const options: HybridVariantOptions = {
    label: `${symbol.toLowerCase()}_only_current_logic`,
    strictExtraTrendSymbols: [symbol],
    strictExtraTrendIdleOnly: false,
    trendSymbolBlockWindows: BLOCK_ALL_TIME,
    rangeSymbols: [],
    auxRangeSymbols: [],
    aux2RangeSymbols: [],
  };

  const result = await runHybridBacktest("RETQ22", options);
  await writeBacktestArtifacts(result, path.join(REPORT_DIR, symbol.toLowerCase()));

  const losingTrades = result.trade_pairs.filter((trade) => trade.net_pnl < 0);
  const analyzed = losingTrades.map((trade) => ({
    trade,
    ...classifyLoss(trade, candles),
  }));

  const entryDelayLikeCount = analyzed.filter((item) => item.entryDelayLike).length;
  const exitDelayLikeCount = analyzed.filter((item) => item.exitDelayLike).length;

  return {
    symbol,
    result,
    losingTrades: losingTrades.length,
    entryDelayLikeCount,
    exitDelayLikeCount,
    analyzed: analyzed
      .sort((left, right) => right.trade.net_pnl - left.trade.net_pnl)
      .slice(0, 12)
      .map((item) => ({
        entry_time: item.trade.entry_time,
        exit_time: item.trade.exit_time,
        net_pnl: item.trade.net_pnl,
        holding_bars: item.trade.holding_bars,
        entry_reason: item.trade.entry_reason,
        exit_reason: item.trade.exit_reason,
        pre_entry_move_pct: Number(item.preEntryMovePct.toFixed(2)),
        post_entry_best_pct: Number(item.postEntryBestPct.toFixed(2)),
        entry_delay_like: item.entryDelayLike,
        exit_delay_like: item.exitDelayLike,
      })),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const doge = await analyzeSymbol("DOGE");
  const pengu = await analyzeSymbol("PENGU");

  const payload = {
    doge: {
      summary: doge.result.summary,
      trade_pairs: doge.result.trade_pairs.length,
      losing_trades: doge.losingTrades,
      entry_delay_like: doge.entryDelayLikeCount,
      exit_delay_like: doge.exitDelayLikeCount,
      samples: doge.analyzed,
    },
    pengu: {
      summary: pengu.result.summary,
      trade_pairs: pengu.result.trade_pairs.length,
      losing_trades: pengu.losingTrades,
      entry_delay_like: pengu.entryDelayLikeCount,
      exit_delay_like: pengu.exitDelayLikeCount,
      samples: pengu.analyzed,
    },
  };

  await fs.writeFile(path.join(REPORT_DIR, "comparison.json"), JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "comparison.md"),
    [
      "# DOGE / PENGU only backtest",
      "",
      "## DOGE",
      "",
      formatResultSummary(doge.result),
      "",
      `- Losing trades: ${doge.losingTrades}`,
      `- Entry-delay-like losses: ${doge.entryDelayLikeCount}`,
      `- Exit-delay-like losses: ${doge.exitDelayLikeCount}`,
      "",
      "## PENGU",
      "",
      formatResultSummary(pengu.result),
      "",
      `- Losing trades: ${pengu.losingTrades}`,
      `- Entry-delay-like losses: ${pengu.entryDelayLikeCount}`,
      `- Exit-delay-like losses: ${pengu.exitDelayLikeCount}`,
      "",
      "## Sample losing trades",
      "",
      "### DOGE",
      "",
      ...doge.analyzed.map((item) => `- ${item.entry_time} -> ${item.exit_time} | pnl=${item.net_pnl.toFixed(2)} | hold=${item.holding_bars} | pre=${item.pre_entry_move_pct.toFixed(2)}% | postBest=${item.post_entry_best_pct.toFixed(2)}% | entryDelay=${item.entry_delay_like} | exitDelay=${item.exit_delay_like}`),
      "",
      "### PENGU",
      "",
      ...pengu.analyzed.map((item) => `- ${item.entry_time} -> ${item.exit_time} | pnl=${item.net_pnl.toFixed(2)} | hold=${item.holding_bars} | pre=${item.pre_entry_move_pct.toFixed(2)}% | postBest=${item.post_entry_best_pct.toFixed(2)}% | entryDelay=${item.entry_delay_like} | exitDelay=${item.exit_delay_like}`),
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
