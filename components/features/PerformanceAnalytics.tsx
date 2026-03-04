import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSimulation } from "@/context/SimulationContext";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { TrendingUp, AlertCircle } from "lucide-react";

export function PerformanceAnalytics() {
    const { transactions } = useSimulation();
    const [chartsReady, setChartsReady] = useState(false);
    const pnlChartHostRef = useRef<HTMLDivElement>(null);
    const tokenChartHostRef = useRef<HTMLDivElement>(null);
    const [pnlChartHostReady, setPnlChartHostReady] = useState(false);
    const [tokenChartHostReady, setTokenChartHostReady] = useState(false);

    useEffect(() => {
        setChartsReady(true);
    }, []);

    useEffect(() => {
        const node = pnlChartHostRef.current;
        if (!node) return;

        const update = () => {
            setPnlChartHostReady(node.clientWidth > 0 && node.clientHeight > 0);
        };

        update();

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(node);

        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        const node = tokenChartHostRef.current;
        if (!node) return;

        const update = () => {
            setTokenChartHostReady(node.clientWidth > 0 && node.clientHeight > 0);
        };

        update();

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(node);

        return () => resizeObserver.disconnect();
    }, []);

    const pnlData = useMemo(() => {
        let cumulative = 0;
        const sorted = [...transactions].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        return sorted
            .map((tx) => {
                if (tx.type === "SELL" && tx.pnl) {
                    cumulative += tx.pnl;
                }

                return {
                    time: new Date(tx.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                    }),
                    pnl: cumulative,
                    rawPnl: tx.pnl || 0,
                };
            })
            .filter((point) => point.rawPnl !== 0);
    }, [transactions]);

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
            .sort((a, b) => a.winRate - b.winRate);
    }, [transactions]);

    const weakness = tokenStats.length > 0 ? tokenStats[0] : null;
    const canRenderPnlChart = chartsReady && pnlChartHostReady && pnlData.length > 0;
    const canRenderTokenStatsChart = chartsReady && tokenChartHostReady && tokenStats.length > 0;

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card title="Performance Trend" className="lg:col-span-2 h-[350px]">
                <div ref={pnlChartHostRef} className="h-[280px] w-full min-h-[280px] pt-4">
                    {canRenderPnlChart ? (
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
                            <LineChart data={pnlData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                                    formatter={(value: number | string | undefined) => [
                                        `¥${Number(value || 0).toLocaleString()}`,
                                        "Cumulative PnL",
                                    ]}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="pnl"
                                    stroke="#facc15"
                                    strokeWidth={2}
                                    dot={{ fill: "#facc15" }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                            <div className="flex h-full items-center justify-center text-sm text-gray-500">
                                {pnlData.length > 0 ? "Loading chart..." : "No realized PnL yet"}
                            </div>
                        )}
                    </div>
            </Card>

            <Card title="Weakness Analysis" className="h-[300px]">
                <div className="flex h-full flex-col">
                    {weakness ? (
                        <div className="mb-4 flex items-start gap-2 rounded border border-red-500/20 bg-red-500/10 p-3">
                            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                            <div>
                                <div className="text-sm font-bold text-red-400">Lowest win-rate token</div>
                                <p className="mt-1 text-xs text-gray-300">
                                    <span className="font-bold text-white">{weakness.symbol}</span>
                                    {" "}is currently the weakest performer
                                    {" "}({weakness.winRate.toFixed(1)}% win rate)
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="mb-4 flex items-start gap-2 rounded border border-green-500/20 bg-green-500/10 p-3">
                            <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
                            <div>
                                <div className="text-sm font-bold text-green-400">No weak token yet</div>
                                <p className="mt-1 text-xs text-gray-300">
                                    Token-level stats will appear after closed trades accumulate.
                                </p>
                            </div>
                        </div>
                    )}

                    <div ref={tokenChartHostRef} className="h-[150px] w-full flex-1 min-h-[150px] text-xs">
                        <h4 className="mb-2 uppercase tracking-wider text-gray-400">Token win rate</h4>
                        {canRenderTokenStatsChart ? (
                            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={120}>
                                <BarChart data={tokenStats} layout="vertical">
                                    <XAxis type="number" domain={[0, 100]} hide />
                                    <YAxis
                                        dataKey="symbol"
                                        type="category"
                                        width={40}
                                        tick={{ fill: "#94a3b8", fontSize: 10 }}
                                    />
                                    <Tooltip
                                        cursor={{ fill: "transparent" }}
                                        contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                                        formatter={(value: number | string | undefined) => [
                                            `${Number(value || 0).toFixed(1)}%`,
                                            "Win rate",
                                        ]}
                                    />
                                    <Bar dataKey="winRate" barSize={15} radius={[0, 4, 4, 0]}>
                                        {tokenStats.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.winRate > 50 ? "#4ade80" : "#f87171"}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex h-full items-center justify-center text-gray-500">
                                {tokenStats.length > 0 ? "Loading chart..." : "No token stats yet"}
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}
