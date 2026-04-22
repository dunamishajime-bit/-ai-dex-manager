import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest, runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "zec-dash-excluding-outliers");
const BASE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;

const OUTLIER_BLOCKS: NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]> = {
    ZEC: [
        {
            startTs: Date.parse("2025-09-22T12:00:00.000Z"),
            endTs: Date.parse("2025-10-03T00:00:00.000Z"),
        },
    ],
    DASH: [
        {
            startTs: Date.parse("2025-10-11T00:00:00.000Z"),
            endTs: Date.parse("2025-11-05T00:00:00.000Z"),
        },
    ],
};

function delta(value: number, base: number) {
    return value - base;
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });
    const baselineFiles = await writeBacktestArtifacts(baseline, path.join(REPORT_DIR, "baseline"));

    const zecDashBlocked = await runExpandedUniverseBacktest({
        label: "retq22_plus_zec_dash_outliers_blocked",
        expandedTrendSymbols: [...BASE_SYMBOLS, "ZEC", "DASH"],
        trendSymbolBlockWindows: OUTLIER_BLOCKS,
    });
    const zecDashBlockedFiles = await writeBacktestArtifacts(zecDashBlocked, path.join(REPORT_DIR, "zec-dash-blocked"));

    const zecDashRaw = await runExpandedUniverseBacktest({
        label: "retq22_plus_zec_dash_raw_reference",
        expandedTrendSymbols: [...BASE_SYMBOLS, "ZEC", "DASH"],
    });
    const zecDashRawFiles = await writeBacktestArtifacts(zecDashRaw, path.join(REPORT_DIR, "zec-dash-raw-reference"));

    const results = [
        {
            key: "zec-dash-blocked",
            title: "ZEC + DASH, max-profit windows blocked",
            summary: zecDashBlocked.summary,
            files: zecDashBlockedFiles,
        },
        {
            key: "zec-dash-raw-reference",
            title: "ZEC + DASH, raw reference",
            summary: zecDashRaw.summary,
            files: zecDashRawFiles,
        },
    ];

    const md = [
        "# ZEC + DASH Outlier-Excluded Backtest",
        "",
        "## Baseline",
        "",
        formatResultSummary(baseline),
        "",
        "## Blocked windows",
        "",
        "- ZEC: 2025-09-22T12:00:00.000Z -> 2025-10-03T00:00:00.000Z",
        "- DASH: 2025-10-11T00:00:00.000Z -> 2025-11-05T00:00:00.000Z",
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
            `- contribution: ${JSON.stringify(item.summary.symbol_contribution)}`,
            "",
        ]),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), md, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify({ baseline: baseline.summary, baselineFiles, results }, null, 2),
        "utf8",
    );

    console.log(JSON.stringify({ baseline: baseline.summary, results }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
