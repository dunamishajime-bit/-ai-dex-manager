import fs from "fs/promises";
import path from "path";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-new-pengu-replacement-candidates");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 4, 22, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;

type Market = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number;
};
type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number };
type ScoreRow = Market & {
  binanceQuoteVolume: number;
  candles: number;
  startIso: string;
  endIso: string;
  momentumScore: number;
  avgRange48hPct: number;
  avgRunup72hPct: number;
  hit20PctWindows: number;
  hit40PctWindows: number;
  positiveTrendWindowsPct: number;
  bestRunupPct: number;
  worstDrawdownPct: number;
  recent60dRunupPct: number;
  candidateScore: number;
};

const MANUAL_EXCLUDE = new Set([
  "BTC", "ETH", "BNB", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK", "LINK",
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "AEUR", "EURI", "FRAX", "XUSD", "USD1", "USDE", "WBTC", "WBETH",
  "MATIC", "POL", "ZBT", "XPL", "GPS", "NIGHT", "BARD", "SOLV", "TUT", "ZBT", "ALLO", "PROVE",
  "DEXE", "SFP", "AAVE", "ALPACA", "ARK", "BANK", "TST", "THE", "MUBARAK", "C98", "ADX", "0G",
  "ASTER", "WLFI", "JUP", "AI", "BANANA", "ACT", "HEMI", "MITO", "TOWNS", "FF", "AT", "CGPT", "FORM",
  "HOLO", "SAHARA", "ZKC", "ERA", "PENDLE", "ZKP", "BABY", "GIGGLE", "TRX", "BCH", "ZEC", "DASH",
]);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json() as Promise<T>;
}

async function loadKnownSymbols() {
  const candidates = new Set<string>(MANUAL_EXCLUDE);
  const reportRoot = path.join(process.cwd(), "reports");
  const names = await fs.readdir(reportRoot, { recursive: true }).catch(() => []);
  for (const item of names) {
    const text = String(item).toUpperCase();
    for (const token of text.match(/\b[A-Z0-9]{2,12}\b/g) ?? []) {
      if (!/^\d+$/.test(token)) candidates.add(token);
    }
  }
  const knownJsonFiles = [
    path.join(reportRoot, "bnbchain-all-candidate-source", "candidates.json"),
    path.join(reportRoot, "bnbchain-unseen-candidate-source", "candidates.json"),
    path.join(reportRoot, "v7-bnb-idle-liquidity-candidate-search", "liquidity.json"),
    path.join(reportRoot, "v7-pengu-offwindow-rotation-search", "summary.json"),
    path.join(reportRoot, "v7-pengu-nonoverlap-candidate-search", "summary.json"),
    path.join(reportRoot, "v7-bigwave-rescan-shortlist", "result.json"),
  ];
  for (const file of knownJsonFiles) {
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    for (const token of raw.match(/"symbol"\s*:\s*"([A-Z0-9]{2,12})"/g) ?? []) {
      const symbol = token.match(/"([A-Z0-9]{2,12})"$/)?.[1];
      if (symbol) candidates.add(symbol);
    }
    for (const token of raw.match(/"([A-Z0-9]{2,12})"\s*:/g) ?? []) {
      const symbol = token.match(/"([A-Z0-9]{2,12})"/)?.[1];
      if (symbol) candidates.add(symbol);
    }
  }
  return candidates;
}

