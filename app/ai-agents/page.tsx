"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAgents } from "@/context/AgentContext";
import { Card } from "@/components/ui/Card";
import { Settings, ExternalLink, Play, Loader2, Sparkles, X, TrendingUp, Target } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AgentCouncil } from "@/components/features/AgentCouncil";
import { useSimulation } from "@/context/SimulationContext";
import { generateGeminiDiscussion } from "@/lib/gemini-service";
import { fetchAIRecommendations, AIRecommendation } from "@/lib/coingecko-optimizer";
import { fetchCoinDetails } from "@/lib/dex-service";
import { AgentMessage, DiscussionResult } from "@/lib/ai-agents";

export default function AgentsPage() {
    const { agents } = useAgents();
    const { addDiscussion } = useSimulation();
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [discussionData, setDiscussionData] = useState<{ messages: AgentMessage[], result: DiscussionResult } | null>(null);
    const [statusMessage, setStatusMessage] = useState("");
    const [selectedCoin, setSelectedCoin] = useState<AIRecommendation | null>(null);
    const [isAutoPilot, setIsAutoPilot] = useState(false);
    const [customSymbol, setCustomSymbol] = useState("");

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isAutoPilot && !isAnalyzing) {
            interval = setInterval(async () => {
                if (Math.random() > 0.7) {
                    try {
                        await startAnalysis(true);
                    } catch (e) { console.error("Auto trigger failed", e); }
                }
            }, 10000);
        }
        return () => clearInterval(interval);
    }, [isAutoPilot, isAnalyzing]);

    const startAnalysis = async (autoSelect = false) => {
        if (isAnalyzing && !autoSelect) return;
        setIsAnalyzing(true);
        setDiscussionData(null);
        setSelectedCoin(null);
        try {
            setStatusMessage(autoSelect ? "🤖 AI Autonomous Scanning..." : "Scanning market for opportunities...");
            if (autoSelect) await new Promise(r => setTimeout(r, 2000));

            let target: AIRecommendation | null = null;
            let details: any = null;

            if (!autoSelect && customSymbol.trim()) {
                const searchSymbol = customSymbol.trim().toUpperCase();
                setStatusMessage(`${searchSymbol} のデータを取得中...`);
                // Search for the specific coin by symbol
                const searchResults = await (await import("@/lib/dex-service")).searchCoinsWithMarketData(searchSymbol);
                const found = searchResults.find((c: any) => c.symbol.toUpperCase() === searchSymbol) || searchResults[0];

                if (found) {
                    details = await fetchCoinDetails(found.id);
                    if (details) {
                        target = {
                            id: found.id,
                            symbol: found.symbol.toUpperCase(),
                            name: found.name,
                            currentPrice: found.current_price || 0,
                            priceChange24h: found.price_change_percentage_24h || 0,
                            image: found.image || "",
                            volume24h: found.total_volume || 0,
                            marketCap: found.market_cap || 0,
                            score: 90,
                            reason: "Manual Request"
                        } as AIRecommendation;
                    }
                }
            }

            if (!target) {
                const recommendations = await fetchAIRecommendations();
                const candidates = autoSelect
                    ? recommendations.sort(() => 0.5 - Math.random()).slice(0, 5)
                    : recommendations;
                for (const candidate of candidates) {
                    setStatusMessage(`Fetching data for ${candidate.name} (${candidate.symbol})...`);
                    if (target) await new Promise(r => setTimeout(r, 1500));
                    try {
                        details = await fetchCoinDetails(candidate.id);
                        if (details) {
                            target = candidate;
                            break;
                        }
                    } catch (e) {
                        console.warn(`Failed to fetch details for ${candidate.id}`, e);
                    }
                }
            }
            if (!target || !details) {
                target = {
                    id: "bitcoin",
                    symbol: "BTC",
                    name: "Bitcoin",
                    currentPrice: 9500000,
                    priceChange24h: 2.5,
                    image: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
                    volume24h: 5000000000000,
                    marketCap: 150000000000000,
                    score: 95,
                    reason: "Fallback"
                } as AIRecommendation;
                details = await fetchCoinDetails("bitcoin");
            }
            setSelectedCoin(target);
            setStatusMessage(autoSelect ? `🤖 AI Selected: ${target.name}` : "データ解析完了。評議会を招集しています...");
            const rawResult = await generateGeminiDiscussion(
                `${target.name} (${target.symbol})`,
                target.currentPrice,
                agents.map(a => a.id),
                undefined,
                details
            );
            const now = Date.now();
            const mappedMessages: AgentMessage[] = rawResult.messages.map((msg, i) => ({
                id: `msg_${now}_${i}`,
                timestamp: now + i * 1000,
                agentId: msg.agentId,
                content: msg.content,
                round: msg.round || 1,
                type: (msg.type as any) || "ANALYSIS"
            }));
            const mappedResult: DiscussionResult = {
                action: rawResult.result.action,
                confidence: rawResult.result.confidence,
                reasoning: rawResult.result.reasoning,
                mvpAgent: rawResult.result.mvpAgent,
                riskLevel: "MEDIUM",
                agentVotes: [],
                autoTradeProposal: rawResult.result.autoTradeProposal
            };
            const fullData = { messages: mappedMessages, result: mappedResult };
            setDiscussionData(fullData);
            try {
                const { saveHistoryItem } = await import("@/lib/history-service");
                if (target) {
                    saveHistoryItem(fullData, target.name, target.symbol);
                    addDiscussion({
                        id: `council_${now}`,
                        pair: `${target.symbol}/JPY`,
                        messages: mappedMessages.map(m => ({ agentId: m.agentId, content: m.content })),
                        result: {
                            action: mappedResult.action,
                            confidence: mappedResult.confidence,
                            reasoning: mappedResult.reasoning
                        },
                        source: "council",
                        timestamp: now
                    });
                }
            } catch (e) {
                console.error("Failed to save history or sync discussion", e);
            }
        } catch (error) {
            console.error("Analysis failed", error);
            setStatusMessage("データ取得に失敗しました。しばらく待ってから再試行してください。");
            setIsAnalyzing(false);
        }
    };

    const closeCouncil = () => {
        setIsAnalyzing(false);
        setDiscussionData(null);
        setSelectedCoin(null);
        setStatusMessage("");
    };

    return (
        <div className="relative min-h-screen">
            {/* Majestic UI Background */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-cyber-darker" />
                <div
                    className="absolute inset-0 opacity-15 bg-cover bg-center bg-no-repeat transition-opacity duration-500"
                    style={{ backgroundImage: `url('/images/backgrounds/council.png')` }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-cyber-black via-transparent to-cyber-black opacity-60" />

                {/* Floating Particles */}
                {[...Array(8)].map((_, i) => (
                    <motion.div
                        key={i}
                        className="absolute w-1 h-1 bg-gold-400/20 rounded-full blur-[1px]"
                        animate={{
                            y: [-20, 1000],
                            x: Math.random() * 1920,
                            opacity: [0, 0.4, 0]
                        }}
                        transition={{
                            duration: 10 + Math.random() * 20,
                            repeat: Infinity,
                            delay: Math.random() * 10
                        }}
                        style={{ left: 0, top: -20 }}
                    />
                ))}
            </div>

            <div className="relative z-10 p-6 max-w-7xl mx-auto w-full space-y-6">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                            <span className="bg-gradient-to-r from-gold-400 to-white bg-clip-text text-transparent">
                                AI COUNCIL MEMBERS
                            </span>
                            {isAutoPilot && (
                                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full animate-pulse flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full" /> AUTO-PILOT
                                </span>
                            )}
                        </h1>
                        <p className="text-gray-400 text-sm font-mono mt-1">MEET YOUR INTELLIGENT TRADING STAFF</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsAutoPilot(!isAutoPilot)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 font-bold rounded-lg border transition-all",
                                isAutoPilot
                                    ? "bg-green-900/20 border-green-500/50 text-green-400"
                                    : "bg-white/5 border-white/10 text-gray-400 hover:text-white"
                            )}
                        >
                            {isAutoPilot ? "🛑 Stop Auto" : "🔄 Auto-Pilot"}
                        </button>

                        {!isAnalyzing && (
                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                    <input
                                        type="text"
                                        value={customSymbol}
                                        onChange={(e) => setCustomSymbol(e.target.value)}
                                        placeholder="分析する通貨 (例: BTC, SOL)"
                                        className="bg-black/40 border border-gold-500/20 rounded-lg pl-9 pr-4 py-2 text-sm text-gold-400 placeholder:text-gray-600 focus:outline-none focus:border-gold-500/50 w-48 font-mono"
                                    />
                                </div>
                                <button
                                    onClick={() => startAnalysis(false)}
                                    className="flex items-center gap-2 px-6 py-2 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-lg shadow-lg shadow-gold-500/20 transition-all hover:scale-105"
                                >
                                    <Sparkles className="w-4 h-4" />
                                    Start Daily Analysis
                                </button>
                            </div>
                        )}
                        <Link href="/settings">
                            <button className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors group">
                                <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
                                Customize
                            </button>
                        </Link>
                    </div>
                </div>

                {isAnalyzing && (
                    <div className="animate-in fade-in zoom-in duration-300 space-y-4">
                        <div className="flex items-center justify-between bg-gold-900/10 border border-gold-500/30 p-4 rounded-xl">
                            <div className="flex items-center gap-4">
                                {selectedCoin && (
                                    <img src={selectedCoin.image} className="w-10 h-10 rounded-full" alt={selectedCoin.symbol} />
                                )}
                                <div>
                                    <h3 className="text-white font-bold flex items-center gap-2">
                                        {selectedCoin ? `Analysis Target: ${selectedCoin.name}` : "Initializing..."}
                                        {selectedCoin && <span className="text-xs bg-gold-500 text-black px-2 py-0.5 rounded-full">{selectedCoin.symbol}</span>}
                                    </h3>
                                    <p className="text-gold-400 text-xs font-mono animate-pulse">{statusMessage}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {discussionData && (
                                    <Link
                                        href="/strategy"
                                        className="flex items-center gap-2 px-3 py-1 bg-gold-500/20 text-gold-400 border border-gold-500/40 rounded-lg text-xs font-bold hover:bg-gold-500/30 transition-all"
                                    >
                                        <TrendingUp className="w-3.5 h-3.5" />
                                        提案ストラテジーを見る
                                    </Link>
                                )}
                                <button onClick={closeCouncil} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                    <X className="w-5 h-5 text-gray-400" />
                                </button>
                            </div>
                        </div>

                        {!discussionData ? (
                            <div className="h-[400px] flex flex-col items-center justify-center bg-black/40 rounded-xl border border-white/5 backdrop-blur-sm">
                                <Loader2 className="w-12 h-12 text-gold-500 animate-spin mb-4" />
                                <p className="text-gray-300 font-mono text-sm">{statusMessage}</p>
                            </div>
                        ) : (
                            <AgentCouncil
                                messages={discussionData.messages}
                                result={discussionData.result}
                                isAutoPlay={true}
                            />
                        )}
                    </div>
                )}

                {!isAnalyzing && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-500">
                        {agents.map((agent) => (
                            <Card key={agent.id} title={agent.name} glow="secondary" className="h-full">
                                <div className="flex flex-col h-full space-y-4">
                                    <div className="flex items-start justify-between">
                                        <div className="relative">
                                            <div className={cn("absolute inset-0 rounded-full blur-lg opacity-40", agent.color.replace("text-", "bg-"))} />
                                            <img
                                                src={agent.avatar}
                                                alt={agent.name}
                                                className={cn("relative w-24 h-24 rounded-full border-4 object-cover", agent.borderColor)}
                                            />
                                        </div>
                                        <div className="text-right">
                                            <span className={cn("text-xs font-bold px-2 py-1 rounded bg-white/5 border border-white/10", agent.color)}>
                                                {agent.shortName}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="space-y-4 flex-1">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider block mb-0.5">状況 / Status</label>
                                                <div className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                                    {agent.status}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider block mb-0.5">戦略 / Strategy</label>
                                                <p className="text-xs text-cyan-300 font-bold">{agent.strategy}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider block mb-0.5">専門 / Expertise</label>
                                                <p className="text-xs text-gold-400 font-bold">{agent.expertise}</p>
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider block mb-0.5">特徴 / Traits</label>
                                                <div className="flex flex-wrap gap-1 mt-0.5">
                                                    {agent.traits.map(trait => (
                                                        <span key={trait} className="px-1.5 py-0.5 bg-white/5 rounded text-[9px] text-gray-400 border border-white/10 font-mono">
                                                            {trait}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Personality Matrix</label>
                                            <div className="mt-1 p-3 bg-black/30 rounded border border-white/5 text-xs text-gray-300 italic">
                                                "{agent.personality}"
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-white/5">
                                        <Link href="/settings">
                                            <button className="w-full py-2 flex items-center justify-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
                                                Edit Configuration <ExternalLink className="w-3 h-3" />
                                            </button>
                                        </Link>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
