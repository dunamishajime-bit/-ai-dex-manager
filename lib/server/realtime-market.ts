export const REALTIME_TRADE_SYMBOLS = ["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT"] as const;

export type RealtimeTradeSymbol = (typeof REALTIME_TRADE_SYMBOLS)[number];

export type RealtimeKlineAnalysis = {
  lastClose: number;
  closeTime: number;
  sma7: number;
  sma25: number;
  sma99: number;
  mom20: number;
  previousHigh: number;
  highDistance: number;
  volumeRatio: number;
  hhhl: boolean;
  maStackUp: boolean;
  candleChange: number;
};

export type RealtimeMarketSnapshot = {
  symbol: RealtimeTradeSymbol;
  pair: string;
  lastPrice: number;
  priceChange24h: number;
  quoteVolume24h: number;
  fifteenMinutes: RealtimeKlineAnalysis | null;
  oneHour: RealtimeKlineAnalysis | null;
  fetchedAt: string;
};

const BINANCE_API_BASE = process.env.BINANCE_PUBLIC_API_BASE || "https://api.binance.com";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function analyzeKlines(rawKlines: unknown): RealtimeKlineAnalysis | null {
  const klines = Array.isArray(rawKlines)
    ? rawKlines
      .map((row) => Array.isArray(row)
        ? {
          openTime: toNumber(row[0]),
          high: toNumber(row[2]),
          low: toNumber(row[3]),
          close: toNumber(row[4]),
          volume: toNumber(row[5]),
          closeTime: toNumber(row[6]),
        }
        : null)
      .filter((row): row is NonNullable<typeof row> => Boolean(row && row.close > 0))
    : [];

  if (klines.length < 30) return null;

  const closes = klines.map((row) => row.close);
  const highs = klines.map((row) => row.high);
  const lows = klines.map((row) => row.low);
  const volumes = klines.map((row) => row.volume);
  const last = klines[klines.length - 1];
  const previous = klines[klines.length - 2];
  const sma7 = average(closes.slice(-7));
  const sma25 = average(closes.slice(-25));
  const sma99 = klines.length >= 99 ? average(closes.slice(-99)) : average(closes);
  const mom20 = closes.length > 20 && closes[closes.length - 21] > 0
    ? ((last.close / closes[closes.length - 21]) - 1) * 100
    : 0;
  const previousHigh = Math.max(...highs.slice(-49, -1));
  const highDistance = previousHigh > 0 ? ((last.close / previousHigh) - 1) * 100 : 0;
  const volumeAvg20 = average(volumes.slice(-21, -1));
  const volumeRatio = volumeAvg20 > 0 ? last.volume / volumeAvg20 : 0;
  const lowNow = Math.min(...lows.slice(-6));
  const lowPrev = Math.min(...lows.slice(-12, -6));
  const highNow = Math.max(...highs.slice(-6));
  const highPrev = Math.max(...highs.slice(-12, -6));
  const hhhl = highNow > highPrev && lowNow > lowPrev;
  const maStackUp = last.close > sma25 && sma7 > sma25 && sma25 >= sma99;
  const candleChange = previous?.close > 0 ? ((last.close / previous.close) - 1) * 100 : 0;

  return {
    lastClose: last.close,
    closeTime: last.closeTime,
    sma7,
    sma25,
    sma99,
    mom20,
    previousHigh,
    highDistance,
    volumeRatio,
    hhhl,
    maStackUp,
    candleChange,
  };
}

async function fetchJson(url: string, timeoutMs = 12000) {
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const response = await fetch(url, { cache: "no-store", signal });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof json === "object" && json && "msg" in json
      ? String(json.msg)
      : `http_${response.status}`;
    throw new Error(message);
  }
  return json;
}

export function normalizeRealtimeSymbols(symbols?: string[] | string | null) {
  const source = Array.isArray(symbols)
    ? symbols
    : typeof symbols === "string"
      ? symbols.split(",")
      : [];
  const normalized = source
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol): symbol is RealtimeTradeSymbol =>
      REALTIME_TRADE_SYMBOLS.includes(symbol as RealtimeTradeSymbol),
    );
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...REALTIME_TRADE_SYMBOLS];
}

export async function fetchRealtimeMarketSnapshot(symbol: RealtimeTradeSymbol): Promise<RealtimeMarketSnapshot> {
  const pair = `${symbol}USDT`;
  const [ticker, klines15m, klines1h] = await Promise.all([
    fetchJson(`${BINANCE_API_BASE}/api/v3/ticker/24hr?symbol=${pair}`),
    fetchJson(`${BINANCE_API_BASE}/api/v3/klines?symbol=${pair}&interval=15m&limit=120`),
    fetchJson(`${BINANCE_API_BASE}/api/v3/klines?symbol=${pair}&interval=1h&limit=120`),
  ]);

  return {
    symbol,
    pair,
    lastPrice: toNumber(ticker?.lastPrice),
    priceChange24h: toNumber(ticker?.priceChangePercent),
    quoteVolume24h: toNumber(ticker?.quoteVolume),
    fifteenMinutes: analyzeKlines(klines15m),
    oneHour: analyzeKlines(klines1h),
    fetchedAt: new Date().toISOString(),
  };
}

export function scoreRealtimeSnapshot(snapshot: RealtimeMarketSnapshot) {
  const m15 = snapshot.fifteenMinutes;
  const h1 = snapshot.oneHour;
  if (!m15 || !h1) return 0;
  let score = 0;
  if (m15.mom20 > 2) score += 2;
  if (h1.mom20 > 3) score += 2;
  if (m15.volumeRatio >= 1.25) score += 1.5;
  if (h1.volumeRatio >= 1.1) score += 1;
  if (m15.highDistance > -1.5) score += 1;
  if (m15.highDistance > 0) score += 1.5;
  if (m15.maStackUp) score += 1.5;
  if (h1.maStackUp) score += 1.5;
  if (m15.hhhl) score += 1;
  if (h1.hhhl) score += 1;
  if (snapshot.priceChange24h < -8) score -= 2;
  if (m15.mom20 < -2) score -= 1.5;
  if (h1.mom20 < -3) score -= 1.5;
  return Number(score.toFixed(2));
}

export function realtimeSnapshotLabel(snapshot: RealtimeMarketSnapshot) {
  const score = scoreRealtimeSnapshot(snapshot);
  if (score >= 9) return "強い上昇候補";
  if (score >= 6) return "監視候補";
  if (score >= 3) return "中立";
  return "弱い/見送り";
}
