"use client";

import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Target, RefreshCw, TrendingUp, AlertTriangle, Zap, DollarSign } from "lucide-react";
import { useCurrency } from "@/context/CurrencyContext";
import { useSimulation } from "@/context/SimulationContext";

interface PortfolioAllocation {
    symbol: string;
    name: string;
    coinId: string;
    allocation: number; // percentage 0-100
    rationale: string;
    riskLevel: "low" | "medium" | "high";
}

interface GoalPlan {
    monthlyReturnNeeded: number; // %
    allocations: PortfolioAllocation[];
    estimatedMonths: number;
    riskWarning: string;
    rebalanceInterval: string;
}

function computePlan(
    currentBalance: number,
    targetBalance: number,
    monthsToGoal: number,
    riskLevel: "conservative" | "balanced" | "aggressive"
): GoalPlan {
    const ratio = targetBalance / currentBalance;
    const monthlyReturnNeeded = (Math.pow(ratio, 1 / monthsToGoal) - 1) * 100;

    let allocations: PortfolioAllocation[];

    if (riskLevel === "conservative") {
        allocations = [
            { symbol: "BTC", name: "Bitcoin", coinId: "bitcoin", allocation: 60, rationale: "デジタルゴールド。最も安定した暗号資産として大型配分。", riskLevel: "low" },
            { symbol: "BNB", name: "BNB", coinId: "binancecoin", allocation: 40, rationale: "DEX手数料割引・エコシステム活用。主要インフラ。", riskLevel: "low" },
        ];
    } else if (riskLevel === "balanced") {
        allocations = [
            { symbol: "BTC", name: "Bitcoin", coinId: "bitcoin", allocation: 40, rationale: "ポートフォリオの安定核。", riskLevel: "low" },
            { symbol: "BNB", name: "BNB", coinId: "binancecoin", allocation: 30, rationale: "広範なエコシステムを持つ基盤通貨。", riskLevel: "low" },
            { symbol: "SOL", name: "Solana", coinId: "solana", allocation: 20, rationale: "高速チェーン。成長ポテンシャルあり。", riskLevel: "medium" },
            { symbol: "POL", name: "Polygon", coinId: "matic-network", allocation: 10, rationale: "L2ソリューションとして安定した需要。", riskLevel: "medium" },
        ];
    } else {
        allocations = [
            { symbol: "BTC", name: "Bitcoin", coinId: "bitcoin", allocation: 30, rationale: "アンカー資産。", riskLevel: "low" },
            { symbol: "BNB", name: "BNB", coinId: "binancecoin", allocation: 20, rationale: "エコシステム基盤通貨。", riskLevel: "low" },
            { symbol: "SOL", name: "Solana", coinId: "solana", allocation: 30, rationale: "高パフォーマンスチェーン。", riskLevel: "medium" },
            { symbol: "POL", name: "Polygon", coinId: "matic-network", allocation: 20, rationale: "DeFiエコシステム拡大期待。", riskLevel: "high" },
        ];
    }

    const riskWarning =
        monthlyReturnNeeded > 15
            ? "⚠️ 目標達成には非常に高いリターンが必要です。元本割れリスクが高い。"
            : monthlyReturnNeeded > 8
                ? "⚠️ 月次リターン目標が高め。積極的な戦略が必要です。"
                : "✅ 現実的な目標範囲です。分散投資で達成を目指しましょう。";

    return {
        monthlyReturnNeeded,
        allocations,
        estimatedMonths: monthsToGoal,
        riskWarning,
        rebalanceInterval: riskLevel === "aggressive" ? "週次" : riskLevel === "balanced" ? "月次" : "四半期",
    };
}

const RISK_COLORS = {
    low: "text-emerald-400 bg-emerald-500/10",
    medium: "text-yellow-400 bg-yellow-500/10",
    high: "text-red-400 bg-red-500/10",
};

const RISK_LABELS = { low: "低", medium: "中", high: "高" };

