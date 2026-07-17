import fs from "fs/promises";
import path from "path";
import { formatUnits, parseUnits } from "viem";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-new-pengu-replacement-candidates");
const CHAIN_ID = 56;
const USDT = {
  address: "0x55d398326f99059fF775485246999027B3197955",
  decimals: 18,
};
const NOTIONALS = [100, 300, 1000];
const ADDRESS_FALLBACK: Record<string, { address: string; decimals: number; source: string }> = {
  COS: { address: "0x96dd399f9c3afda1f194182f71600f1b65946501", decimals: 18, source: "TradingStrategy BNB token page" },
  RDNT: { address: "0xf7DE7E8A6bd59ED41a4b5fe50278b3B7f31384dF", decimals: 18, source: "Radiant official docs" },
  HOOK: { address: "0xa260e12d2b924cb899ae80bb58123ac3fee1e2f0", decimals: 18, source: "BscScan / CoinMarketCap" },
};

type Candidate = {
  symbol: string;
  id: string;
  name: string;
  address: string;
  decimals: number;
};

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function units(amountWei: string, decimals: number) {
  try {
    return Number(formatUnits(BigInt(amountWei), decimals));
  } catch {
    return 0;
  }
}

function parseNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${raw.slice(0, 160)}`);
  return JSON.parse(raw) as T;
}

async function loadOpenOceanDecimals() {
  const urls = [
    "https://open-api.openocean.finance/v4/bsc/tokenList",
    "https://open-api.openocean.finance/v3/bsc/tokenList",
  ];
  for (const url of urls) {
    try {
      const raw = await fetchJson<any>(url);
      const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.data?.tokens) ? raw.data.tokens : Array.isArray(raw?.tokens) ? raw.tokens : [];
      const map = new Map<string, number>();
      for (const token of list) {
        const address = String(token.address || token.tokenAddress || "").toLowerCase();
        const decimals = Number(token.decimals);
        if (address && Number.isFinite(decimals)) map.set(address, decimals);
      }
      if (map.size) return map;
    } catch {
      // try the next version
    }
  }
  return new Map<string, number>();
}

async function loadCandidates() {
  const summary = JSON.parse(await fs.readFile(path.join(REPORT_DIR, "summary.json"), "utf8")) as Array<{ symbol: string; id: string; name: string }>;
  const decimalsByAddress = await loadOpenOceanDecimals();
  const rows: Candidate[] = [];
  for (const item of summary.slice(0, 12)) {
    const fallback = ADDRESS_FALLBACK[item.symbol];
    let address = fallback?.address ?? "";
    if (!address) {
      const detail = await fetchJson<any>(`https://api.coingecko.com/api/v3/coins/${item.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`);
      address = String(detail?.platforms?.["binance-smart-chain"] || detail?.platforms?.["bnb-smart-chain"] || "").trim();
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (!address) continue;
    rows.push({
      symbol: item.symbol,
      id: item.id,
      name: item.name,
      address,
      decimals: decimalsByAddress.get(address.toLowerCase()) ?? fallback?.decimals ?? 18,
    });
  }
  return rows;
}

async function paraSwapQuote(candidate: Candidate, amountWei: string) {
  const url = "https://api.paraswap.io/prices"
    + `?srcToken=${USDT.address}`
    + `&destToken=${candidate.address}`
    + `&amount=${amountWei}`
    + `&network=${CHAIN_ID}`
    + "&side=SELL"
    + `&srcDecimals=${USDT.decimals}`
    + `&destDecimals=${candidate.decimals}`;
  const response = await fetch(url, { cache: "no-store" });
  const raw = await response.json().catch(() => null);
  const route = raw?.priceRoute;
  if (!response.ok || !route?.destAmount) {
    return { provider: "paraswap", ok: false, error: raw?.error ?? raw?.message ?? response.statusText };
  }
  const out = units(String(route.destAmount), candidate.decimals);
  const srcUsd = parseNumber(route.srcUSD ?? route.srcAmountUSD);
  const destUsd = parseNumber(route.destUSD ?? route.destAmountUSD);
  return {
    provider: "paraswap",
    ok: true,
    out,
    srcUsd,
    destUsd,
    valueLossPct: srcUsd && destUsd ? round((1 - destUsd / srcUsd) * 100, 4) : null,
    priceImpactPct: parseNumber(route.priceImpact),
  };
}

