import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, runTop2TrendBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { writeBacktestArtifacts, formatResultSummary } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "top2-trend");

const TOP2_OPTIONS: HybridVariantOptions = {
    label: "retq22_top2_trend_v1",
    disableTrend: false,
    forceRangeOnly: false,
};

async function main() {
    const current = await runHybridBacktest("RETQ22", {
        ...TOP2_OPTIONS,
        label: "current_retq22_reference",
    });
    const top2 = await runTop2TrendBacktest(TOP2_OPTIONS);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const currentFiles = await writeBacktestArtifacts(current, path.join(REPORT_DIR, "current-retq22"));
    const top2Files = await writeBacktestArtifacts(top2, path.join(REPORT_DIR, "top2-trend"));

    const comparisonMd = [
        "# Top 2 Trend Compare",
        "",
        "## Strategy idea",
        "",
        "- Use the current 12H RETQ22 trend evaluation.",
        "- Hold the top 2 eligible trend symbols at the same time.",
        "- Stay in cash when no trend candidate is available.",
        "- No range overlay is used in this test.",
        "",
        "## Current RETQ22",
        "",
        formatResultSummary(current),
        "",
        "## Top 2 Trend",
        "",
        formatResultSummary(top2),
        "",
        "## Delta",
        "",
        `- End Equity delta: ${(top2.summary.end_equity - current.summary.end_equity).toFixed(2)}`,
        `- CAGR delta: ${(top2.summary.cagr_pct - current.summary.cagr_pct).toFixed(2)}%`,
        `- MaxDD delta: ${(top2.summary.max_drawdown_pct - current.summary.max_drawdown_pct).toFixed(2)}%`,
        `- WinRate delta: ${(top2.summary.win_rate_pct - current.summary.win_rate_pct).toFixed(2)}%`,
        `- Profit Factor delta: ${(top2.summary.profit_factor - current.summary.profit_factor).toFixed(2)}`,
        `- Trade Count delta: ${top2.summary.trade_count - current.summary.trade_count}`,
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                current: current.summary,
                top2: top2.summary,
                files: {
                    current: currentFiles,
                    top2: top2Files,
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
                current: current.summary,
                top2: top2.summary,
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
