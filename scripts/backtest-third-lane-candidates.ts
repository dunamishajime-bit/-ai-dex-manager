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

type Feature = Candle & {
  ema20: number;
  ema48: number;
  moveBps: number;
  accelBps: number;
  high2: number;
  high3: number;
  low2: number;
  low3: number;
};

type Variant = {
  key: string;
  title: string;
  regimeMaxDistanceBps: number;
  regimeMinMoveBps: number;
  regimeMinAccelBps: number;
  recentTouchBars: number;
  touchToleranceBps: number;
  reclaimMinMoveBps: number;
  reclaimMinBodyBps: number;
  confirmBreakoutBps: number;
  confirmMinutes: number;
  requireHigh2Recover: boolean;
  requirePrevRed: boolean;
  requireCloseAbovePrevHigh: boolean;
  minLowerWickBps: number;
  sessionStartHourUtc: number;
  sessionEndHourUtc: number;
  holdMinutes: number;
  stopGraceMinutes?: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  btcCrashFilterBps: number;
  btcTrendMinBps: number;
};

type Trade = {
  entryIso: string;
  exitIso: string;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  holdMinutes: number;
  entryReason: string;
  exitReason: string;
};

type VariantResult = {
  symbol: string;
  key: string;
  title: string;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  endEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgPnlPct: number;
  avgHoldMinutes: number;
  tradesDetail: Trade[];
};

