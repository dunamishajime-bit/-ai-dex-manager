import React, { useState } from 'react';
import { useSimulation } from "@/context/SimulationContext";
import { Shield, TrendingUp, Zap, HelpCircle, X, Check, ArrowRight } from "lucide-react";

export const RiskToleranceSetup: React.FC = () => {
    const { setRiskTolerance, riskTolerance, unlockAchievement } = useSimulation();
    const [isOpen, setIsOpen] = useState(false);
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState<number[]>([]);

    // Check if initial setup is needed
    React.useEffect(() => {
        const setupDone = localStorage.getItem("jdex_risk_setup_done");
        if (!setupDone) {
            setIsOpen(true);
        }
    }, []);

    const questions = [
        {
            text: "投資の主な目的は何ですか？",
            options: [
                { label: "資産を守りながら少し増やす (安定重視)", value: 1 },
                { label: "バランスよく増やしたい (バランス型)", value: 3 },
                { label: "短期間で大きく増やしたい (ハイリターン)", value: 5 }
            ]
        },
        {
            text: "一時的な資産の減少（ドローダウン）についてどう感じますか？",
            options: [
                { label: "5%でも減ると不安で眠れない", value: 1 },
                { label: "20%くらいなら許容範囲", value: 3 },
                { label: "50%減っても復活を信じて待てる", value: 5 }
            ]
        },
        {
            text: "これまでの投資経験は？",
            options: [
                { label: "全くの未経験", value: 1 },
                { label: "少し経験がある", value: 3 },
                { label: "数年の経験がある", value: 4 }, // slight boost
            ]
        }
    ];

    const handleAnswer = (val: number) => {
        const newAnswers = [...answers, val];
        setAnswers(newAnswers);

        if (step < questions.length - 1) {
            setStep(step + 1);
        } else {
            // Calculate result
            const sum = newAnswers.reduce((a, b) => a + b, 0);
            const avg = Math.round(sum / questions.length);
            const result = Math.max(1, Math.min(5, avg)); // 1-5

            setRiskTolerance(result);
            localStorage.setItem("jdex_risk_setup_done", "true");
            unlockAchievement("risk-setup-done");
            setStep(step + 1); // Show result screen
        }
    };

    const getResultLabel = (score: number) => {
        if (score <= 2) return "堅実運用タイプ (Conservative)";
        if (score <= 3) return "バランス運用タイプ (Moderate)";
        return "積極運用タイプ (Aggressive)";
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

                <button
                    onClick={() => setIsOpen(false)}
                    className="absolute top-4 right-4 text-gray-500 hover:text-white"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="p-8 text-center">
                    {step < questions.length ? (
                        <>
                            <div className="mb-6 inline-flex p-3 bg-blue-500/10 rounded-full text-blue-400">
                                <HelpCircle className="w-8 h-8" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">AIリスク許容度診断</h2>
                            <p className="text-gray-400 text-sm mb-8">
                                あなたに最適な運用戦略をAIが提案するために、<br />いくつかの質問にお答えください。
                                ({step + 1}/{questions.length})
                            </p>

                            <h3 className="text-lg font-medium text-white mb-6">
                                Q. {questions[step].text}
                            </h3>

                            <div className="space-y-3">
                                {questions[step].options.map((opt, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleAnswer(opt.value)}
                                        className="w-full p-4 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-blue-500/50 transition-all text-left group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-300 group-hover:text-white transition-colors">{opt.label}</span>
                                            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="py-4 animate-in zoom-in duration-500">
                            <div className="mb-6 inline-flex p-4 bg-green-500/10 rounded-full text-green-400 ring-2 ring-green-500/20">
                                <Check className="w-10 h-10" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">診断完了</h2>
                            <p className="text-gray-400 text-sm mb-6">
                                あなたの投資タイプは...
                            </p>

                            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 p-6 rounded-xl mb-8">
                                <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-2">
                                    {getResultLabel(riskTolerance)}
                                </div>
                                <div className="flex justify-center gap-1 mt-2">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <div
                                            key={i}
                                            className={`h-2 w-8 rounded-full ${i <= riskTolerance ? "bg-blue-500" : "bg-gray-700"}`}
                                        />
                                    ))}
                                </div>
                                <p className="text-xs text-gray-500 mt-4">
                                    この設定に基づいて、AIが最適なポートフォリオとトレード戦略を提案します。設定はいつでも変更可能です。
                                </p>
                            </div>

                            <button
                                onClick={() => setIsOpen(false)}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all"
                            >
                                AIにおまかせ運用を開始する
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};


