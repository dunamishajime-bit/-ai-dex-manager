import fs from "fs/promises";
import path from "path";

type Trade = {
  side: "long" | "short";
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
  tradesPerDay: number;
  wins: number;
  winRatePct: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgHoldMinutes: number;
  avgPnlPct: number;
  debugDirectionPass: number;
  debugSetupPass: number;
  debugTriggerPass: number;
  tradesDetail: Trade[];
};

type ComboResult = {
  comboKey: string;
  strategies: string[];
  trades: number;
  wins: number;
  winRatePct: number;
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgHoldMinutes: number;
  skippedOverlapTrades: number;
};

type ScheduledTrade = Trade & {
  strategy: string;
  entryTs: number;
  exitTs: number;
  priority: number;
};

const STARTING_EQUITY = 10_000;
const REPORT_DIR = path.join(process.cwd(), "reports", "aster-whale-inspired");
const INPUT_PATH = path.join(REPORT_DIR, "result.json");

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  if (size === 1) return items.map((item) => [item]);
  const result: T[][] = [];
  for (let i = 0; i <= items.length - size; i += 1) {
    const head = items[i];
    for (const tail of combinations(items.slice(i + 1), size - 1)) {
      result.push([head, ...tail]);
    }
  }
  return result;
}

function simulateSharedSlot(variants: VariantResult[]): ComboResult {
  const scheduled: ScheduledTrade[] = variants.flatMap((variant, priority) =>
    variant.tradesDetail.map((trade) => ({
      ...trade,
      strategy: variant.key,
      entryTs: Date.parse(trade.entryIso),
      exitTs: Date.parse(trade.exitIso),
      priority,
    })),
  );

  scheduled.sort((a, b) => {
    if (a.entryTs !== b.entryTs) return a.entryTs - b.entryTs;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.exitTs - b.exitTs;
  });

  let equity = STARTING_EQUITY;
  let peakEquity = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let activeUntil = -Infinity;
  let skippedOverlapTrades = 0;
  const accepted: ScheduledTrade[] = [];

  for (const trade of scheduled) {
    if (trade.entryTs < activeUntil) {
      skippedOverlapTrades += 1;
      continue;
    }
    accepted.push(trade);
    equity *= 1 + (trade.pnlPct / 100);
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, ((equity / peakEquity) - 1) * 100);
    activeUntil = trade.exitTs;
  }

  const wins = accepted.filter((trade) => trade.pnlPct > 0).length;
  const grossProfit = accepted.filter((trade) => trade.pnlPct > 0).reduce((sum, trade) => sum + trade.pnlPct, 0);
  const grossLoss = Math.abs(accepted.filter((trade) => trade.pnlPct <= 0).reduce((sum, trade) => sum + trade.pnlPct, 0));

  return {
    comboKey: variants.map((variant) => variant.key).join(" + "),
    strategies: variants.map((variant) => variant.key),
    trades: accepted.length,
    wins,
    winRatePct: accepted.length ? round((wins / accepted.length) * 100) : 0,
    returnPct: round(((equity / STARTING_EQUITY) - 1) * 100),
    maxDrawdownPct: round(maxDrawdownPct),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : 0,
    avgHoldMinutes: round(average(accepted.map((trade) => trade.holdMinutes))),
    skippedOverlapTrades,
  };
}

function renderMarkdown(results: ComboResult[]) {
  return [
    "# ASTER whale-inspired combo backtest",
    "",
    "- assumption: one shared capital slot, no overlapping ASTER positions",
    "- when entry timestamps collide, combo order determines priority",
    "",
    "| Combo | Trades | Win Rate | Return | Max DD | PF | Avg Hold | Overlap Skips |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((row) =>
      `| ${row.comboKey} | ${row.trades} | ${row.winRatePct.toFixed(2)}% | ${row.returnPct.toFixed(2)}% | ${row.maxDrawdownPct.toFixed(2)}% | ${row.profitFactor.toFixed(2)} | ${row.avgHoldMinutes.toFixed(2)} | ${row.skippedOverlapTrades} |`,
    ),
  ].join("\n");
}

async function main() {
  const raw = await fs.readFile(INPUT_PATH, "utf8");
  const results = JSON.parse(raw) as VariantResult[];
  const profitable = results.filter((variant) => variant.returnPct > 0);

  const combos = [
    ...combinations(profitable, 2),
    ...combinations(profitable, 3),
  ].map(simulateSharedSlot);

  combos.sort((a, b) => {
    if (b.returnPct !== a.returnPct) return b.returnPct - a.returnPct;
    if (b.winRatePct !== a.winRatePct) return b.winRatePct - a.winRatePct;
    return a.maxDrawdownPct - b.maxDrawdownPct;
  });

  await fs.writeFile(path.join(REPORT_DIR, "combo-result.json"), JSON.stringify(combos, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "combo-result.md"), renderMarkdown(combos), "utf8");
  console.log(renderMarkdown(combos));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
