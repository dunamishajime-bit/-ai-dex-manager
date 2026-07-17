import fs from "fs/promises";
import path from "path";

import { fetchBinanceKlines } from "../lib/backtest/binance-source";
import type { Candle1h } from "../lib/backtest/types";

type Candle5m = Candle1h;

type FeatureRow = {
  ts: number;
  iso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  ema20: number;
  ema48: number;
  ema96: number;
  vwapDay: number;
  volAvg20: number;
  volRatio: number;
  move3Bps: number;
  move6Bps: number;
  move12Bps: number;
  accel3Bps: number;
  closeLocation: number;
  overheatPct: number;
};

type RegimeLabel = "risk_on_up" | "risk_on_pullback" | "range_neutral" | "risk_off_down";

type RegimeRow = FeatureRow & {
  regime: RegimeLabel;
};

type Variant = {
  key: string;
  title: string;
  minScore: number;
  moveThresholdBps: number;
  accelThresholdBps: number;
  minVolumeRatio: number;
  minQuoteVolume: number;
  maxOverheatPct: number;
  minCloseLocation: number;
  requireBothRiskOn: boolean;
  allowLong: boolean;
  allowShort: boolean;
  requireTrendStack: boolean;
  longRequiresRiskOnUp?: boolean;
  minLeaderMove3Bps?: number;
  allowedLongHoursUtc?: number[];
  allowedShortHoursUtc?: number[];
  allowedLongWeekdaysUtc?: number[];
  allowedShortWeekdaysUtc?: number[];
  cooldownBarsAfterLoss?: number;
  maxMove12Bps?: number;
  stopLossPct: number;
  takeProfitPct: number;
  timeStopBars: number;
  trailActivationPct: number;
  trailRetracePct: number;
  failExitMinBars: number;
};

type Trade = {
  side: "long" | "short";
  entryTs: number;
  exitTs: number;
  entryIso: string;
  exitIso: string;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  holdBars: number;
  exitReason: string;
  score: number;
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
  avgHoldMinutes: number;
  avgPnlPct: number;
  tradesDetail: Trade[];
};

const REPORT_DIR = path.join(process.cwd(), "reports", "asterdex-pengu-5m-updown");
const CACHE_DIR = path.join(process.cwd(), ".cache", "asterdex-pengu-5m-updown");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 5, 4, 0, 0, 0, 0);
const STARTING_EQUITY = 10_000;
const FEE_RATE = 0.001;
const SLIPPAGE_RATE = 0.0005;
const BAR_MS = 5 * 60 * 1000;

