import fs from "fs/promises";
import path from "path";

type GoldcatPosition = {
  id: string;
  key: string;
  coin: string;
  horizonSec: number;
  horizonLabel?: string;
  side: "Up" | "Down";
  strategyId?: string;
  strategyLabel?: string;
  entryPctApplied?: number;
  openTs: number;
  closeTs: number;
  openedAt?: string;
  closedAt?: string;
};

type Candle1m = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CostProfile = {
  key: string;
  feeBpsPerSide: number;
  slippageBpsPerSide: number;
};

type LatencyVariant = {
  key: string;
  delaySec: number;
};

type TradeResult = {
  id: string;
  coin: string;
  horizonSec: number;
  side: "Up" | "Down";
  strategyId: string | null;
  openTs: number;
  closeTs: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  pnlUsd: number;
};

type VariantSummary = {
  key: string;
  costKey: string;
  delaySec: number;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  pnlUsd: number;
  totalReturnPct: number;
  avgTradePct: number;
  maxDrawdownPct: number;
  btcTrades: number;
  btcPnlUsd: number;
  ethTrades: number;
  ethPnlUsd: number;
  tradesDetail: TradeResult[];
};

const GOLDCAT_REPORT_DIR = "C:\\Users\\dis\\Documents\\New trade\\reports\\goldcat\\current-strategy-backtests";
const CACHE_DIR = path.join(process.cwd(), ".cache", "goldcat-follower");
const REPORT_DIR = path.join(process.cwd(), "reports", "goldcat-follower-backtest");
const STARTING_CASH_USD = 100;

const COST_PROFILES: CostProfile[] = [
  { key: "frictionless", feeBpsPerSide: 0, slippageBpsPerSide: 0 },
  { key: "optimistic", feeBpsPerSide: 2, slippageBpsPerSide: 1 },
  { key: "base", feeBpsPerSide: 4, slippageBpsPerSide: 2 },
  { key: "stressed", feeBpsPerSide: 7, slippageBpsPerSide: 3 },
];

