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
  ema50: number;
  vwapDay: number;
  volAvg20: number;
  volRatio: number;
  closeLocation: number;
  bodyPct: number;
};

type Side = "long" | "short";

type Variant = {
  key: string;
  title: string;
  allowLong: boolean;
  allowShort: boolean;
  entryMode?: "1m_confirm" | "5m_close";
  useD1: boolean;
  requireM30Align: boolean;
  minAlignedFrames: number;
  requireVolumeLift: boolean;
  minVolumeRatio: number;
  requireVwapReclaim: boolean;
  requireEngulfing: boolean;
  requireSweep: boolean;
  pullbackDepthBps: number;
  reclaimCloseLocation: number;
  confirmMinutes: number;
  holdMinutes: number;
  stopGraceMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  allowedHoursUtc?: number[];
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

type Result = {
  key: string;
  title: string;
  trades: number;
  tradesPerDay: number;
  wins: number;
  winRatePct: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgHoldMinutes: number;
  avgPnlPct: number;
  debugDirectionPass: number;
  debugSetupPass: number;
  debugTriggerPass: number;
  tradesDetail: Trade[];
};

type Position = {
  side: Side;
  entryTs: number;
  entryPrice: number;
  stopEnabledTs: number;
  forcedExitTs: number;
  peakPrice: number;
  troughPrice: number;
  reason: string;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "aster-reversal-mtf");
const CACHE_DIR = path.join(process.cwd(), ".cache", "aster-reversal-mtf");
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

const VARIANTS: Variant[] = [
  {
    key: "rev_vwap_engulf_quality_long",
    title: "4H/1H up bias + 5m VWAP reclaim + engulf long",
    allowLong: true,
    allowShort: false,
    entryMode: "1m_confirm",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 3,
    requireVolumeLift: true,
    minVolumeRatio: 1.05,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 18,
    reclaimCloseLocation: 0.62,
    confirmMinutes: 3,
    holdMinutes: 45,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.009,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
  },
  {
    key: "rev_vwap_engulf_quality_dual",
    title: "4H/1H bias + 5m VWAP reclaim + engulf dual",
    allowLong: true,
    allowShort: true,
    entryMode: "1m_confirm",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 3,
    requireVolumeLift: true,
    minVolumeRatio: 1.05,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 18,
    reclaimCloseLocation: 0.62,
    confirmMinutes: 3,
    holdMinutes: 45,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.009,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
  },
  {
    key: "rev_volume_reclaim_balanced_long",
    title: "4H/1H up bias + 5m reclaim + volume long",
    allowLong: true,
    allowShort: false,
    entryMode: "1m_confirm",
    useD1: false,
    requireM30Align: true,
    minAlignedFrames: 2,
    requireVolumeLift: true,
    minVolumeRatio: 1.0,
    requireVwapReclaim: true,
    requireEngulfing: false,
    requireSweep: true,
    pullbackDepthBps: 14,
    reclaimCloseLocation: 0.58,
    confirmMinutes: 4,
    holdMinutes: 40,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0085,
    trailActivationPct: 0.0048,
    trailRetracePct: 0.0024,
  },
  {
    key: "rev_engulf_active_dual",
    title: "1H/30m bias + 5m engulf reversal dual",
    allowLong: true,
    allowShort: true,
    entryMode: "1m_confirm",
    useD1: false,
    requireM30Align: false,
    minAlignedFrames: 1,
    requireVolumeLift: false,
    minVolumeRatio: 0.95,
    requireVwapReclaim: false,
    requireEngulfing: true,
    requireSweep: false,
    pullbackDepthBps: 10,
    reclaimCloseLocation: 0.56,
    confirmMinutes: 4,
    holdMinutes: 30,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0075,
    trailActivationPct: 0.0042,
    trailRetracePct: 0.0022,
  },
  {
    key: "rev_session_vwap_long_close_entry",
    title: "London/NY long-only VWAP reclaim close-entry",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 3,
    requireVolumeLift: true,
    minVolumeRatio: 1.02,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 14,
    reclaimCloseLocation: 0.58,
    confirmMinutes: 0,
    holdMinutes: 35,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.007,
    trailActivationPct: 0.0045,
    trailRetracePct: 0.0022,
    allowedHoursUtc: [7, 8, 9, 10, 11, 12, 13, 14],
  },
  {
    key: "rev_session_vwap_dual_close_entry",
    title: "London/NY dual VWAP reclaim close-entry",
    allowLong: true,
    allowShort: true,
    entryMode: "5m_close",
    useD1: false,
    requireM30Align: true,
    minAlignedFrames: 2,
    requireVolumeLift: true,
    minVolumeRatio: 1.02,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 14,
    reclaimCloseLocation: 0.58,
    confirmMinutes: 0,
    holdMinutes: 30,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0065,
    trailActivationPct: 0.004,
    trailRetracePct: 0.002,
    allowedHoursUtc: [7, 8, 9, 10, 11, 12, 13, 14],
  },
  {
    key: "rev_session_ny_momentum_long",
    title: "NY session bullish reversal long close-entry",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: false,
    requireM30Align: true,
    minAlignedFrames: 2,
    requireVolumeLift: true,
    minVolumeRatio: 1.08,
    requireVwapReclaim: true,
    requireEngulfing: false,
    requireSweep: true,
    pullbackDepthBps: 18,
    reclaimCloseLocation: 0.60,
    confirmMinutes: 0,
    holdMinutes: 25,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.006,
    trailActivationPct: 0.004,
    trailRetracePct: 0.0018,
    allowedHoursUtc: [12, 13, 14, 15, 16, 17, 18, 19],
  },
  {
    key: "rev_ultra_quality_london_long",
    title: "Ultra quality London long-only",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 4,
    requireVolumeLift: true,
    minVolumeRatio: 1.12,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 20,
    reclaimCloseLocation: 0.66,
    confirmMinutes: 0,
    holdMinutes: 25,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0055,
    trailActivationPct: 0.0038,
    trailRetracePct: 0.0018,
    allowedHoursUtc: [7, 8, 9, 10, 11],
  },
  {
    key: "rev_ultra_quality_overlap_long",
    title: "Ultra quality overlap long-only",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 4,
    requireVolumeLift: true,
    minVolumeRatio: 1.08,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 18,
    reclaimCloseLocation: 0.64,
    confirmMinutes: 0,
    holdMinutes: 20,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0048,
    trailActivationPct: 0.0035,
    trailRetracePct: 0.0016,
    allowedHoursUtc: [11, 12, 13, 14, 15, 16],
  },
  {
    key: "rev_ultra_quality_mini_tp_long",
    title: "Ultra quality mini-TP long-only",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 3,
    requireVolumeLift: true,
    minVolumeRatio: 1.05,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 16,
    reclaimCloseLocation: 0.62,
    confirmMinutes: 0,
    holdMinutes: 18,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0042,
    trailActivationPct: 0.003,
    trailRetracePct: 0.0015,
    allowedHoursUtc: [7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  {
    key: "rev_ultra_quality_london_relaxed_long",
    title: "Ultra quality London relaxed long-only",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 4,
    requireVolumeLift: true,
    minVolumeRatio: 1.08,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 18,
    reclaimCloseLocation: 0.64,
    confirmMinutes: 0,
    holdMinutes: 22,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0048,
    trailActivationPct: 0.0035,
    trailRetracePct: 0.0017,
    allowedHoursUtc: [7, 8, 9, 10, 11, 12],
  },
  {
    key: "rev_ultra_quality_no_engulf_long",
    title: "Ultra quality no-engulf long-only",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 4,
    requireVolumeLift: true,
    minVolumeRatio: 1.10,
    requireVwapReclaim: true,
    requireEngulfing: false,
    requireSweep: true,
    pullbackDepthBps: 18,
    reclaimCloseLocation: 0.66,
    confirmMinutes: 0,
    holdMinutes: 20,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0045,
    trailActivationPct: 0.0033,
    trailRetracePct: 0.0016,
    allowedHoursUtc: [7, 8, 9, 10, 11, 12, 13],
  },
  {
    key: "rev_ultra_quality_overlap_relaxed_long",
    title: "Ultra quality overlap relaxed long-only",
    allowLong: true,
    allowShort: false,
    entryMode: "5m_close",
    useD1: true,
    requireM30Align: true,
    minAlignedFrames: 3,
    requireVolumeLift: true,
    minVolumeRatio: 1.07,
    requireVwapReclaim: true,
    requireEngulfing: true,
    requireSweep: true,
    pullbackDepthBps: 16,
    reclaimCloseLocation: 0.62,
    confirmMinutes: 0,
    holdMinutes: 20,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0046,
    trailActivationPct: 0.0032,
    trailRetracePct: 0.0015,
    allowedHoursUtc: [10, 11, 12, 13, 14, 15, 16],
  },
];

for (const preset of [
  { prefix: "sweep_lon", hours: [7, 8, 9, 10, 11, 12], useD1: true },
  { prefix: "sweep_ovr", hours: [10, 11, 12, 13, 14, 15, 16], useD1: true },
  { prefix: "sweep_ny", hours: [12, 13, 14, 15, 16, 17, 18, 19], useD1: false },
]) {
  for (const minAlignedFrames of [3, 4]) {
    for (const minVolumeRatio of [1.02, 1.06]) {
      for (const requireEngulfing of [false, true]) {
        VARIANTS.push({
          key: `${preset.prefix}_af${minAlignedFrames}_vr${String(minVolumeRatio).replace(".", "")}_${requireEngulfing ? "eng" : "plain"}`,
          title: `Sweep ${preset.prefix} af${minAlignedFrames} vr${minVolumeRatio} ${requireEngulfing ? "engulf" : "plain"}`,
          allowLong: true,
          allowShort: false,
          entryMode: "5m_close",
          useD1: preset.useD1,
          requireM30Align: true,
          minAlignedFrames,
          requireVolumeLift: true,
          minVolumeRatio,
          requireVwapReclaim: true,
          requireEngulfing,
          requireSweep: true,
          pullbackDepthBps: minAlignedFrames === 4 ? 18 : 14,
          reclaimCloseLocation: requireEngulfing ? 0.60 : 0.56,
          confirmMinutes: 0,
          holdMinutes: requireEngulfing ? 20 : 18,
          stopGraceMinutes: 10,
          stopLossPct: 0.0045,
          takeProfitPct: requireEngulfing ? 0.0048 : 0.0042,
          trailActivationPct: requireEngulfing ? 0.0035 : 0.003,
          trailRetracePct: requireEngulfing ? 0.0017 : 0.0015,
          allowedHoursUtc: preset.hours,
        });
      }
    }
  }
}

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
    return JSON.parse(await fs.readFile(cachePath, "utf8")) as Candle[];
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
      if (!response?.ok) throw new Error(`Aster klines request failed: ${lastStatus}`);
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) break;
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
        if (Number.isFinite(candle.ts) && candle.close > 0) out.push(candle);
      }
      const last = rows.at(-1);
      const nextTs = Number(Array.isArray(last) ? last[6] : 0) + 1;
      if (!Number.isFinite(nextTs) || nextTs <= cursor) break;
      cursor = nextTs;
    }
    const dedup = new Map<number, Candle>();
    for (const candle of out) dedup.set(candle.ts, candle);
    const candles = [...dedup.values()].sort((a, b) => a.ts - b.ts);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function aggregateCandles(candles: Candle[], barsPerGroup: number) {
  const out: Candle[] = [];
  for (let i = 0; i + barsPerGroup - 1 < candles.length; i += barsPerGroup) {
    const group = candles.slice(i, i + barsPerGroup);
    out.push({
      ts: group[0].ts,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
    });
  }
  return out;
}

