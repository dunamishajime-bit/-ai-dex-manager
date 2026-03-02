"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Award, Target, Zap, TrendingUp, ShieldCheck, Flame, Star, Activity } from "lucide-react";
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

export const INITIAL_ACHIEVEMENTS: Achievement[] = [
    { id: "first-trade", title: "初陣の証", description: "最初の自動トレードを実行する", icon: Zap, unlocked: false, rarity: "COMMON" },
    { id: "profit-100", title: "利益の芽", description: "累計利益 ¥100 を達成する", icon: TrendingUp, unlocked: false, rarity: "COMMON", progress: 0, target: 100 },
    { id: "trade-activity", title: "トレード活動家", description: "累計100トレードを実行する", icon: Activity, unlocked: false, rarity: "RARE", progress: 0, target: 100 },
    { id: "risk-setup-done", title: "自己分析の第一歩", description: "リスク許容度診断を完了する", icon: ShieldCheck, unlocked: false, rarity: "COMMON" },
    { id: "win-streak-3", title: "連勝街道", description: "3回連続でプラスの取引を完了する", icon: Flame, unlocked: false, rarity: "RARE", progress: 1, target: 3 },
    { id: "alpha-level-up", title: "技術の進化", description: "TechnicalエージェントをLv.5に上げる", icon: Star, unlocked: false, rarity: "RARE", progress: 2, target: 5 },
    { id: "market-watcher", title: "市場の監視者", description: "Market Watcherのアラートを受け取る", icon: Target, unlocked: false, rarity: "RARE" },
    { id: "whale-detect", title: "クジラ観測者", description: "クジラの動向を3回検知する", icon: Target, unlocked: false, rarity: "EPIC", progress: 1, target: 3 },
    { id: "security-master", title: "鉄壁の守護", description: "リスク警告後の暴落を回避する", icon: ShieldCheck, unlocked: false, rarity: "EPIC" },
    { id: "millionaire", title: "億り人への一歩", description: "ポートフォリオ残高 ¥30,000 を達成", icon: Trophy, unlocked: false, rarity: "LEGENDARY", progress: 0, target: 30000 },
];

