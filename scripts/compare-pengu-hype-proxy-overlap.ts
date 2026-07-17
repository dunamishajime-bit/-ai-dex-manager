import fs from "fs/promises";
import path from "path";

type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Feature15m = Candle & {
  ema20: number;
  ema48: number;
  moveBps: number;
  accelBps: number;
  high3: number;
  low3: number;
};

type Variant = {
  key: string;
  btcMinMoveBps: number;
  btcMinAccelBps: number;
  btcMaxMoveBps: number;
  symbolMinMoveBps: number;
  symbolMinAccelBps: number;
  symbolMaxDistanceBps: number;
  confirmBreakoutBps: number;
  confirmMinutes: number;
  holdMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-hype-proxy-overlap");
const CACHE_DIR = path.join(process.cwd(), ".cache", "proxy-overlap");
const HYPE_REPORT_JSON = path.join(process.cwd(), "reports", "hype-15m", "result.json");
const ASTER_BASE_URL = "https://fapi.asterdex.com";
const BINANCE_BASE_URL = "https://api.binance.com";
const START_TS = Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 5, 5, 23, 59, 59, 999);
const RETRY_DELAYS_MS = [1000, 2500, 5000];

const VARIANTS: Record<string, Variant> = {
  pengu_style_strict: {
    key: "pengu_style_strict",
    btcMinMoveBps: 5,
    btcMinAccelBps: 0,
    btcMaxMoveBps: 35,
    symbolMinMoveBps: 12,
    symbolMinAccelBps: 1,
    symbolMaxDistanceBps: 45,
    confirmBreakoutBps: 10,
    confirmMinutes: 4,
    holdMinutes: 25,
    stopLossPct: 0.0035,
    takeProfitPct: 0.02,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
  },
  pengu_style_balanced: {
    key: "pengu_style_balanced",
    btcMinMoveBps: 4,
    btcMinAccelBps: 0,
    btcMaxMoveBps: 40,
    symbolMinMoveBps: 10,
    symbolMinAccelBps: 0,
    symbolMaxDistanceBps: 55,
    confirmBreakoutBps: 8,
    confirmMinutes: 4,
    holdMinutes: 25,
    stopLossPct: 0.0038,
    takeProfitPct: 0.02,
    trailActivationPct: 0.009,
    trailRetracePct: 0.0045,
  },
  pengu_style_freq: {
    key: "pengu_style_freq",
    btcMinMoveBps: 3,
    btcMinAccelBps: -1,
    btcMaxMoveBps: 45,
    symbolMinMoveBps: 8,
    symbolMinAccelBps: -1,
    symbolMaxDistanceBps: 65,
    confirmBreakoutBps: 8,
    confirmMinutes: 5,
    holdMinutes: 25,
    stopLossPct: 0.004,
    takeProfitPct: 0.018,
    trailActivationPct: 0.008,
    trailRetracePct: 0.004,
  },
};

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ema(prev: number | null, value: number, period: number) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : (value * alpha) + (prev * (1 - alpha));
}

function intervalMs(interval: "1m" | "15m") {
  return interval === "1m" ? 60_000 : 15 * 60_000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchKlines(params: {
  baseUrl: string;
  klinesPath: string;
  venueKey: string;
  symbol: string;
  interval: "1m" | "15m";
}) {
  const { baseUrl, klinesPath, venueKey, symbol, interval } = params;
  const cachePath = path.join(CACHE_DIR, `${venueKey}-${symbol}-${interval}-${START_TS}-${END_TS}.json`);
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const out: Candle[] = [];
    let cursor = START_TS;
    while (cursor < END_TS) {
      const url = `${baseUrl}${klinesPath}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${END_TS}&limit=1000`;
      let response: Response | null = null;
      let lastStatus = 0;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        response = await fetch(url, { cache: "no-store" });
        lastStatus = response.status;
        if (response.ok) break;
        if (attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
      if (!response?.ok) throw new Error(`${venueKey} klines request failed for ${symbol} ${interval}: ${lastStatus}`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) continue;
        out.push({
          ts: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        });
      }
      const last = rows.at(-1);
      const nextTs = Number(Array.isArray(last) ? last[6] : 0);
      if (!Number.isFinite(nextTs) || nextTs <= cursor) cursor += intervalMs(interval);
      else cursor = nextTs;
    }
    const dedup = new Map<number, Candle>();
    for (const candle of out) dedup.set(candle.ts, candle);
    const normalized = [...dedup.values()].sort((a, b) => a.ts - b.ts);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(normalized), "utf8");
    return normalized;
  }
}

