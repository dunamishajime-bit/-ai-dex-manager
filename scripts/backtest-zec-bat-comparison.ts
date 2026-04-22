import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest, runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "zec-bat-comparison");
const BASE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;

const ZEC_OUTLIER_BLOCK: NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]> = {
    ZEC: [
        {
            startTs: Date.parse("2025-09-22T12:00:00.000Z"),
            endTs: Date.parse("2025-10-03T00:00:00.000Z"),
        },
    ],
};

const VARIANTS: Array<{
    key: string;
    title: string;
    symbols: readonly string[];
    options?: HybridVariantOptions;
}> = [
    {
        key: "zec",
        title: "ZEC only",
        symbols: [...BASE_SYMBOLS, "ZEC"],
    },
    {
        key: "bat",
        title: "BAT only",
        symbols: [...BASE_SYMBOLS, "BAT"],
    },
    {
        key: "zec-bat",
        title: "ZEC + BAT",
        symbols: [...BASE_SYMBOLS, "ZEC", "BAT"],
    },
    {
        key: "zec-blocked",
        title: "ZEC only, max-profit window blocked",
        symbols: [...BASE_SYMBOLS, "ZEC"],
        options: {
            trendSymbolBlockWindows: ZEC_OUTLIER_BLOCK,
        },
    },
    {
        key: "zec-bat-blocked",
        title: "ZEC + BAT, ZEC max-profit window blocked",
        symbols: [...BASE_SYMBOLS, "ZEC", "BAT"],
        options: {
            trendSymbolBlockWindows: ZEC_OUTLIER_BLOCK,
        },
    },
];

function delta(value: number, base: number) {
    return value - base;
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });
    const baselineFiles = await writeBacktestArtifacts(baseline, path.join(REPORT_DIR, "baseline"));

    const results = [];
    for (const variant of VARIANTS) {
        const result = await runExpandedUniverseBacktest({
            label: `retq22_plus_${variant.key}`,
            expandedTrendSymbols: variant.symbols,
            ...variant.options,
        });
        const files = await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
        results.push({
            key: variant.key,
            title: variant.title,
            summary: result.summary,
            files,
        });
    }

    const md = [
        "# ZEC / BAT Comparison Backtest",
        "",
        "## Baseline",
        "",
        formatResultSummary(baseline),
        "",
        "## ZEC outlier block",
        "",
        "- ZEC: 2025-09-22T12:00:00.000Z -> 2025-10-03T00:00:00.000Z",
        "",
        "## Comparison",
        "",
        "| variant | end_equity | CAGR % | MaxDD % | WinRate % | PF | trades | delta equity | delta CAGR | delta MaxDD | contribution |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ...results.map((item) =>
            `| ${item.title} | ${item.summary.end_equity.toFixed(2)} | ${item.summary.cagr_pct.toFixed(2)} | ${item.summary.max_drawdown_pct.toFixed(2)} | ${item.summary.win_rate_pct.toFixed(2)} | ${item.summary.profit_factor.toFixed(2)} | ${item.summary.trade_count} | ${delta(item.summary.end_equity, baseline.summary.end_equity).toFixed(2)} | ${delta(item.summary.cagr_pct, baseline.summary.cagr_pct).toFixed(2)} | ${delta(item.summary.max_drawdown_pct, baseline.summary.max_drawdown_pct).toFixed(2)} | ${JSON.stringify(item.summary.symbol_contribution)} |`,
        ),
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
