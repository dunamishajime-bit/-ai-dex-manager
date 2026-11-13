type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const ASTER_BASE_URL = "https://fapi.asterdex.com";
const ASTER_RETRY_DELAYS_MS = [500, 1500, 3000];

export type CombinedCandle15m = Candle & {
  ema20: number;
  ema48: number;
  moveBps: number;
  accelBps: number;
  high3: number;
  low3: number;
};

function minuteFloor(ts: number) {
  return Math.floor(ts / 60_000) * 60_000;
}

function intervalFloor(interval: "1m" | "15m" | "1h", ts: number) {
  if (interval === "1h") return Math.floor(ts / (60 * 60_000)) * 60 * 60_000;
  if (interval === "15m") return Math.floor(ts / (15 * 60_000)) * 15 * 60_000;
  return minuteFloor(ts);
}

async function fetchBinance(symbol: string, interval: "1m" | "15m" | "1h", startMs: number, endMs: number) {
  const out: Candle[] = [];
  let cursor = intervalFloor(interval, startMs);
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Binance ${symbol} ${interval} request failed: ${response.status}`);
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
    const next = Number(Array.isArray(last) ? last[6] : 0) + 1;
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
  }
  const dedup = new Map<number, Candle>();
  out.forEach((candle) => dedup.set(candle.ts, candle));
  return [...dedup.values()].sort((a, b) => a.ts - b.ts);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAster(symbol: string, interval: "1m" | "15m", startMs: number, endMs: number) {
  const out: Candle[] = [];
  let cursor = minuteFloor(startMs);
  while (cursor < endMs) {
    const url = `${ASTER_BASE_URL}/fapi/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    let response: Response | null = null;
    let lastStatus = 0;
    for (let attempt = 0; attempt <= ASTER_RETRY_DELAYS_MS.length; attempt += 1) {
      response = await fetch(url, { cache: "no-store" });
      lastStatus = response.status;
      if (response.ok) break;
      if (attempt === ASTER_RETRY_DELAYS_MS.length) break;
      await sleep(ASTER_RETRY_DELAYS_MS[attempt]);
    }
    if (!response?.ok) throw new Error(`Aster ${symbol} ${interval} request failed: ${lastStatus}`);
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
    const next = Number(Array.isArray(last) ? last[6] : 0) + 1;
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
  }
  const dedup = new Map<number, Candle>();
  out.forEach((candle) => dedup.set(candle.ts, candle));
  return [...dedup.values()].sort((a, b) => a.ts - b.ts);
}

function ema(prev: number | null, value: number, period: number) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : (value * alpha) + (prev * (1 - alpha));
}

export function build15mFeatures(candles: Candle[]): CombinedCandle15m[] {
  const out: CombinedCandle15m[] = [];
  let ema20: number | null = null;
  let ema48: number | null = null;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    ema20 = ema(ema20, candle.close, 20);
    ema48 = ema(ema48, candle.close, 48);
    const prev = i >= 1 ? candles[i - 1] : null;
    const moveBps = prev ? ((candle.close / prev.close) - 1) * 10_000 : 0;
    const prevMove = i >= 2 ? ((candles[i - 1].close / candles[i - 2].close) - 1) * 10_000 : 0;
    const accelBps = moveBps - prevMove;
    const high3 = candles.slice(Math.max(0, i - 3), i).reduce((max, row) => Math.max(max, row.high), -Infinity);
    const low3 = candles.slice(Math.max(0, i - 3), i).reduce((min, row) => Math.min(min, row.low), Infinity);
    out.push({
      ...candle,
      ema20: ema20 ?? candle.close,
      ema48: ema48 ?? candle.close,
      moveBps,
      accelBps,
      high3: Number.isFinite(high3) ? high3 : candle.high,
      low3: Number.isFinite(low3) ? low3 : candle.low,
    });
  }
  return out;
}

export function executionPrice(candles: Candle[], targetTs: number) {
  const execTs = Math.ceil(targetTs / 60_000) * 60_000;
  const candle = candles.find((row) => row.ts >= execTs);
  return candle ? { ts: candle.ts, price: candle.open } : null;
}

export function latestCandleBefore<T extends { ts: number }>(candles: T[], targetTs: number) {
  let latest: T | null = null;
  for (const candle of candles) {
    if (candle.ts > targetTs) break;
    latest = candle;
  }
  return latest;
}

export async function loadCombinedMarketWindow(startMs: number, endMs: number) {
  const [pengu1m, pengu15mRaw, btc1m, btc15mRaw, hype1m, hype15mRaw, eth1m, eth15mRaw, eth1hRaw] = await Promise.all([
    fetchBinance("PENGUUSDT", "1m", startMs, endMs),
    fetchBinance("PENGUUSDT", "15m", startMs, endMs),
    fetchBinance("BTCUSDT", "1m", startMs, endMs),
    fetchBinance("BTCUSDT", "15m", startMs, endMs),
    fetchAster("HYPEUSDT", "1m", startMs, endMs),
    fetchAster("HYPEUSDT", "15m", startMs, endMs),
    fetchBinance("ETHUSDT", "1m", startMs, endMs),
    fetchBinance("ETHUSDT", "15m", startMs, endMs),
    fetchBinance("ETHUSDT", "1h", startMs - (45 * 24 * 60 * 60 * 1000), endMs),
  ]);

  return {
    pengu1m,
    pengu15m: build15mFeatures(pengu15mRaw),
    hype1m,
    hype15m: build15mFeatures(hype15mRaw),
    eth1m,
    eth15m: build15mFeatures(eth15mRaw),
    eth1h: build15mFeatures(eth1hRaw),
    btc1m,
    btc15m: build15mFeatures(btc15mRaw),
  };
}
