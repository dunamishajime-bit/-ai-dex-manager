import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";
import { renderComparisonMarkdown, writeBacktestArtifacts } from "@/lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "range-only-2024-2025");

const BASELINE_OPTIONS: HybridVariantOptions = {
    useThreeWayRegime: true,
    rangeEntryMode: "box_rebound",
    rangeSymbols: ["ETH"],
    trendWeakExitBestMom20Below: 0.05,
    trendWeakExitBtcAdxBelow: 18,
    trendMinEfficiencyRatio: 0.22,
    rangeAlloc: 0.35,
    rangeRegimeBtcDistMin: -0.03,
    rangeRegimeBtcDistMax: 0.02,
    rangeRegimeBtcAdxMax: 22,
    rangeRegimeBreadth40Max: 2,
    rangeRegimeBestMom20Min: -0.04,
    rangeRegimeBestMom20Max: 0.035,
    rangeEntryBestMom20Below: -0.004,
    rangeEntryBtcAdxBelow: 20,
    rangeOverheatMax: -0.01,
    rangeExitMom20Above: 0.008,
    rangeMaxHoldBars: 3,
    activeYears: [2024, 2025],
};

const RECLAIM_OPTIONS: HybridVariantOptions = {
    useThreeWayRegime: true,
    rangeEntryMode: "reclaim",
    rangeSymbols: ["ETH"],
    trendWeakExitBestMom20Below: 0.05,
    trendWeakExitBtcAdxBelow: 18,
    trendMinEfficiencyRatio: 0.22,
    rangeAlloc: 0.35,
    rangeRegimeBtcDistMin: -0.03,
    rangeRegimeBtcDistMax: 0.02,
    rangeRegimeBtcAdxMax: 22,
    rangeRegimeBreadth40Max: 2,
    rangeRegimeBestMom20Min: -0.04,
    rangeRegimeBestMom20Max: 0.035,
    rangeEntryBestMom20Below: -0.003,
    rangeEntryBtcAdxBelow: 20,
    rangeOverheatMax: -0.009,
    rangeExitMom20Above: 0.01,
    rangeMaxHoldBars: 3,
    activeYears: [2024, 2025],
};

async function main() {
    const trendPlusRange = await runHybridBacktest("RETQ22", {
        ...RECLAIM_OPTIONS,
        label: "trend_plus_range_2024_2025",
    });

    const rangeOnlyRebound = await runHybridBacktest("RETQ22", {
        ...BASELINE_OPTIONS,
        label: "range_only_2024_2025_box_rebound",
        disableTrend: true,
        ignoreRangeRegimeGate: true,
    });

    const rangeOnlyReclaim = await runHybridBacktest("RETQ22", {
        ...RECLAIM_OPTIONS,
        label: "range_only_2024_2025_reclaim",
        disableTrend: true,
        ignoreRangeRegimeGate: true,
    });

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const files = {
        trendPlusRange: await writeBacktestArtifacts(trendPlusRange, path.join(REPORT_DIR, "trend_plus_range")),
        rangeOnlyRebound: await writeBacktestArtifacts(rangeOnlyRebound, path.join(REPORT_DIR, "range_only_box_rebound")),
        rangeOnlyReclaim: await writeBacktestArtifacts(rangeOnlyReclaim, path.join(REPORT_DIR, "range_only_reclaim")),
    };

    const comparison = [
        "# 2024-2025 Range Only Comparison",
        "",
        "| Strategy | End Equity | CAGR | MaxDD | PF | Trades |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        `| trend_plus_range_2024_2025 | ${trendPlusRange.summary.end_equity.toFixed(2)} | ${trendPlusRange.summary.cagr_pct.toFixed(2)}% | ${trendPlusRange.summary.max_drawdown_pct.toFixed(2)}% | ${trendPlusRange.summary.profit_factor.toFixed(3)} | ${trendPlusRange.summary.trade_count} |`,
        `| range_only_2024_2025_box_rebound | ${rangeOnlyRebound.summary.end_equity.toFixed(2)} | ${rangeOnlyRebound.summary.cagr_pct.toFixed(2)}% | ${rangeOnlyRebound.summary.max_drawdown_pct.toFixed(2)}% | ${rangeOnlyRebound.summary.profit_factor.toFixed(3)} | ${rangeOnlyRebound.summary.trade_count} |`,
        `| range_only_2024_2025_reclaim | ${rangeOnlyReclaim.summary.end_equity.toFixed(2)} | ${rangeOnlyReclaim.summary.cagr_pct.toFixed(2)}% | ${rangeOnlyReclaim.summary.max_drawdown_pct.toFixed(2)}% | ${rangeOnlyReclaim.summary.profit_factor.toFixed(3)} | ${rangeOnlyReclaim.summary.trade_count} |`,
        "",
        "## Trend + Range",
        renderComparisonMarkdown(trendPlusRange, rangeOnlyRebound),
        "",
        "## Range Only Rebound vs Reclaim",
        renderComparisonMarkdown(rangeOnlyRebound, rangeOnlyReclaim),
    ].join("\n");

    const comparisonMd = path.join(REPORT_DIR, "comparison.md");
    await fs.writeFile(comparisonMd, comparison, "utf8");

    const summary = {
        trendPlusRange: trendPlusRange.summary,
        rangeOnlyRebound: rangeOnlyRebound.summary,
        rangeOnlyReclaim: rangeOnlyReclaim.summary,
        files,
        comparisonMd,
    };

    await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
