"use client";

import { useMemo } from "react";
import { Bot, Clock3, ShieldCheck, Target, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useSimulation, type Transaction, type WalletHoldingRow } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";
import {
    getProxyExecutionAssetLabel,
    getProxyExecutionHeadingLabel,
    isKnownProxyExecutionTarget,
    normalizeExecutionTarget,
} from "@/lib/proxy-assets";

function formatPct(value: number) {
    if (!Number.isFinite(value)) return "-";
    const clamped = Math.max(-99, Math.min(999, value));
    return `${clamped >= 0 ? "+" : ""}${clamped.toFixed(1)}%`;
}

function normalizeSymbol(value?: string) {
    return String(value || "").replace(/\.SOL$/i, "").trim().toUpperCase();
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceHoldingNarrative(text: string, strategySymbol: string, holdingLabel: string) {
    if (!text) return text;
    const normalizedStrategySymbol = normalizeSymbol(strategySymbol);
    const patterns = [
        normalizedStrategySymbol ? new RegExp(escapeRegExp(`${normalizedStrategySymbol} (Solana)`), "gi") : null,
        strategySymbol ? new RegExp(escapeRegExp(strategySymbol), "gi") : null,
        normalizedStrategySymbol ? new RegExp(escapeRegExp(normalizedStrategySymbol), "gi") : null,
    ].filter((pattern): pattern is RegExp => Boolean(pattern));

    return patterns.reduce((current, pattern) => current.replace(pattern, holdingLabel), text);
}

function getHoldingLabel(row: WalletHoldingRow, tx?: Transaction) {
    const rowAddress = normalizeExecutionTarget(row.address);
    const executionTarget = normalizeExecutionTarget(tx?.executionTarget);
    const proxyLabel = getProxyExecutionAssetLabel(rowAddress) || getProxyExecutionAssetLabel(executionTarget);
    return proxyLabel || (row.displaySymbol || row.symbol).replace(/\.SOL$/i, "");
}

function getHeadingLabel(row: WalletHoldingRow, tx: Transaction | undefined, holdingLabel: string) {
    const rowAddress = normalizeExecutionTarget(row.address);
    const executionTarget = normalizeExecutionTarget(tx?.executionTarget);
    const proxyHeading = getProxyExecutionHeadingLabel(rowAddress) || getProxyExecutionHeadingLabel(executionTarget);
    return proxyHeading || (row.displaySymbol || holdingLabel || row.symbol).replace(/\.SOL$/i, "");
}

function deriveHoldingWindow(tx?: Transaction) {
    if (tx?.reviewExitPlan) {
        if (tx.reviewExitPlan.includes("24")) return "12-24h";
        if (tx.reviewExitPlan.includes("12")) return "6-12h";
        if (tx.reviewExitPlan.includes("6")) return "3-6h";
    }

    const sizeLabel = String(tx?.positionSizeLabel || "");
    if (tx?.regime === "Trend") {
        return sizeLabel === "0.5x" ? "12-24h" : "6-12h";
    }

    if (tx?.regime === "Range") {
        return sizeLabel === "0.2x" ? "2-6h" : "4-12h";
    }

    return "4-12h";
}

function deriveReasonFallback(tx?: Transaction) {
    if (tx?.reviewReason) return tx.reviewReason;
    if (tx?.reviewDetail) return tx.reviewDetail;
    if (tx?.reason) return tx.reason;
    return "AI review is checking whether holding or defending this position is the better choice.";
}

function deriveStrategyFallback(
    tx: Transaction | undefined,
    targetPrice: number,
    stopPrice: number,
    formatPrice: (value: number) => string,
) {
    if (tx?.reviewStrategy) return tx.reviewStrategy;

    if (tx?.regime === "Trend") {
        return `Trend bias stays constructive while price can work toward ${formatPrice(targetPrice)}. Review defensively below ${formatPrice(stopPrice)}.`;
    }

    if (tx?.regime === "Range") {
        return `Range rebound setup aims for ${formatPrice(targetPrice)} with a defensive review below ${formatPrice(stopPrice)}.`;
    }

    return `Current plan is to use ${formatPrice(targetPrice)} as the upside target and ${formatPrice(stopPrice)} as the defense line.`;
}

function isReasonableMultiplier(value: number, min: number, max: number) {
    return Number.isFinite(value) && value >= min && value <= max;
}

function findLatestBuyTransaction(row: WalletHoldingRow, transactions: Transaction[]) {
    const normalizedHolding = normalizeSymbol(row.symbol);
    const holdingAddress = normalizeExecutionTarget(row.address);
    const isProxyHolding = Boolean(holdingAddress && isKnownProxyExecutionTarget(holdingAddress));

    return [...transactions].reverse().find((tx) => {
        if (tx.type !== "BUY") return false;

        const executionTarget = normalizeExecutionTarget(tx.executionTarget);
        if (holdingAddress && executionTarget && holdingAddress === executionTarget) {
            return true;
        }

        if (isProxyHolding) {
            return tx.routeType === "proxy" && normalizeSymbol(tx.symbol) === normalizedHolding;
        }

        return normalizeSymbol(tx.symbol) === normalizedHolding;
    });
}

export function OpenAiHoldingsStrategyPanel() {
    const { walletHoldings, transactions } = useSimulation();
    const { formatPrice } = useCurrency();

    const combinedTotalUsd = useMemo(
        () => walletHoldings.reduce((sum, row) => sum + (Number.isFinite(row.usdValue) ? row.usdValue : 0), 0),
        [walletHoldings],
    );

    const qualifyingRows = useMemo(() => {
        const threshold = combinedTotalUsd * 0.25;

        return walletHoldings
            .filter((row) => !row.isStable && !row.isGasReserve && row.usdValue >= threshold)
            .sort((left, right) => right.usdValue - left.usdValue)
            .map((row) => {
                const latestBuy = findLatestBuyTransaction(row, transactions);
                const holdingLabel = getHoldingLabel(row, latestBuy);
                const headingLabel = getHeadingLabel(row, latestBuy, holdingLabel);
                const rowAddress = normalizeExecutionTarget(row.address);
                const isProxyHolding = Boolean(
                    (rowAddress && isKnownProxyExecutionTarget(rowAddress)) || latestBuy?.routeType === "proxy",
                );

                const currentPriceUsd =
                    row.amount > 0 ? row.usdValue / row.amount : Number(latestBuy?.price || latestBuy?.entryPrice || 0);
                const recordedEntryPriceUsd = Number(latestBuy?.entryPrice || latestBuy?.price || 0);
                const recordedNotionalUsd =
                    latestBuy && recordedEntryPriceUsd > 0 ? Number(latestBuy.amount || 0) * recordedEntryPriceUsd : 0;
                const inferredProxyEntryPriceUsd =
                    isProxyHolding && row.amount > 0 && recordedNotionalUsd > 0 ? recordedNotionalUsd / row.amount : 0;
                const proxyRecordedLooksMismatched =
                    isProxyHolding
                    && currentPriceUsd > 0
                    && recordedEntryPriceUsd > 0
                    && (recordedEntryPriceUsd < currentPriceUsd * 0.5 || recordedEntryPriceUsd > currentPriceUsd * 1.5);

                const entryPriceUsd = isProxyHolding
                    ? (
                        inferredProxyEntryPriceUsd
                        || (proxyRecordedLooksMismatched ? 0 : recordedEntryPriceUsd)
                        || row.entryPrice
                        || currentPriceUsd
                    )
                    : (recordedEntryPriceUsd || row.entryPrice || currentPriceUsd);

                const defaultTakeProfitRatio = latestBuy?.regime === "Trend" ? 1.14 : 1.08;
                const defaultStopLossRatio = latestBuy?.regime === "Trend" ? 0.95 : 0.94;
                const rawTakeProfitRatio =
                    latestBuy?.plannedTakeProfit && recordedEntryPriceUsd > 0
                        ? latestBuy.plannedTakeProfit / recordedEntryPriceUsd
                        : 0;
                const rawStopLossRatio =
                    latestBuy?.plannedStopLoss && recordedEntryPriceUsd > 0
                        ? latestBuy.plannedStopLoss / recordedEntryPriceUsd
                        : 0;
                const takeProfitRatio = isReasonableMultiplier(rawTakeProfitRatio, 1.01, 1.8)
                    ? rawTakeProfitRatio
                    : defaultTakeProfitRatio;
                const stopLossRatio = isReasonableMultiplier(rawStopLossRatio, 0.5, 0.999)
                    ? rawStopLossRatio
                    : defaultStopLossRatio;

                const targetPriceUsd =
                    entryPriceUsd > 0
                        ? entryPriceUsd * takeProfitRatio
                        : currentPriceUsd > 0
                            ? currentPriceUsd * defaultTakeProfitRatio
                            : 0;
                const stopPriceUsd =
                    entryPriceUsd > 0
                        ? entryPriceUsd * stopLossRatio
                        : currentPriceUsd > 0
                            ? currentPriceUsd * defaultStopLossRatio
                            : 0;

                const expectedUpsidePct =
                    Number.isFinite(currentPriceUsd) && currentPriceUsd > 0 && targetPriceUsd > currentPriceUsd
                        ? ((targetPriceUsd / currentPriceUsd) - 1) * 100
                        : 0;

                const strategySymbol = latestBuy?.symbol || row.symbol;
                const reason = replaceHoldingNarrative(deriveReasonFallback(latestBuy), strategySymbol, holdingLabel);
                const strategy = replaceHoldingNarrative(
                    deriveStrategyFallback(latestBuy, targetPriceUsd, stopPriceUsd, formatPrice),
                    strategySymbol,
                    holdingLabel,
                );
                const exitPlan = replaceHoldingNarrative(
                    latestBuy?.reviewExitPlan
                        || `Take profit guide is ${formatPrice(targetPriceUsd)} and defense line is ${formatPrice(stopPriceUsd)}.`,
                    strategySymbol,
                    holdingLabel,
                );

                return {
                    row,
                    headingLabel,
                    currentPriceUsd,
                    entryPriceUsd,
                    targetPriceUsd,
                    stopPriceUsd,
                    expectedUpsidePct,
                    holdingWindow: deriveHoldingWindow(latestBuy),
                    sharePct: combinedTotalUsd > 0 ? (row.usdValue / combinedTotalUsd) * 100 : 0,
                    reason,
                    strategy,
                    exitPlan,
                };
            });
    }, [combinedTotalUsd, formatPrice, transactions, walletHoldings]);

    return (
        <Card title="OPENAI TRADE STRATEGY" className="h-full" glow="secondary">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <div className="text-sm font-bold text-white">
                        Only holdings above 25% of combined assets are shown here with an AI strategy summary.
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                        The panel summarizes expected upside, defense line, and holding window from the latest trade plan.
                    </p>
                </div>
                <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3 text-right">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">TARGET LINE</div>
                    <div className="mt-1 text-2xl font-black text-white">{formatPrice(combinedTotalUsd * 0.25)}</div>
                </div>
            </div>

            {qualifyingRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-sm text-slate-400">
                    No holding is above the 25% threshold right now.
                </div>
            ) : (
                <div className="space-y-4">
                    {qualifyingRows.map(({
                        row,
                        headingLabel,
                        currentPriceUsd,
                        entryPriceUsd,
                        targetPriceUsd,
                        stopPriceUsd,
                        expectedUpsidePct,
                        holdingWindow,
                        sharePct,
                        reason,
                        strategy,
                        exitPlan,
                    }) => (
                        <article
                            key={`openai-strategy-${row.chain}-${row.symbol}-${row.address || "native"}`}
                            className="rounded-2xl border border-white/10 bg-black/20 p-4"
                        >
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-xl font-black text-white">{headingLabel}</h3>
                                        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">
                                            {row.chain === "SOLANA" ? "Solana Chain" : "BNB Chain"}
                                        </span>
                                        <span className="rounded-full border border-gold-500/25 bg-gold-500/10 px-2 py-1 text-[11px] font-semibold text-gold-200">
                                            Asset share {formatPct(sharePct)}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm text-slate-300">
                                        Current holding value is {formatPrice(row.usdValue)} and amount is {Math.floor(row.amount).toLocaleString("en-US")}.
                                    </p>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[460px] xl:grid-cols-4">
                                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">CURRENT</div>
                                        <div className="mt-1 text-lg font-black text-white">{formatPrice(currentPriceUsd)}</div>
                                        <div className="mt-1 text-[11px] text-slate-400">Avg entry {formatPrice(entryPriceUsd)}</div>
                                    </div>
                                    <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-3">
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/80">TARGET</div>
                                        <div className="mt-1 text-lg font-black text-white">{formatPrice(targetPriceUsd)}</div>
                                        <div className="mt-1 text-[11px] text-emerald-300">
                                            {expectedUpsidePct > 0 ? formatPct(expectedUpsidePct) : "Target zone"}
                                        </div>
                                    </div>
                                    <div className="rounded-xl border border-rose-400/15 bg-rose-400/[0.05] px-3 py-3">
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-rose-300/80">DEFENSE</div>
                                        <div className="mt-1 text-lg font-black text-white">{formatPrice(stopPriceUsd)}</div>
                                        <div className="mt-1 text-[11px] text-slate-400">Review below this line</div>
                                    </div>
                                    <div className="rounded-xl border border-sky-400/15 bg-sky-400/[0.05] px-3 py-3">
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-sky-300/80">WINDOW</div>
                                        <div className="mt-1 text-lg font-black text-white">{holdingWindow}</div>
                                        <div className="mt-1 text-[11px] text-slate-400">Review horizon</div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 xl:grid-cols-3">
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">
                                        <Bot className="h-4 w-4" />
                                        AI REVIEW
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-slate-200">{reason}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">
                                        <TrendingUp className="h-4 w-4" />
                                        HOLD PLAN
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-slate-200">{strategy}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-gold-300">
                                        <Target className="h-4 w-4" />
                                        EXIT PLAN
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-slate-200">{exitPlan}</p>
                                </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-cyan-100">
                                    <Clock3 className="h-3.5 w-3.5" />
                                    Window {holdingWindow}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-emerald-100">
                                    <TrendingUp className="h-3.5 w-3.5" />
                                    Target {formatPrice(targetPriceUsd)}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/20 bg-rose-400/10 px-2 py-1 text-rose-100">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    Defense {formatPrice(stopPriceUsd)}
                                </span>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </Card>
    );
}
