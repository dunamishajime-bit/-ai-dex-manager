"use client";

import { Card } from "@/components/ui/Card";
import { BarChart2, TrendingUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSimulation } from "@/context/SimulationContext";

export default function AnalysisPage() {
    const { latestDiscussion } = useSimulation();

    return (
        <div className="p-6 max-w-7xl mx-auto w-full space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                    <BarChart2 className="w-8 h-8 text-gold-500" />
                    <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        MARKET ANALYSIS
                    </span>
                </h1>
                <p className="text-gray-400 text-sm font-mono mt-1">AI-DRIVEN MARKET INSIGHTS</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card title="Market Sentiment" glow="primary" className="h-64">
                    <div className="flex items-center justify-center h-full flex-col gap-4">
                        <div className={cn(
                            "text-5xl font-bold transition-all duration-500",
                            latestDiscussion?.result.action === "BUY" ? "text-neon-green" :
                                latestDiscussion?.result.action === "SELL" ? "text-red-500" : "text-gold-500"
                        )}>
                            {latestDiscussion?.result.action || "ANALYZING..."}
                        </div>
                        <div className="text-gray-400 text-sm md:w-2/3 text-center px-4">
                            {latestDiscussion?.result.reasoning || "AI agents consensus is being calculated based on current market trends."}
                        </div>
                        {latestDiscussion && (
                            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                                Confidence: {latestDiscussion.result.confidence}%
                            </div>
                        )}
                    </div>
                </Card>

                <Card title="Volume Analysis" glow="secondary" className="h-64">
                    <div className="flex items-center justify-center h-full">
                        <p className="text-gray-500 animate-pulse">Analyzing on-chain data...</p>
                    </div>
                </Card>

                <Card title="Volatility Index" glow="danger" className="h-64">
                    <div className="flex items-center justify-center h-full flex-col gap-2">
                        <TrendingUp className="w-16 h-16 text-red-500" />
                        <div className="text-2xl font-bold text-red-500">HIGH (85/100)</div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
