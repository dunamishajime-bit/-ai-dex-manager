import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles } from "../lib/backtest/binance-source.ts";

const EVENTS_CSV = path.join(process.cwd(), "reports", "improvement-options", "baseline", "retq22-trade_events.csv");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "backtest-binance");
const START_TS = Date.UTC(2023, 0, 1, 0, 0, 0);
const END_TS = Date.UTC(2025, 11, 31, 23, 0, 0);
const SYMBOL = (process.argv[2] || "ZEC").toUpperCase();

function priceAtOrAfter<T extends { ts: number; close: number }>(candles: T[], ts: number) {
    return candles.find((bar) => bar.ts >= ts)?.close ?? null;
}

function priceAtOrBefore<T extends { ts: number; close: number }>(candles: T[], ts: number) {
    for (let index = candles.length - 1; index >= 0; index -= 1) {
        if (candles[index].ts <= ts) return candles[index].close;
    }
    return null;
}

async function loadIdleWindows() {
    const raw = await fs.readFile(EVENTS_CSV, "utf8");
    const rows = raw.trim().split(/\r?\n/).slice(1).map((line) => {
        const [time, , action] = line.split(",");
        return { time, action };
    }).sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());

    const windows: Array<{ startTs: number; endTs: number; bars: number }> = [];
    let lastExitTs: number | null = null;
    for (const row of rows) {
        const ts = new Date(row.time).getTime();
        if (row.action === "exit") {
            lastExitTs = ts;
            continue;
        }
        if (row.action === "enter" && lastExitTs && ts > lastExitTs) {
            const bars = Math.floor((ts - lastExitTs) / (60 * 60 * 1000));
            if (bars >= 12) windows.push({ startTs: lastExitTs, endTs: ts, bars });
            lastExitTs = null;
        }
    }
    if (lastExitTs && END_TS > lastExitTs) {
        const bars = Math.floor((END_TS - lastExitTs) / (60 * 60 * 1000));
        if (bars >= 12) windows.push({ startTs: lastExitTs, endTs: END_TS, bars });
    }
    return windows;
}

function compound(rows: Array<{ returnPct: number }>) {
    return rows.reduce((acc, row) => acc * (1 + row.returnPct / 100), 1) - 1;
}

async function main() {
    const candles = await loadHistoricalCandles({
        symbol: `${SYMBOL}USDT`,
        cacheRoot: CACHE_ROOT,
        startMs: START_TS,
        endMs: END_TS,
    });
    const windows = await loadIdleWindows();
    const rows = windows.map((window, index) => {
        const startPrice = priceAtOrAfter(candles, window.startTs);
        const endPrice = priceAtOrBefore(candles, window.endTs);
        const returnPct = startPrice && endPrice ? (endPrice / startPrice - 1) * 100 : null;
        return {
            index: index + 1,
            startIso: new Date(window.startTs).toISOString(),
            endIso: new Date(window.endTs).toISOString(),
            bars: window.bars,
            returnPct,
        };
    }).filter((row): row is Omit<typeof row, "returnPct"> & { returnPct: number } => row.returnPct != null)
        .sort((left, right) => right.returnPct - left.returnPct);

    const report = {
        symbol: SYMBOL,
        compoundedPct: Number((compound(rows) * 100).toFixed(2)),
        withoutBestPct: Number((compound(rows.slice(1)) * 100).toFixed(2)),
        withoutTop2Pct: Number((compound(rows.slice(2)) * 100).toFixed(2)),
        withoutTop3Pct: Number((compound(rows.slice(3)) * 100).toFixed(2)),
        top10: rows.slice(0, 10).map((row) => ({
            ...row,
            returnPct: Number(row.returnPct.toFixed(2)),
        })),
    };

    console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
