"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";

function txUrl(chain?: string, hash?: string) {
    if (!hash) return "#";
    return chain === "Polygon"
        ? `https://polygonscan.com/tx/${hash}`
        : `https://bscscan.com/tx/${hash}`;
}

export default function TraderBrainPage() {
    const { transactions, stopLossThreshold, takeProfitThreshold, convertJPY } = useSimulation();

    const reviewedTrades = useMemo(() => {
        return transactions.map((tx, index) => {
            const triggerReason = tx.reason || "Entry was executed based on the market snapshot available at that time.";
            const entryPrice = tx.entryPrice || tx.price;
            const plannedTakeProfit = tx.plannedTakeProfit || entryPrice * (1 + takeProfitThreshold / 100);
            const plannedStopLoss = tx.plannedStopLoss || entryPrice * (1 + stopLossThreshold / 100);
            const outcomeLabel = tx.type === "SELL"
                ? ((tx.pnl || 0) > 0 ? "Take Profit" : (tx.pnl || 0) < 0 ? "Stop Loss" : "Flat Exit")
                : "New Entry";
            const outcomeClass = tx.type === "SELL"
                ? ((tx.pnl || 0) > 0 ? "text-emerald-400 border-emerald-500/30" : (tx.pnl || 0) < 0 ? "text-rose-400 border-rose-500/30" : "text-gray-300 border-gray-500/20")
                : "text-sky-400 border-sky-500/30";

            const explicitExplanation = tx.type === "SELL"
                ? ((tx.pnl || 0) < 0
                    ? `The position entered at ${entryPrice.toFixed(4)} USD and closed at ${tx.price.toFixed(4)} USD for a loss. The trade was closed near the planned stop level of ${plannedStopLoss.toFixed(4)} USD to limit further downside.`
                    : `The position entered at ${entryPrice.toFixed(4)} USD and closed at ${tx.price.toFixed(4)} USD for a gain. The exit aligned with the planned take-profit level of ${plannedTakeProfit.toFixed(4)} USD.`)
                : `A new position was opened at ${tx.price.toFixed(4)} USD with a planned take-profit at ${plannedTakeProfit.toFixed(4)} USD and a planned stop at ${plannedStopLoss.toFixed(4)} USD.`;

            return {
                ...tx,
                key: `${tx.id}-${index}`,
                triggerReason,
                plannedTakeProfit,
                plannedStopLoss,
                entryPrice,
                outcomeLabel,
                outcomeClass,
                explicitExplanation,
            };
        });
    }, [transactions, stopLossThreshold, takeProfitThreshold]);

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">TraderBrain</h1>
                    <p className="mt-1 text-sm text-gray-400">
                        Review each trade with entry context, planned exits, and realized outcome.
                    </p>
                </div>
                <Link href="/" className="inline-flex items-center gap-2 rounded border border-gold-500/20 px-3 py-2 text-sm text-gold-400 transition-colors hover:bg-gold-500/10">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Terminal
                </Link>
            </div>

            {reviewedTrades.length === 0 ? (
                <div className="rounded-xl border border-gold-500/10 bg-cyber-darker/60 p-8 text-center text-gray-400">
                    No reviewed trades yet.
                </div>
            ) : (
                <div className="space-y-6">
                    {reviewedTrades.map((tx) => (
                        <div key={tx.key} className="rounded-xl border border-gold-500/10 bg-cyber-darker/60 p-5">
                            <div className="mb-4 flex flex-wrap items-center gap-3">
                                <h2 className="text-2xl font-bold text-gold-400">
                                    {tx.symbol} {tx.type === "SELL" ? "Exit Review" : "Entry Analysis"}
                                </h2>
                                <span className={`rounded border px-2 py-1 text-xs font-bold ${tx.outcomeClass}`}>{tx.outcomeLabel}</span>
                            </div>

                            <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-gray-400">
                                <span>{new Date(tx.timestamp).toLocaleString("ja-JP")}</span>
                                <span>{tx.chain || "BNB Chain"}</span>
                                <span>{tx.pair || `${tx.symbol}/USDT`}</span>
                                <span>{tx.dex || "ParaSwap"}</span>
                            </div>

                            <div className="grid gap-4 md:grid-cols-4">
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">Entry Price</div>
                                    <div className="mt-2 text-3xl font-bold text-white">
                                        JPY {Math.round(convertJPY(tx.entryPrice)).toLocaleString("ja-JP")}
                                    </div>
                                </div>
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">Fill / Exit Price</div>
                                    <div className="mt-2 text-3xl font-bold text-white">
                                        JPY {Math.round(convertJPY(tx.price)).toLocaleString("ja-JP")}
                                    </div>
                                </div>
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">Amount</div>
                                    <div className="mt-2 text-3xl font-bold text-white">{tx.amount.toFixed(6)}</div>
                                </div>
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">PnL</div>
                                    <div className={`mt-2 text-3xl font-bold ${(tx.pnl || 0) > 0 ? "text-emerald-400" : (tx.pnl || 0) < 0 ? "text-rose-400" : "text-white"}`}>
                                        {tx.pnl !== undefined ? `JPY ${Math.round(convertJPY(tx.pnl || 0)).toLocaleString("ja-JP")}` : "Pending"}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                                <div className="mb-2 text-sm font-bold text-cyan-300">Trade Plan</div>
                                <div className="grid gap-3 text-sm text-gray-300 md:grid-cols-2">
                                    <div>Take Profit: {tx.plannedTakeProfit.toFixed(4)} USD</div>
                                    <div>Stop Loss: {tx.plannedStopLoss.toFixed(4)} USD</div>
                                </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                                <div className="mb-2 text-sm font-bold text-emerald-300">Outcome Notes</div>
                                <p className="text-sm leading-7 text-gray-200">{tx.explicitExplanation}</p>
                            </div>

                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="mb-2 text-sm font-bold text-gray-300">Trigger</div>
                                    <p className="text-sm text-gray-400">{tx.triggerReason}</p>
                                </div>
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="mb-2 text-sm font-bold text-gray-300">Related News</div>
                                    <p className="text-sm text-gray-400">{tx.newsTitle || "No related news was stored for this trade."}</p>
                                </div>
                            </div>

                            {tx.txHash ? (
                                <div className="mt-4 flex items-center justify-between gap-3">
                                    <div className="truncate font-mono text-xs text-gray-500">{tx.txHash}</div>
                                    <a
                                        href={txUrl(tx.chain, tx.txHash)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-gold-400 hover:text-gold-300"
                                    >
                                        Explorer
                                        <ExternalLink className="h-4 w-4" />
                                    </a>
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
