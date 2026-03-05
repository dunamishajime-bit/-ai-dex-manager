"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";

function explorerUrl(chain?: string, hash?: string) {
    if (!hash) return "#";
    return chain === "Polygon" ? `https://polygonscan.com/tx/${hash}` : `https://bscscan.com/tx/${hash}`;
}

function formatJPY(value: number) {
    if (!Number.isFinite(value)) return "-";
    const abs = Math.abs(value);
    if (abs === 0) return "¥0";
    if (abs < 1) {
        return `¥${value.toLocaleString("ja-JP", { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
    }
    if (abs < 1000) {
        return `¥${value.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatAmount(value: number) {
    return Number.isFinite(value) ? value.toLocaleString("ja-JP", { maximumFractionDigits: 6 }) : "-";
}

const STABLE_QUOTES = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "USD1", "USDC.E"]);

export default function TraderBrainPage() {
    const { transactions, stopLossThreshold, takeProfitThreshold, convertJPY, allMarketData } = useSimulation();

    const reviewedTrades = useMemo(() => {
        return transactions.map((tx, index) => {
            const marketPriceUsd = allMarketData[tx.symbol]?.price || 0;
            const entryPriceUsd = tx.entryPrice && tx.entryPrice > 0
                ? tx.entryPrice
                : tx.price && tx.price > 0
                    ? tx.price
                    : marketPriceUsd;
            const currentPriceUsd = tx.price && tx.price > 0 ? tx.price : (marketPriceUsd || entryPriceUsd);
            const scalpTpPct = Math.max(1, Math.min(4, takeProfitThreshold));
            const scalpSlPct = Math.max(1, Math.min(3, Math.abs(stopLossThreshold)));
            const fallbackTakeProfitUsd = entryPriceUsd * (1 + scalpTpPct / 100);
            const fallbackStopLossUsd = entryPriceUsd * (1 - scalpSlPct / 100);
            const plannedTakeProfitUsd = Math.min(tx.plannedTakeProfit || fallbackTakeProfitUsd, entryPriceUsd * 1.04);
            const plannedStopLossUsd = Math.max(tx.plannedStopLoss || fallbackStopLossUsd, entryPriceUsd * 0.97);
            const pnlUsd =
                tx.pnl !== undefined
                    ? tx.pnl
                    : tx.type === "BUY" && entryPriceUsd > 0 && currentPriceUsd > 0
                        ? (currentPriceUsd - entryPriceUsd) * tx.amount
                        : undefined;

            const resultLabel =
                tx.type === "SELL"
                    ? (pnlUsd || 0) > 0
                        ? "利確"
                        : (pnlUsd || 0) < 0
                            ? "損切り"
                            : "建値決済"
                    : "新規エントリー";

            const resultClass =
                tx.type === "SELL"
                    ? (pnlUsd || 0) > 0
                        ? "border-emerald-500/30 text-emerald-400"
                        : (pnlUsd || 0) < 0
                            ? "border-rose-500/30 text-rose-400"
                            : "border-gray-500/20 text-gray-300"
                    : "border-sky-500/30 text-sky-400";

            const summary =
                tx.type === "SELL"
                    ? (pnlUsd || 0) < 0
                        ? `エントリー価格 ${formatJPY(convertJPY(entryPriceUsd))} に対して、決済価格 ${formatJPY(convertJPY(currentPriceUsd))} で損失確定しました。予定していた損切り目安 ${formatJPY(convertJPY(plannedStopLossUsd))} 付近で下振れを抑えています。`
                        : `エントリー価格 ${formatJPY(convertJPY(entryPriceUsd))} に対して、決済価格 ${formatJPY(convertJPY(currentPriceUsd))} で利益確定しました。予定していた利確目安 ${formatJPY(convertJPY(plannedTakeProfitUsd))} に沿った決済です。`
                    : `新規エントリー価格は ${formatJPY(convertJPY(currentPriceUsd))} です。利確候補は ${formatJPY(convertJPY(plannedTakeProfitUsd))}、損切り候補は ${formatJPY(convertJPY(plannedStopLossUsd))} として計画されています。`;
            const pairParts = (tx.pair || "").split("/");
            const sourceSymbol = (pairParts[0] || "").toUpperCase();
            const destinationSymbol = (pairParts[1] || tx.symbol || "").toUpperCase();
            const isReallocationBuy =
                tx.type === "BUY"
                && sourceSymbol.length > 0
                && destinationSymbol.length > 0
                && sourceSymbol !== destinationSymbol
                && !STABLE_QUOTES.has(sourceSymbol);
            const baseTriggerReason = tx.reason || "市場データ、ニュース、シグナルの総合判断に基づくトレードです。";
            const triggerReason =
                isReallocationBuy && !baseTriggerReason.includes("資金再配分")
                    ? `${baseTriggerReason}\n資金再配分理由: ${sourceSymbol} の比率を下げ、${tx.symbol.toUpperCase()} の短期優位シグナルを優先しました。`
                    : baseTriggerReason;

            return {
                ...tx,
                key: `${tx.id}-${index}`,
                entryPriceUsd,
                currentPriceUsd,
                plannedTakeProfitUsd,
                plannedStopLossUsd,
                pnlUsd,
                resultLabel,
                resultClass,
                summary,
                triggerReason,
            };
        });
    }, [transactions, stopLossThreshold, takeProfitThreshold, convertJPY, allMarketData]);

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">トレーダーブレイン</h1>
                    <p className="mt-1 text-sm text-gray-400">
                        各トレードの根拠、利確・損切り計画、最終結果を日本円ベースで確認できます。
                    </p>
                </div>

                <Link
                    href="/"
                    className="inline-flex items-center gap-2 rounded border border-gold-500/20 px-3 py-2 text-sm text-gold-400 transition-colors hover:bg-gold-500/10"
                >
                    <ArrowLeft className="h-4 w-4" />
                    ホームへ戻る
                </Link>
            </div>

            {reviewedTrades.length === 0 ? (
                <div className="rounded-xl border border-gold-500/10 bg-cyber-darker/60 p-8 text-center text-gray-400">
                    まだレビュー対象のトレードはありません。
                </div>
            ) : (
                <div className="space-y-6">
                    {reviewedTrades.map((tx) => (
                        <div key={tx.key} className="rounded-xl border border-gold-500/10 bg-cyber-darker/60 p-5">
                            <div className="mb-4 flex flex-wrap items-center gap-3">
                                <h2 className="text-2xl font-bold text-gold-400">
                                    {tx.symbol} {tx.type === "SELL" ? "決済レビュー" : "エントリー分析"}
                                </h2>
                                <span className={`rounded border px-2 py-1 text-xs font-bold ${tx.resultClass}`}>
                                    {tx.resultLabel}
                                </span>
                            </div>

                            <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-gray-400">
                                <span>{new Date(tx.timestamp).toLocaleString("ja-JP")}</span>
                                <span>{tx.chain || "BNB Chain"}</span>
                                <span>{tx.pair || `${tx.symbol}/USDT`}</span>
                                <span>{tx.dex || "ParaSwap"}</span>
                            </div>

                            <div className="grid gap-4 md:grid-cols-4">
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">エントリー価格</div>
                                    <div className="mt-2 text-3xl font-bold text-white">
                                        {formatJPY(convertJPY(tx.entryPriceUsd))}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">{tx.type === "SELL" ? "決済価格" : "現在価格"}</div>
                                    <div className="mt-2 text-3xl font-bold text-white">
                                        {tx.currentPriceUsd > 0 ? formatJPY(convertJPY(tx.currentPriceUsd)) : "価格取得中"}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">数量</div>
                                    <div className="mt-2 text-3xl font-bold text-white">
                                        {formatAmount(tx.amount)}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="text-xs text-gray-500">損益</div>
                                    <div
                                        className={`mt-2 text-3xl font-bold ${
                                            (tx.pnlUsd || 0) > 0 ? "text-emerald-400" : (tx.pnlUsd || 0) < 0 ? "text-rose-400" : "text-white"
                                        }`}
                                    >
                                        {tx.pnlUsd !== undefined ? formatJPY(convertJPY(tx.pnlUsd || 0)) : "計算中"}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                                <div className="mb-3 text-sm font-bold text-cyan-300">戦略プラン</div>
                                <div className="grid gap-3 text-sm text-gray-300 md:grid-cols-2">
                                    <div>
                                        <div className="text-xs text-gray-500">利確目安</div>
                                        <div className="mt-1 font-mono text-emerald-400">
                                            {formatJPY(convertJPY(tx.plannedTakeProfitUsd))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-gray-500">損切り目安</div>
                                        <div className="mt-1 font-mono text-rose-400">
                                            {formatJPY(convertJPY(tx.plannedStopLossUsd))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                                <div className="mb-2 text-sm font-bold text-emerald-300">戦略メモ</div>
                                <p className="text-sm leading-7 text-gray-200">{tx.summary}</p>
                            </div>

                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="mb-2 text-sm font-bold text-gray-300">トリガー</div>
                                    <p className="whitespace-pre-wrap text-sm text-gray-400">{tx.triggerReason}</p>
                                </div>
                                <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                                    <div className="mb-2 text-sm font-bold text-gray-300">関連ニュース</div>
                                    <p className="text-sm text-gray-400">{tx.newsTitle || "このトレードに紐づく関連ニュースは記録されていません。"}</p>
                                </div>
                            </div>

                            {tx.txHash ? (
                                <div className="mt-4 flex items-center justify-between gap-3">
                                    <div className="truncate font-mono text-xs text-gray-500">{tx.txHash}</div>
                                    <a
                                        href={explorerUrl(tx.chain, tx.txHash)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-gold-400 hover:text-gold-300"
                                    >
                                        エクスプローラー
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
