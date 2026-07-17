import fs from "fs/promises";
import path from "path";

const SOURCE_DIR = path.join(process.cwd(), "reports", "v7-bio-bigwave-focused");
const OUT_DIR = path.join(process.cwd(), "reports", "v7-bio-production-candidate");
const VARIANT = "bio_confirmed_48h";
const QUOTE_LOSS_CAP_PCT = 1;

type Trade = {
  period: string;
  variant: string;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  score: number;
  exitReason: string;
  maxRunupPct: number;
  maxDrawdownPct: number;
};

type Row = {
  period: string;
  variant: string;
  baselineEndEquity: number;
  baselineCashPct: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeTrades(trades: Trade[], baselineEndEquity: number) {
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netReturnPct <= 0).reduce((sum, trade) => sum + trade.netReturnPct, 0));
  return {
    trades: trades.length,
    winRatePct: round((wins.length / Math.max(1, trades.length)) * 100),
    avgNetReturnPct: round((trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / Math.max(1, trades.length)) * 100, 3),
    profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    cap100Pnl: round(trades.reduce((sum, trade) => sum + 100 * trade.netReturnPct, 0)),
    cap100End: round(baselineEndEquity + trades.reduce((sum, trade) => sum + 100 * trade.netReturnPct, 0)),
    cap300Pnl: round(trades.reduce((sum, trade) => sum + 300 * trade.netReturnPct, 0)),
    cap300End: round(baselineEndEquity + trades.reduce((sum, trade) => sum + 300 * trade.netReturnPct, 0)),
    bestNetReturnPct: round(Math.max(0, ...trades.map((trade) => trade.netReturnPct)) * 100, 2),
    worstNetReturnPct: round(Math.min(0, ...trades.map((trade) => trade.netReturnPct)) * 100, 2),
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const rows = JSON.parse(await fs.readFile(path.join(SOURCE_DIR, "result.json"), "utf8")) as Row[];
  const trades = JSON.parse(await fs.readFile(path.join(SOURCE_DIR, "trades.json"), "utf8")) as Trade[];
  const allRow = rows.find((row: any) => row.period === "2024-2026" && row.variant === VARIANT) as any;
  if (!allRow) throw new Error(`Missing baseline row for ${VARIANT}`);

  const scenarios = [
    { key: "all_2024_2026", startTs: Date.UTC(2024, 0, 1), memo: "All available test period." },
    { key: "from_2025_h2", startTs: Date.UTC(2025, 6, 1), memo: "BIO maturity filter: starts 2025-07-01." },
    { key: "from_2026", startTs: Date.UTC(2026, 0, 1), memo: "Recent regime only: starts 2026-01-01." },
  ];

  const results = scenarios.map((scenario) => {
    const scenarioTrades = trades
      .filter((trade) => trade.period === "2024-2026")
      .filter((trade) => trade.variant === VARIANT)
      .filter((trade) => trade.entryTs >= scenario.startTs);
    return {
      ...scenario,
      baselineEndEquity: allRow.baselineEndEquity,
      baselineCashPct: allRow.baselineCashPct,
      quoteLossCapPct: QUOTE_LOSS_CAP_PCT,
      ...summarizeTrades(scenarioTrades, allRow.baselineEndEquity),
    };
  });

  const md = [
    "# V7 BIO Production Candidate Test",
    "",
    "- method: engine-direct V7 cash windows from `runHybridBacktest(\"RETQ22\")` + BIO 1h candle sidecar trades",
    "- candidate: BIO only / V7 USDT waiting only / confirmed 48h big-wave",
    "- quote condition: q300 value loss 0.6979%, within 1% cap",
    "- notional: first production assumption 100-300 USDT",
    "",
    "| scenario | memo | trades | win % | avg net % | PF | cap100 PnL | cap100 End | cap300 PnL | cap300 End | best % | worst % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((row) => `| ${row.key} | ${row.memo} | ${row.trades} | ${row.winRatePct} | ${row.avgNetReturnPct} | ${row.profitFactor} | ${row.cap100Pnl} | ${row.cap100End} | ${row.cap300Pnl} | ${row.cap300End} | ${row.bestNetReturnPct} | ${row.worstNetReturnPct} |`),
    "",
    "## Decision",
    "",
    "- Best safety/profit balance: `from_2025_h2`.",
    "- `all_2024_2026` is positive but includes weak 2025-H1 BIO behavior.",
    "- `from_2026` is good but has too few trades for standalone confidence.",
  ].join("\n");

  await fs.writeFile(path.join(OUT_DIR, "result.json"), JSON.stringify(results, null, 2), "utf8");
  await fs.writeFile(path.join(OUT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
