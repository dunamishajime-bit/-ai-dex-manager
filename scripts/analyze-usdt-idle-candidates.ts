import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles, type Candle1h } from "../lib/backtest/binance-source.ts";

const EVENTS_CSV = path.join(
    process.cwd(),
    "reports",
    "improvement-options",
    "baseline",
    "retq22-trade_events.csv",
);
const REPORT_DIR = path.join(process.cwd(), "reports", "idle-candidate-analysis");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "backtest-binance");
const ANALYSIS_END_TS = Date.UTC(2025, 11, 31, 23, 0, 0);

const CANDIDATES = [
    "LINK",
    "XRP",
    "ADA",
    "TRX",
    "INJ",
    "NEAR",
    "UNI",
    "AAVE",
    "ATOM",
    "DOT",
    "LTC",
    "ALPACA",
    "DODO",
    "BCH",
    "MATIC",
] as const;

type EventRow = {
    time: string;
    symbol: string;
    action: "enter" | "exit";
};

type IdleWindow = {
    startIso: string;
    endIso: string;
    bars: number;
};

function parseCsvLine(line: string) {
    return line.split(",");
}

async function loadTradeEvents(): Promise<EventRow[]> {
    const raw = await fs.readFile(EVENTS_CSV, "utf8");
    const lines = raw.trim().split(/\r?\n/);
    const [, ...rows] = lines;
    return rows.map((line) => {
        const [time, symbol, action] = parseCsvLine(line);
        return {
            time,
            symbol,
            action: action as EventRow["action"],
        };
    });
}

function buildIdleWindows(events: EventRow[]) {
    const idleWindows: IdleWindow[] = [];
    const sorted = [...events].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    let lastExitTs: number | null = null;
    for (const event of sorted) {
        const ts = new Date(event.time).getTime();
        if (event.action === "exit") {
            lastExitTs = ts;
            continue;
        }

        if (event.action === "enter" && lastExitTs && ts > lastExitTs) {
            const bars = Math.floor((ts - lastExitTs) / (1000 * 60 * 60));
            if (bars >= 12) {
                idleWindows.push({
                    startIso: new Date(lastExitTs).toISOString(),
                    endIso: new Date(ts).toISOString(),
                    bars,
                });
            }
            lastExitTs = null;
        }
    }

    if (lastExitTs && ANALYSIS_END_TS > lastExitTs) {
        const bars = Math.floor((ANALYSIS_END_TS - lastExitTs) / (1000 * 60 * 60));
        if (bars >= 12) {
            idleWindows.push({
                startIso: new Date(lastExitTs).toISOString(),
                endIso: new Date(ANALYSIS_END_TS).toISOString(),
                bars,
            });
        }
    }

    return idleWindows;
}

function priceAtOrAfter(candles: Candle1h[], ts: number) {
    return candles.find((bar) => bar.ts >= ts)?.close ?? null;
}

function priceAtOrBefore(candles: Candle1h[], ts: number) {
    for (let i = candles.length - 1; i >= 0; i -= 1) {
        if (candles[i].ts <= ts) return candles[i].close;
    }
    return null;
}

async function loadCandidateCandles(symbol: string) {
    return loadHistoricalCandles({
        symbol: `${symbol}USDT`,
        cacheRoot: CACHE_ROOT,
        startMs: Date.UTC(2023, 0, 1, 0, 0, 0),
        endMs: ANALYSIS_END_TS,
    });
}

async function main() {
    const events = await loadTradeEvents();
    const idleWindows = buildIdleWindows(events);
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const results: Array<{
        symbol: string;
        compoundedReturnPct: number;
        averageWindowReturnPct: number;
        positiveWindows: number;
        totalWindows: number;
        bestWindowReturnPct: number;
        worstWindowReturnPct: number;
        bestWindows: Array<{ startIso: string; endIso: string; returnPct: number }>;
    }> = [];

    for (const symbol of CANDIDATES) {
        const candles = await loadCandidateCandles(symbol);
        let compounded = 1;
        let totalReturn = 0;
        let positiveWindows = 0;
        let bestWindowReturnPct = Number.NEGATIVE_INFINITY;
        let worstWindowReturnPct = Number.POSITIVE_INFINITY;
        const windowRows: Array<{ startIso: string; endIso: string; returnPct: number }> = [];

        for (const window of idleWindows) {
            const startTs = new Date(window.startIso).getTime();
            const endTs = new Date(window.endIso).getTime();
            const startPrice = priceAtOrAfter(candles, startTs);
            const endPrice = priceAtOrBefore(candles, endTs);
            if (!startPrice || !endPrice || startPrice <= 0) continue;

            const returnPct = (endPrice / startPrice - 1) * 100;
            compounded *= endPrice / startPrice;
            totalReturn += returnPct;
            if (returnPct > 0) positiveWindows += 1;
            bestWindowReturnPct = Math.max(bestWindowReturnPct, returnPct);
            worstWindowReturnPct = Math.min(worstWindowReturnPct, returnPct);
            windowRows.push({
                startIso: window.startIso,
                endIso: window.endIso,
                returnPct: Number(returnPct.toFixed(2)),
            });
        }

        windowRows.sort((a, b) => b.returnPct - a.returnPct);
        results.push({
            symbol,
            compoundedReturnPct: Number(((compounded - 1) * 100).toFixed(2)),
            averageWindowReturnPct: Number((totalReturn / Math.max(windowRows.length, 1)).toFixed(2)),
            positiveWindows,
            totalWindows: windowRows.length,
            bestWindowReturnPct: Number((Number.isFinite(bestWindowReturnPct) ? bestWindowReturnPct : 0).toFixed(2)),
            worstWindowReturnPct: Number((Number.isFinite(worstWindowReturnPct) ? worstWindowReturnPct : 0).toFixed(2)),
            bestWindows: windowRows.slice(0, 5),
        });
    }

    results.sort((a, b) => b.compoundedReturnPct - a.compoundedReturnPct);

    const report = {
        sourceEventsCsv: EVENTS_CSV,
        idleWindows,
        results,
    };

    const md = [
        "# Idle Window Candidate Analysis",
        "",
        "## USDT待機期間",
        "",
        ...idleWindows.map((window, index) => `${index + 1}. ${window.startIso} -> ${window.endIso} (${window.bars}h)`),
        "",
        "## 候補通貨の比較",
        "",
        "| symbol | compounded % | avg window % | positive/total | best % | worst % |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        ...results.map(
            (row) =>
                `| ${row.symbol} | ${row.compoundedReturnPct} | ${row.averageWindowReturnPct} | ${row.positiveWindows}/${row.totalWindows} | ${row.bestWindowReturnPct} | ${row.worstWindowReturnPct} |`,
        ),
        "",
        "## 上位候補が強かった待機期間",
        "",
        ...results.slice(0, 5).flatMap((row) => [
            `### ${row.symbol}`,
            ...row.bestWindows.map((window) => `- ${window.startIso} -> ${window.endIso}: ${window.returnPct}%`),
            "",
        ]),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "analysis.json"), JSON.stringify(report, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "analysis.md"), md, "utf8");

    console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