function buildFeatures(candles: Candle[]) {
  const out: Feature[] = [];
  let ema20Prev: number | null = null;
  let ema50Prev: number | null = null;
  let dayKey = "";
  let dayPv = 0;
  let dayVolume = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    ema20Prev = ema(ema20Prev, candle.close, 20);
    ema50Prev = ema(ema50Prev, candle.close, 50);
    const iso = new Date(candle.ts).toISOString();
    const nextDayKey = iso.slice(0, 10);
    if (nextDayKey !== dayKey) {
      dayKey = nextDayKey;
      dayPv = 0;
      dayVolume = 0;
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    dayPv += typical * candle.volume;
    dayVolume += candle.volume;
    const recent = candles.slice(Math.max(0, i - 19), i + 1);
    const volAvg20 = average(recent.map((bar) => bar.volume));
    const range = Math.max(candle.high - candle.low, 1e-9);
    out.push({
      ...candle,
      ema20: ema20Prev,
      ema50: ema50Prev,
      vwapDay: dayPv / Math.max(dayVolume, 1e-9),
      volAvg20,
      volRatio: candle.volume / Math.max(volAvg20, 1e-9),
      closeLocation: (candle.close - candle.low) / range,
      bodyPct: Math.abs(candle.close - candle.open) / Math.max(candle.close, 1e-9),
    });
  }
  return out;
}

