import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles } from "@/lib/backtest/binance-source";
import { buildIndicatorBars, latestIndicatorAtOrBefore, resampleTo12h } from "@/lib/backtest/indicators";

type SymbolName = "BTC" | "ETH" | "SOL" | "AVAX";

const REPORT_DIR = path.join(process.cwd(), "reports", "range-regime-analysis");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "hybrid-retq22");
const LOCAL_ZIP_PATHS: Record<SymbolName, string | null> = {
    BTC: path.join("C:\\Users\\dis\\Desktop", "2022BTC.zip"),
    ETH: path.join("C:\\Users\\dis\\Desktop", "2022ETH.zip"),
    SOL: path.join("C:\\Users\\dis\\Desktop", "2022SOL.zip"),
    AVAX: null,
};

function formatIso(ts: number) {
    return new Date(ts).toISOString();
}

function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function loadIndicators() {
    const startMs = Date.UTC(2022, 0, 1, 0, 0, 0);
    const endMs = Date.UTC(2026, 0, 1, 0, 0, 0) - 1;
    const bySymbol = {} as Record<SymbolName, Awaited<ReturnType<typeof loadHistoricalCandles>>>;

    for (const symbol of ["BTC", "ETH", "SOL", "AVAX"] as const) {
        bySymbol[symbol] = await loadHistoricalCandles({
            symbol: `${symbol}USDT`,
            localZipPath: LOCAL_ZIP_PATHS[symbol] || undefined,
            cacheRoot: CACHE_ROOT,
            startMs,
            endMs,
        });
    }

    return {
        BTC: buildIndicatorBars(resampleTo12h(bySymbol.BTC)),
        ETH: buildIndicatorBars(resampleTo12h(bySymbol.ETH)),
        SOL: buildIndicatorBars(resampleTo12h(bySymbol.SOL)),
        AVAX: buildIndicatorBars(resampleTo12h(bySymbol.AVAX)),
    };
}

async function main() {
    const indicators = await loadIndicators();
    const timeline = indicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);

    type Row = {
        ts: number;
        iso: string;
        year: number;
        btc_dist90: number;
        btc_adx14: number;
        breadth40: number;
        breadth45: number;
        best_mom20: number;
        avg_mom20_eth_sol: number;
        eth_dist45: number;
        eth_mom20: number;
        eth_adx14: number;
        eth_overheat: number;
        label: "trend" | "range_candidate" | "defensive";
    };

    const rows: Row[] = [];
    for (const ts of timeline) {
        const year = new Date(ts).getUTCFullYear();
        if (year !== 2024 && year !== 2025) continue;

        const btc = latestIndicatorAtOrBefore(indicators.BTC, ts);
        const eth = latestIndicatorAtOrBefore(indicators.ETH, ts);
        const sol = latestIndicatorAtOrBefore(indicators.SOL, ts);
        const avax = latestIndicatorAtOrBefore(indicators.AVAX, ts);
        if (!btc || !eth || !sol || !avax || !btc.ready || !eth.ready || !sol.ready || !avax.ready) continue;

        const tradeBars = [eth, sol, avax];
        const breadth40 = tradeBars.filter((bar) => bar.close > bar.sma40).length;
        const breadth45 = tradeBars.filter((bar) => bar.close > bar.sma45).length;
        const bestMom20 = Math.max(...tradeBars.map((bar) => bar.mom20));
        const avgMom20EthSol = average([eth.mom20, sol.mom20]);
        const btcDist90 = (btc.close / Math.max(1, btc.sma90)) - 1;
        const ethDist45 = (eth.close / Math.max(1, eth.sma45)) - 1;

        let label: Row["label"] = "defensive";
        if (btc.close > btc.sma90) {
            label = "trend";
        } else if (
            btcDist90 >= -0.04 &&
            btcDist90 <= 0.012 &&
            btc.adx14 <= 18 &&
            breadth40 <= 1 &&
            bestMom20 >= -0.08 &&
            bestMom20 <= 0.03 &&
            ethDist45 <= -0.01 &&
            eth.mom20 <= 0
        ) {
            label = "range_candidate";
        }

        rows.push({
            ts,
            iso: formatIso(ts),
            year,
            btc_dist90: btcDist90,
            btc_adx14: btc.adx14,
            breadth40,
            breadth45,
            best_mom20: bestMom20,
            avg_mom20_eth_sol: avgMom20EthSol,
            eth_dist45: ethDist45,
            eth_mom20: eth.mom20,
            eth_adx14: eth.adx14,
            eth_overheat: eth.overheatPct,
            label,
        });
    }

    const grouped = {
        total: rows.length,
        trend: rows.filter((row) => row.label === "trend"),
        range_candidate: rows.filter((row) => row.label === "range_candidate"),
        defensive: rows.filter((row) => row.label === "defensive"),
    };

    const summarize = (items: Row[]) => ({
        count: items.length,
        pct: rows.length ? (items.length / rows.length) * 100 : 0,
        avg_btc_dist90: average(items.map((item) => item.btc_dist90)),
        avg_btc_adx14: average(items.map((item) => item.btc_adx14)),
        avg_best_mom20: average(items.map((item) => item.best_mom20)),
        avg_eth_dist45: average(items.map((item) => item.eth_dist45)),
        avg_eth_mom20: average(items.map((item) => item.eth_mom20)),
        avg_eth_adx14: average(items.map((item) => item.eth_adx14)),
        avg_eth_overheat: average(items.map((item) => item.eth_overheat)),
        sample_start: items[0]?.iso || null,
        sample_end: items.at(-1)?.iso || null,
    });

    const summary = {
        trend: summarize(grouped.trend),
        range_candidate: summarize(grouped.range_candidate),
        defensive: summarize(grouped.defensive),
    };

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "rows.json"), JSON.stringify(rows, null, 2), "utf8");

    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
