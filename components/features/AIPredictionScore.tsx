"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Brain, TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";

interface AgentVote {
    agentId: string;
    name: string;
    icon: string;
    color: string;
    score: number; // 0-100 (bullish bias)
    vote: "BUY" | "SELL" | "HOLD";
}

function computeScoreFromMarket(
    change24h: number,
    change7d: number,
    marketCapRank: number,
    volumeRatio: number // volume / market_cap
): AgentVote[] {
    // Technical: momentum-based
    const techScore = Math.min(100, Math.max(0, 50 + change24h * 3 + change7d * 1.5));

    // Sentiment: pure momentum proxy
    const sentScore = Math.min(100, Math.max(0, 50 + change24h * 4));

    // Fundamental: rank-based (lower rank = higher score)
    const fundScore = Math.min(100, Math.max(0, 90 - (marketCapRank - 1) * 2));

    // Security: inversely proportional to volatility (conservative)
    const volatility = Math.abs(change24h);
    const secScore = Math.min(100, Math.max(0, 75 - volatility * 2 + (volumeRatio > 0.05 ? 10 : 0)));

    // Coordinator: average of above
    const coordScore = Math.round((techScore + sentScore + fundScore + secScore) / 4);

    const toVote = (s: number): "BUY" | "SELL" | "HOLD" =>
        s >= 60 ? "BUY" : s <= 40 ? "SELL" : "HOLD";

    return [
        { agentId: "technical", name: "テクニカルAI", icon: "📊", color: "text-cyan-400", score: Math.round(techScore), vote: toVote(techScore) },
        { agentId: "sentiment", name: "センチメントAI", icon: "💫", color: "text-pink-400", score: Math.round(sentScore), vote: toVote(sentScore) },
        { agentId: "fundamental", name: "ファンダAI", icon: "🔬", color: "text-emerald-400", score: Math.round(fundScore), vote: toVote(fundScore) },
        { agentId: "security", name: "セキュリティAI", icon: "🛡️", color: "text-orange-400", score: Math.round(secScore), vote: toVote(secScore) },
        { agentId: "coordinator", name: "コーディネーターAI", icon: "⚡", color: "text-gold-400", score: coordScore, vote: toVote(coordScore) },
    ];
}

