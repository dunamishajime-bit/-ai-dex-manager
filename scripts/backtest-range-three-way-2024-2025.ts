import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "range-three-way-2024-2025");

const COMMON: HybridVariantOptions = {
    activeYears: [2024, 2025],
    disableTrend: true,
    ignoreRangeRegimeGate: true,
    useThreeWayRegime: true,
    rangeAlloc: 1,
    rangeOverheatMax: -0.01,
    rangeExitMom20Above: 0.01,
    rangeMaxHoldBars: 4,
    rangeRegimeBtcDistMin: -0.04,
    rangeRegimeBtcDistMax: 0.03,
    rangeRegimeBtcAdxMax: 30,
    rangeRegimeBreadth40Max: 3,
    rangeRegimeBestMom20Min: -0.2,
    rangeRegimeBestMom20Max: 0.2,
    rangeEntryBestMom20Below: 0.03,
    rangeEntryBtcAdxBelow: 30,
};

async function main() {
    const wickRejection = await runHybridBacktest("RETQ22", {
        ...COMMON,
        label: "range_wick_rejection_2024_2025",
        rangeEntryMode: "wick_rejection",
        rangeSymbols: ["ETH", "SOL", "AVAX"],
    });

    const midlineReclaim = await runHybridBacktest("RETQ22", {
        ...COMMON,
        label: "range_midline_reclaim_2024_2025",
        rangeEntryMode: "midline_reclaim",
        rangeSymbols: ["ETH", "SOL", "AVAX"],
        rangeExitMom20Above: 0.012,
    });

    const volatilitySpring = await runHybridBacktest("RETQ22", {
        ...COMMON,
        label: "range_volatility_spring_2024_2025",
        rangeEntryMode: "volatility_spring",
        rangeSymbols: ["ETH", "SOL", "AVAX"],
        rangeExitMom20Above: 0.015,
        rangeMaxHoldBars: 6,
    });

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.md"),
        [
            "# Range Three Way 2024-2025",
            "",
            "| Strategy | End Equity | CAGR | MaxDD | PF | Trades | Exposure |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
            `| wick_rejection | ${wickRejection.summary.end_equity.toFixed(2)} | ${wickRejection.summary.cagr_pct.toFixed(2)}% | ${wickRejection.summary.max_drawdown_pct.toFixed(2)}% | ${wickRejection.summary.profit_factor.toFixed(3)} | ${wickRejection.summary.trade_count} | ${wickRejection.summary.exposure_pct.toFixed(2)}% |`,
            `| midline_reclaim | ${midlineReclaim.summary.end_equity.toFixed(2)} | ${midlineReclaim.summary.cagr_pct.toFixed(2)}% | ${midlineReclaim.summary.max_drawdown_pct.toFixed(2)}% | ${midlineReclaim.summary.profit_factor.toFixed(3)} | ${midlineReclaim.summary.trade_count} | ${midlineReclaim.summary.exposure_pct.toFixed(2)}% |`,
            `| volatility_spring | ${volatilitySpring.summary.end_equity.toFixed(2)} | ${volatilitySpring.summary.cagr_pct.toFixed(2)}% | ${volatilitySpring.summary.max_drawdown_pct.toFixed(2)}% | ${volatilitySpring.summary.profit_factor.toFixed(3)} | ${volatilitySpring.summary.trade_count} | ${volatilitySpring.summary.exposure_pct.toFixed(2)}% |`,
            "",
            "## Summaries",
            "",
            "### wick_rejection",
            JSON.stringify(wickRejection.summary, null, 2),
            "",
            "### midline_reclaim",
            JSON.stringify(midlineReclaim.summary, null, 2),
            "",
            "### volatility_spring",
            JSON.stringify(volatilitySpring.summary, null, 2),
            "",
        ].join("\n"),
        "utf8",
    );

    await fs.writeFile(
        path.join(REPORT_DIR, "summary.json"),
        JSON.stringify({
            wickRejection: wickRejection.summary,
            midlineReclaim: midlineReclaim.summary,
            volatilitySpring: volatilitySpring.summary,
        }, null, 2),
        "utf8",
    );

    console.log(JSON.stringify({
        wickRejection: wickRejection.summary,
        midlineReclaim: midlineReclaim.summary,
        volatilitySpring: volatilitySpring.summary,
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
