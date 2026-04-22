import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "../config/reclaimHybridStrategy";
import { runExpandedUniverseBacktest } from "../lib/backtest/hybrid-engine.ts";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "twt-production-like");

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runExpandedUniverseBacktest({
        label: "production_like_baseline",
        expandedTrendSymbols: RECLAIM_HYBRID_EXECUTION_PROFILE.expandedTrendSymbols,
        trendPrioritySymbols: RECLAIM_HYBRID_EXECUTION_PROFILE.trendPrioritySymbols,
    });

    const twtVariant = await runExpandedUniverseBacktest({
        label: "production_like_with_twt",
        expandedTrendSymbols: [...RECLAIM_HYBRID_EXECUTION_PROFILE.expandedTrendSymbols, "TWT"],
        trendPrioritySymbols: RECLAIM_HYBRID_EXECUTION_PROFILE.trendPrioritySymbols,
    });

    const baselineFiles = await writeBacktestArtifacts(baseline, path.join(REPORT_DIR, "baseline"));
    const twtFiles = await writeBacktestArtifacts(twtVariant, path.join(REPORT_DIR, "twt"));

    const comparisonMd = [
        "# TWT Production-like Compare",
        "",
        "## Baseline Production-like",
        "",
        formatResultSummary(baseline),
        "",
        "## Production-like + TWT",
        "",
        formatResultSummary(twtVariant),
        "",
        "## Delta",
        "",
        `- End Equity delta: ${(twtVariant.summary.end_equity - baseline.summary.end_equity).toFixed(2)}`,
        `- CAGR delta: ${(twtVariant.summary.cagr_pct - baseline.summary.cagr_pct).toFixed(2)}%`,
        `- MaxDD delta: ${(twtVariant.summary.max_drawdown_pct - baseline.summary.max_drawdown_pct).toFixed(2)}%`,
        `- WinRate delta: ${(twtVariant.summary.win_rate_pct - baseline.summary.win_rate_pct).toFixed(2)}%`,
        `- Profit Factor delta: ${(twtVariant.summary.profit_factor - baseline.summary.profit_factor).toFixed(2)}`,
        `- Trade Count delta: ${twtVariant.summary.trade_count - baseline.summary.trade_count}`,
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                baseline: baseline.summary,
                twt: twtVariant.summary,
                files: {
                    baseline: baselineFiles,
                    twt: twtFiles,
                    comparison: path.join(REPORT_DIR, "comparison.md"),
                },
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log(
        JSON.stringify(
            {
                baseline: baseline.summary,
                twt: twtVariant.summary,
            },
            null,
            2,
        ),
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
