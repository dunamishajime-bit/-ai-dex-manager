
import React, { useEffect, useState } from 'react';
import { useSimulation } from "@/context/SimulationContext";
import { X, Sparkles, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { fetchTokensByChain } from "@/lib/dex-service";
import { useCurrency } from "@/context/CurrencyContext";

export const MorningBriefing: React.FC = () => {
    const { marketData } = useSimulation();
    const { formatPrice } = useCurrency();
    const [isOpen, setIsOpen] = useState(false);
    const [briefingContent, setBriefingContent] = useState<{
        topGainer: any;
        topLoser: any;
        message: string;
    } | null>(null);

    useEffect(() => {
        const init = async () => {
            // Check local storage for last briefing date
            const today = new Date().toDateString();
            const lastBriefing = localStorage.getItem('lastBriefingDate');

            // If not seen today (or forced for debug), compute briefing
            if (lastBriefing !== today) {
                try {
                    const tokens = await fetchTokensByChain("all", 1);
                    if (tokens.length === 0) return;

                    // Analyze market
                    const sorted = [...tokens].sort((a: any, b: any) => b.price_change_percentage_24h - a.price_change_percentage_24h);
                    const topGainer = sorted[0];
                    const topLoser = sorted[sorted.length - 1];

                    // AI Message logic (mock)
                    // Use average change or specific token trend
                    const avgChange = tokens.reduce((acc: number, t: any) => acc + t.price_change_percentage_24h, 0) / tokens.length;
                    const marketTrend = avgChange > 0 ? "bullish" : "bearish";

                    const message = marketTrend === "bullish"
                        ? "おはようございます！市場は強気ムードです。主要アルトコインにも資金が流入しています。"
                        : "おはようございます。市場は調整局面です。押し目買いのチャンスを探りましょう。";

                    setBriefingContent({ topGainer, topLoser, message });
                    setIsOpen(true);

                    // Save date
                    localStorage.setItem('lastBriefingDate', today);
                } catch (e) {
                    console.error("MorningBriefing data fetch failed", e);
                }
            }
        };

        // Delay slightly to allow app to load
        const timer = setTimeout(init, 2000);
        return () => clearTimeout(timer);
    }, []);

    if (!isOpen || !briefingContent) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-300">
            <div className="bg-gradient-to-b from-gray-900 to-black border border-gold-500/30 rounded-2xl w-full max-w-lg shadow-[0_0_50px_rgba(234,179,8,0.1)] relative overflow-hidden">
                {/* Decorative Elements */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold-500 to-transparent opacity-50" />
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-gold-500/10 rounded-full blur-3xl" />

                <div className="p-6 relative z-10">
                    <button
                        onClick={() => setIsOpen(false)}
                        className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-gold-500/10 rounded-xl border border-gold-500/20">
                            <Sparkles className="w-6 h-6 text-gold-400 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white tracking-wide">AI MORNING BRIEFING</h2>
                            <p className="text-xs text-gold-500/70 font-mono uppercase tracking-wider">
                                Daily Market Analysis & Strategy
                            </p>
                        </div>
                    </div>

                    <div className="bg-white/5 rounded-xl p-4 mb-6 border border-white/5">
                        <div className="flex gap-3">
                            <div className="w-1 bg-gold-500 rounded-full" />
                            <p className="text-sm text-gray-200 leading-relaxed">
                                {briefingContent.message}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-gray-800/50 rounded-xl p-4 border border-green-500/20">
                            <div className="flex items-center gap-2 mb-2 text-green-400 text-xs font-bold uppercase">
                                <TrendingUp className="w-3 h-3" /> Top Gainer
                            </div>
                            <div className="flex justify-between items-end">
                                <span className="font-bold text-white">{briefingContent.topGainer.symbol.toUpperCase()}</span>
                                <span className="text-green-400 font-mono font-bold">+{briefingContent.topGainer.price_change_percentage_24h.toFixed(1)}%</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 font-mono">
                                {formatPrice(briefingContent.topGainer.current_price)}
                            </div>
                        </div>

                        <div className="bg-gray-800/50 rounded-xl p-4 border border-red-500/20">
                            <div className="flex items-center gap-2 mb-2 text-red-400 text-xs font-bold uppercase">
                                <TrendingDown className="w-3 h-3" /> Top Loser
                            </div>
                            <div className="flex justify-between items-end">
                                <span className="font-bold text-white">{briefingContent.topLoser.symbol.toUpperCase()}</span>
                                <span className="text-red-400 font-mono font-bold">{briefingContent.topLoser.price_change_percentage_24h.toFixed(1)}%</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 font-mono">
                                {formatPrice(briefingContent.topLoser.current_price)}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsOpen(false)}
                        className="w-full bg-gold-600 hover:bg-gold-500 text-black font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-gold-500/20"
                    >
                        START TRADING
                        <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="mt-4 text-center">
                        <p className="text-[10px] text-gray-600 font-mono">
                            AI AGENT: V2.4.0 (AUTONOMOUS_MODE: ACTIVE)
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
