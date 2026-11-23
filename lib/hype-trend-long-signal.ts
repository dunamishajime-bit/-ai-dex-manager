import { HYPE_TREND_LONG_POLICY } from "../config/hypeTrendLongPolicy";

const HOUR_MS = 60 * 60 * 1_000;
const EPSILON = 1e-12;

export type HypeTrendCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HypeTrendSignal = {
  accepted: boolean;
  strategy: "HYPE_LONG";
  symbol: "HYPEUSDT";
  side: "LONG" | "FLAT";
  signalTsMs: number | null;
  entryPrice: number | null;
  stopPrice: number | null;
  trailingDistance: number | null;
  stopDistance: number | null;
  fastEma: number | null;
  slowEma: number | null;
  regimeEma: number | null;
  regimeSlopeBps: number | null;
  breakoutBps: number | null;
  atr: number | null;
  reason: string;
};

function invalid(reason: string): HypeTrendSignal {
  return {
    accepted: false,
    strategy: "HYPE_LONG",
    symbol: "HYPEUSDT",
    side: "FLAT",
    signalTsMs: null,
    entryPrice: null,
    stopPrice: null,
    trailingDistance: null,
    stopDistance: null,
    fastEma: null,
    slowEma: null,
    regimeEma: null,
    regimeSlopeBps: null,
    breakoutBps: null,
    atr: null,
    reason,
  };
}

function validCandle(row: HypeTrendCandle) {
  return Number.isFinite(row.openTime)
    && row.openTime > 0
    && Number.isFinite(row.open)
    && Number.isFinite(row.high)
    && Number.isFinite(row.low)
    && Number.isFinite(row.close)
    && Number.isFinite(row.volume)
    && row.open > 0
    && row.high > 0
    && row.low > 0
    && row.close > 0
    && row.high >= row.low
    && row.volume >= 0;
}

function normalize(rows: readonly HypeTrendCandle[], now: number) {
  const sorted = rows.filter(validCandle).slice().sort((a, b) => a.openTime - b.openTime);
  const completed: HypeTrendCandle[] = [];
  for (const row of sorted) {
    if (row.openTime + HOUR_MS > now) continue;
    const previous = completed.at(-1);
    if (previous?.openTime === row.openTime) return { rows: [], reason: "DUPLICATE_COMPLETED_BAR" };
    if (previous && row.openTime - previous.openTime !== HOUR_MS) return { rows: [], reason: "H1_GAP" };
    completed.push(row);
  }
  return { rows: completed, reason: "" };
}

function ema(rows: readonly HypeTrendCandle[], period: number) {
  const alpha = 2 / (period + 1);
  let value = rows[0]?.close ?? 0;
  for (const row of rows.slice(1)) value = row.close * alpha + value * (1 - alpha);
  return value;
}

function atr(rows: readonly HypeTrendCandle[], period: number) {
  if (rows.length < period + 1) return 0;
  const trs = rows.slice(1).map((row, index) => {
    const previous = rows[index].close;
    return Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous));
  });
  const tail = trs.slice(-period);
  return tail.reduce((sum, value) => sum + value, 0) / tail.length;
}

/**
 * Evaluate only completed H1 bars.  `entryPrice` is the latest completed
 * close; the live runner re-quotes immediately before planning/execution.
 */
