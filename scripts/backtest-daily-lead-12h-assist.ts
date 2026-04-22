import fs from "fs/promises";
import path from "path";

import { runDailyLead12hAssistBacktest, runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { writeBacktestArtifacts, formatResultSummary } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "daily-lead-12h-assist");

const DAILY_LEAD_OPTIONS: HybridVariantOptions = {
    label: "daily_lead_12h_assist_v1",
    trendExitSma: 40,
    trendMinEfficiencyRatio: 0.15,
    trendWeakExitBestMom20Below: 0.03,
    trendWeakExitBtcAdxBelow: 18,
    trendEntryAssistRequireMomentum: true,
    trendEntryAssistRequireCloseAboveSma: true,
    trendEntryAssistMaxMomAccelBelow: -0.015,
};

async function main() {
    const current = await runHybridBacktest("RETQ22", {
        ...DAILY_LEAD_OPTIONS,
        label: "current_retq22_reference",
    });
    const dailyLead = await runDailyLead12hAssistBacktest(DAILY_LEAD_OPTIONS);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const currentFiles = await writeBacktestArtifacts(current, path.join(REPORT_DIR, "current-retq22"));
    const dailyLeadFiles = await writeBacktestArtifacts(dailyLead, path.join(REPORT_DIR, "daily-lead"));

    const comparisonMd = [
        "# Daily Lead + 12H Assist",
        "",
        "## Strategy idea",
        "",
        "- Daily trend decides whether to hold risk assets.",
        "- 12H only helps timing the entry into the daily trend.",
        "- No range overlay is used in this test.",
        "",
        "## Current RETQ22",
        "",
        formatResultSummary(current),
        "",
        "## Daily Lead + 12H Assist",
        "",
        formatResultSummary(dailyLead),
        "",
        "## Delta",
        "",
        `- End Equity delta: ${(dailyLead.summary.end_equity - current.summary.end_equity).toFixed(2)}`,
        `- CAGR delta: ${(dailyLead.summary.cagr_pct - current.summary.cagr_pct).toFixed(2)}%`,
        `- MaxDD delta: ${(dailyLead.summary.max_drawdown_pct - current.summary.max_drawdown_pct).toFixed(2)}%`,
        `- WinRate delta: ${(dailyLead.summary.win_rate_pct - current.summary.win_rate_pct).toFixed(2)}%`,
        `- Profit Factor delta: ${(dailyLead.summary.profit_factor - current.summary.profit_factor).toFixed(2)}`,
        `- Trade Count delta: ${dailyLead.summary.trade_count - current.summary.trade_count}`,
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                current: current.summary,
                dailyLead: dailyLead.summary,
                files: {
                    current: currentFiles,
                    dailyLead: dailyLeadFiles,
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
                dailyLead: dailyLead.summary,
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
