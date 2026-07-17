import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { TradePairRow } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-gps-capped-profit");
const STEP_MS = 12 * 60 * 60 * 1000;
const CAPS_USDT = [100, 300];
const QUOTE_VALUE_LOSS_CAP_PCT = 1;

const PERIODS = [
  { key: "2024-H1", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 5, 30, 23, 59, 59, 999) },
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 3, 23, 23, 59, 59, 999) },
];

type Window = { startTs: number; endTs: number };

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(period: typeof PERIODS[number]): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: period.startTs,
    backtestEndTs: period.endTs,
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const points = result.equity_curve.sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of points) {
    if (point.position_side === "cash") {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) {
      windows.push({ startTs: start, endTs: prev + STEP_MS });
      start = null;
      prev = null;
    }
  }
  if (start != null && prev != null) {
    windows.push({ startTs: start, endTs: prev + STEP_MS });
  }
  return windows.filter((window) => window.endTs - window.startTs >= STEP_MS);
}

function gpsOptions(base: HybridVariantOptions, windows: readonly Window[]) {
  return {
    ...base,
    strictExtraTrendSymbols: ["GPS"],
    strictExtraTrendAllowedWindows: windows,
    strictExtraTrendIdleOnly: true,
    strictExtraTrendDecisionTimeframe: "12h",
    strictExtraTrendExitCheckTimeframe: "12h",
    strictExtraTrendMinEfficiencyRatio: 0.2,
    strictExtraTrendMinVolumeRatio: 1.08,
    strictExtraTrendTrailActivationPct: 0.12,
    strictExtraTrendTrailRetracePct: 0.06,
    strictExtraTrendHardStopLossPct: 10,
    strictExtraTrendMaxHoldBars: 8,
  } satisfies HybridVariantOptions;
}

function tradeNotional(trade: TradePairRow) {
  return trade.qty * trade.entry_price;
}

function cappedPnl(trade: TradePairRow, capUsdt: number, quoteValueLossPct: number) {
  const notional = tradeNotional(trade);
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  const scaledNetPnl = trade.net_pnl * (capUsdt / notional);
  const quoteCost = capUsdt * (quoteValueLossPct / 100) * 2;
  return scaledNetPnl - quoteCost;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const tradeRows = [];

  for (const period of PERIODS) {
    const base = baseOptions(period);
    const baseline = await runHybridBacktest("RETQ22", {
      ...base,
      label: `v7_base_${period.key}`,
    });
    const windows = cashWindowsFromBaseline(baseline);
    const gps = await runHybridBacktest("RETQ22", {
      ...gpsOptions(base, windows),
      label: `v7_gps_quote_capped_${period.key}`,
    });
    const gpsTrades = gps.trade_pairs.filter((trade) => trade.symbol === "GPS");

    const capped = Object.fromEntries(CAPS_USDT.map((cap) => {
      const pnl = gpsTrades.reduce((total, trade) => total + cappedPnl(trade, cap, QUOTE_VALUE_LOSS_CAP_PCT), 0);
      return [`cap${cap}`, round(pnl)];
    }));

    for (const trade of gpsTrades) {
      const notional = tradeNotional(trade);
      tradeRows.push({
        period: period.key,
        entryTime: trade.entry_time,
        exitTime: trade.exit_time,
        entryPrice: trade.entry_price,
        exitPrice: trade.exit_price,
        fullNotional: round(notional),
        fullNetPnl: round(trade.net_pnl),
        netReturnPct: round((trade.net_pnl / notional) * 100, 2),
        cap100PnlAfterQuoteCap: round(cappedPnl(trade, 100, QUOTE_VALUE_LOSS_CAP_PCT)),
        cap300PnlAfterQuoteCap: round(cappedPnl(trade, 300, QUOTE_VALUE_LOSS_CAP_PCT)),
        entryReason: trade.entry_reason,
        exitReason: trade.exit_reason,
      });
    }

    rows.push({
      period: period.key,
      baselineEndEquity: round(baseline.summary.end_equity),
      gpsFullEndEquity: round(gps.summary.end_equity),
      gpsFullDeltaEndEquity: round(gps.summary.end_equity - baseline.summary.end_equity),
      gpsFullSymbolPnl: round(gps.summary.symbol_contribution.GPS ?? 0),
      gpsTradeCount: gpsTrades.length,
      cashWindows: windows.length,
      cappedPnlAfterAssumedQuoteCap: capped,
      cappedEndEquityEstimate: Object.fromEntries(CAPS_USDT.map((cap) => [
        `cap${cap}`,
        round(baseline.summary.end_equity + Number(capped[`cap${cap}`])),
      ])),
    });
  }

  const totals = Object.fromEntries(CAPS_USDT.map((cap) => [
    `cap${cap}`,
    round(rows.reduce((total, row: any) => total + Number(row.cappedPnlAfterAssumedQuoteCap[`cap${cap}`] ?? 0), 0)),
  ]));

  const md = [
    "# V7 GPS Capped Profit Estimate",
    "",
    "- method: engine-direct signal/trade extraction, then conservative capped-notional projection",
    "- candidate: GPS only",
    "- scope: V7 USDT/cash windows only",
    "- quote rule: ParaSwap/OpenOcean both checked; use best provider; entry allowed only when value loss <= 1%",
    "- sizing: 100 / 300 USDT max notional. 1000 USDT is excluded because latest quote loss was over 1%.",
    "- projection cost: subtracts 1% quote value loss on entry and 1% on exit for each GPS trade. This is intentionally conservative.",
    "",
    "## Period Summary",
    "",
    "| period | baseline end | GPS full end | full delta | GPS symbol PnL | GPS trades | capped +100 | capped +300 | est end +100 | est end +300 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row: any) => `| ${row.period} | ${row.baselineEndEquity} | ${row.gpsFullEndEquity} | ${row.gpsFullDeltaEndEquity} | ${row.gpsFullSymbolPnl} | ${row.gpsTradeCount} | ${row.cappedPnlAfterAssumedQuoteCap.cap100} | ${row.cappedPnlAfterAssumedQuoteCap.cap300} | ${row.cappedEndEquityEstimate.cap100} | ${row.cappedEndEquityEstimate.cap300} |`),
    "",
    "## Total Capped GPS Add-On PnL",
    "",
    `- cap 100 USDT: ${totals.cap100}`,
    `- cap 300 USDT: ${totals.cap300}`,
    "",
    "## GPS Trades",
    "",
    "| period | entry | exit | full notional | full net PnL | net return % | cap100 after quote | cap300 after quote | entry reason | exit reason |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...tradeRows.map((trade: any) => `| ${trade.period} | ${trade.entryTime} | ${trade.exitTime} | ${trade.fullNotional} | ${trade.fullNetPnl} | ${trade.netReturnPct} | ${trade.cap100PnlAfterQuoteCap} | ${trade.cap300PnlAfterQuoteCap} | ${trade.entryReason.replaceAll("|", "/")} | ${trade.exitReason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows, tradeRows, totals }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify({ rows, tradeRows, totals, report: path.join(REPORT_DIR, "result.md") }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
