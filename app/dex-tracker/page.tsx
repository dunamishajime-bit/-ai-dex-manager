"use client";

import { MarketOverview } from "@/components/features/MarketOverview";
import { TradableTokensTable } from "@/components/features/TradableTokensTable";
import { Search, Trophy, Globe, Activity } from "lucide-react";

export default function DexTrackerPage() {
    return (
        <main className="flex-1 flex flex-col bg-cyber-black overflow-hidden relative">
            <div className="absolute inset-0 bg-grid-pattern bg-[size:40px_40px] opacity-[0.03] pointer-events-none" />

            <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar relative z-10">
                <div className="max-w-7xl mx-auto space-y-8">
                    {/* Page Header */}
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-gold-500/10 pb-6">
                        <div>
                            <h1 className="text-3xl font-black text-white italic tracking-tighter uppercase">
                                DEX <span className="text-gold-500">TRACKER</span>
                            </h1>
                            <p className="text-gray-500 text-sm font-mono mt-1 uppercase">
                                SEARCH • RANK • ANALYZE
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="px-3 py-1.5 rounded-lg bg-gold-500/10 border border-gold-500/20 text-gold-400 text-xs font-mono flex items-center gap-2">
                                <Activity className="w-3 h-3 animate-pulse" />
                                TRACKING_ACTIVE_POOLS
                            </div>
                        </div>
                    </div>

                    {/* Top 3 Ranking Section */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-2 text-gold-400 mb-2">
                            <Trophy className="w-4 h-4" />
                            <h2 className="text-sm font-bold uppercase tracking-wider">Market Overview Trends</h2>
                        </div>
                        <MarketOverview />
                    </section>

                    {/* Full Ranking & Search Table */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-2 text-gold-400 mb-2">
                            <Search className="w-4 h-4" />
                            <h2 className="text-sm font-bold uppercase tracking-wider">Currency Search & Global Rankings</h2>
                        </div>
                        <div className="h-[800px]">
                            <TradableTokensTable />
                        </div>
                    </section>
                </div>
            </div>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
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
