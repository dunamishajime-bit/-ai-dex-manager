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
  ema9: number;
  ema20: number;
  ema50: number;
  vwapDay: number;
  volAvg20: number;
  volRatio: number;
  rangeBps: number;
  bodyBps: number;
  closeLocation: number;
  trendSlopeBps: number;
};

type Side = "long" | "short";

type Variant = {
  key: string;
  title: string;
  signalMode?: "trend_reclaim" | "mean_reversion";
  allowLong: boolean;
  allowShort: boolean;
  requireStrongRegime: boolean;
  requireVolumeLift: boolean;
  regimeSlopeBps: number;
  trendStackDistanceBps: number;
  pullbackTouchBps: number;
  reclaimCloseLocation: number;
  breakoutBps: number;
  confirmMinutes: number;
  timeStopMinutes: number;
  stopGraceMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  failExitAfterMinutes: number;
  failExitDistanceBps: number;
  extensionBps?: number;
  reboundCloseLocation?: number;
  swingLookbackBars?: number;
  requireEma50Hold?: boolean;
};

type Trade = {
  side: Side;
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
  tradesPerMonth: number;
  tradesDetail: Trade[];
};

type Candidate = {
  side: Side;
  setupTs: number;
  triggerTs: number;
  entryPrice: number;
  reason: string;
};

type Position = {
  side: Side;
  entryTs: number;
  entryPrice: number;
  stopEnabledTs: number;
  forcedExitTs: number;
  failExitTs: number;
  peakPrice: number;
  troughPrice: number;
  reason: string;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "aster-technical-5m");