const VARIANTS: Variant[] = [
  {
    key: "goldcat_port_base",
    title: "GoldCat port base",
    minScore: 72,
    moveThresholdBps: 38,
    accelThresholdBps: 8,
    minVolumeRatio: 1.2,
    minQuoteVolume: 800_000,
    maxOverheatPct: 0.04,
    minCloseLocation: 0.58,
    requireBothRiskOn: false,
    allowLong: true,
    allowShort: false,
    requireTrendStack: false,
    stopLossPct: 0.008,
    takeProfitPct: 0.016,
    timeStopBars: 6,
    trailActivationPct: 0.012,
    trailRetracePct: 0.005,
    failExitMinBars: 2,
  },
  {
    key: "goldcat_port_strict",
    title: "GoldCat port strict",
    minScore: 78,
    moveThresholdBps: 45,
    accelThresholdBps: 10,
    minVolumeRatio: 1.35,
    minQuoteVolume: 1_100_000,
    maxOverheatPct: 0.035,
    minCloseLocation: 0.6,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: false,
    requireTrendStack: true,
    maxMove12Bps: 260,
    stopLossPct: 0.008,
    takeProfitPct: 0.018,
    timeStopBars: 6,
    trailActivationPct: 0.013,
    trailRetracePct: 0.005,
    failExitMinBars: 2,
  },
  {
    key: "goldcat_port_fast_exit",
    title: "GoldCat port fast exit",
    minScore: 70,
    moveThresholdBps: 35,
    accelThresholdBps: 7,
    minVolumeRatio: 1.15,
    minQuoteVolume: 700_000,
    maxOverheatPct: 0.045,
    minCloseLocation: 0.56,
    requireBothRiskOn: false,
    allowLong: true,
    allowShort: false,
    requireTrendStack: false,
    stopLossPct: 0.0075,
    takeProfitPct: 0.013,
    timeStopBars: 4,
    trailActivationPct: 0.01,
    trailRetracePct: 0.0045,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack",
    title: "GoldCat port trend stack",
    minScore: 84,
    moveThresholdBps: 52,
    accelThresholdBps: 12,
    minVolumeRatio: 1.45,
    minQuoteVolume: 1_400_000,
    maxOverheatPct: 0.028,
    minCloseLocation: 0.62,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: false,
    requireTrendStack: true,
    maxMove12Bps: 220,
    stopLossPct: 0.007,
    takeProfitPct: 0.018,
    timeStopBars: 4,
    trailActivationPct: 0.012,
    trailRetracePct: 0.004,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_selective",
    title: "GoldCat port selective",
    minScore: 88,
    moveThresholdBps: 60,
    accelThresholdBps: 14,
    minVolumeRatio: 1.6,
    minQuoteVolume: 2_000_000,
    maxOverheatPct: 0.025,
    minCloseLocation: 0.65,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: false,
    requireTrendStack: true,
    maxMove12Bps: 180,
    stopLossPct: 0.0065,
    takeProfitPct: 0.016,
    timeStopBars: 3,
    trailActivationPct: 0.01,
    trailRetracePct: 0.0035,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_strict_ls",
    title: "GoldCat port strict long-short",
    minScore: 78,
    moveThresholdBps: 45,
    accelThresholdBps: 10,
    minVolumeRatio: 1.35,
    minQuoteVolume: 1_100_000,
    maxOverheatPct: 0.035,
    minCloseLocation: 0.6,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: true,
    requireTrendStack: true,
    maxMove12Bps: 260,
    stopLossPct: 0.008,
    takeProfitPct: 0.018,
    timeStopBars: 6,
    trailActivationPct: 0.013,
    trailRetracePct: 0.005,
    failExitMinBars: 2,
  },
  {
    key: "goldcat_port_trend_stack_ls",
    title: "GoldCat port trend stack long-short",
    minScore: 84,
    moveThresholdBps: 52,
    accelThresholdBps: 12,
    minVolumeRatio: 1.45,
    minQuoteVolume: 1_400_000,
    maxOverheatPct: 0.028,
    minCloseLocation: 0.62,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: true,
    requireTrendStack: true,
    maxMove12Bps: 220,
    stopLossPct: 0.007,
    takeProfitPct: 0.018,
    timeStopBars: 4,
    trailActivationPct: 0.012,
    trailRetracePct: 0.004,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_ls_tuned",
    title: "GoldCat port trend stack long-short tuned",
    minScore: 86,
    moveThresholdBps: 55,
    accelThresholdBps: 12,
    minVolumeRatio: 1.5,
    minQuoteVolume: 1_600_000,
    maxOverheatPct: 0.026,
    minCloseLocation: 0.64,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: true,
    requireTrendStack: true,
    maxMove12Bps: 180,
    stopLossPct: 0.0065,
    takeProfitPct: 0.015,
    timeStopBars: 3,
    trailActivationPct: 0.01,
    trailRetracePct: 0.0035,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_short_only",
    title: "GoldCat port trend stack short only",
    minScore: 84,
    moveThresholdBps: 52,
    accelThresholdBps: 12,
    minVolumeRatio: 1.45,
    minQuoteVolume: 1_400_000,
    maxOverheatPct: 0.028,
    minCloseLocation: 0.62,
    requireBothRiskOn: true,
    allowLong: false,
    allowShort: true,
    requireTrendStack: true,
    maxMove12Bps: 220,
    stopLossPct: 0.007,
    takeProfitPct: 0.018,
    timeStopBars: 4,
    trailActivationPct: 0.012,
    trailRetracePct: 0.004,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_short_only_tuned",
    title: "GoldCat port trend stack short only tuned",
    minScore: 86,
    moveThresholdBps: 55,
    accelThresholdBps: 12,
    minVolumeRatio: 1.5,
    minQuoteVolume: 1_600_000,
    maxOverheatPct: 0.026,
    minCloseLocation: 0.64,
    requireBothRiskOn: true,
    allowLong: false,
    allowShort: true,
    requireTrendStack: true,
    minLeaderMove3Bps: 10,
    maxMove12Bps: 180,
    stopLossPct: 0.0065,
    takeProfitPct: 0.015,
    timeStopBars: 3,
    trailActivationPct: 0.01,
    trailRetracePct: 0.0035,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_ls_up_only",
    title: "GoldCat port trend stack long-short up only",
    minScore: 86,
    moveThresholdBps: 55,
    accelThresholdBps: 12,
    minVolumeRatio: 1.5,
    minQuoteVolume: 1_600_000,
    maxOverheatPct: 0.026,
    minCloseLocation: 0.64,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: true,
    requireTrendStack: true,
    longRequiresRiskOnUp: true,
    minLeaderMove3Bps: 10,
    maxMove12Bps: 180,
    stopLossPct: 0.0065,
    takeProfitPct: 0.015,
    timeStopBars: 3,
    trailActivationPct: 0.01,
    trailRetracePct: 0.0035,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_ls_up_only_cooldown",
    title: "GoldCat port trend stack long-short up only cooldown",
    minScore: 88,
    moveThresholdBps: 58,
    accelThresholdBps: 13,
    minVolumeRatio: 1.55,
    minQuoteVolume: 1_750_000,
    maxOverheatPct: 0.024,
    minCloseLocation: 0.66,
    requireBothRiskOn: true,
    allowLong: true,
    allowShort: true,
    requireTrendStack: true,
    longRequiresRiskOnUp: true,
    minLeaderMove3Bps: 12,
    cooldownBarsAfterLoss: 36,
    maxMove12Bps: 170,
    stopLossPct: 0.006,
    takeProfitPct: 0.014,
    timeStopBars: 3,
    trailActivationPct: 0.009,
    trailRetracePct: 0.0035,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_short_only_hours",
    title: "GoldCat port trend stack short only hour window",
    minScore: 84,
    moveThresholdBps: 52,
    accelThresholdBps: 12,
    minVolumeRatio: 1.45,
    minQuoteVolume: 1_400_000,
    maxOverheatPct: 0.028,
    minCloseLocation: 0.62,
    requireBothRiskOn: true,
    allowLong: false,
    allowShort: true,
    requireTrendStack: true,
    allowedShortHoursUtc: [14, 15, 16, 19],
    maxMove12Bps: 220,
    stopLossPct: 0.007,
    takeProfitPct: 0.018,
    timeStopBars: 4,
    trailActivationPct: 0.012,
    trailRetracePct: 0.004,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_short_only_hours_days",
    title: "GoldCat port trend stack short only hour and weekday window",
    minScore: 84,
    moveThresholdBps: 52,
    accelThresholdBps: 12,
    minVolumeRatio: 1.45,
    minQuoteVolume: 1_400_000,
    maxOverheatPct: 0.028,
    minCloseLocation: 0.62,
    requireBothRiskOn: true,
    allowLong: false,
    allowShort: true,
    requireTrendStack: true,
    allowedShortHoursUtc: [14, 15, 16, 19],
    allowedShortWeekdaysUtc: [2, 3, 6],
    maxMove12Bps: 220,
    stopLossPct: 0.007,
    takeProfitPct: 0.018,
    timeStopBars: 4,
    trailActivationPct: 0.012,
    trailRetracePct: 0.004,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_short_only_us_core",
    title: "GoldCat port trend stack short only US core",
    minScore: 84,
    moveThresholdBps: 52,
    accelThresholdBps: 12,
    minVolumeRatio: 1.45,
    minQuoteVolume: 1_400_000,
    maxOverheatPct: 0.028,
    minCloseLocation: 0.62,
    requireBothRiskOn: true,
    allowLong: false,
    allowShort: true,
    requireTrendStack: true,
    allowedShortHoursUtc: [14, 15, 16, 17, 18, 19, 20],
    maxMove12Bps: 220,
    stopLossPct: 0.007,
    takeProfitPct: 0.018,
    timeStopBars: 4,
    trailActivationPct: 0.012,
    trailRetracePct: 0.004,
    failExitMinBars: 1,
  },
  {
    key: "goldcat_port_trend_stack_short_only_us_open",
    title: "GoldCat port trend stack short only US open",
    minScore: 84,
    moveThresholdBps: 52,
    accelThresholdBps: 12,
    minVolumeRatio: 1.45,
    minQuoteVolume: 1_400_000,
    maxOverheatPct: 0.028,
    minCloseLocation: 0.62,
    requireBothRiskOn: true,
    allowLong: false,
    allowShort: true,
    requireTrendStack: true,
    allowedShortHoursUtc: [14, 15, 16],
    maxMove12Bps: 220,
    stopLossPct: 0.007,
    takeProfitPct: 0.018,
    timeStopBars: 4,
    trailActivationPct: 0.012,
    trailRetracePct: 0.004,
    failExitMinBars: 1,
  },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function iso(ts: number) {
  return new Date(ts).toISOString();
}

async function loadCachedSymbol(symbol: string) {
  const filePath = path.join(CACHE_DIR, `${symbol}-${START_TS}-${END_TS}-5m.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Candle5m[];
  } catch {
    const candles = await fetchBinanceKlines(symbol, START_TS, END_TS, "5m");
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function ema(prev: number | null, value: number, period: number) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : (value * alpha) + (prev * (1 - alpha));
}

function buildFeatures(candles: Candle5m[]): FeatureRow[] {
  const out: FeatureRow[] = [];
  let ema20: number | null = null;
  let ema48: number | null = null;
  let ema96: number | null = null;
  let dayKey = "";
  let dayPv = 0;
  let dayVol = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    ema20 = ema(ema20, candle.close, 20);
    ema48 = ema(ema48, candle.close, 48);
    ema96 = ema(ema96, candle.close, 96);

    const currentDayKey = new Date(candle.ts).toISOString().slice(0, 10);
    if (currentDayKey !== dayKey) {
      dayKey = currentDayKey;
      dayPv = 0;
      dayVol = 0;
    }

    const typical = (candle.high + candle.low + candle.close) / 3;
    dayPv += typical * candle.volume;
    dayVol += candle.volume;

    const prev3 = index >= 3 ? candles[index - 3] : null;
    const prev6 = index >= 6 ? candles[index - 6] : null;
    const prev12 = index >= 12 ? candles[index - 12] : null;
    const move3Bps = prev3 ? ((candle.close / prev3.close) - 1) * 10_000 : 0;
    const move6Bps = prev6 ? ((candle.close / prev6.close) - 1) * 10_000 : 0;
    const move12Bps = prev12 ? ((candle.close / prev12.close) - 1) * 10_000 : 0;
    const prevMove3Bps = index >= 6 ? (((candles[index - 3].close / candles[index - 6].close) - 1) * 10_000) : 0;
    const accel3Bps = move3Bps - prevMove3Bps;
    const closeLocationDenom = Math.max(candle.high - candle.low, 1e-9);
    const closeLocation = (candle.close - candle.low) / closeLocationDenom;
    const volWindow = candles.slice(Math.max(0, index - 19), index + 1);
    const volAvg20 = volWindow.reduce((sum, row) => sum + row.volume, 0) / volWindow.length;
    const quoteVolume = candle.close * candle.volume;

    out.push({
      ts: candle.ts,
      iso: iso(candle.ts),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      quoteVolume,
      ema20: ema20 ?? candle.close,
      ema48: ema48 ?? candle.close,
      ema96: ema96 ?? candle.close,
      vwapDay: dayVol > 0 ? dayPv / dayVol : candle.close,
      volAvg20,
      volRatio: volAvg20 > 0 ? candle.volume / volAvg20 : 0,
      move3Bps,
      move6Bps,
      move12Bps,
      accel3Bps,
      closeLocation,
      overheatPct: ema48 ? (candle.close / ema48) - 1 : 0,
    });
  }

  return out;
}

function classifyRegime(row: FeatureRow): RegimeLabel {
  if (row.close < row.vwapDay && row.ema20 < row.ema48 && row.move6Bps < -15) return "risk_off_down";
  if (row.close > row.vwapDay && row.ema20 > row.ema48 && row.move6Bps > 15 && row.volRatio >= 0.9) return "risk_on_up";
  if (row.close > row.ema48 && row.move12Bps > 0) return "risk_on_pullback";
  return "range_neutral";
}

function alignByTs(base: FeatureRow[], reference: FeatureRow[]) {
  const refMap = new Map(reference.map((row) => [row.ts, row]));
  return base
    .map((row) => {
      const match = refMap.get(row.ts);
      return match ? { base: row, ref: match } : null;
    })
    .filter((row): row is { base: FeatureRow; ref: FeatureRow } => row != null);
}

function scoreEntry(
  pengu: FeatureRow,
  btc: RegimeRow,
  eth: RegimeRow,
  variant: Variant,
  side: "long" | "short",
) {
  const moveMagnitude = side === "long" ? pengu.move3Bps : -pengu.move3Bps;
  const accelMagnitude = side === "long" ? pengu.accel3Bps : -pengu.accel3Bps;
  const moveScore = Math.min(Math.max(moveMagnitude, 0) / Math.max(variant.moveThresholdBps, 1), 2.5) * 24;
  const accelScore = Math.min(Math.max(accelMagnitude, 0) / Math.max(variant.accelThresholdBps, 1), 2.5) * 18;
  const volumeScore = Math.min(pengu.volRatio / Math.max(variant.minVolumeRatio, 0.01), 2) * 14;
  const quoteScore = Math.min(pengu.quoteVolume / Math.max(variant.minQuoteVolume, 1), 2) * 12;
  const locationValue = side === "long" ? pengu.closeLocation : (1 - pengu.closeLocation);
  const locationScore = Math.min(locationValue / Math.max(variant.minCloseLocation, 0.01), 1.5) * 10;
  const timeScore = side === "long"
    ? (pengu.move6Bps > pengu.move3Bps && pengu.accel3Bps <= 0 ? -8 : 8)
    : (-pengu.move6Bps > -pengu.move3Bps && pengu.accel3Bps >= 0 ? -8 : 8);
  const overheatPenalty = pengu.overheatPct > variant.maxOverheatPct
    ? Math.min(((pengu.overheatPct - variant.maxOverheatPct) / 0.01) * 20, 35)
    : 0;
  const regimeScore = side === "long"
    ? (
      (btc.regime === "risk_on_up" ? 12 : btc.regime === "risk_on_pullback" ? 5 : btc.regime === "risk_off_down" ? -18 : 0) +
      (eth.regime === "risk_on_up" ? 12 : eth.regime === "risk_on_pullback" ? 5 : eth.regime === "risk_off_down" ? -18 : 0)
    )
    : (
      (btc.regime === "risk_off_down" ? 14 : btc.regime === "range_neutral" ? 4 : -10) +
      (eth.regime === "risk_off_down" ? 14 : eth.regime === "range_neutral" ? 4 : -10)
    );

  return moveScore + accelScore + volumeScore + quoteScore + locationScore + timeScore + regimeScore - overheatPenalty;
}

function hourAllowed(ts: number, allowedHoursUtc?: number[]) {
  if (!allowedHoursUtc?.length) return true;
  return allowedHoursUtc.includes(new Date(ts).getUTCHours());
}

function weekdayAllowed(ts: number, allowedWeekdaysUtc?: number[]) {
  if (!allowedWeekdaysUtc?.length) return true;
  return allowedWeekdaysUtc.includes(new Date(ts).getUTCDay());
}

function runVariant(penguRows: FeatureRow[], btcRows: RegimeRow[], ethRows: RegimeRow[], variant: Variant): VariantResult {
  const btcMap = new Map(btcRows.map((row) => [row.ts, row]));
  const ethMap = new Map(ethRows.map((row) => [row.ts, row]));
  const trades: Trade[] = [];
  let equity = STARTING_EQUITY;
  let peakEquity = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let cooldownUntilIndex = -1;
  let position: null | { side: "long" | "short"; entryIndex: number; entryPrice: number; entryTs: number; peakPrice: number; troughPrice: number; score: number } = null;

  for (let index = 96; index < penguRows.length; index += 1) {
    const pengu = penguRows[index];
    const btc = btcMap.get(pengu.ts);
    const eth = ethMap.get(pengu.ts);
    if (!btc || !eth) continue;

    if (position) {
      const holdBars = index - position.entryIndex;
      position.peakPrice = Math.max(position.peakPrice, pengu.high);
      position.troughPrice = Math.min(position.troughPrice, pengu.low);
      const isLong = position.side === "long";
      const hardStop = isLong
        ? position.entryPrice * (1 - variant.stopLossPct)
        : position.entryPrice * (1 + variant.stopLossPct);
      const takeProfit = isLong
        ? position.entryPrice * (1 + variant.takeProfitPct)
        : position.entryPrice * (1 - variant.takeProfitPct);
      const trailStop = isLong
        ? (position.peakPrice >= position.entryPrice * (1 + variant.trailActivationPct)
          ? position.peakPrice * (1 - variant.trailRetracePct)
          : null)
        : (position.troughPrice <= position.entryPrice * (1 - variant.trailActivationPct)
          ? position.troughPrice * (1 + variant.trailRetracePct)
          : null);
      const failureExit = holdBars >= variant.failExitMinBars && (
        isLong
          ? (pengu.close < pengu.vwapDay && pengu.move3Bps < 0 && (btc.regime === "range_neutral" || btc.regime === "risk_off_down" || eth.regime === "risk_off_down"))
          : (pengu.close > pengu.vwapDay && pengu.move3Bps > 0 && (btc.regime === "range_neutral" || btc.regime === "risk_on_up" || eth.regime === "risk_on_up"))
      );

      let exitPrice: number | null = null;
      let exitReason = "";
      if (isLong && pengu.low <= hardStop) {
        exitPrice = hardStop;
        exitReason = "hard-stop";
      } else if (!isLong && pengu.high >= hardStop) {
        exitPrice = hardStop;
        exitReason = "hard-stop";
      } else if (trailStop != null && ((isLong && pengu.low <= trailStop) || (!isLong && pengu.high >= trailStop))) {
        exitPrice = trailStop;
        exitReason = "trail-stop";
      } else if ((isLong && pengu.high >= takeProfit) || (!isLong && pengu.low <= takeProfit)) {
        exitPrice = takeProfit;
        exitReason = "take-profit";
      } else if (failureExit) {
        exitPrice = pengu.close;
        exitReason = "failure-exit";
      } else if (holdBars >= variant.timeStopBars) {
        exitPrice = pengu.close;
        exitReason = "time-stop";
      }

      if (exitPrice != null) {
        const grossMove = isLong
          ? ((exitPrice / position.entryPrice) - 1)
          : ((position.entryPrice / exitPrice) - 1);
        const pnlPct = grossMove - (FEE_RATE * 2) - (SLIPPAGE_RATE * 2);
        equity *= 1 + pnlPct;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peakEquity) - 1);
        trades.push({
          side: position.side,
          entryTs: position.entryTs,
          exitTs: pengu.ts,
          entryIso: iso(position.entryTs),
          exitIso: pengu.iso,
          entryPrice: position.entryPrice,
          exitPrice,
          pnlPct,
          holdBars,
          exitReason,
          score: position.score,
        });
        if (pnlPct <= 0 && variant.cooldownBarsAfterLoss != null) {
          cooldownUntilIndex = index + variant.cooldownBarsAfterLoss;
        }
        position = null;
      }
      continue;
    }

    if (index < cooldownUntilIndex) continue;

    const btcRiskOn = btc.regime === "risk_on_up" || btc.regime === "risk_on_pullback";
    const ethRiskOn = eth.regime === "risk_on_up" || eth.regime === "risk_on_pullback";
    const blockedByRegime = btc.regime === "risk_off_down" || eth.regime === "risk_off_down";
    const strictLongRegime = variant.longRequiresRiskOnUp
      ? (btc.regime === "risk_on_up" && eth.regime === "risk_on_up")
      : (variant.requireBothRiskOn ? (btcRiskOn && ethRiskOn) : (btcRiskOn || ethRiskOn));
    const leaderMoveLongOk = variant.minLeaderMove3Bps == null || (btc.move3Bps >= variant.minLeaderMove3Bps && eth.move3Bps >= variant.minLeaderMove3Bps);
    const canLong = variant.allowLong && !blockedByRegime && strictLongRegime && leaderMoveLongOk;
    const btcRiskOff = btc.regime === "risk_off_down";
    const ethRiskOff = eth.regime === "risk_off_down";
    const leaderMoveShortOk = variant.minLeaderMove3Bps == null || (btc.move3Bps <= -variant.minLeaderMove3Bps && eth.move3Bps <= -variant.minLeaderMove3Bps);
    const canShort = variant.allowShort && (variant.requireBothRiskOn ? (btcRiskOff && ethRiskOff) : (btcRiskOff || ethRiskOff)) && leaderMoveShortOk;

    let selectedSide: "long" | "short" | null = null;
    let score = -Infinity;

    if (canLong) {
      const longOk =
        hourAllowed(pengu.ts, variant.allowedLongHoursUtc) &&
        weekdayAllowed(pengu.ts, variant.allowedLongWeekdaysUtc) &&
        Math.abs(pengu.move3Bps) >= variant.moveThresholdBps &&
        (variant.maxMove12Bps == null || pengu.move12Bps <= variant.maxMove12Bps) &&
        pengu.accel3Bps >= variant.accelThresholdBps &&
        pengu.volRatio >= variant.minVolumeRatio &&
        pengu.quoteVolume >= variant.minQuoteVolume &&
        pengu.overheatPct <= variant.maxOverheatPct &&
        pengu.closeLocation >= variant.minCloseLocation &&
        pengu.close >= pengu.vwapDay &&
        pengu.ema20 >= pengu.ema48 &&
        pengu.move6Bps > 0 &&
        (!variant.requireTrendStack || (pengu.close > pengu.ema96 && btc.close > btc.ema96 && eth.close > eth.ema96));
      if (longOk) {
        const longScore = scoreEntry(pengu, btc, eth, variant, "long");
        if (longScore >= variant.minScore) {
          selectedSide = "long";
          score = longScore;
        }
      }
    }

    if (canShort) {
      const shortOk =
        hourAllowed(pengu.ts, variant.allowedShortHoursUtc) &&
        weekdayAllowed(pengu.ts, variant.allowedShortWeekdaysUtc) &&
        Math.abs(pengu.move3Bps) >= variant.moveThresholdBps &&
        (variant.maxMove12Bps == null || -pengu.move12Bps <= variant.maxMove12Bps) &&
        -pengu.accel3Bps >= variant.accelThresholdBps &&
        pengu.volRatio >= variant.minVolumeRatio &&
        pengu.quoteVolume >= variant.minQuoteVolume &&
        Math.abs(pengu.overheatPct) <= variant.maxOverheatPct &&
        (1 - pengu.closeLocation) >= variant.minCloseLocation &&
        pengu.close <= pengu.vwapDay &&
        pengu.ema20 <= pengu.ema48 &&
        pengu.move6Bps < 0 &&
        (!variant.requireTrendStack || (pengu.close < pengu.ema96 && btc.close < btc.ema96 && eth.close < eth.ema96));
      if (shortOk) {
        const shortScore = scoreEntry(pengu, btc, eth, variant, "short");
        if (shortScore >= variant.minScore && shortScore > score) {
          selectedSide = "short";
          score = shortScore;
        }
      }
    }

    if (!selectedSide) continue;

    position = {
      side: selectedSide,
      entryIndex: index,
      entryPrice: pengu.close,
      entryTs: pengu.ts,
      peakPrice: pengu.close,
      troughPrice: pengu.close,
      score,
    };
  }

  if (position) {
    const last = penguRows.at(-1)!;
    const grossMove = position.side === "long"
      ? ((last.close / position.entryPrice) - 1)
      : ((position.entryPrice / last.close) - 1);
    const pnlPct = grossMove - (FEE_RATE * 2) - (SLIPPAGE_RATE * 2);
    equity *= 1 + pnlPct;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peakEquity) - 1);
    trades.push({
      side: position.side,
      entryTs: position.entryTs,
      exitTs: last.ts,
      entryIso: iso(position.entryTs),
      exitIso: last.iso,
      entryPrice: position.entryPrice,
      exitPrice: last.close,
      pnlPct,
      holdBars: penguRows.length - 1 - position.entryIndex,
      exitReason: "end-of-test",
      score: position.score,
    });
  }

  const wins = trades.filter((trade) => trade.pnlPct > 0).length;
  const losses = trades.filter((trade) => trade.pnlPct <= 0).length;
  const grossProfit = trades.filter((trade) => trade.pnlPct > 0).reduce((sum, trade) => sum + trade.pnlPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnlPct <= 0).reduce((sum, trade) => sum + trade.pnlPct, 0));

  return {
    key: variant.key,
    title: variant.title,
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    endEquity: equity,
    returnPct: ((equity / STARTING_EQUITY) - 1) * 100,
    maxDrawdownPct: maxDrawdownPct * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    avgHoldMinutes: trades.length ? (trades.reduce((sum, trade) => sum + trade.holdBars, 0) / trades.length) * 5 : 0,
    avgPnlPct: trades.length ? (trades.reduce((sum, trade) => sum + trade.pnlPct, 0) / trades.length) * 100 : 0,
    tradesDetail: trades,
  };
}

async function writeReport(payload: {
  summary: VariantResult[];
  notes: string[];
  source: { start: string; end: string; symbols: string[]; bars: Record<string, number> };
}) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "result.json");
  const mdPath = path.join(REPORT_DIR, "result.md");

  const md = [
    "# AsterDex PENGU 5m UP/Down Backtest",
    "",
    `- window: ${payload.source.start} to ${payload.source.end}`,
    `- symbols: ${payload.source.symbols.join(", ")}`,
    `- bars: ${payload.source.symbols.map((symbol) => `${symbol}=${payload.source.bars[symbol] ?? 0}`).join(", ")}`,
    `- fees/slippage: ${(FEE_RATE * 100).toFixed(2)}% fee each side + ${(SLIPPAGE_RATE * 100).toFixed(2)}% slippage each side`,
    "",
    "| variant | end equity | return % | max DD % | PF | trades | win rate % | avg hold min | avg pnl % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...payload.summary.map((row) => `| ${row.key} | ${round(row.endEquity)} | ${round(row.returnPct)} | ${round(row.maxDrawdownPct)} | ${Number.isFinite(row.profitFactor) ? round(row.profitFactor, 3) : "inf"} | ${row.trades} | ${round(row.winRatePct)} | ${round(row.avgHoldMinutes)} | ${round(row.avgPnlPct, 3)} |`),
    "",
    "## Notes",
    ...payload.notes.map((note) => `- ${note}`),
  ].join("\n");

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(mdPath, md, "utf8");
}

async function main() {
  const [btcCandles, ethCandles, penguCandles] = await Promise.all([
    loadCachedSymbol("BTCUSDT"),
    loadCachedSymbol("ETHUSDT"),
    loadCachedSymbol("PENGUUSDT"),
  ]);

  const btcFeatures = buildFeatures(btcCandles).map((row) => ({ ...row, regime: classifyRegime(row) }));
  const ethFeatures = buildFeatures(ethCandles).map((row) => ({ ...row, regime: classifyRegime(row) }));
  const penguFeatures = buildFeatures(penguCandles);

  const results = VARIANTS.map((variant) => runVariant(penguFeatures, btcFeatures, ethFeatures, variant))
    .sort((left, right) => right.endEquity - left.endEquity);

  await writeReport({
    summary: results.map((result) => ({
      ...result,
      tradesDetail: result.tradesDetail.slice(0, 25),
    })),
    notes: [
      "GoldCat 由来の要素は、move threshold, acceleration confirmation, recent-strength persistence, price/overheat gate, support proxy, and a hard no-trade state.",
      "AsterDex 向けの初期案なので、まずは PENGU long-only / flat only で評価しています。short は含めていません。",
      "板の bid/ask support は取得していないため、close location, quote volume, and BTC/ETH regime alignment を代替 proxy に使っています。",
      `最良 variant: ${results[0]?.key ?? "n/a"}`,
    ],
    source: {
      start: iso(START_TS),
      end: iso(END_TS),
      symbols: ["BTCUSDT", "ETHUSDT", "PENGUUSDT"],
      bars: {
        BTCUSDT: btcCandles.length,
        ETHUSDT: ethCandles.length,
        PENGUUSDT: penguCandles.length,
      },
    },
  });

  console.log(JSON.stringify(results.map((result) => ({
    key: result.key,
    title: result.title,
    endEquity: round(result.endEquity),
    returnPct: round(result.returnPct),
    maxDrawdownPct: round(result.maxDrawdownPct),
    profitFactor: Number.isFinite(result.profitFactor) ? round(result.profitFactor, 3) : "inf",
    trades: result.trades,
    winRatePct: round(result.winRatePct),
    avgHoldMinutes: round(result.avgHoldMinutes),
    avgPnlPct: round(result.avgPnlPct, 3),
  })), null, 2));
}

main().catch((error) => {
  console.error("[backtest-asterdex-pengu-5m-updown] failed:", error);
  process.exitCode = 1;
});