function latestFeatureAt(features: Feature[], ts: number) {
  let low = 0;
  let high = features.length - 1;
  let answer: Feature | null = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = features[mid];
    if (candidate.ts <= ts) {
      answer = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

function bullBias(feature: Feature) {
  return feature.close > feature.ema20 && feature.ema20 > feature.ema50;
}

function bearBias(feature: Feature) {
  return feature.close < feature.ema20 && feature.ema20 < feature.ema50;
}

function bullishEngulfing(prev: Feature, curr: Feature) {
  return prev.close < prev.open && curr.close > curr.open && curr.close >= prev.open && curr.open <= prev.close;
}

function bearishEngulfing(prev: Feature, curr: Feature) {
  return prev.close > prev.open && curr.close < curr.open && curr.close <= prev.open && curr.open >= prev.close;
}

function closePosition(position: Position, exitTs: number, exitPriceRaw: number, exitReason: string) {
  const entryPrice = position.entryPrice * (1 + (position.side === "long" ? TAKER_FEE_PER_SIDE : -TAKER_FEE_PER_SIDE));
  const exitPrice = exitPriceRaw * (1 - (position.side === "long" ? TAKER_FEE_PER_SIDE : -TAKER_FEE_PER_SIDE));
  const pnlPct = position.side === "long"
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
  return {
    trade: {
      side: position.side,
      entryIso: new Date(position.entryTs).toISOString(),
      exitIso: new Date(exitTs).toISOString(),
      entryPrice: round(position.entryPrice, 8),
      exitPrice: round(exitPriceRaw, 8),
      pnlPct: round(pnlPct, 4),
      holdMinutes: Math.round((exitTs - position.entryTs) / 60_000),
      entryReason: position.reason,
      exitReason,
    } satisfies Trade,
    netReturn: pnlPct / 100,
  };
}

function runVariant(
  variant: Variant,
  candles1m: Candle[],
  features5m: Feature[],
  features30m: Feature[],
  features1h: Feature[],
  features4h: Feature[],
  features1d: Feature[],
) {
  const trades: Trade[] = [];
  let equity = STARTING_EQUITY;
  let peakEquity = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let position: Position | null = null;
  let debugDirectionPass = 0;
  let debugSetupPass = 0;
  let debugTriggerPass = 0;

  const find1mConfirm = (afterTs: number, untilTs: number, side: Side, level: number) => {
    for (const candle of candles1m) {
      if (candle.ts <= afterTs || candle.ts > untilTs) continue;
      if (side === "long" && candle.high >= level) return { ts: candle.ts, price: Math.max(candle.open, level) };
      if (side === "short" && candle.low <= level) return { ts: candle.ts, price: Math.min(candle.open, level) };
    }
    return null;
  };

  for (let i = 12; i < features5m.length; i += 1) {
    const curr = features5m[i];
    const prev = features5m[i - 1];
    const prev2 = features5m[i - 2];
    const hourUtc = new Date(curr.ts).getUTCHours();

    if (position) {
      const now = curr.close;
      position.peakPrice = Math.max(position.peakPrice, now);
      position.troughPrice = Math.min(position.troughPrice, now);
      const stopEnabled = curr.ts >= position.stopEnabledTs;
      const forcedExit = curr.ts >= position.forcedExitTs;
      const pnlPct = position.side === "long"
        ? (now - position.entryPrice) / position.entryPrice
        : (position.entryPrice - now) / position.entryPrice;
      const adversePct = position.side === "long"
        ? (position.entryPrice - curr.low) / position.entryPrice
        : (curr.high - position.entryPrice) / position.entryPrice;
      const trailReady = position.side === "long"
        ? ((position.peakPrice - position.entryPrice) / position.entryPrice) >= variant.trailActivationPct
        : ((position.entryPrice - position.troughPrice) / position.entryPrice) >= variant.trailActivationPct;
      const trailRetrace = position.side === "long"
        ? (position.peakPrice - curr.close) / Math.max(position.peakPrice, 1e-9)
        : (curr.close - position.troughPrice) / Math.max(position.troughPrice, 1e-9);

      if (stopEnabled && adversePct >= variant.stopLossPct) {
        const closed = closePosition(position, curr.ts, position.side === "long"
          ? position.entryPrice * (1 - variant.stopLossPct)
          : position.entryPrice * (1 + variant.stopLossPct), "stop loss");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      } else if (pnlPct >= variant.takeProfitPct) {
        const closed = closePosition(position, curr.ts, now, "take profit");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      } else if (trailReady && trailRetrace >= variant.trailRetracePct) {
        const closed = closePosition(position, curr.ts, now, "trail stop");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      } else if (forcedExit) {
        const closed = closePosition(position, curr.ts, now, "time stop");
        trades.push(closed.trade);
        equity *= 1 + closed.netReturn;
        position = null;
      }

      peakEquity = Math.max(peakEquity, equity);
      maxDrawdownPct = Math.min(maxDrawdownPct, ((equity / peakEquity) - 1) * 100);
      if (position) continue;
    }

    const f30m = latestFeatureAt(features30m, curr.ts);
    const f1h = latestFeatureAt(features1h, curr.ts);
    const f4h = latestFeatureAt(features4h, curr.ts);
    const f1d = latestFeatureAt(features1d, curr.ts);
    if (!f30m || !f1h || !f4h || (variant.useD1 && !f1d)) continue;

    const longFrames = [
      bullBias(f30m),
      bullBias(f1h),
      bullBias(f4h),
      variant.useD1 ? bullBias(f1d as Feature) : true,
    ];
    const shortFrames = [
      bearBias(f30m),
      bearBias(f1h),
      bearBias(f4h),
      variant.useD1 ? bearBias(f1d as Feature) : true,
    ];
    const longAligned = longFrames.filter(Boolean).length;
    const shortAligned = shortFrames.filter(Boolean).length;

    if (variant.allowLong && longAligned >= variant.minAlignedFrames && (!variant.requireM30Align || bullBias(f30m))) {
      if (variant.allowedHoursUtc && !variant.allowedHoursUtc.includes(hourUtc)) {
        // Skip off-session bars for this variant.
      } else {
      debugDirectionPass += 1;
      const pullbackDepth = ((Math.max(prev.high, prev2.high) - Math.min(prev.low, curr.low)) / Math.max(curr.close, 1e-9)) * 10_000;
      const volumeOk = !variant.requireVolumeLift || curr.volRatio >= variant.minVolumeRatio;
      const vwapOk = !variant.requireVwapReclaim || (curr.close > curr.vwapDay && prev.close <= prev.vwapDay);
      const engulfOk = !variant.requireEngulfing || bullishEngulfing(prev, curr);
      const sweepOk = !variant.requireSweep || (prev.low < prev2.low && curr.close > prev.low);
      const setupOk =
        pullbackDepth >= variant.pullbackDepthBps &&
        curr.close > curr.ema20 &&
        curr.closeLocation >= variant.reclaimCloseLocation &&
        curr.close > curr.open &&
        volumeOk && vwapOk && engulfOk && sweepOk;
      if (setupOk) {
        debugSetupPass += 1;
        const confirm = variant.entryMode === "5m_close"
          ? { ts: curr.ts, price: curr.close }
          : find1mConfirm(curr.ts, curr.ts + (variant.confirmMinutes * 60_000), "long", curr.high);
        if (confirm) {
          debugTriggerPass += 1;
          position = {
            side: "long",
            entryTs: confirm.ts,
            entryPrice: confirm.price,
            stopEnabledTs: confirm.ts + (variant.stopGraceMinutes * 60_000),
            forcedExitTs: confirm.ts + (variant.holdMinutes * 60_000),
            peakPrice: confirm.price,
            troughPrice: confirm.price,
            reason: "Higher timeframe up bias + 5m reversal confirmation",
          };
          continue;
        }
      }
      }
    }

    if (variant.allowShort && shortAligned >= variant.minAlignedFrames && (!variant.requireM30Align || bearBias(f30m))) {
      if (variant.allowedHoursUtc && !variant.allowedHoursUtc.includes(hourUtc)) {
        // Skip off-session bars for this variant.
      } else {
      debugDirectionPass += 1;
      const pullbackDepth = ((Math.max(curr.high, prev.high) - Math.min(prev.low, prev2.low)) / Math.max(curr.close, 1e-9)) * 10_000;
      const volumeOk = !variant.requireVolumeLift || curr.volRatio >= variant.minVolumeRatio;
      const vwapOk = !variant.requireVwapReclaim || (curr.close < curr.vwapDay && prev.close >= prev.vwapDay);
      const engulfOk = !variant.requireEngulfing || bearishEngulfing(prev, curr);
      const sweepOk = !variant.requireSweep || (prev.high > prev2.high && curr.close < prev.high);
      const setupOk =
        pullbackDepth >= variant.pullbackDepthBps &&
        curr.close < curr.ema20 &&
        (1 - curr.closeLocation) >= variant.reclaimCloseLocation &&
        curr.close < curr.open &&
        volumeOk && vwapOk && engulfOk && sweepOk;
      if (setupOk) {
        debugSetupPass += 1;
        const confirm = variant.entryMode === "5m_close"
          ? { ts: curr.ts, price: curr.close }
          : find1mConfirm(curr.ts, curr.ts + (variant.confirmMinutes * 60_000), "short", curr.low);
        if (confirm) {
          debugTriggerPass += 1;
          position = {
            side: "short",
            entryTs: confirm.ts,
            entryPrice: confirm.price,
            stopEnabledTs: confirm.ts + (variant.stopGraceMinutes * 60_000),
            forcedExitTs: confirm.ts + (variant.holdMinutes * 60_000),
            peakPrice: confirm.price,
            troughPrice: confirm.price,
            reason: "Higher timeframe down bias + 5m reversal confirmation",
          };
        }
      }
      }
    }
  }

  if (position) {
    const lastClose = features5m.at(-1)?.close ?? position.entryPrice;
    const closed = closePosition(position, END_TS, lastClose, "end of backtest");
    trades.push(closed.trade);
    equity *= 1 + closed.netReturn;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, ((equity / peakEquity) - 1) * 100);
  }

  const wins = trades.filter((trade) => trade.pnlPct > 0).length;
  const losses = trades.length - wins;
  const grossProfit = trades.filter((trade) => trade.pnlPct > 0).reduce((sum, trade) => sum + trade.pnlPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnlPct <= 0).reduce((sum, trade) => sum + trade.pnlPct, 0));
  const totalDays = Math.max(1, (END_TS - START_TS) / (24 * 60 * 60 * 1000));

  return {
    key: variant.key,
    title: variant.title,
    trades: trades.length,
    tradesPerDay: round(trades.length / totalDays, 3),
    wins,
    winRatePct: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    returnPct: round(((equity / STARTING_EQUITY) - 1) * 100, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : 0,
    avgHoldMinutes: round(average(trades.map((trade) => trade.holdMinutes)), 2),
    avgPnlPct: round(average(trades.map((trade) => trade.pnlPct)), 4),
    debugDirectionPass,
    debugSetupPass,
    debugTriggerPass,
    tradesDetail: trades,
  } satisfies Result;
}

function renderMarkdown(results: Result[]) {
  return [
    "# ASTER/USDT reversal MTF backtest",
    "",
    `- symbol: ${SYMBOL}`,
    `- period: ${new Date(START_TS).toISOString()} -> ${new Date(END_TS).toISOString()}`,
    `- structure: higher timeframe direction only + 5m reversal confirmation + 1m trigger`,
    "",
    "| Variant | Trades | Trades/Day | Win Rate | Return | Max DD | PF | Avg Hold | Dir Pass | Setup Pass | Trigger Pass |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((row) =>
      `| ${row.key} | ${row.trades} | ${row.tradesPerDay.toFixed(3)} | ${row.winRatePct.toFixed(2)}% | ${row.returnPct.toFixed(2)}% | ${row.maxDrawdownPct.toFixed(2)}% | ${row.profitFactor.toFixed(2)} | ${row.avgHoldMinutes.toFixed(2)} | ${row.debugDirectionPass} | ${row.debugSetupPass} | ${row.debugTriggerPass} |`,
    ),
  ].join("\n");
}

async function main() {
  const candles1m = await fetchAsterKlines(SYMBOL, "1m", START_TS, END_TS);
  const candles5m = await fetchAsterKlines(SYMBOL, "5m", START_TS, END_TS);
  const features5m = buildFeatures(candles5m);
  const features30m = buildFeatures(aggregateCandles(candles5m, 6));
  const features1h = buildFeatures(aggregateCandles(candles5m, 12));
  const features4h = buildFeatures(aggregateCandles(candles5m, 48));
  const features1d = buildFeatures(aggregateCandles(candles5m, 288));

  const results = VARIANTS.map((variant) =>
    runVariant(variant, candles1m, features5m, features30m, features1h, features4h, features1d),
  );

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(results, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), renderMarkdown(results), "utf8");
  console.log(renderMarkdown(results));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
