import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import { buildIndicatorBars, resampleTo12h } from "../lib/backtest/indicators";
import type { IndicatorBar, TradePairRow } from "../lib/backtest/types";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-sol-twt-entry-filter");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const HOUR_MS = 60 * 60 * 1000;
const SYMBOLS = ["SOL", "TWT"] as const;
const PERIODS = [
  { key: "2022", startTs: Date.UTC(2022, 0, 1), endTs: Date.UTC(2022, 11, 31, 23, 59, 59, 999) },
  { key: "2023", startTs: Date.UTC(2023, 0, 1), endTs: Date.UTC(2023, 11, 31, 23, 59, 59, 999) },
  { key: "2024", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
] as const;
const REQUESTED_PERIOD = process.env.BT_PERIOD || "";

type TradeFeature = {
  period: string;
  symbol: string;
  netPnl: number;
  entryTs: number;
  mom20: number;
  accel: number;
  volumeRatio: number;
  adx14: number;
  smaDistance: number;
  efficiency: number;
  overheatPct: number;
  win: boolean;
};

type Filter = {
  key: string;
  blocks: (trade: TradeFeature) => boolean;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nearestBar(bars: IndicatorBar[], ts: number) {
  let candidate: IndicatorBar | null = null;
  for (const bar of bars) {
    if (bar.ts > ts) break;
    candidate = bar;
  }
  return candidate;
}

function featureFromTrade(period: string, trade: TradePairRow, bars: IndicatorBar[]): TradeFeature | null {
  const entryTs = Date.parse(trade.entry_time);
  const bar = nearestBar(bars, entryTs);
  if (!bar || !bar.ready) return null;
  const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
  const smaDistance = bar.sma40 > 0 ? bar.close / bar.sma40 - 1 : 0;
  const efficiency = Math.abs(bar.mom20) > 0 ? Math.abs(bar.close / bar.open - 1) / Math.abs(bar.mom20) : 0;
  return {
    period,
    symbol: trade.symbol,
    netPnl: trade.net_pnl,
    entryTs,
    mom20: bar.mom20,
    accel: bar.momAccel,
    volumeRatio,
    adx14: bar.adx14,
    smaDistance,
    efficiency,
    overheatPct: bar.overheatPct,
    win: trade.net_pnl > 0,
  };
}

function buildFilters() {
  const filters: Filter[] = [];
  const symbols: Array<"ALL" | typeof SYMBOLS[number]> = ["ALL", ...SYMBOLS];
  const scoped = (scope: typeof symbols[number], fn: (trade: TradeFeature) => boolean) => (trade: TradeFeature) => (
    scope === "ALL" || trade.symbol === scope
  ) && fn(trade);

  for (const scope of symbols) {
    for (const threshold of [-0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08]) {
      filters.push({ key: `${scope}_block_mom20_lt_${threshold}`, blocks: scoped(scope, (trade) => trade.mom20 < threshold) });
    }
    for (const threshold of [-0.01, 0, 0.005, 0.01, 0.02]) {
      filters.push({ key: `${scope}_block_accel_lt_${threshold}`, blocks: scoped(scope, (trade) => trade.accel < threshold) });
    }
    for (const threshold of [0.5, 0.65, 0.8, 1, 1.15]) {
      filters.push({ key: `${scope}_block_vol_lt_${threshold}`, blocks: scoped(scope, (trade) => trade.volumeRatio < threshold) });
    }
    for (const threshold of [10, 14, 18, 22, 26, 30]) {
      filters.push({ key: `${scope}_block_adx_lt_${threshold}`, blocks: scoped(scope, (trade) => trade.adx14 < threshold) });
    }
    for (const threshold of [-0.02, 0, 0.015, 0.03, 0.05]) {
      filters.push({ key: `${scope}_block_sma_dist_lt_${threshold}`, blocks: scoped(scope, (trade) => trade.smaDistance < threshold) });
    }
    for (const mom of [0, 0.02, 0.04, 0.06]) {
      for (const vol of [0.65, 0.8, 1]) {
        filters.push({
          key: `${scope}_block_mom_lt_${mom}_and_vol_lt_${vol}`,
          blocks: scoped(scope, (trade) => trade.mom20 < mom && trade.volumeRatio < vol),
        });
      }
    }
    for (const mom of [0, 0.02, 0.04, 0.06]) {
      for (const adx of [14, 18, 22, 26]) {
        filters.push({
          key: `${scope}_block_mom_lt_${mom}_and_adx_lt_${adx}`,
          blocks: scoped(scope, (trade) => trade.mom20 < mom && trade.adx14 < adx),
        });
      }
    }
    for (const sma of [0, 0.015, 0.03]) {
      for (const accel of [0, 0.005, 0.01]) {
        filters.push({
          key: `${scope}_block_sma_lt_${sma}_and_accel_lt_${accel}`,
          blocks: scoped(scope, (trade) => trade.smaDistance < sma && trade.accel < accel),
        });
      }
    }
  }
  const explicitFilters: Filter[] = [
    {
      key: "ALL_block_vol_lt_1.15",
      blocks: (trade) => trade.volumeRatio < 1.15,
    },
    {
      key: "SOL_block_vol_lt_1.15",
      blocks: (trade) => trade.symbol === "SOL" && trade.volumeRatio < 1.15,
    },
    {
      key: "TWT_block_vol_lt_1.15",
      blocks: (trade) => trade.symbol === "TWT" && trade.volumeRatio < 1.15,
    },
    {
      key: "ALL_block_accel_lt_0.01",
      blocks: (trade) => trade.accel < 0.01,
    },
    {
      key: "SOL_block_accel_lt_0.01",
      blocks: (trade) => trade.symbol === "SOL" && trade.accel < 0.01,
    },
    {
      key: "TWT_block_accel_lt_0.01",
      blocks: (trade) => trade.symbol === "TWT" && trade.accel < 0.01,
    },
    {
      key: "ALL_block_adx_lt_22",
      blocks: (trade) => trade.adx14 < 22,
    },
    {
      key: "SOL_block_adx_lt_22",
      blocks: (trade) => trade.symbol === "SOL" && trade.adx14 < 22,
    },
    {
      key: "TWT_block_adx_lt_22",
      blocks: (trade) => trade.symbol === "TWT" && trade.adx14 < 22,
    },
    {
      key: "common_quality_vol_or_accel",
      blocks: (trade) => trade.volumeRatio < 1.15 || trade.accel < 0.01,
    },
    {
      key: "common_quality_vol_or_adx",
      blocks: (trade) => trade.volumeRatio < 1.15 || trade.adx14 < 22,
    },
    {
      key: "common_quality_accel_or_adx",
      blocks: (trade) => trade.accel < 0.01 || trade.adx14 < 22,
    },
    {
      key: "common_quality_2of3",
      blocks: (trade) => [trade.volumeRatio < 1.15, trade.accel < 0.01, trade.adx14 < 22].filter(Boolean).length >= 2,
    },
    {
      key: "sol_volume_twt_adx",
      blocks: (trade) => (trade.symbol === "SOL" && trade.volumeRatio < 1.15) || (trade.symbol === "TWT" && trade.adx14 < 22),
    },
    {
      key: "sol_volume_twt_volume",
      blocks: (trade) => trade.volumeRatio < 1.15 && (trade.symbol === "SOL" || trade.symbol === "TWT"),
    },
    {
      key: "sol_accel_twt_volume",
      blocks: (trade) => (trade.symbol === "SOL" && trade.accel < 0.01) || (trade.symbol === "TWT" && trade.volumeRatio < 1.15),
    },
    {
      key: "sol_volume_twt_accel",
      blocks: (trade) => (trade.symbol === "SOL" && trade.volumeRatio < 1.15) || (trade.symbol === "TWT" && trade.accel < 0.01),
    },
  ];
  for (const filter of explicitFilters) {
    if (!filters.some((item) => item.key === filter.key)) filters.push(filter);
  }
  return filters;
}

async function loadBars(symbol: string, startTs: number, endTs: number) {
  const candles = await loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: startTs - 90 * 12 * HOUR_MS,
    endMs: endTs,
    interval: "1h",
  });
  return buildIndicatorBars(resampleTo12h(candles));
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const options = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const tradeFeatures: TradeFeature[] = [];
  const baselines: Record<string, number> = {};

  const activePeriods = REQUESTED_PERIOD ? PERIODS.filter((period) => period.key === REQUESTED_PERIOD) : PERIODS;
  for (const period of activePeriods) {
    const barsBySymbol = new Map<string, IndicatorBar[]>();
    for (const symbol of SYMBOLS) barsBySymbol.set(symbol, await loadBars(symbol, period.startTs, period.endTs));
    const result = await runHybridBacktest("RETQ22", {
      ...options,
      initialEquity: 10_000,
      backtestStartTs: period.startTs,
      backtestExecutionStartTs: period.startTs,
      backtestEndTs: period.endTs,
      label: `v7_sol_twt_filter_${period.key}`,
    });
    baselines[period.key] = round(result.summary.end_equity);
    for (const trade of result.trade_pairs.filter((item) => SYMBOLS.includes(item.symbol as typeof SYMBOLS[number]))) {
      const feature = featureFromTrade(period.key, trade, barsBySymbol.get(trade.symbol) ?? []);
      if (feature) tradeFeatures.push(feature);
    }
  }

  const rows = buildFilters().map((filter) => {
    const blocked = tradeFeatures.filter((trade) => filter.blocks(trade));
    const delta = -blocked.reduce((sum, trade) => sum + trade.netPnl, 0);
    const byPeriod = Object.fromEntries(activePeriods.map((period) => {
      const periodBlocked = blocked.filter((trade) => trade.period === period.key);
      const periodDelta = -periodBlocked.reduce((sum, trade) => sum + trade.netPnl, 0);
      return [period.key, {
        delta: round(periodDelta),
        estimatedEnd: round((baselines[period.key] ?? 0) + periodDelta),
        blocked: periodBlocked.length,
        blockedWins: periodBlocked.filter((trade) => trade.win).length,
      }];
    }));
    return {
      filter: filter.key,
      totalDelta: round(delta),
      blocked: blocked.length,
      blockedWins: blocked.filter((trade) => trade.win).length,
      byPeriod,
    };
  }).sort((left, right) => right.totalDelta - left.totalDelta);

  const suffix = REQUESTED_PERIOD || "all";
  await fs.writeFile(path.join(REPORT_DIR, `trade-features-${suffix}.json`), JSON.stringify(tradeFeatures, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, `result-${suffix}.json`), JSON.stringify(rows, null, 2), "utf8");
  const md = [
    "# V7 SOL/TWT Entry Filter Screen",
    "",
    "- method: engine-direct V7 trade extraction, then pre-entry indicator filters are evaluated as block estimates.",
    "- estimate: blocked trade PnL is removed; no replacement trade is compounded here.",
    "",
    "| rank | filter | total delta | blocked | blocked wins | 2022 delta/end | 2023 delta/end | 2024 delta/end |",
    "| ---: | --- | ---: | ---: | ---: | --- | --- | --- |",
    ...rows.slice(0, 40).map((row, index) => {
      const y2022 = row.byPeriod["2022"];
      const y2023 = row.byPeriod["2023"] ?? { delta: 0, estimatedEnd: 0 };
      const y2024 = row.byPeriod["2024"] ?? { delta: 0, estimatedEnd: 0 };
      return `| ${index + 1} | ${row.filter} | ${row.totalDelta.toLocaleString()} | ${row.blocked} | ${row.blockedWins} | ${y2022?.delta?.toLocaleString?.() ?? 0} / ${y2022?.estimatedEnd?.toLocaleString?.() ?? 0} | ${y2023.delta.toLocaleString()} / ${y2023.estimatedEnd.toLocaleString()} | ${y2024.delta.toLocaleString()} / ${y2024.estimatedEnd.toLocaleString()} |`;
    }),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, `result-${suffix}.md`), md, "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
