import React, { useMemo } from "react";
import { useSimulation } from "@/context/SimulationContext";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import { Card } from "@/components/ui/Card";
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react";

export function PerformanceAnalytics() {
    const { transactions } = useSimulation();

    // 1. Calculate Cumulative PnL Over Time
    const pnlData = useMemo(() => {
        let cumulative = 0;
        // Sort by timestamp
        const sorted = [...transactions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        return sorted.map(tx => {
            if (tx.type === "SELL" && tx.pnl) {
                cumulative += tx.pnl;
            }
            return {
                time: new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                pnl: cumulative,
                rawPnl: tx.pnl || 0
            };
        }).filter(d => d.rawPnl !== 0); // Only show realized PnL points
    }, [transactions]);

    // 2. Analyze Win Rate by Token
    const tokenStats = useMemo(() => {
        const stats: Record<string, { wins: number, total: number }> = {};
        transactions.filter(tx => tx.type === "SELL").forEach(tx => {
            if (!stats[tx.symbol]) stats[tx.symbol] = { wins: 0, total: 0 };
            stats[tx.symbol].total += 1;
            if ((tx.pnl || 0) > 0) stats[tx.symbol].wins += 1;
        });

        return Object.entries(stats).map(([symbol, data]) => ({
            symbol,
            winRate: (data.wins / data.total) * 100,
            total: data.total
        })).sort((a, b) => a.winRate - b.winRate); // Sort by Lowest Win Rate (Weakness) first
    }, [transactions]);

    const weakness = tokenStats.length > 0 ? tokenStats[0] : null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card title="累積損益推移" className="lg:col-span-2 h-[300px]">
                <div className="w-full h-full pt-4">
                    {pnlData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={pnlData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                                    formatter={(value: any) => [`¥${value.toLocaleString()}`, "累積損益"]}
                                />
                                <Line type="monotone" dataKey="pnl" stroke="#facc15" strokeWidth={2} dot={{ fill: '#facc15' }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                            決済されたトレードを待機中...
                        </div>
                    )}
                </div>
            </Card>

            <Card title="弱点分析" className="h-[300px]">
                <div className="flex flex-col h-full">
                    {weakness ? (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded flex items-start gap-2">
                            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                            <div>
                                <div className="text-sm font-bold text-red-400">改善エリア</div>
                                <p className="text-xs text-gray-300 mt-1">
                                    <span className="font-bold text-white">{weakness.symbol}</span> のパフォーマンスが低下しています。
                                    (勝率: {weakness.winRate.toFixed(1)}%)
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded flex items-start gap-2">
                            <TrendingUp className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                            <div>
                                <div className="text-sm font-bold text-green-400">素晴らしいパフォーマンスです</div>
                                <p className="text-xs text-gray-300 mt-1">現在、特に目立った弱点は検出されていません。</p>
                            </div>
                        </div>
                    )}

                    <div className="flex-1 w-full text-xs">
                        <h4 className="text-gray-400 mb-2 uppercase tracking-wider">トークン別勝率</h4>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={tokenStats} layout="vertical">
                                <XAxis type="number" domain={[0, 100]} hide />
                                <YAxis dataKey="symbol" type="category" width={40} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <Tooltip
                                    cursor={{ fill: 'transparent' }}
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                                    formatter={(value: any) => [`${parseFloat(value).toFixed(1)}%`, "勝率"]}
                                />
                                <Bar dataKey="winRate" barSize={15} radius={[0, 4, 4, 0]}>
                                    {tokenStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.winRate > 50 ? "#4ade80" : "#f87171"} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </Card>
        </div>
    );
}
