"use client";

import { useState, useEffect } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, CartesianGrid, XAxis, YAxis } from "recharts";
import { Play, Pause, SkipForward, Download, Share2 } from "lucide-react";
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

export function BacktestPreview({ result }: Props) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentData, setCurrentData] = useState<typeof result.chartData>([]);

    useEffect(() => {
        if (isPlaying && progress < result.chartData.length) {
            const timer = setTimeout(() => {
                setProgress(prev => prev + 1);
                setCurrentData(result.chartData.slice(0, progress + 1));
            }, 100);
            return () => clearTimeout(timer);
        } else if (progress >= result.chartData.length) {
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

    return (
        <div className="bg-black/40 rounded-lg border border-gold-500/10 p-3 space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-gold-400">📈 バックテストプレビュー</h4>
                <div className="flex items-center gap-1">
                    <button onClick={() => { }} className="p-1 text-gray-500 hover:text-gold-400 transition-colors">
                        <Download className="w-3 h-3" />
                    </button>
                    <button onClick={() => { }} className="p-1 text-gray-500 hover:text-gold-400 transition-colors">
                        <Share2 className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 bg-white/5 rounded">
                    <div className="text-[10px] text-gray-500">損益</div>
                    <div className={cn("text-sm font-bold font-mono", result.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {result.pnl >= 0 ? "+" : ""}¥{result.pnl.toLocaleString("ja-JP")}
                    </div>
                </div>
                <div className="text-center p-2 bg-white/5 rounded">
                    <div className="text-[10px] text-gray-500">変動率</div>
                    <div className={cn("text-sm font-bold font-mono", result.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {result.pnlPercent >= 0 ? "+" : ""}{result.pnlPercent.toFixed(1)}%
                    </div>
                </div>
                <div className="text-center p-2 bg-white/5 rounded">
                    <div className="text-[10px] text-gray-500">期間</div>
                    <div className="text-sm font-bold text-white font-mono">{result.duration}</div>
                </div>
            </div>

            {/* Chart */}
            <div className="h-[120px]">
                <ResponsiveContainer width="100%" height={220} minWidth={240} minHeight={180}>
                    <AreaChart data={isPlaying || progress > 0 ? currentData : result.chartData}>
                        <defs>
                            <linearGradient id="backtestGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={result.pnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={result.pnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" tick={{ fontSize: 8, fill: "#6b7280" }} tickLine={false} />
                        <YAxis tick={{ fontSize: 8, fill: "#6b7280" }} tickLine={false} domain={['auto', 'auto']} />
                        <Tooltip
                            contentStyle={{ backgroundColor: "#0d1117", borderColor: "#B8860B", borderRadius: "6px", fontSize: "10px" }}
                            formatter={(value: any) => [`¥${Number(value).toLocaleString("ja-JP")}`, "価格"]}
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
                </ResponsiveContainer>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
                <button
                    onClick={isPlaying ? () => setIsPlaying(false) : handlePlay}
                    className="p-1.5 bg-gold-500/10 text-gold-400 border border-gold-500/30 rounded hover:bg-gold-500/20 transition-colors"
                >
                    {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gold-500 transition-all"
                        style={{ width: `${(progress / Math.max(1, result.chartData.length)) * 100}%` }}
                    />
                </div>
                <span className="text-[10px] text-gray-500 font-mono">
                    {progress}/{result.chartData.length}
                </span>
            </div>
        </div>
    );
}
