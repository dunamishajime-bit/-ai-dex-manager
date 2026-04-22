import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { bsc } from "viem/chains";

import {
    buildReclaimHybridCashRescueVariantOptions,
    buildReclaimHybridVariantOptions,
    RECLAIM_HYBRID_EXECUTION_PROFILE,
    RECLAIM_HYBRID_STRATEGY_ID,
} from "@/config/reclaimHybridStrategy";
import {
    analyzeHybridDecisionWindow,
    evaluateHybridLiveDecisionDetails,
    type HybridLiveDecisionDetails,
    type HybridTrendSymbolDecision,
    type HybridVariantOptions,
} from "@/lib/backtest/hybrid-engine";
import { OPERATIONAL_WALLET_TRACKED_ASSETS } from "@/lib/operational-wallet-assets";
import type { OperationalWalletHolding, OperationalWalletRecord } from "@/lib/operational-wallet-types";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import { appendAutoTradeHistory } from "@/lib/server/auto-trade-history-db";
import { executeDirectWalletTrade, type DirectWalletTradeResult } from "@/lib/server/direct-trade-executor";
import { decryptVaultSecret } from "@/lib/server/wallet-vault";
import { loadOperationalWallets, saveOperationalWallets } from "@/lib/server/operational-wallet-db";
import { appendTradeHistory, loadOpenPositionForWalletSymbol } from "@/lib/server/trade-history-db";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram-service";
import type { TokenRef } from "@/lib/types/market";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const POST_SELL_REFRESH_RETRY_MS = 2500;
const POST_SELL_REFRESH_MAX_ATTEMPTS = 4;
const BALANCE_REFRESH_RETRY_MS = 1200;
const BALANCE_REFRESH_MAX_ATTEMPTS = 3;

export interface LiveHybridWalletRunResult {
    walletId: string;
    address: string;
    status: "skipped" | "noop" | "traded" | "error";
    step?: "sell" | "buy" | "wait" | "hold";
    stepLabel?: string;
    reason: string;
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    currentSymbol: string;
    amountWei?: string;
    trade?: DirectWalletTradeResult;
}

export interface LiveHybridRunSummary {
    strategyId: string;
    trigger: "scheduled" | "manual";
    triggerLabel: string;
    executedAt: string;
    decisionTime: string;
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    reason: string;
    walletResults: LiveHybridWalletRunResult[];
}

type WalletAction = ReturnType<typeof decideWalletAction>;

type EffectiveWalletDecision = {
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    desiredAlloc: number;
    reason: string;
    rotation: null | {
        fromSymbol: string;
        toSymbol: string;
        scoreGap: number;
    };
};

export type LiveHybridDecisionState = {
    baseDetails: HybridLiveDecisionDetails;
    baseOptions: HybridVariantOptions;
    details: HybridLiveDecisionDetails;
    options: HybridVariantOptions;
    cashRescueApplied: boolean;
};

