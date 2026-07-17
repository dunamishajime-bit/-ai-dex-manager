import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-current-fast-exits");
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59);

const PENGU_ONLY_BASE: HybridVariantOptions = {
  backtestEndTs: END_TS,
  trendAlloc: 1,
  rangeSymbols: [],
  auxRangeSymbols: [],
  aux2RangeSymbols: [],
  expandedTrendSymbols: [],
  strictExtraTrendSymbols: ["PENGU"],
  strictExtraTrendIdleOnly: false,
  strictExtraTrendMinEfficiencyRatioBySymbol: {
    PENGU: 0.22,
  },
  strictExtraTrendTrailActivationPct: 0.18,
  strictExtraTrendTrailRetracePct: 0.08,
  trendSymbolBlockWindows: {
    ETH: [{ startTs: 0, endTs: END_TS }],
    SOL: [{ startTs: 0, endTs: END_TS }],
    AVAX: [{ startTs: 0, endTs: END_TS }],
    INJ: [{ startTs: 0, endTs: END_TS }],
    UNI: [{ startTs: 0, endTs: END_TS }],
    TWT: [{ startTs: 0, endTs: END_TS }],
    DOGE: [{ startTs: 0, endTs: END_TS }],
  },
};

const VARIANTS: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
  {
    key: "baseline_current_exit",
    thesis: "Current PENGU-only entry and exit settings.",
    options: {
      ...PENGU_ONLY_BASE,
      label: "baseline_current_exit",
    },
  },
  {
    key: "exit_check_6h",
    thesis: "Entry unchanged; only exit checks run on 6H instead of the current slower check.",
    options: {
      ...PENGU_ONLY_BASE,
      strictExtraTrendExitCheckTimeframe: "6h",
      label: "exit_check_6h",
    },
  },
  {
    key: "exit_check_4h",
    thesis: "Entry unchanged; only exit checks run on 4H.",
    options: {
      ...PENGU_ONLY_BASE,
      strictExtraTrendExitCheckTimeframe: "4h",
      label: "exit_check_4h",
    },
  },
  {
    key: "fast_trail_6h",
    thesis: "Entry unchanged; 6H exit check plus faster profit protection.",
    options: {
      ...PENGU_ONLY_BASE,
      strictExtraTrendExitCheckTimeframe: "6h",
      strictExtraTrendTrailActivationPct: 0.12,
      strictExtraTrendTrailRetracePct: 0.055,
      label: "fast_trail_6h",
    },
  },
  {
    key: "faster_trail_6h",
    thesis: "Entry unchanged; 6H exit check with more aggressive profit protection.",
    options: {
      ...PENGU_ONLY_BASE,
      strictExtraTrendExitCheckTimeframe: "6h",
      strictExtraTrendTrailActivationPct: 0.09,
      strictExtraTrendTrailRetracePct: 0.04,
      label: "faster_trail_6h",
    },
  },
  {
    key: "hard_2day_exit_6h",
    thesis: "Entry unchanged; 6H exit check plus maximum two-day hold.",
    options: {
      ...PENGU_ONLY_BASE,
      strictExtraTrendExitCheckTimeframe: "6h",
      strictExtraTrendMaxHoldBars: 8,
      label: "hard_2day_exit_6h",
    },
  },
  {
    key: "fast_trail_2day_6h",
    thesis: "Entry unchanged; 6H exit check, faster profit protection, and maximum two-day hold.",
    options: {
      ...PENGU_ONLY_BASE,
      strictExtraTrendExitCheckTimeframe: "6h",
      strictExtraTrendTrailActivationPct: 0.12,
      strictExtraTrendTrailRetracePct: 0.055,
      strictExtraTrendMaxHoldBars: 8,
      label: "fast_trail_2day_6h",
    },
  },
];

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows: Array<Record<string, unknown>> = [];

  for (const variant of VARIANTS) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    const lossReasons = result.trade_pairs
      .filter((trade) => trade.net_pnl <= 0)
      .reduce<Record<string, { count: number; pnl: number }>>((acc, trade) => {
        const current = acc[trade.exit_reason] ?? { count: 0, pnl: 0 };
        current.count += 1;
        current.pnl += trade.net_pnl;
        acc[trade.exit_reason] = current;
        return acc;
      }, {});
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      end_equity: Number(result.summary.end_equity.toFixed(2)),
      cagr_pct: Number(result.summary.cagr_pct.toFixed(2)),
      max_drawdown_pct: Number(result.summary.max_drawdown_pct.toFixed(2)),
      profit_factor: Number(result.summary.profit_factor.toFixed(3)),
      win_rate_pct: Number(result.summary.win_rate_pct.toFixed(2)),
      trade_count: result.summary.trade_count,
      pengu_contribution: Number((result.summary.symbol_contribution.PENGU ?? 0).toFixed(2)),
      avg_hold_bars: result.trade_pairs.length
        ? Number((result.trade_pairs.reduce((sum, trade) => sum + trade.holding_bars, 0) / result.trade_pairs.length).toFixed(2))
        : 0,
      loss_reasons: lossReasons,
      summary: formatResultSummary(result),
    });
    console.log(`${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} PF=${result.summary.profit_factor.toFixed(3)} trades=${result.summary.trade_count}`);
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# PENGU Current Logic Fast Exit Tests",
      "",
      "PENGU entry logic is unchanged. Only exit speed, profit trailing, and optional max hold are changed.",
      "",
      "| variant | end equity | CAGR % | MaxDD % | PF | win % | trades | avg hold bars | PENGU pnl | thesis |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      ...rows.map((row) => `| ${row.key} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.avg_hold_bars} | ${row.pengu_contribution} | ${row.thesis} |`),
      "",
      "## Loss Reasons",
      "",
      "```json",
      JSON.stringify(Object.fromEntries(rows.map((row) => [row.key, row.loss_reasons])), null, 2),
      "```",
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
