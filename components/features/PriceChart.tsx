"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, ColorType, ISeriesApi, AreaSeries, LineSeries } from "lightweight-charts";
import { RefreshCw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ===== Types =====
type Timeframe = "1" | "5" | "15" | "60" | "240" | "1D";

interface TimeframeOption {
    label: string;
    value: Timeframe;
    days: number; // how many days back to fetch
}

const TIMEFRAMES: TimeframeOption[] = [
    { label: "1m", value: "1", days: 1 },
    { label: "5m", value: "5", days: 2 },
    { label: "15m", value: "15", days: 5 },
    { label: "1H", value: "60", days: 14 },
    { label: "4H", value: "240", days: 60 },
    { label: "1D", value: "1D", days: 365 },
];

// Popular tradable pairs (non-stablecoin base)
const PAIR_OPTIONS = [
    { label: "BTC/USDT", coinId: "bitcoin" },
    { label: "ETH/USDT", coinId: "ethereum" },
    { label: "BNB/USDT", coinId: "binancecoin" },
    { label: "SOL/USDT", coinId: "solana" },
    { label: "AVAX/USDT", coinId: "avalanche-2" },
    { label: "MATIC/USDT", coinId: "matic-network" },
    { label: "LINK/USDT", coinId: "chainlink" },
    { label: "ARB/USDT", coinId: "arbitrum" },
    { label: "OP/USDT", coinId: "optimism" },
    { label: "ASTR/USDT", coinId: "astar" },
    { label: "WLFI/USDT", coinId: "world-liberty-financial" },
];

interface OHLCV {
    time: number; // unix seconds
    open: number;
    high: number;
    low: number;
    close: number;
}

// ===== Fetch Data from Terminal API =====
async function fetchChartData(coinId: string, days: number): Promise<any[]> {
    try {
        const res = await fetch(`/api/market/chart?id=${coinId}&days=${days}`);
        const data = await res.json();
        if (!data.ok || !data.prices) return [];

        return data.prices.map(([time, price]: [number, number]) => ({
            time: Math.floor(time / 1000),
            value: price
        })).sort((a: any, b: any) => a.time - b.time);
    } catch (e) {
        console.error("Chart fetch failed:", e);
        return [];
    }
}

// ===== Stable coin warning =====
const STABLECOINS = ["USDT", "USDC", "BUSD", "DAI", "TUSD", "USD1", "FDUSD", "USDP"];
function isStablePair(label: string): boolean {
    const [base, quote] = label.split("/");
    return STABLECOINS.includes(base?.toUpperCase()) && STABLECOINS.includes(quote?.toUpperCase());
}

// ===== Props =====
interface PriceChartProps {
    headless?: boolean;
    initialCoinId?: string;
    initialPairLabel?: string;
}

export function PriceChart({ headless = false, initialCoinId, initialPairLabel }: PriceChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

    // State
    const initialPair = PAIR_OPTIONS.find(p => p.coinId === initialCoinId) ?? PAIR_OPTIONS[1]; // default ETH/USDT
    const [selectedPair, setSelectedPair] = useState(initialPair);
    const [selectedTF, setSelectedTF] = useState<TimeframeOption>(TIMEFRAMES[0]); // default 1min
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showPairDropdown, setShowPairDropdown] = useState(false);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [priceChange, setPriceChange] = useState<number | null>(null);

    // === Build & Destroy Chart ===
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
            crosshair: { mode: 1 },
        });

        const areaSeries = chart.addSeries(AreaSeries, {
            lineColor: "#3b82f6",
            topColor: "rgba(59, 130, 246, 0.3)",
            bottomColor: "rgba(59, 130, 246, 0.0)",
            lineWidth: 2,
        });
        const emaSeries = chart.addSeries(LineSeries, {
            color: "#fbbf24",
            lineWidth: 2,
            priceLineVisible: false,
        });

        chartRef.current = chart;
        candleSeriesRef.current = areaSeries as any;
        emaSeriesRef.current = emaSeries;

        const resizeObserver = new ResizeObserver((entries) => {
            if (entries[0] && chartRef.current) {
                const { width, height } = entries[0].contentRect;
                chartRef.current.applyOptions({ width, height: height || 280 });
            }
        });

        if (chartContainerRef.current) {
            resizeObserver.observe(chartContainerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            emaSeriesRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // === Load Chart Data ===
    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchChartData(selectedPair.coinId, selectedTF.days);
            if (!data.length) {
                setError("データの取得に失敗しました");
                return;
            }
            setChartData(data);
            const last = data[data.length - 1];
            const first = data[0];
            setLastPrice(last.value);
            setPriceChange(((last.value - first.value) / first.value) * 100);
        } catch (e) {
            setError("価格データの取得に失敗しました");
        } finally {
            setLoading(false);
        }
    }, [selectedPair.coinId, selectedTF.days]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // === Push Data to Chart ===
    useEffect(() => {
        if (!candleSeriesRef.current || !emaSeriesRef.current || chartData.length === 0) return;

        candleSeriesRef.current.setData(chartData);

        // Simple MA (14)
        const period = 14;
        const maData = chartData.map((d, i) => {
            const subset = chartData.slice(Math.max(0, i - period + 1), i + 1);
            const avg = subset.reduce((s, o) => s + o.value, 0) / subset.length;
            return { time: d.time as any, value: avg };
        });

        emaSeriesRef.current.setData(maData);
        chartRef.current?.timeScale().fitContent();
    }, [chartData]);

    const isStable = isStablePair(selectedPair.label);
    const changePositive = (priceChange ?? 0) >= 0;

    const controls = (
        <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-white/5 flex-wrap">
            {/* Pair Selector */}
            <div className="relative">
                <button
                    onClick={() => setShowPairDropdown(!showPairDropdown)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-gold-500/40 text-white text-xs font-mono font-bold transition-colors"
                >
                    {selectedPair.label}
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>
                {showPairDropdown && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-40 bg-[#0d1117] border border-gold-500/20 rounded-lg shadow-2xl overflow-hidden">
                        {PAIR_OPTIONS.map(p => (
                            <button
                                key={p.coinId}
                                onClick={() => { setSelectedPair(p); setShowPairDropdown(false); }}
                                className={cn(
                                    "w-full text-left px-3 py-2 text-xs font-mono hover:bg-gold-500/10 hover:text-gold-400 transition-colors",
                                    selectedPair.coinId === p.coinId ? "text-gold-400 bg-gold-500/10" : "text-gray-400"
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Price display */}
            {lastPrice !== null && (
                <div className="flex items-center gap-2">
                    <span className="text-white font-mono font-bold text-sm">
                        ${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: lastPrice >= 1 ? 2 : 6 })}
                    </span>
                    {priceChange !== null && (
                        <span className={cn("text-xs font-mono", changePositive ? "text-emerald-400" : "text-red-400")}>
                            {changePositive ? "+" : ""}{priceChange.toFixed(2)}%
                        </span>
                    )}
                </div>
            )}

            {/* Timeframe buttons */}
            <div className="flex items-center gap-1">
                {TIMEFRAMES.map(tf => (
                    <button
                        key={tf.value}
                        onClick={() => setSelectedTF(tf)}
                        className={cn(
                            "px-2 py-1 rounded text-[10px] font-mono font-bold transition-all",
                            selectedTF.value === tf.value
                                ? "bg-gold-500/20 text-gold-400 border border-gold-500/50"
                                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                        )}
                    >
                        {tf.label}
                    </button>
                ))}
                <button
                    onClick={loadData}
                    disabled={loading}
                    className="p-1.5 rounded text-gray-500 hover:text-gold-400 hover:bg-gold-500/10 transition-colors"
                    title="更新"
                >
                    <RefreshCw className={cn("w-3 h-3", loading && "animate-spin text-gold-400")} />
                </button>
            </div>
        </div>
    );

    const chartBody = (
        <div className="flex flex-col h-full overflow-hidden">
            {controls}
            {isStable && (
                <div className="mx-2 mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-[10px] font-mono">
                    ⚠️ ステーブルコイン同士のペアは価格変動がほぼありません（常に約$1.00）
                </div>
            )}
            {error && (
                <div className="mx-2 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-[10px] font-mono">
                    {error}
                </div>
            )}
            <div
                ref={chartContainerRef}
                className="w-full flex-1 min-h-[200px] relative"
            >
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-10 rounded-lg">
                        <div className="flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 text-gold-400 animate-spin" />
                            <span className="text-gray-400 text-xs font-mono">OHLCVデータを取得中...</span>
                        </div>
                    </div>
                )}
            </div>
            <div className="flex justify-between items-center px-3 py-1.5 border-t border-white/5">
                <div className="flex gap-4">
                    <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-[10px] text-gray-400 font-mono">LIVE OHLCV</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-[10px] text-gray-400 font-mono">EMA(14)</span>
                    </div>
                </div>
                <div className="text-[10px] text-gray-600 font-mono">CoinCap</div>
            </div>
        </div>
    );

    if (headless) return chartBody;

    return (
        <div className="bg-[#0d1117] rounded-xl border border-gold-500/10 h-full overflow-hidden">
            <div className="px-4 py-3 border-b border-gold-500/10 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                    {selectedPair.label} <span className="text-gray-500 text-xs font-mono">ターミナル・チャート</span>
                </h3>
            </div>
            <div className="h-[calc(100%-52px)]">
                {chartBody}
            </div>
        </div>
    );
}
