import React, { useEffect, useState } from "react";
import { useSimulation } from "@/context/SimulationContext";
import { motion, AnimatePresence } from "framer-motion";
import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
    Tooltip,
} from "recharts";
import { ThumbsUp, ThumbsDown, Activity, BrainCircuit } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function LearningDashboard() {
    const { learningParams, transactions, provideTradeFeedback } = useSimulation();
    const [feedbackState, setFeedbackState] = useState<Record<string, "GOOD" | "BAD" | undefined>>({});
    const [chartsReady, setChartsReady] = useState(false);

    useEffect(() => {
        setChartsReady(true);
    }, []);

    const recentTrades = transactions.slice(0, 10);

    const data = [
        { subject: "RSI", A: learningParams.rsiWeight, fullMark: 2.0 },
        { subject: "MACD", A: learningParams.macdWeight, fullMark: 2.0 },
        { subject: "Sentiment", A: learningParams.sentimentWeight, fullMark: 2.0 },
        { subject: "Fundamental", A: learningParams.fundamentalWeight, fullMark: 2.0 },
        { subject: "Security", A: learningParams.securityWeight, fullMark: 2.0 },
    ];

    const handleFeedback = (txId: string, type: "GOOD" | "BAD") => {
        provideTradeFeedback(txId, type);
        setFeedbackState((prev) => ({ ...prev, [txId]: type }));
    };

    return (
        <Card title="AI Learning Status" className="flex h-full flex-col">
            <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="flex h-full min-h-[300px] flex-col">
                    <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                        <BrainCircuit className="h-4 w-4 text-cyan-400" />
                        <span>Current model weighting</span>
                    </div>

                    <div className="relative h-[200px] w-full min-h-[200px] flex-1">
                        {chartsReady ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="60%" data={data}>
                                    <PolarGrid stroke="#334155" />
                                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                                    <PolarRadiusAxis angle={30} domain={[0, 2.0]} tick={false} axisLine={false} />
                                    <Radar
                                        name="Weight"
                                        dataKey="A"
                                        stroke="#ec4899"
                                        strokeWidth={2}
                                        fill="#ec4899"
                                        fillOpacity={0.3}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: "#0f172a",
                                            borderColor: "#334155",
                                            color: "#f8fafc",
                                        }}
                                        itemStyle={{ color: "#ec4899" }}
                                    />
                                </RadarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex h-full items-center justify-center text-xs text-gray-500">
                                Loading chart...
                            </div>
                        )}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded border border-white/5 bg-cyber-black/50 p-2">
                            <div className="text-[10px] uppercase text-gray-500">Win Rate</div>
                            <div className="text-lg font-bold text-green-400">
                                {(learningParams.winRate * 100).toFixed(0)}%
                            </div>
                        </div>
                        <div className="rounded border border-white/5 bg-cyber-black/50 p-2">
                            <div className="text-[10px] uppercase text-gray-500">Trades</div>
                            <div className="text-lg font-bold text-white">{learningParams.totalTrades}</div>
                        </div>
                        <div className="rounded border border-white/5 bg-cyber-black/50 p-2">
                            <div className="text-[10px] uppercase text-gray-500">AI Level</div>
                            <div className="text-lg font-bold text-gold-400">
                                Lv.{Math.floor(learningParams.totalTrades / 5) + 1}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex h-full flex-col overflow-hidden border-t border-white/5 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                    <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
                        <Activity className="h-4 w-4 text-gold-400" />
                        <span>Recent trade feedback</span>
                    </div>

                    <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-2">
                        {recentTrades.length === 0 ? (
                            <div className="py-10 text-center text-xs italic text-gray-600">
                                No executed trades yet
                            </div>
                        ) : null}
                        <AnimatePresence>
                            {recentTrades.map((tx) => (
                                <motion.div
                                    key={tx.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="group flex items-center justify-between rounded bg-white/5 p-3 transition-colors hover:bg-white/10"
                                >
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`text-xs font-bold ${tx.type === "BUY" ? "text-green-400" : "text-red-400"}`}
                                            >
                                                {tx.type} {tx.symbol}
                                            </span>
                                            <span className="text-[10px] text-gray-500">
                                                {new Date(tx.timestamp).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-[10px] text-gray-400">
                                            {tx.dex} - ¥{tx.price.toLocaleString()}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {tx.feedback || feedbackState[tx.id] ? (
                                            <div
                                                className={`rounded border px-2 py-1 text-xs font-bold ${
                                                    (tx.feedback || feedbackState[tx.id]) === "GOOD"
                                                        ? "border-green-500/30 bg-green-500/20 text-green-400"
                                                        : "border-red-500/30 bg-red-500/20 text-red-400"
                                                }`}
                                            >
                                                {tx.feedback || feedbackState[tx.id]}
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => handleFeedback(tx.id, "GOOD")}
                                                    className="rounded p-1.5 text-gray-500 transition-colors hover:bg-green-500/20 hover:text-green-400"
                                                    title="Good Trade"
                                                >
                                                    <ThumbsUp className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleFeedback(tx.id, "BAD")}
                                                    className="rounded p-1.5 text-gray-500 transition-colors hover:bg-red-500/20 hover:text-red-400"
                                                    title="Bad Trade"
                                                >
                                                    <ThumbsDown className="h-4 w-4" />
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
