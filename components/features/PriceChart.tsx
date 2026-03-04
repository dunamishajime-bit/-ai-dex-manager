"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, AreaSeries, LineSeries, ISeriesApi } from "lightweight-charts";
import { ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Timeframe = "1" | "5" | "15" | "60" | "240" | "1D";

const TIMEFRAMES = [
    { label: "1m", value: "1" as Timeframe, days: 1 },
    { label: "5m", value: "5" as Timeframe, days: 2 },
    { label: "15m", value: "15" as Timeframe, days: 5 },
    { label: "1H", value: "60" as Timeframe, days: 14 },
    { label: "4H", value: "240" as Timeframe, days: 60 },
    { label: "1D", value: "1D" as Timeframe, days: 365 },
];

const PAIR_OPTIONS = [
    { label: "BTC/USDT", coinId: "bitcoin" },
    { label: "ETH/USDT", coinId: "ethereum" },
    { label: "BNB/USDT", coinId: "binancecoin" },
    { label: "SOL/USDT", coinId: "solana" },
    { label: "AVAX/USDT", coinId: "avalanche-2" },
    { label: "POL/USDT", coinId: "polygon" },
    { label: "LINK/USDT", coinId: "chainlink" },
    { label: "ARB/USDT", coinId: "arbitrum" },
    { label: "OP/USDT", coinId: "optimism" },
    { label: "ASTER/USDT", coinId: "astar" },
    { label: "WLFI/USDT", coinId: "world-liberty-financial" },
];

type ChartPoint = { time: number; value: number };

async function fetchChartData(coinId: string, days: number): Promise<ChartPoint[]> {
    const response = await fetch(`/api/market/chart?id=${coinId}&days=${days}`);
    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.prices)) return [];

    return payload.prices
        .map(([time, price]: [number, number]) => ({
            time: Math.floor(time / 1000),
            value: Number(price),
        }))
        .filter((point: ChartPoint) => Number.isFinite(point.value))
        .sort((left: ChartPoint, right: ChartPoint) => left.time - right.time);
}

const STABLECOINS = ["USDT", "USDC", "BUSD", "DAI", "TUSD", "USD1", "FDUSD", "USDP"];

function isStablePair(label: string): boolean {
    const [base, quote] = label.split("/");
    return STABLECOINS.includes(base?.toUpperCase()) && STABLECOINS.includes(quote?.toUpperCase());
}

interface PriceChartProps {
    headless?: boolean;
    initialCoinId?: string;
    initialPairLabel?: string;
}

