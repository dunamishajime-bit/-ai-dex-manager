import fs from "fs/promises";
import path from "path";
import { parseUnits } from "viem";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-bnb-idle-liquidity-candidate-search");
const SOURCE_FILES = [
  path.join(process.cwd(), "reports", "bnbchain-unseen-candidate-source", "candidates.json"),
  path.join(process.cwd(), "reports", "bnbchain-all-candidate-source", "candidates.json"),
];

const USDT = {
  address: "0x55d398326f99059fF775485246999027B3197955",
  decimals: 18,
};

const EXCLUDED = new Set([
  "BTC", "ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT", "BNB", "LINK",
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "AEUR", "EURI", "FRAX", "XUSD", "USD1", "USDE", "WBTC", "WBETH",
  "XPL", "GPS", "NIGHT", "BARD", "SOLV", "TUT",
  "AAVE", "ACH", "ADA", "ALPACA", "ANKR", "ARPA", "ATOM", "AXS", "BAT", "BCH", "CAKE", "CELO", "CHR", "CHZ", "COMP", "COTI", "CRV", "CVC", "DASH", "DENT", "DODO", "DOT", "DYDX", "ENJ", "EOS", "FET", "FIL", "FTM", "GALA", "GLMR", "GMT", "HOT", "IOST", "IOTX", "JASMY", "KAVA", "KMD", "LRC", "LTC", "MAGIC", "MANA", "MASK", "MATIC", "MTL", "NEAR", "NEO", "NKN", "ONE", "ONT", "OXT", "PEPE", "PHA", "POND", "POWR", "QTUM", "REQ", "RLC", "ROSE", "RUNE", "SAND", "SFP", "SHIB", "SKL", "SPELL", "STORJ", "SUPER", "SYS", "TLM", "TRX", "VIC", "VITE", "VTHO", "WAN", "WAXP", "WING", "WOO", "WRX", "XNO", "XRP", "XTZ", "XVS", "YGG", "ZEC", "ZIL",
]);

type CandidateSource = { symbol: string; id?: string; address?: string };

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadSources() {
  const bySymbol = new Map<string, CandidateSource>();
  for (const file of SOURCE_FILES) {
    const rows = await readJsonIfExists<CandidateSource[]>(file);
    for (const row of rows ?? []) {
      const symbol = row.symbol?.toUpperCase();
      if (!symbol || !row.address) continue;
      bySymbol.set(symbol, { ...row, symbol });
    }
  }
  return [...bySymbol.values()].filter((row) => !EXCLUDED.has(row.symbol));
}

async function loadBinanceTradingSet() {
  const response = await fetch("https://api.binance.com/api/v3/exchangeInfo", { cache: "no-store" });
  const raw = await response.json();
  const symbols = new Set<string>();
  for (const item of raw.symbols ?? []) {
    if (item.quoteAsset === "USDT" && item.status === "TRADING") {
      symbols.add(String(item.baseAsset).toUpperCase());
    }
  }
  return symbols;
}

async function loadTicker(symbol: string) {
  const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`, { cache: "no-store" });
  if (!response.ok) return null;
  const raw = await response.json();
  return {
    quoteVolume: Number(raw.quoteVolume),
    trades: Number(raw.count),
    priceChangePct: Number(raw.priceChangePercent),
    lastPrice: Number(raw.lastPrice),
  };
}

async function quoteOpenOcean(address: string, notional: number) {
  const amountWei = parseUnits(String(notional), USDT.decimals).toString();
  const search = new URLSearchParams({
    inTokenAddress: USDT.address,
    outTokenAddress: address,
    amountDecimals: amountWei,
    gasPriceDecimals: "1000000000",
    slippage: "1",
  });
  const response = await fetch(`https://open-api.openocean.finance/v4/bsc/swap?${search.toString()}`, { cache: "no-store" });
  const raw = await response.json().catch(() => null);
  const data = raw?.data;
  if (!response.ok || Number(raw?.code) !== 200 || !data?.outAmount) {
    return { ok: false, error: raw?.error ?? raw?.message ?? raw?.desc ?? response.statusText };
  }
  const srcUsd = Number(data?.inToken?.usd) * notional;
  const outAmount = Number(data.outAmount) / 1e18;
  const destUsd = Number(data?.outToken?.usd) * outAmount;
  return {
    ok: true,
    valueLossPct: Number.isFinite(srcUsd) && srcUsd > 0 && Number.isFinite(destUsd)
      ? round((1 - destUsd / srcUsd) * 100, 4)
      : null,
    estimatedGas: Number(data.estimatedGas),
  };
}

