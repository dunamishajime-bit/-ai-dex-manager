import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest, runHybridBacktest } from "../lib/backtest/hybrid-engine.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "bnb-candidate-screen");
const BASE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;
const CANDIDATES = ["LINK", "XRP", "ADA", "TRX", "INJ", "NEAR", "UNI", "AAVE", "ATOM", "DOT", "LTC"] as const;

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });

    const rows: Array<Record<string, string | number>> = [];

    for (const symbol of CANDIDATES) {
        try {
            const result = await runExpandedUniverseBacktest({
                label: `retq22_plus_${symbol.toLowerCase()}`,
                expandedTrendSymbols: [...BASE_SYMBOLS, symbol],
            });

            rows.push({
                candidate: symbol,
                end_equity: Number(result.summary.end_equity.toFixed(2)),
                cagr_pct: Number(result.summary.cagr_pct.toFixed(2)),
                max_drawdown_pct: Number(result.summary.max_drawdown_pct.toFixed(2)),
                win_rate_pct: Number(result.summary.win_rate_pct.toFixed(2)),
                profit_factor: Number(result.summary.profit_factor.toFixed(2)),
                trade_count: result.summary.trade_count,
                delta_end_equity: Number((result.summary.end_equity - baseline.summary.end_equity).toFixed(2)),
                delta_cagr_pct: Number((result.summary.cagr_pct - baseline.summary.cagr_pct).toFixed(2)),
                delta_max_drawdown_pct: Number((result.summary.max_drawdown_pct - baseline.summary.max_drawdown_pct).toFixed(2)),
                delta_profit_factor: Number((result.summary.profit_factor - baseline.summary.profit_factor).toFixed(2)),
            });
        } catch (error) {
            rows.push({
                candidate: symbol,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    rows.sort((left, right) => {
        const leftDelta = typeof left.delta_end_equity === "number" ? left.delta_end_equity : -Infinity;
        const rightDelta = typeof right.delta_end_equity === "number" ? right.delta_end_equity : -Infinity;
        return rightDelta - leftDelta;
    });

    const md = [
        "# BNB Chain Candidate Screen",
        "",
        "## Baseline",
        "",
        `- end_equity: ${baseline.summary.end_equity.toFixed(2)}`,
        `- cagr_pct: ${baseline.summary.cagr_pct.toFixed(2)}%`,
        `- max_drawdown_pct: ${baseline.summary.max_drawdown_pct.toFixed(2)}%`,
        `- profit_factor: ${baseline.summary.profit_factor.toFixed(2)}`,
        `- trade_count: ${baseline.summary.trade_count}`,
        "",
        "## Candidate results",
        "",
        "| candidate | end_equity | CAGR % | MaxDD % | PF | trades | delta_end_equity |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows.map((row) => {
            if (row.error) {
                return `| ${row.candidate} | error | - | - | - | - | - |`;
            }
            return `| ${row.candidate} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.trade_count} | ${row.delta_end_equity} |`;
        }),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "screen.json"), JSON.stringify({
        baseline: baseline.summary,
        results: rows,
    }, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "screen.md"), md, "utf8");

    console.log(JSON.stringify({
        baseline: baseline.summary,
        results: rows,
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