function shortAddress(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeErc20BalanceOf(address: string) {
    const normalized = address.trim().toLowerCase().replace(/^0x/, "");
    return `0x70a08231${normalized.padStart(64, "0")}`;
}

async function readErc20BalanceRaw(rpcUrl: string, tokenAddress: string, walletAddress: string) {
    const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [
                {
                    to: tokenAddress,
                    data: encodeErc20BalanceOf(walletAddress),
                },
                "latest",
            ],
            id: 1,
        }),
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`ERC20 balanceOf failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { result?: string; error?: { message?: string } };
    if (payload.error) {
        throw new Error(payload.error.message || "ERC20 balanceOf returned RPC error");
    }

    return BigInt(payload.result || "0x0");
}

async function notifyAutoTrade(summary: LiveHybridRunSummary) {
    const traded = summary.walletResults.filter((item) => item.status === "traded" && item.trade?.ok);
    if (traded.length === 0) return;

    const lines = [
        `実行種別: ${summary.triggerLabel}`,
        `実行時刻: ${summary.executedAt}`,
        `判定時刻: ${summary.decisionTime}`,
        `シグナル: ${summary.desiredSymbol} / ${summary.desiredSide}`,
        `理由: ${summary.reason}`,
        `発注件数: ${traded.length}`,
        ...traded.map((item, index) => {
            const txHash = item.trade?.txHash ? ` / tx: ${item.trade.txHash}` : "";
            return `${index + 1}. ${shortAddress(item.address)} ${item.currentSymbol} -> ${item.trade?.executedDestSymbol || item.desiredSymbol}${txHash}`;
        }),
    ];

    await sendTelegramMessage(buildTelegramMessage("DisDEX 自動売買 実行結果", lines));
}

async function fetchOperationalWalletPrices() {
    const emptyPriceMap: Record<string, { usd: number; change24hPct?: number }> = {
        "binance-coin": { usd: 0, change24hPct: 0 },
        tether: { usd: 1, change24hPct: 0 },
        ethereum: { usd: 0, change24hPct: 0 },
        solana: { usd: 0, change24hPct: 0 },
        chainlink: { usd: 0, change24hPct: 0 },
        avalanche: { usd: 0, change24hPct: 0 },
        dogecoin: { usd: 0, change24hPct: 0 },
        "pudgy-penguins": { usd: 0, change24hPct: 0 },
        "injective-protocol": { usd: 0, change24hPct: 0 },
        uniswap: { usd: 0, change24hPct: 0 },
        "trust-wallet-token": { usd: 0, change24hPct: 0 },
    };

    try {
        const primary = await fetchPricesBatch(
            OPERATIONAL_WALLET_TRACKED_ASSETS.map(
                (asset) =>
                    ({
                        symbol: asset.symbol,
                        provider: "coincap",
                        providerId: asset.providerId,
                        chain: "MAJOR",
                    }) satisfies TokenRef,
            ),
        );

        if (Object.values(primary).some((entry) => Number(entry?.usd || 0) > 0)) {
            return { ...emptyPriceMap, ...primary };
        }
    } catch {
        // fall through
    }

    return emptyPriceMap;
}

function hasOperationalTradeBalance(holdings: OperationalWalletHolding[]) {
    return holdings.some((holding) => {
        if (Number(holding.amount) <= 0) return false;
        return (
            holding.symbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
            || RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols.includes(
                holding.symbol as (typeof RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols)[number],
            )
        );
    });
}

async function refreshWalletBalance(wallet: OperationalWalletRecord) {
    const rpcUrl = process.env.RPC_URL_BSC || "https://bsc-dataseed.binance.org";
    const client = createPublicClient({
        chain: bsc,
        transport: http(rpcUrl),
    });
    const walletAddress = wallet.address as `0x${string}`;
    const trackedTokenAssets = OPERATIONAL_WALLET_TRACKED_ASSETS.filter((asset) => !asset.isNative);
    const previousHasDepositedBalance = hasOperationalTradeBalance(wallet.trackedHoldings || []);

    for (let attempt = 0; attempt < BALANCE_REFRESH_MAX_ATTEMPTS; attempt += 1) {
        const [balanceWei, tokenResults, priceMap] = await Promise.all([
            client.getBalance({ address: walletAddress }),
            Promise.all(
                trackedTokenAssets.map(async (asset) => {
                    try {
                        const result = await readErc20BalanceRaw(rpcUrl, asset.address, walletAddress);
                        return { symbol: asset.symbol, balance: result, ok: true };
                    } catch (error) {
                        console.warn(`Failed to read ${asset.symbol} balance for live auto-trade wallet:`, error);
                        return { symbol: asset.symbol, balance: 0n, ok: false };
                    }
                }),
            ),
            fetchOperationalWalletPrices(),
        ]);

        const tokenBalanceBySymbol = new Map<string, bigint>(tokenResults.map((entry) => [entry.symbol, entry.balance]));
        OPERATIONAL_WALLET_TRACKED_ASSETS.forEach((asset) => {
            if (asset.isNative) {
                tokenBalanceBySymbol.set(asset.symbol, balanceWei);
            }
        });

        const trackedHoldings: OperationalWalletHolding[] = OPERATIONAL_WALLET_TRACKED_ASSETS.map((asset) => {
            const rawBalance = tokenBalanceBySymbol.get(asset.symbol) || 0n;
            const amount = Number(formatUnits(rawBalance, asset.decimals));
            const usdPrice = Number(priceMap[asset.providerId]?.usd || 0);
            const usdValue = Number((amount * usdPrice).toFixed(6));

            return {
                symbol: asset.symbol,
                name: asset.name,
                address: asset.address,
                decimals: asset.decimals,
                balanceWei: rawBalance.toString(),
                amount: amount.toString(),
                usdPrice,
                usdValue,
                isNative: asset.isNative,
            };
        });

        const portfolioUsd = Number(trackedHoldings.reduce((sum, holding) => sum + holding.usdValue, 0).toFixed(6));
        const hasDepositedBalance = hasOperationalTradeBalance(trackedHoldings);
        const tokenReadFailures = tokenResults.filter((entry) => !entry.ok).length;
        const shouldPreservePreviousSnapshot =
            !hasDepositedBalance
            && previousHasDepositedBalance
            && tokenReadFailures > 0;

        if (hasDepositedBalance || attempt === BALANCE_REFRESH_MAX_ATTEMPTS - 1) {
            if (shouldPreservePreviousSnapshot) {
                console.warn(
                    `Live auto-trade wallet refresh lost trade balances for ${wallet.address}; preserving previous snapshot after ${tokenReadFailures} token read failures.`,
                );
                return {
                    ...wallet,
                    lastBalanceWei: balanceWei.toString(),
                    lastBalanceFormatted: formatEther(balanceWei),
                    status: wallet.status === "paused" ? "paused" : "running",
                } satisfies OperationalWalletRecord;
            }

            return {
                ...wallet,
                lastBalanceWei: balanceWei.toString(),
                lastBalanceFormatted: formatEther(balanceWei),
                lastPortfolioUsd: portfolioUsd,
                trackedHoldings,
                depositDetectedAt:
                    hasDepositedBalance && !wallet.depositDetectedAt ? new Date().toISOString() : wallet.depositDetectedAt,
                status: wallet.status === "paused" ? "paused" : hasDepositedBalance ? "running" : "awaiting_deposit",
            } satisfies OperationalWalletRecord;
        }

        await sleep(BALANCE_REFRESH_RETRY_MS);
    }

    return wallet;
}

function resolveEffectiveWalletStatus(wallet: OperationalWalletRecord) {
    if (wallet.status === "paused") return "paused" as const;
    return hasOperationalTradeBalance(wallet.trackedHoldings || []) ? "running" as const : "awaiting_deposit" as const;
}

function resolveCurrentSymbol(wallet: OperationalWalletRecord) {
    const tracked = wallet.trackedHoldings || [];
    const candidates = tracked
        .filter((holding) => holding.usdValue >= 3)
        .filter((holding) => holding.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.gasSymbol)
        .filter((holding) =>
            holding.symbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
            || RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols.includes(
                holding.symbol as (typeof RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols)[number],
            ),
        )
        .sort((left, right) => right.usdValue - left.usdValue);

    return candidates[0] || null;
}

function findHolding(wallet: OperationalWalletRecord, symbol: string) {
    return (wallet.trackedHoldings || []).find((holding) => holding.symbol === symbol) || null;
}

function toWeiString(amount: number, decimals = 18) {
    if (!Number.isFinite(amount) || amount <= 0) return "0";
    const factor = 10 ** Math.min(decimals, 8);
    const rounded = Math.floor(amount * factor) / factor;
    const [whole, fraction = ""] = rounded.toFixed(Math.min(decimals, 8)).split(".");
    const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
    return `${BigInt(whole || "0") * (10n ** BigInt(decimals)) + BigInt(paddedFraction || "0")}`;
}

function proportionalWeiAmount(balanceWei: string, ratio: number) {
    if (!balanceWei) return "0";
    const balance = BigInt(balanceWei);
    if (balance <= 0n) return "0";
    if (!Number.isFinite(ratio) || ratio <= 0) return "0";
    if (ratio >= 0.999999) return balance.toString();

    const scaledRatio = BigInt(Math.max(1, Math.floor(ratio * 1_000_000)));
    const amount = (balance * scaledRatio) / 1_000_000n;
    return amount > 0n ? amount.toString() : "0";
}

function findTrendEvaluation(
    details: HybridLiveDecisionDetails,
    symbol: string | null,
): HybridTrendSymbolDecision | null {
    if (!symbol) return null;
    return details.trendEvaluations.find((item) => item.symbol === symbol) || null;
}

function strictExtraRotationScoreGapForSymbol(symbol: string, options: HybridVariantOptions) {
    return options.strictExtraTrendRotationScoreGapBySymbol?.[symbol.toUpperCase()]
        ?? options.strictExtraTrendRotationScoreGap
        ?? 10;
}

function strictExtraRotationConsecutiveBarsForSymbol(symbol: string, options: HybridVariantOptions) {
    return options.strictExtraTrendRotationRequireConsecutiveBarsBySymbol?.[symbol.toUpperCase()]
        ?? options.strictExtraTrendRotationRequireConsecutiveBars
        ?? 1;
}

function trendRotationCurrentSymbols(options: HybridVariantOptions) {
    return (options.trendRotationCurrentSymbols || []).map((symbol) => symbol.toUpperCase());
}

function trendRotationPrimaryGap(options: HybridVariantOptions) {
    return options.trendRotationScoreGap ?? 10;
}

function trendRotationAlternateGap(options: HybridVariantOptions) {
    return options.trendRotationAlternateScoreGap ?? null;
}

function trendRotationThresholdMet(
    scoreGap: number,
    streak: number,
    options: HybridVariantOptions,
) {
    const primaryGap = trendRotationPrimaryGap(options);
    const primaryBars = options.trendRotationRequireConsecutiveBars ?? 1;
    const alternateGap = trendRotationAlternateGap(options);
    const alternateBars = options.trendRotationAlternateRequireConsecutiveBars ?? primaryBars;

    if (scoreGap >= primaryGap && streak >= primaryBars) return true;
    if (alternateGap != null && scoreGap >= alternateGap && streak >= alternateBars) return true;
    return false;
}

function isCashDecision(details: HybridLiveDecisionDetails) {
    return (
        details.decision.desiredSymbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
        && details.decision.desiredSide === "cash"
    );
}

function pickTrendCandidateWithPriority(
    evaluations: HybridTrendSymbolDecision[],
    options: HybridVariantOptions,
    excludeSymbol: string,
    strictExtraSymbols: string[],
) {
    const eligible = evaluations
        .filter((item) => item.eligible)
        .filter((item) => item.symbol.toUpperCase() !== excludeSymbol.toUpperCase())
        .filter((item) => !strictExtraSymbols.includes(item.symbol.toUpperCase()))
        .sort((left, right) => right.score - left.score);

    const top = eligible[0] || null;
    if (!top) return null;

    const prioritySymbols = (options.trendPrioritySymbols || []).map((symbol) => symbol.toUpperCase());
    const priorityPick = prioritySymbols
        .map((symbol) => eligible.find((item) => item.symbol.toUpperCase() === symbol))
        .find(Boolean) || null;

    if (!priorityPick) {
        return top;
    }

    const maxGap = options.trendPriorityMaxScoreGap;
    if (maxGap == null || (top.score - priorityPick.score) <= maxGap) {
        return priorityPick;
    }

    return top;
}

export async function evaluateLiveHybridDecisionState(
    baseOptions: HybridVariantOptions = buildReclaimHybridVariantOptions(),
): Promise<LiveHybridDecisionState> {
    const baseDetails = await evaluateHybridLiveDecisionDetails("RETQ22", baseOptions);
    if (!baseDetails) {
        throw new Error("ライブシグナル判定に失敗しました。");
    }

    if (!isCashDecision(baseDetails)) {
        return {
            baseDetails,
            baseOptions,
            details: baseDetails,
            options: baseOptions,
            cashRescueApplied: false,
        };
    }

    const cashRescueOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
    const cashRescueDetails = await evaluateHybridLiveDecisionDetails("RETQ22", cashRescueOptions);
    if (!cashRescueDetails) {
        return {
            baseDetails,
            baseOptions,
            details: baseDetails,
            options: baseOptions,
            cashRescueApplied: false,
        };
    }

    return {
        baseDetails,
        baseOptions,
        details: cashRescueDetails,
        options: cashRescueOptions,
        cashRescueApplied: true,
    };
}

async function hasRequiredTrendRotationStreak(
    currentSymbol: string,
    nextSymbol: string,
    options: HybridVariantOptions,
) {
    const primaryBars = options.trendRotationRequireConsecutiveBars ?? 1;
    const alternateBars = options.trendRotationAlternateRequireConsecutiveBars ?? primaryBars;
    const requiredBars = Math.max(primaryBars, alternateBars);
    if (requiredBars <= 1) {
        return true;
    }

    const barWindow = Math.max(requiredBars + 2, 4);
    const endTs = Date.now();
    const startTs = endTs - (barWindow * TWELVE_HOURS_MS);
    const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", {
        ...options,
        backtestStartTs: startTs,
        backtestEndTs: endTs,
    });

    let streak = 0;
    for (let index = decisionWindow.length - 1; index >= 0; index -= 1) {
        const point = decisionWindow[index];
        const currentEval = point.trendEvaluations.find((item) => item.symbol.toUpperCase() === currentSymbol.toUpperCase()) || null;
        const nextEval = point.trendEvaluations.find((item) => item.symbol.toUpperCase() === nextSymbol.toUpperCase()) || null;
        if (!currentEval || !nextEval || !nextEval.eligible) {
            break;
        }

        const scoreGap = nextEval.score - currentEval.score;
        const currentMomAccelMax = options.trendRotationCurrentMomAccelMax ?? 0;
        const currentMom20Max = options.trendRotationCurrentMom20Max;
        const momentumOk =
            currentEval.momAccel <= currentMomAccelMax
            && (currentMom20Max == null || currentEval.mom20 <= currentMom20Max);

        if (momentumOk) {
            streak += 1;
            if (trendRotationThresholdMet(scoreGap, streak, options)) {
                return true;
            }
            continue;
        }

        break;
    }

    return false;
}

async function hasRequiredStrictExtraRotationStreak(
    currentSymbol: string,
    extraSymbol: string,
    options: HybridVariantOptions,
) {
    const requiredBars = strictExtraRotationConsecutiveBarsForSymbol(extraSymbol, options);
    if (requiredBars <= 1) {
        return true;
    }

    const barWindow = Math.max(requiredBars + 2, 4);
    const endTs = Date.now();
    const startTs = endTs - (barWindow * TWELVE_HOURS_MS);
    const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", {
        ...options,
        backtestStartTs: startTs,
        backtestEndTs: endTs,
    });

    let streak = 0;
    for (let index = decisionWindow.length - 1; index >= 0; index -= 1) {
        const point = decisionWindow[index];
        const currentEval = point.trendEvaluations.find((item) => item.symbol.toUpperCase() === currentSymbol.toUpperCase()) || null;
        const extraEval = point.trendEvaluations.find((item) => item.symbol.toUpperCase() === extraSymbol.toUpperCase()) || null;
        if (!currentEval || !extraEval || !extraEval.eligible) {
            break;
        }

        const requiredGap = strictExtraRotationScoreGapForSymbol(extraSymbol, options);
        const scoreGap = extraEval.score - currentEval.score;
        const currentMomAccelMax = options.strictExtraTrendRotationCurrentMomAccelMax ?? 0;
        const currentMom20Max = options.strictExtraTrendRotationCurrentMom20Max;
        const momentumOk =
            currentEval.momAccel <= currentMomAccelMax
            && (currentMom20Max == null || currentEval.mom20 <= currentMom20Max);

        if (scoreGap >= requiredGap && momentumOk) {
            streak += 1;
            if (streak >= requiredBars) {
                return true;
            }
            continue;
        }

        break;
    }

    return false;
}

export async function resolveWalletDecision(
    wallet: OperationalWalletRecord,
    details: HybridLiveDecisionDetails,
    options: HybridVariantOptions,
): Promise<EffectiveWalletDecision> {
    const baseDecision = details.decision;
    const current = resolveCurrentSymbol(wallet);
    if (!current) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: baseDecision.reason,
            rotation: null,
        };
    }

    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const strictExtraSymbols = (options.strictExtraTrendSymbols || []).map((symbol) => symbol.toUpperCase());
    const currentSymbol = current.symbol.toUpperCase();

    if (
        options.trendRotationWhileHolding
        && currentSymbol !== reserveSymbol
        && !strictExtraSymbols.includes(currentSymbol)
        && (!trendRotationCurrentSymbols(options).length || trendRotationCurrentSymbols(options).includes(currentSymbol))
    ) {
        const currentEval = findTrendEvaluation(details, current.symbol);
        const nextTrendCandidate = pickTrendCandidateWithPriority(
            details.trendEvaluations,
            options,
            currentSymbol,
            strictExtraSymbols,
        );

        if (currentEval && nextTrendCandidate) {
            const minimumGap = Math.min(
                trendRotationPrimaryGap(options),
                trendRotationAlternateGap(options) ?? trendRotationPrimaryGap(options),
            );
            const scoreGap = nextTrendCandidate.score - currentEval.score;
            const currentMomAccelMax = options.trendRotationCurrentMomAccelMax ?? 0;
            const currentMom20Ok =
                options.trendRotationCurrentMom20Max == null
                || currentEval.mom20 <= options.trendRotationCurrentMom20Max;
            const minHoldBars = options.trendRotationMinHoldBars ?? 1;
            let holdBarsOk = true;

            if (minHoldBars > 1) {
                const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
                if (!openPosition?.openedAt) {
                    holdBarsOk = false;
                } else {
                    const heldBars = Math.floor(
                        (new Date(baseDecision.isoTime).getTime() - new Date(openPosition.openedAt).getTime()) / TWELVE_HOURS_MS,
                    );
                    holdBarsOk = heldBars >= minHoldBars;
                }
            }

            if (
                scoreGap >= minimumGap
                && currentEval.momAccel <= currentMomAccelMax
                && currentMom20Ok
                && holdBarsOk
                && await hasRequiredTrendRotationStreak(current.symbol, nextTrendCandidate.symbol, options)
            ) {
                return {
                    desiredSymbol: nextTrendCandidate.symbol,
                    desiredSide: "trend",
                    desiredAlloc: baseDecision.desiredAlloc,
                    reason: `${current.symbol} の勢いが鈍り、${nextTrendCandidate.symbol} のScoreが ${scoreGap.toFixed(2)} 点上回ったため全額ローテーションします。`,
                    rotation: {
                        fromSymbol: current.symbol,
                        toSymbol: nextTrendCandidate.symbol,
                        scoreGap,
                    },
                };
            }
        }
    }

    if (
        !options.strictExtraTrendRotationWhileHolding
        || currentSymbol === reserveSymbol
        || strictExtraSymbols.includes(currentSymbol)
    ) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: baseDecision.reason,
            rotation: null,
        };
    }

    const currentEval = findTrendEvaluation(details, current.symbol);
    const extraEval = details.trendEvaluations
        .filter((item) => strictExtraSymbols.includes(item.symbol.toUpperCase()))
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score)[0] || null;

    if (!currentEval || !extraEval || extraEval.symbol.toUpperCase() === currentSymbol) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: baseDecision.reason,
            rotation: null,
        };
    }

    const requiredGap = strictExtraRotationScoreGapForSymbol(extraEval.symbol, options);
    const scoreGap = extraEval.score - currentEval.score;
    if (scoreGap < requiredGap) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: baseDecision.reason,
            rotation: null,
        };
    }

    const currentMomAccelMax = options.strictExtraTrendRotationCurrentMomAccelMax ?? 0;
    if (currentEval.momAccel > currentMomAccelMax) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: baseDecision.reason,
            rotation: null,
        };
    }

    if (
        options.strictExtraTrendRotationCurrentMom20Max != null
        && currentEval.mom20 > options.strictExtraTrendRotationCurrentMom20Max
    ) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: baseDecision.reason,
            rotation: null,
        };
    }

    const minHoldBars = options.strictExtraTrendRotationMinHoldBars ?? 1;
    if (minHoldBars > 1) {
        const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
        if (!openPosition?.openedAt) {
            return {
                desiredSymbol: baseDecision.desiredSymbol,
                desiredSide: baseDecision.desiredSide,
                desiredAlloc: baseDecision.desiredAlloc,
                reason: baseDecision.reason,
                rotation: null,
            };
        }
        const heldBars = Math.floor(
            (new Date(baseDecision.isoTime).getTime() - new Date(openPosition.openedAt).getTime()) / TWELVE_HOURS_MS,
        );
        if (heldBars < minHoldBars) {
            return {
                desiredSymbol: baseDecision.desiredSymbol,
                desiredSide: baseDecision.desiredSide,
                desiredAlloc: baseDecision.desiredAlloc,
                reason: baseDecision.reason,
                rotation: null,
            };
        }
    }

    if (!(await hasRequiredStrictExtraRotationStreak(current.symbol, extraEval.symbol, options))) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: baseDecision.reason,
            rotation: null,
        };
    }

    return {
        desiredSymbol: extraEval.symbol,
        desiredSide: "trend",
        desiredAlloc: baseDecision.desiredAlloc,
        reason: `${current.symbol} の勢いが鈍り、${extraEval.symbol} のScoreが ${scoreGap.toFixed(2)} 点上回ったため全額ローテーションします。`,
        rotation: {
            fromSymbol: current.symbol,
            toSymbol: extraEval.symbol,
            scoreGap,
        },
    };
}

function decideWalletAction(wallet: OperationalWalletRecord, plan: EffectiveWalletDecision) {
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const current = resolveCurrentSymbol(wallet);
    if (!current) {
        return {
            kind: "skip" as const,
            currentSymbol: "NONE",
            reason: "運用対象の残高が見つからないため、今回は見送ります。",
        };
    }

    if (current.symbol === plan.desiredSymbol) {
        return {
            kind: "noop" as const,
            currentSymbol: current.symbol,
            reason: "現在の保有がシグナルと一致しているため、そのまま維持します。",
        };
    }

    if (plan.desiredSymbol === reserveSymbol) {
        if (current.symbol === reserveSymbol) {
            return {
                kind: "noop" as const,
                currentSymbol: current.symbol,
                reason: "待機資産のまま維持します。",
            };
        }
        return {
            kind: "trade" as const,
            currentSymbol: current.symbol,
            srcSymbol: current.symbol,
            destSymbol: reserveSymbol,
            amountWei: current.balanceWei,
            action: "SELL" as const,
            reason: "決済条件が揃ったため、USDTへ戻します。",
        };
    }

    if (current.symbol !== reserveSymbol) {
        return {
            kind: "trade" as const,
            currentSymbol: current.symbol,
            srcSymbol: current.symbol,
            destSymbol: reserveSymbol,
            amountWei: current.balanceWei,
            action: "SELL" as const,
            reason: plan.rotation
                ? `${plan.rotation.fromSymbol} から ${plan.rotation.toSymbol} へ切り替えるため、いったん全額をUSDTへ戻します。`
                : `${current.symbol} から ${plan.desiredSymbol} へ切り替えるため、いったん全額をUSDTへ戻します。`,
        };
    }

    const reserveHolding = findHolding(wallet, reserveSymbol);
    const reserveUsd = Number(reserveHolding?.usdValue || 0);
    const portfolioUsd = Number(wallet.lastPortfolioUsd || current.usdValue || reserveUsd || 0);
    const effectiveAlloc = plan.desiredAlloc;
    if (!reserveHolding || reserveUsd < 10) {
        return {
            kind: "skip" as const,
            currentSymbol: current.symbol,
            reason: "新規エントリーに使えるUSDTが不足しているため、今回は見送ります。",
        };
    }

    const reserveBufferUsd = portfolioUsd * (RECLAIM_HYBRID_EXECUTION_PROFILE.stableReservePct / 100);
    const deployUsd = Math.max(0, (portfolioUsd * effectiveAlloc) - reserveBufferUsd);
    const spendUsd = Math.min(
        reserveUsd,
        deployUsd > 0 ? deployUsd : reserveUsd * effectiveAlloc,
    );

    if (spendUsd < 10) {
        return {
            kind: "skip" as const,
            currentSymbol: current.symbol,
            reason: "追加エントリーに使えるUSDTが不足しているため、今回は見送ります。",
        };
    }

    const fullReserveRequested =
        RECLAIM_HYBRID_EXECUTION_PROFILE.stableReservePct === 0
        && (effectiveAlloc >= 0.999999 || spendUsd >= reserveUsd - 0.01);
    const amountWei = fullReserveRequested
        ? reserveHolding.balanceWei
        : proportionalWeiAmount(reserveHolding.balanceWei, reserveUsd > 0 ? spendUsd / reserveUsd : 0);

    if (!amountWei || amountWei === "0") {
        return {
            kind: "skip" as const,
            currentSymbol: current.symbol,
            reason: "実際に発注へ回せるUSDTが不足しているため、今回は見送ります。",
        };
    }

    return {
        kind: "trade" as const,
        currentSymbol: current.symbol,
        srcSymbol: reserveSymbol,
        destSymbol: plan.desiredSymbol,
        amountWei,
        action: "BUY" as const,
        reason: plan.rotation
            ? `${plan.rotation.toSymbol} へ全額ローテーションします。`
            : `USDTから ${plan.desiredSymbol} へエントリーします。`,
    };
}

async function executeWalletAction(
    wallet: OperationalWalletRecord,
    desiredSymbol: string,
    desiredSide: "trend" | "range" | "cash",
    action: Extract<WalletAction, { kind: "trade" }>,
) {
    const beforeHoldings = wallet.trackedHoldings || [];
    const privateKey = decryptVaultSecret(wallet.encryptedPrivateKey) as `0x${string}`;
    const trade = await executeDirectWalletTrade({
        chainId: wallet.chainId,
        privateKey,
        fromAddress: wallet.address as `0x${string}`,
        srcSymbol: action.srcSymbol,
        destSymbol: action.destSymbol,
        amountWei: action.amountWei,
        action: action.action,
    });

    let walletAfterTrade = wallet;
    if (trade.ok) {
        walletAfterTrade = await refreshWalletBalance(wallet);
        await appendTradeHistory({
            walletId: walletAfterTrade.id,
            walletAddress: walletAfterTrade.address,
            chainId: walletAfterTrade.chainId,
            reason: action.reason,
            action: action.action,
            sourceSymbol: action.srcSymbol,
            destSymbol: trade.executedDestSymbol || action.destSymbol,
            beforeHoldings,
            afterHoldings: walletAfterTrade.trackedHoldings || [],
            trade,
            executedAt: new Date().toISOString(),
        });
    }

    const result: LiveHybridWalletRunResult = {
        walletId: wallet.id,
        address: wallet.address,
        status: trade.ok ? "traded" : "error",
        step: action.action === "SELL" ? "sell" : "buy",
        stepLabel: action.action === "SELL" ? "売却ステップ" : "買付ステップ",
        reason: trade.ok ? action.reason : (trade.error || action.reason),
        desiredSymbol,
        desiredSide,
        currentSymbol: action.currentSymbol,
        amountWei: action.amountWei,
        trade,
    };

    return { walletAfterTrade, result };
}

export async function runLiveHybridAutotrade(
    options: HybridVariantOptions = buildReclaimHybridVariantOptions(),
    context: { trigger?: "scheduled" | "manual" } = {},
): Promise<LiveHybridRunSummary> {
    const state = await evaluateLiveHybridDecisionState(options);
    const details = state.details;
    options = state.options;
    const decision = details.decision;

    const wallets = await loadOperationalWallets();
    const activeWallets = wallets.filter((wallet) => !wallet.deletedAt && wallet.status !== "paused");
    const refreshedWallets: OperationalWalletRecord[] = [];
    const walletResults: LiveHybridWalletRunResult[] = [];

    for (const wallet of activeWallets) {
        const refreshed = await refreshWalletBalance(wallet);
        const beforeHoldings = refreshed.trackedHoldings || [];
        refreshedWallets.push(refreshed);
        const effectiveStatus = resolveEffectiveWalletStatus(refreshed);

        if (!refreshed.backupConfirmed) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "skipped",
                step: "hold",
                stepLabel: "停止",
                reason: "バックアップ未確認のため、自動売買を開始できません。",
                desiredSymbol: decision.desiredSymbol,
                desiredSide: decision.desiredSide,
                currentSymbol: resolveCurrentSymbol(refreshed)?.symbol || "NONE",
            });
            continue;
        }

        if (effectiveStatus !== "running") {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "skipped",
                step: "hold",
                stepLabel: "待機",
                reason: "入金確認待ちのため、今回はスキップしました。",
                desiredSymbol: decision.desiredSymbol,
                desiredSide: decision.desiredSide,
                currentSymbol: resolveCurrentSymbol(refreshed)?.symbol || "NONE",
            });
            continue;
        }

        const plan = await resolveWalletDecision(refreshed, details, options);
        const action = decideWalletAction(refreshed, plan);
        if (action.kind !== "trade") {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: action.kind === "noop" ? "noop" : "skipped",
                step: action.kind === "noop" ? "hold" : "wait",
                stepLabel: action.kind === "noop" ? "維持" : "見送り",
                reason: action.reason,
                desiredSymbol: plan.desiredSymbol,
                desiredSide: plan.desiredSide,
                currentSymbol: action.currentSymbol,
            });
            continue;
        }
        let firstStep: Awaited<ReturnType<typeof executeWalletAction>>;
        try {
            firstStep = await executeWalletAction(refreshed, plan.desiredSymbol, plan.desiredSide, action);
        } catch (error) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "error",
                step: action.action === "SELL" ? "sell" : "buy",
                stepLabel: action.action === "SELL" ? "売却ステップ" : "買付ステップ",
                reason: error instanceof Error && error.message.includes("authenticate data")
                    ? "ウォレット署名用データを復号できませんでした。保存鍵の整合性を確認してください。"
                    : error instanceof Error
                        ? error.message
                        : "発注処理の準備中にエラーが発生しました。",
                desiredSymbol: plan.desiredSymbol,
                desiredSide: plan.desiredSide,
                currentSymbol: action.currentSymbol,
                amountWei: action.amountWei,
            });
            continue;
        }
        let latestWallet = firstStep.walletAfterTrade;
        walletResults.push(firstStep.result);

        const refreshedIndex = refreshedWallets.findIndex((item) => item.id === latestWallet.id);
        if (refreshedIndex >= 0) {
            refreshedWallets[refreshedIndex] = latestWallet;
        } else {
            refreshedWallets.push(latestWallet);
        }

        const shouldChainIntoBuy =
            firstStep.result.status === "traded"
            && action.action === "SELL"
            && action.destSymbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
            && plan.desiredSymbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;

        if (!shouldChainIntoBuy) {
            continue;
        }

        let followUpAction = decideWalletAction(latestWallet, plan);
        if (followUpAction.kind !== "trade" || followUpAction.action !== "BUY") {
            let resolvedBuyAction: Extract<ReturnType<typeof decideWalletAction>, { kind: "trade"; action: "BUY" }> | null = null;

            for (let attempt = 0; attempt < POST_SELL_REFRESH_MAX_ATTEMPTS; attempt += 1) {
                await sleep(POST_SELL_REFRESH_RETRY_MS);
                latestWallet = await refreshWalletBalance(latestWallet);
                followUpAction = decideWalletAction(latestWallet, plan);
                if (followUpAction.kind === "trade" && followUpAction.action === "BUY") {
                    resolvedBuyAction = followUpAction;
                    break;
                }
            }

            if (!resolvedBuyAction) {
                walletResults.push({
                    walletId: latestWallet.id,
                    address: latestWallet.address,
                    status: "skipped",
                    step: "wait",
                    stepLabel: "残高反映待ち",
                    reason:
                        followUpAction.kind === "trade" && followUpAction.action === "SELL"
                            ? `${action.srcSymbol} の売却後、残高反映が追いつかず ${plan.desiredSymbol} の買いへ進めませんでした。次回判定で再確認します。`
                            : `${action.srcSymbol} を売却したあと、${plan.desiredSymbol} の買い条件を満たさなかったため今回はUSDT待機に切り替えました。`,
                    desiredSymbol: plan.desiredSymbol,
                    desiredSide: plan.desiredSide,
                    currentSymbol: resolveCurrentSymbol(latestWallet)?.symbol || followUpAction.currentSymbol,
                });
                continue;
            }

            followUpAction = resolvedBuyAction;
        }

        let secondStep: Awaited<ReturnType<typeof executeWalletAction>>;
        try {
            secondStep = await executeWalletAction(latestWallet, plan.desiredSymbol, plan.desiredSide, {
                ...followUpAction,
                reason: plan.rotation
                    ? `${plan.rotation.fromSymbol} から ${plan.rotation.toSymbol} へ全額ローテーションしました。`
                    : `${action.srcSymbol} を売却したあと、そのまま ${plan.desiredSymbol} へ乗り換えました。`,
            });
        } catch (error) {
            walletResults.push({
                walletId: latestWallet.id,
                address: latestWallet.address,
                status: "error",
                step: "buy",
                stepLabel: "買付ステップ",
                reason: error instanceof Error && error.message.includes("authenticate data")
                    ? "ウォレット署名用データを復号できませんでした。保存鍵の整合性を確認してください。"
                    : error instanceof Error
                        ? error.message
                        : "乗り換え発注の準備中にエラーが発生しました。",
                desiredSymbol: plan.desiredSymbol,
                desiredSide: plan.desiredSide,
                currentSymbol: followUpAction.currentSymbol,
                amountWei: followUpAction.amountWei,
            });
            continue;
        }
        latestWallet = secondStep.walletAfterTrade;
        walletResults.push(secondStep.result);

        const secondIndex = refreshedWallets.findIndex((item) => item.id === latestWallet.id);
        if (secondIndex >= 0) {
            refreshedWallets[secondIndex] = latestWallet;
        } else {
            refreshedWallets.push(latestWallet);
        }
    }

    if (refreshedWallets.length > 0) {
        const unchanged = wallets.filter((wallet) => !activeWallets.some((item) => item.id === wallet.id));
        await saveOperationalWallets([...refreshedWallets, ...unchanged]);
    }

    const uniqueDesiredSymbols = [...new Set(walletResults.map((item) => item.desiredSymbol).filter(Boolean))];
    const uniqueDesiredSides = [...new Set(walletResults.map((item) => item.desiredSide).filter(Boolean))];
    const summaryDesiredSymbol = uniqueDesiredSymbols.length === 1 ? uniqueDesiredSymbols[0] : decision.desiredSymbol;
    const summaryDesiredSide = uniqueDesiredSides.length === 1 ? uniqueDesiredSides[0] : decision.desiredSide;
    const summaryReason =
        walletResults.find((item) => item.status === "traded")?.reason
        || walletResults.find((item) => item.status === "noop")?.reason
        || decision.reason;

    const summary: LiveHybridRunSummary = {
        strategyId: RECLAIM_HYBRID_STRATEGY_ID,
        trigger: context.trigger ?? "scheduled",
        triggerLabel: context.trigger === "manual" ? "手動トレード判定" : "12H定期トレード判定",
        executedAt: new Date().toISOString(),
        decisionTime: decision.isoTime,
        desiredSymbol: summaryDesiredSymbol,
        desiredSide: summaryDesiredSide,
        reason: summaryReason,
        walletResults,
    };

    await appendAutoTradeHistory(summary);
    await notifyAutoTrade(summary);

    return summary;
}


