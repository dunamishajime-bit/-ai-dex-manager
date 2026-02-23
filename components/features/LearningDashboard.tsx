import React, { useState } from "react";
import { useSimulation, Transaction } from "@/context/SimulationContext";
import { motion, AnimatePresence } from "framer-motion";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import { ThumbsUp, ThumbsDown, Activity, BrainCircuit } from "lucide-react";
import { Card } from "@/components/ui/Card";


export function LearningDashboard() {
    const { learningParams, transactions, provideTradeFeedback } = useSimulation();
    const [feedbackState, setFeedbackState] = useState<Record<string, "GOOD" | "BAD" | undefined>>({});

    // Filter only executed trades (ignore pending if any, though context currently has executed ones)
    // Show only last 10
    const recentTrades = transactions.slice(0, 10);

    const data = [
        { subject: "RSI", A: learningParams.rsiWeight, fullMark: 2.0 },
        { subject: "MACD", A: learningParams.macdWeight, fullMark: 2.0 },
        { subject: "市場心理", A: learningParams.sentimentWeight, fullMark: 2.0 },
        { subject: "ファンダ", A: learningParams.fundamentalWeight, fullMark: 2.0 },
        { subject: "安全性", A: learningParams.securityWeight, fullMark: 2.0 },
    ];

    const handleFeedback = (txId: string, type: "GOOD" | "BAD") => {
        provideTradeFeedback(txId, type);
        setFeedbackState(prev => ({ ...prev, [txId]: type }));
    };

    return (
        <Card title="AI学習ステータス" className="h-full flex flex-col">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
                {/* Left: Radar Chart & Stats */}
                <div className="flex flex-col h-full min-h-[300px]">
                    <div className="flex items-center gap-2 mb-2 text-xs text-gray-400">
                        <BrainCircuit className="w-4 h-4 text-cyan-400" />
                        <span>意思決定ウェイト可視化</span>
                    </div>

                    <div className="flex-1 w-full h-[200px] min-h-[200px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="60%" data={data}>
                                <PolarGrid stroke="#334155" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 2.0]} tick={false} axisLine={false} />
                                <Radar
                                    name="現在の重視度"
                                    dataKey="A"
                                    stroke="#ec4899"
                                    strokeWidth={2}
                                    fill="#ec4899"
                                    fillOpacity={0.3}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                                    itemStyle={{ color: '#ec4899' }}
                                />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                        <div className="bg-cyber-black/50 p-2 rounded border border-white/5">
                            <div className="text-[10px] text-gray-500 uppercase">勝率</div>
                            <div className="text-lg font-bold text-green-400">{(learningParams.winRate * 100).toFixed(0)}%</div>
                        </div>
                        <div className="bg-cyber-black/50 p-2 rounded border border-white/5">
                            <div className="text-[10px] text-gray-500 uppercase">総トレード数</div>
                            <div className="text-lg font-bold text-white">{learningParams.totalTrades}</div>
                        </div>
                        <div className="bg-cyber-black/50 p-2 rounded border border-white/5">
                            <div className="text-[10px] text-gray-500 uppercase">AIレベル</div>
                            <div className="text-lg font-bold text-gold-400">Lv.{Math.floor(learningParams.totalTrades / 5) + 1}</div>
                        </div>
                    </div>
                </div>

                {/* Right: Recent Trades Feedback */}
                <div className="flex flex-col h-full overflow-hidden border-t lg:border-t-0 lg:border-l border-white/5 lg:pl-4 pt-4 lg:pt-0">
                    <div className="flex items-center gap-2 mb-3 text-xs text-gray-400">
                        <Activity className="w-4 h-4 text-gold-400" />
                        <span>直近シグナルのレビュー</span>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                        {recentTrades.length === 0 && (
                            <div className="text-center text-gray-600 text-xs py-10 italic">
                                まだトレード記録がありません。
                            </div>
                        )}
                        <AnimatePresence>
                            {recentTrades.map((tx) => (
                                <motion.div
                                    key={tx.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="bg-white/5 rounded p-3 flex items-center justify-between group hover:bg-white/10 transition-colors"
                                >
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-bold ${tx.type === "BUY" ? "text-green-400" : "text-red-400"}`}>
                                                {tx.type} {tx.symbol}
                                            </span>
                                            <span className="text-[10px] text-gray-500">
                                                {new Date(tx.timestamp).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-1">
                                            {tx.dex} • ¥{tx.price.toLocaleString()}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {(tx.feedback || feedbackState[tx.id]) ? (
                                            <div className={`px-2 py-1 rounded text-xs font-bold ${(tx.feedback || feedbackState[tx.id]) === "GOOD"
                                                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                                : "bg-red-500/20 text-red-400 border border-red-500/30"
                                                }`}>
                                                {(tx.feedback || feedbackState[tx.id])}
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => handleFeedback(tx.id, "GOOD")}
                                                    className="p-1.5 rounded hover:bg-green-500/20 text-gray-500 hover:text-green-400 transition-colors"
                                                    title="Good Trade"
                                                >
                                                    <ThumbsUp className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleFeedback(tx.id, "BAD")}
                                                    className="p-1.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                                                    title="Bad Trade"
                                                >
                                                    <ThumbsDown className="w-4 h-4" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </Card>
    );
}