export function GoalBasedPortfolio() {
    const { formatLarge, formatPrice, symbol: currencySymbol } = useCurrency();
    const { portfolio } = useSimulation();

    const currentBalance = portfolio?.totalValue || 1000;

    const [targetAmount, setTargetAmount] = useState("");
    const [monthsToGoal, setMonthsToGoal] = useState(12);
    const [riskLevel, setRiskLevel] = useState<"conservative" | "balanced" | "aggressive">("balanced");
    const [plan, setPlan] = useState<GoalPlan | null>(null);
    const [isComputing, setIsComputing] = useState(false);

    const computeGoal = useCallback(async () => {
        const target = parseFloat(targetAmount);
        if (!target || target <= currentBalance) return;

        setIsComputing(true);
        await new Promise(r => setTimeout(r, 600)); // simulate AI thinking
        const result = computePlan(currentBalance, target, monthsToGoal, riskLevel);
        setPlan(result);
        setIsComputing(false);
    }, [targetAmount, monthsToGoal, riskLevel, currentBalance]);

    return (
        <div className="space-y-4">
            {/* Current balance */}
            <div className="bg-black/30 rounded-lg p-3 border border-gold-500/10">
                <div className="text-[10px] text-gray-500 uppercase font-mono">現在の運用資産</div>
                <div className="text-xl font-black font-mono text-gold-400 mt-1">
                    {formatLarge(currentBalance)}
                </div>
            </div>

            {/* Goal input */}
            <div className="space-y-3">
                <div>
                    <label className="text-[10px] text-gray-500 uppercase font-mono block mb-1">目標金額 ({currencySymbol})</label>
                    <input
                        type="number"
                        value={targetAmount}
                        onChange={e => setTargetAmount(e.target.value)}
                        placeholder="例: 2000"
                        className="w-full bg-black/50 border border-gold-500/20 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-gold-500/50"
                    />
                </div>

                <div>
                    <label className="text-[10px] text-gray-500 uppercase font-mono block mb-1">達成期間: {monthsToGoal}ヶ月</label>
                    <input
                        type="range"
                        min={3} max={60} value={monthsToGoal}
                        onChange={e => setMonthsToGoal(parseInt(e.target.value))}
                        className="w-full accent-yellow-500"
                    />
                    <div className="flex justify-between text-[9px] text-gray-600 mt-1">
                        <span>3ヶ月</span><span>1年</span><span>3年</span><span>5年</span>
                    </div>
                </div>

                <div>
                    <label className="text-[10px] text-gray-500 uppercase font-mono block mb-2">リスク許容度</label>
                    <div className="flex gap-2">
                        {(["conservative", "balanced", "aggressive"] as const).map(r => (
                            <button
                                key={r}
                                onClick={() => setRiskLevel(r)}
                                className={cn(
                                    "flex-1 py-1.5 rounded text-[10px] font-bold border transition-all btn-micro",
                                    riskLevel === r
                                        ? r === "conservative" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                            : r === "balanced" ? "bg-gold-500/20 border-gold-500/40 text-gold-400"
                                                : "bg-red-500/20 border-red-500/40 text-red-400"
                                        : "bg-black/30 border-gray-700 text-gray-500"
                                )}
                            >
                                {r === "conservative" ? "安定" : r === "balanced" ? "バランス" : "積極"}
                            </button>
                        ))}
                    </div>
                </div>

                <button
                    onClick={computeGoal}
                    disabled={!targetAmount || isComputing || parseFloat(targetAmount) <= currentBalance}
                    className="w-full py-2.5 rounded-lg bg-gold-500/10 border border-gold-500/30 text-gold-400 text-sm font-bold hover:bg-gold-500/20 transition-all btn-micro disabled:opacity-40 flex items-center justify-center gap-2"
                >
                    {isComputing ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> AI計算中...</>
                    ) : (
                        <><Zap className="w-4 h-4" /> AIポートフォリオ最適化</>
                    )}
                </button>
            </div>

            {/* Plan result */}
            {plan && (
                <div className="space-y-3 tab-slide-enter">
                    {/* Warning */}
                    <div className={cn(
                        "px-3 py-2 rounded-lg text-xs border",
                        plan.monthlyReturnNeeded > 15 ? "bg-red-500/10 border-red-500/20 text-red-400" :
                            plan.monthlyReturnNeeded > 8 ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" :
                                "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    )}>
                        {plan.riskWarning}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-black/30 rounded-lg p-2 border border-gold-500/10 text-center">
                            <div className="text-[9px] text-gray-500 uppercase">必要月次リターン</div>
                            <div className={cn(
                                "text-lg font-black font-mono mt-1",
                                plan.monthlyReturnNeeded > 15 ? "text-red-400" : "text-gold-400"
                            )}>
                                {plan.monthlyReturnNeeded.toFixed(1)}%
                            </div>
                        </div>
                        <div className="bg-black/30 rounded-lg p-2 border border-gold-500/10 text-center">
                            <div className="text-[9px] text-gray-500 uppercase">リバランス</div>
                            <div className="text-lg font-black font-mono text-gold-400 mt-1">
                                {plan.rebalanceInterval}
                            </div>
                        </div>
                    </div>

                    {/* Allocations */}
                    <div className="space-y-2">
                        <p className="text-[10px] text-gray-500 uppercase font-mono">AI推奨配分</p>
                        {plan.allocations.map((a, i) => (
                            <div key={i} className="bg-black/30 rounded-lg p-2 border border-gold-500/5">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-white font-mono">{a.symbol}</span>
                                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold", RISK_COLORS[a.riskLevel])}>
                                            リスク{RISK_LABELS[a.riskLevel]}
                                        </span>
                                    </div>
                                    <span className="text-sm font-black font-mono text-gold-400">{a.allocation}%</span>
                                </div>
                                {/* Progress bar */}
                                <div className="h-1 bg-black/50 rounded-full overflow-hidden mb-1">
                                    <div
                                        className="h-full bg-gradient-to-r from-gold-600 to-gold-400 rounded-full transition-all duration-1000"
                                        style={{ width: `${a.allocation}%` }}
                                    />
                                </div>
                                <p className="text-[9px] text-gray-500">{a.rationale}</p>
                            </div>
                        ))}
                    </div>

                    <p className="text-[9px] text-gray-600 text-center">
                        ※ AIによる参考提案です。実際の投資判断は自己責任でお願いします。
                    </p>
                </div>
            )}
        </div>
    );
}
