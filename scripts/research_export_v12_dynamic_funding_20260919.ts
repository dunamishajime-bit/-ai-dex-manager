import fs from "node:fs/promises";
import path from "node:path";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";

const H = 3_600_000;
const START = Date.UTC(2025, 7, 10);
const END = Date.UTC(2026, 7, 10);
const WARM = START - 180 * 24 * H;
const SYMS = ["BTC","ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","XRP","ADA","LTC","ATOM","AAVE","NEAR"];

async function main() {
  const d = await loadPerpMarketData({ symbols: SYMS, startTs: WARM, endTs: END + 4 * H });
  const out: any = { source: d.source, startTs: WARM, endTs: END + 4 * H, fundingBySymbol: {} };
  for (const s of SYMS) {
    out.fundingBySymbol[s] = (d.fundingBySymbol[s] || []).map((x) => ({ ts: x.ts, rate: x.rate }));
  }
  const target = path.join(process.cwd(), ".research-state", "v12-dynamic-residual", "funding.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(out));
  console.log(JSON.stringify({ status: "PASS", target, source: d.source,
    counts: Object.fromEntries(SYMS.map((s) => [s, out.fundingBySymbol[s].length])) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