function build15mFeatures(candles: Candle[]) {
  const out: Feature15m[] = [];
  let ema20: number | null = null;
  let ema48: number | null = null;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    ema20 = ema(ema20, candle.close, 20);
    ema48 = ema(ema48, candle.close, 48);
    const prev = candles[i - 1];
    const moveBps = prev ? ((candle.close / prev.close) - 1) * 10_000 : 0;
    const prevMove = i >= 2 ? ((candles[i - 1].close / candles[i - 2].close) - 1) * 10_000 : 0;
    const accelBps = moveBps - prevMove;
    const lookback = candles.slice(Math.max(0, i - 3), i);
    out.push({
      ...candle,
      ema20: ema20 ?? candle.close,
      ema48: ema48 ?? candle.close,
      moveBps,
      accelBps,
      high3: lookback.length ? Math.max(...lookback.map((row) => row.high)) : candle.high,
      low3: lookback.length ? Math.min(...lookback.map((row) => row.low)) : candle.low,
    });
  }
  return out;
}

function latestAtOrBefore<T extends { ts: number }>(rows: T[], ts: number) {
  let found: T | null = null;
  for (const row of rows) {
    if (row.ts > ts) break;
    found = row;
  }
  return found;
}

function executionPrice(candles: Candle[], targetTs: number) {
  const execTs = Math.ceil(targetTs / 60_000) * 60_000;
  const candle = candles.find((row) => row.ts >= execTs);
  return candle ? { ts: candle.ts, price: candle.open } : null;
}

function findBreakoutConfirmation(candles1m: Candle[], signalTs: number, signalPrice: number, variant: Variant) {
  const confirmUntil = signalTs + (variant.confirmMinutes * 60_000);
  const breakoutPct = variant.confirmBreakoutBps / 10_000;
  for (const candle of candles1m) {
    if (candle.ts < signalTs) continue;
    if (candle.ts > confirmUntil) break;
    if (candle.high >= signalPrice * (1 + breakoutPct)) return candle.ts;
  }
  return null;
}

function runTrade(candles1m: Candle[], signalTs: number, variant: Variant) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const stop = entry.price * (1 - variant.stopLossPct);
  const take = entry.price * (1 + variant.takeProfitPct);
  let peak = entry.price;
  let exitTs = entry.ts;
  const holdUntil = entry.ts + (variant.holdMinutes * 60_000);
  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    const trail = peak >= entry.price * (1 + variant.trailActivationPct) ? peak * (1 - variant.trailRetracePct) : null;
    if (candle.low <= stop) { exitTs = candle.ts; break; }
    if (candle.high >= take) { exitTs = candle.ts; break; }
    if (trail != null && candle.low <= trail) { exitTs = candle.ts; break; }
    exitTs = candle.ts;
  }
  return { entryTs: entry.ts, exitTs };
}

function qualifiesBtc(row: Feature15m | null, variant: Variant) {
  if (!row) return false;
  return row.close > row.ema20
    && row.ema20 > row.ema48
    && row.close >= row.high3
    && row.moveBps >= variant.btcMinMoveBps
    && row.moveBps <= variant.btcMaxMoveBps
    && row.accelBps >= variant.btcMinAccelBps;
}

function qualifiesSymbol(row: Feature15m, variant: Variant) {
  const distanceFromEma20Bps = ((row.close / Math.max(row.ema20, 0.0000001)) - 1) * 10_000;
  return row.close > row.ema20
    && row.ema20 > row.ema48
    && row.close >= row.high3
    && row.moveBps >= variant.symbolMinMoveBps
    && row.accelBps >= variant.symbolMinAccelBps
    && distanceFromEma20Bps <= variant.symbolMaxDistanceBps;
}

function collectEntries(symbol1m: Candle[], symbol15m: Feature15m[], btc15m: Feature15m[], variant: Variant) {
  const entries: number[] = [];
  let lastExitTs = -Infinity;
  for (let i = 50; i < symbol15m.length; i += 1) {
    const symbol = symbol15m[i];
    if (symbol.ts < lastExitTs) continue;
    const btc = latestAtOrBefore(btc15m, symbol.ts);
    if (!qualifiesBtc(btc, variant)) continue;
    if (!qualifiesSymbol(symbol, variant)) continue;
    const signalPrice = executionPrice(symbol1m, symbol.ts)?.price;
    if (!signalPrice) continue;
    const confirmedTs = findBreakoutConfirmation(symbol1m, symbol.ts, signalPrice, variant);
    if (!confirmedTs) continue;
    const trade = runTrade(symbol1m, confirmedTs, variant);
    if (!trade) continue;
    entries.push(trade.entryTs);
    lastExitTs = trade.exitTs;
  }
  return entries;
}

function nearestGapMinutes(ts: number, candidates: number[]) {
  let best: number | null = null;
  let nearestTs: number | null = null;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - ts);
    if (best == null || gap < best) {
      best = gap;
      nearestTs = candidate;
    }
  }
  return { nearestTs, gapMinutes: best == null ? null : best / 60_000 };
}

function countWithinWindow(source: number[], target: number[], windowMinutes: number) {
  return source.filter((ts) => {
    const { gapMinutes } = nearestGapMinutes(ts, target);
    return gapMinutes != null && gapMinutes <= windowMinutes;
  }).length;
}

