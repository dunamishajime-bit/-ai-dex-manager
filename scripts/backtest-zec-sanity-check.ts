import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest, runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "zec-sanity-check");
const BASE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;
const ZEC_OUTLIER_BLOCK: NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]> = {
    ZEC: [
        {
            startTs: Date.parse("2025-09-22T12:00:00.000Z"),
            endTs: Date.parse("2025-10-03T00:00:00.000Z"),
        },
    ],
};
const ZEC_ACTUAL_TOP_TRADE_BLOCK: NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]> = {
    ZEC: [
        {
            startTs: Date.parse("2025-10-03T00:00:00.000Z"),
            endTs: Date.parse("2025-10-11T00:00:00.000Z"),
        },
    ],
};
const ZEC_SEP_OCT_SURGE_BLOCK: NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]> = {
    ZEC: [
        {
            startTs: Date.parse("2025-09-22T00:00:00.000Z"),
            endTs: Date.parse("2025-10-14T12:00:00.000Z"),
        },
    ],
};

function delta(value: number, base: number) {
    return value - base;
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const currentRetq22 = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });
    await writeBacktestArtifacts(currentRetq22, path.join(REPORT_DIR, "current-retq22"));

    const expandedBase = await runExpandedUniverseBacktest({
        label: "expanded_base_eth_sol_avax",
        expandedTrendSymbols: BASE_SYMBOLS,
    });
    await writeBacktestArtifacts(expandedBase, path.join(REPORT_DIR, "expanded-base"));

    const zec = await runExpandedUniverseBacktest({
        label: "expanded_plus_zec",
        expandedTrendSymbols: [...BASE_SYMBOLS, "ZEC"],
    });
    await writeBacktestArtifacts(zec, path.join(REPORT_DIR, "zec"));

    const zecBlocked = await runExpandedUniverseBacktest({
        label: "expanded_plus_zec_outlier_blocked",
        expandedTrendSymbols: [...BASE_SYMBOLS, "ZEC"],
        trendSymbolBlockWindows: ZEC_OUTLIER_BLOCK,
    });
    await writeBacktestArtifacts(zecBlocked, path.join(REPORT_DIR, "zec-blocked"));

    const zecActualTopBlocked = await runExpandedUniverseBacktest({
        label: "expanded_plus_zec_actual_top_trade_blocked",
        expandedTrendSymbols: [...BASE_SYMBOLS, "ZEC"],
        trendSymbolBlockWindows: ZEC_ACTUAL_TOP_TRADE_BLOCK,
    });
    await writeBacktestArtifacts(zecActualTopBlocked, path.join(REPORT_DIR, "zec-actual-top-blocked"));

    const zecSepOctSurgeBlocked = await runExpandedUniverseBacktest({
        label: "expanded_plus_zec_sep_oct_surge_blocked",
        expandedTrendSymbols: [...BASE_SYMBOLS, "ZEC"],
        trendSymbolBlockWindows: ZEC_SEP_OCT_SURGE_BLOCK,
    });
    await writeBacktestArtifacts(zecSepOctSurgeBlocked, path.join(REPORT_DIR, "zec-sep-oct-surge-blocked"));

    const rows = [
        { key: "current-retq22", title: "Current RETQ22 engine", result: currentRetq22 },
        { key: "expanded-base", title: "Expanded engine, ETH/SOL/AVAX only", result: expandedBase },
        { key: "zec", title: "Expanded engine + ZEC", result: zec },
        { key: "zec-blocked", title: "Expanded engine + ZEC, max-profit window blocked", result: zecBlocked },
        { key: "zec-actual-top-blocked", title: "Expanded engine + ZEC, actual top ZEC trade blocked", result: zecActualTopBlocked },
        { key: "zec-sep-oct-surge-blocked", title: "Expanded engine + ZEC, full Sep-Oct ZEC surge blocked", result: zecSepOctSurgeBlocked },
    ];

    const md = [
        "# ZEC Sanity Check",
        "",
        "## Summaries",
        "",
        ...rows.flatMap((row) => [`### ${row.title}`, "", formatResultSummary(row.result), ""]),
        "## Comparison vs expanded-base",
        "",
        "| variant | end_equity | CAGR % | MaxDD % | PF | trades | delta equity | delta CAGR | delta MaxDD | contribution |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ...rows.slice(1).map((row) =>
            `| ${row.title} | ${row.result.summary.end_equity.toFixed(2)} | ${row.result.summary.cagr_pct.toFixed(2)} | ${row.result.summary.max_drawdown_pct.toFixed(2)} | ${row.result.summary.profit_factor.toFixed(2)} | ${row.result.summary.trade_count} | ${delta(row.result.summary.end_equity, expandedBase.summary.end_equity).toFixed(2)} | ${delta(row.result.summary.cagr_pct, expandedBase.summary.cagr_pct).toFixed(2)} | ${delta(row.result.summary.max_drawdown_pct, expandedBase.summary.max_drawdown_pct).toFixed(2)} | ${JSON.stringify(row.result.summary.symbol_contribution)} |`,
        ),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), md, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(Object.fromEntries(rows.map((row) => [row.key, row.result.summary])), null, 2),
        "utf8",
    );

    console.log(JSON.stringify(Object.fromEntries(rows.map((row) => [row.key, row.result.summary])), null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
