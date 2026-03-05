"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,
    Bar,
    Cell,
} from "recharts";
import { TrendingUp, AlertCircle } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";
import { Card } from "@/components/ui/Card";

type ChartSize = { width: number; height: number };

function useChartSize(ref: React.RefObject<HTMLDivElement>, minimumHeight: number) {
    const [size, setSize] = useState<ChartSize>({ width: 0, height: minimumHeight });

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        const update = () => {
            setSize({
                width: Math.max(node.clientWidth, 280),
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

export function PerformanceAnalytics() {
    const { transactions, convertJPY } = useSimulation();
    const pnlChartHostRef = useRef<HTMLDivElement>(null);
    const tokenChartHostRef = useRef<HTMLDivElement>(null);
    const pnlChartSize = useChartSize(pnlChartHostRef, 210);
    const tokenChartSize = useChartSize(tokenChartHostRef, 150);

    const pnlData = useMemo(() => {
        let cumulativeUsd = 0;
        const sorted = [...transactions].sort(
            (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
        );

        return sorted
            .map((tx) => {
                if (tx.type === "SELL" && tx.pnl) {
                    cumulativeUsd += tx.pnl;
                }

                return {
                    time: new Date(tx.timestamp).toLocaleTimeString("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit",
                    }),
                    pnlJpy: convertJPY(cumulativeUsd),
                    rawPnl: tx.pnl || 0,
                };
            })
            .filter((point) => point.rawPnl !== 0);
    }, [convertJPY, transactions]);

    const tokenStats = useMemo(() => {
        const stats: Record<string, { wins: number; total: number }> = {};

        transactions
            .filter((tx) => tx.type === "SELL")
            .forEach((tx) => {
                if (!stats[tx.symbol]) {
                    stats[tx.symbol] = { wins: 0, total: 0 };
                }

                stats[tx.symbol].total += 1;
                if ((tx.pnl || 0) > 0) {
                    stats[tx.symbol].wins += 1;
                }
            });

        return Object.entries(stats)
            .map(([symbol, data]) => ({
                symbol,
                winRate: (data.wins / data.total) * 100,
                total: data.total,
            }))
            .sort((left, right) => left.winRate - right.winRate);
    }, [transactions]);

    const weakestToken = tokenStats.length > 0 ? tokenStats[0] : null;
    const canRenderPnlChart = pnlData.length > 0 && pnlChartSize.width > 0 && pnlChartSize.height > 0;
    const canRenderTokenChart = tokenStats.length > 0 && tokenChartSize.width > 0 && tokenChartSize.height > 0;

    return (
        <div className="grid h-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="パフォーマンストレンド" className="h-full min-h-0">
                <div ref={pnlChartHostRef} className="h-[230px] w-full pt-2">
                    {canRenderPnlChart ? (
                        <LineChart width={pnlChartSize.width} height={pnlChartSize.height} data={pnlData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                            <YAxis
                                stroke="#94a3b8"
                                fontSize={12}
                                tickFormatter={(value: number) => `¥${Math.round(value).toLocaleString("ja-JP")}`}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                                formatter={(value: number | string | undefined) => [
                                    `¥${Math.round(Number(value || 0)).toLocaleString("ja-JP")}`,
                                    "累積損益",
                                ]}
                            />
                            <Line
                                type="monotone"
                                dataKey="pnlJpy"
                                stroke="#facc15"
                                strokeWidth={2}
                                dot={{ fill: "#facc15" }}
                            />
                        </LineChart>
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm text-gray-500">
                            {pnlData.length > 0 ? "チャートを読み込み中..." : "まだ損益データがありません"}
                        </div>
                    )}
                </div>
            </Card>

            <Card title="弱点分析" className="h-full min-h-0">
                <div className="flex h-full flex-col">
                    {weakestToken ? (
                        <div className="mb-3 flex items-start gap-2 rounded border border-red-500/20 bg-red-500/10 p-3">
                            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                            <div>
                                <div className="text-sm font-bold text-red-400">勝率が最も低い銘柄</div>
                                <p className="mt-1 text-xs text-gray-300">
                                    <span className="font-bold text-white">{weakestToken.symbol}</span>
                                    {" は現在の弱点です。勝率 "}
                                    {weakestToken.winRate.toFixed(1)}
                                    {"% / 決済回数 "}
                                    {weakestToken.total}
                                    {" 回"}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="mb-3 flex items-start gap-2 rounded border border-green-500/20 bg-green-500/10 p-3">
                            <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
                            <div>
                                <div className="text-sm font-bold text-green-400">弱点銘柄はまだありません</div>
                                <p className="mt-1 text-xs text-gray-300">
                                    決済トレードが増えると、勝率の低い銘柄が表示されます。
                                </p>
                            </div>
                        </div>
                    )}

                    <div ref={tokenChartHostRef} className="h-[170px] w-full text-xs">
                        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Token Win Rate</h4>
                        {canRenderTokenChart ? (
                            <BarChart width={tokenChartSize.width} height={tokenChartSize.height} data={tokenStats} layout="vertical">
                                <XAxis type="number" domain={[0, 100]} hide />
                                <YAxis dataKey="symbol" type="category" width={48} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                                <Tooltip
                                    cursor={{ fill: "transparent" }}
                                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                                    formatter={(value: number | string | undefined) => [`${Number(value || 0).toFixed(1)}%`, "勝率"]}
                                />
                                <Bar dataKey="winRate" barSize={14} radius={[0, 4, 4, 0]}>
                                    {tokenStats.map((entry, index) => (
                                        <Cell key={`token-${index}`} fill={entry.winRate > 50 ? "#4ade80" : "#f87171"} />
                                    ))}
                                </Bar>
                            </BarChart>
                        ) : (
                            <div className="flex h-full items-center justify-center text-gray-500">
                                {tokenStats.length > 0 ? "チャートを読み込み中..." : "勝率データがまだありません"}
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}
