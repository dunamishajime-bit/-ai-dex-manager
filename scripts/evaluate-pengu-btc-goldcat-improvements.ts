import fs from "fs/promises";
import path from "path";

type UpdownRow = {
  ts: number;
  coin: string;
  elapsedSec: number;
  moveBps: number;
  horizonSec: number;
  up?: { bestAsk?: number; askDepthUsd?: number; bidDepthUsd?: number; spreadBps?: number };
  down?: { bestAsk?: number; askDepthUsd?: number; bidDepthUsd?: number; spreadBps?: number };
};

type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Candle15m = Candle & {
  ema20: number;
  ema48: number;
  moveBps: number;
  accelBps: number;
  high3: number;
  low3: number;
};

type Config = {
  key: string;
  holdMinutes: number;
  stopLossPct: number;
  stopGraceMinutes?: number;
  longOnly?: boolean;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  weakAlignedSize: number;
  strongAlignedSize: number;
  unalignedSize: number;
  strongMoveBps: number;
  strongAccelBps: number;
  requireAlignmentForEntry?: boolean;
  liveLike?: boolean;
  maxSameSideEntries?: number;
  addEntryCooldownMinutes?: number;
  minAddEntryPnlPct?: number;
  cooldownAfterStopMinutes?: number;
  cooldownAfterReverseMinutes?: number;
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "pengu-family-compare");
const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-btc-goldcat-improvements");
const EXECUTION_SYMBOL = "PENGUUSDT";
const STARTING_CASH_USD = 100;
const ASTER_TAKER_FEE_PER_SIDE = 0.0004;

const ENTRY = {
  minMoveBps: 5,
  minBidSupportRatio: 0.8,
  maxEntrySpreadBps: 180,
  minElapsedSec: 90,
  maxElapsedSec: 240,
  maxEntryPrice: 0.6,
  filterBreakoutBps: 8,
  filterConfirmMinutes: 4,
};

