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
  btcMinMoveBps: number;
  btcMinAccelBps: number;
  btcMaxMoveBps: number;
  symbolMinMoveBps: number;
  symbolMinAccelBps: number;
  symbolMaxDistanceBps: number;
  confirmBreakoutBps: number;
  confirmMinutes: number;
  holdMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
};

type Trade = {
  symbol: "PENGU" | "HYPE";
  entryTs: number;
  exitTs: number;
  entryIso: string;
  exitIso: string;
  pnlPct: number;
};

type HypeReportTrade = {
  entryIso: string;
  exitIso: string;
  pnlPct: number;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-hype-shared-slot");
const CACHE_DIR = path.join(process.cwd(), ".cache", "proxy-overlap");
const HYPE_REPORT_JSON = path.join(process.cwd(), "reports", "hype-15m", "result.json");
const ASTER_BASE_URL = "https://fapi.asterdex.com";
const BINANCE_BASE_URL = "https://api.binance.com";
const START_TS = Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 5, 5, 23, 59, 59, 999);
const RETRY_DELAYS_MS = [1000, 2500, 5000];
const STARTING_EQUITY = 10_000;

const VARIANTS: Record<string, Variant> = {
  pengu_style_balanced: {
    key: "pengu_style_balanced",
    btcMinMoveBps: 4,
    btcMinAccelBps: 0,
    btcMaxMoveBps: 40,
    symbolMinMoveBps: 10,
    symbolMinAccelBps: 0,
    symbolMaxDistanceBps: 55,
    confirmBreakoutBps: 8,
    confirmMinutes: 4,
    holdMinutes: 25,
    stopLossPct: 0.0038,
    takeProfitPct: 0.02,
    trailActivationPct: 0.009,
    trailRetracePct: 0.0045,
  },
  pengu_style_freq: {
    key: "pengu_style_freq",
    btcMinMoveBps: 3,
    btcMinAccelBps: -1,
    btcMaxMoveBps: 45,
    symbolMinMoveBps: 8,
    symbolMinAccelBps: -1,
    symbolMaxDistanceBps: 65,
    confirmBreakoutBps: 8,
    confirmMinutes: 5,
    holdMinutes: 25,
    stopLossPct: 0.004,
    takeProfitPct: 0.018,
    trailActivationPct: 0.008,
    trailRetracePct: 0.004,
  },
};

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ema(prev: number | null, value: number, period: number) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : (value * alpha) + (prev * (1 - alpha));
}

function intervalMs(interval: "1m" | "15m") {
  return interval === "1m" ? 60_000 : 15 * 60_000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchKlines(params: {
  baseUrl: string;
  klinesPath: string;
  venueKey: string;
  symbol: string;
  interval: "1m" | "15m";
}) {
  const { baseUrl, klinesPath, venueKey, symbol, interval } = params;
  const cachePath = path.join(CACHE_DIR, `${venueKey}-${symbol}-${interval}-${START_TS}-${END_TS}.json`);
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const out: Candle[] = [];
    let cursor = START_TS;
    while (cursor < END_TS) {
      const url = `${baseUrl}${klinesPath}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${END_TS}&limit=1000`;
      let response: Response | null = null;
      let lastStatus = 0;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        response = await fetch(url, { cache: "no-store" });
        lastStatus = response.status;
        if (response.ok) break;
        if (attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
      if (!response?.ok) throw new Error(`${venueKey} klines request failed for ${symbol} ${interval}: ${lastStatus}`);
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
      const nextTs = Number(Array.isArray(last) ? last[6] : 0);
      if (!Number.isFinite(nextTs) || nextTs <= cursor) cursor += intervalMs(interval);
      else cursor = nextTs;
    }
    const dedup = new Map<number, Candle>();
    for (const candle of out) dedup.set(candle.ts, candle);
    const normalized = [...dedup.values()].sort((a, b) => a.ts - b.ts);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(normalized), "utf8");
    return normalized;
  }
}

function build15mFeatures(candles: Candle[]) {
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
    out.push({
      ...candle,
      ema20: ema20 ?? candle.close,
      ema48: ema48 ?? candle.close,
      moveBps,
      accelBps,
      high3: lookback.length ? Math.max(...lookback.map((row) => row.high)) : candle.high,
      low3: lookback.length ? Math.min(...lookback.map((row) => row.low)) : candle.low,
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
    if (candle.high >= signalPrice * (1 + breakoutPct)) return candle.ts;
  }
  return null;
}

function runTrade(candles1m: Candle[], signalTs: number, variant: Variant) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const stop = entry.price * (1 - variant.stopLossPct);
  const take = entry.price * (1 + variant.takeProfitPct);
  let peak = entry.price;
  let exitTs = entry.ts;
  let exitPrice = entry.price;
  const holdUntil = entry.ts + (variant.holdMinutes * 60_000);
  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    const trail = peak >= entry.price * (1 + variant.trailActivationPct) ? peak * (1 - variant.trailRetracePct) : null;
    if (candle.low <= stop) { exitTs = candle.ts; exitPrice = stop; break; }
    if (candle.high >= take) { exitTs = candle.ts; exitPrice = take; break; }
    if (trail != null && candle.low <= trail) { exitTs = candle.ts; exitPrice = trail; break; }
    exitTs = candle.ts;
    exitPrice = candle.close;
  }
  const pnlPct = ((exitPrice / entry.price) - 1) - 0.0008;
  return { entryTs: entry.ts, exitTs, pnlPct: pnlPct * 100 };
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