const CACHE_DIR = path.join(process.cwd(), ".cache", "aster-technical-5m");
const SYMBOL = "ASTERUSDT";
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 5, 5, 23, 59, 59, 999);
const STARTING_EQUITY = 10_000;
const ASTER_BASE_URL = "https://fapi.asterdex.com";
const RETRY_DELAYS_MS = [1000, 2500, 5000];
const TAKER_FEE_PER_SIDE = 0.0004;
const VARIANT_FILTER = new Set(
  (process.env.BT_VARIANT_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const VARIANTS: Variant[] = [
  {
    key: "dow_reclaim_quality",
    title: "15m Dow trend + 5m reclaim quality",
    allowLong: true,
    allowShort: true,
    requireStrongRegime: true,
    requireVolumeLift: true,
    regimeSlopeBps: 7,
    trendStackDistanceBps: 22,
    pullbackTouchBps: 14,
    reclaimCloseLocation: 0.58,
    breakoutBps: 4,
    confirmMinutes: 6,
    timeStopMinutes: 35,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.013,
    trailActivationPct: 0.0075,
    trailRetracePct: 0.0034,
    failExitAfterMinutes: 15,
    failExitDistanceBps: 8,
  },
  {
    key: "dow_reclaim_balanced",
    title: "15m Dow trend + 5m reclaim balanced",
    allowLong: true,
    allowShort: true,
    requireStrongRegime: false,
    requireVolumeLift: true,
    regimeSlopeBps: 4,
    trendStackDistanceBps: 14,
    pullbackTouchBps: 18,
    reclaimCloseLocation: 0.55,
    breakoutBps: 3,
    confirmMinutes: 7,
    timeStopMinutes: 40,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.012,
    trailActivationPct: 0.007,
    trailRetracePct: 0.0033,
    failExitAfterMinutes: 15,
    failExitDistanceBps: 6,
  },
  {
    key: "dow_pullback_active",
    title: "15m Dow trend + 5m active pullback",
    allowLong: true,
    allowShort: true,
    requireStrongRegime: false,
    requireVolumeLift: false,
    regimeSlopeBps: 3,
    trendStackDistanceBps: 10,
    pullbackTouchBps: 24,
    reclaimCloseLocation: 0.52,
    breakoutBps: 2,
    confirmMinutes: 8,
    timeStopMinutes: 30,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0105,
    trailActivationPct: 0.006,
    trailRetracePct: 0.003,
    failExitAfterMinutes: 12,
    failExitDistanceBps: 4,
  },
  {
    key: "dow_long_only_quality",
    title: "15m Dow trend + 5m reclaim long-only quality",
    allowLong: true,
    allowShort: false,
    requireStrongRegime: true,
    requireVolumeLift: true,
    regimeSlopeBps: 8,
    trendStackDistanceBps: 24,
    pullbackTouchBps: 16,
    reclaimCloseLocation: 0.60,
    breakoutBps: 4,
    confirmMinutes: 6,
    timeStopMinutes: 35,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.013,
    trailActivationPct: 0.0078,
    trailRetracePct: 0.0034,
    failExitAfterMinutes: 15,
    failExitDistanceBps: 8,
  },
  {
    key: "dow_scalp_long_only",
    title: "15m Dow trend + 5m long-only scalp",
    allowLong: true,
    allowShort: false,
    requireStrongRegime: true,
    requireVolumeLift: true,
    regimeSlopeBps: 9,
    trendStackDistanceBps: 26,
    pullbackTouchBps: 14,
    reclaimCloseLocation: 0.63,
    breakoutBps: 3,
    confirmMinutes: 5,
    timeStopMinutes: 20,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0075,
    trailActivationPct: 0.0048,
    trailRetracePct: 0.0022,
    failExitAfterMinutes: 10,
    failExitDistanceBps: 10,
  },
  {
    key: "dow_scalp_balanced_long_only",
    title: "15m Dow trend + 5m long-only scalp balanced",
    allowLong: true,
    allowShort: false,
    requireStrongRegime: false,
    requireVolumeLift: true,
    regimeSlopeBps: 6,
    trendStackDistanceBps: 20,
    pullbackTouchBps: 18,
    reclaimCloseLocation: 0.60,
    breakoutBps: 2,
    confirmMinutes: 6,
    timeStopMinutes: 18,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0065,
    trailActivationPct: 0.0042,
    trailRetracePct: 0.002,
    failExitAfterMinutes: 10,
    failExitDistanceBps: 8,
  },
  {
    key: "dow_scalp_dual_strict",
    title: "15m Dow trend + 5m dual-side scalp strict",
    allowLong: true,
    allowShort: true,
    requireStrongRegime: true,
    requireVolumeLift: true,
    regimeSlopeBps: 9,
    trendStackDistanceBps: 24,
    pullbackTouchBps: 14,
    reclaimCloseLocation: 0.62,
    breakoutBps: 3,
    confirmMinutes: 5,
    timeStopMinutes: 18,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.007,
    trailActivationPct: 0.0045,
    trailRetracePct: 0.002,
    failExitAfterMinutes: 10,
    failExitDistanceBps: 10,
  },
  {
    key: "dow_quality_micro_long_only",
    title: "15m Dow trend + 5m micro scalp long-only",
    allowLong: true,
    allowShort: false,
    requireStrongRegime: true,
    requireVolumeLift: true,
    regimeSlopeBps: 10,
    trendStackDistanceBps: 28,
    pullbackTouchBps: 12,
    reclaimCloseLocation: 0.66,
    breakoutBps: 2,
    confirmMinutes: 4,
    timeStopMinutes: 14,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0055,
    trailActivationPct: 0.0038,
    trailRetracePct: 0.0018,
    failExitAfterMinutes: 8,
    failExitDistanceBps: 12,
  },
  {
    key: "dow_quality_micro_dual",
    title: "15m Dow trend + 5m micro scalp dual",
    signalMode: "trend_reclaim",
    allowLong: true,
    allowShort: true,
    requireStrongRegime: true,
    requireVolumeLift: true,
    regimeSlopeBps: 10,
    trendStackDistanceBps: 28,
    pullbackTouchBps: 12,
    reclaimCloseLocation: 0.66,
    breakoutBps: 2,
    confirmMinutes: 4,
    timeStopMinutes: 14,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0055,
    trailActivationPct: 0.0038,
    trailRetracePct: 0.0018,
    failExitAfterMinutes: 8,
    failExitDistanceBps: 12,
  },
  {
    key: "mr_ema_reclaim_quality_dual",
    title: "Mean reversion EMA reclaim quality dual",
    signalMode: "mean_reversion",
    allowLong: true,
    allowShort: true,
    requireStrongRegime: false,
    requireVolumeLift: false,
    regimeSlopeBps: 6,
    trendStackDistanceBps: 12,
    pullbackTouchBps: 14,
    reclaimCloseLocation: 0.62,
    breakoutBps: 2,
    confirmMinutes: 4,
    timeStopMinutes: 14,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0055,
    trailActivationPct: 0.0038,
    trailRetracePct: 0.0018,
    failExitAfterMinutes: 8,
    failExitDistanceBps: 8,
    extensionBps: 16,
    reboundCloseLocation: 0.68,
    swingLookbackBars: 8,
    requireEma50Hold: false,
  },
  {
    key: "mr_ema_reclaim_quality_long_only",
    title: "Mean reversion EMA reclaim quality long-only",
    signalMode: "mean_reversion",
    allowLong: true,
    allowShort: false,
    requireStrongRegime: false,
    requireVolumeLift: false,
    regimeSlopeBps: 6,
    trendStackDistanceBps: 14,
    pullbackTouchBps: 14,
    reclaimCloseLocation: 0.64,
    breakoutBps: 2,
    confirmMinutes: 4,
    timeStopMinutes: 14,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0055,
    trailActivationPct: 0.0038,
    trailRetracePct: 0.0018,
    failExitAfterMinutes: 8,
    failExitDistanceBps: 8,
    extensionBps: 18,
    reboundCloseLocation: 0.70,
    swingLookbackBars: 8,
    requireEma50Hold: false,
  },
  {
    key: "mr_ema50_snapback_dual",
    title: "Mean reversion EMA50 snapback dual",
    signalMode: "mean_reversion",
    allowLong: true,
    allowShort: true,
    requireStrongRegime: false,
    requireVolumeLift: false,
    regimeSlopeBps: 7,
    trendStackDistanceBps: 16,
    pullbackTouchBps: 10,
    reclaimCloseLocation: 0.66,
    breakoutBps: 2,
    confirmMinutes: 4,
    timeStopMinutes: 12,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.005,
    trailActivationPct: 0.0036,
    trailRetracePct: 0.0017,
    failExitAfterMinutes: 7,
    failExitDistanceBps: 8,
    extensionBps: 20,
    reboundCloseLocation: 0.70,
    swingLookbackBars: 10,
    requireEma50Hold: false,
  },
  {
    key: "mr_higher_low_precision_long_only",
    title: "Mean reversion higher-low precision long-only",
    signalMode: "mean_reversion",
    allowLong: true,
    allowShort: false,
    requireStrongRegime: false,
    requireVolumeLift: false,
    regimeSlopeBps: 7,
    trendStackDistanceBps: 16,
    pullbackTouchBps: 12,
    reclaimCloseLocation: 0.68,
    breakoutBps: 2,
    confirmMinutes: 4,
    timeStopMinutes: 12,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0048,
    trailActivationPct: 0.0032,
    trailRetracePct: 0.0016,
    failExitAfterMinutes: 7,
    failExitDistanceBps: 7,
    extensionBps: 18,
    reboundCloseLocation: 0.72,
    swingLookbackBars: 10,
    requireEma50Hold: false,
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

async function fetchAsterKlines(symbol: string, interval: "1m" | "5m", startMs: number, endMs: number) {
  const cachePath = path.join(CACHE_DIR, `${symbol}-${interval}-${startMs}-${endMs}.json`);
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const out: Candle[] = [];
    let cursor = startMs;

    while (cursor < endMs) {
      const url = `${ASTER_BASE_URL}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
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
        throw new Error(`Aster klines request failed for ${symbol} ${interval}: ${lastStatus}`);
      }

      const json = await response.json();
      const rows = Array.isArray(json) ? json : [];
      if (!rows.length) break;

      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const candle: Candle = {
          ts: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        };
        if (Number.isFinite(candle.ts) && candle.close > 0) {
          out.push(candle);
        }
      }

      const last = rows.at(-1);
      const nextTs = Number(Array.isArray(last) ? last[6] : 0) + 1;
      if (!Number.isFinite(nextTs) || nextTs <= cursor) break;
      cursor = nextTs;
    }

    const dedup = new Map<number, Candle>();
    for (const candle of out) dedup.set(candle.ts, candle);
    const candles = [...dedup.values()].sort((left, right) => left.ts - right.ts);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function aggregateCandles(candles: Candle[], barsPerGroup: number) {
  const out: Candle[] = [];
  for (let index = 0; index + barsPerGroup - 1 < candles.length; index += barsPerGroup) {
    const group = candles.slice(index, index + barsPerGroup);
    const open = group[0].open;
    const close = group[group.length - 1].close;
    const high = Math.max(...group.map((bar) => bar.high));
    const low = Math.min(...group.map((bar) => bar.low));
    const volume = group.reduce((sum, bar) => sum + bar.volume, 0);
    out.push({ ts: group[0].ts, open, high, low, close, volume });
  }
  return out;
}

function buildFeatures(candles: Candle[]) {
  const out: Feature[] = [];
  let ema9Prev: number | null = null;
  let ema20Prev: number | null = null;
  let ema50Prev: number | null = null;
  let dayKey = "";
  let dayPv = 0;
  let dayVolume = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    ema9Prev = ema(ema9Prev, candle.close, 9);
    ema20Prev = ema(ema20Prev, candle.close, 20);
    ema50Prev = ema(ema50Prev, candle.close, 50);

    const iso = new Date(candle.ts).toISOString();
    const nextDayKey = iso.slice(0, 10);
    if (nextDayKey !== dayKey) {
      dayKey = nextDayKey;
      dayPv = 0;
      dayVolume = 0;
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    dayPv += typicalPrice * candle.volume;
    dayVolume += candle.volume;

    const recent = candles.slice(Math.max(0, index - 19), index + 1);
    const volAvg20 = average(recent.map((bar) => bar.volume));
    const range = Math.max(candle.high - candle.low, 1e-9);
    const rangeBps = ((candle.high - candle.low) / candle.close) * 10_000;
    const bodyBps = (Math.abs(candle.close - candle.open) / candle.close) * 10_000;
    const closeLocation = (candle.close - candle.low) / range;
    const ema20Past = out[Math.max(0, out.length - 6)]?.ema20 ?? ema20Prev;
    const trendSlopeBps = ((ema20Prev - ema20Past) / Math.max(ema20Past, 1e-9)) * 10_000;

    out.push({
      ...candle,
      ema9: ema9Prev,
      ema20: ema20Prev,
      ema50: ema50Prev,
      vwapDay: dayPv / Math.max(dayVolume, 1e-9),
      volAvg20,
      volRatio: candle.volume / Math.max(volAvg20, 1e-9),
      rangeBps,
      bodyBps,
      closeLocation,
      trendSlopeBps,
    });
  }

  return out;
}

function featureMapByTs(features: Feature[]) {
  return new Map(features.map((feature) => [feature.ts, feature]));
}

function extreme(values: number[], mode: "max" | "min") {
  if (!values.length) return null;
  return mode === "max" ? Math.max(...values) : Math.min(...values);
}

function assessDowRegime(feature15m: Feature, index15m: number, features15m: Feature[]) {
  if (index15m < 14) {
    return {
      bullish: false,
      bearish: false,
      strongBullish: false,
      strongBearish: false,
    };
  }

  const recent = features15m.slice(index15m - 5, index15m + 1);
  const prior = features15m.slice(index15m - 11, index15m - 5);
  const recentHigh = extreme(recent.map((bar) => bar.high), "max") ?? feature15m.high;
  const priorHigh = extreme(prior.map((bar) => bar.high), "max") ?? feature15m.high;
  const recentLow = extreme(recent.map((bar) => bar.low), "min") ?? feature15m.low;
  const priorLow = extreme(prior.map((bar) => bar.low), "min") ?? feature15m.low;
  const stackBull = feature15m.close > feature15m.ema20 && feature15m.ema20 > feature15m.ema50;
  const stackBear = feature15m.close < feature15m.ema20 && feature15m.ema20 < feature15m.ema50;
  const bullish = stackBull && recentHigh > priorHigh && recentLow > priorLow;
  const bearish = stackBear && recentHigh < priorHigh && recentLow < priorLow;
  const strongBullish = bullish && feature15m.trendSlopeBps >= 6;
  const strongBearish = bearish && feature15m.trendSlopeBps <= -6;
  return { bullish, bearish, strongBullish, strongBearish };
}

function findTrigger(
  candles1m: Candle[],
  afterTs: number,
  untilTs: number,
  side: Side,
  triggerLevel: number,
  breakoutBps: number,
) {
  const breakoutFactor = side === "long"
    ? 1 + (breakoutBps / 10_000)
    : 1 - (breakoutBps / 10_000);
  for (const candle of candles1m) {
    if (candle.ts <= afterTs || candle.ts > untilTs) continue;
    if (side === "long" && candle.high >= triggerLevel * breakoutFactor) {
      return {
        ts: candle.ts,
        price: Math.max(candle.open, triggerLevel * breakoutFactor),
      };
    }
    if (side === "short" && candle.low <= triggerLevel * breakoutFactor) {
      return {
        ts: candle.ts,
        price: Math.min(candle.open, triggerLevel * breakoutFactor),
      };
    }
  }
  return null;
}

function buildCandidate(
  feature5m: Feature,
  index5m: number,
  features15m: Feature[],
  feature15mMap: Map<number, Feature>,
  candles1m: Candle[],
  variant: Variant,
): Candidate | null {
  if (index5m < 25) return null;

  const feature15mTs = feature5m.ts - (feature5m.ts % (15 * 60_000));
  const feature15m = feature15mMap.get(feature15mTs);
  if (!feature15m) return null;
  const index15m = features15m.findIndex((bar) => bar.ts === feature15m.ts);
  if (index15m < 0) return null;

  const regime = assessDowRegime(feature15m, index15m, features15m);
  const regimeStackBull = feature15m.close > feature15m.ema20 && feature15m.ema20 > feature15m.ema50;
  const regimeStackBear = feature15m.close < feature15m.ema20 && feature15m.ema20 < feature15m.ema50;
  const recent5m = feature15mMap; // quiet lint substitute not needed but keep structure simple
  void recent5m;

  const prior5mBars = features5mSlice(index5m, 8);
  const recentHigh = extreme(prior5mBars.map((bar) => bar.high), "max") ?? feature5m.high;
  const recentLow = extreme(prior5mBars.map((bar) => bar.low), "min") ?? feature5m.low;
  const touchedEma20Long = prior5mBars.some((bar) => bar.low <= bar.ema20 * (1 + (variant.pullbackTouchBps / 10_000)));
  const touchedEma20Short = prior5mBars.some((bar) => bar.high >= bar.ema20 * (1 - (variant.pullbackTouchBps / 10_000)));
  const stackDistanceBps = ((feature5m.ema20 - feature5m.ema50) / Math.max(feature5m.ema50, 1e-9)) * 10_000;
  const triggerUntilTs = feature5m.ts + (variant.confirmMinutes * 60_000);

  if ((variant.signalMode || "trend_reclaim") === "mean_reversion") {
    const prev1 = features5mInputAt(index5m - 1);
    const prev2 = features5mInputAt(index5m - 2);
    if (!prev1 || !prev2) return null;
    const priorClose = prev1.close;
    const lookbackBars = features5mSlice(index5m, variant.swingLookbackBars || 10);
    const pullbackLow = extreme(lookbackBars.map((bar) => bar.low), "min") ?? feature5m.low;
    const pullbackHigh = extreme(lookbackBars.map((bar) => bar.high), "max") ?? feature5m.high;
    const extensionAboveEma20Bps = ((pullbackHigh - feature5m.ema20) / Math.max(feature5m.ema20, 1e-9)) * 10_000;
    const extensionBelowEma20Bps = ((feature5m.ema20 - pullbackLow) / Math.max(feature5m.ema20, 1e-9)) * 10_000;
    const higherLow = feature5m.low > prev1.low && prev1.low <= prev2.low * 1.002;
    const lowerHigh = feature5m.high < prev1.high && prev1.high >= prev2.high * 0.998;
    const reboundCloseLocation = variant.reboundCloseLocation ?? variant.reclaimCloseLocation;

    if (variant.allowLong && regimeStackBull) {
      const strongEnough = !variant.requireStrongRegime || feature15m.trendSlopeBps >= variant.regimeSlopeBps + 2;
      const slopeEnough = feature15m.trendSlopeBps >= variant.regimeSlopeBps;
      const volumeEnough = !variant.requireVolumeLift || feature5m.volRatio >= 1.02;
      const stackEnough = feature5m.ema20 > feature5m.ema50 && stackDistanceBps >= variant.trendStackDistanceBps;
      const extensionEnough = extensionBelowEma20Bps >= (variant.extensionBps || 30);
      const ema50Held = !variant.requireEma50Hold || pullbackLow >= feature5m.ema50 * (1 - 0.003);
      const dipTouched = prev1.low <= prev1.ema20 * (1 + (variant.pullbackTouchBps / 10_000));
      const reclaimEnough = feature5m.close > feature5m.ema20
        && feature5m.close > feature5m.vwapDay
        && feature5m.closeLocation >= reboundCloseLocation
        && feature5m.close > priorClose
        && feature5m.close > feature5m.open;
      if (strongEnough && slopeEnough && volumeEnough && stackEnough && extensionEnough && ema50Held && dipTouched && higherLow && reclaimEnough) {
        const trigger = findTrigger(candles1m, feature5m.ts, triggerUntilTs, "long", feature5m.high, variant.breakoutBps);
        if (trigger) {
          return {
            side: "long",
            setupTs: feature5m.ts,
            triggerTs: trigger.ts,
            entryPrice: trigger.price,
            reason: `15m uptrend + 5m pullback snapback above EMA20`,
          };
        }
      }
    }

    if (variant.allowShort && regimeStackBear) {
      const strongEnough = !variant.requireStrongRegime || feature15m.trendSlopeBps <= -(variant.regimeSlopeBps + 2);
      const slopeEnough = feature15m.trendSlopeBps <= -variant.regimeSlopeBps;
      const volumeEnough = !variant.requireVolumeLift || feature5m.volRatio >= 1.02;
      const stackEnough = feature5m.ema20 < feature5m.ema50 && stackDistanceBps <= -variant.trendStackDistanceBps;
      const extensionEnough = extensionAboveEma20Bps >= (variant.extensionBps || 30);
      const ema50Held = !variant.requireEma50Hold || pullbackHigh <= feature5m.ema50 * (1 + 0.003);
      const dipTouched = prev1.high >= prev1.ema20 * (1 - (variant.pullbackTouchBps / 10_000));
      const reclaimEnough = feature5m.close < feature5m.ema20
        && feature5m.close < feature5m.vwapDay
        && (1 - feature5m.closeLocation) >= reboundCloseLocation
        && feature5m.close < priorClose
        && feature5m.close < feature5m.open;
      if (strongEnough && slopeEnough && volumeEnough && stackEnough && extensionEnough && ema50Held && dipTouched && lowerHigh && reclaimEnough) {
        const trigger = findTrigger(candles1m, feature5m.ts, triggerUntilTs, "short", feature5m.low, variant.breakoutBps);
        if (trigger) {
          return {
            side: "short",
            setupTs: feature5m.ts,
            triggerTs: trigger.ts,
            entryPrice: trigger.price,
            reason: `15m downtrend + 5m pullback snapback below EMA20`,
          };
        }
      }
    }

    return null;
  }

  if (variant.allowLong && regime.bullish) {
    const strongEnough = !variant.requireStrongRegime || regime.strongBullish;
    const slopeEnough = feature15m.trendSlopeBps >= variant.regimeSlopeBps;
    const volumeEnough = !variant.requireVolumeLift || feature5m.volRatio >= 1.05;
    const stackEnough = feature5m.ema9 > feature5m.ema20
      && feature5m.ema20 > feature5m.ema50
      && stackDistanceBps >= variant.trendStackDistanceBps;
    const reclaimEnough = touchedEma20Long
      && feature5m.close > feature5m.ema9
      && feature5m.close > feature5m.vwapDay
      && feature5m.closeLocation >= variant.reclaimCloseLocation;
    if (strongEnough && slopeEnough && volumeEnough && stackEnough && reclaimEnough) {
      const trigger = findTrigger(candles1m, feature5m.ts, triggerUntilTs, "long", recentHigh, variant.breakoutBps);
      if (trigger) {
        return {
          side: "long",
          setupTs: feature5m.ts,
          triggerTs: trigger.ts,
          entryPrice: trigger.price,
          reason: `15m uptrend + 5m reclaim above EMA20/VWAP`,
        };
      }
    }
  }

  if (variant.allowShort && regime.bearish) {
    const strongEnough = !variant.requireStrongRegime || regime.strongBearish;
    const slopeEnough = feature15m.trendSlopeBps <= -variant.regimeSlopeBps;
    const volumeEnough = !variant.requireVolumeLift || feature5m.volRatio >= 1.05;
    const stackEnough = feature5m.ema9 < feature5m.ema20
      && feature5m.ema20 < feature5m.ema50
      && stackDistanceBps <= -variant.trendStackDistanceBps;
    const reclaimEnough = touchedEma20Short
      && feature5m.close < feature5m.ema9
      && feature5m.close < feature5m.vwapDay
      && (1 - feature5m.closeLocation) >= variant.reclaimCloseLocation;
    if (strongEnough && slopeEnough && volumeEnough && stackEnough && reclaimEnough) {
      const trigger = findTrigger(candles1m, feature5m.ts, triggerUntilTs, "short", recentLow, variant.breakoutBps);
      if (trigger) {
        return {
          side: "short",
          setupTs: feature5m.ts,
          triggerTs: trigger.ts,
          entryPrice: trigger.price,
          reason: `15m downtrend + 5m reclaim below EMA20/VWAP`,
        };
      }
    }
  }

  return null;

  function features5mSlice(endIndex: number, count: number) {
    return features5m.slice(Math.max(0, endIndex - count + 1), endIndex + 1);
  }
  function features5mInputAt(index: number) {
    return index >= 0 ? features5m[index] : null;
  }
}

let features5m: Feature[] = [];

function closePosition(position: Position, exitTs: number, exitPriceRaw: number, exitReason: string) {
  const entryPrice = position.entryPrice * (1 + (position.side === "long" ? TAKER_FEE_PER_SIDE : -TAKER_FEE_PER_SIDE));
  const exitPrice = exitPriceRaw * (1 - (position.side === "long" ? TAKER_FEE_PER_SIDE : -TAKER_FEE_PER_SIDE));
  const pnlPct = position.side === "long"
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
  const holdMinutes = Math.round((exitTs - position.entryTs) / 60_000);
  return {
    trade: {
      side: position.side,
      entryIso: new Date(position.entryTs).toISOString(),
      exitIso: new Date(exitTs).toISOString(),
      entryPrice: round(position.entryPrice, 8),
      exitPrice: round(exitPriceRaw, 8),
      pnlPct: round(pnlPct, 4),
      holdMinutes,
      entryReason: position.reason,
      exitReason,
    } satisfies Trade,
    netReturn: pnlPct / 100,
  };
}

function runVariant(variant: Variant, candles1m: Candle[], features5mInput: Feature[], features15m: Feature[]) {
  const trades: Trade[] = [];
  let equity = STARTING_EQUITY;
  let peakEquity = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let position: Position | null = null;
  const feature15mMap = featureMapByTs(features15m);
  const feature5mMap = featureMapByTs(features5mInput);
  void feature5mMap;

  for (let index = 30; index < features5mInput.length; index += 1) {
    const feature5m = features5mInput[index];

    if (position) {
      const nowPrice = feature5m.close;
      position.peakPrice = Math.max(position.peakPrice, nowPrice);
      position.troughPrice = Math.min(position.troughPrice, nowPrice);

      const stopEnabled = feature5m.ts >= position.stopEnabledTs;
      const forcedExit = feature5m.ts >= position.forcedExitTs;
      const failExitReady = feature5m.ts >= position.failExitTs;
      const pnlPct = position.side === "long"
        ? (nowPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - nowPrice) / position.entryPrice;
      const adversePct = position.side === "long"
        ? (position.entryPrice - feature5m.low) / position.entryPrice
        : (feature5m.high - position.entryPrice) / position.entryPrice;
      const trailReady = position.side === "long"
        ? ((position.peakPrice - position.entryPrice) / position.entryPrice) >= variant.trailActivationPct
        : ((position.entryPrice - position.troughPrice) / position.entryPrice) >= variant.trailActivationPct;
      const trailRetrace = position.side === "long"
        ? (position.peakPrice - feature5m.close) / Math.max(position.peakPrice, 1e-9)
        : (feature5m.close - position.troughPrice) / Math.max(position.troughPrice, 1e-9);

      if (stopEnabled && adversePct >= variant.stopLossPct) {
        const closed = closePosition(position, feature5m.ts, position.side === "long"
          ? position.entryPrice * (1 - variant.stopLossPct)
          : position.entryPrice * (1 + variant.stopLossPct), "stop loss");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      } else if (pnlPct >= variant.takeProfitPct) {
        const closed = closePosition(position, feature5m.ts, nowPrice, "take profit");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      } else if (trailReady && trailRetrace >= variant.trailRetracePct) {
        const closed = closePosition(position, feature5m.ts, nowPrice, "trail stop");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      } else if (failExitReady) {
        const distanceBps = position.side === "long"
          ? ((feature5m.close - feature5m.ema20) / Math.max(feature5m.ema20, 1e-9)) * 10_000
          : ((feature5m.ema20 - feature5m.close) / Math.max(feature5m.ema20, 1e-9)) * 10_000;
        if (distanceBps < variant.failExitDistanceBps) {
          const closed = closePosition(position, feature5m.ts, nowPrice, "failed follow-through");
          trades.push(closed.trade);
          equity *= 1 + closed.netReturn;
          position = null;
        }
      } else if (forcedExit) {
        const closed = closePosition(position, feature5m.ts, nowPrice, "time stop");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      }

      peakEquity = Math.max(peakEquity, equity);
      const drawdownPct = ((equity / peakEquity) - 1) * 100;
      maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
      if (position) continue;
    }

    const candidate = buildCandidate(feature5m, index, features15m, feature15mMap, candles1m, variant);
    if (!candidate) continue;

    position = {
      side: candidate.side,
      entryTs: candidate.triggerTs,
      entryPrice: candidate.entryPrice,
      stopEnabledTs: candidate.triggerTs + (variant.stopGraceMinutes * 60_000),
      forcedExitTs: candidate.triggerTs + (variant.timeStopMinutes * 60_000),
      failExitTs: candidate.triggerTs + (variant.failExitAfterMinutes * 60_000),
      peakPrice: candidate.entryPrice,
      troughPrice: candidate.entryPrice,
      reason: candidate.reason,
    };
  }

  if (position) {
    const lastClose = features5mInput.at(-1)?.close ?? position.entryPrice;
    const closed = closePosition(position, END_TS, lastClose, "end of backtest");
    trades.push(closed.trade);
    equity *= 1 + closed.netReturn;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = ((equity / peakEquity) - 1) * 100;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
  }

  const wins = trades.filter((trade) => trade.pnlPct > 0).length;
  const losses = trades.filter((trade) => trade.pnlPct <= 0).length;
  const grossProfit = trades.filter((trade) => trade.pnlPct > 0).reduce((sum, trade) => sum + trade.pnlPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnlPct <= 0).reduce((sum, trade) => sum + trade.pnlPct, 0));
  const totalMonths = Math.max(1, (END_TS - START_TS) / (30.4375 * 24 * 60 * 60 * 1000));

  return {
    key: variant.key,
    title: variant.title,
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    endEquity: round(equity, 2),
    returnPct: round(((equity / STARTING_EQUITY) - 1) * 100, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : 0,
    avgPnlPct: round(average(trades.map((trade) => trade.pnlPct)), 4),
    avgHoldMinutes: round(average(trades.map((trade) => trade.holdMinutes)), 2),
    tradesPerMonth: round(trades.length / totalMonths, 2),
    tradesDetail: trades,
  } satisfies VariantResult;
}

function renderMarkdown(results: VariantResult[]) {
  return [
    "# ASTER/USDT short-term technical backtest",
    "",
    `- symbol: ${SYMBOL}`,
    `- period: ${new Date(START_TS).toISOString()} -> ${new Date(END_TS).toISOString()}`,
    `- structure: 15m regime / 5m setup / 1m trigger`,
    "",
    "| Variant | Trades | Win Rate | Return | Max DD | PF | Avg Hold (m) | Trades / Month |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((result) =>
      `| ${result.key} | ${result.trades} | ${result.winRatePct.toFixed(2)}% | ${result.returnPct.toFixed(2)}% | ${result.maxDrawdownPct.toFixed(2)}% | ${result.profitFactor.toFixed(2)} | ${result.avgHoldMinutes.toFixed(2)} | ${result.tradesPerMonth.toFixed(2)} |`,
    ),
    "",
    "## Notes",
    "- Long and short are decided only from ASTER price structure.",
    "- No BTC filter, no GoldCat signal, no existing combined logic reuse.",
    "- Stop settings are 10-minute grace and -0.45% hard stop for every variant here.",
  ].join("\n");
}

async function main() {
  const candles1m = await fetchAsterKlines(SYMBOL, "1m", START_TS, END_TS);
  const candles5m = await fetchAsterKlines(SYMBOL, "5m", START_TS, END_TS);
  features5m = buildFeatures(candles5m);
  const features15m = buildFeatures(aggregateCandles(candles5m, 3));
  const variants = VARIANT_FILTER.size
    ? VARIANTS.filter((variant) => VARIANT_FILTER.has(variant.key))
    : VARIANTS;
  const results = variants.map((variant) => runVariant(variant, candles1m, features5m, features15m));

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(results, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), renderMarkdown(results), "utf8");

  console.log(renderMarkdown(results));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