const CONFIGS: Config[] = [
  {
    key: "baseline",
    holdMinutes: 20,
    stopLossPct: 0.004,
    takeProfitPct: 0.015,
    trailActivationPct: 0.008,
    trailRetracePct: 0.004,
    weakAlignedSize: 1,
    strongAlignedSize: 1,
    unalignedSize: 1,
    strongMoveBps: 8,
    strongAccelBps: 2,
  },
  {
    key: "exit_only",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1,
    strongAlignedSize: 1,
    unalignedSize: 1,
    strongMoveBps: 8,
    strongAccelBps: 2,
  },
  {
    key: "size_only",
    holdMinutes: 20,
    stopLossPct: 0.004,
    takeProfitPct: 0.015,
    trailActivationPct: 0.008,
    trailRetracePct: 0.004,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 1,
    strongMoveBps: 8,
    strongAccelBps: 2,
  },
  {
    key: "combined",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 1,
    strongMoveBps: 8,
    strongAccelBps: 2,
  },
  {
    key: "current_guarded",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 1,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: true,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_only",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 1,
    strongMoveBps: 8,
    strongAccelBps: 2,
    liveLike: true,
    maxSameSideEntries: 99,
    addEntryCooldownMinutes: 0,
    minAddEntryPnlPct: -1,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_add_guard_only",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 1,
    strongMoveBps: 8,
    strongAccelBps: 2,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 0,
    cooldownAfterReverseMinutes: 0,
  },
  {
    key: "live_like_unaligned_half",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.5,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: true,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_unaligned_half_no_align_gate",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.5,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_soft_align_gate",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.002,
    cooldownAfterStopMinutes: 10,
    cooldownAfterReverseMinutes: 10,
  },
  {
    key: "live_like_cooldown_unaligned_075",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_060",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.6,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_strict_add",
    holdMinutes: 25,
    stopLossPct: 0.003,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 15,
    minAddEntryPnlPct: 0.005,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_045_grace_2",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 2,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_030_grace_2",
    holdMinutes: 25,
    stopLossPct: 0.003,
    stopGraceMinutes: 2,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_030_grace_3",
    holdMinutes: 25,
    stopLossPct: 0.003,
    stopGraceMinutes: 3,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_045_grace_3",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 3,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_050_grace_2",
    holdMinutes: 25,
    stopLossPct: 0.005,
    stopGraceMinutes: 2,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_050_grace_3",
    holdMinutes: 25,
    stopLossPct: 0.005,
    stopGraceMinutes: 3,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_038_grace_2",
    holdMinutes: 25,
    stopLossPct: 0.0038,
    stopGraceMinutes: 2,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_040_grace_2",
    holdMinutes: 25,
    stopLossPct: 0.004,
    stopGraceMinutes: 2,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_040_grace_5",
    holdMinutes: 25,
    stopLossPct: 0.004,
    stopGraceMinutes: 5,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_045_grace_5",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 5,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_050_grace_5",
    holdMinutes: 25,
    stopLossPct: 0.005,
    stopGraceMinutes: 5,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_045_grace_10",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 10,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_cooldown_unaligned_075_stop_045_grace_15",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 15,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_long_only_stop_045_grace_10",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 10,
    longOnly: true,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_long_only_align_gate_stop_045_grace_10",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 10,
    longOnly: true,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.75,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: true,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
  {
    key: "live_like_long_only_unaligned_half_stop_045_grace_10",
    holdMinutes: 25,
    stopLossPct: 0.0045,
    stopGraceMinutes: 10,
    longOnly: true,
    takeProfitPct: 0.025,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
    weakAlignedSize: 1.25,
    strongAlignedSize: 2,
    unalignedSize: 0.5,
    strongMoveBps: 8,
    strongAccelBps: 2,
    requireAlignmentForEntry: false,
    liveLike: true,
    maxSameSideEntries: 1,
    addEntryCooldownMinutes: 10,
    minAddEntryPnlPct: 0.003,
    cooldownAfterStopMinutes: 15,
    cooldownAfterReverseMinutes: 15,
  },
];

type PositionState = {
  side: "long" | "short";
  entryTs: number;
  avgEntryPrice: number;
  sizeUnits: number;
  entryCount: number;
  lastAddedAt: number;
  sourceSignalTs: number;
  peak: number;
  trough: number;
};

type SignalEvaluation = {
  side: "long" | "short";
  accepted: boolean;
  confirmedTs: number | null;
  aligned: boolean;
  size: number;
};

function minuteFloor(ts: number) {
  return Math.floor(ts / 60_000) * 60_000;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function listInputFiles() {
  const names = await fs.readdir(DATA_DIR);
  return names.filter((name) => /^updown_lag_.*\.ndjson$/.test(name)).sort().map((name) => path.join(DATA_DIR, name));
}

async function loadGoldcatRows() {
  const files = await listInputFiles();
  const rows: UpdownRow[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as UpdownRow;
      if (row.coin !== "BTC") continue;
      if (Number(row.horizonSec) !== 900) continue;
      if (!Number.isFinite(row.ts) || !Number.isFinite(row.moveBps)) continue;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.ts - b.ts);
}

async function fetchBinance(symbol: string, interval: "1m" | "15m", startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = minuteFloor(startMs);
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Binance ${symbol} ${interval} request failed: ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) break;
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

async function loadCachedBinance(symbol: string, interval: "1m" | "15m", startMs: number, endMs: number) {
  const filePath = path.join(CACHE_DIR, `${symbol}-${interval}-${minuteFloor(startMs)}-${minuteFloor(endMs)}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const candles = await fetchBinance(symbol, interval, startMs, endMs);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function ema(prev: number | null, value: number, period: number) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : (value * alpha) + (prev * (1 - alpha));
}

function build15mFeatures(candles: Candle[]): Candle15m[] {
  const out: Candle15m[] = [];
  let ema20: number | null = null;
  let ema48: number | null = null;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    ema20 = ema(ema20, candle.close, 20);
    ema48 = ema(ema48, candle.close, 48);
    const prev = index >= 1 ? candles[index - 1] : null;
    const moveBps = prev ? ((candle.close / prev.close) - 1) * 10_000 : 0;
    const prevMove = index >= 2 ? ((candles[index - 1].close / candles[index - 2].close) - 1) * 10_000 : 0;
    const accelBps = moveBps - prevMove;
    const high3 = candles.slice(Math.max(0, index - 3), index).reduce((max, row) => Math.max(max, row.high), -Infinity);
    const low3 = candles.slice(Math.max(0, index - 3), index).reduce((min, row) => Math.min(min, row.low), Infinity);
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

function executionPrice(candles: Candle[], targetTs: number) {
  const execTs = Math.ceil(targetTs / 60_000) * 60_000;
  const candle = candles.find((row) => row.ts >= execTs);
  return candle ? { ts: candle.ts, price: candle.open } : null;
}

function latestPengu15m(pengu15m: Candle15m[], targetTs: number) {
  let latest: Candle15m | null = null;
  for (const candle of pengu15m) {
    if (candle.ts > targetTs) break;
    latest = candle;
  }
  return latest;
}

function sizeMultiplier(side: "long" | "short", candle: Candle15m | null, config: Config) {
  if (!candle) return 1;
  const bullish = candle.close > candle.ema20 && candle.ema20 > candle.ema48 && candle.close >= candle.high3;
  const bearish = candle.close < candle.ema20 && candle.ema20 < candle.ema48 && candle.close <= candle.low3;
  const aligned = (side === "long" && bullish) || (side === "short" && bearish);
  if (!aligned) return config.unalignedSize;
  const strongLong = bullish && candle.moveBps >= config.strongMoveBps && candle.accelBps >= config.strongAccelBps;
  const strongShort = bearish && -candle.moveBps >= config.strongMoveBps && -candle.accelBps >= config.strongAccelBps;
  return (strongLong || strongShort) ? config.strongAlignedSize : config.weakAlignedSize;
}

function isAligned(side: "long" | "short", candle: Candle15m | null) {
  if (!candle) return false;
  const bullish = candle.close > candle.ema20 && candle.ema20 > candle.ema48 && candle.close >= candle.high3;
  const bearish = candle.close < candle.ema20 && candle.ema20 < candle.ema48 && candle.close <= candle.low3;
  return (side === "long" && bullish) || (side === "short" && bearish);
}

function evaluateSignal(row: UpdownRow, candles1m: Candle[], pengu15m: Candle15m[], config: Config): SignalEvaluation | null {
  if (row.elapsedSec < ENTRY.minElapsedSec || row.elapsedSec > ENTRY.maxElapsedSec) return null;
  if (Math.abs(row.moveBps) < ENTRY.minMoveBps) return null;
  const side = row.moveBps >= 0 ? "long" : "short";
  if (config.longOnly && side === "short") return null;
  const book = side === "long" ? row.up : row.down;
  if (!book || !Number.isFinite(book.bestAsk) || Number(book.bestAsk) > ENTRY.maxEntryPrice) return null;
  if (Number(book.spreadBps || 9999) > ENTRY.maxEntrySpreadBps) return null;
  const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
  if (bidSupportRatio < ENTRY.minBidSupportRatio) return null;

  const signalPrice = executionPrice(candles1m, row.ts)?.price;
  if (!signalPrice) return null;
  const confirmUntil = row.ts + (ENTRY.filterConfirmMinutes * 60_000);
  const breakoutPct = ENTRY.filterBreakoutBps / 10_000;
  let confirmedTs: number | null = null;
  for (const candle of candles1m) {
    if (candle.ts < row.ts) continue;
    if (candle.ts > confirmUntil) break;
    if (side === "long" && candle.high >= signalPrice * (1 + breakoutPct)) { confirmedTs = candle.ts; break; }
    if (side === "short" && candle.low <= signalPrice * (1 - breakoutPct)) { confirmedTs = candle.ts; break; }
  }
  const latest15m = latestPengu15m(pengu15m, row.ts);
  const aligned = isAligned(side, latest15m);
  return {
    side,
    accepted: Boolean(confirmedTs),
    confirmedTs,
    aligned,
    size: sizeMultiplier(side, latest15m, config),
  };
}

function netPnlPct(side: "long" | "short", entryPrice: number, exitPrice: number) {
  const gross = side === "long" ? ((exitPrice / entryPrice) - 1) : ((entryPrice / exitPrice) - 1);
  return gross - (ASTER_TAKER_FEE_PER_SIDE * 2);
}

function unrealizedPnlPct(position: PositionState, currentPrice: number) {
  return position.side === "long"
    ? ((currentPrice / position.avgEntryPrice) - 1)
    : ((position.avgEntryPrice / currentPrice) - 1);
}

function weightedAverage(leftPrice: number, leftSize: number, rightPrice: number, rightSize: number) {
  return ((leftPrice * leftSize) + (rightPrice * rightSize)) / Math.max(leftSize + rightSize, 0.000001);
}

function scanPosition(
  position: PositionState,
  candles1m: Candle[],
  fromTs: number,
  untilTs: number,
  config: Config,
) {
  let peak = position.peak;
  let trough = position.trough;
  let lastPrice = position.avgEntryPrice;
  const holdUntil = position.entryTs + (config.holdMinutes * 60_000);
  const hardStopTs = Math.min(untilTs, holdUntil);
  const stopEnabledTs = position.entryTs + ((config.stopGraceMinutes || 0) * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < fromTs) continue;
    if (candle.ts > hardStopTs) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const stop = position.side === "long"
      ? position.avgEntryPrice * (1 - config.stopLossPct)
      : position.avgEntryPrice * (1 + config.stopLossPct);
    const take = position.side === "long"
      ? position.avgEntryPrice * (1 + config.takeProfitPct)
      : position.avgEntryPrice * (1 - config.takeProfitPct);
    const trail = position.side === "long"
      ? (peak >= position.avgEntryPrice * (1 + config.trailActivationPct) ? peak * (1 - config.trailRetracePct) : null)
      : (trough <= position.avgEntryPrice * (1 - config.trailActivationPct) ? trough * (1 + config.trailRetracePct) : null);

    if (candle.ts >= stopEnabledTs && position.side === "long" && candle.low <= stop) {
      return { exited: true as const, reason: "stop", exitTs: candle.ts, exitPrice: stop, peak, trough };
    }
    if (candle.ts >= stopEnabledTs && position.side === "short" && candle.high >= stop) {
      return { exited: true as const, reason: "stop", exitTs: candle.ts, exitPrice: stop, peak, trough };
    }
    if (position.side === "long" && candle.high >= take) {
      return { exited: true as const, reason: "take", exitTs: candle.ts, exitPrice: take, peak, trough };
    }
    if (position.side === "short" && candle.low <= take) {
      return { exited: true as const, reason: "take", exitTs: candle.ts, exitPrice: take, peak, trough };
    }
    if (trail != null && ((position.side === "long" && candle.low <= trail) || (position.side === "short" && candle.high >= trail))) {
      return { exited: true as const, reason: "trail", exitTs: candle.ts, exitPrice: trail, peak, trough };
    }
    lastPrice = candle.close;
  }

  if (holdUntil <= untilTs) {
    const holdPrice = executionPrice(candles1m, holdUntil)?.price || lastPrice;
    return { exited: true as const, reason: "hold", exitTs: holdUntil, exitPrice: holdPrice, peak, trough };
  }

  return { exited: false as const, peak, trough, lastPrice };
}

function runTrade(candles1m: Candle[], side: "long" | "short", signalTs: number, config: Config) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const stop = side === "long" ? entry.price * (1 - config.stopLossPct) : entry.price * (1 + config.stopLossPct);
  const take = side === "long" ? entry.price * (1 + config.takeProfitPct) : entry.price * (1 - config.takeProfitPct);
  let peak = entry.price;
  let trough = entry.price;
  let exitPrice = entry.price;
  let exitTs = entry.ts;
  const holdUntil = entry.ts + (config.holdMinutes * 60_000);
  const stopEnabledTs = entry.ts + ((config.stopGraceMinutes || 0) * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const trail = side === "long"
      ? (peak >= entry.price * (1 + config.trailActivationPct) ? peak * (1 - config.trailRetracePct) : null)
      : (trough <= entry.price * (1 - config.trailActivationPct) ? trough * (1 + config.trailRetracePct) : null);
    if (candle.ts >= stopEnabledTs && side === "long" && candle.low <= stop) { exitPrice = stop; exitTs = candle.ts; break; }
    if (candle.ts >= stopEnabledTs && side === "short" && candle.high >= stop) { exitPrice = stop; exitTs = candle.ts; break; }
    if (side === "long" && candle.high >= take) { exitPrice = take; exitTs = candle.ts; break; }
    if (side === "short" && candle.low <= take) { exitPrice = take; exitTs = candle.ts; break; }
    if (trail != null && ((side === "long" && candle.low <= trail) || (side === "short" && candle.high >= trail))) {
      exitPrice = trail; exitTs = candle.ts; break;
    }
    exitPrice = candle.close;
    exitTs = candle.ts;
  }
  const gross = side === "long" ? ((exitPrice / entry.price) - 1) : ((entry.price / exitPrice) - 1);
  const net = gross - (ASTER_TAKER_FEE_PER_SIDE * 2);
  return { net, exitTs };
}

function simulate(config: Config, rows: UpdownRow[], candles1m: Candle[], pengu15m: Candle15m[]) {
  if (config.liveLike) {
    return simulateLiveLike(config, rows, candles1m, pengu15m);
  }
  const trades: Array<{ pnlUsd: number; pnlPct: number }> = [];
  let lastExitTs = -Infinity;
  for (const row of rows) {
    if (row.ts < lastExitTs) continue;
    const signal = evaluateSignal(row, candles1m, pengu15m, config);
    if (!signal?.accepted || !signal.confirmedTs) continue;
    if (config.requireAlignmentForEntry && !signal.aligned) continue;
    const trade = runTrade(candles1m, signal.side, signal.confirmedTs, config);
    if (!trade) continue;
    const size = signal.size;
    trades.push({ pnlUsd: STARTING_CASH_USD * trade.net * size, pnlPct: trade.net * 100 * size });
    lastExitTs = trade.exitTs;
  }

  let equity = STARTING_CASH_USD;
  let peak = STARTING_CASH_USD;
  let maxDd = 0;
  for (const trade of trades) {
    equity += trade.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity / peak) - 1);
  }
  const pnlUsd = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const winRatePct = trades.length ? (wins / trades.length) * 100 : 0;
  const avgTradePct = trades.length ? trades.reduce((sum, trade) => sum + trade.pnlPct, 0) / trades.length : 0;
  return {
    key: config.key,
    trades: trades.length,
    wins,
    winRatePct: round(winRatePct, 2),
    pnlUsd: round(pnlUsd, 4),
    totalReturnPct: round((equity / STARTING_CASH_USD - 1) * 100, 4),
    avgTradePct: round(avgTradePct, 4),
    maxDrawdownPct: round(maxDd * 100, 4),
  };
}

function simulateLiveLike(config: Config, rows: UpdownRow[], candles1m: Candle[], pengu15m: Candle15m[]) {
  const trades: Array<{ pnlUsd: number; pnlPct: number; reason: string }> = [];
  let position: PositionState | null = null;
  let cooldownUntil = -Infinity;
  let cursorTs = rows[0]?.ts || 0;

  const closePosition = (exitPrice: number, exitTs: number, reason: string) => {
    if (!position) return;
    const pnlPct = netPnlPct(position.side, position.avgEntryPrice, exitPrice);
    trades.push({
      pnlUsd: STARTING_CASH_USD * pnlPct * position.sizeUnits,
      pnlPct: pnlPct * 100 * position.sizeUnits,
      reason,
    });
    if (reason === "stop") {
      cooldownUntil = exitTs + ((config.cooldownAfterStopMinutes || 0) * 60_000);
    } else if (reason === "reverse") {
      cooldownUntil = exitTs + ((config.cooldownAfterReverseMinutes || 0) * 60_000);
    }
    position = null;
    cursorTs = exitTs;
  };

  for (const row of rows) {
    const signal = evaluateSignal(row, candles1m, pengu15m, config);
    const signalSide = signal?.side || (row.moveBps >= 0 ? "long" : "short");

    if (position) {
      const scanned = scanPosition(position, candles1m, cursorTs, row.ts, config);
      if (scanned.exited) {
        closePosition(scanned.exitPrice, scanned.exitTs, scanned.reason);
      } else {
        position.peak = scanned.peak;
        position.trough = scanned.trough;
        cursorTs = row.ts;
      }
    }

    if (position) {
      if (signalSide !== position.side && signal) {
        const reverseExec = executionPrice(candles1m, row.ts);
        if (reverseExec) {
          closePosition(reverseExec.price, reverseExec.ts, "reverse");
        }
      } else if (
        signal?.accepted
        && signal.confirmedTs
        && signalSide === position.side
        && (!config.requireAlignmentForEntry || signal.aligned)
      ) {
        const addCooldownOk = (signal.confirmedTs - position.lastAddedAt) >= ((config.addEntryCooldownMinutes || 0) * 60_000);
        const addCountOk = position.entryCount <= (config.maxSameSideEntries || 0);
        const confirmExec = executionPrice(candles1m, signal.confirmedTs);
        const addPnlOk = confirmExec ? unrealizedPnlPct(position, confirmExec.price) >= (config.minAddEntryPnlPct || 0) : false;
        if (addCooldownOk && addCountOk && addPnlOk && confirmExec) {
          position.avgEntryPrice = weightedAverage(position.avgEntryPrice, position.sizeUnits, confirmExec.price, signal.size);
          position.sizeUnits += signal.size;
          position.entryCount += 1;
          position.lastAddedAt = confirmExec.ts;
          position.sourceSignalTs = row.ts;
          position.peak = Math.max(position.peak, confirmExec.price);
          position.trough = Math.min(position.trough, confirmExec.price);
          cursorTs = confirmExec.ts;
        }
      }
    }

    if (position) continue;
    if (!signal?.accepted || !signal.confirmedTs) continue;
    if (row.ts < cooldownUntil) continue;
    if (config.requireAlignmentForEntry && !signal.aligned) continue;
    const entry = executionPrice(candles1m, signal.confirmedTs);
    if (!entry) continue;
    position = {
      side: signal.side,
      entryTs: entry.ts,
      avgEntryPrice: entry.price,
      sizeUnits: signal.size,
      entryCount: 1,
      lastAddedAt: entry.ts,
      sourceSignalTs: row.ts,
      peak: entry.price,
      trough: entry.price,
    };
    cursorTs = entry.ts;
  }

  if (position) {
    const lastCandleTs = candles1m.at(-1)?.ts || cursorTs;
    const scanned = scanPosition(position, candles1m, cursorTs, lastCandleTs + (config.holdMinutes * 60_000), config);
    if (scanned.exited) {
      closePosition(scanned.exitPrice, scanned.exitTs, scanned.reason);
    }
  }

  let equity = STARTING_CASH_USD;
  let peak = STARTING_CASH_USD;
  let maxDd = 0;
  for (const trade of trades) {
    equity += trade.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity / peak) - 1);
  }
  const pnlUsd = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const winRatePct = trades.length ? (wins / trades.length) * 100 : 0;
  const avgTradePct = trades.length ? trades.reduce((sum, trade) => sum + trade.pnlPct, 0) / trades.length : 0;
  return {
    key: config.key,
    trades: trades.length,
    wins,
    winRatePct: round(winRatePct, 2),
    pnlUsd: round(pnlUsd, 4),
    totalReturnPct: round((equity / STARTING_CASH_USD - 1) * 100, 4),
    avgTradePct: round(avgTradePct, 4),
    maxDrawdownPct: round(maxDd * 100, 4),
  };
}

async function main() {
  const rows = await loadGoldcatRows();
  const startMs = rows[0].ts;
  const endMs = rows.at(-1)!.ts + (60 * 60_000);
  const [candles1m, pengu15mRaw] = await Promise.all([
    loadCachedBinance(EXECUTION_SYMBOL, "1m", startMs, endMs),
    loadCachedBinance(EXECUTION_SYMBOL, "15m", startMs, endMs),
  ]);
  const pengu15m = build15mFeatures(pengu15mRaw);

  const results = CONFIGS.map((config) => simulate(config, rows, candles1m, pengu15m));

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), [
    "# PENGU BTC GoldCat Improvements",
    "",
    "| config | return % | pnl usd | max DD % | trades | win rate % | avg trade % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((row) => `| ${row.key} | ${row.totalReturnPct} | ${row.pnlUsd} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.avgTradePct} |`),
    "",
  ].join("\n"), "utf8");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