const REPORT_DIR = path.join(process.cwd(), "reports", "third-lane-candidates");
const CACHE_DIR = path.join(process.cwd(), ".cache", "third-lane-candidates");
const BINANCE_BASE_URL = "https://api.binance.com";
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 5, 5, 23, 59, 59, 999);
const STARTING_EQUITY = 10_000;
const RETRY_DELAYS_MS = [1000, 2500, 5000];
const TAKER_FEE_PER_SIDE = 0.0004;
const BTC_SYMBOL = "BTCUSDT";
const CANDIDATES = ["BNBUSDT", "ETHUSDT", "ASTERUSDT"] as const;
const CANDIDATE_FILTER = new Set(
  (process.env.BT_CANDIDATES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const VARIANT_FILTER = new Set(
  (process.env.BT_VARIANT_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const VARIANTS: Variant[] = [
  {
    key: "reclaim_strict",
    title: "Strict reclaim",
    regimeMaxDistanceBps: 45,
    regimeMinMoveBps: 4,
    regimeMinAccelBps: -2,
    recentTouchBars: 2,
    touchToleranceBps: 10,
    reclaimMinMoveBps: 7,
    reclaimMinBodyBps: 5,
    confirmBreakoutBps: 5,
    confirmMinutes: 4,
    requireHigh2Recover: true,
    requirePrevRed: false,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 0,
    sessionStartHourUtc: 0,
    sessionEndHourUtc: 24,
    holdMinutes: 30,
    stopLossPct: 0.003,
    takeProfitPct: 0.011,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
    btcCrashFilterBps: -20,
    btcTrendMinBps: -10,
  },
  {
    key: "reclaim_balanced",
    title: "Balanced reclaim",
    regimeMaxDistanceBps: 60,
    regimeMinMoveBps: 3,
    regimeMinAccelBps: -4,
    recentTouchBars: 3,
    touchToleranceBps: 18,
    reclaimMinMoveBps: 5,
    reclaimMinBodyBps: 3,
    confirmBreakoutBps: 4,
    confirmMinutes: 5,
    requireHigh2Recover: true,
    requirePrevRed: false,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 0,
    sessionStartHourUtc: 0,
    sessionEndHourUtc: 24,
    holdMinutes: 30,
    stopLossPct: 0.0035,
    takeProfitPct: 0.012,
    trailActivationPct: 0.0055,
    trailRetracePct: 0.0028,
    btcCrashFilterBps: -25,
    btcTrendMinBps: -12,
  },
  {
    key: "reclaim_recovery",
    title: "Recovery reclaim",
    regimeMaxDistanceBps: 75,
    regimeMinMoveBps: 2,
    regimeMinAccelBps: -5,
    recentTouchBars: 4,
    touchToleranceBps: 25,
    reclaimMinMoveBps: 4,
    reclaimMinBodyBps: 2,
    confirmBreakoutBps: 3,
    confirmMinutes: 5,
    requireHigh2Recover: false,
    requirePrevRed: false,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 0,
    sessionStartHourUtc: 0,
    sessionEndHourUtc: 24,
    holdMinutes: 35,
    stopLossPct: 0.0038,
    takeProfitPct: 0.013,
    trailActivationPct: 0.006,
    trailRetracePct: 0.003,
    btcCrashFilterBps: -28,
    btcTrendMinBps: -15,
  },
  {
    key: "reclaim_quality_bnb",
    title: "Quality reclaim with stronger trend",
    regimeMaxDistanceBps: 38,
    regimeMinMoveBps: 6,
    regimeMinAccelBps: 0,
    recentTouchBars: 2,
    touchToleranceBps: 8,
    reclaimMinMoveBps: 8,
    reclaimMinBodyBps: 6,
    confirmBreakoutBps: 6,
    confirmMinutes: 4,
    requireHigh2Recover: true,
    requirePrevRed: true,
    requireCloseAbovePrevHigh: true,
    minLowerWickBps: 3,
    sessionStartHourUtc: 6,
    sessionEndHourUtc: 18,
    holdMinutes: 24,
    stopLossPct: 0.0028,
    takeProfitPct: 0.012,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0022,
    btcCrashFilterBps: -12,
    btcTrendMinBps: 0,
  },
  {
    key: "reclaim_ultra_strict",
    title: "Ultra strict reclaim",
    regimeMaxDistanceBps: 32,
    regimeMinMoveBps: 8,
    regimeMinAccelBps: 1,
    recentTouchBars: 2,
    touchToleranceBps: 6,
    reclaimMinMoveBps: 9,
    reclaimMinBodyBps: 7,
    confirmBreakoutBps: 6,
    confirmMinutes: 3,
    requireHigh2Recover: true,
    requirePrevRed: true,
    requireCloseAbovePrevHigh: true,
    minLowerWickBps: 5,
    sessionStartHourUtc: 8,
    sessionEndHourUtc: 17,
    holdMinutes: 20,
    stopLossPct: 0.0025,
    takeProfitPct: 0.01,
    trailActivationPct: 0.0045,
    trailRetracePct: 0.002,
    btcCrashFilterBps: -10,
    btcTrendMinBps: 2,
  },
  {
    key: "reclaim_us_session",
    title: "US session reclaim",
    regimeMaxDistanceBps: 42,
    regimeMinMoveBps: 5,
    regimeMinAccelBps: 0,
    recentTouchBars: 3,
    touchToleranceBps: 12,
    reclaimMinMoveBps: 7,
    reclaimMinBodyBps: 4,
    confirmBreakoutBps: 5,
    confirmMinutes: 4,
    requireHigh2Recover: true,
    requirePrevRed: true,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 2,
    sessionStartHourUtc: 12,
    sessionEndHourUtc: 21,
    holdMinutes: 24,
    stopLossPct: 0.003,
    takeProfitPct: 0.011,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
    btcCrashFilterBps: -15,
    btcTrendMinBps: -2,
  },
  {
    key: "eth_balanced_loose_a",
    title: "ETH balanced loose A",
    regimeMaxDistanceBps: 72,
    regimeMinMoveBps: 2,
    regimeMinAccelBps: -6,
    recentTouchBars: 4,
    touchToleranceBps: 24,
    reclaimMinMoveBps: 4,
    reclaimMinBodyBps: 2,
    confirmBreakoutBps: 3,
    confirmMinutes: 6,
    requireHigh2Recover: false,
    requirePrevRed: false,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 0,
    sessionStartHourUtc: 0,
    sessionEndHourUtc: 24,
    holdMinutes: 32,
    stopLossPct: 0.0038,
    takeProfitPct: 0.0115,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0027,
    btcCrashFilterBps: -28,
    btcTrendMinBps: -15,
  },
  {
    key: "eth_balanced_loose_b",
    title: "ETH balanced loose B",
    regimeMaxDistanceBps: 85,
    regimeMinMoveBps: 1,
    regimeMinAccelBps: -8,
    recentTouchBars: 5,
    touchToleranceBps: 30,
    reclaimMinMoveBps: 3,
    reclaimMinBodyBps: 1.5,
    confirmBreakoutBps: 2,
    confirmMinutes: 6,
    requireHigh2Recover: false,
    requirePrevRed: false,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 0,
    sessionStartHourUtc: 0,
    sessionEndHourUtc: 24,
    holdMinutes: 35,
    stopLossPct: 0.004,
    takeProfitPct: 0.011,
    trailActivationPct: 0.0048,
    trailRetracePct: 0.0026,
    btcCrashFilterBps: -32,
    btcTrendMinBps: -18,
  },
  {
    key: "eth_balanced_loose_c",
    title: "ETH balanced loose C",
    regimeMaxDistanceBps: 95,
    regimeMinMoveBps: 0,
    regimeMinAccelBps: -10,
    recentTouchBars: 5,
    touchToleranceBps: 36,
    reclaimMinMoveBps: 2,
    reclaimMinBodyBps: 1,
    confirmBreakoutBps: 2,
    confirmMinutes: 7,
    requireHigh2Recover: false,
    requirePrevRed: false,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 0,
    sessionStartHourUtc: 0,
    sessionEndHourUtc: 24,
    holdMinutes: 38,
    stopLossPct: 0.0042,
    takeProfitPct: 0.0105,
    trailActivationPct: 0.0045,
    trailRetracePct: 0.0025,
    btcCrashFilterBps: -35,
    btcTrendMinBps: -20,
  },
  {
    key: "eth_balanced_loose_c_stop_045_grace_10",
    title: "ETH balanced loose C stop -0.45% grace 10m",
    regimeMaxDistanceBps: 95,
    regimeMinMoveBps: 0,
    regimeMinAccelBps: -10,
    recentTouchBars: 5,
    touchToleranceBps: 36,
    reclaimMinMoveBps: 2,
    reclaimMinBodyBps: 1,
    confirmBreakoutBps: 2,
    confirmMinutes: 7,
    requireHigh2Recover: false,
    requirePrevRed: false,
    requireCloseAbovePrevHigh: false,
    minLowerWickBps: 0,
    sessionStartHourUtc: 0,
    sessionEndHourUtc: 24,
    holdMinutes: 38,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0105,
    trailActivationPct: 0.0045,
    trailRetracePct: 0.0025,
    btcCrashFilterBps: -35,
    btcTrendMinBps: -20,
  },
];

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ema(prev: number | null, value: number, period: number) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : (value * alpha) + (prev * (1 - alpha));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intervalMs(interval: "1m" | "15m" | "1h") {
  if (interval === "1m") return 60_000;
  if (interval === "15m") return 15 * 60_000;
  return 60 * 60_000;
}

async function fetchKlines(params: {
  symbol: string;
  interval: "1m" | "15m" | "1h";
  startMs: number;
  endMs: number;
}) {
  const { symbol, interval, startMs, endMs } = params;
  const cachePath = path.join(CACHE_DIR, `binance-${symbol}-${interval}-${startMs}-${endMs}.json`);
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const out: Candle[] = [];
    let cursor = startMs;

    while (cursor < endMs) {
      const url = `${BINANCE_BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
      let response: Response | null = null;
      let lastStatus = 0;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        response = await fetch(url, { cache: "no-store" });
        lastStatus = response.status;
        if (response.ok) break;
        if (attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
      if (!response?.ok) {
        throw new Error(`Binance klines request failed for ${symbol} ${interval}: ${lastStatus}`);
      }

      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const candle = {
          ts: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        } satisfies Candle;
        if (Number.isFinite(candle.ts) && candle.close > 0) out.push(candle);
      }

      const last = rows.at(-1);
      const nextTs = Number(Array.isArray(last) ? last[6] : 0);
      if (!Number.isFinite(nextTs) || nextTs <= cursor) cursor += intervalMs(interval);
      else cursor = nextTs;
    }

    const dedup = new Map<number, Candle>();
    for (const candle of out) dedup.set(candle.ts, candle);
    const normalized = [...dedup.values()].sort((left, right) => left.ts - right.ts);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(normalized), "utf8");
    return normalized;
  }
}

function buildFeatures(candles: Candle[]): Feature[] {
  const out: Feature[] = [];
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
    const highLookback = candles.slice(Math.max(0, i - 3), i);
    const lowLookback = candles.slice(Math.max(0, i - 3), i);

    out.push({
      ...candle,
      ema20: ema20 ?? candle.close,
      ema48: ema48 ?? candle.close,
      moveBps,
      accelBps,
      high2: highLookback.slice(-2).length ? Math.max(...highLookback.slice(-2).map((row) => row.high)) : candle.high,
      high3: highLookback.length ? Math.max(...highLookback.map((row) => row.high)) : candle.high,
      low2: lowLookback.slice(-2).length ? Math.min(...lowLookback.slice(-2).map((row) => row.low)) : candle.low,
      low3: lowLookback.length ? Math.min(...lowLookback.map((row) => row.low)) : candle.low,
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

function touchedEmaRecently(rows: Feature[], index: number, variant: Variant) {
  const start = Math.max(0, index - variant.recentTouchBars);
  for (let i = start; i < index; i += 1) {
    const row = rows[i];
    const touchLimit = row.ema20 * (1 + variant.touchToleranceBps / 10_000);
    if (row.low <= touchLimit) return true;
  }
  return false;
}

function qualifiesRegime(row1h: Feature | null, row15m: Feature, variant: Variant) {
  if (!row1h) return false;
  const distanceFrom1hEma20 = ((row15m.close / Math.max(row1h.ema20, 0.0000001)) - 1) * 10_000;
  return row1h.close > row1h.ema20
    && row1h.ema20 > row1h.ema48
    && row1h.moveBps >= variant.regimeMinMoveBps
    && row1h.accelBps >= variant.regimeMinAccelBps
    && distanceFrom1hEma20 >= -variant.regimeMaxDistanceBps;
}

function qualifiesBtcFilter(row: Feature | null, variant: Variant) {
  if (!row) return false;
  return row.moveBps > variant.btcCrashFilterBps && row.moveBps >= variant.btcTrendMinBps;
}

function inSession(ts: number, variant: Variant) {
  const hour = new Date(ts).getUTCHours();
  if (variant.sessionStartHourUtc === 0 && variant.sessionEndHourUtc === 24) return true;
  return hour >= variant.sessionStartHourUtc && hour < variant.sessionEndHourUtc;
}

function qualifiesReclaim(rows15m: Feature[], index: number, rows1h: Feature[], btc15m: Feature[], variant: Variant) {
  const row = rows15m[index];
  if (!row) return false;
  if (index < 5) return false;
  if (!inSession(row.ts + intervalMs("15m"), variant)) return false;

  const signalCloseTs = row.ts + intervalMs("15m");
  const regime = latestAtOrBefore(rows1h, signalCloseTs);
  const btc = latestAtOrBefore(btc15m, signalCloseTs);
  if (!qualifiesRegime(regime, row, variant)) return false;
  if (!qualifiesBtcFilter(btc, variant)) return false;
  if (!touchedEmaRecently(rows15m, index, variant)) return false;

  const bodyBps = ((row.close / Math.max(row.open, 0.0000001)) - 1) * 10_000;
  const distanceFromEma20 = ((row.close / Math.max(row.ema20, 0.0000001)) - 1) * 10_000;
  const lowerWickBps = ((Math.min(row.open, row.close) / Math.max(row.low, 0.0000001)) - 1) * 10_000;
  const prev = rows15m[index - 1];
  if (row.close <= row.ema20) return false;
  if (row.ema20 <= row.ema48) return false;
  if (row.moveBps < variant.reclaimMinMoveBps) return false;
  if (bodyBps < variant.reclaimMinBodyBps) return false;
  if (lowerWickBps < variant.minLowerWickBps) return false;
  if (distanceFromEma20 < 0 || distanceFromEma20 > variant.regimeMaxDistanceBps) return false;
  if (variant.requirePrevRed && prev.close >= prev.open) return false;
  if (variant.requireCloseAbovePrevHigh && row.close < prev.high) return false;
  if (variant.requireHigh2Recover && row.close < row.high2) return false;
  if (!variant.requireHigh2Recover && row.close < row.high3 && row.close < rows15m[index - 1].high) return false;

  return true;
}

function findConfirmation(candles1m: Candle[], signalCloseTs: number, triggerPrice: number, variant: Variant) {
  const breakoutPct = variant.confirmBreakoutBps / 10_000;
  const confirmUntil = signalCloseTs + (variant.confirmMinutes * 60_000);
  for (const candle of candles1m) {
    if (candle.ts < signalCloseTs) continue;
    if (candle.ts > confirmUntil) break;
    if (candle.high >= triggerPrice * (1 + breakoutPct)) return candle.ts;
  }
  return null;
}

function runTrade(candles1m: Candle[], signalTs: number, variant: Variant) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;

  const stop = entry.price * (1 - variant.stopLossPct);
  const take = entry.price * (1 + variant.takeProfitPct);
  let peak = entry.price;
  let exitPrice = entry.price;
  let exitTs = entry.ts;
  let exitReason = "max-hold";
  const holdUntil = entry.ts + (variant.holdMinutes * 60_000);
  const stopEnabledTs = entry.ts + ((variant.stopGraceMinutes || 0) * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    const trail = peak >= entry.price * (1 + variant.trailActivationPct)
      ? peak * (1 - variant.trailRetracePct)
      : null;

    if (candle.ts >= stopEnabledTs && candle.low <= stop) {
      exitPrice = stop;
      exitTs = candle.ts;
      exitReason = "stop-loss";
      break;
    }
    if (candle.high >= take) {
      exitPrice = take;
      exitTs = candle.ts;
      exitReason = "take-profit";
      break;
    }
    if (trail != null && candle.low <= trail) {
      exitPrice = trail;
      exitTs = candle.ts;
      exitReason = "trailing-exit";
      break;
    }
    exitPrice = candle.close;
    exitTs = candle.ts;
  }

  const net = ((exitPrice / entry.price) - 1) - (TAKER_FEE_PER_SIDE * 2);
  return {
    entryTs: entry.ts,
    entryPrice: entry.price,
    exitTs,
    exitPrice,
    exitReason,
    pnlPct: net * 100,
  };
}

function simulateVariant(
  symbol: string,
  symbol1m: Candle[],
  symbol15m: Feature[],
  symbol1h: Feature[],
  btc15m: Feature[],
  variant: Variant,
): VariantResult {
  let equity = STARTING_EQUITY;
  let peakEquity = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let lastExitTs = -Infinity;
  const trades: Trade[] = [];

  for (let i = 50; i < symbol15m.length; i += 1) {
    const row = symbol15m[i];
    if (row.ts < lastExitTs) continue;
    if (!qualifiesReclaim(symbol15m, i, symbol1h, btc15m, variant)) continue;

    const signalCloseTs = row.ts + intervalMs("15m");
    const confirmedTs = findConfirmation(symbol1m, signalCloseTs, row.high, variant);
    if (!confirmedTs) continue;

    const trade = runTrade(symbol1m, confirmedTs, variant);
    if (!trade) continue;

    equity *= 1 + (trade.pnlPct / 100);
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peakEquity) - 1);
    if (trade.pnlPct >= 0) grossProfit += trade.pnlPct;
    else grossLoss += Math.abs(trade.pnlPct);

    trades.push({
      entryIso: new Date(trade.entryTs).toISOString(),
      exitIso: new Date(trade.exitTs).toISOString(),
      entryPrice: round(trade.entryPrice, 6),
      exitPrice: round(trade.exitPrice, 6),
      pnlPct: round(trade.pnlPct, 4),
      holdMinutes: round((trade.exitTs - trade.entryTs) / 60_000, 2),
      entryReason: `${symbol} 15m reclaim + 1m confirm (${variant.confirmBreakoutBps}bps/${variant.confirmMinutes}m)`,
      exitReason: trade.exitReason,
    });
    lastExitTs = trade.exitTs;
  }

  const wins = trades.filter((trade) => trade.pnlPct > 0).length;
  const losses = trades.length - wins;
  return {
    symbol,
    key: variant.key,
    title: variant.title,
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    endEquity: round(equity, 2),
    returnPct: round(((equity / STARTING_EQUITY) - 1) * 100, 2),
    maxDrawdownPct: round(maxDrawdownPct * 100, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : 0,
    avgPnlPct: round(trades.length ? average(trades.map((trade) => trade.pnlPct)) : 0, 4),
    avgHoldMinutes: round(trades.length ? average(trades.map((trade) => trade.holdMinutes)) : 0, 2),
    tradesDetail: trades,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const selectedCandidates = CANDIDATE_FILTER.size
    ? CANDIDATES.filter((symbol) => CANDIDATE_FILTER.has(symbol))
    : [...CANDIDATES];
  const selectedVariants = VARIANT_FILTER.size
    ? VARIANTS.filter((variant) => VARIANT_FILTER.has(variant.key))
    : VARIANTS;

  const btc15mRaw = await fetchKlines({
    symbol: BTC_SYMBOL,
    interval: "15m",
    startMs: START_TS,
    endMs: END_TS,
  });
  const btc15m = buildFeatures(btc15mRaw);

  const allResults: VariantResult[] = [];

  for (const symbol of selectedCandidates) {
    const [candles1m, candles15mRaw, candles1hRaw] = await Promise.all([
      fetchKlines({ symbol, interval: "1m", startMs: START_TS, endMs: END_TS }),
      fetchKlines({ symbol, interval: "15m", startMs: START_TS, endMs: END_TS }),
      fetchKlines({ symbol, interval: "1h", startMs: START_TS, endMs: END_TS }),
    ]);

    if (candles1m.length < 200 || candles15mRaw.length < 200 || candles1hRaw.length < 100) {
      throw new Error(`Not enough market data for ${symbol}. 1m=${candles1m.length}, 15m=${candles15mRaw.length}, 1h=${candles1hRaw.length}`);
    }

    const candles15m = buildFeatures(candles15mRaw);
    const candles1h = buildFeatures(candles1hRaw);
    const results = selectedVariants.map((variant) => simulateVariant(symbol, candles1m, candles15m, candles1h, btc15m, variant));
    allResults.push(...results);
  }

  const rankedByWinRate = [...allResults].sort((left, right) => {
    if (right.winRatePct !== left.winRatePct) return right.winRatePct - left.winRatePct;
    if (right.returnPct !== left.returnPct) return right.returnPct - left.returnPct;
    return right.trades - left.trades;
  });
  const rankedByReturn = [...allResults].sort((left, right) => right.returnPct - left.returnPct);

  const markdown = [
    "# Third Lane Candidate Backtest",
    "",
    "## Setup",
    "",
    `- candidates: ${CANDIDATES.join(", ")}`,
    `- style: 1h regime + 15m reclaim + 1m confirmation`,
    `- BTC filter: only blocks sharp BTC 15m drawdown, unlike PENGU/HYPE which depend on BTC gate`,
    `- start: ${new Date(START_TS).toISOString()}`,
    `- end: ${new Date(END_TS).toISOString()}`,
    `- fee model: Binance taker proxy ${round(TAKER_FEE_PER_SIDE * 100, 4)}% per side`,
    "",
    "## Summary",
    "",
    "| symbol | variant | return % | end equity | max DD % | trades | win rate % | PF | avg pnl % | avg hold min |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...allResults.map((row) => `| ${row.symbol} | ${row.key} | ${row.returnPct} | ${row.endEquity.toLocaleString()} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.profitFactor} | ${row.avgPnlPct} | ${row.avgHoldMinutes} |`),
    "",
    "## Best By Win Rate",
    "",
    ...rankedByWinRate.slice(0, 6).map((row, index) => `${index + 1}. ${row.symbol} ${row.key}: win rate ${row.winRatePct}%, trades ${row.trades}, return ${row.returnPct}%`),
    "",
    "## Best By Return",
    "",
    ...rankedByReturn.slice(0, 6).map((row, index) => `${index + 1}. ${row.symbol} ${row.key}: return ${row.returnPct}%, win rate ${row.winRatePct}%, trades ${row.trades}`),
    "",
    "## Notes",
    "",
    "- These candidates aim to avoid overlapping too much with PENGU/HYPE by dropping the hard BTC momentum gate and instead using BTC only as a crash filter.",
    "- All variants are long-only and optimized for cleaner reclaim entries rather than breakout chasing.",
    "- If a variant shows high win rate but too few trades, it is better as a supplemental lane than a primary lane.",
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        startTs: START_TS,
        endTs: END_TS,
        candidates: CANDIDATES,
        variants: VARIANTS,
        results: allResults,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
