"use client";

import { Card } from "@/components/ui/Card";
import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Wallet, Zap, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketWatcher } from "./MarketWatcher";
import { MorningBriefing } from "./MorningBriefing";
import { RiskToleranceSetup } from "./RiskToleranceSetup";
import { OneClickPortfolio } from "./OneClickPortfolio";
import { AchievementHub } from "./AchievementHub";

export function Dashboard() {
    // Use allMarketData to get prices for all assets
    const { currency, formatPrice } = useCurrency();
    const { portfolio, marketData: _currentData, allMarketData, activeStrategies, riskStatus, convertJPY } = useSimulation();
    const activeStrategyName = activeStrategies.length > 0 ? activeStrategies[0].title : "No Active Strategy";

    const isProfit = portfolio.pnl24h >= 0;

    const displayTotalValue = portfolio.totalValue;
    const displayCash = portfolio.cashbalance;
    const displayPositionsValue = displayTotalValue - displayCash;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full relative pb-20">
            <MarketWatcher />
            <MorningBriefing />
            <RiskToleranceSetup />

            <div className="md:col-span-2">
                <OneClickPortfolio />
            </div>

            {/* Achievements Row */}
            <div className="md:col-span-2 h-[350px]">
                <AchievementHub />
            </div>

            {/* Portfolio Card */}
            <Card title="総資産" glow={isProfit ? "success" : "danger"}>
                <div className="flex flex-col h-full justify-between">
                    <div>
                        <div className="flex items-end gap-2 mb-2">
                            <span className="text-4xl font-bold font-mono text-white tracking-tighter neon-text-gold">
                                {formatPrice(displayTotalValue)}
                            </span>
                        </div>
                        <div className={cn(
                            "flex items-center text-sm font-bold mb-4 w-fit px-2 py-1 rounded bg-black/30 border",
                            isProfit ? "text-neon-green border-neon-green/30" : "text-red-500 border-red-500/30"
                        )}>
                            {isProfit ? <ArrowUpRight className="w-4 h-4 mr-1" /> : <ArrowDownRight className="w-4 h-4 mr-1" />}
                            {portfolio.pnl24h}% (24h)
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span className="flex items-center gap-1 text-gold-400"><Wallet className="w-3 h-3" /> 現金残高</span>
                            <span className="font-mono text-white">{formatPrice(displayCash)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-400">
                            <span className="flex items-center gap-1 text-gold-400"><TrendingUp className="w-3 h-3" /> 保有ポジション</span>
                            <span className="font-mono text-white">{formatPrice(displayPositionsValue)}</span>
                        </div>
                        {/* Simple Progress Bar */}
                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
                            <div
                                className="h-full bg-gold-500 shadow-[0_0_10px_rgba(255,215,0,0.5)]"
                                style={{ width: `${(portfolio.cashbalance / portfolio.totalValue) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>
            </Card>

            {/* Strategy Card */}
            <Card title="稼働中のプロトコル" glow="secondary">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-gold-500" />
                        <span className="text-gray-300 font-medium">戦略</span>
                    </div>
                    <span className="px-2 py-1 rounded text-xs bg-gold-500/20 text-gold-400 border border-gold-500/50 font-mono animate-pulse">
                        {activeStrategyName}
                    </span>
                </div>

                <div className="space-y-4 border-t border-white/5 pt-4">
                    {/* Market Ticker */}
                    <div className="flex justify-between items-center bg-white/5 p-3 rounded border border-white/5">
                        <div className="flex flex-col">
                            <span className="text-xs text-gray-400">ETH/USDC</span>
                            <span className="text-lg font-bold font-mono text-white">{formatPrice(_currentData.price)}</span>
                        </div>
                        <div className={cn(
                            "text-sm font-mono flex items-center",
                            _currentData.change24h >= 0 ? "text-neon-green" : "text-red-500"
                        )}>
                            {_currentData.change24h > 0 ? "+" : ""}{_currentData.change24h}%
                        </div>
                    </div>

                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-400">リスクスコア</span>
                        <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className={`w-2 h-4 rounded-sm ${i <= 3 ? "bg-gold-500 shadow-[0_0_5px_rgba(255,215,0,0.5)]" : "bg-gray-800"}`} />
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/5">
                        <div className="flex justify-between items-center bg-white/5 p-3 rounded-lg border border-white/5">
                            <span className="text-xs text-gray-400 font-bold">リスク・ヘルス</span>
                            <div className={cn(
                                "flex items-center gap-2 text-xs font-black uppercase px-2 py-1 rounded",
                                riskStatus === "SAFE" ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" :
                                    riskStatus === "CAUTION" ? "text-amber-400 bg-amber-500/10 border border-amber-500/20" :
                                        "text-red-400 bg-red-500/10 border border-red-500/20 animate-pulse"
                            )}>
                                <div className={cn("w-2 h-2 rounded-full",
                                    riskStatus === "SAFE" ? "bg-emerald-500" :
                                        riskStatus === "CAUTION" ? "bg-amber-500" : "bg-red-500")}
                                />
                                {riskStatus}
                            </div>
                        </div>
                        {riskStatus === "CRITICAL" && (
                            <div className="mt-2 p-2 bg-red-500/20 border border-red-500/30 rounded text-[10px] text-red-100 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-500" />
                                <span>下落リスク大：AIによる緊急決済を検討中</span>
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}
