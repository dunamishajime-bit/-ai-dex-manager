"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { useSimulation } from "@/context/SimulationContext";
import { TrendingUp, TrendingDown, Target, Shield, AlertTriangle, LayoutGrid, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { WalletPortfolio } from "@/components/features/WalletPortfolio";

export default function PositionsPage() {
    const { portfolio, allMarketData } = useSimulation();
    const [activeTab, setActiveTab] = useState<"simulation" | "wallet">("simulation");

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto w-full animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
                        <div className="p-2 bg-gold-500/10 rounded-xl border border-gold-500/30">
                            {activeTab === "simulation" ? <LayoutGrid className="w-8 h-8 text-gold-500" /> : <Wallet className="w-8 h-8 text-gold-500" />}
                        </div>
                        <span className="bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-transparent">
                            {activeTab === "simulation" ? "AI運用ポジション" : "マルチチェーン資産"}
                        </span>
                    </h1>
                    <p className="text-gray-500 text-xs font-mono mt-2 tracking-widest uppercase">
                        {activeTab === "simulation" ? "AI Autonomous Trading Portfolio" : "Real-time Multi-chain Wallet Assets"}
                    </p>
                </div>

                {/* Tab Switcher */}
                <div className="bg-black/40 border border-white/10 p-1 rounded-xl flex">
                    <button
                        onClick={() => setActiveTab("simulation")}
                        className={cn(
                            "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                            activeTab === "simulation"
                                ? "bg-gold-500 text-black shadow-lg shadow-gold-500/20"
                                : "text-gray-400 hover:text-white hover:bg-white/5"
                        )}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        AI Simulation
                    </button>
                    <button
                        onClick={() => setActiveTab("wallet")}
                        className={cn(
                            "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                            activeTab === "wallet"
                                ? "bg-gold-500 text-black shadow-lg shadow-gold-500/20"
                                : "text-gray-400 hover:text-white hover:bg-white/5"
                        )}
                    >
                        <Wallet className="w-4 h-4" />
                        Multi-Chain Wallet
                    </button>
                </div>
            </div>

            {activeTab === "simulation" ? (
                <div className="space-y-6 tab-slide-enter">
                    <div className="flex justify-end text-sm text-gray-400 font-mono">
                        スロット: <span className="text-gold-500 font-bold ml-1">{portfolio.positions.length}</span> / 3 (MAX)
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                        {portfolio.positions.map((pos, idx) => {
                            const marketInfo = allMarketData[pos.symbol] || { price: 0 };
                            const currentPrice = marketInfo.price;
                            const pnl = (currentPrice - pos.entryPrice) * pos.amount * 150;
                            const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

                            return (
                                <Card key={idx} title={pos.symbol} glow={pnl >= 0 ? "success" : "danger"}>
                                    <div className="mb-4">
                                        <div className="text-3xl font-bold font-mono text-white mb-2 tracking-tight">
                                            ¥{(pos.amount * currentPrice * 150).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </div>
                                        <div className={`flex items-center gap-2 ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                            {pnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                                            <span className="font-mono font-bold text-lg">
                                                {pnl >= 0 ? "+" : ""}{pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-sm opacity-80">({pnlPercent.toFixed(2)}%)</span>
                                            </span>
                                        </div>
                                    </div>

                                    <div className="space-y-4 border-t border-white/10 pt-4">
                                        <div>
                                            <h4 className="text-[10px] text-gold-500 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                                                <Target className="w-3 h-3" /> Entry Rationale
                                            </h4>
                                            <p className="text-xs text-gray-300 leading-relaxed bg-white/5 p-3 rounded-lg border border-white/5 font-medium">
                                                {pos.reason || "AIによる自動エントリー判断 (MACD/RSIシグナルに基づく)"}
                                            </p>
                                        </div>

                                        <div>
                                            <h4 className="text-[10px] text-blue-400 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                                                <Shield className="w-3 h-3" /> Exit Strategy
                                            </h4>
                                            <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-2">
                                                <p className="text-xs text-gray-300 font-medium">
                                                    {pos.exitStrategy || "動的トレーリングストップ運用中"}
                                                </p>
                                                <div className="flex gap-3 mt-2 pt-2 border-t border-white/5">
                                                    <div className="flex items-center gap-1 text-emerald-400 text-[10px] bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                        <span>TP: +10%</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-red-400 text-[10px] bg-red-500/10 px-1.5 py-0.5 rounded">
                                                        <span>SL: -5%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center pt-2">
                                            <div className="text-[10px] text-gray-600 font-mono">
                                                ID: {Math.random().toString(36).substr(2, 6).toUpperCase()}
                                            </div>
                                            <div className="text-xs text-gray-500 font-mono">
                                                Entry: <span className="text-white">¥{(pos.entryPrice * 150).toLocaleString()}</span> | Amt: <span className="text-white">{pos.amount}</span>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })}

                        {Array.from({ length: Math.max(0, 3 - portfolio.positions.length) }).map((_, i) => (
                            <div key={`empty-${i}`} className="border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center p-12 bg-black/20 hover:bg-black/30 transition-colors group">
                                <div className="p-4 bg-white/5 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300">
                                    <AlertTriangle className="w-8 h-8 text-gray-700 group-hover:text-gray-500 transition-colors" />
                                </div>
                                <span className="text-gray-600 font-mono text-sm tracking-widest uppercase font-bold">Empty AI Slot</span>
                                <p className="text-gray-700 text-xs mt-2 text-center max-w-[200px]">
                                    AIエージェントが好機を検知すると自動的にエントリーします
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="w-full tab-slide-enter">
                    <WalletPortfolio />
                </div>
            )}
        </div>
    );
}
