import fs from "fs/promises";
import path from "path";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-ranking-window-regime-sidecar");
const TRADE_FILE = path.join(REPORT_DIR, "trades.json");
const OUT_FILE = path.join(REPORT_DIR, "root-cause.md");

type Trade = {
  period: string;
  strategy: string;
  symbol: string;
  variant: string;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  netReturnPct: number;
  score: number;
  windowHours: number;
  exitReason: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function month(ts: number) {
  const date = new Date(ts);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function windowBucket(hours: number) {
  if (hours < 72) return "<72h";
  if (hours < 336) return "72h-14d";
  return ">=14d";
}

function holdHours(trade: Trade) {
  return (trade.exitTs - trade.entryTs) / 3_600_000;
}

function aggregate(trades: Trade[]) {
  const pnl = trades.reduce((sum, trade) => sum + trade.netReturnPct * 300, 0);
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netReturnPct <= 0).reduce((sum, trade) => sum + trade.netReturnPct, 0));
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pf: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    avgNetPct: round((trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / Math.max(1, trades.length)) * 100, 3),
    cap300Pnl: round(pnl),
    avgHoldHours: round(trades.reduce((sum, trade) => sum + holdHours(trade), 0) / Math.max(1, trades.length)),
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return [...out.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function table(title: string, entries: Array<[string, Trade[]]>) {
  return [
    `## ${title}`,
    "",
    "| key | trades | win % | PF | avg net % | cap300 PnL | avg hold h |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...entries.map(([key, trades]) => {
      const row = aggregate(trades);
      return `| ${key} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.avgNetPct} | ${row.cap300Pnl} | ${row.avgHoldHours} |`;
    }),
    "",
  ].join("\n");
}

async function main() {
  const trades = JSON.parse(await fs.readFile(TRADE_FILE, "utf8")) as Trade[];
  const primary = trades.filter((trade) => trade.strategy === "ranking_window_regime_bio_zbt" && trade.period === "2025-2026");
  const bioDusk = trades.filter((trade) => trade.strategy === "ranking_window_regime_with_bio_dusk" && trade.period === "2025-2026");
  const dexeLong = trades.filter((trade) => trade.strategy === "ranking_window_regime_with_dexe_long" && trade.period === "2025-2026");
  const allFull = trades.filter((trade) => trade.period === "2025-2026");

  const worst = [...allFull]
    .sort((left, right) => left.netReturnPct - right.netReturnPct)
    .slice(0, 15);
  const best = [...allFull]
    .sort((left, right) => right.netReturnPct - left.netReturnPct)
    .slice(0, 15);

  const md = [
    "# V7 Sidecar Root Cause Analysis",
    "",
    "- target period: 2025-2026",
    "- cap assumption: 300 USDT",
    "- source: reports/v7-ranking-window-regime-sidecar/trades.json",
    "",
    table("Primary BIO/ZBT By Month", groupBy(primary, (trade) => month(trade.entryTs))),
    table("Primary BIO/ZBT By Symbol", groupBy(primary, (trade) => trade.symbol)),
    table("Primary BIO/ZBT By Window Length", groupBy(primary, (trade) => windowBucket(trade.windowHours))),
    table("Primary BIO/ZBT By Exit Reason", groupBy(primary, (trade) => trade.exitReason)),
    table("BIO/DUSK/PENDLE Regime By Symbol", groupBy(bioDusk, (trade) => trade.symbol)),
    table("BIO/DUSK/PENDLE Regime By Window Length", groupBy(bioDusk, (trade) => windowBucket(trade.windowHours))),
    table("DEXE Long Regime By Symbol", groupBy(dexeLong, (trade) => trade.symbol)),
    table("DEXE Long Regime By Window Length", groupBy(dexeLong, (trade) => windowBucket(trade.windowHours))),
    "## Worst Trades",
    "",
    "| strategy | symbol | entry | exit | window | hold h | net % | exit |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...worst.map((trade) => `| ${trade.strategy} | ${trade.symbol} | ${new Date(trade.entryTs).toISOString()} | ${new Date(trade.exitTs).toISOString()} | ${round(trade.windowHours)} | ${round(holdHours(trade))} | ${round(trade.netReturnPct * 100, 2)} | ${trade.exitReason} |`),
    "",
    "## Best Trades",
    "",
    "| strategy | symbol | entry | exit | window | hold h | net % | exit |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...best.map((trade) => `| ${trade.strategy} | ${trade.symbol} | ${new Date(trade.entryTs).toISOString()} | ${new Date(trade.exitTs).toISOString()} | ${round(trade.windowHours)} | ${round(holdHours(trade))} | ${round(trade.netReturnPct * 100, 2)} | ${trade.exitReason} |`),
    "",
  ].join("\n");

  await fs.writeFile(OUT_FILE, md, "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
