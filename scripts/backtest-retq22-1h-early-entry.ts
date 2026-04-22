import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, runRetq22With1hEarlyEntryBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { writeBacktestArtifacts, formatResultSummary } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "retq22-1h-early-entry");

const EARLY_ENTRY_OPTIONS: HybridVariantOptions = {
    label: "retq22_1h_early_entry_v1",
    trendEntryAssistRequireMomentum: true,
    trendEntryAssistRequireCloseAboveSma: true,
    trendEntryAssistMaxMomAccelBelow: -0.02,
};

async function main() {
    const current = await runHybridBacktest("RETQ22", {
        ...EARLY_ENTRY_OPTIONS,
        label: "current_retq22_reference",
    });
    const earlyEntry = await runRetq22With1hEarlyEntryBacktest(EARLY_ENTRY_OPTIONS);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const currentFiles = await writeBacktestArtifacts(current, path.join(REPORT_DIR, "current-retq22"));
    const earlyEntryFiles = await writeBacktestArtifacts(earlyEntry, path.join(REPORT_DIR, "early-entry"));

    const comparisonMd = [
        "# RETQ22 + 1H Early Entry",
        "",
        "## Strategy idea",
        "",
        "- 12H still decides the tradable symbol and exit logic.",
        "- 1H only allows earlier entry into the 12H-approved symbol.",
        "- No 1H exit is used in this test.",
        "",
        "## Current RETQ22",
        "",
        formatResultSummary(current),
        "",
        "## RETQ22 + 1H Early Entry",
        "",
        formatResultSummary(earlyEntry),
        "",
        "## Delta",
        "",
        `- End Equity delta: ${(earlyEntry.summary.end_equity - current.summary.end_equity).toFixed(2)}`,
        `- CAGR delta: ${(earlyEntry.summary.cagr_pct - current.summary.cagr_pct).toFixed(2)}%`,
        `- MaxDD delta: ${(earlyEntry.summary.max_drawdown_pct - current.summary.max_drawdown_pct).toFixed(2)}%`,
        `- WinRate delta: ${(earlyEntry.summary.win_rate_pct - current.summary.win_rate_pct).toFixed(2)}%`,
        `- Profit Factor delta: ${(earlyEntry.summary.profit_factor - current.summary.profit_factor).toFixed(2)}`,
        `- Trade Count delta: ${earlyEntry.summary.trade_count - current.summary.trade_count}`,
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                current: current.summary,
                earlyEntry: earlyEntry.summary,
                files: {
                    current: currentFiles,
                    earlyEntry: earlyEntryFiles,
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
                earlyEntry: earlyEntry.summary,
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
