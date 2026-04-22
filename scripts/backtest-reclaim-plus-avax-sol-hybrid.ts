import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "reclaim-plus-avax-sol-hybrid");

const BASE_RECLAIM: HybridVariantOptions = {
    useThreeWayRegime: true,
    rangeEntryMode: "reclaim",
    rangeSymbols: ["ETH"],
    trendWeakExitBestMom20Below: 0.05,
    trendWeakExitBtcAdxBelow: 18,
    trendMinEfficiencyRatio: 0.22,
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
};

const AVAX_SOL_AUX: HybridVariantOptions = {
    auxRangeSymbols: ["AVAX", "SOL"],
    auxRangeEntryMode: "atr_snapback",
    auxRangeActiveYears: [2024, 2025],
    auxRangeIgnoreRegimeGate: true,
    auxRangeEntryBestMom20Below: 0.04,
    auxRangeEntryBtcAdxBelow: 32,
    auxRangeOverheatMax: 0.02,
    auxRangeExitMom20Above: 0.008,
    auxRangeMaxHoldBars: 4,
};

const VARIANTS: { label: string; options: HybridVariantOptions }[] = [
    {
        label: "eth_range_box_reclaim_regime_v1_baseline",
        options: {
            ...BASE_RECLAIM,
        },
    },
    {
        label: "reclaim_plus_avax_sol_aux_alloc035",
        options: {
            ...BASE_RECLAIM,
            ...AVAX_SOL_AUX,
            auxRangeAlloc: 0.35,
        },
    },
    {
        label: "reclaim_plus_avax_sol_aux_alloc025",
        options: {
            ...BASE_RECLAIM,
            ...AVAX_SOL_AUX,
            auxRangeAlloc: 0.25,
        },
    },
    {
        label: "reclaim_plus_avax_sol_aux_alloc035_hold3",
        options: {
            ...BASE_RECLAIM,
            ...AVAX_SOL_AUX,
            auxRangeAlloc: 0.35,
            auxRangeMaxHoldBars: 3,
            auxRangeExitMom20Above: 0.006,
        },
    },
    {
        label: "reclaim_plus_avax_sol_aux_alloc040_relaxed",
        options: {
            ...BASE_RECLAIM,
            ...AVAX_SOL_AUX,
            auxRangeAlloc: 0.4,
            auxRangeOverheatMax: 0.03,
            auxRangeEntryBestMom20Below: 0.06,
            auxRangeEntryBtcAdxBelow: 35,
        },
    },
    {
        label: "reclaim_plus_avax_sol_aux_alloc040_early_entry",
        options: {
            ...BASE_RECLAIM,
            ...AVAX_SOL_AUX,
            auxRangeAlloc: 0.4,
            rangeEntryBestMom20Below: 0.006,
            rangeEntryBtcAdxBelow: 24,
            rangeOverheatMax: -0.002,
            auxRangeOverheatMax: 0.035,
            auxRangeEntryBestMom20Below: 0.08,
            auxRangeEntryBtcAdxBelow: 38,
            auxRangeExitMom20Above: 0.007,
            auxRangeMaxHoldBars: 4,
        },
    },
    {
        label: "reclaim_plus_avax_sol_aux_alloc040_very_early_entry",
        options: {
            ...BASE_RECLAIM,
            ...AVAX_SOL_AUX,
            auxRangeAlloc: 0.4,
            rangeEntryBestMom20Below: 0.012,
            rangeEntryBtcAdxBelow: 26,
            rangeOverheatMax: 0.004,
            auxRangeOverheatMax: 0.04,
            auxRangeEntryBestMom20Below: 0.1,
            auxRangeEntryBtcAdxBelow: 40,
            auxRangeExitMom20Above: 0.006,
            auxRangeMaxHoldBars: 5,
        },
    },
    {
        label: "reclaim_plus_avax_sol_aux_alloc040_extreme_early_entry",
        options: {
            ...BASE_RECLAIM,
            ...AVAX_SOL_AUX,
            auxRangeAlloc: 0.4,
            rangeEntryBestMom20Below: 0.03,
            rangeEntryBtcAdxBelow: 30,
            rangeOverheatMax: 0.01,
            auxRangeOverheatMax: 0.055,
            auxRangeEntryBestMom20Below: 0.14,
            auxRangeEntryBtcAdxBelow: 45,
            auxRangeExitMom20Above: 0.005,
            auxRangeMaxHoldBars: 6,
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
        results.push({
            label: variant.label,
            summary: result.summary,
        });
    }

    results.sort((a, b) => b.summary.end_equity - a.summary.end_equity);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(results, null, 2), "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.md"),
        [
            "# Reclaim + AVAX SOL Hybrid Comparison",
            "",
            "| Strategy | End Equity | CAGR | MaxDD | PF | Trades | 2023 | 2024 | 2025 |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            ...results.map(({ label, summary }) => {
                const annual = Object.fromEntries(summary.annual_returns.map((row) => [row.period, row.return_pct]));
                return `| ${label} | ${summary.end_equity.toFixed(2)} | ${summary.cagr_pct.toFixed(2)}% | ${summary.max_drawdown_pct.toFixed(2)}% | ${summary.profit_factor.toFixed(3)} | ${summary.trade_count} | ${(annual["2023"] ?? 0).toFixed(2)}% | ${(annual["2024"] ?? 0).toFixed(2)}% | ${(annual["2025"] ?? 0).toFixed(2)}% |`;
            }),
        ].join("\n"),
        "utf8",
    );

    console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