export function PriceChart({ headless = false, initialCoinId }: PriceChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
    const maSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

    const initialPair = PAIR_OPTIONS.find((pair) => pair.coinId === initialCoinId) ?? PAIR_OPTIONS[1];
    const [selectedPair, setSelectedPair] = useState(initialPair);
    const [selectedTF, setSelectedTF] = useState(TIMEFRAMES[0]);
    const [chartData, setChartData] = useState<ChartPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showPairDropdown, setShowPairDropdown] = useState(false);

    const lastPrice = chartData.length ? chartData[chartData.length - 1].value : null;
    const firstPrice = chartData.length ? chartData[0].value : null;
    const priceChange = lastPrice !== null && firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#a1a1aa",
            },
            grid: {
                vertLines: { color: "rgba(255,255,255,0.04)" },
                horzLines: { color: "rgba(255,255,255,0.04)" },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight || 280,
            timeScale: {
                borderColor: "rgba(255,255,255,0.1)",
                timeVisible: true,
                secondsVisible: selectedTF.value === "1" || selectedTF.value === "5",
            },
            rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
        });

        areaSeriesRef.current = chart.addSeries(AreaSeries, {
            lineColor: "#38bdf8",
            topColor: "rgba(56,189,248,0.28)",
            bottomColor: "rgba(56,189,248,0.02)",
            lineWidth: 2,
        }) as any;
        maSeriesRef.current = chart.addSeries(LineSeries, {
            color: "#fbbf24",
            lineWidth: 2,
            priceLineVisible: false,
        });
        chartRef.current = chart;

        const resizeObserver = new ResizeObserver((entries) => {
            const entry = Array.isArray(entries) && entries.length > 0 ? entries[0] : null;
            if (!entry || !chartRef.current) return;
            const width = Math.max(entry.contentRect.width, 320);
            const height = Math.max(entry.contentRect.height, 220);
            chartRef.current.applyOptions({ width, height });
        });

        resizeObserver.observe(chartContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            areaSeriesRef.current = null;
            maSeriesRef.current = null;
        };
    }, [selectedTF.value]);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchChartData(selectedPair.coinId, selectedTF.days);
            if (!data.length) {
                setChartData([]);
                setError("チャートデータの取得に失敗しました");
                return;
            }
            setChartData(data);
        } catch (e) {
            setChartData([]);
            setError("チャートデータの取得に失敗しました");
        } finally {
            setLoading(false);
        }
    }, [selectedPair.coinId, selectedTF.days]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!areaSeriesRef.current || !maSeriesRef.current || !chartData.length) return;

        areaSeriesRef.current.setData(chartData as any);
        const maPeriod = 14;
        const movingAverage = chartData.map((point, index) => {
            const subset = chartData.slice(Math.max(0, index - maPeriod + 1), index + 1);
            const average = subset.reduce((sum, item) => sum + item.value, 0) / subset.length;
            return { time: point.time as any, value: average };
        });
        maSeriesRef.current.setData(movingAverage as any);
        chartRef.current?.timeScale().fitContent();
    }, [chartData]);

    const controls = (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-2 py-2">
            <div className="relative">
                <button
                    onClick={() => setShowPairDropdown((prev) => !prev)}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:border-gold-500/40"
                >
                    {selectedPair.label}
                    <ChevronDown className="h-3 w-3 text-gray-400" />
                </button>
                {showPairDropdown ? (
                    <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-gold-500/20 bg-[#0d1117] shadow-2xl">
                        {PAIR_OPTIONS.map((pair) => (
                            <button
                                key={pair.coinId}
                                onClick={() => {
                                    setSelectedPair(pair);
                                    setShowPairDropdown(false);
                                }}
                                className={cn(
                                    "w-full px-3 py-2 text-left text-xs transition-colors hover:bg-gold-500/10 hover:text-gold-400",
                                    selectedPair.coinId === pair.coinId ? "bg-gold-500/10 text-gold-400" : "text-gray-400"
                                )}
                            >
                                {pair.label}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>

            {lastPrice !== null ? (
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">
                        ${lastPrice.toLocaleString(undefined, { minimumFractionDigits: lastPrice >= 1 ? 2 : 4, maximumFractionDigits: lastPrice >= 1 ? 2 : 6 })}
                    </span>
                    {priceChange !== null ? (
                        <span className={cn("text-xs font-mono", priceChange >= 0 ? "text-emerald-400" : "text-red-400")}>
                            {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%
                        </span>
                    ) : null}
                </div>
            ) : null}

            <div className="flex items-center gap-1">
                {TIMEFRAMES.map((timeframe) => (
                    <button
                        key={timeframe.value}
                        onClick={() => setSelectedTF(timeframe)}
                        className={cn(
                            "rounded px-2 py-1 text-[10px] font-bold transition-all",
                            selectedTF.value === timeframe.value
                                ? "border border-gold-500/50 bg-gold-500/20 text-gold-400"
                                : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                        )}
                    >
                        {timeframe.label}
                    </button>
                ))}
                <button
                    onClick={loadData}
                    disabled={loading}
                    className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gold-500/10 hover:text-gold-400"
                    title="更新"
                >
                    <RefreshCw className={cn("h-3 w-3", loading && "animate-spin text-gold-400")} />
                </button>
            </div>
        </div>
    );

    const chartBody = (
        <div className="flex h-full flex-col overflow-hidden">
            {controls}
            {isStablePair(selectedPair.label) ? (
                <div className="mx-2 mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-400">
                    ステーブル同士のペアは値動きが小さいため、通常は 1.00 付近で推移します。
                </div>
            ) : null}
            {error ? (
                <div className="mx-2 mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-400">
                    {error}
                </div>
            ) : null}
            <div ref={chartContainerRef} className="relative min-h-[220px] w-full flex-1">
                {loading ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/20 backdrop-blur-sm">
                        <div className="flex items-center gap-2">
                            <RefreshCw className="h-4 w-4 animate-spin text-gold-400" />
                            <span className="text-xs text-gray-400">チャートデータを取得中...</span>
                        </div>
                    </div>
                ) : null}
            </div>
            <div className="flex items-center justify-between border-t border-white/5 px-3 py-1.5">
                <div className="flex gap-4">
                    <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-sky-400" />
                        <span className="text-[10px] text-gray-400">PRICE</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        <span className="text-[10px] text-gray-400">MA(14)</span>
                    </div>
                </div>
                <div className="text-[10px] text-gray-600">CoinCap / CoinGecko</div>
            </div>
        </div>
    );

    if (headless) return chartBody;

    return (
        <div className="h-full overflow-hidden rounded-xl border border-gold-500/10 bg-[#0d1117]">
            <div className="flex items-center justify-between border-b border-gold-500/10 px-4 py-3">
                <h3 className="text-sm font-bold text-white">
                    {selectedPair.label} <span className="text-xs text-gray-500">ターミナル・チャート</span>
                </h3>
            </div>
            <div className="h-[calc(100%-52px)]">{chartBody}</div>
        </div>
    );
}
