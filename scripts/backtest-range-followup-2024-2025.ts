import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "range-followup-2024-2025");

const BASE: HybridVariantOptions = {
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

const VARIANTS: { label: string; options: HybridVariantOptions }[] = [
    {
        label: "atr_basket_fast_baseline",
        options: {
            ...BASE,
            rangeEntryMode: "atr_snapback",
            rangeOverheatMax: 0.02,
            rangeExitMom20Above: 0.008,
            rangeMaxHoldBars: 4,
        },
    },
    {
        label: "atr_basket_faster_more_trades",
        options: {
            ...BASE,
            rangeEntryMode: "atr_snapback",
            rangeOverheatMax: 0.03,
            rangeExitMom20Above: 0.006,
            rangeMaxHoldBars: 4,
            rangeRegimeBtcAdxMax: 35,
            rangeEntryBestMom20Below: 0.06,
        },
    },
    {
        label: "atr_basket_short_hold_relaxed",
        options: {
            ...BASE,
            rangeEntryMode: "atr_snapback",
            rangeOverheatMax: 0.035,
            rangeExitMom20Above: 0.004,
            rangeMaxHoldBars: 3,
            rangeRegimeBtcAdxMax: 35,
            rangeRegimeBestMom20Max: 0.12,
            rangeEntryBestMom20Below: 0.07,
        },
    },
    {
        label: "sma_reclaim_basket_fast",
        options: {
            ...BASE,
            rangeEntryMode: "sma_reclaim_pulse",
            rangeOverheatMax: 0.02,
            rangeExitMom20Above: 0.008,
            rangeMaxHoldBars: 4,
        },
    },
    {
        label: "sma_reclaim_basket_relaxed",
        options: {
            ...BASE,
            rangeEntryMode: "sma_reclaim_pulse",
            rangeOverheatMax: 0.03,
            rangeExitMom20Above: 0.006,
            rangeMaxHoldBars: 5,
            rangeRegimeBtcAdxMax: 35,
            rangeEntryBestMom20Below: 0.06,
        },
    },
    {
        label: "sma_reclaim_eth_sol_fast",
        options: {
            ...BASE,
            rangeEntryMode: "sma_reclaim_pulse",
            rangeSymbols: ["ETH", "SOL"],
            rangeOverheatMax: 0.02,
            rangeExitMom20Above: 0.008,
            rangeMaxHoldBars: 4,
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
            "# Range Followup 2024-2025",
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