function qualifiesSymbol(row: Feature15m, variant: Variant) {
  const distanceFromEma20Bps = ((row.close / Math.max(row.ema20, 0.0000001)) - 1) * 10_000;
  return row.close > row.ema20
    && row.ema20 > row.ema48
    && row.close >= row.high3
    && row.moveBps >= variant.symbolMinMoveBps
    && row.accelBps >= variant.symbolMinAccelBps
    && distanceFromEma20Bps <= variant.symbolMaxDistanceBps;
}

function collectProxyTrades(symbolLabel: "PENGU" | "HYPE", symbol1m: Candle[], symbol15m: Feature15m[], btc15m: Feature15m[], variant: Variant) {
  const trades: Trade[] = [];
  let lastExitTs = -Infinity;
  for (let i = 50; i < symbol15m.length; i += 1) {
    const symbol = symbol15m[i];
    if (symbol.ts < lastExitTs) continue;
    const btc = latestAtOrBefore(btc15m, symbol.ts);
    if (!qualifiesBtc(btc, variant)) continue;
    if (!qualifiesSymbol(symbol, variant)) continue;
    const signalPrice = executionPrice(symbol1m, symbol.ts)?.price;
    if (!signalPrice) continue;
    const confirmedTs = findBreakoutConfirmation(symbol1m, symbol.ts, signalPrice, variant);
    if (!confirmedTs) continue;
    const trade = runTrade(symbol1m, confirmedTs, variant);
    if (!trade) continue;
    trades.push({
      symbol: symbolLabel,
      entryTs: trade.entryTs,
      exitTs: trade.exitTs,
      entryIso: new Date(trade.entryTs).toISOString(),
      exitIso: new Date(trade.exitTs).toISOString(),
      pnlPct: round(trade.pnlPct, 4),
    });
    lastExitTs = trade.exitTs;
  }
  return trades;
}

async function loadHypeTrades(variantKey: string) {
  const raw = JSON.parse(await fs.readFile(HYPE_REPORT_JSON, "utf8")) as {
    results: Array<{ key: string; tradesDetail: HypeReportTrade[] }>;
  };
  const variant = raw.results.find((row) => row.key === variantKey);
  if (!variant) throw new Error(`HYPE variant not found in report: ${variantKey}`);
  return variant.tradesDetail.map((trade) => ({
    symbol: "HYPE" as const,
    entryTs: Date.parse(trade.entryIso),
    exitTs: Date.parse(trade.exitIso),
    entryIso: trade.entryIso,
    exitIso: trade.exitIso,
    pnlPct: trade.pnlPct,
  }));
}

function summarizeTrades(trades: Trade[]) {
  let equity = STARTING_EQUITY;
  let peak = STARTING_EQUITY;
  let maxDd = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const trade of trades) {
    if (trade.pnlPct > 0) wins += 1;
    if (trade.pnlPct > 0) grossProfit += trade.pnlPct;
    else grossLoss += Math.abs(trade.pnlPct);
    equity *= 1 + (trade.pnlPct / 100);
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity / peak) - 1);
  }
  return {
    trades: trades.length,
    winRatePct: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    returnPct: round(((equity / STARTING_EQUITY) - 1) * 100, 2),
    endEquity: round(equity, 2),
    maxDrawdownPct: round(maxDd * 100, 2),
    avgPnlPct: trades.length ? round(trades.reduce((sum, t) => sum + t.pnlPct, 0) / trades.length, 4) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : 0,
  };
}

function buildSharedSlotPortfolio(params: {
  penguTrades: Trade[];
  hypeTrades: Trade[];
  priority: "first" | "pengu" | "hype";
}) {
  const { penguTrades, hypeTrades, priority } = params;
  const all = [...penguTrades, ...hypeTrades].sort((a, b) => {
    if (a.entryTs !== b.entryTs) return a.entryTs - b.entryTs;
    if (priority === "pengu") return a.symbol === "PENGU" ? -1 : 1;
    if (priority === "hype") return a.symbol === "HYPE" ? -1 : 1;
    return a.symbol.localeCompare(b.symbol);
  });

  const accepted: Trade[] = [];
  const rejected: Trade[] = [];
  let activeUntil = -Infinity;
  for (const trade of all) {
    if (trade.entryTs < activeUntil) {
      rejected.push(trade);
      continue;
    }
    accepted.push(trade);
    activeUntil = trade.exitTs;
  }
  return { accepted, rejected, summary: summarizeTrades(accepted) };
}

