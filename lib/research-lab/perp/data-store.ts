import path from "path";

import { loadHistoricalCandles } from "@/lib/backtest/binance-source";

import type { PerpMarketData } from "./types";

const dataPromises = new Map<string, Promise<PerpMarketData>>();

function dataKey(symbols: string[], startTs: number, endTs: number) {
  return `${[...symbols].sort().join(",")}:${startTs}:${endTs}`;
}

export async function loadPerpMarketData(input: {
  symbols: string[];
  startTs: number;
  endTs: number;
}): Promise<PerpMarketData> {
  const symbols = [...new Set(["BTC", ...input.symbols.map((symbol) => symbol.toUpperCase())])];
  const key = dataKey(symbols, input.startTs, input.endTs);
  const existing = dataPromises.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const cacheRoot = path.join(process.cwd(), ".cache", "perp-research");
    const bySymbol: Record<string, Awaited<ReturnType<typeof loadHistoricalCandles>>> = {};

    for (const symbol of symbols) {
      const candles = await loadHistoricalCandles({
        symbol: `${symbol}USDT`,
        cacheRoot,
        startMs: input.startTs,
        endMs: input.endTs,
      });
      if (!candles.length) throw new Error(`Perp research data missing for ${symbol}`);
      bySymbol[symbol] = candles;
    }

    return {
      startTs: input.startTs,
      endTs: input.endTs,
      bySymbol,
    } satisfies PerpMarketData;
  })();

  dataPromises.set(key, promise);
  promise.catch(() => dataPromises.delete(key));
  return promise;
}