const LATENCY_VARIANTS: LatencyVariant[] = [
  { key: "delay_0s", delaySec: 0 },
  { key: "delay_15s", delaySec: 15 },
  { key: "delay_30s", delaySec: 30 },
  { key: "delay_60s", delaySec: 60 },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function iso(ts: number) {
  return new Date(ts).toISOString();
}

async function latestGoldcatReportFile() {
  const entries = await fs.readdir(GOLDCAT_REPORT_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^current_strategy_backtest_.*\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const latest = files.at(-1);
  if (!latest) throw new Error(`No GoldCat current-strategy backtest report found in ${GOLDCAT_REPORT_DIR}`);
  return path.join(GOLDCAT_REPORT_DIR, latest);
}

async function loadGoldcatSignals(reportFile: string) {
  const raw = await fs.readFile(reportFile, "utf8");
  const parsed = JSON.parse(raw);
  const positions = Array.isArray(parsed?.result?.positions) ? parsed.result.positions : Array.isArray(parsed?.positions) ? parsed.positions : [];
  return positions
    .filter((position: GoldcatPosition) =>
      (position.coin === "BTC" || position.coin === "ETH") &&
      (position.horizonSec === 300 || position.horizonSec === 900) &&
      Number.isFinite(position.openTs) &&
      Number.isFinite(position.closeTs) &&
      (position.side === "Up" || position.side === "Down")
    )
    .sort((left: GoldcatPosition, right: GoldcatPosition) => left.openTs - right.openTs) as GoldcatPosition[];
}

function minuteFloor(ts: number) {
  return Math.floor(ts / 60_000) * 60_000;
}

async function fetchBinance1m(symbol: string, startMs: number, endMs: number): Promise<Candle1m[]> {
  const out: Candle1m[] = [];
  let cursor = minuteFloor(startMs);
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Binance 1m request failed for ${symbol}: ${response.status}`);
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
  const dedup = new Map<number, Candle1m>();
  out.forEach((candle) => dedup.set(candle.ts, candle));
  return [...dedup.values()].sort((left, right) => left.ts - right.ts);
}

async function loadCached1m(symbol: string, startMs: number, endMs: number) {
  const filePath = path.join(CACHE_DIR, `${symbol}-${minuteFloor(startMs)}-${minuteFloor(endMs)}-1m.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Candle1m[];
  } catch {
    const candles = await fetchBinance1m(symbol, startMs, endMs);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function executionPrice(candles: Candle1m[], targetTs: number) {
  const execTs = Math.ceil(targetTs / 60_000) * 60_000;
  const candle = candles.find((row) => row.ts >= execTs);
  if (!candle) return null;
  return { ts: candle.ts, price: candle.open };
}

function simulateVariant(signals: GoldcatPosition[], priceMap: Map<string, Candle1m[]>, cost: CostProfile, latency: LatencyVariant): VariantSummary {
  const openTrades: Array<{ closeTs: number; pnlUsd: number }> = [];
  const trades: TradeResult[] = [];
  let cashUsd = STARTING_CASH_USD;
  let peakEquityUsd = STARTING_CASH_USD;
  let maxDrawdownPct = 0;

  const settleDue = (ts: number) => {
    openTrades.sort((left, right) => left.closeTs - right.closeTs);
    while (openTrades.length && openTrades[0].closeTs <= ts) {
      const settled = openTrades.shift()!;
      cashUsd += settled.pnlUsd;
      peakEquityUsd = Math.max(peakEquityUsd, cashUsd);
      maxDrawdownPct = Math.min(maxDrawdownPct, (cashUsd / peakEquityUsd) - 1);
    }
  };

  for (const signal of signals) {
    settleDue(signal.openTs);
    const symbol = `${signal.coin}USDT`;
    const candles = priceMap.get(symbol);
    if (!candles?.length) continue;
    const entry = executionPrice(candles, signal.openTs + (latency.delaySec * 1000));
    const exit = executionPrice(candles, signal.closeTs + (latency.delaySec * 1000));
    if (!entry || !exit) continue;

    const stakeUsd = STARTING_CASH_USD * Number(signal.entryPctApplied || 0.05);
    const side = signal.side === "Up" ? "long" : "short";
    const grossReturn = side === "long"
      ? ((exit.price / entry.price) - 1)
      : ((entry.price / exit.price) - 1);
    const totalCostPct = ((cost.feeBpsPerSide + cost.slippageBpsPerSide) * 2) / 10_000;
    const netReturn = grossReturn - totalCostPct;
    const pnlUsd = stakeUsd * netReturn;

    cashUsd -= stakeUsd;
    openTrades.push({ closeTs: exit.ts, pnlUsd: stakeUsd + pnlUsd });

    trades.push({
      id: signal.id,
      coin: signal.coin,
      horizonSec: signal.horizonSec,
      side: signal.side,
      strategyId: signal.strategyId || null,
      openTs: signal.openTs,
      closeTs: signal.closeTs,
      entryTs: entry.ts,
      exitTs: exit.ts,
      entryPrice: entry.price,
      exitPrice: exit.price,
      grossReturnPct: grossReturn * 100,
      netReturnPct: netReturn * 100,
      pnlUsd,
    });
  }

  settleDue(Number.MAX_SAFE_INTEGER);

  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const btcTrades = trades.filter((trade) => trade.coin === "BTC");
  const ethTrades = trades.filter((trade) => trade.coin === "ETH");
  const pnlUsd = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);

  return {
    key: `${cost.key}_${latency.key}`,
    costKey: cost.key,
    delaySec: latency.delaySec,
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    pnlUsd,
    totalReturnPct: (pnlUsd / STARTING_CASH_USD) * 100,
    avgTradePct: trades.length ? trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length : 0,
    maxDrawdownPct: maxDrawdownPct * 100,
    btcTrades: btcTrades.length,
    btcPnlUsd: btcTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0),
    ethTrades: ethTrades.length,
    ethPnlUsd: ethTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0),
    tradesDetail: trades,
  };
}

