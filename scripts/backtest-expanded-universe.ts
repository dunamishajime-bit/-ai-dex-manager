import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest, runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { writeBacktestArtifacts, formatResultSummary } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "expanded-universe");

const EXPANDED_OPTIONS: HybridVariantOptions = {
    label: "retq22_expanded_universe_v1",
};

async function main() {
    const current = await runHybridBacktest("RETQ22", {
        ...EXPANDED_OPTIONS,
        label: "current_retq22_reference",
    });
    const expanded = await runExpandedUniverseBacktest(EXPANDED_OPTIONS);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const currentFiles = await writeBacktestArtifacts(current, path.join(REPORT_DIR, "current-retq22"));
    const expandedFiles = await writeBacktestArtifacts(expanded, path.join(REPORT_DIR, "expanded"));

    const comparisonMd = [
        "# Expanded Universe Compare",
        "",
        "## Strategy idea",
        "",
        "- Keep current RETQ22 trend/risk logic.",
        "- Expand trend candidate universe from ETH/SOL/AVAX to ETH/SOL/AVAX/BNB/LINK.",
        "- Hold a single best symbol as before.",
        "",
        "## Current RETQ22",
        "",
        formatResultSummary(current),
        "",
        "## Expanded Universe",
        "",
        formatResultSummary(expanded),
        "",
        "## Delta",
        "",
        `- End Equity delta: ${(expanded.summary.end_equity - current.summary.end_equity).toFixed(2)}`,
        `- CAGR delta: ${(expanded.summary.cagr_pct - current.summary.cagr_pct).toFixed(2)}%`,
        `- MaxDD delta: ${(expanded.summary.max_drawdown_pct - current.summary.max_drawdown_pct).toFixed(2)}%`,
        `- WinRate delta: ${(expanded.summary.win_rate_pct - current.summary.win_rate_pct).toFixed(2)}%`,
        `- Profit Factor delta: ${(expanded.summary.profit_factor - current.summary.profit_factor).toFixed(2)}`,
        `- Trade Count delta: ${expanded.summary.trade_count - current.summary.trade_count}`,
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                current: current.summary,
                expanded: expanded.summary,
                files: {
                    current: currentFiles,
                    expanded: expandedFiles,
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
                expanded: expanded.summary,
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
