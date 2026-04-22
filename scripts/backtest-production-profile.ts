import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "../config/reclaimHybridStrategy";
import { runExpandedUniverseBacktest, runHybridBacktest } from "../lib/backtest/hybrid-engine.ts";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "production-profile");

async function main() {
    const baseline = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });

    const productionLike = await runExpandedUniverseBacktest({
        label: "retq22_production_profile",
        expandedTrendSymbols: RECLAIM_HYBRID_EXECUTION_PROFILE.expandedTrendSymbols,
        trendPrioritySymbols: RECLAIM_HYBRID_EXECUTION_PROFILE.trendPrioritySymbols,
    });

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const baselineFiles = await writeBacktestArtifacts(baseline, path.join(REPORT_DIR, "baseline"));
    const productionFiles = await writeBacktestArtifacts(productionLike, path.join(REPORT_DIR, "production"));

    const comparisonMd = [
        "# Production Profile Compare",
        "",
        "## Baseline RETQ22",
        "",
        formatResultSummary(baseline),
        "",
        "## Production Profile",
        "",
        formatResultSummary(productionLike),
        "",
        "## Delta",
        "",
        `- End Equity delta: ${(productionLike.summary.end_equity - baseline.summary.end_equity).toFixed(2)}`,
        `- CAGR delta: ${(productionLike.summary.cagr_pct - baseline.summary.cagr_pct).toFixed(2)}%`,
        `- MaxDD delta: ${(productionLike.summary.max_drawdown_pct - baseline.summary.max_drawdown_pct).toFixed(2)}%`,
        `- WinRate delta: ${(productionLike.summary.win_rate_pct - baseline.summary.win_rate_pct).toFixed(2)}%`,
        `- Profit Factor delta: ${(productionLike.summary.profit_factor - baseline.summary.profit_factor).toFixed(2)}`,
        `- Trade Count delta: ${productionLike.summary.trade_count - baseline.summary.trade_count}`,
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                baseline: baseline.summary,
                production: productionLike.summary,
                files: {
                    baseline: baselineFiles,
                    production: productionFiles,
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
                production: productionLike.summary,
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
