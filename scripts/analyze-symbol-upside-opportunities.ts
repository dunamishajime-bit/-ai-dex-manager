import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { resampleTo12h } from "../lib/backtest/indicators";
import type { Candle12h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "symbol-upside-opportunities");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "backtest-binance");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

const SYMBOLS = ["SOL", "LINK", "NEAR", "LTC", "XRP", "ATOM", "AAVE", "UNI", "ADA", "TRX", "INJ"] as const;

const MIN_UPSWING_PCT = 15;
const RETRACE_CONFIRM_PCT = 8;
const SANITY_MIN_BARS = 2;
const SANITY_MAX_GAIN_PCT = 150;

type SymbolName = (typeof SYMBOLS)[number];

type Opportunity = {
  startTs: number;
  endTs: number;
  startIso: string;
  endIso: string;
  bars: number;
  entryPrice: number;
  peakPrice: number;
  gainPct: number;
};

type SummaryRow = {
  symbol: SymbolName;
  rawOpportunityCount: number;
  rawTotalGrossPct: number;
  rawAvgGainPct: number;
  rawMedianGainPct: number;
  rawBestGainPct: number;
  rawCompoundedEquity: number;
  opportunityCount: number;
  totalGrossPct: number;
  avgGainPct: number;
  medianGainPct: number;
  bestGainPct: number;
  worstQualifiedGainPct: number;
  compoundedEquity: number;
  avgBars: number;
  topWindows: Opportunity[];
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatIso(ts: number) {
  return new Date(ts).toISOString();
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function loadBars(symbol: SymbolName) {
  const candles = await loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: START_TS,
    endMs: END_TS,
  });
  return resampleTo12h(candles);
}

function extractUpsideOpportunities(bars: Candle12h[]) {
  const opportunities: Opportunity[] = [];
  if (!bars.length) return opportunities;

  let troughIndex = 0;
  let troughPrice = Math.min(bars[0].open, bars[0].low, bars[0].close);
  let active = false;
  let peakIndex = 0;
  let peakPrice = Math.max(bars[0].open, bars[0].high, bars[0].close);

  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const barLow = Math.min(bar.open, bar.low, bar.close);
    const barHigh = Math.max(bar.open, bar.high, bar.close);

    if (!active) {
      if (barLow <= troughPrice) {
        troughPrice = barLow;
        troughIndex = index;
      }

      const risePct = ((barHigh / troughPrice) - 1) * 100;
      if (risePct >= MIN_UPSWING_PCT) {
        active = true;
        peakIndex = index;
        peakPrice = barHigh;
      }
      continue;
    }

    if (barHigh >= peakPrice) {
      peakPrice = barHigh;
      peakIndex = index;
    }

    const retracePct = ((barLow / peakPrice) - 1) * 100;
    if (retracePct <= -RETRACE_CONFIRM_PCT) {
      const gainPct = ((peakPrice / troughPrice) - 1) * 100;
      opportunities.push({
        startTs: bars[troughIndex].ts,
        endTs: bars[peakIndex].ts,
        startIso: formatIso(bars[troughIndex].ts),
        endIso: formatIso(bars[peakIndex].ts),
        bars: Math.max(1, peakIndex - troughIndex + 1),
        entryPrice: round(troughPrice, 6),
        peakPrice: round(peakPrice, 6),
        gainPct: round(gainPct, 2),
      });

      troughIndex = index;
      troughPrice = barLow;
      active = false;
      peakIndex = index;
      peakPrice = barHigh;
    }
  }

  if (active && peakIndex > troughIndex) {
    const gainPct = ((peakPrice / troughPrice) - 1) * 100;
    opportunities.push({
      startTs: bars[troughIndex].ts,
      endTs: bars[peakIndex].ts,
      startIso: formatIso(bars[troughIndex].ts),
      endIso: formatIso(bars[peakIndex].ts),
      bars: Math.max(1, peakIndex - troughIndex + 1),
      entryPrice: round(troughPrice, 6),
      peakPrice: round(peakPrice, 6),
      gainPct: round(gainPct, 2),
    });
  }

  return opportunities.filter((item) => item.gainPct >= MIN_UPSWING_PCT);
}

