import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "idle-meme-variants");

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

const BASE = buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);

function memeBreakdown(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const bySymbol = ["DOGE", "PENGU"].map((symbol) => {
    const trades = result.trade_pairs.filter((trade) => trade.symbol === symbol);
    const pnl = trades.reduce((sum, trade) => sum + trade.net_pnl, 0);
    const losses = trades.filter((trade) => trade.net_pnl < 0);
    const quickLosses = losses.filter((trade) => trade.holding_bars <= 3).length;
    const lateExitLike = losses.filter((trade) =>
      ["sma40-break", "sma-break", "weak-trend-off", "risk-off", "end-of-test"].includes(trade.exit_reason),
    ).length;
    return {
      symbol,
      trade_count: trades.length,
      pnl: Number(pnl.toFixed(2)),
      loss_count: losses.length,
      quick_loss_count: quickLosses,
      late_exit_like_count: lateExitLike,
    };
  });
  return Object.fromEntries(bySymbol.map((row) => [row.symbol, row]));
}

const VARIANTS: VariantSpec[] = [
  {
    key: "base_pengu_idle",
    thesis: "Strongest reference: aux 100% + PENGU idle-only.",
    options: {
      ...BASE,
      label: "base_pengu_idle",
    },
  },
  {
    key: "doge_pengu_idle",
    thesis: "Add DOGE together with PENGU as idle-only extra trend symbols.",
    options: {
      ...BASE,
      strictExtraTrendSymbols: ["PENGU", "DOGE"],
      strictExtraTrendIdleOnly: true,
      label: "doge_pengu_idle",
    },
  },
  {
    key: "doge_pengu_idle_sma40_exit",
    thesis: "Add DOGE idle-only and speed up exits with SMA40 trend exits.",
    options: {
      ...BASE,
      strictExtraTrendSymbols: ["PENGU", "DOGE"],
      strictExtraTrendIdleOnly: true,
      trendExitSma: 40,
      label: "doge_pengu_idle_sma40_exit",
    },
  },
  {
    key: "doge_pengu_idle_sma40_exit_eff018",
    thesis: "Add DOGE idle-only, use SMA40 exits, and loosen efficiency slightly for earlier entries.",
    options: {
      ...BASE,
      strictExtraTrendSymbols: ["PENGU", "DOGE"],
      strictExtraTrendIdleOnly: true,
      trendExitSma: 40,
      trendMinEfficiencyRatio: 0.18,
      label: "doge_pengu_idle_sma40_exit_eff018",
    },
  },
];

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: Array<{
    key: string;
    thesis: string;
    end_equity: number;
    cagr_pct: number;
    max_drawdown_pct: number;
    profit_factor: number;
    trade_count: number;
    win_rate_pct: number;
    symbol_contribution: Record<string, number>;
    meme_breakdown: ReturnType<typeof memeBreakdown>;
  }> = [];

  for (const variant of VARIANTS) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      end_equity: Number(result.summary.end_equity.toFixed(2)),
      cagr_pct: Number(result.summary.cagr_pct.toFixed(2)),
      max_drawdown_pct: Number(result.summary.max_drawdown_pct.toFixed(2)),
      profit_factor: Number(result.summary.profit_factor.toFixed(3)),
      trade_count: result.summary.trade_count,
      win_rate_pct: Number(result.summary.win_rate_pct.toFixed(2)),
      symbol_contribution: result.summary.symbol_contribution,
      meme_breakdown: memeBreakdown(result),
    });
    console.log(`${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count}`);
  }

  const md = [
    "# Idle Meme Variants",
    "",
    `Base profile: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | DOGE pnl | DOGE losses | DOGE late-exit-like | PENGU pnl | PENGU losses | PENGU late-exit-like |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => {
      const doge = row.meme_breakdown.DOGE;
      const pengu = row.meme_breakdown.PENGU;
      return `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${doge.pnl} | ${doge.loss_count} | ${doge.late_exit_like_count} | ${pengu.pnl} | ${pengu.loss_count} | ${pengu.late_exit_like_count} |`;
    }),
    "",
    "## Summaries",
    "",
    ...rows.flatMap((row) => [
      `### ${row.key}`,
      "",
      `- Thesis: ${row.thesis}`,
      `- DOGE: ${JSON.stringify(row.meme_breakdown.DOGE)}`,
      `- PENGU: ${JSON.stringify(row.meme_breakdown.PENGU)}`,
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({ rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
