import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import type { BacktestResult, TradePairRow } from "../lib/backtest/types.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "bnbchain-idle-candidate-search");
const SOURCE_PATH = path.join(process.cwd(), "reports", "bnbchain-unseen-candidate-source", "candidates.json");
const TARGET_END_EQUITY = 95_000;
const CORE_OR_REJECTED = new Set([
    "BTC",
    "ETH",
    "SOL",
    "AVAX",
    "USDT",
    "USDC",
    "FDUSD",
    "TUSD",
    "DAI",
    "AEUR",
    "EURI",
    "FRAX",
    "DOGE",
    "BAKE",
    "CAKE",
    "TWT",
    "TRX",
]);

type SourceCandidate = {
    symbol: string;
    id: string;
    address: string;
};

type Row = {
    candidate: string;
    coingecko_id: string;
    bnbchain_address: string;
    end_equity?: number;
    cagr_pct?: number;
    max_drawdown_pct?: number;
    delta_end_equity?: number;
    candidate_pnl?: number;
    candidate_trades?: number;
    top_trade_pnl?: number;
    top_trade_window?: string;
    blocked_end_equity?: number;
    blocked_cagr_pct?: number;
    blocked_max_drawdown_pct?: number;
    blocked_delta_end_equity?: number;
    blocked_candidate_pnl?: number;
    blocked_candidate_trades?: number;
    passes?: boolean;
    skipped_block_reason?: string;
    error?: string;
};

function round(value: number) {
    return Number(value.toFixed(2));
}

function buildIdleWindows(baseline: BacktestResult): NonNullable<HybridVariantOptions["strictExtraTrendAllowedWindows"]> {
    const events = baseline.trade_events
        .map((event) => ({ ...event, ts: Date.parse(event.time) }))
        .sort((left, right) => left.ts - right.ts);
    const windows: NonNullable<HybridVariantOptions["strictExtraTrendAllowedWindows"]> = [];
    const firstTs = baseline.equity_curve[0]?.ts;
    const lastTs = baseline.equity_curve.at(-1)?.ts;
    const firstEnter = events.find((event) => event.action === "enter");
    if (firstTs != null && firstEnter && firstTs < firstEnter.ts) {
        windows.push({ startTs: firstTs, endTs: firstEnter.ts });
    }
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (event.action !== "exit") continue;
        const nextEnter = events.slice(index + 1).find((item) => item.action === "enter");
        if (nextEnter && event.ts < nextEnter.ts) {
            windows.push({ startTs: event.ts, endTs: nextEnter.ts });
        } else if (lastTs != null && event.ts < lastTs) {
            windows.push({ startTs: event.ts, endTs: lastTs + 1 });
        }
    }
    return windows.filter((window) => window.endTs - window.startTs >= 12 * 60 * 60 * 1000);
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