async function quoteParaSwap(address: string, notional: number) {
  const amountWei = parseUnits(String(notional), USDT.decimals).toString();
  const url = "https://api.paraswap.io/prices"
    + `?srcToken=${USDT.address}`
    + `&destToken=${address}`
    + `&amount=${amountWei}`
    + "&network=56&side=SELL"
    + `&srcDecimals=${USDT.decimals}&destDecimals=18`;
  const response = await fetch(url, { cache: "no-store" });
  const raw = await response.json().catch(() => null);
  const route = raw?.priceRoute;
  if (!response.ok || !route?.destAmount) {
    return { ok: false, error: raw?.error ?? raw?.message ?? response.statusText };
  }
  const srcUsd = Number(route.srcUSD ?? route.srcAmountUSD);
  const destUsd = Number(route.destUSD ?? route.destAmountUSD);
  return {
    ok: true,
    valueLossPct: Number.isFinite(srcUsd) && srcUsd > 0 && Number.isFinite(destUsd)
      ? round((1 - destUsd / srcUsd) * 100, 4)
      : null,
    priceImpactPct: Number(route.priceImpact),
  };
}

async function bestQuote(address: string, notional: number) {
  const [paraswap, openocean] = await Promise.all([
    quoteParaSwap(address, notional).catch((error) => ({ ok: false, error: String(error) })),
    quoteOpenOcean(address, notional).catch((error) => ({ ok: false, error: String(error) })),
  ]);
  const quotes = [
    { provider: "paraswap", ...paraswap },
    { provider: "openocean", ...openocean },
  ].filter((quote: any) => quote.ok);
  quotes.sort((left: any, right: any) => (left.valueLossPct ?? 999) - (right.valueLossPct ?? 999));
  return { best: quotes[0] ?? null, routeCount: quotes.length, paraswap, openocean };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const sources = await loadSources();
  const trading = await loadBinanceTradingSet();
  const binanceCandidates = sources.filter((row) => trading.has(row.symbol));

  const rows = [];
  for (const source of binanceCandidates) {
    const ticker = await loadTicker(source.symbol).catch(() => null);
    if (!ticker || ticker.quoteVolume < 300_000) continue;
    const q100 = await bestQuote(source.address!, 100);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const q300 = await bestQuote(source.address!, 300);
    rows.push({
      symbol: source.symbol,
      id: source.id ?? "",
      address: source.address,
      quoteVolume24h: round(ticker.quoteVolume, 2),
      trades24h: ticker.trades,
      lastPrice: ticker.lastPrice,
      q100Routes: q100.routeCount,
      q100Provider: (q100.best as any)?.provider ?? null,
      q100LossPct: (q100.best as any)?.valueLossPct ?? null,
      q300Routes: q300.routeCount,
      q300Provider: (q300.best as any)?.provider ?? null,
      q300LossPct: (q300.best as any)?.valueLossPct ?? null,
      pass: Boolean((q100.best as any)?.valueLossPct != null && (q100.best as any).valueLossPct <= 1
        && (q300.best as any)?.valueLossPct != null && (q300.best as any).valueLossPct <= 1),
    });
    console.log(`${source.symbol}: vol=${round(ticker.quoteVolume, 0)} q100=${(q100.best as any)?.valueLossPct ?? "-"} q300=${(q300.best as any)?.valueLossPct ?? "-"}`);
  }

  rows.sort((left, right) =>
    Number(right.pass) - Number(left.pass)
    || (left.q300LossPct ?? 999) - (right.q300LossPct ?? 999)
    || right.quoteVolume24h - left.quoteVolume24h,
  );

  const md = [
    "# V7 BNB Idle Liquidity Candidate Search",
    "",
    `- checked_at: ${new Date().toISOString()}`,
    "- source: local BNB Chain candidate list + Binance USDT trading set",
    "- excluded: current V7 symbols, prior broad-tested symbols, previous six candidates",
    "- pass rule: Binance 24h quote volume >= 300k USDT and best BNB Chain quote value loss <= 1% at both 100 and 300 USDT",
    "",
    "| symbol | pass | 24h USDT vol | trades | q100 routes | q100 best | q100 loss % | q300 routes | q300 best | q300 loss % | address |",
    "| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: | --- |",
    ...rows.map((row) => `| ${row.symbol} | ${row.pass ? "yes" : "no"} | ${row.quoteVolume24h} | ${row.trades24h} | ${row.q100Routes} | ${row.q100Provider ?? "-"} | ${row.q100LossPct ?? "-"} | ${row.q300Routes} | ${row.q300Provider ?? "-"} | ${row.q300LossPct ?? "-"} | ${row.address} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "liquidity.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "liquidity.md"), md, "utf8");
  console.log(JSON.stringify({ searched: binanceCandidates.length, rows: rows.slice(0, 20), report: path.join(REPORT_DIR, "liquidity.md") }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
