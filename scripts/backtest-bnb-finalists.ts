import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest, runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { writeBacktestArtifacts, formatResultSummary } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "bnb-finalists");
const BASE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;

const VARIANTS: Array<{ key: string; symbols: readonly string[] }> = [
    { key: "trx", symbols: [...BASE_SYMBOLS, "TRX"] },
];

async function main() {
    const current = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const currentFiles = await writeBacktestArtifacts(current, path.join(REPORT_DIR, "current-retq22"));

    const results: Array<{
        key: string;
        summary: typeof current.summary;
        files: Awaited<ReturnType<typeof writeBacktestArtifacts>>;
    }> = [];

    for (const variant of VARIANTS) {
        const options: HybridVariantOptions = {
            label: `retq22_${variant.key}`,
            expandedTrendSymbols: variant.symbols,
        };
        const result = await runExpandedUniverseBacktest(options);
        const files = await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
        results.push({
            key: variant.key,
            summary: result.summary,
            files,
        });
    }

    const comparisonMd = [
        "# BNB Finalists Compare",
        "",
        "## Current RETQ22",
        "",
        formatResultSummary(current),
        "",
        "## Variants",
        "",
        "| variant | end_equity | CAGR % | MaxDD % | WinRate % | PF | trades | delta_end_equity |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...results.map((item) =>
            `| ${item.key} | ${item.summary.end_equity.toFixed(2)} | ${item.summary.cagr_pct.toFixed(2)} | ${item.summary.max_drawdown_pct.toFixed(2)} | ${item.summary.win_rate_pct.toFixed(2)} | ${item.summary.profit_factor.toFixed(2)} | ${item.summary.trade_count} | ${(item.summary.end_equity - current.summary.end_equity).toFixed(2)} |`,
        ),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                current: current.summary,
                currentFiles,
                variants: results,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log(
        JSON.stringify(
            {
                current: current.summary,
                variants: results.map((item) => ({
                    key: item.key,
                    summary: item.summary,
                })),
            },
            null,
            2,
        ),
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
