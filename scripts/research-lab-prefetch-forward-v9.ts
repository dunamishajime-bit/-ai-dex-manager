import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";

const START_TS = Date.UTC(2026, 0, 1);
const END_TS = Date.UTC(2026, 6, 18);
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
