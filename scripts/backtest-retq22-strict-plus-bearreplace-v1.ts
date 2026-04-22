import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";

import type { TradePairRow } from "../lib/backtest/types";

const BASE_EQUITY = 10_000;
const REPORT_DIR = path.join(process.cwd(), "reports", "retq22-strict-plus-bearreplace-v1");
const TEST_YEARS = [2022, 2023, 2024, 2025] as const;

type ReplayTradeRow = {
    trade_id: string;
    entry_time: string;
    exit_time: string;
    year: number;
    symbol: string;
    year_type: number;
    ret_used: number;
    ret_applied: number;
    skipped: boolean;
    skip_reason: string;
    source_strategy_type: string;
    source_sub_variant: string;
    source_entry_reason: string;
    source_exit_reason: string;
    equity_after: number;
};

type PeriodReturnRow = {
    period: string;
    start_equity: number;
    end_equity: number;
    return_pct: number;
};

function toCsvValue(value: string | number | boolean) {
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
    if (typeof value === "boolean") return value ? "true" : "false";
    const normalized = String(value ?? "");
    if (/[",\n]/.test(normalized)) {
        return `"${normalized.replace(/"/g, "\"\"")}"`;
    }
    return normalized;
}

function toCsv<T extends Record<string, unknown>>(rows: T[]) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const lines = [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => toCsvValue(row[header] as string | number | boolean)).join(",")),
    ];
    return `${lines.join("\n")}\n`;
}

function calcMaxDrawdownPct(points: { equity: number }[]) {
    let peak = points[0]?.equity ?? BASE_EQUITY;
    let worst = 0;
    for (const point of points) {
        if (point.equity > peak) peak = point.equity;
        if (peak <= 0) continue;
        const dd = ((point.equity / peak) - 1) * 100;
        worst = Math.min(worst, dd);
    }
    return worst;
}

