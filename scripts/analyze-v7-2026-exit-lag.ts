import fs from "node:fs";
import path from "node:path";

type Trade = {
  trade_id: string;
  symbol: string;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  net_pnl: number;
  holding_bars: number;
  entry_reason: string;
  exit_reason: string;
};

type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type AnalyzedTrade = Trade & {
  interval: string;
  mfePct: number;
  maePct: number;
  exitMovePct: number;
  givebackPct: number;
  peakTime: string;
  troughTime: string;
  peakToExitHours: number;
  candleCount: number;
};

const rootDir = process.cwd();
const tradePath = path.join(rootDir, "reports", "v7-live-equivalent-fast", "trades.json");
const cacheDir = path.join(rootDir, ".cache", "hybrid-universe", "remote");
const outDir = path.join(rootDir, "reports", "v7-2026-exit-lag-analysis");

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function yenish(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function loadCandles(symbol: string, interval: string): Candle[] {
  const prefix = `${symbol.toUpperCase()}USDT-${interval}-`;
  const files = fs
    .readdirSync(cacheDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => {
      const full = path.join(cacheDir, name);
      return { name, full, stat: fs.statSync(full) };
    })
    .sort((a, b) => b.stat.size - a.stat.size || b.stat.mtimeMs - a.stat.mtimeMs);

  if (!files[0]) {
    throw new Error(`No candle cache found for ${symbol} ${interval}`);
  }

  return JSON.parse(fs.readFileSync(files[0].full, "utf8")) as Candle[];
}

const candleMemo = new Map<string, Candle[]>();
function candlesFor(symbol: string, interval: string): Candle[] {
  const key = `${symbol}:${interval}`;
  const cached = candleMemo.get(key);
  if (cached) return cached;
  const candles = loadCandles(symbol, interval);
  candleMemo.set(key, candles);
  return candles;
}

function intervalFor(trade: Trade): string {
  if (trade.symbol === "PENGU" && trade.entry_reason.includes("idle-breakout")) return "15m";
  return "1h";
}

function analyzeTrade(trade: Trade): AnalyzedTrade {
  const interval = intervalFor(trade);
  const entryTs = Date.parse(trade.entry_time);
  const exitTs = Date.parse(trade.exit_time);
  const candles = candlesFor(trade.symbol, interval).filter((candle) => candle.ts >= entryTs && candle.ts <= exitTs);

  let peak = trade.entry_price;
  let trough = trade.entry_price;
  let peakTs = entryTs;
  let troughTs = entryTs;

  for (const candle of candles) {
    if (candle.high > peak) {
      peak = candle.high;
      peakTs = candle.ts;
    }
    if (candle.low < trough) {
      trough = candle.low;
      troughTs = candle.ts;
    }
  }

  const mfePct = trade.entry_price > 0 ? peak / trade.entry_price - 1 : 0;
  const maePct = trade.entry_price > 0 ? trough / trade.entry_price - 1 : 0;
  const exitMovePct = trade.entry_price > 0 ? trade.exit_price / trade.entry_price - 1 : 0;

  return {
    ...trade,
    interval,
    mfePct,
    maePct,
    exitMovePct,
    givebackPct: mfePct - exitMovePct,
    peakTime: new Date(peakTs).toISOString(),
    troughTime: new Date(troughTs).toISOString(),
    peakToExitHours: (exitTs - peakTs) / 3_600_000,
    candleCount: candles.length,
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

const trades = JSON.parse(fs.readFileSync(tradePath, "utf8")) as Trade[];
const trades2026 = trades.filter((trade) => Date.parse(trade.entry_time) >= Date.parse("2026-01-01T00:00:00.000Z"));
const analyzed = trades2026.map(analyzeTrade);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "trades-2026-exit-lag.json"), JSON.stringify(analyzed, null, 2));

const bySymbol = [...groupBy(analyzed, (trade) => trade.symbol).entries()].map(([symbol, rows]) => {
  const pnl = rows.reduce((sum, row) => sum + row.net_pnl, 0);
  const avgGiveback = rows.reduce((sum, row) => sum + row.givebackPct, 0) / rows.length;
  const avgPeakToExit = rows.reduce((sum, row) => sum + row.peakToExitHours, 0) / rows.length;
  return { symbol, trades: rows.length, pnl, avgGiveback, avgPeakToExit };
});

const byExit = [...groupBy(analyzed, (trade) => trade.exit_reason).entries()].map(([exit, rows]) => {
  const pnl = rows.reduce((sum, row) => sum + row.net_pnl, 0);
  const avgMfe = rows.reduce((sum, row) => sum + row.mfePct, 0) / rows.length;
  const avgExitMove = rows.reduce((sum, row) => sum + row.exitMovePct, 0) / rows.length;
  const avgGiveback = rows.reduce((sum, row) => sum + row.givebackPct, 0) / rows.length;
  return { exit, trades: rows.length, pnl, avgMfe, avgExitMove, avgGiveback };
});

const largestGivebacks = [...analyzed]
  .sort((a, b) => b.givebackPct - a.givebackPct)
  .slice(0, 15);

const losingAfterProfit = analyzed
  .filter((trade) => trade.net_pnl < 0 && trade.mfePct > 0.01)
  .sort((a, b) => b.mfePct - a.mfePct);

const lines = [
  "# V7 2026 exit lag analysis",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Trades: ${analyzed.length}`,
  `Net PnL: ${yenish(analyzed.reduce((sum, row) => sum + row.net_pnl, 0))}`,
  "",
  "## By symbol",
  "",
  "| symbol | trades | net pnl | avg giveback | avg peak-to-exit hours |",
  "|---|---:|---:|---:|---:|",
  ...bySymbol
    .sort((a, b) => b.pnl - a.pnl)
    .map((row) => `| ${row.symbol} | ${row.trades} | ${yenish(row.pnl)} | ${pct(row.avgGiveback)} | ${row.avgPeakToExit.toFixed(1)} |`),
  "",
  "## By exit reason",
  "",
  "| exit reason | trades | net pnl | avg MFE | avg exit move | avg giveback |",
  "|---|---:|---:|---:|---:|---:|",
  ...byExit
    .sort((a, b) => a.pnl - b.pnl)
    .map((row) => `| ${row.exit} | ${row.trades} | ${yenish(row.pnl)} | ${pct(row.avgMfe)} | ${pct(row.avgExitMove)} | ${pct(row.avgGiveback)} |`),
  "",
  "## Largest givebacks",
  "",
  "| id | symbol | entry | exit | pnl | exit reason | MFE | exit move | giveback | peak-to-exit h |",
  "|---|---|---|---|---:|---|---:|---:|---:|---:|",
  ...largestGivebacks.map(
    (row) =>
      `| ${row.trade_id} | ${row.symbol} | ${row.entry_time} | ${row.exit_time} | ${yenish(row.net_pnl)} | ${row.exit_reason} | ${pct(row.mfePct)} | ${pct(row.exitMovePct)} | ${pct(row.givebackPct)} | ${row.peakToExitHours.toFixed(1)} |`,
  ),
  "",
  "## Losing trades that had at least +1% MFE",
  "",
  "| id | symbol | entry | exit | pnl | exit reason | MFE | MAE | exit move | giveback | peak-to-exit h |",
  "|---|---|---|---|---:|---|---:|---:|---:|---:|---:|",
  ...losingAfterProfit.map(
    (row) =>
      `| ${row.trade_id} | ${row.symbol} | ${row.entry_time} | ${row.exit_time} | ${yenish(row.net_pnl)} | ${row.exit_reason} | ${pct(row.mfePct)} | ${pct(row.maePct)} | ${pct(row.exitMovePct)} | ${pct(row.givebackPct)} | ${row.peakToExitHours.toFixed(1)} |`,
  ),
  "",
];

fs.writeFileSync(path.join(outDir, "summary.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