async function runCandidate(
    source: SourceCandidate,
    baseline: BacktestResult,
    idleWindows: NonNullable<HybridVariantOptions["strictExtraTrendAllowedWindows"]>,
): Promise<Row> {
    const candidate = source.symbol.toUpperCase();
    const result = await runHybridBacktest("RETQ22", {
        label: `bnbchain_idle_plus_${candidate.toLowerCase()}`,
        strictExtraTrendSymbols: [candidate],
        strictExtraTrendAllowedWindows: idleWindows,
    });
    const topTrade = topCandidateTrade(result, candidate);
    const row: Row = {
        candidate,
        coingecko_id: source.id,
        bnbchain_address: source.address,
        end_equity: round(result.summary.end_equity),
        cagr_pct: round(result.summary.cagr_pct),
        max_drawdown_pct: round(result.summary.max_drawdown_pct),
        delta_end_equity: round(result.summary.end_equity - baseline.summary.end_equity),
        candidate_pnl: round(result.summary.symbol_contribution[candidate] ?? 0),
        candidate_trades: result.trade_pairs.filter((trade) => trade.symbol === candidate).length,
        top_trade_pnl: topTrade ? round(topTrade.net_pnl) : 0,
        top_trade_window: topTrade ? `${topTrade.entry_time} -> ${topTrade.exit_time}` : "-",
    };

    if ((row.end_equity ?? 0) < TARGET_END_EQUITY) {
        row.skipped_block_reason = "normal_end_equity_below_target";
        row.passes = false;
        return row;
    }

    if (topTrade && topTrade.net_pnl > 0) {
        const blocked = await runHybridBacktest("RETQ22", {
            label: `bnbchain_idle_plus_${candidate.toLowerCase()}_top_trade_removed`,
            strictExtraTrendSymbols: [candidate],
            strictExtraTrendAllowedWindows: idleWindows,
            trendSymbolBlockWindows: blockForTrade(candidate, topTrade),
        });
        row.blocked_end_equity = round(blocked.summary.end_equity);
        row.blocked_cagr_pct = round(blocked.summary.cagr_pct);
        row.blocked_max_drawdown_pct = round(blocked.summary.max_drawdown_pct);
        row.blocked_delta_end_equity = round(blocked.summary.end_equity - baseline.summary.end_equity);
        row.blocked_candidate_pnl = round(blocked.summary.symbol_contribution[candidate] ?? 0);
        row.blocked_candidate_trades = blocked.trade_pairs.filter((trade) => trade.symbol === candidate).length;
        row.passes = blocked.summary.end_equity >= TARGET_END_EQUITY;
    } else {
        row.blocked_end_equity = row.end_equity;
        row.blocked_cagr_pct = row.cagr_pct;
        row.blocked_max_drawdown_pct = row.max_drawdown_pct;
        row.blocked_delta_end_equity = row.delta_end_equity;
        row.blocked_candidate_pnl = row.candidate_pnl;
        row.blocked_candidate_trades = row.candidate_trades;
        row.passes = (row.blocked_end_equity ?? 0) >= TARGET_END_EQUITY;
    }

    return row;
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });
    const source = JSON.parse(await fs.readFile(SOURCE_PATH, "utf8")) as SourceCandidate[];
    const candidates = source
        .filter((item) => item.symbol && item.address && !CORE_OR_REJECTED.has(item.symbol.toUpperCase()))
        .sort((left, right) => left.symbol.localeCompare(right.symbol));

    const baseline = await runHybridBacktest("RETQ22", { label: "current_retq22_reference" });
    const idleWindows = buildIdleWindows(baseline);
    const rows: Row[] = [];

    for (const candidate of candidates) {
        try {
            const row = await runCandidate(candidate, baseline, idleWindows);
            rows.push(row);
            const passes = rows.filter((item) => item.passes);
            console.log(`${candidate.symbol}: end=${row.end_equity ?? "error"} blocked=${row.blocked_end_equity ?? "-"} pass=${row.passes ? "yes" : "no"}`);
            if (passes.length >= 3) {
                break;
            }
        } catch (error) {
            rows.push({
                candidate: candidate.symbol,
                coingecko_id: candidate.id,
                bnbchain_address: candidate.address,
                error: error instanceof Error ? error.message : String(error),
            });
            console.log(`${candidate.symbol}: error`);
        }
    }

    rows.sort((left, right) => (right.blocked_end_equity ?? right.end_equity ?? -Infinity) - (left.blocked_end_equity ?? left.end_equity ?? -Infinity));
    const passes = rows.filter((row) => row.passes);

    const md = [
        "# BNB Chain Idle Candidate Search",
        "",
        "CoinGecko platform dataでBNB Chainアドレスがあり、Binance USDT足がある未検証候補だけを対象にしました。",
        "",
        "## Baseline",
        "",
        `- end_equity: ${baseline.summary.end_equity.toFixed(2)}`,
        `- CAGR: ${baseline.summary.cagr_pct.toFixed(2)}%`,
        `- MaxDD: ${baseline.summary.max_drawdown_pct.toFixed(2)}%`,
        `- target_after_top_trade_removed: ${TARGET_END_EQUITY}`,
        `- searched: ${rows.length}`,
        `- found: ${passes.length}`,
        "",
        "## Passing Candidates",
        "",
        "| candidate | blocked equity | blocked CAGR % | blocked MaxDD % | normal equity | address |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
        ...passes.map((row) => `| ${row.candidate} | ${row.blocked_end_equity} | ${row.blocked_cagr_pct} | ${row.blocked_max_drawdown_pct} | ${row.end_equity} | ${row.bnbchain_address} |`),
        "",
        "## All Tested",
        "",
        "| candidate | normal equity | blocked equity | normal delta | blocked delta | top trade pnl | pass? | address | error |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
        ...rows.map((row) => `| ${row.candidate} | ${row.end_equity ?? "-"} | ${row.blocked_end_equity ?? "-"} | ${row.delta_end_equity ?? "-"} | ${row.blocked_delta_end_equity ?? "-"} | ${row.top_trade_pnl ?? "-"} | ${row.passes ? "yes" : "no"} | ${row.bnbchain_address} | ${(row.error ?? row.skipped_block_reason ?? "").replaceAll("|", "/")} |`),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
        baseline: baseline.summary,
        idleWindows,
        searched: rows.length,
        found: passes.length,
        results: rows,
    }, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
    console.log(JSON.stringify({ searched: rows.length, found: passes.length, passes }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
