"use client";

import { Card } from "@/components/ui/Card";
import { useSimulation, StrategyProposal } from "@/context/SimulationContext";
import { AGENTS } from "@/lib/ai-simulation";
import { Clock, Check, X, Trash2, Settings2, Play, TrendingUp, Target, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceLine, CartesianGrid } from "recharts";

function generate24hSimulation(
    strategyName: string, startCapital: number, targetCapital: number, basePrice: number, riskLevel: number
) {
    const points: { time: string; price: number; capital: number; action?: string; pnl?: number }[] = [];
    let currentPrice = basePrice;
    let capital = startCapital;
    let position = 0;
    let entryPrice = 0;
    const trades: { time: string; type: "BUY" | "SELL"; price: number; amount: number; pnl: number; capital: number }[] = [];

    const volatility = 0.003 * riskLevel;

    for (let i = 0; i <= 96; i++) {
        const hour = Math.floor(i * 15 / 60);
        const minute = (i * 15) % 60;
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

        const trend = Math.sin(i / 12) * volatility * basePrice;
        const noise = (Math.random() - 0.45) * volatility * basePrice;
        currentPrice = Math.max(currentPrice + trend + noise, basePrice * 0.9);

        let action: string | undefined;
        let pnl = 0;

        if (position === 0) {
            const entryChance = i % (Math.max(4, 12 - riskLevel * 2)) === 0 && i > 0;
            if (entryChance && Math.random() > 0.3) {
                position = capital * 0.3 / currentPrice;
                entryPrice = currentPrice;
                action = "BUY";
                trades.push({ time: timeStr, type: "BUY", price: currentPrice, amount: position, pnl: 0, capital });
            }
        } else {
            const priceChange = (currentPrice - entryPrice) / entryPrice;
            const takeProfit = priceChange > 0.005 * riskLevel;
            const stopLoss = priceChange < -0.003;

            if (takeProfit || stopLoss || (i === 96)) {
                pnl = (currentPrice - entryPrice) * position;
                capital += pnl;
                action = "SELL";
                trades.push({ time: timeStr, type: "SELL", price: currentPrice, amount: position, pnl, capital });
                position = 0;
                entryPrice = 0;
            }
        }

        if (i > 10 && capital < startCapital + (targetCapital - startCapital) * (i / 96) * 0.7) {
            const boost = (targetCapital - startCapital) * (1 / 96) * (0.5 + Math.random());
            capital += boost;
        }

        points.push({
            time: timeStr,
            price: parseFloat(currentPrice.toFixed(2)),
            capital: parseFloat(Math.max(capital, startCapital * 0.95).toFixed(0)),
            action,
            pnl: pnl ? parseFloat(pnl.toFixed(2)) : undefined,
        });
    }

    if (points.length > 0) {
        points[points.length - 1].capital = targetCapital;
    }

    return { points, trades };
}

function CustomTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
        <div className="bg-black/95 border border-gold-500/30 rounded-lg p-3 shadow-xl">
            <div className="text-xs text-gold-400 font-mono mb-1">{label}</div>
            <div className="text-sm text-white font-mono">価格: ¥{(data.price * 150).toLocaleString()}</div>
            <div className="text-sm text-gold-400 font-mono font-bold">資金: ¥{data.capital?.toLocaleString()}</div>
            {data.action && (
                <div className={`text-xs font-bold mt-1 ${data.action === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                    ● {data.action === "BUY" ? "エントリー" : "決済"} {data.pnl ? `(${data.pnl > 0 ? "+" : ""}¥${data.pnl.toLocaleString()})` : ""}
                </div>
            )}
        </div>
    );
}

export default function StrategyPage() {
    const { strategyProposals, updateProposalStatus, deleteProposal, activeStrategies, marketData, selectedCurrency, allMarketData } = useSimulation();
    const [selectedStrategy, setSelectedStrategy] = useState<StrategyProposal | null>(null);
    const [showSimulation, setShowSimulation] = useState(false);

    const timeBlocks = ["0:00-6:00", "6:00-12:00", "12:00-18:00", "18:00-24:00"];

    const strategiesByBlock = timeBlocks.reduce((acc, block) => {
        acc[block] = activeStrategies.filter(s => s.durationBlock === block);
        return acc;
    }, {} as Record<string, StrategyProposal[]>);

    const simulationData = useMemo(() => {
        if (!selectedStrategy) return null;
        const basePrice = allMarketData[selectedCurrency]?.price || marketData.price;
        const riskLevel = selectedStrategy.proposedSettings?.riskTolerance || 3;
        return generate24hSimulation(selectedStrategy.title, 30000, 100000, basePrice, riskLevel);
    }, [selectedStrategy, selectedCurrency, allMarketData, marketData.price]);

    const handleStartDemo = (proposal: StrategyProposal) => {
        setSelectedStrategy(proposal);
        setShowSimulation(true);
    };

    return (
        <div className="p-6 space-y-6 overflow-y-auto">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-transparent">
                トレード戦略管理
            </h1>

            {/* 24H Simulation Chart Overlay */}
            {showSimulation && simulationData && selectedStrategy && (
                <div className="animate-in fade-in slide-in-from-top-5 duration-500">
                    <Card title={`24h想定トレード: ${selectedStrategy.title}`} glow="gold" className="relative">
                        <button onClick={() => setShowSimulation(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white z-10">
                            <X className="w-5 h-5" />
                        </button>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                                <div className="text-xs text-gray-400">開始資金</div>
                                <div className="text-lg font-bold font-mono text-white">¥30,000</div>
                            </div>
                            <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
                                <div className="text-xs text-emerald-400">目標資金</div>
                                <div className="text-lg font-bold font-mono text-emerald-400">¥100,000</div>
                            </div>
                            <div className="bg-gold-500/10 rounded-lg p-3 border border-gold-500/20">
                                <div className="text-xs text-gold-400">トレード回数</div>
                                <div className="text-lg font-bold font-mono text-gold-400">{simulationData.trades.length}回</div>
                            </div>
                            <div className="bg-purple-500/10 rounded-lg p-3 border border-purple-500/20">
                                <div className="text-xs text-purple-400">勝率</div>
                                <div className="text-lg font-bold font-mono text-purple-400">
                                    {simulationData.trades.filter(t => t.pnl > 0).length > 0
                                        ? Math.round((simulationData.trades.filter(t => t.pnl > 0).length / Math.max(simulationData.trades.filter(t => t.type === "SELL").length, 1)) * 100)
                                        : 0}%
                                </div>
                            </div>
                        </div>

                        <div className="h-[350px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={simulationData.points}>
                                    <defs>
                                        <linearGradient id="capitalGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="time" stroke="#666" fontSize={10} interval={11} />
                                    <YAxis stroke="#666" fontSize={10} domain={['dataMin - 2000', 'dataMax + 5000']} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area type="monotone" dataKey="capital" stroke="#eab308" strokeWidth={2} fill="url(#capitalGrad)" isAnimationActive={true} animationDuration={2000} />
                                    {simulationData.points.filter(p => p.action === "BUY").map((p, i) => (
                                        <ReferenceDot key={`buy-${i}`} x={p.time} y={p.capital} r={6} fill="#10b981" stroke="#10b981" strokeWidth={2} />
                                    ))}
                                    {simulationData.points.filter(p => p.action === "SELL").map((p, i) => (
                                        <ReferenceDot key={`sell-${i}`} x={p.time} y={p.capital} r={6} fill="#ef4444" stroke="#ef4444" strokeWidth={2} />
                                    ))}
                                    <ReferenceLine y={30000} stroke="#666" strokeDasharray="5 5" label={{ value: "開始: ¥30,000", fill: "#999", fontSize: 10 }} />
                                    <ReferenceLine y={100000} stroke="#10b981" strokeDasharray="5 5" label={{ value: "目標: ¥100,000", fill: "#10b981", fontSize: 10 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="flex gap-6 mt-4 text-xs text-gray-400 justify-center">
                            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500" /><span>エントリー (BUY)</span></div>
                            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500" /><span>決済 (SELL)</span></div>
                            <div className="flex items-center gap-2"><div className="w-2 h-0.5 bg-gold-500" /><span>資金推移</span></div>
                        </div>

                        <div className="mt-6 border-t border-white/10 pt-4">
                            <h4 className="text-sm font-bold text-gold-400 mb-3">トレード詳細</h4>
                            <div className="max-h-[200px] overflow-y-auto custom-scrollbar space-y-1">
                                {simulationData.trades.map((trade, i) => (
                                    <div key={i} className="flex items-center justify-between bg-white/5 rounded px-3 py-2 text-xs font-mono">
                                        <div className="flex items-center gap-2">
                                            {trade.type === "BUY" ? <ArrowUpRight className="w-3 h-3 text-emerald-400" /> : <ArrowDownRight className="w-3 h-3 text-red-400" />}
                                            <span className={trade.type === "BUY" ? "text-emerald-400" : "text-red-400"}>{trade.type}</span>
                                            <span className="text-gray-400">{trade.time}</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-white">¥{(trade.price * 150).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                            <span className="text-gray-400">{trade.amount.toFixed(4)} {selectedCurrency}</span>
                                            {trade.type === "SELL" && (
                                                <span className={trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                                                    {trade.pnl >= 0 ? "+" : ""}¥{trade.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {/* Daily Plan Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {timeBlocks.map(block => (
                    <Card key={block} title={block} glow={strategiesByBlock[block]?.length > 0 ? "gold" : "none"} className="min-h-[200px]">
                        {strategiesByBlock[block]?.length > 0 ? (
                            <div className="space-y-3">
                                {strategiesByBlock[block].map(s => (
                                    <div key={s.id} className="bg-white/5 p-3 rounded border border-gold-500/30 flex justify-between items-start">
                                        <div>
                                            <div className="font-bold text-gold-400">{s.title}</div>
                                            <div className="text-xs text-gray-400 mt-1">{s.description}</div>
                                            <div className="flex gap-2 mt-2 text-xs">
                                                <span className="bg-white/10 px-2 py-0.5 rounded">リスク: {s.proposedSettings?.riskTolerance}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleStartDemo(s)} className="text-gold-400 hover:text-gold-300 p-1" title="デモトレード開始">
                                                <Play className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => deleteProposal(s.id)} className="text-gray-500 hover:text-red-400 p-1">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-600 text-sm italic">
                                戦略未設定 (AIが提案中...)
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            {/* Proposal History */}
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-gold-500" />
                戦略提案履歴
            </h2>
            <div className="space-y-4">
                {strategyProposals.length === 0 && (
                    <div className="text-gray-500 text-center py-8">履歴はありません</div>
                )}
                {strategyProposals.map((proposal) => {
                    const agent = AGENTS.find(a => a.id === proposal.agentId) || AGENTS[0];
                    const isActive = proposal.status === "ACTIVE";
                    return (
                        <div key={proposal.id} className={cn("glass-panel p-4 rounded-lg flex gap-4 border transition-all",
                            isActive ? "border-gold-500/50 bg-gold-500/10" : "border-white/5"
                        )}>
                            <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden border border-white/10">
                                <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <span className={cn("text-xs font-bold px-2 py-0.5 rounded mb-2 inline-block",
                                            proposal.status === "ACTIVE" ? "bg-gold-500 text-black" : "bg-gray-700 text-gray-300"
                                        )}>{proposal.status}</span>
                                        <h3 className="text-lg font-bold text-white">{proposal.title}</h3>
                                        <p className="text-gray-400 text-sm mt-1">{proposal.description}</p>
                                        {proposal.proposedSettings && (
                                            <div className="flex gap-2 mt-2 text-[10px] font-mono text-gray-400">
                                                <span className="bg-white/5 px-1.5 py-0.5 rounded">Risk: {proposal.proposedSettings.riskTolerance}</span>
                                                <span className="bg-white/5 px-1.5 py-0.5 rounded">SL: {proposal.proposedSettings.stopLoss}%</span>
                                                <span className="bg-white/5 px-1.5 py-0.5 rounded">TP: {proposal.proposedSettings.takeProfit}%</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 font-mono">{new Date(proposal.timestamp).toLocaleString()}</div>
                                </div>
                                <div className="flex gap-3 mt-4 justify-end">
                                    <button onClick={() => deleteProposal(proposal.id)} className="px-3 py-1.5 rounded text-sm text-gray-400 hover:bg-white/5 flex items-center gap-1">
                                        <Trash2 className="w-4 h-4" /> 削除
                                    </button>
                                    <button onClick={() => handleStartDemo(proposal)} className="px-4 py-1.5 rounded text-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30 flex items-center gap-1">
                                        <Play className="w-4 h-4" /> デモトレード
                                    </button>
                                    <button onClick={() => updateProposalStatus(proposal.id, "ACTIVE")} className="px-4 py-1.5 rounded text-sm bg-gold-500/20 text-gold-500 border border-gold-500/50 hover:bg-gold-500/30 flex items-center gap-1">
                                        <Settings2 className="w-4 h-4" /> 設定・適用
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
