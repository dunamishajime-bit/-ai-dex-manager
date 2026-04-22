import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles, type Candle1h } from "../lib/backtest/binance-source.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "low-eth-correlation-additional");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "backtest-binance");
const EVENTS_CSV = path.join(process.cwd(), "reports", "improvement-options", "baseline", "retq22-trade_events.csv");
const START_TS = Date.UTC(2023, 0, 1, 0, 0, 0);
const END_TS = Date.UTC(2025, 11, 31, 23, 0, 0);

// Excludes the previously highlighted TRX/SFP/BCH and previously rejected DOGE/BAKE/CAKE/TWT.
const CANDIDATES = [
    "ANKR",
    "IOTX",
    "COTI",
    "ROSE",
    "WOO",
    "STORJ",
    "SKL",
    "BAT",
    "ENJ",
    "LRC",
    "CELO",
    "XTZ",
    "ZEC",
    "DASH",
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
] as const;

type EventRow = {
    time: string;
    action: "enter" | "exit";
};

type IdleWindow = {
    startTs: number;
    endTs: number;
    bars: number;
};

function pct(value: number) {
    return Number(value.toFixed(2));
}

function corr(left: number[], right: number[]) {
    const n = Math.min(left.length, right.length);
    if (n < 3) return 0;
    const xs = left.slice(0, n);
    const ys = right.slice(0, n);
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;
    for (let index = 0; index < n; index += 1) {
        const dx = xs[index] - meanX;
        const dy = ys[index] - meanY;
        numerator += dx * dy;
        denomX += dx * dx;
        denomY += dy * dy;
    }
    const denom = Math.sqrt(denomX * denomY);
    return denom > 0 ? numerator / denom : 0;
}

function toReturnMap(candles: Candle1h[], stepHours = 12) {
    const stepMs = stepHours * 60 * 60 * 1000;
    const byTs = new Map(candles.map((candle) => [candle.ts, candle.close]));
    const returns = new Map<number, number>();
    for (const candle of candles) {
        const previous = byTs.get(candle.ts - stepMs);
        if (!previous || previous <= 0) continue;
        returns.set(candle.ts, Math.log(candle.close / previous));
    }
    return returns;
}

function pairedReturns(base: Map<number, number>, candidate: Map<number, number>, windows?: IdleWindow[]) {
    const left: number[] = [];
    const right: number[] = [];
    for (const [ts, value] of base) {
        if (windows && !windows.some((window) => ts >= window.startTs && ts <= window.endTs)) continue;
        const other = candidate.get(ts);
        if (other == null) continue;
        left.push(value);
        right.push(other);
    }
    return { left, right };
}

function priceAtOrAfter(candles: Candle1h[], ts: number) {
    return candles.find((bar) => bar.ts >= ts)?.close ?? null;
}

function priceAtOrBefore(candles: Candle1h[], ts: number) {
    for (let index = candles.length - 1; index >= 0; index -= 1) {
        if (candles[index].ts <= ts) return candles[index].close;
    }
    return null;
}

async function loadCandles(symbol: string) {
    return loadHistoricalCandles({
        symbol: `${symbol}USDT`,
        cacheRoot: CACHE_ROOT,
        startMs: START_TS,
        endMs: END_TS,
    });
}

async function loadIdleWindows() {
    const raw = await fs.readFile(EVENTS_CSV, "utf8");
    const rows = raw.trim().split(/\r?\n/).slice(1).map((line): EventRow => {
        const [time, , action] = line.split(",");
        return { time, action: action as EventRow["action"] };
    }).sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());

    const windows: IdleWindow[] = [];
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

async function main() {
    await fs.mkdir(REPORT_DIR, { recursive: true });
    const idleWindows = await loadIdleWindows();
    const ethCandles = await loadCandles("ETH");
    const ethReturns = toReturnMap(ethCandles);

    const rows = [];
    for (const symbol of CANDIDATES) {
        try {
            const candles = await loadCandles(symbol);
            if (candles.length < 500) throw new Error(`insufficient candles: ${candles.length}`);

            const returns = toReturnMap(candles);
            const fullPairs = pairedReturns(ethReturns, returns);
            const idlePairs = pairedReturns(ethReturns, returns, idleWindows);

            let compounded = 1;
            let positiveWindows = 0;
            let worstWindow = Number.POSITIVE_INFINITY;
            let bestWindow = Number.NEGATIVE_INFINITY;
            for (const window of idleWindows) {
                const startPrice = priceAtOrAfter(candles, window.startTs);
                const endPrice = priceAtOrBefore(candles, window.endTs);
                if (!startPrice || !endPrice || startPrice <= 0) continue;
                const ratio = endPrice / startPrice;
                compounded *= ratio;
                const returnPct = (ratio - 1) * 100;
                if (returnPct > 0) positiveWindows += 1;
                worstWindow = Math.min(worstWindow, returnPct);
                bestWindow = Math.max(bestWindow, returnPct);
            }

            rows.push({
                symbol,
                ethCorr12h: Number(corr(fullPairs.left, fullPairs.right).toFixed(3)),
                idleEthCorr12h: Number(corr(idlePairs.left, idlePairs.right).toFixed(3)),
                idleCompoundedPct: pct((compounded - 1) * 100),
                positiveIdleWindows: positiveWindows,
                totalIdleWindows: idleWindows.length,
                bestIdleWindowPct: pct(Number.isFinite(bestWindow) ? bestWindow : 0),
                worstIdleWindowPct: pct(Number.isFinite(worstWindow) ? worstWindow : 0),
            });
        } catch (error) {
            rows.push({
                symbol,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    rows.sort((left, right) => {
        if ("error" in left) return 1;
        if ("error" in right) return -1;
        const leftScore = left.idleCompoundedPct - Math.max(0, left.ethCorr12h) * 100 + left.positiveIdleWindows * 2 + left.worstIdleWindowPct;
        const rightScore = right.idleCompoundedPct - Math.max(0, right.ethCorr12h) * 100 + right.positiveIdleWindows * 2 + right.worstIdleWindowPct;
        return rightScore - leftScore;
    });

    const md = [
        "# Additional Low ETH Correlation Candidate Screen",
        "",
        `- idle_windows: ${idleWindows.length}`,
        "- excludes: TRX, SFP, BCH, DOGE, BAKE, CAKE, TWT",
        "- correlation: 12H log return correlation vs ETH",
        "",
        "| symbol | ETH corr | idle ETH corr | idle compounded % | positive idle | best % | worst % |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows.map((row) => {
            if ("error" in row) return `| ${row.symbol} | error | - | - | - | - | ${row.error} |`;
            return `| ${row.symbol} | ${row.ethCorr12h} | ${row.idleEthCorr12h} | ${row.idleCompoundedPct} | ${row.positiveIdleWindows}/${row.totalIdleWindows} | ${row.bestIdleWindowPct} | ${row.worstIdleWindowPct} |`;
        }),
    ].join("\n");

    await fs.writeFile(path.join(REPORT_DIR, "screen.json"), JSON.stringify({ idleWindows, results: rows }, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "screen.md"), md, "utf8");
    console.log(JSON.stringify({ results: rows }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
