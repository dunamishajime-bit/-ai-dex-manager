import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";
import type { BacktestResult, EquityPoint, TradePairRow } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "current-production-max-window");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

type IdleWindow = {
  startIso: string;
  endIso: string;
  bars: number;
  days: number;
};

type LossReasonRow = {
  reason: string;
  count: number;
  totalNetPnl: number;
  avgNetPnl: number;
  worstNetPnl: number;
};

type LossSymbolRow = {
  symbol: string;
  count: number;
  totalNetPnl: number;
  avgNetPnl: number;
  worstNetPnl: number;
};

function positiveDiffs(points: EquityPoint[]) {
  const diffs: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const diff = points[index].ts - points[index - 1].ts;
    if (diff > 0) diffs.push(diff);
  }
  return diffs;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function inferBarMs(points: EquityPoint[]) {
  return median(positiveDiffs(points)) || 12 * 60 * 60 * 1000;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function collectIdleWindows(points: EquityPoint[], barMs: number) {
  const windows: IdleWindow[] = [];
  let currentStart = -1;

  for (let index = 0; index < points.length; index += 1) {
    const isCash = points[index].position_side === "cash";
    if (isCash && currentStart === -1) {
      currentStart = index;
      continue;
    }

    if (!isCash && currentStart !== -1) {
      const startPoint = points[currentStart];
      const endPoint = points[index - 1];
      const bars = index - currentStart;
      windows.push({
        startIso: startPoint.iso_time,
        endIso: endPoint.iso_time,
        bars,
        days: round((bars * barMs) / (24 * 60 * 60 * 1000), 2),
      });
      currentStart = -1;
    }
  }

  if (currentStart !== -1) {
    const startPoint = points[currentStart];
    const endPoint = points.at(-1)!;
    const bars = points.length - currentStart;
    windows.push({
      startIso: startPoint.iso_time,
      endIso: endPoint.iso_time,
      bars,
      days: round((bars * barMs) / (24 * 60 * 60 * 1000), 2),
    });
  }

  return windows;
}

function summarizeLossReasons(lossTrades: TradePairRow[]): LossReasonRow[] {
  const map = new Map<string, TradePairRow[]>();
  for (const trade of lossTrades) {
    const key = trade.exit_reason || "unknown";
    const rows = map.get(key) ?? [];
    rows.push(trade);
    map.set(key, rows);
  }

  return [...map.entries()]
    .map(([reason, rows]) => {
      const totalNetPnl = rows.reduce((sum, row) => sum + row.net_pnl, 0);
      const worstNetPnl = rows.reduce((worst, row) => Math.min(worst, row.net_pnl), 0);
      return {
        reason,
        count: rows.length,
        totalNetPnl: round(totalNetPnl, 2),
        avgNetPnl: round(totalNetPnl / rows.length, 2),
        worstNetPnl: round(worstNetPnl, 2),
      };
    })
    .sort((left, right) => right.count - left.count || left.totalNetPnl - right.totalNetPnl);
}

function summarizeLossSymbols(lossTrades: TradePairRow[]): LossSymbolRow[] {
  const map = new Map<string, TradePairRow[]>();
  for (const trade of lossTrades) {
    const key = trade.symbol || "unknown";
    const rows = map.get(key) ?? [];
    rows.push(trade);
    map.set(key, rows);
  }

  return [...map.entries()]
    .map(([symbol, rows]) => {
      const totalNetPnl = rows.reduce((sum, row) => sum + row.net_pnl, 0);
      const worstNetPnl = rows.reduce((worst, row) => Math.min(worst, row.net_pnl), 0);
      return {
        symbol,
        count: rows.length,
        totalNetPnl: round(totalNetPnl, 2),
        avgNetPnl: round(totalNetPnl / rows.length, 2),
        worstNetPnl: round(worstNetPnl, 2),
      };
    })
    .sort((left, right) => right.count - left.count || left.totalNetPnl - right.totalNetPnl);
}

function buildInsights(
  result: BacktestResult,
  idleWindows: IdleWindow[],
  lossReasonRows: LossReasonRow[],
  lossSymbolRows: LossSymbolRow[],
) {
  const idleDays = idleWindows.reduce((sum, window) => sum + window.days, 0);
  const totalDays = result.equity_curve.length
    ? round((result.equity_curve.length * inferBarMs(result.equity_curve)) / (24 * 60 * 60 * 1000), 2)
    : 0;
  const topIdle = idleWindows[0];
  const topLossReason = lossReasonRows[0];
  const topLossSymbol = lossSymbolRows[0];
  const notes: string[] = [];

  if (topIdle && idleDays / Math.max(totalDays, 1) > 0.25) {
    notes.push(
      `USDT待機が長いです。特に最長 ${topIdle.days} 日の待機があり、候補通貨不足またはエントリー条件が厳しすぎる可能性があります。`,
    );
  }

  if (topLossReason?.reason === "strict-extra-rotate") {
    notes.push("PENGUローテーション負けが最大要因です。Score差は良くても、直後の追随が弱い場面が混ざっています。");
  } else if (topLossReason?.reason === "trend-switch") {
    notes.push("通常トレンドの持ち替えで負けが目立ちます。切替基準が早すぎるか、持ち替え先の質がばらついています。");
  } else if (topLossReason?.reason === "sma-break") {
    notes.push("決済の遅れで含み益を削っている可能性が高いです。SMA割れまで待つ出口が重いかもしれません。");
  }

  if (topLossSymbol?.symbol === "PENGU") {
    notes.push("負けの中心がPENGUなら、追加候補としては有効でもエントリー許可の場面をもう一段絞る余地があります。");
  } else if (topLossSymbol?.symbol) {
    notes.push(`${topLossSymbol.symbol} の負けが目立ちます。この銘柄だけ出口や採用条件を個別調整する余地があります。`);
  }

  return notes;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const options = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "current_production_max_window",
  } as const;

  const result = await runHybridBacktest("RETQ22", options);
  const artifactFiles = await writeBacktestArtifacts(result, REPORT_DIR);

  const barMs = inferBarMs(result.equity_curve);
  const idleWindows = collectIdleWindows(result.equity_curve, barMs)
    .sort((left, right) => right.days - left.days);
  const idleBars = result.equity_curve.filter((point) => point.position_side === "cash").length;
  const totalBars = result.equity_curve.length;
  const idleDays = round((idleBars * barMs) / (24 * 60 * 60 * 1000), 2);
  const totalDays = round((totalBars * barMs) / (24 * 60 * 60 * 1000), 2);
  const idlePct = totalBars ? round((idleBars / totalBars) * 100, 2) : 0;

  const lossTrades = result.trade_pairs.filter((trade) => trade.net_pnl <= 0);
  const winTrades = result.trade_pairs.filter((trade) => trade.net_pnl > 0);
  const lossReasonRows = summarizeLossReasons(lossTrades);
  const lossSymbolRows = summarizeLossSymbols(lossTrades);
  const worstTrades = [...lossTrades]
    .sort((left, right) => left.net_pnl - right.net_pnl)
    .slice(0, 10)
    .map((trade) => ({
      symbol: trade.symbol,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      net_pnl: round(trade.net_pnl, 2),
      holding_bars: trade.holding_bars,
      entry_reason: trade.entry_reason,
      exit_reason: trade.exit_reason,
    }));

  const insights = buildInsights(result, idleWindows, lossReasonRows, lossSymbolRows);

  const md = [
    "# Current Production Max Window Analysis",
    "",
    "## Backtest Setup",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- tradable_symbols: ${RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols.join(", ")}`,
    `- strict_extra_symbols: ${RECLAIM_HYBRID_EXECUTION_PROFILE.strictExtraTrendSymbols.join(", ")}`,
    "",
    "## Summary",
    "",
    formatResultSummary(result),
    "",
    "## USDT Idle Analysis",
    "",
    `- total_bars: ${totalBars}`,
    `- inferred_bar_hours: ${round(barMs / (60 * 60 * 1000), 2)}`,
    `- idle_bars: ${idleBars}`,
    `- idle_pct: ${idlePct}%`,
    `- idle_days: ${idleDays}`,
    `- exposure_days: ${round(totalDays - idleDays, 2)}`,
    `- idle_window_count: ${idleWindows.length}`,
    "",
    "### Longest Idle Windows",
    "",
    "| start | end | bars | days |",
    "| --- | --- | ---: | ---: |",
    ...idleWindows.slice(0, 10).map((window) => `| ${window.startIso} | ${window.endIso} | ${window.bars} | ${window.days} |`),
    "",
    "## Losing Trades",
    "",
    `- loss_count: ${lossTrades.length}`,
    `- win_count: ${winTrades.length}`,
    `- loss_ratio: ${result.trade_pairs.length ? round((lossTrades.length / result.trade_pairs.length) * 100, 2) : 0}%`,
    `- total_loss_pnl: ${round(lossTrades.reduce((sum, trade) => sum + trade.net_pnl, 0), 2)}`,
    "",
    "### Losses by Exit Reason",
    "",
    "| exit_reason | count | total net pnl | avg net pnl | worst net pnl |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...lossReasonRows.map((row) => `| ${row.reason} | ${row.count} | ${row.totalNetPnl} | ${row.avgNetPnl} | ${row.worstNetPnl} |`),
    "",
    "### Losses by Symbol",
    "",
    "| symbol | count | total net pnl | avg net pnl | worst net pnl |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...lossSymbolRows.map((row) => `| ${row.symbol} | ${row.count} | ${row.totalNetPnl} | ${row.avgNetPnl} | ${row.worstNetPnl} |`),
    "",
    "### Worst 10 Losing Trades",
    "",
    "| symbol | entry | exit | net pnl | bars | entry reason | exit reason |",
    "| --- | --- | --- | ---: | ---: | --- | --- |",
    ...worstTrades.map((trade) => `| ${trade.symbol} | ${trade.entry_time} | ${trade.exit_time} | ${trade.net_pnl} | ${trade.holding_bars} | ${trade.entry_reason} | ${trade.exit_reason} |`),
    "",
    "## Improvement Hypotheses",
    "",
    ...insights.map((note) => `- ${note}`),
    "- USDT待機が長い場合は、追加候補通貨を増やすより先に『待機が長かった期間の候補Score推移』を確認し、条件が厳しすぎるのか候補不足なのかを分けて対策するのが安全です。",
    "- PENGUローテーション負けが一定数あるなら、`gap10 once` を維持したままでも『直近2本の出来高比』や『PENGU自身のmomAccel下限』を足してダマシを減らす余地があります。",
    "- 通常候補の負けが多いなら、銘柄別に出口を軽くするより、まず『負けが多い銘柄だけ個別の採用条件を1段厳しくする』方がPFを壊しにくいです。",
    "",
    "## Files",
    "",
    `- trade_events: ${artifactFiles.tradeEventsPath}`,
    `- trade_pairs: ${artifactFiles.tradePairsPath}`,
    `- equity_curve: ${artifactFiles.equityCurvePath}`,
    `- summary: ${artifactFiles.summaryPath}`,
  ].join("\n");

  const json = {
    setup: {
      start_utc: new Date(START_TS).toISOString(),
      end_utc: new Date(END_TS).toISOString(),
      strategy_id: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
      tradable_symbols: RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols,
      strict_extra_symbols: RECLAIM_HYBRID_EXECUTION_PROFILE.strictExtraTrendSymbols,
    },
    summary: result.summary,
    idle: {
      totalBars,
      inferredBarHours: round(barMs / (60 * 60 * 1000), 2),
      idleBars,
      idlePct,
      idleDays,
      exposureDays: round(totalDays - idleDays, 2),
      idleWindowCount: idleWindows.length,
      longestWindows: idleWindows.slice(0, 10),
    },
    losses: {
      count: lossTrades.length,
      winCount: winTrades.length,
      lossRatioPct: result.trade_pairs.length ? round((lossTrades.length / result.trade_pairs.length) * 100, 2) : 0,
      totalLossPnl: round(lossTrades.reduce((sum, trade) => sum + trade.net_pnl, 0), 2),
      byExitReason: lossReasonRows,
      bySymbol: lossSymbolRows,
      worstTrades,
    },
    insights,
    files: {
      ...artifactFiles,
      report: path.join(REPORT_DIR, "analysis.md"),
    },
  };

  await fs.writeFile(path.join(REPORT_DIR, "analysis.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "analysis.json"), JSON.stringify(json, null, 2), "utf8");

  console.log(JSON.stringify(json, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
