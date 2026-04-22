import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest } from "../lib/backtest/hybrid-engine.ts";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "fresh-finalists");
const BASE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;

const VARIANTS: Array<{ key: string; symbols: readonly string[] }> = [
    { key: "baseline", symbols: BASE_SYMBOLS },
    { key: "cake", symbols: [...BASE_SYMBOLS, "CAKE"] },
    { key: "twt", symbols: [...BASE_SYMBOLS, "TWT"] },
    { key: "cake-twt", symbols: [...BASE_SYMBOLS, "CAKE", "TWT"] },
];

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const results: Array<{
        key: string;
        summary: Awaited<ReturnType<typeof runExpandedUniverseBacktest>>["summary"];
        files: Awaited<ReturnType<typeof writeBacktestArtifacts>>;
    }> = [];

    for (const variant of VARIANTS) {
        const result = await runExpandedUniverseBacktest({
            label: `retq22_${variant.key}`,
            expandedTrendSymbols: variant.symbols,
        });
        const files = await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
        results.push({
            key: variant.key,
            summary: result.summary,
            files,
        });
    }

    const baseline = results.find((item) => item.key === "baseline");
    if (!baseline) throw new Error("baseline not found");

    const comparisonMd = [
        "# Fresh Finalists Compare",
        "",
        "## Baseline",
        "",
        formatResultSummary({ summary: baseline.summary } as never),
        "",
        "## Variants",
        "",
        "| variant | end_equity | CAGR % | MaxDD % | WinRate % | PF | trades | delta_end_equity |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...results.map((item) =>
            `| ${item.key} | ${item.summary.end_equity.toFixed(2)} | ${item.summary.cagr_pct.toFixed(2)} | ${item.summary.max_drawdown_pct.toFixed(2)} | ${item.summary.win_rate_pct.toFixed(2)} | ${item.summary.profit_factor.toFixed(2)} | ${item.summary.trade_count} | ${(item.summary.end_equity - baseline.summary.end_equity).toFixed(2)} |`,
        ),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd, "utf8");
    await fs.writeFile(
        path.join(REPORT_DIR, "comparison.json"),
        JSON.stringify(
            {
                baseline: baseline.summary,
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
                baseline: baseline.summary,
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