async function main() {
  const variantKey = process.env.HYPE_VARIANT?.trim() || "pengu_style_freq";
  const variant = VARIANTS[variantKey];
  if (!variant) throw new Error(`Unknown variant: ${variantKey}`);

  const [pengu1m, pengu15mRaw, btc15mRaw, rawHypeReport] = await Promise.all([
    fetchKlines({ baseUrl: BINANCE_BASE_URL, klinesPath: "/api/v3/klines", venueKey: "binance", symbol: "PENGUUSDT", interval: "1m" }),
    fetchKlines({ baseUrl: BINANCE_BASE_URL, klinesPath: "/api/v3/klines", venueKey: "binance", symbol: "PENGUUSDT", interval: "15m" }),
    fetchKlines({ baseUrl: BINANCE_BASE_URL, klinesPath: "/api/v3/klines", venueKey: "binance", symbol: "BTCUSDT", interval: "15m" }),
    fs.readFile(HYPE_REPORT_JSON, "utf8"),
  ]);

  const penguEntries = collectEntries(pengu1m, build15mFeatures(pengu15mRaw), build15mFeatures(btc15mRaw), variant).sort((a, b) => a - b);
  const parsedHypeReport = JSON.parse(rawHypeReport) as {
    results: Array<{ key: string; tradesDetail: Array<{ entryIso: string }> }>;
  };
  const hypeVariant = parsedHypeReport.results.find((row) => row.key === variantKey);
  if (!hypeVariant) {
    throw new Error(`HYPE report does not contain variant: ${variantKey}`);
  }
  const hypeEntries = hypeVariant.tradesDetail
    .map((trade) => Date.parse(trade.entryIso))
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b);

  const overlapRows = hypeEntries.map((ts) => {
    const nearest = nearestGapMinutes(ts, penguEntries);
    return {
      hypeEntryIso: new Date(ts).toISOString(),
      nearestPenguEntryIso: nearest.nearestTs == null ? null : new Date(nearest.nearestTs).toISOString(),
      gapMinutes: nearest.gapMinutes == null ? null : round(nearest.gapMinutes, 2),
    };
  });

  const overlap15 = countWithinWindow(hypeEntries, penguEntries, 15);
  const overlap30 = countWithinWindow(hypeEntries, penguEntries, 30);
  const overlap60 = countWithinWindow(hypeEntries, penguEntries, 60);
  const separate = overlapRows.filter((row) => row.gapMinutes == null || row.gapMinutes > 60);
  const medianGap = (() => {
    const gaps = overlapRows.map((row) => row.gapMinutes).filter((v): v is number => v != null).sort((a, b) => a - b);
    if (!gaps.length) return null;
    const mid = Math.floor(gaps.length / 2);
    return gaps.length % 2 === 0 ? round((gaps[mid - 1] + gaps[mid]) / 2, 2) : round(gaps[mid], 2);
  })();

  const markdown = [
    "# PENGU vs HYPE Proxy Overlap",
    "",
    "## Setup",
    "",
    `- variant: ${variantKey}`,
    `- comparison method: same BTC-gated breakout engine applied to PENGU and HYPE`,
    `- period: ${new Date(START_TS).toISOString()} -> ${new Date(END_TS).toISOString()}`,
    `- proxy PENGU entries: ${penguEntries.length}`,
    `- proxy HYPE entries: ${hypeEntries.length}`,
    "",
    "## Overlap Summary",
    "",
    `- HYPE entries within 15 minutes of proxy PENGU: ${overlap15}/${hypeEntries.length} (${round((overlap15 / Math.max(hypeEntries.length, 1)) * 100, 2)}%)`,
    `- HYPE entries within 30 minutes of proxy PENGU: ${overlap30}/${hypeEntries.length} (${round((overlap30 / Math.max(hypeEntries.length, 1)) * 100, 2)}%)`,
    `- HYPE entries within 60 minutes of proxy PENGU: ${overlap60}/${hypeEntries.length} (${round((overlap60 / Math.max(hypeEntries.length, 1)) * 100, 2)}%)`,
    `- median nearest-entry gap: ${medianGap == null ? "n/a" : `${medianGap} minutes`}`,
    `- HYPE entries clearly separate (>60m): ${separate.length}/${hypeEntries.length}`,
    "",
    "## Sample Rows",
    "",
    "| HYPE entry | nearest proxy PENGU entry | gap min |",
    "| --- | --- | ---: |",
    ...overlapRows.slice(0, 25).map((row) => `| ${row.hypeEntryIso} | ${row.nearestPenguEntryIso ?? "-"} | ${row.gapMinutes ?? "-"} |`),
    "",
    "## Separate HYPE Examples",
    "",
    "| HYPE entry | nearest proxy PENGU entry | gap min |",
    "| --- | --- | ---: |",
    ...separate.slice(0, 20).map((row) => `| ${row.hypeEntryIso} | ${row.nearestPenguEntryIso ?? "-"} | ${row.gapMinutes ?? "-"} |`),
    "",
  ].join("\n");

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ variantKey, penguEntries, hypeEntries, overlapRows }, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
