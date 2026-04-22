import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import type { BacktestResult, TradePairRow } from "../lib/backtest/types.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "idle-only-extra-candidates");

const CANDIDATES = [
    "SFP",
    "BCH",
    "ZEC",
    "DASH",
    "BAT",
    "BNB",
    "XRP",
    "EOS",
    "CHZ",
    "AAVE",
    "LTC",
    "LINK",
    "COMP",
    "ALPACA",
    "XVS",
    "RUNE",
    "CHR",
    "UNI",
    "KAVA",
    "MANA",
    "ADA",
    "NEAR",
    "INJ",
    "MATIC",
    "FET",
    "DOT",
    "GMT",
    "CRV",
    "ZIL",
    "MASK",
    "DODO",
    "ATOM",
    "SAND",
    "ONE",
    "DYDX",
    "GALA",
    "FIL",
    "AXS",
    "ANKR",
    "IOTX",
    "COTI",
    "ROSE",
    "WOO",
    "STORJ",
    "SKL",
    "ENJ",
    "LRC",
    "CELO",
    "XTZ",
    "NEO",
    "QTUM",
    "ONT",
    "ONG",
    "IOST",
    "HOT",
    "RVN",
    "JASMY",
    "ARPA",
    "CVC",
    "ACH",
    "YGG",
    "MAGIC",
    "SUPER",
    "GLMR",
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

type Row = {
    candidate: string;
    end_equity?: number;
    cagr_pct?: number;
    max_drawdown_pct?: number;
    profit_factor?: number;
    trade_count?: number;
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
    passes_after_top_trade_removed?: boolean;
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

async function runCandidate(candidate: string, baseline: BacktestResult, idleWindows: NonNullable<HybridVariantOptions["strictExtraTrendAllowedWindows"]>): Promise<Row> {
    const result = await runHybridBacktest("RETQ22", {
        label: `idle_only_plus_${candidate.toLowerCase()}`,
        strictExtraTrendSymbols: [candidate],
        strictExtraTrendAllowedWindows: idleWindows,
    });
    const topTrade = topCandidateTrade(result, candidate);

    const row: Row = {
        candidate,
        end_equity: round(result.summary.end_equity),
        cagr_pct: round(result.summary.cagr_pct),
        max_drawdown_pct: round(result.summary.max_drawdown_pct),
        profit_factor: round(result.summary.profit_factor),
        trade_count: result.summary.trade_count,
        delta_end_equity: round(result.summary.end_equity - baseline.summary.end_equity),
        candidate_pnl: round(result.summary.symbol_contribution[candidate] ?? 0),
        candidate_trades: result.trade_pairs.filter((trade) => trade.symbol === candidate).length,
        top_trade_pnl: topTrade ? round(topTrade.net_pnl) : 0,
        top_trade_window: topTrade ? `${topTrade.entry_time} -> ${topTrade.exit_time}` : "-",
    };

    if (topTrade && topTrade.net_pnl > 0) {
        const blocked = await runHybridBacktest("RETQ22", {
            label: `idle_only_plus_${candidate.toLowerCase()}_top_trade_removed`,
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
        row.passes_after_top_trade_removed = blocked.summary.end_equity > baseline.summary.end_equity;
    } else {
        row.blocked_end_equity = row.end_equity;
        row.blocked_cagr_pct = row.cagr_pct;
        row.blocked_max_drawdown_pct = row.max_drawdown_pct;
        row.blocked_delta_end_equity = row.delta_end_equity;
        row.blocked_candidate_pnl = row.candidate_pnl;
        row.blocked_candidate_trades = row.candidate_trades;
        row.passes_after_top_trade_removed = (row.delta_end_equity ?? 0) > 0;
    }

    return row;
}

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const baseline = await runHybridBacktest("RETQ22", {
        label: "current_retq22_reference",
    });
    const idleWindows = buildIdleWindows(baseline);

    const rows: Row[] = [];
    for (const candidate of CANDIDATES) {
        try {
            rows.push(await runCandidate(candidate, baseline, idleWindows));
        } catch (error) {
            rows.push({
                candidate,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    rows.sort((left, right) => (right.blocked_delta_end_equity ?? -Infinity) - (left.blocked_delta_end_equity ?? -Infinity));

    const md = [
        "# Idle-Only Extra Candidate Backtest",
        "",
        "現行RETQ22のUSDT待機期間だけ候補通貨を許可し、候補ごとの最大利益トレードを除外した結果で並べています。",
        "",
        "## Baseline",
        "",
        `- end_equity: ${baseline.summary.end_equity.toFixed(2)}`,
        `- CAGR: ${baseline.summary.cagr_pct.toFixed(2)}%`,
        `- MaxDD: ${baseline.summary.max_drawdown_pct.toFixed(2)}%`,
        `- trades: ${baseline.summary.trade_count}`,
        `- idle_windows: ${idleWindows.length}`,
        "",
        "## Results",
        "",
        "| candidate | normal delta | blocked delta | blocked equity | blocked CAGR % | blocked MaxDD % | cand pnl after block | cand trades after block | top trade pnl | pass? |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ...rows.map((row) => {
            if (row.error) {
                return `| ${row.candidate} | error | - | - | - | - | - | - | - | ${row.error.replaceAll("|", "/")} |`;
            }
            return `| ${row.candidate} | ${row.delta_end_equity} | ${row.blocked_delta_end_equity} | ${row.blocked_end_equity} | ${row.blocked_cagr_pct} | ${row.blocked_max_drawdown_pct} | ${row.blocked_candidate_pnl} | ${row.blocked_candidate_trades} | ${row.top_trade_pnl} | ${row.passes_after_top_trade_removed ? "yes" : "no"} |`;
        }),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
        baseline: baseline.summary,
        idleWindows,
        results: rows,
    }, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

    console.log(JSON.stringify({
        baseline: baseline.summary,
        idle_window_count: idleWindows.length,
        top_results: rows.slice(0, 20),
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
