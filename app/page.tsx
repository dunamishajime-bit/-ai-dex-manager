"use client";

import { useState } from "react";
import { MarketOverview } from "@/components/features/MarketOverview";
import { TradableTokensTable } from "@/components/features/TradableTokensTable";
import { ChainFilter } from "@/components/features/ChainFilter";
import { AgentTicker } from "@/components/features/AgentTicker";
import { TradingPipelineManager } from "@/components/features/TradingPipelineManager";
import { AchievementHub } from "@/components/features/AchievementHub";
import { LearningDashboard } from "@/components/features/LearningDashboard";
import { PerformanceAnalytics } from "@/components/features/PerformanceAnalytics";
import { Leaderboard } from "@/components/features/Leaderboard";
import { Search, Activity, Zap, Trophy, BarChart3 } from "lucide-react";
import { ChainId } from "@/lib/dex-service";
import { TerminalView } from "@/components/features/TerminalView";

export default function Home() {
    const [selectedChain, setSelectedChain] = useState<ChainId>("all");

    return (
        <main className="flex-1 flex flex-col bg-cyber-black overflow-hidden relative">
            {/* Background effects */}
            <div className="absolute inset-0 bg-grid-pattern bg-[size:40px_40px] opacity-[0.02] pointer-events-none" />

            <AgentTicker />

            <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative z-10">
                <div className="max-w-[1600px] mx-auto space-y-8">
                    {/* Header Section */}
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-gold-500/10 pb-4">
                        <div>
                            <h1 className="text-2xl font-black text-white italic tracking-tighter uppercase">
                                DIS <span className="text-gold-500">TERMINAL</span>
                            </h1>
                            <p className="text-gray-500 text-[10px] font-mono mt-1 uppercase">
                                5 AGENT SYNERGY • AI-POWERED MARKET INTELLIGENCE
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="px-3 py-1 rounded bg-gold-500/5 border border-gold-500/20 text-gold-500 text-[10px] font-mono flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse" />
                                CORE_SYSTEMS_OPTIMAL
                            </div>
                        </div>
                    </div>

                    {/* Top Section: Gainers/Losers/News/Profit */}
                    <section>
                        <MarketOverview />
                    </section>

                    {/* Middle Section: Pipeline & Achievements */}
                    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="bg-[#0b0f15] rounded-xl border border-gold-500/10 p-4 h-[400px] flex flex-col relative overflow-hidden">
                            <div className="flex items-center gap-2 mb-4 text-gold-400">
                                <Zap className="w-4 h-4" />
                                <h3 className="text-xs font-bold uppercase tracking-wider">Trading Pipeline Manager</h3>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <TradingPipelineManager />
                            </div>
                        </div>
                        <div className="bg-[#0b0f15] rounded-xl border border-gold-500/10 p-4 h-[400px] flex flex-col relative overflow-hidden">
                            <div className="flex items-center gap-2 mb-4 text-gold-400">
                                <Trophy className="w-4 h-4" />
                                <h3 className="text-xs font-bold uppercase tracking-wider">Achievement Gallery</h3>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <AchievementHub />
                            </div>
                        </div>
                        <div className="h-[400px]">
                            <LearningDashboard />
                        </div>
                    </section>

                    <section>
                        <PerformanceAnalytics />
                    </section>

                    <section className="h-[400px]">
                        <Leaderboard />
                    </section>



                    <section className="grid grid-cols-1 gap-6">
                        <TerminalView />
                    </section>

                    {/* Main Section: Currency Search & Rankings with Chain Filter */}
                    <section className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-gold-400">
                                <Search className="w-4 h-4" />
                                <h2 className="text-sm font-bold uppercase tracking-wider">Currency Search & Global Rankings</h2>
                            </div>
                            <div className="max-w-full overflow-x-auto">
                                <ChainFilter selectedChain={selectedChain} onSelectChain={setSelectedChain} />
                            </div>
                        </div>

                        <div className="bg-[#0d1117] rounded-xl border border-gold-500/20 shadow-2xl shadow-black/50 overflow-hidden">
                            <TradableTokensTable selectedChain={selectedChain} />
                        </div>
                    </section>
                </div>
            </div>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(212, 175, 55, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(212, 175, 55, 0.2);
                }
            `}</style>
        </main>
    );
}