async function writeReport(input: {
  reportFile: string;
  sourceRange: { start: string; end: string };
  signals: GoldcatPosition[];
  summaries: VariantSummary[];
}) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "result.json");
  const mdPath = path.join(REPORT_DIR, "result.md");
  const md = [
    "# GoldCat Follower Backtest",
    "",
    `- source report: ${input.reportFile}`,
    `- source window: ${input.sourceRange.start} to ${input.sourceRange.end}`,
    `- signals used: ${input.signals.length} (BTC/ETH only)`,
    `- holding rule: enter after GoldCat signal, force close after reported horizonSec`,
    `- execution model: next 1m candle open after signal time plus delay`,
    "",
    "| variant | return % | pnl usd | max DD % | trades | win rate % | btc pnl | eth pnl | avg trade % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...input.summaries.map((row) =>
      `| ${row.key} | ${round(row.totalReturnPct)} | ${round(row.pnlUsd)} | ${round(row.maxDrawdownPct)} | ${row.trades} | ${round(row.winRatePct)} | ${round(row.btcPnlUsd)} | ${round(row.ethPnlUsd)} | ${round(row.avgTradePct, 3)} |`
    ),
    "",
    "## Notes",
    "- Live follower should subscribe to GoldCat `/api/events` and detect new `openPositions` IDs for BTC or ETH only.",
    "- Side mapping is `Up => long`, `Down => short`.",
    "- Exit rule is fixed-time close using `horizonSec` from the GoldCat position.",
    "- Current saved sample contains 5m BTC/ETH signals only. 15m follower path is designed, but no 15m BTC live signals were present in the input sample.",
  ].join("\n");

  await fs.writeFile(jsonPath, JSON.stringify(input, null, 2), "utf8");
  await fs.writeFile(mdPath, md, "utf8");
}

async function main() {
  const reportFile = await latestGoldcatReportFile();
  const signals = await loadGoldcatSignals(reportFile);
  if (!signals.length) throw new Error("No BTC/ETH GoldCat positions found in latest current-strategy backtest report");

  const startMs = Math.min(...signals.map((signal) => signal.openTs)) - (60 * 60 * 1000);
  const endMs = Math.max(...signals.map((signal) => signal.closeTs)) + (60 * 60 * 1000);

  const [btcCandles, ethCandles] = await Promise.all([
    loadCached1m("BTCUSDT", startMs, endMs),
    loadCached1m("ETHUSDT", startMs, endMs),
  ]);
  const priceMap = new Map<string, Candle1m[]>([
    ["BTCUSDT", btcCandles],
    ["ETHUSDT", ethCandles],
  ]);

  const summaries = COST_PROFILES.flatMap((cost) => LATENCY_VARIANTS.map((latency) => simulateVariant(signals, priceMap, cost, latency)))
    .sort((left, right) => right.pnlUsd - left.pnlUsd);

  await writeReport({
    reportFile,
    sourceRange: {
      start: iso(startMs),
      end: iso(endMs),
    },
    signals,
    summaries: summaries.map((summary) => ({
      ...summary,
      tradesDetail: summary.tradesDetail.slice(0, 30),
    })),
  });

  console.log(JSON.stringify(summaries.map((summary) => ({
    key: summary.key,
    trades: summary.trades,
    winRatePct: round(summary.winRatePct),
    pnlUsd: round(summary.pnlUsd),
    totalReturnPct: round(summary.totalReturnPct),
    maxDrawdownPct: round(summary.maxDrawdownPct),
    btcPnlUsd: round(summary.btcPnlUsd),
    ethPnlUsd: round(summary.ethPnlUsd),
    avgTradePct: round(summary.avgTradePct, 3),
  })), null, 2));
}

main().catch((error) => {
  console.error("[backtest-goldcat-follower] failed:", error);
  process.exitCode = 1;
});
