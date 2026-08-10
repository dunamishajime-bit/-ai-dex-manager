import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";

const START_TS = Date.UTC(2022, 8, 1); // 2022-09-01 UTC
const END_TS = Date.UTC(2026, 7, 10);  // 2026-08-10 UTC; covers the fixed 2026-08-09 JST research end
const SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"];

async function main() {
  const data = await loadPerpMarketData({ symbols: SYMBOLS, startTs: START_TS, endTs: END_TS });
  console.log(JSON.stringify({
    source: data.source,
    startTs: data.startTs,
    endTs: data.endTs,
    candles: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, data.bySymbol[symbol]?.length ?? 0])),
    funding: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, data.fundingBySymbol[symbol]?.length ?? 0])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