export function buildHypeTrendSignal(input: { btc: readonly HypeTrendCandle[]; hype: readonly HypeTrendCandle[]; now: number }): HypeTrendSignal {
  if (!Number.isFinite(input.now) || input.now <= 0) return invalid("INVALID_NOW");
  const btc = normalize(input.btc, input.now);
  const hype = normalize(input.hype, input.now);
  if (btc.reason || hype.reason) return invalid(btc.reason || hype.reason);
  const btcRows = btc.rows;
  const hypeRows = hype.rows;
  const minimumRows = Math.max(HYPE_TREND_LONG_POLICY.regimeEmaPeriod + 1, HYPE_TREND_LONG_POLICY.slowEmaPeriod + HYPE_TREND_LONG_POLICY.breakoutLookbackHours, HYPE_TREND_LONG_POLICY.atrPeriod + 1);
  if (btcRows.length < minimumRows || hypeRows.length < minimumRows) return invalid("INSUFFICIENT_COMPLETED_H1_DATA");
  const btcLast = btcRows.at(-1)!;
  const hypeLast = hypeRows.at(-1)!;
  if (btcLast.openTime !== hypeLast.openTime) return invalid("BTC_HYPE_BAR_ALIGNMENT_MISMATCH");

  const fast = ema(hypeRows, HYPE_TREND_LONG_POLICY.fastEmaPeriod);
  const slow = ema(hypeRows, HYPE_TREND_LONG_POLICY.slowEmaPeriod);
  const regime = ema(hypeRows, HYPE_TREND_LONG_POLICY.regimeEmaPeriod);
  const regimePrevious = ema(hypeRows.slice(0, -24), HYPE_TREND_LONG_POLICY.regimeEmaPeriod);
  const regimeSlopeBps = (regime / Math.max(regimePrevious, EPSILON) - 1) * 10_000;
  const breakoutStart = hypeRows.length - 1 - HYPE_TREND_LONG_POLICY.breakoutLookbackHours;
  const priorHigh = Math.max(...hypeRows.slice(Math.max(0, breakoutStart), -1).map((row) => row.high));
  const breakoutBps = (hypeLast.close / Math.max(priorHigh, EPSILON) - 1) * 10_000;
  const latestAtr = atr(hypeRows, HYPE_TREND_LONG_POLICY.atrPeriod);
  const distanceFromSlowBps = (hypeLast.close / Math.max(slow, EPSILON) - 1) * 10_000;

  if (!(hypeLast.close > fast && fast > slow)) return { ...invalid("TREND_ALIGNMENT_NOT_MET"), signalTsMs: hypeLast.openTime, entryPrice: hypeLast.close, fastEma: fast, slowEma: slow, regimeEma: regime, regimeSlopeBps, breakoutBps, atr: latestAtr };
  if (regimeSlopeBps < HYPE_TREND_LONG_POLICY.minimumRegimeSlopeBps) return { ...invalid("REGIME_SLOPE_NOT_MET"), signalTsMs: hypeLast.openTime, entryPrice: hypeLast.close, fastEma: fast, slowEma: slow, regimeEma: regime, regimeSlopeBps, breakoutBps, atr: latestAtr };
  if (breakoutBps < HYPE_TREND_LONG_POLICY.minimumBreakoutBps) return { ...invalid("BREAKOUT_NOT_MET"), signalTsMs: hypeLast.openTime, entryPrice: hypeLast.close, fastEma: fast, slowEma: slow, regimeEma: regime, regimeSlopeBps, breakoutBps, atr: latestAtr };
  if (distanceFromSlowBps > HYPE_TREND_LONG_POLICY.maximumDistanceFromSlowEmaBps) return { ...invalid("DISTANCE_FROM_SLOW_EMA_TOO_LARGE"), signalTsMs: hypeLast.openTime, entryPrice: hypeLast.close, fastEma: fast, slowEma: slow, regimeEma: regime, regimeSlopeBps, breakoutBps, atr: latestAtr };
  if (!(latestAtr > 0)) return invalid("ATR_UNAVAILABLE");

  const stopDistance = latestAtr * HYPE_TREND_LONG_POLICY.stopAtrMultiple;
  const trailingDistance = latestAtr * HYPE_TREND_LONG_POLICY.trailingAtrMultiple;
  const stopPrice = hypeLast.close - stopDistance;
  if (!(stopPrice > 0 && stopPrice < hypeLast.close)) return invalid("STOP_PRICE_INVALID");
  return {
    accepted: true,
    strategy: "HYPE_LONG",
    symbol: "HYPEUSDT",
    side: "LONG",
    signalTsMs: hypeLast.openTime,
    entryPrice: hypeLast.close,
    stopPrice,
    trailingDistance,
    stopDistance,
    fastEma: fast,
    slowEma: slow,
    regimeEma: regime,
    regimeSlopeBps,
    breakoutBps,
    atr: latestAtr,
    reason: "HYPE_TREND_LONG_SIGNAL_ACCEPTED",
  };
}
