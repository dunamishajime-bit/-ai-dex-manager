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
  volAvg20: number;
  volRatio: number;
  closeLocation: number;
  trendSlopeBps: number;
};

type Side = "long" | "short";

type Variant = {
  key: string;
  title: string;
  invertSignals?: boolean;
  allowLong: boolean;
  allowShort: boolean;
  d1Strict: boolean;
  h4Strict: boolean;
  h1Strict: boolean;
  m30Strict: boolean;
  minAlignedFrames: number;
  requireM30: boolean;
  requireVolumeLift: boolean;
  pullbackLookbackBars: number;
  pullbackTouchBps: number;
  reclaimCloseLocation: number;
  minStackDistanceBps: number;
  confirmMinutes: number;
  holdMinutes: number;
  stopGraceMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  failExitAfterMinutes: number;
  failExitDistanceBps: number;
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
  debugRegimePass: number;
  debugShapePass: number;
  debugBothPass: number;
  trades: number;
  tradesPerDay: number;
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

const REPORT_DIR = path.join(process.cwd(), "reports", "aster-mtf-5m");
const CACHE_DIR = path.join(process.cwd(), ".cache", "aster-mtf-5m");
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
    key: "mtf_quality_long",
    title: "D1/4H/1H/30m aligned long-only quality",
    allowLong: true,
    allowShort: false,
    d1Strict: true,
    h4Strict: true,
    h1Strict: true,
    m30Strict: true,
    minAlignedFrames: 4,
    requireM30: true,
    requireVolumeLift: false,
    pullbackLookbackBars: 6,
    pullbackTouchBps: 18,
    reclaimCloseLocation: 0.56,
    minStackDistanceBps: 8,
    confirmMinutes: 5,
    holdMinutes: 35,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.009,
    trailActivationPct: 0.0055,
    trailRetracePct: 0.0026,
    failExitAfterMinutes: 15,
    failExitDistanceBps: 8,
  },
  {
    key: "mtf_balanced_long",
    title: "D1/4H/1H bullish + 30m trend long-only balanced",
    allowLong: true,
    allowShort: false,
    d1Strict: false,
    h4Strict: true,
    h1Strict: true,
    m30Strict: true,
    minAlignedFrames: 3,
    requireM30: true,
    requireVolumeLift: false,
    pullbackLookbackBars: 8,
    pullbackTouchBps: 24,
    reclaimCloseLocation: 0.54,
    minStackDistanceBps: 6,
    confirmMinutes: 6,
    holdMinutes: 45,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0105,
    trailActivationPct: 0.006,
    trailRetracePct: 0.0028,
    failExitAfterMinutes: 20,
    failExitDistanceBps: 6,
  },
  {
    key: "mtf_quality_dual",
    title: "D1/4H/1H/30m aligned dual-side quality",
    allowLong: true,
    allowShort: true,
    d1Strict: true,
    h4Strict: true,
    h1Strict: true,
    m30Strict: true,
    minAlignedFrames: 4,
    requireM30: true,
    requireVolumeLift: false,
    pullbackLookbackBars: 6,
    pullbackTouchBps: 18,
    reclaimCloseLocation: 0.56,
    minStackDistanceBps: 8,
    confirmMinutes: 5,
    holdMinutes: 35,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.009,
    trailActivationPct: 0.0055,
    trailRetracePct: 0.0026,
    failExitAfterMinutes: 15,
    failExitDistanceBps: 8,
  },
  {
    key: "mtf_active_dual",
    title: "4H/1H/30m aligned active dual-side",
    invertSignals: false,
    allowLong: true,
    allowShort: true,
    d1Strict: false,
    h4Strict: false,
    h1Strict: true,
    m30Strict: true,
    minAlignedFrames: 1,
    requireM30: false,
    requireVolumeLift: false,
    pullbackLookbackBars: 8,
    pullbackTouchBps: 28,
    reclaimCloseLocation: 0.52,
    minStackDistanceBps: 4,
    confirmMinutes: 6,
    holdMinutes: 30,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0085,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
    failExitAfterMinutes: 15,
    failExitDistanceBps: 5,
  },
  {
    key: "mtf_active_dual_inverted",
    title: "4H/1H/30m aligned active dual-side inverted",
    invertSignals: true,
    allowLong: true,
    allowShort: true,
    d1Strict: false,
    h4Strict: false,
    h1Strict: true,
    m30Strict: true,
    minAlignedFrames: 1,
    requireM30: false,
    requireVolumeLift: false,
    pullbackLookbackBars: 8,
    pullbackTouchBps: 28,
    reclaimCloseLocation: 0.52,
    minStackDistanceBps: 4,
    confirmMinutes: 6,
    holdMinutes: 30,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0085,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
    failExitAfterMinutes: 15,
    failExitDistanceBps: 5,
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
  let ema9Prev: number | null = null;
  let ema20Prev: number | null = null;
  let ema50Prev: number | null = null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    ema9Prev = ema(ema9Prev, candle.close, 9);
    ema20Prev = ema(ema20Prev, candle.close, 20);
    ema50Prev = ema(ema50Prev, candle.close, 50);
    const recent = candles.slice(Math.max(0, index - 19), index + 1);
    const volAvg20 = average(recent.map((bar) => bar.volume));
    const range = Math.max(candle.high - candle.low, 1e-9);
    const closeLocation = (candle.close - candle.low) / range;
    const ema20Past = out[Math.max(0, out.length - 4)]?.ema20 ?? ema20Prev;
    const trendSlopeBps = ((ema20Prev - ema20Past) / Math.max(ema20Past, 1e-9)) * 10_000;

    out.push({
      ...candle,
      ema9: ema9Prev,
      ema20: ema20Prev,
      ema50: ema50Prev,
      volAvg20,
      volRatio: candle.volume / Math.max(volAvg20, 1e-9),
      closeLocation,
      trendSlopeBps,
    });
  }

  return out;
}