async function main() {
  const variantKeys = ["pengu_style_balanced", "pengu_style_freq"] as const;
  const [pengu1m, pengu15mRaw, btc15mRaw] = await Promise.all([
    fetchKlines({ baseUrl: BINANCE_BASE_URL, klinesPath: "/api/v3/klines", venueKey: "binance", symbol: "PENGUUSDT", interval: "1m" }),
    fetchKlines({ baseUrl: BINANCE_BASE_URL, klinesPath: "/api/v3/klines", venueKey: "binance", symbol: "PENGUUSDT", interval: "15m" }),
    fetchKlines({ baseUrl: BINANCE_BASE_URL, klinesPath: "/api/v3/klines", venueKey: "binance", symbol: "BTCUSDT", interval: "15m" }),
  ]);

  const pengu15m = build15mFeatures(pengu15mRaw);
  const btc15m = build15mFeatures(btc15mRaw);

  const rows: string[] = [
    "# PENGU + HYPE Shared Slot",
    "",
    "## Setup",
    "",
    "- caveat: historical full-period GoldCat data is not available locally, so PENGU is compared with a BTC-gated breakout proxy rather than the exact production combined feed.",
    "- constraint: only one position can be open at a time across PENGU and HYPE.",
    "",
    "## Summary",
    "",
    "| variant | source | trades | win rate % | return % | end equity | max DD % | PF | avg pnl % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  const output: any[] = [];

  for (const variantKey of variantKeys) {
    const variant = VARIANTS[variantKey];
    const penguTrades = collectProxyTrades("PENGU", pengu1m, pengu15m, btc15m, variant);
    const hypeTrades = await loadHypeTrades(variantKey);

    const penguSummary = summarizeTrades(penguTrades);
    const hypeSummary = summarizeTrades(hypeTrades);
    const sharedFirst = buildSharedSlotPortfolio({ penguTrades, hypeTrades, priority: "first" });
    const sharedPengu = buildSharedSlotPortfolio({ penguTrades, hypeTrades, priority: "pengu" });
    const sharedHype = buildSharedSlotPortfolio({ penguTrades, hypeTrades, priority: "hype" });

    rows.push(`| ${variantKey} | proxy PENGU | ${penguSummary.trades} | ${penguSummary.winRatePct} | ${penguSummary.returnPct} | ${penguSummary.endEquity.toLocaleString()} | ${penguSummary.maxDrawdownPct} | ${penguSummary.profitFactor} | ${penguSummary.avgPnlPct} |`);
    rows.push(`| ${variantKey} | HYPE | ${hypeSummary.trades} | ${hypeSummary.winRatePct} | ${hypeSummary.returnPct} | ${hypeSummary.endEquity.toLocaleString()} | ${hypeSummary.maxDrawdownPct} | ${hypeSummary.profitFactor} | ${hypeSummary.avgPnlPct} |`);
    rows.push(`| ${variantKey} | shared slot first-come | ${sharedFirst.summary.trades} | ${sharedFirst.summary.winRatePct} | ${sharedFirst.summary.returnPct} | ${sharedFirst.summary.endEquity.toLocaleString()} | ${sharedFirst.summary.maxDrawdownPct} | ${sharedFirst.summary.profitFactor} | ${sharedFirst.summary.avgPnlPct} |`);
    rows.push(`| ${variantKey} | shared slot prefer PENGU | ${sharedPengu.summary.trades} | ${sharedPengu.summary.winRatePct} | ${sharedPengu.summary.returnPct} | ${sharedPengu.summary.endEquity.toLocaleString()} | ${sharedPengu.summary.maxDrawdownPct} | ${sharedPengu.summary.profitFactor} | ${sharedPengu.summary.avgPnlPct} |`);
    rows.push(`| ${variantKey} | shared slot prefer HYPE | ${sharedHype.summary.trades} | ${sharedHype.summary.winRatePct} | ${sharedHype.summary.returnPct} | ${sharedHype.summary.endEquity.toLocaleString()} | ${sharedHype.summary.maxDrawdownPct} | ${sharedHype.summary.profitFactor} | ${sharedHype.summary.avgPnlPct} |`);

    rows.push("");
    rows.push(`### ${variantKey}`);
    rows.push("");
    rows.push(`- conflict count first-come: ${sharedFirst.rejected.length}`);
    rows.push(`- conflict count prefer PENGU: ${sharedPengu.rejected.length}`);
    rows.push(`- conflict count prefer HYPE: ${sharedHype.rejected.length}`);
    rows.push(`- accepted symbol mix first-come: PENGU ${sharedFirst.accepted.filter((t) => t.symbol === "PENGU").length}, HYPE ${sharedFirst.accepted.filter((t) => t.symbol === "HYPE").length}`);
    rows.push("");

    output.push({
      variantKey,
      penguSummary,
      hypeSummary,
      sharedFirst,
      sharedPengu,
      sharedHype,
    });
  }

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), rows.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(output, null, 2), "utf8");
  console.log(rows.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
