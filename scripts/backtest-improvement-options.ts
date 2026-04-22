import fs from "fs/promises";
import path from "path";

import {
    runHybridBacktest,
    runRetq22With1hEarlyEntryBacktest,
    type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine.ts";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "improvement-options");

const VARIANTS: Array<{ key: string; title: string; options: HybridVariantOptions; runner?: "early-entry" }> = [
    {
        key: "exit-4h",
        title: "12H entry + 4H exit check",
        options: {
            label: "retq22_exit_check_4h",
            trendExitCheckTimeframe: "4h",
        },
    },
    {
        key: "decision-6h",
        title: "6H decision",
        options: {
            label: "retq22_decision_6h",
            trendDecisionTimeframe: "6h",
        },
    },
    {
        key: "decision-6h-exit-4h",
        title: "6H decision + 4H exit check",
        options: {
            label: "retq22_decision_6h_exit_check_4h",
            trendDecisionTimeframe: "6h",
            trendExitCheckTimeframe: "4h",
        },
    },
    {
        key: "sma40-exit",
        title: "12H decision + faster SMA40 exit",
        options: {
            label: "retq22_sma40_exit",
            trendExitSma: 40,
        },
    },
    {
        key: "efficiency-030",
        title: "12H decision + stricter efficiency filter",
        options: {
            label: "retq22_efficiency_030",
            trendMinEfficiencyRatio: 0.3,
        },
    },
    {
        key: "early-entry-1h-reference",
        title: "1H early-entry reference",
        runner: "early-entry",
        options: {
            label: "retq22_1h_early_entry_reference",
            trendEntryAssistRequireMomentum: true,
            trendEntryAssistRequireCloseAboveSma: true,
            trendEntryAssistMaxMomAccelBelow: -0.02,
        },
    },
];

function delta(value: number, base: number) {
    return value - base;
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });
    const baselineFiles = await writeBacktestArtifacts(baseline, path.join(REPORT_DIR, "baseline"));

    const results = [];
    for (const variant of VARIANTS) {
        const result = variant.runner === "early-entry"
            ? await runRetq22With1hEarlyEntryBacktest(variant.options)
            : await runHybridBacktest("RETQ22", variant.options);
        const files = await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
        results.push({
            key: variant.key,
            title: variant.title,
            summary: result.summary,
            files,
        });
    }

    const md = [
        "# Improvement Options Backtest",
        "",
        "## Baseline",
        "",
        formatResultSummary(baseline),
        "",
        "## Comparison",
        "",
        "| variant | end_equity | CAGR % | MaxDD % | WinRate % | PF | trades | delta equity | delta CAGR | delta MaxDD |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...results.map((item) =>
            `| ${item.title} | ${item.summary.end_equity.toFixed(2)} | ${item.summary.cagr_pct.toFixed(2)} | ${item.summary.max_drawdown_pct.toFixed(2)} | ${item.summary.win_rate_pct.toFixed(2)} | ${item.summary.profit_factor.toFixed(2)} | ${item.summary.trade_count} | ${delta(item.summary.end_equity, baseline.summary.end_equity).toFixed(2)} | ${delta(item.summary.cagr_pct, baseline.summary.cagr_pct).toFixed(2)} | ${delta(item.summary.max_drawdown_pct, baseline.summary.max_drawdown_pct).toFixed(2)} |`,
        ),
        "",
        "## Details",
        "",
        ...results.flatMap((item) => [
            `### ${item.title}`,
            "",
            formatResultSummary({
                ...baseline,
                summary: item.summary,
            }),
            "",
        ]),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), md, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                baseline: baseline.summary,
                baselineFiles,
                results,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log(JSON.stringify({ baseline: baseline.summary, results }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
