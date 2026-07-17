import fs from "fs/promises";
import path from "path";
import { formatUnits, parseUnits } from "viem";

type Candidate = {
  symbol: string;
  address: string;
  decimals: number;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-bnb-idle-six-candidates");
const CHAIN_ID = 56;
const USDT = {
  symbol: "USDT",
  address: "0x55d398326f99059fF775485246999027B3197955",
  decimals: 18,
};

const CANDIDATES: Candidate[] = [
  { symbol: "XPL", address: "0xf84dd1ac34c0043d109f6600f98302cdd3e5a6eb", decimals: 18 },
  { symbol: "GPS", address: "0x9a4a67721573f2c9209dfff972c52be4e3f6642e", decimals: 18 },
  { symbol: "NIGHT", address: "0xfe930c2d63aed9b82fc4dbc801920dd2c1a3224f", decimals: 18 },
  { symbol: "BARD", address: "0xd23a186a78c0b3b805505e5f8ea4083295ef9f3a", decimals: 18 },
  { symbol: "SOLV", address: "0xabe8e5cabe24cb36df9540088fd7ce1175b9bc52", decimals: 18 },
  { symbol: "TUT", address: "0xcaae2a2f939f51d97cdfa9a86e79e3f085b799f3", decimals: 18 },
];

const NOTIONALS_USDT = [100, 300, 1000];

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function units(amountWei: string, decimals: number) {
  try {
    return Number(formatUnits(BigInt(amountWei), decimals));
  } catch {
    return 0;
  }
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
    estimatedGas: parseNumber(data.estimatedGas),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];

  for (const candidate of CANDIDATES) {
    for (const notional of NOTIONALS_USDT) {
      const amountWei = parseUnits(String(notional), USDT.decimals).toString();
      const [paraswap, openocean] = await Promise.all([
        paraSwapQuote(candidate, amountWei).catch((error) => ({ provider: "paraswap", ok: false, error: String(error) })),
        openOceanQuote(candidate, amountWei).catch((error) => ({ provider: "openocean", ok: false, error: String(error) })),
      ]);
      const okQuotes = [paraswap, openocean].filter((quote: any) => quote.ok);
      const best = okQuotes
        .slice()
        .sort((left: any, right: any) => (right.out ?? 0) - (left.out ?? 0))[0] as any;
      rows.push({
        symbol: candidate.symbol,
        notionalUsdt: notional,
        routeCount: okQuotes.length,
        bestProvider: best?.provider ?? null,
        bestValueLossPct: best?.valueLossPct ?? null,
        bestPriceImpactPct: best?.priceImpactPct ?? null,
        paraswap,
        openocean,
      });
    }
  }

  const md = [
    "# V7 BNB Idle Six Candidate Quotes",
    "",
    `- checked_at: ${new Date().toISOString()}`,
    "- chain: BNB Chain",
    "- direction: USDT -> candidate",
    "- notionals: 100 / 300 / 1000 USDT",
    "",
    "| symbol | notional USDT | routes | best provider | best value loss % | best price impact % |",
    "| --- | ---: | ---: | --- | ---: | ---: |",
    ...rows.map((row) => `| ${row.symbol} | ${row.notionalUsdt} | ${row.routeCount} | ${row.bestProvider ?? "-"} | ${row.bestValueLossPct ?? "-"} | ${row.bestPriceImpactPct ?? "-"} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "quotes.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "quotes.md"), md, "utf8");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
