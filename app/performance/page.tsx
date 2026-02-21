"use client";

import { Dashboard } from "@/components/features/Dashboard";
import { TransactionList } from "@/components/features/TransactionList";
import { Card } from "@/components/ui/Card";
import { useSimulation } from "@/context/SimulationContext";
import { TrendingUp, Activity, BarChart3 } from "lucide-react";

export default function PerformancePage() {
    const { portfolio, transactions } = useSimulation();

    const monthlyReturn = 12.5;
    const winRate = transactions.length > 0
        ? (transactions.filter(t => t.type === "SELL" && t.price > 0).length / transactions.filter(t => t.type === "SELL").length * 100) || 0
        : 65;

    return (
        <div className="p-6 space-y-6">
            {/* Key Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="月次リターン" glow="secondary">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-full bg-gold-500/20 text-gold-500">
                            <TrendingUp className="w-8 h-8" />
                        </div>
                        <div>
                            <div className="text-3xl font-bold font-mono text-neon-green">+{monthlyReturn}%</div>
                            <div className="text-xs text-gray-400">vs 前月比 +2.4%</div>
                        </div>
                    </div>
                </Card>
                <Card title="勝率 (AI予測)" glow="secondary">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-full bg-neon-blue/20 text-neon-blue">
                            <Activity className="w-8 h-8" />
                        </div>
                        <div>
                            <div className="text-3xl font-bold font-mono text-white">{winRate.toFixed(1)}%</div>
                            <div className="text-xs text-gray-400">直近50トレード</div>
                        </div>
                    </div>
                </Card>
                <Card title="総取引数" glow="secondary">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-full bg-neon-purple/20 text-neon-purple">
                            <BarChart3 className="w-8 h-8" />
                        </div>
                        <div>
                            <div className="text-3xl font-bold font-mono text-white">{transactions.length}</div>
                            <div className="text-xs text-gray-400">24時間以内</div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Detailed Views */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <span className="w-1 h-6 bg-gold-500 rounded-full" />
                        資産推移 &amp; ポートフォリオ
                    </h2>
                    <Dashboard />
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <span className="w-1 h-6 bg-neon-green rounded-full" />
                        取引履歴
                    </h2>
                    <TransactionList />
                </div>
            </div>
        </div>
    );
}
