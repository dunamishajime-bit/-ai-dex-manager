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

const root = process.cwd();
const outDir = path.join(root, "reports", "v7-pengu-entry-features");
const tradePath = fs.existsSync(path.join(root, "reports", "v7-pengu-conditional-protect", "full-current-trades.json"))
  ? path.join(root, "reports", "v7-pengu-conditional-protect", "full-current-trades.json")
  : path.join(root, "reports", "v7-live-equivalent-fast", "trades.json");
const candlePath = path.join(root, ".cache", "hybrid-universe", "remote", "PENGUUSDT-15m-1672531200000-1778889599999-v1.json");

function sma(rows: Candle[], index: number, n: number, field: keyof Candle = "close") {
  if (index + 1 < n) return NaN;
  let sum = 0;
  for (let i = index - n + 1; i <= index; i += 1) sum += Number(rows[i][field]);
  return sum / n;
}

function mom(rows: Candle[], index: number, n: number) {
  if (index < n) return NaN;
  return rows[index].close / rows[index - n].close - 1;
}

function rangePct(rows: Candle[], index: number, n: number) {
  if (index + 1 < n) return NaN;
  const slice = rows.slice(index - n + 1, index + 1);
  const high = Math.max(...slice.map((row) => row.high));
  const low = Math.min(...slice.map((row) => row.low));
  return high / low - 1;
}

function pathPct(rows: Candle[], index: number, n: number) {
  if (index + 1 < n) return NaN;
  let sum = 0;
  for (let i = index - n + 2; i <= index; i += 1) {
    sum += Math.abs(rows[i].close / rows[i - 1].close - 1);
  }
  return sum;
}

function maxFuture(rows: Candle[], index: number, bars: number, entry: number) {
  const slice = rows.slice(index, index + bars + 1);
  const high = Math.max(...slice.map((row) => row.high));
  return high / entry - 1;
}

function minFuture(rows: Candle[], index: number, bars: number, entry: number) {
  const slice = rows.slice(index, index + bars + 1);
  const low = Math.min(...slice.map((row) => row.low));
  return low / entry - 1;
}

function fmt(value: number, digits = 3) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(digits);
}

fs.mkdirSync(outDir, { recursive: true });
const trades = JSON.parse(fs.readFileSync(tradePath, "utf8")) as Trade[];
const candles = JSON.parse(fs.readFileSync(candlePath, "utf8")) as Candle[];
const indexByTs = new Map(candles.map((row, index) => [row.ts, index]));

const rows = trades
  .filter((trade) => trade.symbol === "PENGU")
  .map((trade) => {
    const ts = Date.parse(trade.entry_time);
    const index = indexByTs.get(ts) ?? candles.findIndex((row) => row.ts >= ts);
    const row = candles[index];
    const mom20 = mom(candles, index, 20);
    const mom80 = mom(candles, index, 80);
    const accel = mom20 - mom(candles, index - 1, 20);
    const vol20 = sma(candles, index, 20, "volume");
    const volumeRatio = vol20 > 0 ? row.volume / vol20 : NaN;
    const sma40 = sma(candles, index, 40);
    const distSma40 = row.close / sma40 - 1;
    const range96 = rangePct(candles, index, 96);
    const path96 = pathPct(candles, index, 96);
    const future5 = maxFuture(candles, index, 16, trade.entry_price);
    const future10 = maxFuture(candles, index, 48, trade.entry_price);
    const futureLow = minFuture(candles, index, 48, trade.entry_price);
    return {
      id: trade.trade_id,
      entry: trade.entry_time,
      exit: trade.exit_time,
      pnl: trade.net_pnl,
      exitReason: trade.exit_reason,
      hold: trade.holding_bars,
      price: trade.entry_price,
      move: trade.exit_price / trade.entry_price - 1,
      mom20,
      mom80,
      accel,
      volumeRatio,
      distSma40,
      range96,
      path96,
      future16Max: future5,
      future48Max: future10,
      future48Low: futureLow,
    };
  });

fs.writeFileSync(path.join(outDir, "features.json"), JSON.stringify(rows, null, 2));

const groups = [
  { key: "idle_time_losers", rows: rows.filter((row) => row.exitReason === "idle-breakout-time" && row.pnl < 0) },
  { key: "big_winners", rows: rows.filter((row) => row.pnl > 1000000 || row.move > 0.08) },
  { key: "small_winners", rows: rows.filter((row) => row.pnl > 0 && row.move <= 0.05) },
];

const lines = [
  "# PENGU Entry Feature Analysis",
  "",
  "## Group averages",
  "",
  "| group | n | avg pnl | avg price | mom20 | mom80 | accel | volRatio | distSma40 | range96 | path96 | future16Max | future48Max | future48Low |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
];

for (const group of groups) {
  const avg = (key: keyof (typeof rows)[number]) => group.rows.reduce((sum, row) => sum + Number(row[key]), 0) / Math.max(1, group.rows.length);
  lines.push(`| ${group.key} | ${group.rows.length} | ${fmt(avg("pnl"), 2)} | ${fmt(avg("price"), 5)} | ${fmt(avg("mom20"))} | ${fmt(avg("mom80"))} | ${fmt(avg("accel"))} | ${fmt(avg("volumeRatio"))} | ${fmt(avg("distSma40"))} | ${fmt(avg("range96"))} | ${fmt(avg("path96"))} | ${fmt(avg("future16Max"))} | ${fmt(avg("future48Max"))} | ${fmt(avg("future48Low"))} |`);
}

lines.push("", "## Worst idle-time losers", "");
lines.push("| id | entry | pnl | price | mom20 | mom80 | accel | volRatio | distSma40 | range96 | path96 | future16Max | future48Max | future48Low |");
lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const row of groups[0].rows.sort((a, b) => a.pnl - b.pnl).slice(0, 20)) {
  lines.push(`| ${row.id} | ${row.entry} | ${fmt(row.pnl, 2)} | ${fmt(row.price, 5)} | ${fmt(row.mom20)} | ${fmt(row.mom80)} | ${fmt(row.accel)} | ${fmt(row.volumeRatio)} | ${fmt(row.distSma40)} | ${fmt(row.range96)} | ${fmt(row.path96)} | ${fmt(row.future16Max)} | ${fmt(row.future48Max)} | ${fmt(row.future48Low)} |`);
}

fs.writeFileSync(path.join(outDir, "summary.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
