"use client";

import { Asset } from "@/lib/assets";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Cpu, Shield, Zap, TrendingUp, BarChart3, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";

interface AIAgent {
    id: string;
    name: string;
    role: string;
    icon: any;
    color: string;
}

const AGENTS: AIAgent[] = [
    { id: "risk", name: "Risk Assessment Unit", role: "Probability & Drawdown Analysis", icon: Shield, color: "text-blue-400" },
    { id: "market", name: "Sentiment Analyzer", role: "Social & Market Linguistic Flow", icon: TrendingUp, color: "text-emerald-400" },
    { id: "macro", name: "Macro Economic Model", role: "Global Liquidity & Policy Analysis", icon: BarChart3, color: "text-purple-400" },
];

interface AIAnalysisPanelProps {
    selectedAsset: Asset | null;
}

export default function AIAnalysisPanel({ selectedAsset }: AIAnalysisPanelProps) {
    const [analysis, setAnalysis] = useState<Record<string, string>>({});
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    useEffect(() => {
        if (selectedAsset) {
            generateAnalysis(selectedAsset);
        }
    }, [selectedAsset]);

    const generateAnalysis = async (asset: Asset) => {
        setIsAnalyzing(true);
        // Simulate AI generation
        const mockAnalysis: Record<string, string> = {
            risk: `現在の${asset.name}のボラティリティは許容範囲内です。リスクスコア${asset.riskScore}%は、安定したトレンド形成を示唆しており、${asset.metrics[1]?.value}という指標もこれを裏付けています。`,
            market: `ソーシャルセンチメントとオンチェーンデータによると、${asset.symbol}に対する需要は現在${asset.status === 'ACTIVE' ? '強気' : '中立'}です。${asset.performance}%の騰落率は短期的な資金流入の影響を強く受けています。`,
            macro: `マクロ経済の観点からは、${asset.description} に関連する分野での流動性が高まっています。AI予測モデルは、次週のパフォーマンスが${asset.performance > 10 ? '継続的な成長' : '安定的な推移'}を見せると推論しています。`,
        };

        await new Promise(resolve => setTimeout(resolve, 1500));
        setAnalysis(mockAnalysis);
        setIsAnalyzing(false);
    };

    return (
        <div className="flex flex-col h-full bg-white/5 backdrop-blur-xl border-l border-white/10 p-6 overflow-y-auto w-80">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-blue-400" />
                AI Analysis Council
            </h2>

            <AnimatePresence mode="wait">
                {selectedAsset ? (
                    <motion.div
                        key={selectedAsset.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        {AGENTS.map((agent) => (
                            <div key={agent.id} className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-blue-500/30 transition-colors">
                                <div className="flex items-center gap-3 mb-2">
                                    <agent.icon className={`w-4 h-4 ${agent.color}`} />
                                    <div>
                                        <h4 className="text-sm font-bold text-white">{agent.name}</h4>
                                        <p className="text-[10px] text-white/40 uppercase tracking-tighter">{agent.role}</p>
                                    </div>
                                </div>
                                <p className="text-xs text-white/70 leading-relaxed font-sans">
                                    {isAnalyzing ? (
                                        <span className="flex gap-1">
                                            <span className="animate-bounce">.</span>
                                            <span className="animate-bounce [animation-delay:0.2s]">.</span>
                                            <span className="animate-bounce [animation-delay:0.4s]">.</span>
                                        </span>
                                    ) : analysis[agent.id]}
                                </p>
                            </div>
                        ))}
                    </motion.div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-white/20">
                        <Brain className="w-12 h-12 mb-2 opacity-10" />
                        <p className="text-sm italic text-center text-balance px-4">分析対象の資産を選択してください</p>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