function stackBull(feature: Feature, strict: boolean) {
  return strict
    ? feature.close > feature.ema20 && feature.ema20 > feature.ema50 && feature.trendSlopeBps > 0
    : feature.ema20 > feature.ema50 && feature.trendSlopeBps >= -2;
}

function stackBear(feature: Feature, strict: boolean) {
  return strict
    ? feature.close < feature.ema20 && feature.ema20 < feature.ema50 && feature.trendSlopeBps < 0
    : feature.ema20 < feature.ema50 && feature.trendSlopeBps <= 2;
}

function alignedBullCount(input: { f1d: Feature; f4h: Feature; f1h: Feature; f30m: Feature; variant: Variant }) {
  const { f1d, f4h, f1h, f30m, variant } = input;
  const flags = [
    stackBull(f1d, variant.d1Strict),
    stackBull(f4h, variant.h4Strict),
    stackBull(f1h, variant.h1Strict),
    stackBull(f30m, variant.m30Strict),
  ];
  return flags.filter(Boolean).length;
}

function alignedBearCount(input: { f1d: Feature; f4h: Feature; f1h: Feature; f30m: Feature; variant: Variant }) {
  const { f1d, f4h, f1h, f30m, variant } = input;
  const flags = [
    stackBear(f1d, variant.d1Strict),
    stackBear(f4h, variant.h4Strict),
    stackBear(f1h, variant.h1Strict),
    stackBear(f30m, variant.m30Strict),
  ];
  return flags.filter(Boolean).length;
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

function runVariant(
  variant: Variant,
  _candles1m: Candle[],
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
  let debugRegimePass = 0;
  let debugShapePass = 0;
  let debugBothPass = 0;

  for (let index = 20; index < features5m.length; index += 1) {
    const feature5m = features5m[index];

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
        const closed = closePosition(
          position,
          feature5m.ts,
          position.side === "long" ? position.entryPrice * (1 - variant.stopLossPct) : position.entryPrice * (1 + variant.stopLossPct),
          "stop loss",
        );
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
      maxDrawdownPct = Math.min(maxDrawdownPct, ((equity / peakEquity) - 1) * 100);
      if (position) continue;
    }

    const f30m = latestFeatureAt(features30m, feature5m.ts);
    const f1h = latestFeatureAt(features1h, feature5m.ts);
    const f4h = latestFeatureAt(features4h, feature5m.ts);
    const f1d = latestFeatureAt(features1d, feature5m.ts);
    if (!f30m || !f1h || !f4h || !f1d) continue;

    const lookback = features5m.slice(Math.max(0, index - variant.pullbackLookbackBars + 1), index + 1);
    const priorSwing = lookback.slice(0, -1);
    const pullbackTouchedLong = lookback.slice(0, -1).some((bar) => bar.low <= bar.ema20 * (1 + (variant.pullbackTouchBps / 10_000)));
    const pullbackTouchedShort = lookback.slice(0, -1).some((bar) => bar.high >= bar.ema20 * (1 - (variant.pullbackTouchBps / 10_000)));
    const stackDistanceBps = ((feature5m.ema20 - feature5m.ema50) / Math.max(feature5m.ema50, 1e-9)) * 10_000;
    const prior = features5m[index - 1];
    let nextPosition: Position | null = null;

    if (variant.allowLong) {
      const bullCount = alignedBullCount({ f1d, f4h, f1h, f30m, variant });
      const regimeOk =
        bullCount >= variant.minAlignedFrames &&
        (!variant.requireM30 || stackBull(f30m, variant.m30Strict));
      const volumeOk = !variant.requireVolumeLift || feature5m.volRatio >= 1.03;
      const entryShapeOk =
        feature5m.ema20 > feature5m.ema50 &&
        stackDistanceBps >= variant.minStackDistanceBps &&
        (pullbackTouchedLong || prior.low <= prior.ema20 * (1 + (variant.pullbackTouchBps / 10_000))) &&
        feature5m.close > feature5m.ema20 &&
        prior.close <= prior.ema20 * 1.003 &&
        feature5m.close > prior.high &&
        feature5m.closeLocation >= variant.reclaimCloseLocation &&
        feature5m.close > feature5m.open;
      if (regimeOk) debugRegimePass += 1;
      if (entryShapeOk) debugShapePass += 1;
      if (regimeOk && entryShapeOk) debugBothPass += 1;
      if (regimeOk && volumeOk && entryShapeOk) {
        const side: Side = variant.invertSignals ? "short" : "long";
        nextPosition = {
          side,
          entryTs: feature5m.ts,
          entryPrice: feature5m.close,
          stopEnabledTs: feature5m.ts + (variant.stopGraceMinutes * 60_000),
          forcedExitTs: feature5m.ts + (variant.holdMinutes * 60_000),
          failExitTs: feature5m.ts + (variant.failExitAfterMinutes * 60_000),
          peakPrice: feature5m.close,
          troughPrice: feature5m.close,
          reason: variant.invertSignals
            ? "INVERTED: MTF bullish regime + 5m pullback reclaim"
            : "MTF bullish regime + 5m pullback reclaim",
        };
      }
    }

    if (!nextPosition && variant.allowShort) {
      const bearCount = alignedBearCount({ f1d, f4h, f1h, f30m, variant });
      const regimeOk =
        bearCount >= variant.minAlignedFrames &&
        (!variant.requireM30 || stackBear(f30m, variant.m30Strict));
      const volumeOk = !variant.requireVolumeLift || feature5m.volRatio >= 1.03;
      const entryShapeOk =
        feature5m.ema20 < feature5m.ema50 &&
        stackDistanceBps <= -variant.minStackDistanceBps &&
        (pullbackTouchedShort || prior.high >= prior.ema20 * (1 - (variant.pullbackTouchBps / 10_000))) &&
        feature5m.close < feature5m.ema20 &&
        prior.close >= prior.ema20 * 0.997 &&
        feature5m.close < prior.low &&
        (1 - feature5m.closeLocation) >= variant.reclaimCloseLocation &&
        feature5m.close < feature5m.open;
      if (regimeOk) debugRegimePass += 1;
      if (entryShapeOk) debugShapePass += 1;
      if (regimeOk && entryShapeOk) debugBothPass += 1;
      if (regimeOk && volumeOk && entryShapeOk) {
        const side: Side = variant.invertSignals ? "long" : "short";
        nextPosition = {
          side,
          entryTs: feature5m.ts,
          entryPrice: feature5m.close,
          stopEnabledTs: feature5m.ts + (variant.stopGraceMinutes * 60_000),
          forcedExitTs: feature5m.ts + (variant.holdMinutes * 60_000),
          failExitTs: feature5m.ts + (variant.failExitAfterMinutes * 60_000),
          peakPrice: feature5m.close,
          troughPrice: feature5m.close,
          reason: variant.invertSignals
            ? "INVERTED: MTF bearish regime + 5m pullback reclaim"
            : "MTF bearish regime + 5m pullback reclaim",
        };
      }
    }

    if (!nextPosition) continue;
    position = nextPosition;
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
  const losses = trades.filter((trade) => trade.pnlPct <= 0).length;
  const grossProfit = trades.filter((trade) => trade.pnlPct > 0).reduce((sum, trade) => sum + trade.pnlPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnlPct <= 0).reduce((sum, trade) => sum + trade.pnlPct, 0));
  const totalDays = Math.max(1, (END_TS - START_TS) / (24 * 60 * 60 * 1000));

  return {
    key: variant.key,
    title: variant.title,
    debugRegimePass,
    debugShapePass,
    debugBothPass,
    trades: trades.length,
    tradesPerDay: round(trades.length / totalDays, 3),
    wins,
    losses,
    winRatePct: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    endEquity: round(equity, 2),
    returnPct: round(((equity / STARTING_EQUITY) - 1) * 100, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : 0,
    avgPnlPct: round(average(trades.map((trade) => trade.pnlPct)), 4),
    avgHoldMinutes: round(average(trades.map((trade) => trade.holdMinutes)), 2),
    tradesDetail: trades,
  } satisfies VariantResult;
}

function renderMarkdown(results: VariantResult[]) {
  return [
    "# ASTER/USDT MTF 5m backtest",
    "",
    `- symbol: ${SYMBOL}`,
    `- period: ${new Date(START_TS).toISOString()} -> ${new Date(END_TS).toISOString()}`,
    `- structure: D1 / 4H / 1H / 30m regime -> 5m setup -> 1m trigger -> 15m to 1H exit`,
    "",
    "| Variant | Trades | Trades / Day | Win Rate | Return | Max DD | PF | Avg Hold (m) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((result) =>
      `| ${result.key} | ${result.trades} | ${result.tradesPerDay.toFixed(3)} | ${result.winRatePct.toFixed(2)}% | ${result.returnPct.toFixed(2)}% | ${result.maxDrawdownPct.toFixed(2)}% | ${result.profitFactor.toFixed(2)} | ${result.avgHoldMinutes.toFixed(2)} |`,
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

  const variants = VARIANT_FILTER.size
    ? VARIANTS.filter((variant) => VARIANT_FILTER.has(variant.key))
    : VARIANTS;
  const results = variants.map((variant) => runVariant(variant, candles1m, features5m, features30m, features1h, features4h, features1d));

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(results, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), renderMarkdown(results), "utf8");
  console.log(renderMarkdown(results));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
