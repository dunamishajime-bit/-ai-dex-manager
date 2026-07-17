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

type ProxyVariant = {
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

type BaseTrade = {
  symbol: "PENGU" | "HYPE" | "ETH";
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

type ThirdLaneTrade = {
  entryIso: string;
  exitIso: string;
  pnlPct: number;
};

const REPORT_DIR = path.join(process.cwd(), "reports", "third-lane-overlap");
const CACHE_DIR = path.join(process.cwd(), ".cache", "third-lane-overlap");
const HYPE_REPORT_JSON = path.join(process.cwd(), "reports", "hype-15m", "result.json");
const THIRD_LANE_REPORT_JSON = path.join(process.cwd(), "reports", "third-lane-candidates", "result.json");
const BINANCE_BASE_URL = "https://api.binance.com";
const START_TS = Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 5, 5, 23, 59, 59, 999);
const RETRY_DELAYS_MS = [1000, 2500, 5000];
const STARTING_EQUITY = 10_000;

const PENGU_PROXY_VARIANT: ProxyVariant = {
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

async function fetchKlines(symbol: string, interval: "1m" | "15m") {
  const cachePath = path.join(CACHE_DIR, `binance-${symbol}-${interval}-${START_TS}-${END_TS}.json`);
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8")) as Candle[];
  } catch {
    const out: Candle[] = [];
    let cursor = START_TS;
    while (cursor < END_TS) {
      const url = `${BINANCE_BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${cursor}&endTime=${END_TS}&limit=1000`;
      let response: Response | null = null;
      let lastStatus = 0;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        response = await fetch(url, { cache: "no-store" });
        lastStatus = response.status;
        if (response.ok) break;
        if (attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
      if (!response?.ok) throw new Error(`Binance klines request failed for ${symbol} ${interval}: ${lastStatus}`);
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

function findBreakoutConfirmation(candles1m: Candle[], signalTs: number, signalPrice: number, variant: ProxyVariant) {
  const confirmUntil = signalTs + (variant.confirmMinutes * 60_000);
  const breakoutPct = variant.confirmBreakoutBps / 10_000;
  for (const candle of candles1m) {
    if (candle.ts < signalTs) continue;
    if (candle.ts > confirmUntil) break;
    if (candle.high >= signalPrice * (1 + breakoutPct)) return candle.ts;
  }
  return null;
}

function runTrade(candles1m: Candle[], signalTs: number, variant: ProxyVariant) {
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

function qualifiesBtc(row: Feature15m | null, variant: ProxyVariant) {
  if (!row) return false;
  return row.close > row.ema20
    && row.ema20 > row.ema48
    && row.close >= row.high3
    && row.moveBps >= variant.btcMinMoveBps
    && row.moveBps <= variant.btcMaxMoveBps
    && row.accelBps >= variant.btcMinAccelBps;
}

function qualifiesSymbol(row: Feature15m, variant: ProxyVariant) {
  const distanceFromEma20Bps = ((row.close / Math.max(row.ema20, 0.0000001)) - 1) * 10_000;
  return row.close > row.ema20
    && row.ema20 > row.ema48
    && row.close >= row.high3
    && row.moveBps >= variant.symbolMinMoveBps
    && row.accelBps >= variant.symbolMinAccelBps
    && distanceFromEma20Bps <= variant.symbolMaxDistanceBps;
}

function collectProxyPenguTrades(symbol1m: Candle[], symbol15m: Feature15m[], btc15m: Feature15m[], variant: ProxyVariant) {
  const trades: BaseTrade[] = [];
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
      symbol: "PENGU",
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

async function loadThirdLaneTrades(symbol: string, variantKey: string) {
  const raw = JSON.parse(await fs.readFile(THIRD_LANE_REPORT_JSON, "utf8")) as {
    results: Array<{ symbol: string; key: string; tradesDetail: ThirdLaneTrade[] }>;
  };
  const match = raw.results.find((row) => row.symbol === symbol && row.key === variantKey);
  if (!match) throw new Error(`Third-lane variant not found: ${symbol} ${variantKey}`);
  return match.tradesDetail.map((trade) => ({
    symbol: "ETH" as const,
    entryTs: Date.parse(trade.entryIso),
    exitTs: Date.parse(trade.exitIso),
    entryIso: trade.entryIso,
    exitIso: trade.exitIso,
    pnlPct: trade.pnlPct,
  }));
}

function summarizeTrades(trades: BaseTrade[]) {
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

function countOverlap(source: BaseTrade[], reference: BaseTrade[], windowMinutes: number) {
  const windowMs = windowMinutes * 60_000;
  let overlapCount = 0;
  for (const trade of source) {
    const hasMatch = reference.some((other) => Math.abs(other.entryTs - trade.entryTs) <= windowMs);
    if (hasMatch) overlapCount += 1;
  }
  return overlapCount;
}

function buildSharedSlotPortfolio(trades: BaseTrade[]) {
  const accepted: BaseTrade[] = [];
  const rejected: BaseTrade[] = [];
  let activeUntil = -Infinity;
  const sorted = [...trades].sort((a, b) => {
    if (a.entryTs !== b.entryTs) return a.entryTs - b.entryTs;
    const priority = { PENGU: 0, HYPE: 1, ETH: 2 } as const;
    return priority[a.symbol] - priority[b.symbol];
  });

  for (const trade of sorted) {
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
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const [pengu1m, pengu15mRaw, btc15mRaw, hypeTrades, ethStrictTrades, ethBalancedTrades] = await Promise.all([
    fetchKlines("PENGUUSDT", "1m"),
    fetchKlines("PENGUUSDT", "15m"),
    fetchKlines("BTCUSDT", "15m"),
    loadHypeTrades("pengu_style_freq"),
    loadThirdLaneTrades("ETHUSDT", "reclaim_strict"),
    loadThirdLaneTrades("ETHUSDT", "reclaim_balanced"),
  ]);

  const pengu15m = build15mFeatures(pengu15mRaw);
  const btc15m = build15mFeatures(btc15mRaw);
  const penguTrades = collectProxyPenguTrades(pengu1m, pengu15m, btc15m, PENGU_PROXY_VARIANT);
  const baseStack = [...penguTrades, ...hypeTrades];
  const baseSummary = summarizeTrades(baseStack);
  const baseShared = buildSharedSlotPortfolio(baseStack);

  const candidates = [
    { key: "reclaim_strict", title: "ETH reclaim_strict", trades: ethStrictTrades },
    { key: "reclaim_balanced", title: "ETH reclaim_balanced", trades: ethBalancedTrades },
  ];

  const rows: string[] = [
    "# Third Lane Overlap Check",
    "",
    "## Setup",
    "",
    "- caveat: historical full-period GoldCat data is not available locally, so PENGU is compared with a BTC-gated breakout proxy rather than the exact production combined feed.",
    "- reference live stack: proxy PENGU freq-style + HYPE pengu_style_freq.",
    "- candidate lane: ETH reclaim variants from the stricter quality-filter backtest.",
    "",
    "## Reference Stack",
    "",
    `- proxy PENGU trades: ${penguTrades.length}`,
    `- HYPE freq trades: ${hypeTrades.length}`,
    `- union trades (independent count): ${baseStack.length}`,
    `- shared-slot accepted: ${baseShared.summary.trades}, conflicts: ${baseShared.rejected.length}, return: ${baseShared.summary.returnPct}%`,
    "",
    "## Candidate Summary",
    "",
    "| candidate | trades | win rate % | return % | overlap ±15m vs PENGU | overlap ±15m vs HYPE | overlap ±15m vs either | overlap ±60m vs either | shared-slot accepted | shared conflicts | shared return % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  const output: any[] = [];

  for (const candidate of candidates) {
    const candidateSummary = summarizeTrades(candidate.trades);
    const overlap15Pengu = countOverlap(candidate.trades, penguTrades, 15);
    const overlap15Hype = countOverlap(candidate.trades, hypeTrades, 15);
    const overlap15Either = countOverlap(candidate.trades, baseStack, 15);
    const overlap60Either = countOverlap(candidate.trades, baseStack, 60);
    const withThird = buildSharedSlotPortfolio([...baseStack, ...candidate.trades]);

    rows.push(`| ${candidate.title} | ${candidateSummary.trades} | ${candidateSummary.winRatePct} | ${candidateSummary.returnPct} | ${overlap15Pengu}/${candidate.trades.length} | ${overlap15Hype}/${candidate.trades.length} | ${overlap15Either}/${candidate.trades.length} | ${overlap60Either}/${candidate.trades.length} | ${withThird.summary.trades} | ${withThird.rejected.length} | ${withThird.summary.returnPct} |`);
    rows.push("");
    rows.push(`### ${candidate.title}`);
    rows.push("");
    rows.push(`- standalone: ${candidateSummary.trades} trades, win rate ${candidateSummary.winRatePct}%, return ${candidateSummary.returnPct}%, max DD ${candidateSummary.maxDrawdownPct}%`);
    rows.push(`- overlap within ±15m: PENGU ${overlap15Pengu}, HYPE ${overlap15Hype}, either stack ${overlap15Either}`);
    rows.push(`- overlap within ±60m vs either stack: ${overlap60Either}`);
    rows.push(`- shared-slot with existing stack: accepted ${withThird.summary.trades}, conflicts ${withThird.rejected.length}, return ${withThird.summary.returnPct}%`);
    rows.push(`- accepted symbol mix: PENGU ${withThird.accepted.filter((trade) => trade.symbol === "PENGU").length}, HYPE ${withThird.accepted.filter((trade) => trade.symbol === "HYPE").length}, ETH ${withThird.accepted.filter((trade) => trade.symbol === "ETH").length}`);
    rows.push("");

    output.push({
      candidate: candidate.key,
      candidateSummary,
      overlap15Pengu,
      overlap15Hype,
      overlap15Either,
      overlap60Either,
      sharedWithExisting: withThird,
    });
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.md"), rows.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(output, null, 2), "utf8");
  console.log(rows.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