function ScoreGauge({ score, color }: { score: number; color: string }) {
    const angle = (score / 100) * 180 - 90; // -90 to 90 degrees
    const scoreColor =
        score >= 60 ? "#FFD700" :
            score <= 40 ? "#ef4444" :
                "#6b7280";

    return (
        <div className="relative w-16 h-10 mx-auto">
            {/* Background arc */}
            <svg viewBox="0 0 80 46" className="w-full h-full">
                <path
                    d="M 10 40 A 30 30 0 0 1 70 40"
                    fill="none"
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth="6"
                    strokeLinecap="round"
                />
                {/* Colored fill arc */}
                <path
                    d="M 10 40 A 30 30 0 0 1 70 40"
                    fill="none"
                    stroke={scoreColor}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${(score / 100) * 94} 94`}
                    opacity="0.8"
                />
                {/* Needle */}
                <line
                    x1="40" y1="40"
                    x2={40 + 22 * Math.cos(((angle - 90) * Math.PI) / 180)}
                    y2={40 + 22 * Math.sin(((angle - 90) * Math.PI) / 180)}
                    stroke={scoreColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                />
                <circle cx="40" cy="40" r="2.5" fill={scoreColor} />
            </svg>
            <div
                className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] font-bold font-mono"
                style={{ color: scoreColor }}
            >
                {score}
            </div>
        </div>
    );
}

interface Props {
    symbol?: string;
    coinId?: string;
}

export function AIPredictionScore({ symbol = "BTC", coinId = "bitcoin" }: Props) {
    const [votes, setVotes] = useState<AgentVote[]>([]);
    const [consensus, setConsensus] = useState(50);
    const [isLoading, setIsLoading] = useState(true);
    const [coinName, setCoinName] = useState(symbol);
    const { marketData } = useSimulation();

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);

        async function load() {
            try {
                // Try from simulation context first
                const simCoin = (marketData as unknown as any[])?.find(
                    (c: any) => c.symbol?.toUpperCase() === symbol.toUpperCase() || c.id === coinId
                );

                let change24h = 0, change7d = 0, rank = 50, vol = 0;

                if (simCoin) {
                    change24h = simCoin.price_change_percentage_24h || 0;
                    change7d = simCoin.price_change_percentage_7d_in_currency || 0;
                    rank = simCoin.market_cap_rank || 50;
                    vol = simCoin.market_cap > 0
                        ? (simCoin.total_volume || 0) / simCoin.market_cap
                        : 0;
                    setCoinName(simCoin.name || symbol);
                } else {
                    // Fallback to CoinGecko
                    const res = await fetch(
                        `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
                    );
                    if (res.ok) {
                        const data = await res.json();
                        change24h = data.market_data?.price_change_percentage_24h || 0;
                        change7d = data.market_data?.price_change_percentage_7d || 0;
                        rank = data.market_cap_rank || 50;
                        const mc = data.market_data?.market_cap?.usd || 1;
                        const vol24 = data.market_data?.total_volume?.usd || 0;
                        vol = vol24 / mc;
                        setCoinName(data.name || symbol);
                    }
                }

                if (!cancelled) {
                    const agentVotes = computeScoreFromMarket(change24h, change7d, rank, vol);
                    setVotes(agentVotes);
                    const avg = Math.round(agentVotes.reduce((s, v) => s + v.score, 0) / agentVotes.length);
                    setConsensus(avg);
                }
            } catch {
                // Fallback with neutral scores
                if (!cancelled) {
                    const fallback = computeScoreFromMarket(0, 0, 100, 0.02);
                    setVotes(fallback);
                    setConsensus(50);
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [symbol, coinId, marketData]);

    const consensusVote: "BUY" | "SELL" | "HOLD" =
        consensus >= 60 ? "BUY" : consensus <= 40 ? "SELL" : "HOLD";

    const voteColor = consensusVote === "BUY" ? "text-emerald-400" :
        consensusVote === "SELL" ? "text-red-400" : "text-gray-400";

    const buyCount = votes.filter(v => v.vote === "BUY").length;
    const sellCount = votes.filter(v => v.vote === "SELL").length;

    return (
        <div className="w-full space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-gold-400" />
                    <span className="text-xs font-mono text-gold-400">AI予測スコア</span>
                    <span className="text-xs text-gray-500">({coinName})</span>
                </div>
                <div className={cn("text-xs font-bold font-mono flex items-center gap-1", voteColor)}>
                    {consensusVote === "BUY" && <TrendingUp className="w-3 h-3" />}
                    {consensusVote === "SELL" && <TrendingDown className="w-3 h-3" />}
                    {consensusVote === "HOLD" && <Minus className="w-3 h-3" />}
                    {consensusVote}
                </div>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-6 rounded" />)}
                </div>
            ) : (
                <>
                    {/* Consensus bar */}
                    <div className="relative h-6 rounded-full overflow-hidden bg-black/40 border border-gold-500/10">
                        {/* SELL side */}
                        <div
                            className="absolute left-0 top-0 h-full bg-red-500/40 transition-all duration-1000"
                            style={{ width: `${Math.max(0, 50 - consensus)}%` }}
                        />
                        {/* BUY side */}
                        <div
                            className="absolute right-0 top-0 h-full bg-emerald-500/40 transition-all duration-1000"
                            style={{ width: `${Math.max(0, consensus - 50)}%` }}
                        />
                        {/* Center line */}
                        <div className="absolute left-1/2 top-0 h-full w-px bg-gold-500/30" />
                        {/* Labels */}
                        <div className="absolute inset-0 flex items-center justify-between px-3">
                            <span className="text-[9px] text-red-400 font-mono">SELL {sellCount}</span>
                            <span className="text-[10px] text-gold-400 font-mono font-bold">{consensus}</span>
                            <span className="text-[9px] text-emerald-400 font-mono">BUY {buyCount}</span>
                        </div>
                    </div>

                    {/* Per-agent gauges */}
                    <div className="grid grid-cols-5 gap-1">
                        {votes.map(v => (
                            <div key={v.agentId} className="text-center space-y-0.5">
                                <div className="text-base">{v.icon}</div>
                                <ScoreGauge score={v.score} color={v.color} />
                                <div className={cn("text-[8px] font-mono", v.color)}>
                                    {v.vote}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Agent names */}
                    <div className="grid grid-cols-5 gap-1">
                        {votes.map(v => (
                            <div key={v.agentId} className={cn("text-[8px] text-center leading-tight", v.color)}>
                                {v.name.replace("AI", "").trim()}
                            </div>
                        ))}
                    </div>

                    {/* Disclaimer */}
                    <p className="text-[9px] text-gray-600 text-center">
                        ※ 市場データから自動算出。投資は自己責任で。
                    </p>
                </>
            )}
        </div>
    );
}
