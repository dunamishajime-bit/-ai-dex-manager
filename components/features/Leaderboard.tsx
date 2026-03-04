"use client";

import { useSimulation } from "@/context/SimulationContext";

export function Leaderboard() {
    const { leaderboard } = useSimulation();

    if (!leaderboard.length) {
        return null;
    }

    return (
        <div className="rounded-xl border border-gold-500/10 bg-cyber-darker/60 p-5 backdrop-blur-xl">
            <div className="mb-3">
                <h2 className="text-lg font-bold text-white">Global Leaderboard</h2>
                <p className="text-[10px] uppercase tracking-widest text-gray-500">Copy Trade Ranking</p>
            </div>
            <div className="space-y-3">
                {leaderboard.map((user) => {
                    const dailyProfit = Number.isFinite(user.dailyProfit) ? user.dailyProfit : 0;
                    const dailyChange = Number.isFinite(user.dailyChange) ? user.dailyChange : 0;

                    return (
                        <div key={`${user.rank}-${user.name}`} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-4 py-3">
                            <div>
                                <div className="text-sm font-bold text-white">#{user.rank} {user.name}</div>
                                <div className="text-[10px] text-gray-500">Daily PnL {dailyProfit.toLocaleString("ja-JP")}</div>
                            </div>
                            <div className={`text-sm font-bold ${dailyChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {dailyChange >= 0 ? "+" : ""}{dailyChange.toFixed(2)}%
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
