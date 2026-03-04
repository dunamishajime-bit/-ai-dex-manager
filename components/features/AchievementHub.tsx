"use client";

import { useEffect, useState } from "react";
import { Trophy, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSimulation } from "@/context/SimulationContext";

export interface Achievement {
    id: string;
    title: string;
    description: string;
    icon: any;
    unlocked: boolean;
    rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
    progress?: number;
    target?: number;
}

export function AchievementHub() {
    const { achievements, disPoints } = useSimulation();
    const [recentUnlock, setRecentUnlock] = useState<Achievement | null>(null);
    const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        const unlocked = achievements.find((achievement) => achievement.unlocked && !seenIds.has(achievement.id));
        if (!unlocked) return;

        setRecentUnlock(unlocked);
        setSeenIds((prev) => new Set(prev).add(unlocked.id));
        const timer = setTimeout(() => setRecentUnlock(null), 3500);
        return () => clearTimeout(timer);
    }, [achievements, seenIds]);

    const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
    const level = Math.max(1, Math.floor(disPoints / 100) + 1);
    const progress = disPoints % 100;

    return (
        <div className="relative h-full rounded-xl border border-gold-500/10 bg-cyber-darker/60 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-gold-500/15 p-2">
                        <Trophy className="h-5 w-5 text-gold-500" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white">実績ギャラリー</h2>
                        <p className="text-[10px] uppercase tracking-widest text-gray-500">Achievement Gallery</p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-xl font-black text-gold-500">{unlockedCount}/{achievements.length}</div>
                    <div className="text-[10px] uppercase tracking-widest text-gray-600">Unlocked</div>
                </div>
            </div>

            <div className="mb-5 rounded-lg border border-white/5 bg-black/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-400">DIS POINTS: {disPoints}</span>
                    <span className="text-[10px] text-gray-500">LEVEL {level}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                    <div
                        className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="mt-1 text-right text-[9px] text-gray-600">Next level in {100 - progress} pt</div>
            </div>

            <div className="grid h-[calc(100%-170px)] grid-cols-2 gap-3 overflow-y-auto pr-1 custom-scrollbar">
                {achievements.map((achievement) => (
                    <div
                        key={achievement.id}
                        className={cn(
                            "rounded-lg border p-3 transition-all",
                            achievement.unlocked
                                ? "border-gold-500/20 bg-gold-500/5"
                                : "border-white/5 bg-black/20 opacity-70"
                        )}
                    >
                        <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <div className="rounded-lg bg-black/30 p-2">
                                    <achievement.icon className="h-4 w-4 text-gold-400" />
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-white">{achievement.title}</div>
                                    <div className="text-[9px] uppercase tracking-widest text-gray-500">{achievement.rarity}</div>
                                </div>
                            </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-gray-400">{achievement.description}</p>
                        {achievement.target ? (
                            <div className="mt-3">
                                <div className="mb-1 flex items-center justify-between text-[9px] text-gray-500">
                                    <span>Progress</span>
                                    <span>{achievement.progress || 0} / {achievement.target}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
                                    <div
                                        className="h-full bg-gold-500 transition-all duration-500"
                                        style={{ width: `${Math.min(100, ((achievement.progress || 0) / achievement.target) * 100)}%` }}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-gold-500/10 pt-3">
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <Award className="h-3 w-3 text-gold-500/60" />
                    <span>1 trade = +1 / take profit = +5 / stop loss = -3</span>
                </div>
            </div>

            {recentUnlock ? (
                <div className="pointer-events-none absolute bottom-5 left-5 right-5 rounded-lg bg-gradient-to-r from-gold-500 to-amber-300 px-4 py-3 text-black shadow-[0_0_20px_rgba(255,215,0,0.35)]">
                    <div className="text-[10px] font-black uppercase tracking-widest text-black/70">Achievement Unlocked</div>
                    <div className="text-sm font-black">{recentUnlock.title}</div>
                </div>
            ) : null}
        </div>
    );
}
