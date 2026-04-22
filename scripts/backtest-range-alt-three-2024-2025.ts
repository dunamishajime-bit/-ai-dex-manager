import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "range-alt-three-2024-2025");

const COMMON: HybridVariantOptions = {
    activeYears: [2024, 2025],
    disableTrend: true,
    ignoreRangeRegimeGate: true,
    useThreeWayRegime: true,
    rangeAlloc: 1,
    rangeSymbols: ["ETH", "SOL", "AVAX"],
    rangeRegimeBtcDistMin: -0.06,
    rangeRegimeBtcDistMax: 0.04,
    rangeRegimeBtcAdxMax: 32,
    rangeRegimeBreadth40Max: 4,
    rangeRegimeBestMom20Min: -0.25,
    rangeRegimeBestMom20Max: 0.08,
    rangeEntryBestMom20Below: 0.04,
    rangeEntryBtcAdxBelow: 32,
};

async function main() {
    const failedBreakdown = await runHybridBacktest("RETQ22", {
        ...COMMON,
        label: "range_failed_breakdown_2024_2025",
        rangeEntryMode: "failed_breakdown",
        rangeOverheatMax: 0.02,
        rangeExitMom20Above: 0.008,
        rangeMaxHoldBars: 4,
    });

    const atrSnapback = await runHybridBacktest("RETQ22", {
        ...COMMON,
        label: "range_atr_snapback_2024_2025",
        rangeEntryMode: "atr_snapback",
        rangeOverheatMax: 0.015,
        rangeExitMom20Above: 0.012,
        rangeMaxHoldBars: 5,
    });

    const compressionTurn = await runHybridBacktest("RETQ22", {
        ...COMMON,
        label: "range_compression_turn_2024_2025",
        rangeEntryMode: "compression_turn",
        rangeOverheatMax: 0.025,
        rangeExitMom20Above: 0.01,
        rangeMaxHoldBars: 4,
    });

    const summary = {
        failedBreakdown: failedBreakdown.summary,
        atrSnapback: atrSnapback.summary,
        compressionTurn: compressionTurn.summary,
    };

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(
        path.join(REPORT_DIR, "summary.json"),
        JSON.stringify(summary, null, 2),
        "utf8",
    );

    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.md"),
        [
            "# Range Alt Three 2024-2025",
            "",
            "| Strategy | End Equity | CAGR | MaxDD | PF | Trades | Exposure |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
            `| failed_breakdown | ${failedBreakdown.summary.end_equity.toFixed(2)} | ${failedBreakdown.summary.cagr_pct.toFixed(2)}% | ${failedBreakdown.summary.max_drawdown_pct.toFixed(2)}% | ${failedBreakdown.summary.profit_factor.toFixed(3)} | ${failedBreakdown.summary.trade_count} | ${failedBreakdown.summary.exposure_pct.toFixed(2)}% |`,
            `| atr_snapback | ${atrSnapback.summary.end_equity.toFixed(2)} | ${atrSnapback.summary.cagr_pct.toFixed(2)}% | ${atrSnapback.summary.max_drawdown_pct.toFixed(2)}% | ${atrSnapback.summary.profit_factor.toFixed(3)} | ${atrSnapback.summary.trade_count} | ${atrSnapback.summary.exposure_pct.toFixed(2)}% |`,
            `| compression_turn | ${compressionTurn.summary.end_equity.toFixed(2)} | ${compressionTurn.summary.cagr_pct.toFixed(2)}% | ${compressionTurn.summary.max_drawdown_pct.toFixed(2)}% | ${compressionTurn.summary.profit_factor.toFixed(3)} | ${compressionTurn.summary.trade_count} | ${compressionTurn.summary.exposure_pct.toFixed(2)}% |`,
            "",
            "## Summary JSON",
            "",
            "```json",
            JSON.stringify(summary, null, 2),
            "```",
        ].join("\n"),
        "utf8",
    );

    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
