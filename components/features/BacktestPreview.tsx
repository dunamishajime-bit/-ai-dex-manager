"use client";

import { useEffect, useRef, useState } from "react";
import { AreaChart, Area, Tooltip, CartesianGrid, XAxis, YAxis } from "recharts";
import type { Formatter, NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { Play, Pause, Download, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BacktestResult {
    pair: string;
    action: "BUY" | "SELL";
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    duration: string;
    chartData: { time: string; price: number; signal?: string }[];
}

interface Props {
    result: BacktestResult;
}

type ChartSize = { width: number; height: number };

const formatBacktestPriceTooltip: Formatter<ValueType, NameType> = (value) => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);

    return [`¥${Number.isFinite(numericValue) ? numericValue.toLocaleString("ja-JP") : "0"}`, "価格"];
};

function useChartSize(ref: React.RefObject<HTMLDivElement>, minimumHeight: number) {
    const [size, setSize] = useState<ChartSize>({ width: 0, height: minimumHeight });

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        const update = () => {
            setSize({
                width: Math.max(node.clientWidth, 260),
                height: Math.max(node.clientHeight, minimumHeight),
            });
        };

        update();
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(node);

        return () => resizeObserver.disconnect();
    }, [minimumHeight, ref]);

    return size;
}

export function BacktestPreview({ result }: Props) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentData, setCurrentData] = useState<typeof result.chartData>([]);
    const chartHostRef = useRef<HTMLDivElement>(null);
    const chartSize = useChartSize(chartHostRef, 120);

    useEffect(() => {
        if (isPlaying && progress < result.chartData.length) {
            const timer = setTimeout(() => {
                setProgress((prev) => prev + 1);
                setCurrentData(result.chartData.slice(0, progress + 1));
            }, 100);
            return () => clearTimeout(timer);
        }

        if (progress >= result.chartData.length) {
            setIsPlaying(false);
        }
    }, [isPlaying, progress, result.chartData]);

    const handlePlay = () => {
        if (progress >= result.chartData.length) {
            setProgress(0);
            setCurrentData([]);
        }
        setIsPlaying(true);
    };

    const canRenderChart = chartSize.width > 0 && chartSize.height > 0;

    return (
        <div className="space-y-3 rounded-lg border border-gold-500/10 bg-black/40 p-3">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gold-400">バックテストレビュー</h4>
                <div className="flex items-center gap-1">
                    <button onClick={() => {}} className="p-1 text-gray-500 transition-colors hover:text-gold-400">
                        <Download className="h-3 w-3" />
                    </button>
                    <button onClick={() => {}} className="p-1 text-gray-500 transition-colors hover:text-gold-400">
                        <Share2 className="h-3 w-3" />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
                <div className="rounded bg-white/5 p-2 text-center">
                    <div className="text-[10px] text-gray-500">損益</div>
                    <div className={cn("text-sm font-bold font-mono", result.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {result.pnl >= 0 ? "+" : ""}¥{result.pnl.toLocaleString("ja-JP")}
                    </div>
                </div>
                <div className="rounded bg-white/5 p-2 text-center">
                    <div className="text-[10px] text-gray-500">騰落率</div>
                    <div className={cn("text-sm font-bold font-mono", result.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {result.pnlPercent >= 0 ? "+" : ""}{result.pnlPercent.toFixed(1)}%
                    </div>
                </div>
                <div className="rounded bg-white/5 p-2 text-center">
                    <div className="text-[10px] text-gray-500">保有時間</div>
                    <div className="text-sm font-bold font-mono text-white">{result.duration}</div>
                </div>
            </div>

            <div ref={chartHostRef} className="h-[120px] min-h-[120px]">
                {canRenderChart ? (
                    <AreaChart width={chartSize.width} height={chartSize.height} data={isPlaying || progress > 0 ? currentData : result.chartData}>
                        <defs>
                            <linearGradient id="backtestGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={result.pnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={result.pnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" tick={{ fontSize: 8, fill: "#6b7280" }} tickLine={false} />
                        <YAxis tick={{ fontSize: 8, fill: "#6b7280" }} tickLine={false} domain={["auto", "auto"]} />
                        <Tooltip
                            contentStyle={{ backgroundColor: "#0d1117", borderColor: "#B8860B", borderRadius: "6px", fontSize: "10px" }}
                            formatter={formatBacktestPriceTooltip}
                        />
                        <Area
                            type="monotone"
                            dataKey="price"
                            stroke={result.pnl >= 0 ? "#10b981" : "#ef4444"}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#backtestGrad)"
                        />
                    </AreaChart>
                ) : (
                    <div className="flex h-full items-center justify-center text-xs text-gray-500">チャートを読み込み中...</div>
                )}
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={isPlaying ? () => setIsPlaying(false) : handlePlay}
                    className="rounded border border-gold-500/30 bg-gold-500/10 p-1.5 text-gold-400 transition-colors hover:bg-gold-500/20"
                >
                    {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </button>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-800">
                    <div
                        className="h-full bg-gold-500 transition-all"
                        style={{ width: `${(progress / Math.max(1, result.chartData.length)) * 100}%` }}
                    />
                </div>
                <span className="font-mono text-[10px] text-gray-500">
                    {progress}/{result.chartData.length}
                </span>
            </div>
        </div>
    );
}