async function fetchBnbMarkets() {
  const rows: Market[] = [];
  for (let page = 1; page <= 4; page += 1) {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=binance-smart-chain&order=volume_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`;
    const pageRows = await fetchJson<Market[]>(url);
    rows.push(...pageRows);
    if (pageRows.length < 250) break;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return rows;
}

async function fetchBinance24h() {
  const rows = await fetchJson<Array<{ symbol: string; quoteVolume: string; count: number }>>("https://api.binance.com/api/v3/ticker/24hr");
  const map = new Map<string, { quoteVolume: number; count: number }>();
  for (const row of rows) {
    if (!row.symbol.endsWith("USDT")) continue;
    map.set(row.symbol.slice(0, -4).toUpperCase(), { quoteVolume: Number(row.quoteVolume), count: Number(row.count) });
  }
  return map;
}

async function fetchKlines(symbol: string) {
  const out: Candle[] = [];
  let cursor = START_TS;
  while (cursor < END_TS) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1h&startTime=${cursor}&endTime=${END_TS}&limit=1000`;
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 400 || response.status === 404) break;
    if (!response.ok) throw new Error(`${symbol} ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      out.push({
        ts: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      });
    }
    const next = Number(rows.at(-1)?.[6]) + 1;
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return out;
}

function analyzeCandles(market: Market, binanceQuoteVolume: number, candles: Candle[]): ScoreRow {
  const windows: Array<{ runup: number; drawdown: number; trend: number; range: number }> = [];
  for (let index = 80; index < candles.length - 72; index += 12) {
    const entry = candles[index];
    const forward = candles.slice(index + 1, index + 73);
    const runup = Math.max(...forward.map((bar) => bar.high / entry.close - 1));
    const drawdown = Math.min(...forward.map((bar) => bar.low / entry.close - 1));
    const trend = forward.at(-1)!.close / entry.close - 1;
    const prior = candles.slice(index - 48, index);
    const range = Math.max(...prior.map((bar) => bar.high)) / Math.min(...prior.map((bar) => bar.low)) - 1;
    windows.push({ runup, drawdown, trend, range });
  }
  const recentStart = END_TS - 60 * 24 * HOUR_MS;
  const recent = candles.filter((bar) => bar.ts >= recentStart);
  const recent60dRunupPct = recent.length > 1 ? (Math.max(...recent.map((bar) => bar.high)) / recent[0].close - 1) * 100 : 0;
  const hit20 = windows.filter((item) => item.runup >= 0.2).length;
  const hit40 = windows.filter((item) => item.runup >= 0.4).length;
  const positive = windows.filter((item) => item.trend > 0).length;
  const avgRunup = average(windows.map((item) => item.runup)) * 100;
  const avgRange = average(windows.map((item) => item.range)) * 100;
  const bestRunup = Math.max(0, ...windows.map((item) => item.runup)) * 100;
  const worstDrawdown = Math.min(0, ...windows.map((item) => item.drawdown)) * 100;
  const momentumScore = recent60dRunupPct + avgRunup + hit20 * 1.5 + hit40 * 4;
  const liquidityScore = Math.log10(Math.max(1, binanceQuoteVolume)) * 8;
  const candidateScore = momentumScore + liquidityScore + Math.min(40, market.total_volume / 500_000) - Math.max(0, -worstDrawdown - 35);
  return {
    ...market,
    binanceQuoteVolume,
    candles: candles.length,
    startIso: candles[0] ? new Date(candles[0].ts).toISOString() : "-",
    endIso: candles.at(-1) ? new Date(candles.at(-1)!.ts).toISOString() : "-",
    momentumScore: round(momentumScore),
    avgRange48hPct: round(avgRange),
    avgRunup72hPct: round(avgRunup),
    hit20PctWindows: hit20,
    hit40PctWindows: hit40,
    positiveTrendWindowsPct: round((positive / Math.max(1, windows.length)) * 100),
    bestRunupPct: round(bestRunup),
    worstDrawdownPct: round(worstDrawdown),
    recent60dRunupPct: round(recent60dRunupPct),
    candidateScore: round(candidateScore),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const known = await loadKnownSymbols();
  const [markets, binance] = await Promise.all([fetchBnbMarkets(), fetchBinance24h()]);
  const candidates = markets
    .map((market) => ({ ...market, symbol: market.symbol.toUpperCase() }))
    .filter((market) => !known.has(market.symbol))
    .filter((market) => /^[A-Z0-9]{2,12}$/.test(market.symbol))
    .filter((market) => market.symbol !== "U")
    .filter((market) => binance.has(market.symbol))
    .filter((market) => (binance.get(market.symbol)?.quoteVolume ?? 0) >= 300_000)
    .filter((market) => market.total_volume >= 250_000)
    .sort((left, right) => (binance.get(right.symbol)?.quoteVolume ?? 0) - (binance.get(left.symbol)?.quoteVolume ?? 0))
    .slice(0, 35);

  const rows: ScoreRow[] = [];
  for (const market of candidates) {
    const symbol = market.symbol;
    const candles = await fetchKlines(symbol);
    if (candles.length < 500) continue;
    const row = analyzeCandles(market, binance.get(symbol)!.quoteVolume, candles);
    rows.push(row);
    console.log(`${symbol}: score=${row.candidateScore} vol=${round(row.binanceQuoteVolume, 0)} best=${row.bestRunupPct}% recent=${row.recent60dRunupPct}%`);
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  rows.sort((left, right) => right.candidateScore - left.candidateScore);

  const md = [
    "# V7 New PENGU Replacement Candidate Scan",
    "",
    `- checked_at: ${new Date().toISOString()}`,
    "- source: CoinGecko BNB Chain category + Binance USDT spot 24h ticker + Binance 1h candles",
    "- exclude: current V7 symbols and symbols that appeared in prior local reports/scripts/manual test lists",
    "- purpose: find not-yet-tested BNB Chain symbols that may behave like a new PENGU rotation candidate",
    "- note: this is a candidate scan only. Next step is BNB Chain quote check and engine-direct integration backtest.",
    "",
    "| rank | symbol | name | Binance 24h vol | CG volume | candles | recent 60d runup | avg 72h runup | hit >=20% | hit >=40% | pos trend % | best runup | worst DD | score |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.symbol} | ${row.name} | ${round(row.binanceQuoteVolume, 0)} | ${round(row.total_volume, 0)} | ${row.candles} | ${row.recent60dRunupPct} | ${row.avgRunup72hPct} | ${row.hit20PctWindows} | ${row.hit40PctWindows} | ${row.positiveTrendWindowsPct}% | ${row.bestRunupPct} | ${row.worstDrawdownPct} | ${row.candidateScore} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  console.log(`[done] ${path.join(REPORT_DIR, "summary.md")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
