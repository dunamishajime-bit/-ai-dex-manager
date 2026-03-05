"use client";

import { Card } from "@/components/ui/Card";
import { useSimulation, StrategyProposal } from "@/context/SimulationContext";
import { AGENTS } from "@/lib/ai-simulation";
import {
    Clock,
    X,
    Trash2,
    Settings2,
    Play,
    ArrowUpRight,
    ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    ReferenceDot,
    ReferenceLine,
    CartesianGrid,
} from "recharts";

const TIME_BLOCKS = ["0:00-6:00", "6:00-12:00", "12:00-18:00", "18:00-24:00"] as const;
const STRATEGY_START_CAPITAL = 30000;
const STRATEGY_DAILY_TARGET_CAPITAL = Math.round(STRATEGY_START_CAPITAL * 1.1);

function generate24hSimulation(
    startCapital: number,
    targetCapital: number,
    basePrice: number,
    riskLevel: number,
) {
    const points: { time: string; price: number; capital: number; action?: string; pnl?: number }[] = [];
    let currentPrice = basePrice;
    let capital = startCapital;
    let position = 0;
    let entryPrice = 0;
    const trades: { time: string; type: "BUY" | "SELL"; price: number; amount: number; pnl: number; capital: number }[] = [];

    const volatility = 0.003 * riskLevel;

    for (let i = 0; i <= 96; i++) {
        const hour = Math.floor((i * 15) / 60);
        const minute = (i * 15) % 60;
        const timeStr = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

        const trend = Math.sin(i / 12) * volatility * basePrice;
        const noise = (Math.random() - 0.45) * volatility * basePrice;
        currentPrice = Math.max(currentPrice + trend + noise, basePrice * 0.9);

        let action: string | undefined;
        let pnl = 0;

        if (position === 0) {
            const entryChance = i % Math.max(4, 12 - riskLevel * 2) === 0 && i > 0;
            if (entryChance && Math.random() > 0.3) {
                position = (capital * 0.3) / currentPrice;
                entryPrice = currentPrice;
                action = "BUY";
                trades.push({ time: timeStr, type: "BUY", price: currentPrice, amount: position, pnl: 0, capital });
            }
        } else {
            const priceChange = (currentPrice - entryPrice) / entryPrice;
            const takeProfit = priceChange > 0.005 * riskLevel;
            const stopLoss = priceChange < -0.003;

            if (takeProfit || stopLoss || i === 96) {
                pnl = (currentPrice - entryPrice) * position;
                capital += pnl;
                action = "SELL";
                trades.push({ time: timeStr, type: "SELL", price: currentPrice, amount: position, pnl, capital });
                position = 0;
                entryPrice = 0;
            }
        }

        if (i > 10 && capital < startCapital + (targetCapital - startCapital) * (i / 96) * 0.7) {
            capital += (targetCapital - startCapital) * (1 / 96) * (0.5 + Math.random());
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
        <div className="rounded-lg border border-gold-500/30 bg-black/95 p-3 shadow-xl">
            <div className="mb-1 text-xs font-mono text-gold-400">{label}</div>
            <div className="text-sm font-mono text-white">価格: ¥{(data.price * 150).toLocaleString()}</div>
            <div className="text-sm font-mono font-bold text-gold-400">資金: ¥{data.capital?.toLocaleString()}</div>
            {data.action ? (
                <div className={`mt-1 text-xs font-bold ${data.action === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                    {data.action === "BUY" ? "エントリー" : "決済"}
                    {data.pnl ? ` (${data.pnl > 0 ? "+" : ""}¥${data.pnl.toLocaleString()})` : ""}
                </div>
            ) : null}
        </div>
    );
}

function normalizeStrategySymbol(symbol?: string) {
    if (!symbol) return undefined;
    return symbol.toUpperCase() === "POL" ? "MATIC" : symbol.toUpperCase();
}

export default function StrategyPage() {
    const { strategyProposals, updateProposalStatus, deleteProposal, activeStrategies, marketData, selectedCurrency, allMarketData } =
        useSimulation();
    const [selectedStrategy, setSelectedStrategy] = useState<StrategyProposal | null>(null);
    const [showSimulation, setShowSimulation] = useState(false);

    const strategiesByBlock = TIME_BLOCKS.reduce((acc, block) => {
        acc[block] = activeStrategies.filter((strategy) => strategy.durationBlock === block);
        return acc;
    }, {} as Record<(typeof TIME_BLOCKS)[number], StrategyProposal[]>);

    const simulationData = useMemo(() => {
        if (!selectedStrategy) return null;
        const strategySymbol = normalizeStrategySymbol(selectedStrategy.assetSymbol) || selectedCurrency;
        const basePrice = allMarketData[strategySymbol]?.price || marketData.price;
        const riskLevel = selectedStrategy.proposedSettings?.riskTolerance || 3;
        return generate24hSimulation(STRATEGY_START_CAPITAL, STRATEGY_DAILY_TARGET_CAPITAL, basePrice, riskLevel);
    }, [allMarketData, marketData.price, selectedCurrency, selectedStrategy]);

    const handleStartDemo = (proposal: StrategyProposal) => {
        setSelectedStrategy(proposal);
        setShowSimulation(true);
    };

    const selectedSimulationSymbol = normalizeStrategySymbol(selectedStrategy?.assetSymbol) || selectedCurrency;

    return (
        <div className="space-y-6 overflow-y-auto p-6">
            <div>
                <h1 className="bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-3xl font-bold text-transparent">
                    ストラテジー
                </h1>
                <p className="mt-2 text-sm text-gray-400">
                    AI の提案通貨をベースに、1 日を 4 ブロックへ分けて戦略化します。実際の執行ではニュース・SNS・価格変動を見ながら柔軟に調整します。
                </p>
            </div>

            {showSimulation && simulationData && selectedStrategy ? (
                <div className="animate-in fade-in slide-in-from-top-5 duration-500">
                    <Card title={`24時間シミュレーション: ${selectedStrategy.title}`} glow="gold" className="relative">
                        <button
                            onClick={() => setShowSimulation(false)}
                            className="absolute right-4 top-4 z-10 text-gray-400 hover:text-white"
                        >
                            <X className="h-5 w-5" />
                        </button>

                        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                <div className="text-xs text-gray-400">初期資金</div>
                                <div className="text-lg font-mono font-bold text-white">¥{STRATEGY_START_CAPITAL.toLocaleString()}</div>
                            </div>
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                                <div className="text-xs text-emerald-400">目標資金</div>
                                <div className="text-lg font-mono font-bold text-emerald-400">¥{STRATEGY_DAILY_TARGET_CAPITAL.toLocaleString()}</div>
                            </div>
                            <div className="rounded-lg border border-gold-500/20 bg-gold-500/10 p-3">
                                <div className="text-xs text-gold-400">想定トレード数</div>
                                <div className="text-lg font-mono font-bold text-gold-400">{simulationData.trades.length}件</div>
                            </div>
                            <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-3">
                                <div className="text-xs text-purple-400">勝率</div>
                                <div className="text-lg font-mono font-bold text-purple-400">
                                    {simulationData.trades.filter((trade) => trade.pnl > 0).length > 0
                                        ? Math.round(
                                              (simulationData.trades.filter((trade) => trade.pnl > 0).length /
                                                  Math.max(
                                                      simulationData.trades.filter((trade) => trade.type === "SELL").length,
                                                      1,
                                                  )) *
                                                  100,
                                          )
                                        : 0}
                                    %
                                </div>
                            </div>
                        </div>

                        <div className="h-[350px] min-h-[350px] w-full">
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
                                    <YAxis
                                        stroke="#666"
                                        fontSize={10}
                                        domain={["dataMin - 2000", "dataMax + 5000"]}
                                        tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                                    />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area
                                        type="monotone"
                                        dataKey="capital"
                                        stroke="#eab308"
                                        strokeWidth={2}
                                        fill="url(#capitalGrad)"
                                        isAnimationActive
                                        animationDuration={2000}
                                    />
                                    {simulationData.points
                                        .filter((point) => point.action === "BUY")
                                        .map((point, index) => (
                                            <ReferenceDot
                                                key={`buy-${index}`}
                                                x={point.time}
                                                y={point.capital}
                                                r={6}
                                                fill="#10b981"
                                                stroke="#10b981"
                                                strokeWidth={2}
                                            />
                                        ))}
                                    {simulationData.points
                                        .filter((point) => point.action === "SELL")
                                        .map((point, index) => (
                                            <ReferenceDot
                                                key={`sell-${index}`}
                                                x={point.time}
                                                y={point.capital}
                                                r={6}
                                                fill="#ef4444"
                                                stroke="#ef4444"
                                                strokeWidth={2}
                                            />
                                        ))}
                                    <ReferenceLine
                                        y={STRATEGY_START_CAPITAL}
                                        stroke="#666"
                                        strokeDasharray="5 5"
                                        label={{ value: `初期資金 ¥${STRATEGY_START_CAPITAL.toLocaleString()}`, fill: "#999", fontSize: 10 }}
                                    />
                                    <ReferenceLine
                                        y={STRATEGY_DAILY_TARGET_CAPITAL}
                                        stroke="#10b981"
                                        strokeDasharray="5 5"
                                        label={{ value: `目標資金 ¥${STRATEGY_DAILY_TARGET_CAPITAL.toLocaleString()}`, fill: "#10b981", fontSize: 10 }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="mt-4 flex justify-center gap-6 text-xs text-gray-400">
                            <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full bg-emerald-500" />
                                <span>エントリー</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full bg-red-500" />
                                <span>決済</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-0.5 w-2 bg-gold-500" />
                                <span>資金推移</span>
                            </div>
                        </div>

                        <div className="mt-6 border-t border-white/10 pt-4">
                            <h4 className="mb-3 text-sm font-bold text-gold-400">トレード履歴</h4>
                            <div className="custom-scrollbar max-h-[200px] space-y-1 overflow-y-auto">
                                {simulationData.trades.map((trade, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center justify-between rounded bg-white/5 px-3 py-2 text-xs font-mono"
                                    >
                                        <div className="flex items-center gap-2">
                                            {trade.type === "BUY" ? (
                                                <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                                            ) : (
                                                <ArrowDownRight className="h-3 w-3 text-red-400" />
                                            )}
                                            <span className={trade.type === "BUY" ? "text-emerald-400" : "text-red-400"}>
                                                {trade.type}
                                            </span>
                                            <span className="text-gray-400">{trade.time}</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-white">
                                                ¥{(trade.price * 150).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </span>
                                            <span className="text-gray-400">
                                                {trade.amount.toFixed(4)} {selectedSimulationSymbol}
                                            </span>
                                            {trade.type === "SELL" ? (
                                                <span className={trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                                                    {trade.pnl >= 0 ? "+" : ""}
                                                    ¥{trade.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Card>
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {TIME_BLOCKS.map((block) => (
                    <Card key={block} title={block} glow={strategiesByBlock[block]?.length > 0 ? "gold" : "none"} className="min-h-[200px]">
                        {strategiesByBlock[block]?.length > 0 ? (
                            <div className="space-y-3">
                                {strategiesByBlock[block].map((strategy) => (
                                    <div
                                        key={strategy.id}
                                        className="flex items-start justify-between rounded border border-gold-500/30 bg-white/5 p-3"
                                    >
                                        <div>
                                            <div className="font-bold text-gold-400">{strategy.title}</div>
                                            <div className="mt-1 text-xs text-gray-400">{strategy.description}</div>
                                            <div className="mt-2 flex gap-2 text-xs">
                                                <span className="rounded bg-white/10 px-2 py-0.5">
                                                    通貨: {strategy.pairLabel || strategy.assetSymbol}
                                                </span>
                                                <span className="rounded bg-white/10 px-2 py-0.5">
                                                    リスク: {strategy.proposedSettings?.riskTolerance}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleStartDemo(strategy)}
                                                className="p-1 text-gold-400 hover:text-gold-300"
                                                title="シミュレーション"
                                            >
                                                <Play className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => deleteProposal(strategy.id)}
                                                className="p-1 text-gray-500 hover:text-red-400"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex h-full items-center justify-center text-sm italic text-gray-600">
                                この時間帯の戦略はまだありません
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                <Clock className="h-5 w-5 text-gold-500" />
                戦略提案履歴
            </h2>
            <div className="space-y-4">
                {strategyProposals.length === 0 ? (
                    <div className="py-8 text-center text-gray-500">提案履歴はまだありません</div>
                ) : null}
                {strategyProposals.map((proposal) => {
                    const agent = AGENTS.find((candidate) => candidate.id === proposal.agentId) || AGENTS[0];
                    const isActive = proposal.status === "ACTIVE";
                    return (
                        <div
                            key={proposal.id}
                            className={cn(
                                "glass-panel flex gap-4 rounded-lg border p-4 transition-all",
                                isActive ? "border-gold-500/50 bg-gold-500/10" : "border-white/5",
                            )}
                        >
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gray-800">
                                <img src={agent.avatar} alt={agent.name} className="h-full w-full object-cover" />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <span
                                            className={cn(
                                                "mb-2 inline-block rounded px-2 py-0.5 text-xs font-bold",
                                                proposal.status === "ACTIVE" ? "bg-gold-500 text-black" : "bg-gray-700 text-gray-300",
                                            )}
                                        >
                                            {proposal.status}
                                        </span>
                                        <h3 className="text-lg font-bold text-white">{proposal.title}</h3>
                                        <p className="mt-1 text-sm text-gray-400">{proposal.description}</p>
                                        {proposal.proposedSettings ? (
                                            <div className="mt-2 flex gap-2 text-[10px] font-mono text-gray-400">
                                                <span className="rounded bg-white/5 px-1.5 py-0.5">Risk: {proposal.proposedSettings.riskTolerance}</span>
                                                <span className="rounded bg-white/5 px-1.5 py-0.5">SL: {proposal.proposedSettings.stopLoss}%</span>
                                                <span className="rounded bg-white/5 px-1.5 py-0.5">TP: {proposal.proposedSettings.takeProfit}%</span>
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="text-xs font-mono text-gray-500">
                                        {new Date(proposal.timestamp).toLocaleString()}
                                    </div>
                                </div>
                                <div className="mt-4 flex justify-end gap-3">
                                    <button
                                        onClick={() => deleteProposal(proposal.id)}
                                        className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-white/5"
                                    >
                                        <Trash2 className="h-4 w-4" /> 削除
                                    </button>
                                    <button
                                        onClick={() => handleStartDemo(proposal)}
                                        className="flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-500/20 px-4 py-1.5 text-sm text-emerald-400 hover:bg-emerald-500/30"
                                    >
                                        <Play className="h-4 w-4" /> シミュレーション
                                    </button>
                                    <button
                                        onClick={() => updateProposalStatus(proposal.id, "ACTIVE")}
                                        className="flex items-center gap-1 rounded border border-gold-500/50 bg-gold-500/20 px-4 py-1.5 text-sm text-gold-500 hover:bg-gold-500/30"
                                    >
                                        <Settings2 className="h-4 w-4" /> 有効化
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
