"use client";

import { useState } from "react";
import { useSimulation } from "@/context/SimulationContext";
import { Card } from "@/components/ui/Card";
import { Trophy, Medal, User, Clock, BarChart3, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function Leaderboard() {
    const { leaderboard, nickname, setDemoStrategy, setRiskTolerance, addMessage } = useSimulation();
    const [viewMode, setViewMode] = useState<"TOTAL" | "DAILY">("TOTAL");

    const handleCopy = (rank: number, name: string) => {
        // Mock logic: Rank 1=Aggressive, Rank 2=Moderate, Rank 3=Conservative
        const strategies = ["AGGRESSIVE", "MODERATE", "CONSERVATIVE"];
        const strategy = strategies[(rank - 1) % 3] as any;

        setDemoStrategy(strategy);
        setRiskTolerance(rank === 1 ? 85 : rank === 2 ? 50 : 25);

        addMessage("manager", `✅ 設定コピー完了: ${name} (Rank ${rank}) の戦略 [${strategy}] を適用しました。`, "SYSTEM");
    };

    return (
        <Card title="グローバル・リーダーボード" glow="gold" className="h-full">
            {/* View Toggle */}
            <div className="flex p-1 mt-4 mb-4 bg-white/5 border border-white/10 rounded-xl">
                <button
                    onClick={() => setViewMode("TOTAL")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all",
                        viewMode === "TOTAL"
                            ? "bg-gold-500/20 text-gold-400 shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                            : "text-gray-500 hover:text-gray-300"
                    )}
                >
                    <BarChart3 className="w-3 h-3" />
                    累計損益
                </button>
                <button
                    onClick={() => setViewMode("DAILY")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all",
                        viewMode === "DAILY"
                            ? "bg-gold-500/20 text-gold-400 shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                            : "text-gray-500 hover:text-gray-300"
                    )}
                >
                    <Clock className="w-3 h-3" />
                    当日損益
                </button>
            </div>

            <div className="space-y-3">
                {leaderboard.map((user, idx) => {
                    const isMe = user.name === "Anonymous" || user.name === nickname;
                    const value = viewMode === "TOTAL" ? user.score : user.dailyProfit;
                    const change = user.dailyChange;
                    const isPositive = value >= 0;

                    return (
                        <div
                            key={idx}
                            className={cn(
                                "flex items-center justify-between p-3 rounded-xl border backdrop-blur-md transition-all",
                                isMe
                                    ? "bg-gold-500/20 border-gold-500/50 shadow-[0_0_15px_rgba(255,215,0,0.2)]"
                                    : "bg-white/5 border-white/5 hover:bg-white/10"
                            )}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-8 h-8 flex items-center justify-center font-black text-sm">
                                    {user.rank === 1 ? <Trophy className="w-5 h-5 text-gold-400" /> :
                                        user.rank === 2 ? <Medal className="w-5 h-5 text-gray-300" /> :
                                            user.rank === 3 ? <Medal className="w-5 h-5 text-amber-600" /> :
                                                <span className="text-gray-500">{user.rank}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center border border-white/10">
                                        <User className="w-4 h-4 text-gray-400" />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-white leading-tight">{user.name} {isMe && "(あなた)"}</div>
                                        <div className="text-[10px] text-gray-500">AI DEX MANAGER</div>
                                    </div>
                                </div>
                            </div>

                            {!isMe && (
                                <div className="hidden md:flex items-center gap-2 mx-4">
                                    <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded border border-white/5">
                                        {(user.rank - 1) % 3 === 0 ? "Aggressive" : (user.rank - 1) % 3 === 1 ? "Moderate" : "Conservative"}
                                    </span>
                                    <button
                                        onClick={() => handleCopy(user.rank, user.name)}
                                        className="flex items-center gap-1 px-2 py-1 rounded bg-gold-500/10 hover:bg-gold-500/20 text-gold-500 border border-gold-500/30 transition-colors"
                                        title="Copy Strategy"
                                    >
                                        <Copy className="w-3 h-3" />
                                        <span className="text-[10px]">Copy</span>
                                    </button>
                                </div>
                            )}

                            <div className="text-right">
                                <div className={cn(
                                    "text-sm font-mono font-bold",
                                    viewMode === "DAILY"
                                        ? (isPositive ? "text-emerald-400" : "text-rose-400")
                                        : "text-gold-400"
                                )}>
                                    {isPositive ? "+" : ""}¥{value.toLocaleString()}
                                </div>
                                {viewMode === "DAILY" ? (
                                    <div className={cn(
                                        "text-[10px] font-bold",
                                        isPositive ? "text-emerald-500" : "text-rose-500"
                                    )}>
                                        {isPositive ? "▲" : "▼"}{Math.abs(change)}%
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-gray-500 uppercase">Total Profit</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-6 p-4 rounded-xl bg-black/40 border border-white/5 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">あなたの現在の順位</p>
                <div className="text-xl font-bold text-white">圏外</div>
                <p className="text-[9px] text-emerald-400 mt-1">次のランクアップまであと ¥80,000</p>
            </div>
        </Card>
    );
}
