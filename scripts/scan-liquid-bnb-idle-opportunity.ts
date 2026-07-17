import fs from "fs/promises";
import path from "path";

type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number };
type IdleWindow = { startTs: number; endTs: number; startIso: string; endIso: string };

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-bnb-idle-liquidity-candidate-search");
const LIQUIDITY_PATH = path.join(REPORT_DIR, "liquidity.json");
const IDLE_SOURCE = path.join(process.cwd(), "reports", "v7-idle-candidates-fresh", "result.json");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);

const SKIP = new Set(["ASTER", "WLFI", "币安人生", "JUP", "AI", "BANANA", "ACT", "DEXE", "HEMI"]);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function fetchKlines(symbol: string) {
  const out: Candle[] = [];
  let cursor = START_TS;
  while (cursor < END_TS) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1h&startTime=${cursor}&endTime=${END_TS}&limit=1000`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${symbol} ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) break;
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
  }
  return out;
}

function clipWindows(windows: IdleWindow[]) {
  return windows
    .map((window) => ({
      startTs: Math.max(window.startTs, START_TS),
      endTs: Math.min(window.endTs, END_TS),
      startIso: new Date(Math.max(window.startTs, START_TS)).toISOString(),
      endIso: new Date(Math.min(window.endTs, END_TS)).toISOString(),
    }))
    .filter((window) => window.endTs > window.startTs);
}

function firstAtOrAfter(candles: Candle[], ts: number) {
  return candles.find((candle) => candle.ts >= ts) ?? null;
}

function analyze(symbol: string, candles: Candle[], windows: IdleWindow[]) {
  let usable = 0;
  let positive = 0;
  let hit10 = 0;
  let hit20 = 0;
  let sumMax = 0;
  let compounded = 1;
  const top = [];

  for (const window of windows) {
    const start = firstAtOrAfter(candles, window.startTs);
    const bars = candles.filter((candle) => candle.ts >= window.startTs && candle.ts <= window.endTs);
    if (!start || bars.length < 2) continue;
    const last = bars[bars.length - 1];
    const maxHigh = Math.max(...bars.map((bar) => bar.high));
    const minLow = Math.min(...bars.map((bar) => bar.low));
    const closePct = (last.close / start.close - 1) * 100;
    const maxHighPct = (maxHigh / start.close - 1) * 100;
    const worstLowPct = (minLow / start.close - 1) * 100;
    usable += 1;
    compounded *= last.close / start.close;
    sumMax += maxHighPct;
    if (closePct > 0) positive += 1;
    if (maxHighPct >= 10) hit10 += 1;
    if (maxHighPct >= 20) hit20 += 1;
    top.push({
      start: window.startIso.slice(0, 10),
      end: window.endIso.slice(0, 10),
      maxHighPct: round(maxHighPct),
      closePct: round(closePct),
      worstLowPct: round(worstLowPct),
    });
  }
  top.sort((left, right) => right.maxHighPct - left.maxHighPct);
  return {
    symbol,
    usableWindows: usable,
    avgMaxHighPct: round(sumMax / Math.max(usable, 1)),
    hit20Windows: hit20,
    hit10Windows: hit10,
    closeCompoundedPct: round((compounded - 1) * 100),
    positiveClosePct: round((positive / Math.max(usable, 1)) * 100),
    bestMaxHighPct: top[0]?.maxHighPct ?? 0,
    topWindows: top.slice(0, 4),
  };
}

async function main() {
  const liquidity = JSON.parse(await fs.readFile(LIQUIDITY_PATH, "utf8")) as any[];
  const idleSource = JSON.parse(await fs.readFile(IDLE_SOURCE, "utf8")) as { idleWindows: IdleWindow[] };
  const windows = clipWindows(idleSource.idleWindows);

  const candidates = liquidity
    .filter((row) => row.pass)
    .filter((row) => !SKIP.has(row.symbol))
    .filter((row) => row.q100LossPct >= -1 && row.q100LossPct <= 1 && row.q300LossPct >= -1 && row.q300LossPct <= 1)
    .sort((left, right) => right.quoteVolume24h - left.quoteVolume24h)
    .slice(0, 28);

  const rows = [];
  for (const candidate of candidates) {
    const candles = await fetchKlines(candidate.symbol);
    const result = analyze(candidate.symbol, candles, windows);
    rows.push({ ...candidate, ...result });
    console.log(`${candidate.symbol}: avgMax=${result.avgMaxHighPct} hit20=${result.hit20Windows} close=${result.closeCompoundedPct}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  rows.sort((left, right) =>
    right.avgMaxHighPct - left.avgMaxHighPct
    || right.hit20Windows - left.hit20Windows
    || right.quoteVolume24h - left.quoteVolume24h,
  );

  const md = [
    "# Liquid BNB Idle Opportunity Scan",
    "",
    "- input: liquidity-passed BNB Chain symbols, excluding current/prior unsafe candidates",
    "- method: Binance 1h candle opportunity inside V7 USDT windows",
    "- note: opportunity scan only. Final candidates still require engine-direct backtest.",
    "",
    "| symbol | 24h vol | q300 loss % | avg max high % | hit >=20% | hit >=10% | close compounded % | positive close % | best max high % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.symbol} | ${round(row.quoteVolume24h, 0)} | ${row.q300LossPct} | ${row.avgMaxHighPct} | ${row.hit20Windows} | ${row.hit10Windows} | ${row.closeCompoundedPct} | ${row.positiveClosePct}% | ${row.bestMaxHighPct} |`),
    "",
    "## Top Windows",
    "",
    ...rows.slice(0, 10).flatMap((row) => [
      `### ${row.symbol}`,
      ...row.topWindows.map((window: any) => `- ${window.start} -> ${window.end}: max ${window.maxHighPct}%, close ${window.closePct}%, worst ${window.worstLowPct}%`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "opportunity.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "opportunity.md"), md, "utf8");
  console.log(JSON.stringify({ rows: rows.slice(0, 12), report: path.join(REPORT_DIR, "opportunity.md") }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