function summarize(symbol: SymbolName, opportunities: Opportunity[]): SummaryRow {
  const rawGains = opportunities.map((item) => item.gainPct);
  const rawCompoundedEquity = opportunities.reduce((equity, item) => equity * (1 + item.gainPct / 100), 10_000);
  const filtered = opportunities.filter((item) => item.bars >= SANITY_MIN_BARS && item.gainPct <= SANITY_MAX_GAIN_PCT);
  const gains = filtered.map((item) => item.gainPct);
  const compoundedEquity = filtered.reduce((equity, item) => equity * (1 + item.gainPct / 100), 10_000);
  const avgBars =
    filtered.length > 0
      ? filtered.reduce((sum, item) => sum + item.bars, 0) / filtered.length
      : 0;

  return {
    symbol,
    rawOpportunityCount: opportunities.length,
    rawTotalGrossPct: round(rawGains.reduce((sum, gain) => sum + gain, 0)),
    rawAvgGainPct: round(opportunities.length ? rawGains.reduce((sum, gain) => sum + gain, 0) / opportunities.length : 0),
    rawMedianGainPct: round(median(rawGains)),
    rawBestGainPct: round(rawGains.length ? Math.max(...rawGains) : 0),
    rawCompoundedEquity: round(rawCompoundedEquity),
    opportunityCount: filtered.length,
    totalGrossPct: round(gains.reduce((sum, gain) => sum + gain, 0)),
    avgGainPct: round(filtered.length ? gains.reduce((sum, gain) => sum + gain, 0) / filtered.length : 0),
    medianGainPct: round(median(gains)),
    bestGainPct: round(gains.length ? Math.max(...gains) : 0),
    worstQualifiedGainPct: round(gains.length ? Math.min(...gains) : 0),
    compoundedEquity: round(compoundedEquity),
    avgBars: round(avgBars),
    topWindows: [...filtered].sort((a, b) => b.gainPct - a.gainPct).slice(0, 5),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: SummaryRow[] = [];
  for (const symbol of SYMBOLS) {
    const bars = await loadBars(symbol);
    const opportunities = extractUpsideOpportunities(bars);
    rows.push(summarize(symbol, opportunities));
  }

  rows.sort((a, b) => b.compoundedEquity - a.compoundedEquity);

  const sol = rows.find((row) => row.symbol === "SOL");

  const md = [
    "# Symbol Upside Opportunity Comparison",
    "",
    "ロジックを使わず、12H価格の上昇波だけを同条件で比較しています。",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- min_upswing_pct: ${MIN_UPSWING_PCT}%`,
    `- retrace_confirm_pct: ${RETRACE_CONFIRM_PCT}%`,
    `- sanity_filter: bars >= ${SANITY_MIN_BARS}, gain <= ${SANITY_MAX_GAIN_PCT}%`,
    "",
    "## Summary",
    "",
    "| symbol | opportunities | total gross % | avg gain % | median % | best % | worst qualified % | compounded equity | avg bars | raw opps | raw best % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.symbol} | ${row.opportunityCount} | ${row.totalGrossPct} | ${row.avgGainPct} | ${row.medianGainPct} | ${row.bestGainPct} | ${row.worstQualifiedGainPct} | ${row.compoundedEquity} | ${row.avgBars} | ${row.rawOpportunityCount} | ${row.rawBestGainPct} |`,
    ),
    "",
    "## Vs SOL",
    "",
    "| symbol | opp delta vs SOL | total gross delta | compounded equity delta | best gain delta |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows
      .filter((row) => row.symbol !== "SOL" && sol)
      .map(
        (row) =>
          `| ${row.symbol} | ${row.opportunityCount - (sol?.opportunityCount ?? 0)} | ${round(row.totalGrossPct - (sol?.totalGrossPct ?? 0))} | ${round(row.compoundedEquity - (sol?.compoundedEquity ?? 0))} | ${round(row.bestGainPct - (sol?.bestGainPct ?? 0))} |`,
      ),
    "",
    "## Top Windows",
    "",
    ...rows.flatMap((row) => [
      `### ${row.symbol}`,
      ...row.topWindows.map((window) => `- ${window.startIso} -> ${window.endIso}: ${window.gainPct}% (${window.bars} bars)`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
