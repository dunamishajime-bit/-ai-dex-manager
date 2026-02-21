"use client";

import { Card } from "@/components/ui/Card";
import { useSimulation, ProposalFrequency } from "@/context/SimulationContext";
import { cn } from "@/lib/utils";
import { Shield, Target, AlertTriangle, Zap, Save } from "lucide-react";
import { useState } from "react";

export default function RiskSettingsPage() {
    const {
        riskTolerance, setRiskTolerance,
        stopLossThreshold, setStopLossThreshold,
        takeProfitThreshold, setTakeProfitThreshold,
        proposalFrequency, setProposalFrequency,
        requestProposal,
        isFlashEnabled, setIsFlashEnabled
    } = useSimulation();

    const [localRisk, setLocalRisk] = useState(riskTolerance);
    const [localSL, setLocalSL] = useState(stopLossThreshold);
    const [localTP, setLocalTP] = useState(takeProfitThreshold);

    const handleSave = () => {
        setRiskTolerance(localRisk);
        setStopLossThreshold(localSL);
        setTakeProfitThreshold(localTP);
        alert("リスク設定を保存しました。");
    };

    return (
        <div className="p-6 max-w-4xl mx-auto w-full space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">RISK CONTROL SETTINGS</h1>
                    <p className="text-gray-400 font-mono">リスク管理パラメータとAI戦略提案の設定</p>
                </div>
                <button
                    onClick={handleSave}
                    className="bg-gold-500 hover:bg-gold-600 text-black font-bold py-2 px-6 rounded-lg flex items-center gap-2 transition-colors shadow-[0_0_15px_rgba(255,215,0,0.3)]"
                >
                    <Save className="w-5 h-5" />
                    設定を保存
                </button>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* Global Risk Tolerance */}
                <Card title="AI リスク許容度" glow="primary">
                    <div className="flex items-start gap-6">
                        <div className="p-4 rounded-xl bg-neon-blue/10 text-neon-blue">
                            <Shield className="w-10 h-10" />
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between mb-2 font-mono">
                                <label>Risk Level (1-5)</label>
                                <span className="text-neon-blue font-bold text-xl">{localRisk}</span>
                            </div>
                            <input
                                type="range"
                                min="1" max="5" step="1"
                                value={localRisk}
                                onChange={(e) => setLocalRisk(parseInt(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-neon-blue"
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-2 font-mono">
                                <span>Conservative</span>
                                <span>Balanced</span>
                                <span>Aggressive</span>
                            </div>
                            <p className="mt-4 text-sm text-gray-400 bg-black/30 p-3 rounded border border-white/5">
                                レベルが高いほど、AIはボラティリティの高い資産への投資や、より頻繁なトレードを行う傾向があります。
                            </p>
                        </div>
                    </div>
                </Card>

                {/* Stop Loss & Take Profit */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card title="損切り設定 (Stop Loss)" glow="danger">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 text-red-500">
                                    <AlertTriangle className="w-5 h-5" />
                                    <span className="font-bold">Threshold</span>
                                </div>
                                <span className="font-mono text-2xl font-bold text-white">{localSL}%</span>
                            </div>
                            <input
                                type="range"
                                min="-20" max="-1" step="0.5"
                                value={localSL}
                                onChange={(e) => setLocalSL(parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                            />
                            <p className="text-xs text-gray-400">
                                24時間のドローダウンがこの値に達すると、AIは全ポジションを強制決済し、取引を停止します。
                            </p>
                        </div>
                    </Card>

                    <Card title="利益確定設定 (Take Profit)" glow="success">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 text-neon-green">
                                    <Target className="w-5 h-5" />
                                    <span className="font-bold">Target</span>
                                </div>
                                <span className="font-mono text-2xl font-bold text-white">+{localTP}%</span>
                            </div>
                            <input
                                type="range"
                                min="1" max="50" step="0.5"
                                value={localTP}
                                onChange={(e) => setLocalTP(parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-neon-green"
                            />
                            <p className="text-xs text-gray-400">
                                24時間の利益がこの値に達すると、AIはポジションの50%を自動的に利益確定します。
                            </p>
                        </div>
                    </Card>
                </div>

                {/* AI Strategy Proposals */}
                <Card title="AI 戦略提案設定" glow="secondary">
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-bold text-gray-300 mb-3">提案頻度 (Frequency)</label>
                            <div className="grid grid-cols-4 gap-4">
                                {(["OFF", "LOW", "MEDIUM", "HIGH"] as ProposalFrequency[]).map((freq) => (
                                    <button
                                        key={freq}
                                        onClick={() => setProposalFrequency(freq)}
                                        className={`py-2 px-4 rounded font-mono text-sm border transition-all ${proposalFrequency === freq
                                            ? "bg-gold-500 text-black border-gold-500 font-bold shadow-[0_0_10px_rgba(255,215,0,0.3)]"
                                            : "bg-black/30 text-gray-400 border-white/10 hover:bg-white/5"
                                            }`}
                                    >
                                        {freq}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                            <div>
                                <h4 className="font-bold text-white flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-gold-500" />
                                    マニュアル戦略提案
                                </h4>
                                <p className="text-xs text-gray-400 mt-1">現在の市場状況に基づき、AIに即座に新しい戦略を考案させます。</p>
                            </div>
                            <button
                                onClick={() => {
                                    requestProposal();
                                    alert("AIに戦略提案をリクエストしました。数秒以内に評議会で提案が行われます。");
                                }}
                                className="bg-white/10 hover:bg-white/20 border border-white/20 text-white py-2 px-4 rounded transition-colors"
                            >
                                提案をリクエスト
                            </button>
                        </div>
                    </div>
                </Card>

                {/* UI Settings */}
                <Card title="インターフェース設定" glow="none">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="font-bold text-white">約定フラッシュエフェクト</h4>
                            <p className="text-xs text-gray-400">取引実行時に画面全体をフラッシュさせて通知します。</p>
                        </div>
                        <div
                            onClick={() => setIsFlashEnabled(!isFlashEnabled)}
                            className={cn("w-12 h-6 rounded-full p-1 transition-colors flex items-center cursor-pointer", isFlashEnabled ? "bg-gold-500 justify-end" : "bg-gray-700 justify-start")}
                        >
                            <div className="w-4 h-4 rounded-full bg-black shadow-md" />
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