export function AchievementHub() {
    const { achievements, disPoints } = useSimulation();
    const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null);
    // Track notified IDs to avoid re-notifying on mount
    const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set(achievements.filter(a => a.unlocked).map(a => a.id)));

    // Watch for new unlocks
    useEffect(() => {
        const currentUnlocked = achievements.filter(a => a.unlocked);
        currentUnlocked.forEach(a => {
            if (!notifiedIds.has(a.id)) {
                setToastAchievement(a);
                setNotifiedIds(prev => {
                    const newSet = new Set(prev);
                    newSet.add(a.id);
                    return newSet;
                });

                // Hide after 4s
                setTimeout(() => setToastAchievement(null), 4000);
            }
        });
    }, [achievements]);

    // Calculate level based on DIS Points (Simple logic: 100 points per level)
    const level = Math.floor(disPoints / 100) + 1;
    const nextLevelPoints = level * 100;
    const progress = ((disPoints % 100) / 100) * 100;

    const getRarityColor = (rarity: Achievement["rarity"]) => {
        switch (rarity) {
            case "COMMON": return "text-gray-400";
            case "RARE": return "text-emerald-400";
            case "EPIC": return "text-blue-400";
            case "LEGENDARY": return "text-gold-500 shadow-[0_0_10px_rgba(255,215,0,0.3)]";
        }
    };

    const getRarityBg = (rarity: Achievement["rarity"]) => {
        switch (rarity) {
            case "COMMON": return "bg-gray-500/10 border-gray-500/20";
            case "RARE": return "bg-emerald-500/10 border-emerald-500/20";
            case "EPIC": return "bg-blue-500/10 border-blue-500/20";
            case "LEGENDARY": return "bg-gold-500/10 border-gold-500/30";
        }
    };

    return (
        <div className="bg-cyber-darker/60 backdrop-blur-xl border border-gold-500/10 rounded-xl p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gold-500/20 rounded-lg">
                        <Trophy className="w-5 h-5 text-gold-500" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white tracking-wider">実績ギャラリー</h2>
                        <p className="text-[10px] text-gray-500 font-mono tracking-widest uppercase">Trading Achievements</p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-xl font-black text-gold-500">
                        {achievements.filter(a => a.unlocked).length} / {achievements.length}
                    </div>
                    <div className="text-[10px] text-gray-600 font-mono uppercase">Unlocked</div>
                </div>
            </div>

            {/* DIS Points / Level Progress */}
            <div className="mb-6 bg-black/30 rounded-lg p-3 border border-gray-800">
                <div className="flex justify-between items-end mb-2">
                    <span className="text-xs text-blue-400 font-bold">DIS POINTS: {disPoints}</span>
                    <span className="text-[10px] text-gray-500">LEVEL {level}</span>
                </div>
                <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all duration-500"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="text-[9px] text-right text-gray-600 mt-1">NEXT LEVEL: {nextLevelPoints} PTS</div>
            </div>

            <div className="grid grid-cols-2 gap-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                {achievements.map((item) => (
                    <div
                        key={item.id}
                        className={cn(
                            "relative border rounded-lg p-3 transition-all group overflow-hidden",
                            item.unlocked ? getRarityBg(item.rarity) : "bg-black/20 border-white/5 grayscale"
                        )}
                    >
                        {!item.unlocked && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 backdrop-blur-[1px]">
                                <span className="text-[8px] text-white/60 font-mono tracking-widest uppercase">Locked</span>
                            </div>
                        )}

                        <div className="flex items-start gap-3">
                            <div className={cn("p-2 rounded-lg bg-black/40", item.unlocked ? getRarityColor(item.rarity) : "text-gray-600")}>
                                <item.icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className={cn("text-xs font-bold truncate", item.unlocked ? "text-white" : "text-gray-600")}>
                                    {item.title}
                                </div>
                                <div className="text-[8px] text-gray-500 leading-tight mt-1 line-clamp-2">
                                    {item.description}
                                </div>

                                {item.target && (
                                    <div className="mt-2 h-1 w-full bg-black/40 rounded-full overflow-hidden">
                                        <div
                                            className={cn("h-full transition-all duration-500", item.unlocked ? "bg-gold-500" : "bg-gray-700")}
                                            style={{ width: `${Math.min(100, ((item.progress || 0) / item.target) * 100)}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Rarity Tag */}
                        <div className={cn("absolute top-1 right-2 text-[6px] font-black tracking-widest opacity-30", getRarityColor(item.rarity))}>
                            {item.rarity}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 pt-4 border-t border-gold-500/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Award className="w-3 h-3 text-gold-500/50" />
                    <span className="text-[9px] text-gray-500 font-mono">COLLECTOR LEVEL: {level}</span>
                </div>
                <button className="text-[9px] text-gold-500 hover:text-white transition-colors uppercase font-black tracking-widest">
                    View All Rewards
                </button>
            </div>

            {/* Toast Notification */}
            <AnimatePresence>
                {toastAchievement && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, scale: 0.8 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.8 }}
                        className="absolute bottom-6 left-6 right-6 md:left-1/2 md:-translate-x-1/2 md:right-auto md:w-auto bg-gradient-to-r from-gold-600 to-gold-400 text-black px-4 py-3 rounded-lg shadow-[0_0_20px_rgba(255,215,0,0.4)] flex items-center gap-3 z-50 pointer-events-none"
                    >
                        <div className="p-2 bg-black/10 rounded-full shrink-0">
                            <Trophy className="w-5 h-5 text-black" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[9px] font-bold uppercase tracking-widest text-black/70">Achievement Unlocked</div>
                            <div className="text-sm font-black truncate">{toastAchievement.title}</div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