async function openOceanQuote(candidate: Candidate, amountWei: string) {
  const search = new URLSearchParams({
    inTokenAddress: USDT.address,
    outTokenAddress: candidate.address,
    amountDecimals: amountWei,
    gasPriceDecimals: "1000000000",
    slippage: "1",
  });
  const url = `https://open-api.openocean.finance/v4/bsc/swap?${search.toString()}`;
  const response = await fetch(url, { cache: "no-store" });
  const raw = await response.json().catch(() => null);
  const data = raw?.data;
  if (!response.ok || Number(raw?.code) !== 200 || !data?.outAmount) {
    return { provider: "openocean", ok: false, error: raw?.error ?? raw?.message ?? raw?.desc ?? response.statusText };
  }
  const out = units(String(data.outAmount), candidate.decimals);
  const srcPrice = parseNumber(data?.inToken?.usd);
  const destPrice = parseNumber(data?.outToken?.usd);
  const srcUsd = srcPrice ? srcPrice * units(amountWei, USDT.decimals) : null;
  const destUsd = destPrice ? destPrice * out : null;
  return {
    provider: "openocean",
    ok: true,
    out,
    srcUsd,
    destUsd,
    valueLossPct: srcUsd && destUsd ? round((1 - destUsd / srcUsd) * 100, 4) : null,
    priceImpactPct: parseNumber(data.price_impact),
  };
}

async function main() {
  const candidates = await loadCandidates();
  const rows = [];
  for (const candidate of candidates) {
    for (const notional of NOTIONALS) {
      const amountWei = parseUnits(String(notional), USDT.decimals).toString();
      const [paraswap, openocean] = await Promise.all([
        paraSwapQuote(candidate, amountWei).catch((error) => ({ provider: "paraswap", ok: false, error: String(error) })),
        openOceanQuote(candidate, amountWei).catch((error) => ({ provider: "openocean", ok: false, error: String(error) })),
      ]);
      const okQuotes = [paraswap, openocean].filter((quote: any) => quote.ok);
      const best = okQuotes.slice().sort((left: any, right: any) => {
        const leftLoss = left.valueLossPct == null ? 999 : left.valueLossPct;
        const rightLoss = right.valueLossPct == null ? 999 : right.valueLossPct;
        return leftLoss - rightLoss;
      })[0] as any;
      rows.push({
        symbol: candidate.symbol,
        name: candidate.name,
        address: candidate.address,
        decimals: candidate.decimals,
        notionalUsdt: notional,
        routeCount: okQuotes.length,
        bestProvider: best?.provider ?? null,
        bestValueLossPct: best?.valueLossPct ?? null,
        bestPriceImpactPct: best?.priceImpactPct ?? null,
        paraswap,
        openocean,
      });
      console.log(`${candidate.symbol} ${notional}: routes=${okQuotes.length} best=${best?.provider ?? "-"} loss=${best?.valueLossPct ?? "-"}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  const md = [
    "# V7 New PENGU Replacement Candidate Quotes",
    "",
    `- checked_at: ${new Date().toISOString()}`,
    "- chain: BNB Chain",
    "- direction: USDT -> candidate",
    "- pass target: value loss <= 1% at 100 and 300 USDT. 1000 USDT is informational only.",
    "",
    "| symbol | notional USDT | routes | best provider | best value loss % | price impact % | address |",
    "| --- | ---: | ---: | --- | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.symbol} | ${row.notionalUsdt} | ${row.routeCount} | ${row.bestProvider ?? "-"} | ${row.bestValueLossPct ?? "-"} | ${row.bestPriceImpactPct ?? "-"} | ${row.address} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "quotes.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "quotes.md"), md, "utf8");
  console.log(`[done] ${path.join(REPORT_DIR, "quotes.md")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
