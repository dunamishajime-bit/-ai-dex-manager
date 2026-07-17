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

type Feature15m = Candle & {
  ema20: number;
  ema48: number;
  moveBps: number;
  accelBps: number;
  high3: number;
  low3: number;
};

type Variant = {
  key: string;
  title: string;
  btcMinMoveBps: number;
  btcMinAccelBps: number;
  btcMaxMoveBps: number;
  hypeMinMoveBps: number;
  hypeMinAccelBps: number;
  hypeMaxDistanceBps: number;
  confirmBreakoutBps: number;
  confirmMinutes: number;
  holdMinutes: number;
  stopGraceMinutes?: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
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

const REPORT_DIR = path.join(process.cwd(), "reports", "hype-15m");
const CACHE_DIR = path.join(process.cwd(), ".cache", "hype-15m");
const SYMBOL = process.env.BT_SYMBOL?.trim() || "HYPEUSDT";
const BTC_SYMBOL = "BTCUSDT";
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 5, 5, 23, 59, 59, 999);
const STARTING_EQUITY = 10_000;
const ASTER_BASE_URL = "https://fapi.asterdex.com";
const BINANCE_BASE_URL = "https://api.binance.com";
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
    key: "pengu_style_strict",
    title: "BTC gate + HYPE breakout confirm strict",
    btcMinMoveBps: 5,
    btcMinAccelBps: 0,
    btcMaxMoveBps: 35,
    hypeMinMoveBps: 12,
    hypeMinAccelBps: 1,
    hypeMaxDistanceBps: 45,
    confirmBreakoutBps: 10,
    confirmMinutes: 4,
    holdMinutes: 25,
    stopLossPct: 0.0035,
    takeProfitPct: 0.02,
    trailActivationPct: 0.01,
    trailRetracePct: 0.005,
  },
  {
    key: "pengu_style_balanced",
    title: "BTC gate + HYPE breakout confirm balanced",
    btcMinMoveBps: 4,
    btcMinAccelBps: 0,
    btcMaxMoveBps: 40,
    hypeMinMoveBps: 10,
    hypeMinAccelBps: 0,
    hypeMaxDistanceBps: 55,
    confirmBreakoutBps: 8,
    confirmMinutes: 4,
    holdMinutes: 25,
    stopLossPct: 0.0038,
    takeProfitPct: 0.02,
    trailActivationPct: 0.009,
    trailRetracePct: 0.0045,
  },
  {
    key: "pengu_style_freq",
    title: "BTC gate + HYPE breakout confirm frequency",
    btcMinMoveBps: 3,
    btcMinAccelBps: -1,
    btcMaxMoveBps: 45,
    hypeMinMoveBps: 8,
    hypeMinAccelBps: -1,
    hypeMaxDistanceBps: 65,
    confirmBreakoutBps: 8,
    confirmMinutes: 5,
    holdMinutes: 25,
    stopLossPct: 0.004,
    takeProfitPct: 0.018,
    trailActivationPct: 0.008,
    trailRetracePct: 0.004,
  },
  {
    key: "pengu_style_freq_stop_045_grace_10",
    title: "BTC gate + HYPE breakout confirm frequency stop -0.45% grace 10m",
    btcMinMoveBps: 3,
    btcMinAccelBps: -1,
    btcMaxMoveBps: 45,
    hypeMinMoveBps: 8,
    hypeMinAccelBps: -1,
    hypeMaxDistanceBps: 65,
    confirmBreakoutBps: 8,
    confirmMinutes: 5,
    holdMinutes: 25,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.018,
    trailActivationPct: 0.008,
    trailRetracePct: 0.004,
  },
  {
    key: "aster_style_quality_a",
    title: "ASTER quality breakout A",
    btcMinMoveBps: 5,
    btcMinAccelBps: 0,
    btcMaxMoveBps: 32,
    hypeMinMoveBps: 12,
    hypeMinAccelBps: 1,
    hypeMaxDistanceBps: 42,
    confirmBreakoutBps: 10,
    confirmMinutes: 4,
    holdMinutes: 22,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.017,
    trailActivationPct: 0.0075,
    trailRetracePct: 0.0038,
  },
  {
    key: "aster_style_quality_b",
    title: "ASTER quality breakout B",
    btcMinMoveBps: 6,
    btcMinAccelBps: 1,
    btcMaxMoveBps: 30,
    hypeMinMoveBps: 14,
    hypeMinAccelBps: 2,
    hypeMaxDistanceBps: 38,
    confirmBreakoutBps: 12,
    confirmMinutes: 4,
    holdMinutes: 20,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.016,
    trailActivationPct: 0.007,
    trailRetracePct: 0.0035,
  },
  {
    key: "aster_style_quality_mid",
    title: "ASTER quality breakout mid",
    btcMinMoveBps: 5,
    btcMinAccelBps: 0,
    btcMaxMoveBps: 34,
    hypeMinMoveBps: 11,
    hypeMinAccelBps: 1,
    hypeMaxDistanceBps: 46,
    confirmBreakoutBps: 9,
    confirmMinutes: 4,
    holdMinutes: 22,
    stopGraceMinutes: 10,
    stopLossPct: 0.0045,
    takeProfitPct: 0.0175,
    trailActivationPct: 0.0078,
    trailRetracePct: 0.0039,
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

function intervalMs(interval: "1m" | "15m") {
  return interval === "1m" ? 60_000 : 15 * 60_000;
}

async function fetchKlines(params: {
  baseUrl: string;
  klinesPath: string;
  venueKey: string;
  symbol: string;
  interval: "1m" | "15m";
  startMs: number;
  endMs: number;
}) {
  const { baseUrl, klinesPath, venueKey, symbol, interval, startMs, endMs } = params;
  const cachePath = path.join(CACHE_DIR, `${venueKey}-${symbol}-${interval}-${startMs}-${endMs}.json`);
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const out: Candle[] = [];
    let cursor = startMs;

    while (cursor < endMs) {
      const url = `${baseUrl}${klinesPath}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
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
        throw new Error(`${venueKey} klines request failed for ${symbol} ${interval}: ${lastStatus}`);
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
        if (Number.isFinite(candle.ts) && candle.close > 0) {
          out.push(candle);
        }
      }

      const last = rows.at(-1);
      const nextTs = Number(Array.isArray(last) ? last[6] : 0);
      if (!Number.isFinite(nextTs) || nextTs <= cursor) {
        cursor += intervalMs(interval);
      } else {
        cursor = nextTs;
      }
    }

    const dedup = new Map<number, Candle>();
    for (const candle of out) {
      dedup.set(candle.ts, candle);
    }
    const normalized = [...dedup.values()].sort((left, right) => left.ts - right.ts);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(normalized), "utf8");
    return normalized;
  }
}

function build15mFeatures(candles: Candle[]): Feature15m[] {
  const out: Feature15m[] = [];
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
    const lookback = candles.slice(Math.max(0, i - 3), i);
    const high3 = lookback.length ? Math.max(...lookback.map((row) => row.high)) : candle.high;
    const low3 = lookback.length ? Math.min(...lookback.map((row) => row.low)) : candle.low;
    out.push({
      ...candle,
      ema20: ema20 ?? candle.close,
      ema48: ema48 ?? candle.close,
      moveBps,
      accelBps,
      high3,
      low3,
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

function findBreakoutConfirmation(candles1m: Candle[], signalTs: number, signalPrice: number, variant: Variant) {
  const confirmUntil = signalTs + (variant.confirmMinutes * 60_000);
  const breakoutPct = variant.confirmBreakoutBps / 10_000;
  for (const candle of candles1m) {
    if (candle.ts < signalTs) continue;
    if (candle.ts > confirmUntil) break;
    if (candle.high >= signalPrice * (1 + breakoutPct)) {
      return candle.ts;
    }
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
  let exitReason = "time-stop";
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

function qualifiesBtc(row: Feature15m | null, variant: Variant) {
  if (!row) return false;
  return row.close > row.ema20
    && row.ema20 > row.ema48
    && row.close >= row.high3
    && row.moveBps >= variant.btcMinMoveBps
    && row.moveBps <= variant.btcMaxMoveBps
    && row.accelBps >= variant.btcMinAccelBps;
}

function qualifiesHype(row: Feature15m, variant: Variant) {
  const distanceFromEma20Bps = ((row.close / Math.max(row.ema20, 0.0000001)) - 1) * 10_000;
  return row.close > row.ema20
    && row.ema20 > row.ema48
    && row.close >= row.high3
    && row.moveBps >= variant.hypeMinMoveBps
    && row.accelBps >= variant.hypeMinAccelBps
    && distanceFromEma20Bps <= variant.hypeMaxDistanceBps;
}

function simulateVariant(hype1m: Candle[], hype15m: Feature15m[], btc15m: Feature15m[], variant: Variant): VariantResult {
  let equity = STARTING_EQUITY;
  let peakEquity = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let lastExitTs = -Infinity;
  const trades: Trade[] = [];

  for (let i = 50; i < hype15m.length; i += 1) {
    const hype = hype15m[i];
    if (hype.ts < lastExitTs) continue;
    const btc = latestAtOrBefore(btc15m, hype.ts);
    if (!qualifiesBtc(btc, variant)) continue;
    if (!qualifiesHype(hype, variant)) continue;

    const signalPrice = executionPrice(hype1m, hype.ts)?.price;
    if (!signalPrice) continue;
    const confirmedTs = findBreakoutConfirmation(hype1m, hype.ts, signalPrice, variant);
    if (!confirmedTs) continue;

    const trade = runTrade(hype1m, confirmedTs, variant);
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
      entryReason: `BTC gate + HYPE breakout confirm (${variant.confirmBreakoutBps}bps/${variant.confirmMinutes}m)`,
      exitReason: trade.exitReason,
    });
    lastExitTs = trade.exitTs;
  }

  const wins = trades.filter((trade) => trade.pnlPct > 0).length;
  const losses = trades.length - wins;
  const avgPnlPct = trades.length ? average(trades.map((trade) => trade.pnlPct)) : 0;
  const avgHoldMinutes = trades.length ? average(trades.map((trade) => trade.holdMinutes)) : 0;

  return {
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
    avgPnlPct: round(avgPnlPct, 4),
    avgHoldMinutes: round(avgHoldMinutes, 2),
    tradesDetail: trades,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const [hype1m, hype15mRaw, btc15mRaw] = await Promise.all([
    fetchKlines({
      baseUrl: ASTER_BASE_URL,
      klinesPath: "/fapi/v3/klines",
      venueKey: "aster",
      symbol: SYMBOL,
      interval: "1m",
      startMs: START_TS,
      endMs: END_TS,
    }),
    fetchKlines({
      baseUrl: ASTER_BASE_URL,
      klinesPath: "/fapi/v3/klines",
      venueKey: "aster",
      symbol: SYMBOL,
      interval: "15m",
      startMs: START_TS,
      endMs: END_TS,
    }),
    fetchKlines({
      baseUrl: BINANCE_BASE_URL,
      klinesPath: "/api/v3/klines",
      venueKey: "binance",
      symbol: BTC_SYMBOL,
      interval: "15m",
      startMs: START_TS,
      endMs: END_TS,
    }),
  ]);

  if (hype1m.length < 200 || hype15mRaw.length < 200 || btc15mRaw.length < 200) {
    throw new Error(`Not enough market data. HYPE 1m=${hype1m.length}, HYPE 15m=${hype15mRaw.length}, BTC 15m=${btc15mRaw.length}`);
  }

  const hype15m = build15mFeatures(hype15mRaw);
  const btc15m = build15mFeatures(btc15mRaw);
  const selectedVariants = VARIANT_FILTER.size
    ? VARIANTS.filter((variant) => VARIANT_FILTER.has(variant.key))
    : VARIANTS;
  const results = selectedVariants.map((variant) => simulateVariant(hype1m, hype15m, btc15m, variant));
  const best = [...results].sort((left, right) => right.endEquity - left.endEquity)[0];

  const markdown = [
    "# HYPE 15m Backtest",
    "",
    "## Setup",
    "",
    `- symbol: ${SYMBOL}`,
    `- reference filter: ${BTC_SYMBOL} 15m momentum gate`,
    `- style: PENGU-inspired breakout confirmation, long-only`,
    `- start: ${new Date(START_TS).toISOString()}`,
    `- end: ${new Date(END_TS).toISOString()}`,
    `- HYPE 1m bars: ${hype1m.length}`,
    `- HYPE 15m bars: ${hype15m.length}`,
    `- BTC 15m bars: ${btc15m.length}`,
    `- fee model: Aster taker ${round(TAKER_FEE_PER_SIDE * 100, 4)}% per side`,
    "",
    "## Summary",
    "",
    "| variant | return % | end equity | max DD % | trades | win rate % | PF | avg pnl % | avg hold min |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((row) => `| ${row.key} | ${row.returnPct} | ${row.endEquity.toLocaleString()} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.profitFactor} | ${row.avgPnlPct} | ${row.avgHoldMinutes} |`),
    "",
    "## Readout",
    "",
    `- best end equity: ${best.key} (${best.endEquity.toLocaleString()}, ${best.returnPct}%)`,
    `- best win rate: ${[...results].sort((left, right) => right.winRatePct - left.winRatePct)[0].key}`,
    `- highest activity: ${[...results].sort((left, right) => right.trades - left.trades)[0].key}`,
    "",
    "## Notes",
    "",
    "- This version intentionally drops the loose independent HYPE regime logic and instead mimics the PENGU flow: external market gate first, then HYPE breakout confirmation.",
    "- All variants are long-only because the first pass showed HYPE short logic damaged win rate badly.",
    "- If this still underperforms, the next iteration should test BTC gate strength and HYPE confirmation width before adding shorts.",
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify({ symbol: SYMBOL, startTs: START_TS, endTs: END_TS, results }, null, 2),
    "utf8",
  );
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