function calcCagrPct(startEquity: number, endEquity: number, startTs: number, endTs: number) {
    const periodDays = Math.max(1, (endTs - startTs) / (24 * 60 * 60 * 1000));
    return (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
}

function buildAnnualReturns(rows: ReplayTradeRow[]) {
    let runningEquity = BASE_EQUITY;
    const annualReturns: PeriodReturnRow[] = [];
    for (const year of TEST_YEARS) {
        const yearRows = rows.filter((row) => Number(row.exit_time.slice(0, 4)) === year);
        const startEquity = runningEquity;
        for (const row of yearRows) {
            runningEquity = row.equity_after;
        }
        annualReturns.push({
            period: String(year),
            start_equity: startEquity,
            end_equity: runningEquity,
            return_pct: startEquity > 0 ? ((runningEquity / startEquity) - 1) * 100 : 0,
        });
    }
    return annualReturns;
}

function buildMonthlyReturns(rows: ReplayTradeRow[]) {
    let runningEquity = BASE_EQUITY;
    const monthlyReturns: PeriodReturnRow[] = [];
    for (const year of TEST_YEARS) {
        for (let month = 1; month <= 12; month += 1) {
            const period = `${year}-${String(month).padStart(2, "0")}`;
            const monthRows = rows.filter((row) => row.exit_time.slice(0, 7) === period);
            const startEquity = runningEquity;
            for (const row of monthRows) {
                runningEquity = row.equity_after;
            }
            monthlyReturns.push({
                period,
                start_equity: startEquity,
                end_equity: runningEquity,
                return_pct: startEquity > 0 ? ((runningEquity / startEquity) - 1) * 100 : 0,
            });
        }
    }
    return monthlyReturns;
}

function deriveRetUsed(trade: TradePairRow) {
    const notional = Math.max(1e-9, trade.entry_price * trade.qty);
    return trade.net_pnl / notional;
}

function deriveYearTypeProxy(trade: TradePairRow) {
    return Number(trade.entry_time.slice(0, 4));
}

function replayOverlay(trades: TradePairRow[]) {
    const sortedTrades = [...trades]
        .filter((trade) => trade.strategy_type === "trend")
        .sort((left, right) => left.entry_time.localeCompare(right.entry_time));

    let equity = BASE_EQUITY;
    let cooldownForNextTrade = false;
    const replayRows: ReplayTradeRow[] = [];

    for (const trade of sortedTrades) {
        const year = Number(trade.entry_time.slice(0, 4));
        const yearType = deriveYearTypeProxy(trade);
        const retUsed = deriveRetUsed(trade);
        const skipReasons: string[] = [];

        if (year >= 2022) {
            if (yearType === 2022) {
                skipReasons.push("year_type_2022");
            }
            if (trade.symbol === "SOL" && yearType === 2024) {
                skipReasons.push("sol_year_type_2024");
            }
            if (cooldownForNextTrade) {
                skipReasons.push("cooldown_next_trade");
                cooldownForNextTrade = false;
            }
        }

        const skipped = skipReasons.length > 0;
        const retApplied = skipped ? 0 : retUsed;
        equity *= (1 + retApplied);

        if (year >= 2022 && !skipped && yearType === 2022 && retApplied < 0) {
            cooldownForNextTrade = true;
        }

        replayRows.push({
            trade_id: trade.trade_id,
            entry_time: trade.entry_time,
            exit_time: trade.exit_time,
            year,
            symbol: trade.symbol,
            year_type: yearType,
            ret_used: retUsed,
            ret_applied: retApplied,
            skipped,
            skip_reason: skipReasons.join("|"),
            source_strategy_type: trade.strategy_type,
            source_sub_variant: trade.sub_variant,
            source_entry_reason: trade.entry_reason,
            source_exit_reason: trade.exit_reason,
            equity_after: equity,
        });
    }

    return replayRows;
}

async function main() {
    const require = createRequire(import.meta.url);
    const engine = require("../lib/backtest/hybrid-engine.ts");
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const source = await engine.runHybridBacktest("RETQ22", {
        activeYears: [2022, 2023, 2024, 2025],
        label: "off22_strong_proxy_source",
    });
    const sourceTrendTrades = source.trade_pairs.filter((trade: TradePairRow) => trade.strategy_type === "trend");
    const replayRows = replayOverlay(sourceTrendTrades);

    const annualReturns = buildAnnualReturns(replayRows);
    const monthlyReturns = buildMonthlyReturns(replayRows);
    const endEquity = replayRows.at(-1)?.equity_after ?? BASE_EQUITY;
    const equityPoints = [{ equity: BASE_EQUITY }, ...replayRows.map((row) => ({ equity: row.equity_after }))];
    const maxDrawdownPct = calcMaxDrawdownPct(equityPoints);
    const startTs = Date.UTC(2022, 0, 1);
    const endTs = Date.UTC(2025, 11, 31, 23, 59, 59, 999);
    const cagrPct = calcCagrPct(BASE_EQUITY, endEquity, startTs, endTs);
    const executedTrades = replayRows.filter((row) => !row.skipped);
    const skippedTrades = replayRows.filter((row) => row.skipped);
    const wins = executedTrades.filter((row) => row.ret_applied > 0).length;
    const grossWins = executedTrades.filter((row) => row.ret_applied > 0).reduce((sum, row) => sum + row.ret_applied, 0);
    const grossLosses = Math.abs(executedTrades.filter((row) => row.ret_applied <= 0).reduce((sum, row) => sum + row.ret_applied, 0));

    const summary = {
        strategy: "RETQ22_STRICT_PLUS_BEARREPLACE_V1",
        source_label: source.label,
        source_trade_count_total: source.trade_pairs.length,
        source_trade_count_trend_only: sourceTrendTrades.length,
        note: "Repository has no year_type column, so this run uses calendar-year proxy labels. Source trades are RETQ22 trend trades regenerated over 2022-2025.",
        start_equity: BASE_EQUITY,
        end_equity: endEquity,
        cagr_pct: cagrPct,
        max_drawdown_pct: maxDrawdownPct,
        win_rate_pct: executedTrades.length ? (wins / executedTrades.length) * 100 : 0,
        profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
        trade_count_total: replayRows.length,
        trade_count_executed: executedTrades.length,
        skipped_trades: skippedTrades.length,
        annual_returns: annualReturns,
    };

    const comparisonMd = [
        "# RETQ22_STRICT_PLUS_BEARREPLACE_V1",
        "",
        `- Source label: \`${source.label}\``,
        `- Source total trades: **${source.trade_pairs.length}**`,
        `- Source trend-only trades used for replay: **${sourceTrendTrades.length}**`,
        `- Executed trades: **${executedTrades.length}**`,
        `- Skipped trades: **${skippedTrades.length}**`,
        `- End Equity: **${endEquity.toFixed(2)}**`,
        `- CAGR: **${cagrPct.toFixed(2)}%**`,
        `- MaxDD: **${maxDrawdownPct.toFixed(2)}%**`,
        "",
        "## Annual Returns",
        "",
        "| Year | Return | Start | End |",
        "| --- | ---: | ---: | ---: |",
        ...annualReturns.map((row) => `| ${row.period} | ${row.return_pct.toFixed(2)}% | ${row.start_equity.toFixed(2)} | ${row.end_equity.toFixed(2)} |`),
        "",
        "## Notes",
        "",
        "- This is a proxy replay because the repository does not contain an OFF22_STRONG trade log with `year_type` and `ret_used` columns.",
        "- `year_type` was replaced by a calendar-year proxy.",
        "- The source RETQ22 trend trade sequence still begins in 2023 in this repository, so 2022 remains flat unless a different source trade generator is introduced.",
    ].join("\n");

    await Promise.all([
        fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2)),
        fs.writeFile(path.join(REPORT_DIR, "comparison.md"), comparisonMd),
        fs.writeFile(path.join(REPORT_DIR, "replay_trades.csv"), toCsv(replayRows)),
        fs.writeFile(path.join(REPORT_DIR, "annual_returns.csv"), toCsv(annualReturns)),
        fs.writeFile(path.join(REPORT_DIR, "monthly_returns.csv"), toCsv(monthlyReturns)),
    ]);

    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
