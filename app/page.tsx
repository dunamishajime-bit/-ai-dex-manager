"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { MarketOverview } from "@/components/features/MarketOverview";
import { TradableTokensTable } from "@/components/features/TradableTokensTable";
import { ChainFilter } from "@/components/features/ChainFilter";
import { AgentTicker } from "@/components/features/AgentTicker";
import { TradingPipelineManager } from "@/components/features/TradingPipelineManager";
import { AchievementHub } from "@/components/features/AchievementHub";
import { LearningDashboard } from "@/components/features/LearningDashboard";
import { PerformanceAnalytics } from "@/components/features/PerformanceAnalytics";
import { Leaderboard } from "@/components/features/Leaderboard";
import { TerminalView } from "@/components/features/TerminalView";
import { LiveAgentChat } from "@/components/features/LiveAgentChat";
import { ChainId } from "@/lib/dex-service";
import { useSimulation } from "@/context/SimulationContext";

export default function Home() {
    const [selectedChain, setSelectedChain] = useState<ChainId>("all");
    const { leaderboard } = useSimulation();

    return (
        <main className="relative flex flex-1 flex-col overflow-hidden bg-cyber-black">
            <div className="pointer-events-none absolute inset-0 bg-grid-pattern bg-[size:40px_40px] opacity-[0.02]" />

            <AgentTicker />

            <div className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
                <div className="mx-auto max-w-[1600px] space-y-8">
                    <div className="flex flex-col items-start justify-between gap-4 border-b border-gold-500/10 pb-4 md:flex-row md:items-center">
                        <div>
                            <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">
                                DIS <span className="text-gold-500">TERMINAL</span>
                            </h1>
                            <p className="mt-1 text-[10px] font-mono uppercase text-gray-500">
                                5 AGENT SYNERGY - AI-POWERED MARKET INTELLIGENCE
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 rounded border border-gold-500/20 bg-gold-500/5 px-3 py-1 text-[10px] font-mono text-gold-500">
                                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-500" />
                                CORE_SYSTEMS_OPTIMAL
                            </div>
                        </div>
                    </div>

                    <section>
                        <MarketOverview />
                    </section>

                    <section>
                        <div className="overflow-hidden rounded-xl border border-gold-500/10 bg-[#0d1117]">
                            <div className="h-[360px]">
                                <LiveAgentChat />
                            </div>
                        </div>
                    </section>

                    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <div className="h-[420px]">
                            <AchievementHub />
                        </div>
                        <div className="h-[420px]">
                            <LearningDashboard />
                        </div>
                    </section>

                    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <div className="h-[420px]">
                            <TradingPipelineManager />
                        </div>
                        <div>
                            <PerformanceAnalytics />
                        </div>
                    </section>

                    {leaderboard.length > 0 ? (
                        <section className="h-[400px]">
                            <Leaderboard />
                        </section>
                    ) : null}

                    <section className="grid grid-cols-1 gap-6">
                        <TerminalView />
                    </section>

                    <section className="space-y-4">
                        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                            <div className="flex items-center gap-2 text-gold-400">
                                <Search className="h-4 w-4" />
                                <h2 className="text-sm font-bold uppercase tracking-wider">Currency Search & Global Rankings</h2>
                            </div>
                            <div className="max-w-full overflow-x-auto">
                                <ChainFilter selectedChain={selectedChain} onSelectChain={setSelectedChain} />
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-gold-500/20 bg-[#0d1117] shadow-2xl shadow-black/50">
                            <TradableTokensTable selectedChain={selectedChain} />
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}
