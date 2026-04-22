import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "reclaim-avax-sol-split-hybrid");

const BASE_RECLAIM: HybridVariantOptions = {
    activeYears: [2022, 2023, 2024, 2025],
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

type Variant = {
    label: string;
    options: HybridVariantOptions;
};

const VARIANTS: Variant[] = [
    {
        label: "reclaim_plus_avax_sol_aux_alloc040_relaxed_baseline",
        options: {
            ...BASE_RECLAIM,
            auxRangeSymbols: ["AVAX", "SOL"],
            auxRangeEntryMode: "atr_snapback",
            auxRangeActiveYears: [2024, 2025],
            auxRangeIgnoreRegimeGate: true,
            auxRangeAlloc: 0.4,
            auxRangeEntryBestMom20Below: 0.06,
            auxRangeEntryBtcAdxBelow: 35,
            auxRangeOverheatMax: 0.03,
            auxRangeExitMom20Above: 0.008,
            auxRangeMaxHoldBars: 4,
        },
    },
    {
        label: "reclaim_plus_avax_fast_sol_fast_split",
        options: {
            ...BASE_RECLAIM,
            auxRangeSymbols: ["AVAX"],
            auxRangeEntryMode: "atr_snapback",
            auxRangeActiveYears: [2024, 2025],
            auxRangeIgnoreRegimeGate: true,
            auxRangeAlloc: 0.26,
            auxRangeEntryBestMom20Below: 0.06,
            auxRangeEntryBtcAdxBelow: 35,
            auxRangeOverheatMax: 0.03,
            auxRangeExitMom20Above: 0.008,
            auxRangeMaxHoldBars: 4,
            aux2RangeSymbols: ["SOL"],
            aux2RangeEntryMode: "atr_snapback",
            aux2RangeActiveYears: [2024, 2025],
            aux2RangeIgnoreRegimeGate: true,
            aux2RangeAlloc: 0.18,
            aux2RangeEntryBestMom20Below: 0.04,
            aux2RangeEntryBtcAdxBelow: 30,
            aux2RangeOverheatMax: 0.02,
            aux2RangeExitMom20Above: 0.008,
            aux2RangeMaxHoldBars: 4,
        },
    },
    {
        label: "reclaim_plus_avax_relaxed_sol_patient",
        options: {
            ...BASE_RECLAIM,
            auxRangeSymbols: ["AVAX"],
            auxRangeEntryMode: "atr_snapback",
            auxRangeActiveYears: [2024, 2025],
            auxRangeIgnoreRegimeGate: true,
            auxRangeAlloc: 0.28,
            auxRangeEntryBestMom20Below: 0.08,
            auxRangeEntryBtcAdxBelow: 36,
            auxRangeOverheatMax: 0.04,
            auxRangeExitMom20Above: 0.009,
            auxRangeMaxHoldBars: 4,
            aux2RangeSymbols: ["SOL"],
            aux2RangeEntryMode: "atr_snapback",
            aux2RangeActiveYears: [2024, 2025],
            aux2RangeIgnoreRegimeGate: true,
            aux2RangeAlloc: 0.16,
            aux2RangeEntryBestMom20Below: 0.03,
            aux2RangeEntryBtcAdxBelow: 28,
            aux2RangeOverheatMax: 0.015,
            aux2RangeExitMom20Above: 0.01,
            aux2RangeMaxHoldBars: 5,
        },
    },
    {
        label: "reclaim_plus_avax_fast_sol_quick",
        options: {
            ...BASE_RECLAIM,
            auxRangeSymbols: ["AVAX"],
            auxRangeEntryMode: "atr_snapback",
            auxRangeActiveYears: [2024, 2025],
            auxRangeIgnoreRegimeGate: true,
            auxRangeAlloc: 0.3,
            auxRangeEntryBestMom20Below: 0.06,
            auxRangeEntryBtcAdxBelow: 35,
            auxRangeOverheatMax: 0.03,
            auxRangeExitMom20Above: 0.008,
            auxRangeMaxHoldBars: 4,
            aux2RangeSymbols: ["SOL"],
            aux2RangeEntryMode: "atr_snapback",
            aux2RangeActiveYears: [2024, 2025],
            aux2RangeIgnoreRegimeGate: true,
            aux2RangeAlloc: 0.14,
            aux2RangeEntryBestMom20Below: 0.05,
            aux2RangeEntryBtcAdxBelow: 32,
            aux2RangeOverheatMax: 0.025,
            aux2RangeExitMom20Above: 0.006,
            aux2RangeMaxHoldBars: 3,
        },
    },
    {
        label: "reclaim_plus_avax_only_split_bias",
        options: {
            ...BASE_RECLAIM,
            auxRangeSymbols: ["AVAX"],
            auxRangeEntryMode: "atr_snapback",
            auxRangeActiveYears: [2024, 2025],
            auxRangeIgnoreRegimeGate: true,
            auxRangeAlloc: 0.34,
            auxRangeEntryBestMom20Below: 0.06,
            auxRangeEntryBtcAdxBelow: 35,
            auxRangeOverheatMax: 0.03,
            auxRangeExitMom20Above: 0.008,
            auxRangeMaxHoldBars: 4,
            aux2RangeSymbols: ["SOL"],
            aux2RangeEntryMode: "atr_snapback",
            aux2RangeActiveYears: [2024, 2025],
            aux2RangeIgnoreRegimeGate: true,
            aux2RangeAlloc: 0.06,
            aux2RangeEntryBestMom20Below: 0.02,
            aux2RangeEntryBtcAdxBelow: 26,
            aux2RangeOverheatMax: 0.01,
            aux2RangeExitMom20Above: 0.01,
            aux2RangeMaxHoldBars: 4,
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
            "# Reclaim + Split AVAX SOL Hybrid Comparison (2022-2025)",
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
