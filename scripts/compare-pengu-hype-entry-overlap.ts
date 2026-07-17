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

type PenguConfig = {
  holdMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
};

type HypeTrade = {
  entryIso: string;
  exitIso: string;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  holdMinutes: number;
  entryReason: string;
  exitReason: string;
};

type OverlapRow = {
  hypeEntryIso: string;
  nearestPenguEntryIso: string | null;
  gapMinutes: number | null;
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const PENGU_CACHE_DIR = path.join(process.cwd(), ".cache", "pengu-family-compare");
const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-hype-overlap");
const HYPE_REPORT_JSON = path.join(process.cwd(), "reports", "hype-15m", "result.json");
const EXECUTION_SYMBOL = "PENGUUSDT";

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

const PENGU_COMBINED: PenguConfig = {
  holdMinutes: 25,
  stopLossPct: 0.003,
  takeProfitPct: 0.025,
  trailActivationPct: 0.01,
  trailRetracePct: 0.005,
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

async function loadCachedBinance(symbol: string, interval: "1m" | "15m", startMs: number, endMs: number) {
  const filePath = path.join(PENGU_CACHE_DIR, `${symbol}-${interval}-${minuteFloor(startMs)}-${minuteFloor(endMs)}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const candles = await fetchBinance(symbol, interval, startMs, endMs);
    await fs.mkdir(PENGU_CACHE_DIR, { recursive: true });
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

function runTrade(candles1m: Candle[], side: "long" | "short", signalTs: number, config: PenguConfig) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const stop = side === "long" ? entry.price * (1 - config.stopLossPct) : entry.price * (1 + config.stopLossPct);
  const take = side === "long" ? entry.price * (1 + config.takeProfitPct) : entry.price * (1 - config.takeProfitPct);
  let peak = entry.price;
  let trough = entry.price;
  let exitTs = entry.ts;
  const holdUntil = entry.ts + (config.holdMinutes * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const trail = side === "long"
      ? (peak >= entry.price * (1 + config.trailActivationPct) ? peak * (1 - config.trailRetracePct) : null)
      : (trough <= entry.price * (1 - config.trailActivationPct) ? trough * (1 + config.trailRetracePct) : null);
    if (side === "long" && candle.low <= stop) { exitTs = candle.ts; break; }
    if (side === "short" && candle.high >= stop) { exitTs = candle.ts; break; }
    if (side === "long" && candle.high >= take) { exitTs = candle.ts; break; }
    if (side === "short" && candle.low <= take) { exitTs = candle.ts; break; }
    if (trail != null && ((side === "long" && candle.low <= trail) || (side === "short" && candle.high >= trail))) {
      exitTs = candle.ts; break;
    }
    exitTs = candle.ts;
  }
  return { entryTs: entry.ts, exitTs };
}

async function buildPenguCombinedEntries() {
  const rows = await loadGoldcatRows();
  const startMs = rows[0].ts;
  const endMs = rows.at(-1)!.ts + (60 * 60_000);
  const [candles1m, pengu15mRaw] = await Promise.all([
    loadCachedBinance(EXECUTION_SYMBOL, "1m", startMs, endMs),
    loadCachedBinance(EXECUTION_SYMBOL, "15m", startMs, endMs),
  ]);
  const pengu15m = build15mFeatures(pengu15mRaw);

  const entries: number[] = [];
  let lastExitTs = -Infinity;
  for (const row of rows) {
    if (row.ts < lastExitTs) continue;
    if (row.elapsedSec < ENTRY.minElapsedSec || row.elapsedSec > ENTRY.maxElapsedSec) continue;
    if (Math.abs(row.moveBps) < ENTRY.minMoveBps) continue;
    const side = row.moveBps >= 0 ? "long" : "short";
    const book = side === "long" ? row.up : row.down;
    if (!book || !Number.isFinite(book.bestAsk) || Number(book.bestAsk) > ENTRY.maxEntryPrice) continue;
    if (Number(book.spreadBps || 9999) > ENTRY.maxEntrySpreadBps) continue;
    const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
    if (bidSupportRatio < ENTRY.minBidSupportRatio) continue;

    const signalPrice = executionPrice(candles1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + (ENTRY.filterConfirmMinutes * 60_000);
    const breakoutPct = ENTRY.filterBreakoutBps / 10_000;
    let confirmedTs: number | null = null;
    for (const candle of candles1m) {
      if (candle.ts < row.ts) continue;
      if (candle.ts > confirmUntil) break;
      if (side === "long" && candle.high >= signalPrice * (1 + breakoutPct)) { confirmedTs = candle.ts; break; }
      if (side === "short" && candle.low <= signalPrice * (1 - breakoutPct)) { confirmedTs = candle.ts; break; }
    }
    if (!confirmedTs) continue;

    const trade = runTrade(candles1m, side, confirmedTs, PENGU_COMBINED);
    if (!trade) continue;

    const sizeCandle = pengu15m.find((candle) => candle.ts > row.ts)
      ? pengu15m.filter((candle) => candle.ts <= row.ts).at(-1)
      : pengu15m.at(-1);
    if (!sizeCandle) continue;

    entries.push(trade.entryTs);
    lastExitTs = trade.exitTs;
  }

  return entries.sort((a, b) => a - b);
}

async function loadHypeEntries(variantKey: string) {
  const raw = JSON.parse(await fs.readFile(HYPE_REPORT_JSON, "utf8")) as {
    results: Array<{ key: string; tradesDetail: HypeTrade[] }>;
  };
  const variant = raw.results.find((row) => row.key === variantKey);
  if (!variant) {
    throw new Error(`HYPE variant not found: ${variantKey}`);
  }
  return variant.tradesDetail
    .map((trade) => Date.parse(trade.entryIso))
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b);
}

function nearestGapMinutes(ts: number, candidates: number[]) {
  let best: number | null = null;
  let bestCandidate: number | null = null;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - ts);
    if (best == null || gap < best) {
      best = gap;
      bestCandidate = candidate;
    }
  }
  return {
    nearestTs: bestCandidate,
    gapMinutes: best == null ? null : best / 60_000,
  };
}

function countWithinWindow(source: number[], target: number[], windowMinutes: number) {
  return source.filter((ts) => {
    const { gapMinutes } = nearestGapMinutes(ts, target);
    return gapMinutes != null && gapMinutes <= windowMinutes;
  }).length;
}

async function main() {
  const variantKey = process.env.HYPE_VARIANT?.trim() || "pengu_style_freq";
  const [penguEntries, hypeEntries] = await Promise.all([
    buildPenguCombinedEntries(),
    loadHypeEntries(variantKey),
  ]);

  const overlapRows: OverlapRow[] = hypeEntries.map((ts) => {
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
  const nonOverlapping = overlapRows.filter((row) => row.gapMinutes == null || row.gapMinutes > 60);
  const medianGap = (() => {
    const gaps = overlapRows
      .map((row) => row.gapMinutes)
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b);
    if (!gaps.length) return null;
    const mid = Math.floor(gaps.length / 2);
    return gaps.length % 2 === 0 ? round((gaps[mid - 1] + gaps[mid]) / 2, 2) : round(gaps[mid], 2);
  })();

  const markdown = [
    "# PENGU vs HYPE Entry Overlap",
    "",
    "## Setup",
    "",
    `- HYPE variant: ${variantKey}`,
    `- PENGU reference: combined`,
    `- PENGU entries: ${penguEntries.length}`,
    `- HYPE entries: ${hypeEntries.length}`,
    "",
    "## Overlap Summary",
    "",
    `- HYPE entries within 15 minutes of a PENGU entry: ${overlap15}/${hypeEntries.length} (${round((overlap15 / Math.max(hypeEntries.length, 1)) * 100, 2)}%)`,
    `- HYPE entries within 30 minutes of a PENGU entry: ${overlap30}/${hypeEntries.length} (${round((overlap30 / Math.max(hypeEntries.length, 1)) * 100, 2)}%)`,
    `- HYPE entries within 60 minutes of a PENGU entry: ${overlap60}/${hypeEntries.length} (${round((overlap60 / Math.max(hypeEntries.length, 1)) * 100, 2)}%)`,
    `- median nearest-entry gap: ${medianGap == null ? "n/a" : `${medianGap} minutes`}`,
    `- clearly separate HYPE entries (>60m from nearest PENGU): ${nonOverlapping.length}/${hypeEntries.length}`,
    "",
    "## Sample Rows",
    "",
    "| HYPE entry | nearest PENGU entry | gap min |",
    "| --- | --- | ---: |",
    ...overlapRows.slice(0, 25).map((row) => `| ${row.hypeEntryIso} | ${row.nearestPenguEntryIso ?? "-"} | ${row.gapMinutes ?? "-"} |`),
    "",
    "## Separate HYPE Examples",
    "",
    "| HYPE entry | nearest PENGU entry | gap min |",
    "| --- | --- | ---: |",
    ...nonOverlapping.slice(0, 20).map((row) => `| ${row.hypeEntryIso} | ${row.nearestPenguEntryIso ?? "-"} | ${row.gapMinutes ?? "-"} |`),
    "",
  ].join("\n");

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify({ variantKey, penguEntries, hypeEntries, overlapRows }, null, 2),
    "utf8",
  );

  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
