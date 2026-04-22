import path from "path";
import fs from "node:fs/promises";

import { runHybridBacktest, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "@/lib/backtest/reporting";
import type { BacktestResult, TradePairRow } from "@/lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "range-diff-v2b");

const baselineOptions: HybridVariantOptions = {
    label: "baseline_weak_guard_exact",
    trendWeakExitBestMom20Below: 0.05,
    trendWeakExitBtcAdxBelow: 18,
};

const variantOptions: HybridVariantOptions = {
    label: "eth_range_box_rebound_regime_v2e_earlier_entry",
    useThreeWayRegime: true,
    rangeEntryMode: "box_rebound",
    rangeSymbols: ["ETH"],
    trendWeakExitBestMom20Below: 0.05,
    trendWeakExitBtcAdxBelow: 18,
    rangeRegimeBtcDistMin: -0.024,
    rangeRegimeBtcDistMax: 0.016,
    rangeRegimeBtcAdxMax: 20,
    rangeRegimeBreadth40Max: 2,
    rangeRegimeBestMom20Min: -0.03,
    rangeRegimeBestMom20Max: 0.03,
    rangeEntryBestMom20Below: -0.006,
    rangeEntryBtcAdxBelow: 19,
    rangeOverheatMax: -0.011,
    rangeExitMom20Above: 0.009,
    rangeMaxHoldBars: 3,
};

function pairKey(pair: TradePairRow) {
    return [
        pair.strategy_type,
        pair.sub_variant,
        pair.symbol,
        pair.entry_time,
        pair.exit_time,
        pair.entry_price.toFixed(8),
        pair.exit_price.toFixed(8),
        pair.qty.toFixed(8),
    ].join("|");
}

function tradeYear(pair: TradePairRow) {
    return pair.entry_time.slice(0, 4);
}

function toPct(value: number) {
    return `${value.toFixed(2)}%`;
}

function monthlyMap(result: BacktestResult) {
    return new Map(result.monthly_returns.map((row) => [row.period, row]));
}

function summarizePairs(pairs: TradePairRow[]) {
    const years = new Map<string, { count: number; pnl: number }>();
    for (const pair of pairs) {
        const year = tradeYear(pair);
        const current = years.get(year) || { count: 0, pnl: 0 };
        current.count += 1;
        current.pnl += pair.net_pnl;
        years.set(year, current);
    }
    return years;
}

function renderMonthlyDiff(base: BacktestResult, variant: BacktestResult) {
    const baseMonthly = monthlyMap(base);
    const variantMonthly = monthlyMap(variant);
    const periods = Array.from(new Set([...baseMonthly.keys(), ...variantMonthly.keys()])).sort();

    const lines = [
        "| Month | Base | Variant | Delta |",
        "| --- | ---: | ---: | ---: |",
    ];

    for (const period of periods) {
        const b = baseMonthly.get(period);
        const v = variantMonthly.get(period);
        lines.push(
            `| ${period} | ${b ? toPct(b.return_pct) : "n/a"} | ${v ? toPct(v.return_pct) : "n/a"} | ${b && v ? toPct(v.return_pct - b.return_pct) : "n/a"} |`,
        );
    }
    return lines.join("\n");
}

function renderTradeComparison(base: BacktestResult, variant: BacktestResult) {
    const baseMap = new Map(base.trade_pairs.map((pair) => [pairKey(pair), pair]));
    const variantMap = new Map(variant.trade_pairs.map((pair) => [pairKey(pair), pair]));
    const allKeys = Array.from(new Set([...baseMap.keys(), ...variantMap.keys()])).sort();

    const rows = allKeys.map((key) => {
        const b = baseMap.get(key);
        const v = variantMap.get(key);
        const status = b && v ? "matched" : b ? "baseline_only" : "variant_only";
        return {
            status,
            symbol: b?.symbol || v?.symbol || "",
            entry_time: b?.entry_time || v?.entry_time || "",
            exit_time: b?.exit_time || v?.exit_time || "",
            baseline_net_pnl: b?.net_pnl ?? "",
            variant_net_pnl: v?.net_pnl ?? "",
            delta_net_pnl: b && v ? v.net_pnl - b.net_pnl : "",
            baseline_holding_bars: b?.holding_bars ?? "",
            variant_holding_bars: v?.holding_bars ?? "",
            baseline_reason: b?.entry_reason || "",
            variant_reason: v?.entry_reason || "",
        };
    });

    const headers = Object.keys(rows[0] || {
        status: "",
        symbol: "",
        entry_time: "",
        exit_time: "",
        baseline_net_pnl: "",
        variant_net_pnl: "",
        delta_net_pnl: "",
        baseline_holding_bars: "",
        variant_holding_bars: "",
        baseline_reason: "",
        variant_reason: "",
    });

    return {
        rows,
        csv: [
            headers.join(","),
            ...rows.map((row) => headers.map((header) => JSON.stringify(row[header as keyof typeof row] ?? "")).join(",")),
        ].join("\n"),
    };
}

function renderTradeSummary(base: BacktestResult, variant: BacktestResult) {
    const baseByYear = summarizePairs(base.trade_pairs);
    const variantByYear = summarizePairs(variant.trade_pairs);
    const years = Array.from(new Set([...baseByYear.keys(), ...variantByYear.keys()])).sort();

    const lines = [
        "| Year | Base Count | Variant Count | Base PnL | Variant PnL | Delta PnL |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ];

    for (const year of years) {
        const b = baseByYear.get(year) || { count: 0, pnl: 0 };
        const v = variantByYear.get(year) || { count: 0, pnl: 0 };
        lines.push(
            `| ${year} | ${b.count} | ${v.count} | ${b.pnl.toFixed(2)} | ${v.pnl.toFixed(2)} | ${(v.pnl - b.pnl).toFixed(2)} |`,
        );
    }
    return lines.join("\n");
}

function tradeRowsInYear(result: BacktestResult, year: string) {
    return result.trade_pairs.filter((pair) => tradeYear(pair) === year);
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runHybridBacktest("BASELINE", baselineOptions);
    const variant = await runHybridBacktest("RETQ22", variantOptions);

    const baselineDir = path.join(REPORT_DIR, "baseline");
    const variantDir = path.join(REPORT_DIR, "variant");
    const baselineArtifacts = await writeBacktestArtifacts(baseline, baselineDir);
    const variantArtifacts = await writeBacktestArtifacts(variant, variantDir);

    const tradeComparison = renderTradeComparison(baseline, variant);

    const baseline2023 = tradeRowsInYear(baseline, "2023");
    const variant2023 = tradeRowsInYear(variant, "2023");
    const baseline2024 = tradeRowsInYear(baseline, "2024");
    const variant2024 = tradeRowsInYear(variant, "2024");
    const baseline2025 = tradeRowsInYear(baseline, "2025");
    const variant2025 = tradeRowsInYear(variant, "2025");

    const matched2023 = baseline2023.filter((pair) =>
        variant2023.some((other) => pairKey(other) === pairKey(pair)),
    );

    const report = [
        "# v2b Early Entry Diff",
        "",
        "## Summary",
        `- Baseline: ${baseline.label} = ${baseline.summary.end_equity.toFixed(2)}`,
        `- Variant: ${variant.label} = ${variant.summary.end_equity.toFixed(2)}`,
        `- Delta: ${(variant.summary.end_equity - baseline.summary.end_equity).toFixed(2)}`,
        `- Base Trades: ${baseline.summary.trade_count}`,
        `- Variant Trades: ${variant.summary.trade_count}`,
        "",
        "## Monthly Returns",
        renderMonthlyDiff(baseline, variant),
        "",
        "## Trade Summary By Year",
        renderTradeSummary(baseline, variant),
        "",
        "## 2023 Sanity Check",
        `- Baseline 2023 trades: ${baseline2023.length}`,
        `- Variant 2023 trades: ${variant2023.length}`,
        `- Matched 2023 trades: ${matched2023.length}`,
        `- Baseline 2024 trades: ${baseline2024.length}`,
        `- Variant 2024 trades: ${variant2024.length}`,
        `- Baseline 2025 trades: ${baseline2025.length}`,
        `- Variant 2025 trades: ${variant2025.length}`,
        "",
        "## Matched Trade Diff",
        tradeComparison.csv,
        "",
        "## Artifacts",
        `- Baseline artifacts: ${JSON.stringify(baselineArtifacts, null, 2)}`,
        `- Variant artifacts: ${JSON.stringify(variantArtifacts, null, 2)}`,
        "",
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), report, "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "comparison.json"), JSON.stringify({
        baseline: baseline.summary,
        variant: variant.summary,
        trade_summary: {
            base_2023: baseline2023.length,
            variant_2023: variant2023.length,
            matched_2023: matched2023.length,
            base_2024: baseline2024.length,
            variant_2024: variant2024.length,
            base_2025: baseline2025.length,
            variant_2025: variant2025.length,
        },
        monthly_diff: Array.from(new Set([
            ...baseline.monthly_returns.map((row) => row.period),
            ...variant.monthly_returns.map((row) => row.period),
        ])).sort().map((period) => {
            const baseRow = baseline.monthly_returns.find((row) => row.period === period);
            const variantRow = variant.monthly_returns.find((row) => row.period === period);
            return {
                period,
                baseline: baseRow?.return_pct ?? null,
                variant: variantRow?.return_pct ?? null,
                delta: baseRow && variantRow ? variantRow.return_pct - baseRow.return_pct : null,
            };
        }),
        trade_rows_csv: path.join(REPORT_DIR, "trade_comparison.csv"),
    }, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "trade_comparison.csv"), tradeComparison.csv, "utf8");

    console.log(report);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
