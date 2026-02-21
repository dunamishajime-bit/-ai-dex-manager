import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { CoinDetails } from '@/lib/dex-service';
import { GeminiDiscussionResult } from '@/lib/gemini-service';
import { Volume2, Play, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";
import { useAccount } from "wagmi";

interface AutoTradeSimulatorProps {
    marketData: CoinDetails | null;
    proposal: GeminiDiscussionResult["result"]["autoTradeProposal"];
    onClose: () => void;
}

export const AutoTradeSimulator: React.FC<AutoTradeSimulatorProps> = ({ marketData, proposal, onClose }) => {
    const { executeTrade, setDemoStrategy, setIsDemoMode, isDemoMode, isWalletConnected, portfolio, addMessage } = useSimulation();
    const { isConnected } = useAccount(); // Add wagmi to check actual connection
    const { formatPrice } = useCurrency();
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [simulating, setSimulating] = useState(false);
    const [simulationResult, setSimulationResult] = useState<{ pnl: number; winRate: number; trades: number } | null>(null);
    const [customAmount, setCustomAmount] = useState<number>(proposal?.amount || 10000);
    const [period, setPeriod] = useState<string>("7"); // default 7 days

    // Editable strategy values
    const [entryPrice, setEntryPrice] = useState<number>(proposal?.entryPrice || 0);
    const [targetPrice, setTargetPrice] = useState<number>(proposal?.targetPrice || 0);
    const [stopLoss, setStopLoss] = useState<number>(proposal?.stopLoss || 0);

    // Sync with market/proposal defaults
    useEffect(() => {
        if (marketData?.current_price && (!customAmount || customAmount === 10000)) {
            setCustomAmount(marketData.current_price);
        }
        if (proposal) {
            setEntryPrice(proposal.entryPrice);
            setTargetPrice(proposal.targetPrice);
            setStopLoss(proposal.stopLoss);
        }
    }, [marketData, proposal]);

    // Fetch historical data based on period
    useEffect(() => {
        if (!marketData) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                // Fetch days based on period selection
                const res = await fetch(`/api/coingecko?path=/coins/${marketData.id}/market_chart?vs_currency=usd&days=${period}`);
                const data = await res.json();
                if (data.prices) {
                    const formatted = data.prices.map(([time, price]: [number, number]) => ({
                        time,
                        price,
                        date: new Date(time).toLocaleDateString(),
                        hour: new Date(time).getHours() + ":00"
                    }));
                    setChartData(formatted);
                    // Reset simulation result when period changes
                    setSimulationResult(null);
                }
            } catch (e) {
                console.error("Failed to fetch chart data", e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [marketData, period]);

    const runSimulation = () => {
        setSimulating(true);
        // Mock simulation delay
        setTimeout(() => {
            if (!proposal || !marketData) return;

            const entry = entryPrice;
            const tp = targetPrice;
            const sl = stopLoss;

            // Realistic Backtest: Compare current price with 7d ago
            const price7dAgo = chartData.length > 0 ? chartData[0].price : entry;
            const perf7d = ((entry - price7dAgo) / price7dAgo) * 100;

            // Win rate logic based on probability of hitting TP vs SL
            const distToTp = Math.abs(tp - entry);
            const distToSl = Math.abs(entry - sl);
            const theoreticalWinRate = (distToSl / (distToSl + distToTp)) * 100;

            setSimulationResult({
                pnl: Math.floor(perf7d * proposal.amount / 100), // Performance over last 7 days applied to amount
                winRate: Math.round(Math.min(95, Math.max(5, theoreticalWinRate))),
                trades: 7
            });
            setSimulating(false);
        }, 1500);
    };

    if (!proposal) return null;

    const currentPrice = marketData?.current_price || 0;
    const isBuy = proposal.action === "BUY";
    const color = isBuy ? "#10b981" : "#ef4444"; // green : red

    // Execute Immediate Demo Trade
    const handleExecuteDemoTrade = () => {
        if (!marketData) return;

        // Determine strategy type based on risk/reward (simple heuristic)
        // Aggressive: Tight Stop, High Target
        // Conservative: Wide Stop, Low Target
        // We can just use "MODERATE" as default or infer
        if (!isConnected && !isDemoMode) {
            // If not connected, force demo mode for testing
            setIsDemoMode(true);
        }
        setDemoStrategy("MODERATE");

        if (isBuy) {
            if (customAmount > portfolio.cashbalance) {
                addMessage("manager", `⚠️ [資金超過] 指定金額（$${customAmount}）が現在の運用可能残高（$${portfolio.cashbalance.toFixed(2)}）を超えているため、取引をキャンセルしました。`, "ALERT");
                onClose();
                return;
            }
        } else {
            const pos = portfolio.positions.find(p => p.symbol === marketData.symbol);
            const amountInTokens = customAmount / marketData.current_price;
            if (!pos || pos.amount < amountInTokens) {
                addMessage("manager", `⚠️ [残高不足] ${marketData.symbol}の保有量（${pos?.amount || 0}）が不足しているため、売却をキャンセルしました。`, "ALERT");
                onClose();
                return;
            }
        }

        executeTrade(
            marketData.symbol,
            proposal.action as "BUY" | "SELL",
            customAmount / marketData.current_price, // Amount in tokens
            marketData.current_price,
            `Demo Strategy: ${proposal.reason.substring(0, 30)}...`
        );
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto pt-10 md:pt-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl shadow-2xl relative mb-10 md:my-0">
                {/* Header */}
                <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900 sticky top-0 z-10 rounded-t-xl">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <span className="text-2xl">🤖</span>
                            AI自動トレードシミュレーター
                            <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded ml-2">Beta</span>
                        </h2>
                        <p className="text-gray-400 text-sm mt-1">
                            過去データをモデルに、提案された戦略の期待値を算出します。
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
                    {/* Strategy Card */}
                    <div className="col-span-1 bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4">Proposed Strategy</h3>

                        <div className="space-y-4">
                            <div className={`p-3 rounded-lg border flex justify-between items-center ${isBuy ? 'bg-green-900/20 border-green-900' : 'bg-red-900/20 border-red-900'}`}>
                                <span className={isBuy ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{proposal.action}</span>
                                <span className="text-white font-mono">
                                    {formatPrice(proposal.entryPrice)}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="p-2 bg-gray-800 rounded border border-gray-700">
                                    <div className="text-gray-500 text-xs mb-1">Target (TP)</div>
                                    <input
                                        type="number"
                                        value={targetPrice}
                                        onChange={(e) => setTargetPrice(Number(e.target.value))}
                                        className="w-full bg-black border border-green-500/30 rounded px-2 py-1 text-green-400 font-mono text-xs focus:outline-none focus:border-green-500"
                                    />
                                </div>
                                <div className="p-2 bg-gray-800 rounded border border-gray-700">
                                    <div className="text-gray-500 text-xs mb-1">Stop (SL)</div>
                                    <input
                                        type="number"
                                        value={stopLoss}
                                        onChange={(e) => setStopLoss(Number(e.target.value))}
                                        className="w-full bg-black border border-red-500/30 rounded px-2 py-1 text-red-400 font-mono text-xs focus:outline-none focus:border-red-500"
                                    />
                                </div>
                            </div>

                            <div className="p-2 bg-gray-800 rounded border border-gray-700">
                                <div className="text-gray-500 text-xs mb-1">Entry Price</div>
                                <input
                                    type="number"
                                    value={entryPrice}
                                    onChange={(e) => setEntryPrice(Number(e.target.value))}
                                    className="w-full bg-black border border-blue-500/30 rounded px-2 py-1 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div className="pt-4 border-t border-gray-700">
                                <div className="text-xs text-gray-500 mb-2">運用設定</div>
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between items-end mb-2">
                                            <label className="text-[10px] text-gray-500 uppercase">運用金額 (USD)</label>
                                            <div className="text-[10px] text-gold-400 font-bold bg-gold-900/20 px-2 py-0.5 rounded border border-gold-900/30">
                                                {marketData?.name || marketData?.symbol || "TOKEN"}
                                            </div>
                                        </div>

                                        {/* Amount Preset Buttons */}
                                        <div className="grid grid-cols-2 gap-3 mb-3">
                                            {[200, 500, 1000, 10000].map(amount => (
                                                <button
                                                    key={amount}
                                                    onClick={() => setCustomAmount(amount)}
                                                    className={cn(
                                                        "py-4 px-2 rounded-xl font-bold transition-all border text-lg flex flex-col items-center justify-center shadow-lg active:scale-95",
                                                        customAmount === amount
                                                            ? "bg-gold-500 text-black border-gold-400 shadow-gold-500/20"
                                                            : "bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white"
                                                    )}
                                                >
                                                    <span className="text-xs font-normal opacity-70">USD</span>
                                                    ${amount.toLocaleString()}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Manual Input (Optional) */}
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={customAmount}
                                                onChange={(e) => setCustomAmount(Number(e.target.value))}
                                                className="w-full bg-black/40 border border-gray-700 rounded-lg py-2 px-3 text-sm text-gray-300 font-mono focus:outline-none focus:border-gold-500/50 text-right pr-8"
                                                placeholder="Custom Amount"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-600">USD</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-500 uppercase">シミュレーション期間</label>
                                        <div className="grid grid-cols-4 gap-1 mt-1">
                                            {[
                                                { label: '24h', val: '1' },
                                                { label: '7日', val: '7' },
                                                { label: '1ヶ月', val: '30' },
                                                { label: '6ヶ月', val: '180' },
                                                { label: '1年', val: '365' }
                                            ].map(p => (
                                                <button
                                                    key={p.val}
                                                    onClick={() => setPeriod(p.val)}
                                                    className={cn(
                                                        "py-1 text-[10px] rounded border transition-colors",
                                                        period === p.val
                                                            ? "bg-blue-600 border-blue-500 text-white"
                                                            : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"
                                                    )}
                                                >
                                                    {p.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {!simulationResult ? (
                                <button
                                    onClick={runSimulation}
                                    disabled={loading || simulating}
                                    className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-lg font-bold flex items-center justify-center gap-2 transition-all"
                                >
                                    {simulating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                    シミュレーション実行
                                </button>
                            ) : (
                                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 mt-4">
                                    <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-500/30 p-4 rounded-lg text-center">
                                        <div className="text-gray-400 text-xs mb-1">過去{period === '7' ? '7日間' : period === '30' ? '1ヶ月' : period === '180' ? '6ヶ月' : '1年間'}の仮想運用結果</div>
                                        <div className={`text-2xl font-bold mb-2 ${simulationResult.pnl > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {simulationResult.pnl > 0 ? '+' : ''}{((simulationResult.pnl / customAmount) * 100).toFixed(2)}%
                                        </div>

                                        <div className="text-gray-400 text-xs mb-1">期待勝率 / 推計利益</div>
                                        <div className="text-sm font-bold text-white">
                                            {simulationResult.winRate}% / {simulationResult.pnl >= 0 ? '+' : ''}{formatPrice(simulationResult.pnl)}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setSimulationResult(null)}
                                        className="w-full mt-4 py-2 border border-blue-900/50 hover:bg-blue-900/80 rounded text-sm text-blue-200 transition-colors"
                                    >
                                        再計算する
                                    </button>

                                    <button
                                        onClick={handleExecuteDemoTrade}
                                        className={cn(
                                            "w-full mt-3 py-4 font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg animate-pulse transition-all transform hover:scale-[1.02]",
                                            isConnected && !isDemoMode
                                                ? "bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 text-white shadow-red-500/20 ring-2 ring-red-500/50"
                                                : "bg-gradient-to-r from-gold-600 to-gold-400 hover:from-gold-500 hover:to-gold-300 text-black shadow-gold-500/20"
                                        )}
                                    >
                                        <Play className={cn("w-5 h-5", isConnected && !isDemoMode ? "text-white" : "fill-black")} />
                                        {isConnected && !isDemoMode ? "⚠️ 本番オンチェーン取引を実行" : "この戦略でデモトレード開始"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Chart Area */}
                    <div className="col-span-1 md:col-span-2 bg-gray-800/20 rounded-lg p-4 border border-gray-700 relative min-h-[300px]">
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
                                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                            </div>
                        )}
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4 flex justify-between">
                            <span>Market Context ({period === '7' ? '7 Days' : period === '30' ? '1 Month' : period === '180' ? '6 Months' : '1 Year'})</span>
                            <span className="text-xs normal-case text-gray-500">
                                {period === '7' ? `Vol: ${marketData?.price_change_percentage_7d_in_currency.toFixed(2)}%` : ''}
                            </span>
                        </h3>

                        <div className="h-[300px] w-full min-h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData}>
                                    <defs>
                                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                    <XAxis
                                        dataKey="time"
                                        hide
                                    />
                                    <YAxis
                                        domain={['auto', 'auto']}
                                        orientation="right"
                                        tickFormatter={(val) => val >= 1 ? `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${val.toFixed(4)}`}
                                        stroke="#9ca3af"
                                        fontSize={12}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }}
                                        formatter={(val: number | undefined) => [val !== undefined ? (val >= 1 ? `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `$${val.toFixed(6)}`) : '', "Price"]}
                                        labelFormatter={(label) => new Date(label).toLocaleString()}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="price"
                                        stroke="#3b82f6"
                                        fillOpacity={1}
                                        fill="url(#colorPrice)"
                                        strokeWidth={2}
                                    />
                                    {/* Strategy Lines */}
                                    <ReferenceLine y={entryPrice} stroke={color} strokeDasharray="3 3" label={{ position: 'left', value: 'ENTRY', fill: color, fontSize: 10 }} />
                                    <ReferenceLine y={targetPrice} stroke="#10b981" label={{ position: 'left', value: 'TP', fill: '#10b981', fontSize: 10 }} />
                                    <ReferenceLine y={stopLoss} stroke="#ef4444" label={{ position: 'left', value: 'SL', fill: '#ef4444', fontSize: 10 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="mt-2 text-xs text-gray-500 text-center">
                            ※ チャート上のラインは、AIが提案した現在の戦略レベルを示しています。
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
