import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { TradePairRow } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-1h-breakout-shortlist");
const STEP_MS = 12 * 60 * 60 * 1000;
const CAPS = [100, 300];

const QUOTE_LOSS: Record<string, number> = {
  ZBT: 0.7178,
  BIO: 0.6979,
  ALLO: 0.0945,
  PROVE: 0.1761,
};

const RUNS = [
  { symbol: "BIO", variant: "scalp_4hld" },
  { symbol: "PROVE", variant: "scalp_4hld" },
  { symbol: "ALLO", variant: "scalp_4hld" },
  { symbol: "ALLO", variant: "fast_8hld" },
  { symbol: "ZBT", variant: "scalp_4hld" },
  { symbol: "BASKET", variant: "scalp_4hld", symbols: ["ZBT", "BIO", "ALLO", "PROVE"] },
] as const;

const PARAMS = {
  scalp_4hld: {
    lookback: 4,
    breakout: 0.006,
    volume: 1.03,
    momAccel: 0.0003,
    efficiency: 0.1,
    trailActivation: 0.04,
    trailRetrace: 0.025,
    maxHold: 4,
  },
  fast_8hld: {
    lookback: 6,
    breakout: 0.008,
    volume: 1.05,
    momAccel: 0.0005,
    efficiency: 0.12,
    trailActivation: 0.06,
    trailRetrace: 0.035,
    maxHold: 8,
  },
};

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
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS });
  return windows;
}

function options(base: HybridVariantOptions, windows: readonly Window[], variantKey: keyof typeof PARAMS, symbols: readonly string[]) {
  const variant = PARAMS[variantKey];
  return {
    ...base,
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "1h",
    idleBreakoutSymbols: symbols,
    idleBreakoutAllowedWindows: windows,
    idleBreakoutAllowTradeGateOff: false,
    idleBreakoutBreakoutLookbackBars: variant.lookback,
    idleBreakoutBreakoutMinPct: variant.breakout,
    idleBreakoutMinVolumeRatio: variant.volume,
    idleBreakoutMinMomAccel: variant.momAccel,
    idleBreakoutMinEfficiencyRatio: variant.efficiency,
    idleBreakoutProfitTrailActivationPct: variant.trailActivation,
    idleBreakoutProfitTrailRetracePct: variant.trailRetrace,
    idleBreakoutMaxHoldBars: variant.maxHold,
    idleBreakoutWeakExitMom20Below: 0.015,
    idleBreakoutWeakExitMomAccelBelow: -0.005,
    idleBreakoutWeakExitMinHoldBars: 2,
    idleBreakoutWeakExitRequireCloseBelowSma40: true,
  } satisfies HybridVariantOptions;
}

function notional(trade: TradePairRow) {
  return trade.qty * trade.entry_price;
}

function cappedPnl(trade: TradePairRow, cap: number) {
  const n = notional(trade);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const grossScaled = trade.net_pnl * (cap / n);
  const lossPct = QUOTE_LOSS[trade.symbol] ?? 1;
  return grossScaled - cap * (lossPct / 100) * 2;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const trades = [];

  for (const period of PERIODS) {
    const base = baseOptions(period);
    const baseline = await runHybridBacktest("RETQ22", { ...base, label: `v7_base_${period.key}` });
    const windows = cashWindowsFromBaseline(baseline);
    for (const run of RUNS) {
      const symbols = "symbols" in run ? run.symbols : [run.symbol];
      const result = await runHybridBacktest("RETQ22", {
        ...options(base, windows, run.variant, symbols),
        label: `v7_idle_capped_${run.symbol}_${run.variant}_${period.key}`,
      });
      const candidateTrades = result.trade_pairs.filter((trade) => symbols.includes(trade.symbol));
      const capped = Object.fromEntries(CAPS.map((cap) => [
        `cap${cap}`,
        round(candidateTrades.reduce((sum, trade) => sum + cappedPnl(trade, cap), 0)),
      ]));
      rows.push({
        period: period.key,
        run: `${run.symbol}_${run.variant}`,
        fullEndEquity: round(result.summary.end_equity),
        fullDelta: round(result.summary.end_equity - baseline.summary.end_equity),
        candidatePnl: round(symbols.reduce((sum, symbol) => sum + (result.summary.symbol_contribution[symbol] ?? 0), 0)),
        candidateTrades: candidateTrades.length,
        capped,
      });
      for (const trade of candidateTrades) {
        trades.push({
          period: period.key,
          run: `${run.symbol}_${run.variant}`,
          symbol: trade.symbol,
          entry: trade.entry_time,
          exit: trade.exit_time,
          fullNotional: round(notional(trade)),
          fullNetPnl: round(trade.net_pnl),
          returnPct: round((trade.net_pnl / notional(trade)) * 100),
          cap100: round(cappedPnl(trade, 100)),
          cap300: round(cappedPnl(trade, 300)),
          exitReason: trade.exit_reason,
        });
      }
      console.log(`${period.key} ${run.symbol}_${run.variant}: trades=${candidateTrades.length} cap100=${capped.cap100} cap300=${capped.cap300}`);
    }
  }

  const md = [
    "# V7 Idle 1h Breakout Shortlist Capped Estimate",
    "",
    "- method: engine-direct candidate trade extraction, then 100/300 USDT capped-notional projection",
    "- quote cost: uses latest q300 value loss twice, entry and exit",
    "- note: this estimates sidecar profit only, without replacing V7 PENGU 15m production logic",
    "",
    "| period | run | full delta | candidate PnL | trades | cap100 PnL | cap300 PnL |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row: any) => `| ${row.period} | ${row.run} | ${row.fullDelta} | ${row.candidatePnl} | ${row.candidateTrades} | ${row.capped.cap100} | ${row.capped.cap300} |`),
    "",
    "## Trades",
    "",
    "| period | run | symbol | entry | exit | full notional | full PnL | return % | cap100 | cap300 | exit |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...trades.map((trade: any) => `| ${trade.period} | ${trade.run} | ${trade.symbol} | ${trade.entry} | ${trade.exit} | ${trade.fullNotional} | ${trade.fullNetPnl} | ${trade.returnPct} | ${trade.cap100} | ${trade.cap300} | ${trade.exitReason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "capped-result.json"), JSON.stringify({ rows, trades }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "capped-result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
