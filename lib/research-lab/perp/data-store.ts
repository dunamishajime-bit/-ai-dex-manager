import path from "path";

import { loadUsdMFuturesSymbol } from "./futures-data-source";
import type { PerpMarketData } from "./types";

const dataPromises = new Map<string, Promise<PerpMarketData>>();

function dataKey(symbols: string[], startTs: number, endTs: number) {
  return `${[...symbols].sort().join(",")}:${startTs}:${endTs}:usdm-v1`;
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
    const cacheRoot = path.join(process.cwd(), ".cache", "perp-research-usdm");
    const bySymbol: PerpMarketData["bySymbol"] = {};
    const fundingBySymbol: PerpMarketData["fundingBySymbol"] = {};

    for (const baseSymbol of symbols) {
      const symbol = `${baseSymbol}USDT`;
      const result = await loadUsdMFuturesSymbol({
        symbol,
        cacheRoot,
        startTs: input.startTs,
        endTs: input.endTs,
      });
      bySymbol[baseSymbol] = result.candles;
      fundingBySymbol[baseSymbol] = result.funding;
    }

    return {
      startTs: input.startTs,
      endTs: input.endTs,
      source: "binance-usdm-futures",
      bySymbol,
      fundingBySymbol,
    } satisfies PerpMarketData;
  })();

  dataPromises.set(key, promise);
  promise.catch(() => dataPromises.delete(key));
  return promise;
}
