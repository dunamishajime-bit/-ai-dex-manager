import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";

const DEFAULT_START_TS = Date.UTC(2022, 8, 1); // 2022-09-01 UTC
const DEFAULT_END_TS = Date.UTC(2026, 7, 10);  // 2026-08-10 UTC; covers the fixed 2026-08-09 JST research end
const SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"];

function dateEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error(`INVALID_${name}:${raw}`);
  return parsed;
}

async function main() {
  const startTs = dateEnv("PERP_RESEARCH_START_DATE", DEFAULT_START_TS);
  const endTs = dateEnv("PERP_RESEARCH_END_DATE", DEFAULT_END_TS);
  if (endTs <= startTs) throw new Error(`INVALID_DATE_RANGE:${startTs}:${endTs}`);
  const data = await loadPerpMarketData({ symbols: SYMBOLS, startTs, endTs });
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
