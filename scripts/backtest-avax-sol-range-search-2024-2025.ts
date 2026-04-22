import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "avax-sol-range-search-2024-2025");

const BASE: HybridVariantOptions = {
    activeYears: [2024, 2025],
    disableTrend: true,
    ignoreRangeRegimeGate: true,
    useThreeWayRegime: true,
    rangeAlloc: 1,
    rangeEntryMode: "atr_snapback",
    rangeRegimeBtcDistMin: -0.06,
    rangeRegimeBtcDistMax: 0.04,
    rangeRegimeBtcAdxMax: 32,
    rangeRegimeBreadth40Max: 4,
    rangeRegimeBestMom20Min: -0.25,
    rangeRegimeBestMom20Max: 0.08,
    rangeEntryBestMom20Below: 0.04,
    rangeEntryBtcAdxBelow: 32,
};

const VARIANTS: { label: string; options: HybridVariantOptions }[] = [
    {
        label: "avax_sol_fast_base",
        options: {
            ...BASE,
            rangeSymbols: ["AVAX", "SOL"],
            rangeOverheatMax: 0.02,
            rangeExitMom20Above: 0.008,
            rangeMaxHoldBars: 4,
        },
    },
    {
        label: "avax_sol_quicker_exit",
        options: {
            ...BASE,
            rangeSymbols: ["AVAX", "SOL"],
            rangeOverheatMax: 0.02,
            rangeExitMom20Above: 0.006,
            rangeMaxHoldBars: 3,
        },
    },
    {
        label: "avax_sol_relaxed_entry",
        options: {
            ...BASE,
            rangeSymbols: ["AVAX", "SOL"],
            rangeOverheatMax: 0.03,
            rangeExitMom20Above: 0.008,
            rangeMaxHoldBars: 4,
            rangeRegimeBtcAdxMax: 35,
            rangeRegimeBestMom20Max: 0.12,
            rangeEntryBestMom20Below: 0.06,
        },
    },
    {
        label: "avax_sol_relaxed_entry_quick_exit",
        options: {
            ...BASE,
            rangeSymbols: ["AVAX", "SOL"],
            rangeOverheatMax: 0.03,
            rangeExitMom20Above: 0.006,
            rangeMaxHoldBars: 3,
            rangeRegimeBtcAdxMax: 35,
            rangeRegimeBestMom20Max: 0.12,
            rangeEntryBestMom20Below: 0.06,
        },
    },
    {
        label: "avax_only_fast_base",
        options: {
            ...BASE,
            rangeSymbols: ["AVAX"],
            rangeOverheatMax: 0.02,
            rangeExitMom20Above: 0.008,
            rangeMaxHoldBars: 4,
        },
    },
    {
        label: "avax_only_relaxed",
        options: {
            ...BASE,
            rangeSymbols: ["AVAX"],
            rangeOverheatMax: 0.03,
            rangeExitMom20Above: 0.006,
            rangeMaxHoldBars: 4,
            rangeRegimeBtcAdxMax: 35,
            rangeRegimeBestMom20Max: 0.12,
            rangeEntryBestMom20Below: 0.06,
        },
    },
    {
        label: "sol_only_fast_base",
        options: {
            ...BASE,
            rangeSymbols: ["SOL"],
            rangeOverheatMax: 0.02,
            rangeExitMom20Above: 0.008,
            rangeMaxHoldBars: 4,
        },
    },
    {
        label: "sol_only_relaxed",
        options: {
            ...BASE,
            rangeSymbols: ["SOL"],
            rangeOverheatMax: 0.03,
            rangeExitMom20Above: 0.006,
            rangeMaxHoldBars: 4,
            rangeRegimeBtcAdxMax: 35,
            rangeRegimeBestMom20Max: 0.12,
            rangeEntryBestMom20Below: 0.06,
        },
    },
];

async function main() {
    const results = [];
    for (const variant of VARIANTS) {
        const result = await runHybridBacktest("RETQ22", {
            ...variant.options,
            label: variant.label,
        });
        results.push({ label: variant.label, summary: result.summary });
    }

    results.sort((a, b) => b.summary.end_equity - a.summary.end_equity);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(results, null, 2), "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.md"),
        [
            "# AVAX SOL Range Search 2024-2025",
            "",
            "| Strategy | End Equity | CAGR | MaxDD | PF | Trades | Exposure |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
            ...results.map(({ label, summary }) =>
                `| ${label} | ${summary.end_equity.toFixed(2)} | ${summary.cagr_pct.toFixed(2)}% | ${summary.max_drawdown_pct.toFixed(2)}% | ${summary.profit_factor.toFixed(3)} | ${summary.trade_count} | ${summary.exposure_pct.toFixed(2)}% |`,
            ),
        ].join("\n"),
        "utf8",
    );

    console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
