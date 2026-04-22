import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import type { BacktestResult, TradePairRow } from "../lib/backtest/types.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "strict-retq22-extra-candidates");

// Candidates not previously highlighted/rejected in this discussion.
const CANDIDATES = [
    "HIFI",
    "DUSK",
    "NKN",
    "LSK",
    "BAND",
    "DENT",
    "CELR",
    "CTSI",
    "KMD",
    "MTL",
    "OXT",
    "REQ",
    "SYS",
    "STEEM",
    "VTHO",
    "WAN",
    "WAXP",
    "POWR",
    "PHA",
    "POND",
    "PROM",
    "RLC",
    "SNT",
    "SPELL",
    "TLM",
    "VIC",
    "VITE",
    "WING",
    "WRX",
    "XNO",
    "FIDA",
    "HIGH",
    "PORTO",
    "QUICK",
] as const;

type ResultRow = {
    candidate: string;
    end_equity?: number;
    cagr_pct?: number;
    max_drawdown_pct?: number;
    profit_factor?: number;
    trade_count?: number;
    delta_end_equity?: number;
    delta_cagr_pct?: number;
    delta_max_drawdown_pct?: number;
    candidate_pnl?: number;
    candidate_trades?: number;
    top_trade_pnl?: number;
    top_trade_window?: string;
    top_trade_blocked_end_equity?: number;
    top_trade_blocked_delta_vs_base?: number;
    fragile_top_trade?: boolean;
    error?: string;
};

function round(value: number) {
    return Number(value.toFixed(2));
}

function topCandidateTrade(result: BacktestResult, candidate: string) {
    return result.trade_pairs
        .filter((trade) => trade.symbol === candidate)
        .sort((left, right) => right.net_pnl - left.net_pnl)[0] ?? null;
}

function blockForTrade(candidate: string, trade: TradePairRow): NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]> {
    return {
        [candidate]: [
            {
                startTs: Date.parse(trade.entry_time),
                endTs: Date.parse(trade.exit_time),
            },
        ],
    };
}

async function runCandidate(candidate: string, baseline: BacktestResult): Promise<ResultRow> {
    const result = await runHybridBacktest("RETQ22", {
        label: `strict_retq22_plus_${candidate.toLowerCase()}`,
        strictExtraTrendSymbols: [candidate],
    });
    const topTrade = topCandidateTrade(result, candidate);
    const row: ResultRow = {
        candidate,
        end_equity: round(result.summary.end_equity),
        cagr_pct: round(result.summary.cagr_pct),
        max_drawdown_pct: round(result.summary.max_drawdown_pct),
        profit_factor: round(result.summary.profit_factor),
        trade_count: result.summary.trade_count,
        delta_end_equity: round(result.summary.end_equity - baseline.summary.end_equity),
        delta_cagr_pct: round(result.summary.cagr_pct - baseline.summary.cagr_pct),
        delta_max_drawdown_pct: round(result.summary.max_drawdown_pct - baseline.summary.max_drawdown_pct),
        candidate_pnl: round(result.summary.symbol_contribution[candidate] ?? 0),
        candidate_trades: result.trade_pairs.filter((trade) => trade.symbol === candidate).length,
        top_trade_pnl: topTrade ? round(topTrade.net_pnl) : 0,
        top_trade_window: topTrade ? `${topTrade.entry_time} -> ${topTrade.exit_time}` : "-",
    };

    if (topTrade && topTrade.net_pnl > 0) {
        const blocked = await runHybridBacktest("RETQ22", {
            label: `strict_retq22_plus_${candidate.toLowerCase()}_top_trade_blocked`,
            strictExtraTrendSymbols: [candidate],
            trendSymbolBlockWindows: blockForTrade(candidate, topTrade),
        });
        row.top_trade_blocked_end_equity = round(blocked.summary.end_equity);
        row.top_trade_blocked_delta_vs_base = round(blocked.summary.end_equity - baseline.summary.end_equity);
        row.fragile_top_trade = blocked.summary.end_equity < baseline.summary.end_equity;
    }

    return row;
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runHybridBacktest("RETQ22", {
        label: "current_retq22_same_engine_reference",
    });

    const rows: ResultRow[] = [];
    for (const candidate of CANDIDATES) {
        try {
            rows.push(await runCandidate(candidate, baseline));
        } catch (error) {
            rows.push({
                candidate,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    rows.sort((left, right) => (right.delta_end_equity ?? -Infinity) - (left.delta_end_equity ?? -Infinity));

    const md = [
        "# Strict RETQ22 Extra Candidate Screen",
        "",
        "## Baseline",
        "",
        "現行RETQ22と同じ `runHybridBacktest(\"RETQ22\")` の土台で、候補通貨だけをトレンド候補に1つ追加しています。",
        "",
        `- end_equity: ${baseline.summary.end_equity.toFixed(2)}`,
        `- CAGR: ${baseline.summary.cagr_pct.toFixed(2)}%`,
        `- MaxDD: ${baseline.summary.max_drawdown_pct.toFixed(2)}%`,
        `- PF: ${baseline.summary.profit_factor.toFixed(2)}`,
        `- trades: ${baseline.summary.trade_count}`,
        "",
        "## Results",
        "",
        "| candidate | end_equity | CAGR % | MaxDD % | PF | trades | delta equity | candidate pnl | candidate trades | top trade pnl | top trade blocked delta | fragile? |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ...rows.map((row) => {
            if (row.error) {
                return `| ${row.candidate} | error | - | - | - | - | - | - | - | - | - | ${row.error.replaceAll("|", "/")} |`;
            }
            return [
                `| ${row.candidate}`,
                row.end_equity,
                row.cagr_pct,
                row.max_drawdown_pct,
                row.profit_factor,
                row.trade_count,
                row.delta_end_equity,
                row.candidate_pnl,
                row.candidate_trades,
                row.top_trade_pnl,
                row.top_trade_blocked_delta_vs_base ?? "-",
                row.fragile_top_trade ? "yes" : "no",
                "|",
            ].join(" ");
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
