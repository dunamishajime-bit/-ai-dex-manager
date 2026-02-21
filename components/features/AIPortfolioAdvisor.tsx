"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Coins, TrendingUp, ShieldCheck, PieChart, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface PortfolioItem {
    token: string;
    percentage: number;
    reason: string;
    risk: "LOW" | "MEDIUM" | "HIGH";
}

export function AIPortfolioAdvisor({ balance }: { balance: number }) {
    const [advice, setAdvice] = useState<PortfolioItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // AIによる擬似ポートフォリオ生成 (将来的にGemini APIと連携)
        const timer = setTimeout(() => {
            setAdvice([
                { token: "BTC", percentage: 50, reason: "安定した資産価値保存の要です。", risk: "LOW" },
                { token: "ETH", percentage: 30, reason: "エコシステムの成長による上昇余地が高いです。", risk: "MEDIUM" },
                { token: "SOL", percentage: 20, reason: "高いトランザクション性能と勢いがあります。", risk: "HIGH" },
            ]);
            setIsLoading(false);
        }, 1500);
        return () => clearTimeout(timer);
    }, []);

    return (
        <Card title="AIポートフォリオ・アドバイザー" glow="primary" className="p-5">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-gold-500/20 rounded-lg">
                    <PieChart className="w-5 h-5 text-gold-400" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-white">初心者向け：推奨配分</h3>
                    <p className="text-[10px] text-gray-500">あなたの現在の資産額：¥{balance.toLocaleString()}</p>
                </div>
            </div>

            {isLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-4">
                    <motion.div
                        className="w-10 h-10 border-2 border-gold-500/30 border-t-gold-500 rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                    <p className="text-xs text-gold-500/70 animate-pulse">市場データを多角的に分析中...</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {advice.map((item, idx) => (
                        <motion.div
                            key={item.token}
                            initial={{ x: -20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: idx * 0.1 }}
                            className="bg-white/5 border border-white/10 rounded-xl p-3 hover:bg-white/10 transition-colors"
                        >
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg font-black text-white">{item.token}</span>
                                    <span className={cn(
                                        "text-[9px] px-1.5 py-0.5 rounded font-bold border",
                                        item.risk === "LOW" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                            item.risk === "MEDIUM" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                                                "bg-red-500/10 text-red-400 border-red-500/20"
                                    )}>
                                        {item.risk}
                                    </span>
                                </div>
                                <div className="text-xl font-mono font-bold text-gold-400">{item.percentage}%</div>
                            </div>

                            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mb-3">
                                <motion.div
                                    className="bg-gold-500 h-full"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${item.percentage}%` }}
                                    transition={{ duration: 1, delay: idx * 0.1 }}
                                />
                            </div>

                            <p className="text-[11px] text-gray-400 leading-relaxed italic border-l-2 border-gold-500/30 pl-2">
                                {item.reason}
                            </p>
                        </motion.div>
                    ))}

                    <button className="w-full py-3 mt-4 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-lg transition-all flex items-center justify-center gap-2 text-sm shadow-[0_0_15px_rgba(255,215,0,0.2)]">
                        <ArrowUpRight className="w-4 h-4" /> この配分でポートフォリオを構築
                    </button>
                    <p className="text-[9px] text-center text-gray-600">※これらはAIによる提案であり、最終的な判断はご自身で行ってください。</p>
                </div>
            )}
        </Card>
    );
}
