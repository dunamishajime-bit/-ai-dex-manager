import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { bsc } from "viem/chains";

import {
    buildReclaimHybridCashRescueVariantOptions,
    buildReclaimHybridVariantOptions,
    getHybridSlippageBps,
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
import { buildIndicatorBars } from "@/lib/backtest/indicators";
import { OPERATIONAL_WALLET_TRACKED_ASSETS } from "@/lib/operational-wallet-assets";
import type { OperationalWalletHolding, OperationalWalletRecord } from "@/lib/operational-wallet-types";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import { getComparedQuotes } from "@/lib/quote-providers";
import { evaluateAiMarketJudgement, type AiMarketJudgement } from "@/lib/server/ai-market-judgement";
import { appendAutoTradeHistory } from "@/lib/server/auto-trade-history-db";
import { isAutoTradePaused } from "@/lib/server/auto-trade-runtime-control";
import { executeDirectWalletTrade, type DirectWalletTradeResult } from "@/lib/server/direct-trade-executor";
import { writeLiveDecisionCache } from "@/lib/server/live-decision-cache-db";
import { decryptVaultSecret } from "@/lib/server/wallet-vault";
import { loadOperationalWallets, saveOperationalWallets } from "@/lib/server/operational-wallet-db";
import {
    appendTradeHistory,
    loadOpenPositionForWalletSymbol,
    loadTradeHistoryEntries,
    updateOpenPositionPartialExitPeak,
} from "@/lib/server/trade-history-db";
import { notifyTradeFill } from "@/lib/server/trade-fill-notification";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram-service";
import { resolveToken } from "@/lib/tokens";
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
    marketJudgement?: AiMarketJudgement | null;
}

export interface LiveHybridRunSummary {
    strategyId: string;
    trigger: "scheduled" | "manual" | "pengu_15m" | "inj_spring";
    triggerLabel: string;
    executedAt: string;
    decisionTime: string;
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    reason: string;
    marketJudgement?: AiMarketJudgement | null;
    walletResults: LiveHybridWalletRunResult[];
}

type WalletAction = ReturnType<typeof decideWalletAction>;

type EffectiveWalletDecision = {
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    desiredAlloc: number;
    reason: string;
    marketJudgement?: AiMarketJudgement | null;
    maxSpendUsd?: number;
    sidecar?: {
        type: "idle_big_wave" | "twt_usdt_sleeve";
        symbol: string;
    };
    rotation: null | {
        fromSymbol: string;
        toSymbol: string;
        scoreGap: number;
    };
    partialExit?: {
        symbol: string;
        fraction: number;
        reason: string;
    };
    forcedExit?: {
        symbol: string;
        reason: string;
    };
};

function resolveDisplayCurrentSymbol(wallet: OperationalWalletRecord) {
    const tracked = (wallet.trackedHoldings || [])
        .filter((holding) => Number(holding.usdValue || 0) >= 3)
        .filter((holding) => holding.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.gasSymbol)
        .filter((holding) =>
            holding.symbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
            || RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols.includes(
                holding.symbol as (typeof RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols)[number],
            ),
        );
    const activeHolding = tracked
        .filter((holding) => holding.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol)
        .filter((holding) =>
            holding.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar.symbol
            || !tracked.some((item) =>
                item.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
                && item.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar.symbol
            )
        )
        .sort((left, right) => Number(right.usdValue || 0) - Number(left.usdValue || 0))[0];
    if (activeHolding) return activeHolding.symbol;
    return tracked
        .sort((left, right) => Number(right.usdValue || 0) - Number(left.usdValue || 0))[0]?.symbol || "NONE";
}

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
    if (traded.length === 0 && !summary.marketJudgement) return;

    const lines = [
        `実行種別: ${summary.triggerLabel}`,
        `実行時刻: ${summary.executedAt}`,
        `判定時刻: ${summary.decisionTime}`,
        `シグナル: ${summary.desiredSymbol} / ${summary.desiredSide}`,
        `理由: ${summary.reason}`,
        ...(summary.marketJudgement ? [
            `GPT相場判定: ${summary.marketJudgement.decision} / 信頼度 ${Math.round(summary.marketJudgement.confidence * 100)}%`,
            `GPT理由: ${summary.marketJudgement.reasonJa}`,
        ] : []),
        `発注件数: ${traded.length}`,
        ...(traded.length === 0 && summary.marketJudgement ? ["今回はGPT相場判定を含む確認のみで、発注はありません。"] : []),
        ...traded.map((item, index) => {
            const txHash = item.trade?.txHash ? ` / tx: ${item.trade.txHash}` : "";
            return `${index + 1}. ${shortAddress(item.address)} ${item.currentSymbol} -> ${item.trade?.executedDestSymbol || item.desiredSymbol}${txHash}`;
        }),
    ];

    try {
        const result = await sendTelegramMessage(buildTelegramMessage("DisDEX 自動売買 実行結果", lines));
        if (!result.success) {
            console.warn("[LiveHybridAutotrade] Telegram notification failed:", result.error || "unknown_error");
        }
    } catch (error) {
        console.warn(
            "[LiveHybridAutotrade] Telegram notification threw:",
            error instanceof Error ? error.message : "unknown_error",
        );
    }
}

function buildPausedRunSummary(trigger: LiveHybridRunSummary["trigger"], triggerLabel: string, reason: string): LiveHybridRunSummary {
    const now = new Date().toISOString();
    return {
        strategyId: RECLAIM_HYBRID_STRATEGY_ID,
        trigger,
        triggerLabel,
        executedAt: now,
        decisionTime: now,
        desiredSymbol: RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol,
        desiredSide: "cash",
        reason,
        marketJudgement: null,
        walletResults: [],
    };
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
        "bio-protocol": { usd: 0, change24hPct: 0 },
        "dusk-network": { usd: 0, change24hPct: 0 },
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

export async function refreshWalletBalance(wallet: OperationalWalletRecord) {
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
        const previousHighWaterUsd = Number(wallet.lastPortfolioHighWaterUsd || 0);
        const portfolioHighWaterUsd = portfolioUsd > 0
            ? Math.max(previousHighWaterUsd, portfolioUsd)
            : previousHighWaterUsd;
        const portfolioDrawdownPct = portfolioHighWaterUsd > 0 && portfolioUsd > 0
            ? Number((((portfolioUsd / portfolioHighWaterUsd) - 1) * 100).toFixed(6))
            : 0;
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
                lastPortfolioHighWaterUsd: portfolioHighWaterUsd,
                lastPortfolioDrawdownPct: portfolioDrawdownPct,
                lastPortfolioDrawdownCheckedAt: new Date().toISOString(),
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

    const twtSleeveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar.symbol;
    const nonReserve = candidates.filter((holding) => holding.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol);
    return nonReserve.find((holding) => holding.symbol !== twtSleeveSymbol)
        || nonReserve[0]
        || candidates[0]
        || null;
}

function findHolding(wallet: OperationalWalletRecord, symbol: string) {
    return (wallet.trackedHoldings || []).find((holding) => holding.symbol === symbol) || null;
}

async function refreshWalletBalanceAfterTrade(
    wallet: OperationalWalletRecord,
    action: Extract<WalletAction, { kind: "trade" }>,
    trade: DirectWalletTradeResult,
) {
    const expectedDestSymbol = (trade.executedDestSymbol || action.destSymbol).toUpperCase();
    let latest = wallet;

    for (let attempt = 0; attempt < 6; attempt += 1) {
        if (attempt > 0) await sleep(1500);
        latest = await refreshWalletBalance(wallet);
        const destHolding = findHolding(latest, expectedDestSymbol);
        if (destHolding && Number(destHolding.amount || 0) > 0) {
            return latest;
        }
    }

    return latest;
}

type LiveBigWaveCandle = {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

type LiveBigWaveSignal = {
    symbol: string;
    close: number;
    score: number;
};

type TwtUsdtSleeveSignal = {
    symbol: "TWT";
    close: number;
    score: number;
    breakoutPct: number;
    volumeRatio: number;
    mom20: number;
    momAccel: number;
    efficiencyRatio: number;
    adx14: number;
};

export type IdleBigWaveSidecarEvaluation = {
    symbol: string;
    active: boolean;
    eligible: boolean;
    score: number;
    close: number;
    breakoutPct: number;
    volumeRatio: number;
    mom6: number;
    mom24: number;
    fourHourMom: number;
    oneHourJump: number;
    closeLocation: number;
    maxSpendUsd: number;
    reasons: string[];
    quote?: {
        checked: boolean;
        ok: boolean;
        provider?: string;
        valueLossPct?: number;
        reason: string;
    };
};

export type IdleRunnerEvaluation = {
    symbol: string;
    timeframe: "1h";
    eligible: boolean;
    score: number;
    close: number;
    sma40: number;
    mom20: number;
    momAccel: number;
    breakoutPct: number;
    volumeRatio: number;
    efficiencyRatio: number;
    adx14: number;
    reasons: string[];
    checkedAt: string;
};

const HOUR_MS = 60 * 60 * 1000;

function liveTimeframeToMs(
    timeframe:
        | HybridVariantOptions["penguStrongOverrideTimeframe"]
        | HybridVariantOptions["penguOffRotationTimeframe"]
        | HybridVariantOptions["solWaveOverrideTimeframe"]
        | HybridVariantOptions["idleBreakoutEntryTimeframe"],
) {
    switch (timeframe) {
        case "15m": return 15 * 60 * 1000;
        case "1h": return HOUR_MS;
        case "2h": return 2 * HOUR_MS;
        case "4h": return 4 * HOUR_MS;
        case "6h": return 6 * HOUR_MS;
        case "12h": return TWELVE_HOURS_MS;
        default: return TWELVE_HOURS_MS;
    }
}

function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function binanceSymbol(symbol: string) {
    return `${symbol.toUpperCase()}USDT`;
}

async function fetchLiveBigWaveCandles(
    symbol: string,
    limit = 140,
    interval: "15m" | "1h" = "1h",
): Promise<LiveBigWaveCandle[]> {
    const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol(symbol)}&interval=${interval}&limit=${limit}`,
        {
            cache: "no-store",
            signal: AbortSignal.timeout(6000),
        },
    );
    if (!response.ok) {
        throw new Error(`Binance ${symbol} ${interval} candles failed with status ${response.status}`);
    }
    const now = Date.now();
    const rows = (await response.json()) as unknown[];
    return rows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => ({
            ts: Number(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
            closeTs: Number(row[6]),
        }))
        .filter((bar) =>
            Number.isFinite(bar.ts)
            && Number.isFinite(bar.closeTs)
            && bar.closeTs <= now
            && Number.isFinite(bar.open)
            && Number.isFinite(bar.high)
            && Number.isFinite(bar.low)
            && Number.isFinite(bar.close)
            && Number.isFinite(bar.volume)
            && bar.close > 0
        )
        .map(({ closeTs: _closeTs, ...bar }) => bar)
        .sort((left, right) => left.ts - right.ts);
}

function resampleLiveCandles(candles: LiveBigWaveCandle[], hours: number) {
    const bucketMs = hours * HOUR_MS;
    const buckets = new Map<number, LiveBigWaveCandle>();
    for (const candle of candles) {
        const ts = Math.floor(candle.ts / bucketMs) * bucketMs;
        const existing = buckets.get(ts);
        if (!existing) {
            buckets.set(ts, { ...candle, ts });
            continue;
        }
        existing.high = Math.max(existing.high, candle.high);
        existing.low = Math.min(existing.low, candle.low);
        existing.close = candle.close;
        existing.volume += candle.volume;
    }
    return [...buckets.values()].sort((left, right) => left.ts - right.ts);
}

function resampleCompleteLiveCandles(candles: LiveBigWaveCandle[], hours: number) {
    const bucketMs = hours * HOUR_MS;
    const now = Date.now();
    const grouped = new Map<number, LiveBigWaveCandle[]>();
    for (const candle of candles) {
        const bucketStart = Math.floor(candle.ts / bucketMs) * bucketMs;
        const bucket = grouped.get(bucketStart) || [];
        bucket.push(candle);
        grouped.set(bucketStart, bucket);
    }

    return [...grouped.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([bucketStart, bucket]) => {
            const bucketEnd = bucketStart + bucketMs;
            if (bucketEnd > now || bucket.length < hours) return null;
            const open = bucket[0]?.open || bucket[0]?.close || 0;
            const close = bucket.at(-1)?.close || open;
            return {
                ts: bucketEnd,
                open,
                high: Math.max(...bucket.map((bar) => bar.high || bar.close || 0), open, close),
                low: Math.min(...bucket.map((bar) => bar.low || bar.close || 0), open, close),
                close,
                volume: bucket.reduce((sum, bar) => sum + (bar.volume || 0), 0),
            };
        })
        .filter((bar): bar is LiveBigWaveCandle => Boolean(bar));
}

function livePathEfficiency(candles: LiveBigWaveCandle[], index: number, lookback: number) {
    if (index < lookback) return 0;
    const start = candles[index - lookback].close;
    const end = candles[index].close;
    const path = candles.slice(index - lookback + 1, index + 1)
        .reduce((sum, bar, offset) => {
            const prev = candles[index - lookback + offset].close;
            return sum + Math.abs(bar.close / prev - 1);
        }, 0);
    return path > 0 ? Math.abs(end / start - 1) / path : 0;
}

function isActiveMonth(activeMonths: readonly number[] | undefined, ts = Date.now()) {
    if (!activeMonths?.length) return true;
    return activeMonths.includes(new Date(ts).getUTCMonth() + 1);
}

function evaluateTwtUsdtSleeveSignal(candles: LiveBigWaveCandle[]): TwtUsdtSleeveSignal | null {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar;
    const bars12h = resampleCompleteLiveCandles(candles, 12);
    const indicators = buildIndicatorBars(bars12h);
    const index = bars12h.length - 1;
    if (index < Math.max(90, cfg.lookbackBars + 1)) return null;

    const bar = bars12h[index];
    if (!isActiveMonth(cfg.activeMonths, bar.ts)) return null;

    const ind = indicators[index];
    const prevHigh = Math.max(...bars12h.slice(index - cfg.lookbackBars, index).map((item) => item.high));
    const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
    const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
    const efficiencyRatio = livePathEfficiency(bars12h, index, cfg.lookbackBars);

    if (!ind.ready) return null;
    if (bar.close <= ind.sma40) return null;
    if (ind.mom20 < cfg.minMom20) return null;
    if (breakoutPct < cfg.breakoutMinPct) return null;
    if (volumeRatio < cfg.minVolumeRatio) return null;
    if (ind.momAccel < cfg.minMomAccel) return null;
    if (efficiencyRatio < cfg.minEfficiencyRatio) return null;
    if (ind.adx14 < cfg.minAdx14) return null;

    const score =
        ind.mom20 * 100
        + ind.momAccel * 180
        + breakoutPct * 150
        + Math.min(4, volumeRatio) * 4
        + efficiencyRatio * 18
        + ind.adx14 * 0.15;
    return {
        symbol: cfg.symbol,
        close: bar.close,
        score,
        breakoutPct,
        volumeRatio,
        mom20: ind.mom20,
        momAccel: ind.momAccel,
        efficiencyRatio,
        adx14: ind.adx14,
    };
}

function evaluateIdleBigWaveSignal(symbol: string, candles: LiveBigWaveCandle[]): LiveBigWaveSignal | null {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
    const index = candles.length - 1;
    if (index < Math.max(30, cfg.lookbackBars + 1)) return null;
    const bar = candles[index];
    const prevHigh = Math.max(...candles.slice(index - cfg.lookbackBars, index).map((item) => item.high));
    const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
    const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
    const volRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
    const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
    const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
    const oneHourJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
    const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 1;
    const fourHourCandles = resampleLiveCandles(candles, 4);
    const fourHour = [...fourHourCandles].reverse().find((item) => item.ts <= bar.ts);
    const fourHourIndex = fourHour ? fourHourCandles.findIndex((item) => item.ts === fourHour.ts) : -1;
    const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0
        ? fourHour!.close / fourHourCandles[fourHourIndex - 3].close - 1
        : 0;

    if (breakoutPct < cfg.breakoutMinPct) return null;
    if (volRatio < cfg.minVolumeRatio) return null;
    if (mom6 < cfg.minMom6) return null;
    if (mom24 < cfg.minMom24) return null;
    if (fourHourMom < cfg.minFourHourMom) return null;
    if (oneHourJump > cfg.maxOneHourJump) return null;
    if (closeLocation < cfg.minCloseLocation) return null;

    const score =
        mom6 * 120
        + mom24 * 90
        + fourHourMom * 120
        + breakoutPct * 180
        + Math.min(3.5, volRatio) * 2
        + closeLocation * 4;
    if (score < cfg.minScore) return null;
    return { symbol, close: bar.close, score };
}

function evaluateIdleRunnerMetrics(symbol: string, candles: LiveBigWaveCandle[]): IdleRunnerEvaluation | null {
    const options = RECLAIM_HYBRID_EXECUTION_PROFILE;
    const indicators = buildIndicatorBars(candles);
    const latest = candles.at(-1);
    const latestIndicator = indicators.at(-1);
    if (!latest || !latestIndicator) return null;

    const lookback = options.idleBreakoutBreakoutLookbackBars ?? 12;
    const prior = candles.slice(Math.max(0, candles.length - lookback - 1), -1);
    const priorHigh = Math.max(0, ...prior.map((bar) => bar.high));
    const breakoutPct = priorHigh > 0 ? latest.close / priorHigh - 1 : 0;
    const latestIndex = candles.length - 1;
    const volAvg20 = average(candles.slice(Math.max(0, latestIndex - 20), latestIndex).map((bar) => bar.volume));
    const volumeRatio = volAvg20 > 0 ? latest.volume / volAvg20 : 0;
    const momAccel = latestIndicator.momAccel ?? 0;
    const efficiencyRatio = livePathEfficiency(candles, latestIndex, lookback);
    const closeAboveSma = latestIndicator.sma40 > 0 && latest.close > latestIndicator.sma40;
    const breakoutOk = breakoutPct >= (options.idleBreakoutBreakoutMinPct ?? 0.02);
    const volumeOk = volumeRatio >= (options.idleBreakoutMinVolumeRatio ?? 1.2);
    const accelOk = momAccel >= (options.idleBreakoutMinMomAccel ?? -0.002);
    const efficiencyOk = efficiencyRatio >= (options.idleBreakoutMinEfficiencyRatio ?? 0.12);
    const eligible = closeAboveSma && breakoutOk && volumeOk && accelOk && efficiencyOk;
    const score =
        (latestIndicator.mom20 ?? 0) * 100
        + momAccel * 120
        + breakoutPct * 140
        + Math.log10(Math.max(0.1, volumeRatio)) * 18
        + efficiencyRatio * 14
        + (closeAboveSma ? 6 : -8);

    return {
        symbol,
        timeframe: "1h",
        eligible,
        score,
        close: latest.close,
        sma40: latestIndicator.sma40,
        mom20: latestIndicator.mom20,
        momAccel,
        breakoutPct,
        volumeRatio,
        efficiencyRatio,
        adx14: latestIndicator.adx14,
        reasons: [
            closeAboveSma ? "close>sma40" : "close<=sma40",
            breakoutOk ? "runner-breakout-ok" : "runner-breakout-low",
            volumeOk ? "volume-ok" : "volume-low",
            accelOk ? "accel-ok" : "accel-low",
            efficiencyOk ? "eff-ok" : "eff-low",
        ],
        checkedAt: new Date(latest.ts).toISOString(),
    };
}

export async function evaluateIdleRunnerDisplay() {
    const rows: IdleRunnerEvaluation[] = [];
    const symbols = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBreakoutSymbols ?? [];
    for (const symbol of symbols) {
        try {
            const candles = await fetchLiveBigWaveCandles(symbol, 260, "1h");
            const evaluation = evaluateIdleRunnerMetrics(symbol, candles);
            if (evaluation) rows.push(evaluation);
        } catch (error) {
            rows.push({
                symbol,
                timeframe: "1h",
                eligible: false,
                score: 0,
                close: 0,
                sma40: 0,
                mom20: 0,
                momAccel: 0,
                breakoutPct: 0,
                volumeRatio: 0,
                efficiencyRatio: 0,
                adx14: 0,
                reasons: [`1H data error: ${error instanceof Error ? error.message : String(error)}`],
                checkedAt: new Date().toISOString(),
            });
        }
    }
    return rows.sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.score - left.score);
}

function formatPctForReason(value: number) {
    return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function evaluateIdleBigWaveSidecarMetrics(symbol: string, candles: LiveBigWaveCandle[]): IdleBigWaveSidecarEvaluation | null {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
    const maxSpendUsd = cfg.maxNotionalUsdBySymbol?.[symbol as "BIO" | "DUSK"] ?? cfg.maxNotionalUsd;
    const index = candles.length - 1;
    if (index < Math.max(30, cfg.lookbackBars + 1)) {
        return {
            symbol,
            active: true,
            eligible: false,
            score: 0,
            close: 0,
            breakoutPct: 0,
            volumeRatio: 0,
            mom6: 0,
            mom24: 0,
            fourHourMom: 0,
            oneHourJump: 0,
            closeLocation: 0,
            maxSpendUsd,
            reasons: ["ローソク足データが不足しています。"],
        };
    }

    const bar = candles[index];
    const prevHigh = Math.max(...candles.slice(index - cfg.lookbackBars, index).map((item) => item.high));
    const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
    const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
    const volumeRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
    const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
    const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
    const oneHourJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
    const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 1;
    const fourHourCandles = resampleLiveCandles(candles, 4);
    const fourHour = [...fourHourCandles].reverse().find((item) => item.ts <= bar.ts);
    const fourHourIndex = fourHour ? fourHourCandles.findIndex((item) => item.ts === fourHour.ts) : -1;
    const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0
        ? fourHour!.close / fourHourCandles[fourHourIndex - 3].close - 1
        : 0;
    const score =
        mom6 * 120
        + mom24 * 90
        + fourHourMom * 120
        + breakoutPct * 180
        + Math.min(3.5, volumeRatio) * 2
        + closeLocation * 4;
    const failed: string[] = [];
    if (breakoutPct < cfg.breakoutMinPct) failed.push(`breakout ${formatPctForReason(breakoutPct)} < ${formatPctForReason(cfg.breakoutMinPct)}`);
    if (volumeRatio < cfg.minVolumeRatio) failed.push(`volume ratio ${volumeRatio.toFixed(2)} < ${cfg.minVolumeRatio.toFixed(2)}`);
    if (mom6 < cfg.minMom6) failed.push(`mom6 ${formatPctForReason(mom6)} < ${formatPctForReason(cfg.minMom6)}`);
    if (mom24 < cfg.minMom24) failed.push(`mom24 ${formatPctForReason(mom24)} < ${formatPctForReason(cfg.minMom24)}`);
    if (fourHourMom < cfg.minFourHourMom) failed.push(`4h mom ${formatPctForReason(fourHourMom)} < ${formatPctForReason(cfg.minFourHourMom)}`);
    if (oneHourJump > cfg.maxOneHourJump) failed.push(`1h jump ${formatPctForReason(oneHourJump)} > ${formatPctForReason(cfg.maxOneHourJump)}`);
    if (closeLocation < cfg.minCloseLocation) failed.push(`close location ${closeLocation.toFixed(2)} < ${cfg.minCloseLocation.toFixed(2)}`);
    if (score < cfg.minScore) failed.push(`score ${score.toFixed(2)} < ${cfg.minScore.toFixed(2)}`);

    return {
        symbol,
        active: true,
        eligible: failed.length === 0,
        score,
        close: bar.close,
        breakoutPct,
        volumeRatio,
        mom6,
        mom24,
        fourHourMom,
        oneHourJump,
        closeLocation,
        maxSpendUsd,
        reasons: failed.length ? failed : ["confirmed_48h条件を満たしています。"],
    };
}

async function quoteIdleBigWaveEntry(wallet: OperationalWalletRecord, symbol: string, reserveUsd: number) {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
    const symbolMaxNotionalUsd = cfg.maxNotionalUsdBySymbol?.[symbol as "BIO" | "DUSK"] ?? cfg.maxNotionalUsd;
    const sizeUsd = Math.min(symbolMaxNotionalUsd, reserveUsd);
    if (sizeUsd < 10) {
        return { ok: false, reason: "BIO/DUSKサイドロジックに使えるUSDTが不足しています。" };
    }

    try {
        const srcToken = resolveToken(RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol, wallet.chainId);
        const destToken = resolveToken(symbol, wallet.chainId);
        const amountWei = toWeiString(sizeUsd, srcToken.decimals);
        const compared = await getComparedQuotes({
            chainId: wallet.chainId,
            srcToken,
            destToken,
            amountWei,
            slippageBps: getHybridSlippageBps(RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol, symbol),
            account: wallet.address,
        });
        const quote = compared.bestQuote;
        if (!quote) {
            return { ok: false, reason: `${symbol} のParaSwap/OpenOcean quoteが取得できません。` };
        }
        const srcUsd = Number(quote.notionalUsd || sizeUsd);
        const outUnits = Number(formatUnits(BigInt(quote.expectedOutWei), destToken.decimals));
        const destUsd = quote.destUsd ? outUnits * quote.destUsd : 0;
        const valueLossPct = srcUsd > 0 && destUsd > 0 ? ((srcUsd - destUsd) / srcUsd) * 100 : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(valueLossPct) || valueLossPct > cfg.quoteValueLossCapPct) {
            return {
                ok: false,
                reason: `${symbol} のquote value lossが ${Number.isFinite(valueLossPct) ? valueLossPct.toFixed(2) : "不明"}% のため見送り。`,
            };
        }
        return {
            ok: true,
            reason: `${symbol} quote確認OK (${quote.provider}, value loss ${Math.max(0, valueLossPct).toFixed(2)}%)。`,
            provider: quote.provider,
            valueLossPct: Math.max(0, valueLossPct),
        };
    } catch (error) {
        return {
            ok: false,
            reason: `${symbol} quote確認でエラー: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

async function quoteTwtUsdtSleeveEntry(wallet: OperationalWalletRecord, reserveUsd: number) {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar;
    if (!isActiveMonth(cfg.activeMonths)) {
        return { ok: false, reason: "TWT余剰USDT枠は10〜12月のみ有効なため、現在は見送ります。" };
    }
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const sizeUsd = reserveUsd * cfg.sleeveFraction;
    if (sizeUsd < 10) {
        return { ok: false, reason: "TWT余剰USDT枠に使えるUSDTが不足しています。" };
    }

    try {
        const srcToken = resolveToken(reserveSymbol, wallet.chainId);
        const destToken = resolveToken(cfg.symbol, wallet.chainId);
        const amountWei = toWeiString(sizeUsd, srcToken.decimals);
        const compared = await getComparedQuotes({
            chainId: wallet.chainId,
            srcToken,
            destToken,
            amountWei,
            slippageBps: getHybridSlippageBps(reserveSymbol, cfg.symbol),
            account: wallet.address,
        });
        const quote = compared.bestQuote;
        if (!quote) return { ok: false, reason: "TWT のParaSwap/OpenOcean quoteが取得できません。" };

        const srcUsd = Number(quote.notionalUsd || sizeUsd);
        const outUnits = Number(formatUnits(BigInt(quote.expectedOutWei), destToken.decimals));
        const destUsd = quote.destUsd ? outUnits * quote.destUsd : 0;
        const valueLossPct = srcUsd > 0 && destUsd > 0 ? ((srcUsd - destUsd) / srcUsd) * 100 : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(valueLossPct) || valueLossPct > cfg.quoteValueLossCapPct) {
            return {
                ok: false,
                reason: `TWT quote value lossが ${Number.isFinite(valueLossPct) ? valueLossPct.toFixed(2) : "不明"}% のため見送り。`,
            };
        }
        return {
            ok: true,
            reason: `TWT quote確認OK (${quote.provider}, value loss ${Math.max(0, valueLossPct).toFixed(2)}%)。`,
            provider: quote.provider,
            valueLossPct: Math.max(0, valueLossPct),
            sizeUsd,
        };
    } catch (error) {
        return {
            ok: false,
            reason: `TWT quote確認でエラー: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

async function quoteRotationLeg(wallet: OperationalWalletRecord, srcSymbol: string, destSymbol: string, amountWei: string, maxValueLossPct = 1) {
    try {
        const srcToken = resolveToken(srcSymbol, wallet.chainId);
        const destToken = resolveToken(destSymbol, wallet.chainId);
        const compared = await getComparedQuotes({
            chainId: wallet.chainId,
            srcToken,
            destToken,
            amountWei,
            slippageBps: getHybridSlippageBps(srcSymbol, destSymbol),
            account: wallet.address,
        });
        const quote = compared.bestQuote;
        if (!quote) {
            return { ok: false, reason: `${srcSymbol}->${destSymbol} のquoteが取得できません。` };
        }

        const srcUnits = Number(formatUnits(BigInt(amountWei), srcToken.decimals));
        const srcUsdValue = quote.srcUsd ? srcUnits * quote.srcUsd : Number(quote.notionalUsd || 0);
        const outUnits = Number(formatUnits(BigInt(quote.expectedOutWei), destToken.decimals));
        const destUsdValue = quote.destUsd ? outUnits * quote.destUsd : 0;
        const valueLossPct = srcUsdValue > 0 && destUsdValue > 0
            ? ((srcUsdValue - destUsdValue) / srcUsdValue) * 100
            : 0;

        if (Number.isFinite(valueLossPct) && valueLossPct > maxValueLossPct) {
            return {
                ok: false,
                reason: `${srcSymbol}->${destSymbol} quote value loss ${valueLossPct.toFixed(2)}% が上限 ${maxValueLossPct.toFixed(2)}% を超えています。`,
            };
        }

        return {
            ok: true,
            reason: `${srcSymbol}->${destSymbol} quote OK (${quote.provider}, value loss ${Math.max(0, valueLossPct).toFixed(2)}%)。`,
            provider: quote.provider,
            valueLossPct: Math.max(0, valueLossPct),
        };
    } catch (error) {
        return {
            ok: false,
            reason: `${srcSymbol}->${destSymbol} quote確認でエラー: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

async function quotePenguStrongOverrideRotation(wallet: OperationalWalletRecord, current: OperationalWalletHolding) {
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const sellQuote = await quoteRotationLeg(wallet, current.symbol, reserveSymbol, current.balanceWei, 1);
    if (!sellQuote.ok) return sellQuote;

    const reserveToken = resolveToken(reserveSymbol, wallet.chainId);
    const reserveAmountUsd = Number(current.usdValue || 0);
    const reserveAmountWei = toWeiString(reserveAmountUsd, reserveToken.decimals);
    if (BigInt(reserveAmountWei) <= 0n) {
        return { ok: false, reason: "PENGU買付想定額が不足しているため見送り。" };
    }

    const buyQuote = await quoteRotationLeg(wallet, reserveSymbol, "PENGU", reserveAmountWei, 1);
    if (!buyQuote.ok) return buyQuote;

    return {
        ok: true,
        reason: `${sellQuote.reason} ${buyQuote.reason}`,
    };
}

async function quoteIdleBreakoutEntry(wallet: OperationalWalletRecord, targetSymbol: string, amountWei: string) {
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const normalizedTarget = targetSymbol.toUpperCase();
    if (BigInt(amountWei || "0") <= 0n) {
        return { ok: false, reason: `${normalizedTarget} idle runner買付想定額が不足しているため見送り。` };
    }
    return quoteRotationLeg(wallet, reserveSymbol, normalizedTarget, amountWei, 1);
}

export async function evaluateIdleBigWaveSidecarDisplay(wallet: OperationalWalletRecord | null, details: HybridLiveDecisionDetails) {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const baseIsCash = details.decision.desiredSymbol.toUpperCase() === reserveSymbol && details.decision.desiredSide === "cash";
    const reserveUsd = wallet ? Number(findHolding(wallet, reserveSymbol)?.usdValue || 0) : 0;
    const nowTs = Date.now();
    const rows: IdleBigWaveSidecarEvaluation[] = [];

    for (const symbol of cfg.symbols) {
        const activeFrom = new Date(cfg.activeFrom[symbol]).getTime();
        const maxSpendUsd = cfg.maxNotionalUsdBySymbol?.[symbol] ?? cfg.maxNotionalUsd;
        if (nowTs < activeFrom) {
            rows.push({
                symbol,
                active: false,
                eligible: false,
                score: 0,
                close: 0,
                breakoutPct: 0,
                volumeRatio: 0,
                mom6: 0,
                mom24: 0,
                fourHourMom: 0,
                oneHourJump: 0,
                closeLocation: 0,
                maxSpendUsd,
                reasons: [`有効化予定: ${new Date(activeFrom).toLocaleString("ja-JP")}`],
            });
            continue;
        }

        try {
            const candles = await fetchLiveBigWaveCandles(symbol, 140);
            const evaluation = evaluateIdleBigWaveSidecarMetrics(symbol, candles);
            if (!evaluation) continue;
            if (wallet && baseIsCash && evaluation.eligible) {
                const quoteGate = await quoteIdleBigWaveEntry(wallet, symbol, reserveUsd);
                evaluation.quote = {
                    checked: true,
                    ok: quoteGate.ok,
                    provider: quoteGate.provider,
                    valueLossPct: quoteGate.valueLossPct,
                    reason: quoteGate.reason,
                };
            } else {
                evaluation.quote = {
                    checked: false,
                    ok: false,
                    reason: baseIsCash ? "条件未達のためquote確認なし。" : "現在はV7のUSDT待機窓ではないためquote確認なし。",
                };
            }
            rows.push(evaluation);
        } catch (error) {
            rows.push({
                symbol,
                active: true,
                eligible: false,
                score: 0,
                close: 0,
                breakoutPct: 0,
                volumeRatio: 0,
                mom6: 0,
                mom24: 0,
                fourHourMom: 0,
                oneHourJump: 0,
                closeLocation: 0,
                maxSpendUsd,
                reasons: [`評価エラー: ${error instanceof Error ? error.message : String(error)}`],
                quote: { checked: false, ok: false, reason: "評価エラーのためquote確認なし。" },
            });
        }
    }

    return rows.sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.score - left.score);
}

async function resolveIdleBigWaveSidecarDecision(
    wallet: OperationalWalletRecord,
    details: HybridLiveDecisionDetails,
    basePlan: EffectiveWalletDecision,
): Promise<EffectiveWalletDecision | null> {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
    if (!cfg.enabled) return null;

    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const current = resolveCurrentSymbol(wallet);
    if (!current) return null;

    const currentSymbol = current.symbol.toUpperCase();
    const sidecarSymbols = cfg.symbols.map((symbol) => symbol.toUpperCase());
    const baseIsCash = basePlan.desiredSymbol.toUpperCase() === reserveSymbol && basePlan.desiredSide === "cash";

    if (sidecarSymbols.includes(currentSymbol)) {
        if (!baseIsCash) {
            return {
                desiredSymbol: reserveSymbol,
                desiredSide: "cash",
                desiredAlloc: 0,
                reason: `V7のUSDT待機窓が終了したため、${current.symbol} サイドロジックを決済します。`,
                sidecar: { type: "idle_big_wave", symbol: current.symbol },
                rotation: null,
            };
        }

        const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
        if (!openPosition?.openedAt || !openPosition.quantity || !openPosition.costBasisUsd) {
            return {
                desiredSymbol: current.symbol,
                desiredSide: "trend",
                desiredAlloc: basePlan.desiredAlloc,
                reason: `${current.symbol} サイドロジック保有中ですが、建玉履歴が不足しているため保有継続します。`,
                sidecar: { type: "idle_big_wave", symbol: current.symbol },
                rotation: null,
            };
        }

        const candles = await fetchLiveBigWaveCandles(current.symbol, 160);
        const latest = candles[candles.length - 1];
        if (!latest) return null;
        const openedAtTs = new Date(openPosition.openedAt).getTime();
        const entryPrice = openPosition.costBasisUsd / openPosition.quantity;
        const decisionTs = details.decision.isoTime ? new Date(details.decision.isoTime).getTime() : Date.now();
        const heldHours = (decisionTs - openedAtTs) / HOUR_MS;
        const sinceEntry = candles.filter((bar) => bar.ts >= openedAtTs);
        const peak = Math.max(entryPrice, ...sinceEntry.map((bar) => bar.high));
        const drawdownFromEntry = latest.low / entryPrice - 1;
        const profitFromEntry = latest.close / entryPrice - 1;
        const retraceFromPeak = peak > 0 ? latest.close / peak - 1 : 0;
        const index = candles.length - 1;
        const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((bar) => bar.close));
        const mom6 = index >= 6 ? latest.close / candles[index - 6].close - 1 : 0;

        let exitReason: string | null = null;
        if (drawdownFromEntry <= -cfg.hardStopPct) exitReason = "hard stop";
        if (!exitReason && profitFromEntry >= cfg.profitTrailActivationPct && retraceFromPeak <= -cfg.profitTrailRetracePct) {
            exitReason = "profit trail";
        }
        if (!exitReason && heldHours >= cfg.weakExitMinHoldHours && latest.close < sma20 && mom6 < 0) {
            exitReason = "weak exit";
        }
        if (!exitReason && heldHours >= cfg.maxHoldHours) exitReason = "max hold";

        if (exitReason) {
            return {
                desiredSymbol: reserveSymbol,
                desiredSide: "cash",
                desiredAlloc: 0,
                reason: `${current.symbol} サイドロジックの${exitReason}条件に到達したためUSDTへ戻します。`,
                sidecar: { type: "idle_big_wave", symbol: current.symbol },
                rotation: null,
            };
        }

        return {
            desiredSymbol: current.symbol,
            desiredSide: "trend",
            desiredAlloc: basePlan.desiredAlloc,
            reason: `${current.symbol} サイドロジック保有を継続します。`,
            sidecar: { type: "idle_big_wave", symbol: current.symbol },
            rotation: null,
        };
    }

    if (currentSymbol !== reserveSymbol || !baseIsCash) return null;

    const reserveUsd = Number(findHolding(wallet, reserveSymbol)?.usdValue || 0);
    const nowTs = Date.now();
    const signals: LiveBigWaveSignal[] = [];
    for (const symbol of cfg.symbols) {
        const activeFrom = new Date(cfg.activeFrom[symbol]).getTime();
        if (nowTs < activeFrom) continue;
        try {
            const candles = await fetchLiveBigWaveCandles(symbol, 140);
            const signal = evaluateIdleBigWaveSignal(symbol, candles);
            if (signal) signals.push(signal);
        } catch (error) {
            console.warn(`Failed to evaluate ${symbol} idle big-wave sidecar:`, error);
        }
    }
    signals.sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) return null;

    const quoteGate = await quoteIdleBigWaveEntry(wallet, best.symbol, reserveUsd);
    if (!quoteGate.ok) {
        return {
            desiredSymbol: reserveSymbol,
            desiredSide: "cash",
            desiredAlloc: 0,
            reason: `${best.symbol} サイドロジック候補あり。ただし ${quoteGate.reason}`,
            sidecar: { type: "idle_big_wave", symbol: best.symbol },
            rotation: null,
        };
    }

    return {
        desiredSymbol: best.symbol,
        desiredSide: "trend",
        desiredAlloc: 1,
        maxSpendUsd: cfg.maxNotionalUsdBySymbol?.[best.symbol as "BIO" | "DUSK"] ?? cfg.maxNotionalUsd,
        reason: `${best.symbol} confirmed_48h サイドロジック発火。Score ${best.score.toFixed(2)}、${quoteGate.reason}`,
        sidecar: { type: "idle_big_wave", symbol: best.symbol },
        rotation: null,
    };
}

async function resolveTwtUsdtSleeveDecision(
    wallet: OperationalWalletRecord,
    basePlan: EffectiveWalletDecision,
): Promise<EffectiveWalletDecision | null> {
    const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar;
    if (!cfg.enabled) return null;

    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const current = resolveCurrentSymbol(wallet);
    const twtHolding = findHolding(wallet, cfg.symbol);
    const hasTwt = Number(twtHolding?.usdValue || 0) >= 3 && BigInt(twtHolding?.balanceWei || "0") > 0n;
    if (!isActiveMonth(cfg.activeMonths) && !hasTwt) return null;

    const otherNonReserve = (wallet.trackedHoldings || []).some((holding) =>
        holding.symbol !== reserveSymbol
        && holding.symbol !== cfg.symbol
        && holding.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.gasSymbol
        && Number(holding.usdValue || 0) >= 3
    );

    if (hasTwt && twtHolding) {
        const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, cfg.symbol);
        if (!openPosition?.openedAt || !openPosition.quantity || !openPosition.costBasisUsd) {
            return otherNonReserve
                ? null
                : {
                    desiredSymbol: cfg.symbol,
                    desiredSide: "trend",
                    desiredAlloc: cfg.sleeveFraction,
                    reason: "TWT余剰USDT枠を保有中ですが、建玉履歴が不足しているため保有継続します。",
                    sidecar: { type: "twt_usdt_sleeve", symbol: cfg.symbol },
                    rotation: null,
                };
        }

        const candles = await fetchLiveBigWaveCandles(cfg.symbol, 260);
        const bars12h = resampleCompleteLiveCandles(candles, 12);
        const indicators = buildIndicatorBars(bars12h);
        const latest = bars12h.at(-1);
        const latestIndicator = indicators.at(-1);
        if (!latest || !latestIndicator) return null;

        const openedAtTs = new Date(openPosition.openedAt).getTime();
        const entryPrice = openPosition.costBasisUsd / openPosition.quantity;
        const heldHours = (Date.now() - openedAtTs) / HOUR_MS;
        const sinceEntry = bars12h.filter((bar) => bar.ts >= openedAtTs);
        const peak = Math.max(entryPrice, ...sinceEntry.map((bar) => bar.high));
        const drawdownFromEntry = latest.low / entryPrice - 1;
        const profitFromEntry = latest.close / entryPrice - 1;
        const retraceFromPeak = peak > 0 ? latest.close / peak - 1 : 0;

        let exitReason: string | null = null;
        if (drawdownFromEntry <= -cfg.hardStopPct) exitReason = "hard stop";
        if (!exitReason && profitFromEntry >= cfg.profitTrailActivationPct && retraceFromPeak <= -cfg.profitTrailRetracePct) {
            exitReason = "profit trail";
        }
        if (!exitReason && heldHours >= cfg.weakExitMinHoldHours && latest.close < latestIndicator.sma40 && latestIndicator.mom20 < 0) {
            exitReason = "weak exit";
        }
        if (!exitReason && heldHours >= cfg.maxHoldHours) exitReason = "max hold";

        if (exitReason) {
            return {
                desiredSymbol: reserveSymbol,
                desiredSide: "cash",
                desiredAlloc: 0,
                reason: `TWT余剰USDT枠の${exitReason}条件に到達したため、TWT分だけUSDTへ戻します。`,
                sidecar: { type: "twt_usdt_sleeve", symbol: cfg.symbol },
                rotation: null,
            };
        }

        return otherNonReserve
            ? null
            : {
                desiredSymbol: cfg.symbol,
                desiredSide: "trend",
                desiredAlloc: cfg.sleeveFraction,
                reason: "TWT余剰USDT枠の保有を継続します。",
                sidecar: { type: "twt_usdt_sleeve", symbol: cfg.symbol },
                rotation: null,
            };
    }

    if (!current) return null;
    const currentSymbol = current.symbol.toUpperCase();
    const baseDesiredSymbol = basePlan.desiredSymbol.toUpperCase();
    const baseKeepsCurrent = currentSymbol === reserveSymbol
        ? (baseDesiredSymbol === reserveSymbol && basePlan.desiredSide === "cash") || baseDesiredSymbol === cfg.symbol
        : basePlan.desiredSymbol.toUpperCase() === currentSymbol;
    if (!baseKeepsCurrent) return null;

    const reserveHolding = findHolding(wallet, reserveSymbol);
    const reserveUsd = Number(reserveHolding?.usdValue || 0);
    if (!reserveHolding || reserveUsd < 10) return null;

    const candles = await fetchLiveBigWaveCandles(cfg.symbol, 260);
    const signal = evaluateTwtUsdtSleeveSignal(candles);
    if (!signal) {
        return currentSymbol === reserveSymbol && baseDesiredSymbol === cfg.symbol
            ? {
                desiredSymbol: reserveSymbol,
                desiredSide: "cash",
                desiredAlloc: 0,
                reason: "TWT 12H候補はありますが、勝率重視75%版の追加条件未達のためUSDT待機を維持します。",
                sidecar: { type: "twt_usdt_sleeve", symbol: cfg.symbol },
                rotation: null,
            }
            : null;
    }

    const quoteGate = await quoteTwtUsdtSleeveEntry(wallet, reserveUsd);
    if (!quoteGate.ok) {
        return {
            desiredSymbol: current.symbol,
            desiredSide: basePlan.desiredSide,
            desiredAlloc: basePlan.desiredAlloc,
            reason: `TWT余剰USDT枠の候補あり。ただし ${quoteGate.reason}`,
            sidecar: { type: "twt_usdt_sleeve", symbol: cfg.symbol },
            rotation: null,
        };
    }

    return {
        desiredSymbol: cfg.symbol,
        desiredSide: "trend",
        desiredAlloc: cfg.sleeveFraction,
        reason: `TWT 12H余剰USDT枠が発火。mom20 ${formatPctForReason(signal.mom20)}、breakout ${formatPctForReason(signal.breakoutPct)}、ADX ${signal.adx14.toFixed(2)}、Score ${signal.score.toFixed(2)}。${quoteGate.reason}`,
        sidecar: { type: "twt_usdt_sleeve", symbol: cfg.symbol },
        rotation: null,
    };
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

function amountWeiForFraction(amountWei: string, fraction: number) {
    const raw = BigInt(amountWei || "0");
    const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(fraction * 10_000))));
    return ((raw * bps) / 10_000n).toString();
}

async function hasPartialExitAfterOpen(walletId: string, symbol: string, openedAt: string) {
    const openedAtMs = new Date(openedAt).getTime();
    const entries = await loadTradeHistoryEntries();
    return entries.some((entry) => (
        entry.walletId === walletId
        && entry.action === "SELL"
        && entry.sourceSymbol.toUpperCase() === symbol.toUpperCase()
        && entry.reason.includes("半分利確")
        && new Date(entry.executedAt).getTime() >= openedAtMs
    ));
}

function resolveHoldingPriceUsd(current: OperationalWalletHolding) {
    const directPrice = Number(current.usdPrice || 0);
    if (directPrice > 0) return directPrice;

    const amount = Number(current.amount || 0);
    const usdValue = Number(current.usdValue || 0);
    return amount > 0 && usdValue > 0 ? usdValue / amount : 0;
}

function optionalMinOk(value: number | undefined | null, min: number | undefined | null) {
    if (min == null) return true;
    return value != null && Number.isFinite(value) && value >= min;
}

function optionalMaxOk(value: number | undefined | null, max: number | undefined | null) {
    if (max == null) return true;
    return value != null && Number.isFinite(value) && value <= max;
}

function isIdleBreakoutLedgerEntry(reason: string | undefined) {
    if (!reason) return false;
    const normalized = reason.toLowerCase();
    return normalized.includes("idle-breakout-entry") || normalized.includes("idle breakout");
}

function entryReasonMetricTag(name: string, value: number | undefined | null) {
    return value != null && Number.isFinite(value) ? `${name}=${value.toFixed(8)}` : null;
}

function resolveLiveIdleBreakoutTrail(
    symbol: string,
    entryPrice: number,
    peakPrice: number,
    latestIndicator: LiveBigWaveCandle & {
        mom20: number;
        momAccel: number;
        volAvg20: number;
    },
    openPosition: {
        entryMom80?: number;
        entryVolumeRatio?: number;
    },
    options: HybridVariantOptions,
) {
    let activationPct = options.idleBreakoutProfitTrailActivationPct ?? null;
    let retracePct = options.idleBreakoutProfitTrailRetracePct ?? null;
    let conditionalEarly = false;
    if (entryPrice <= 0 || peakPrice <= 0) return { activationPct, retracePct, conditionalEarly };

    const upperSymbol = symbol.toUpperCase();
    const conditional = options.idleBreakoutConditionalEarlyTrailBySymbol?.[upperSymbol];
    const tiers = options.idleBreakoutTieredTrailBySymbol?.[upperSymbol];
    const peakProfitPct = (peakPrice / entryPrice) - 1;

    if (conditional && peakProfitPct >= conditional.activationPct) {
        const volumeRatio = latestIndicator.volAvg20 > 0 ? latestIndicator.volume / latestIndicator.volAvg20 : 0;
        const efficiencyRatio = Math.abs(latestIndicator.mom20) > 0
            ? Math.abs(latestIndicator.close / latestIndicator.open - 1) / Math.abs(latestIndicator.mom20)
            : 0;
        const entryOk =
            optionalMinOk(openPosition.entryMom80, conditional.entryMinMom80) &&
            optionalMaxOk(openPosition.entryMom80, conditional.entryMaxMom80) &&
            optionalMinOk(openPosition.entryVolumeRatio, conditional.entryMinVolumeRatio) &&
            optionalMaxOk(openPosition.entryVolumeRatio, conditional.entryMaxVolumeRatio);
        const currentOk =
            optionalMaxOk(latestIndicator.mom20, conditional.maxMom20) &&
            optionalMaxOk(latestIndicator.momAccel, conditional.maxMomAccel) &&
            optionalMaxOk(volumeRatio, conditional.maxVolumeRatio) &&
            optionalMaxOk(efficiencyRatio, conditional.maxEfficiencyRatio);
        if (
            entryOk &&
            currentOk &&
            (conditional.maxPeakProfitPct == null || peakProfitPct <= conditional.maxPeakProfitPct)
        ) {
            activationPct = conditional.activationPct;
            retracePct = conditional.retracePct;
            conditionalEarly = true;
        }
    }

    const activeTier = tiers
        ?.filter((tier) => peakProfitPct >= tier.activationPct)
        .sort((left, right) => right.activationPct - left.activationPct)[0];
    if (activeTier) {
        activationPct = activeTier.activationPct;
        retracePct = activeTier.retracePct;
        conditionalEarly = false;
    }

    return { activationPct, retracePct, conditionalEarly };
}

async function resolveIdleBreakoutExitPlan(
    wallet: OperationalWalletRecord,
    current: OperationalWalletHolding,
    options: HybridVariantOptions,
) {
    const symbol = current.symbol.toUpperCase();
    const idleSymbols = new Set((options.idleBreakoutSymbols || []).map((item) => item.toUpperCase()));
    if (!idleSymbols.has(symbol)) return null;

    const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
    if (
        !openPosition?.openedAt ||
        !openPosition.quantity ||
        !openPosition.costBasisUsd ||
        !isIdleBreakoutLedgerEntry(openPosition.entryReason)
    ) {
        return null;
    }

    const configuredTimeframe = options.idleBreakoutEntryTimeframe || "1h";
    const timeframe = configuredTimeframe === "15m" ? "15m" : "1h";
    const timeframeMs = liveTimeframeToMs(timeframe);
    const candles = await fetchLiveBigWaveCandles(symbol, 260, timeframe);
    const indicators = buildIndicatorBars(candles);
    const latest = candles.at(-1);
    const latestIndicator = indicators.at(-1);
    if (!latest || !latestIndicator) return null;

    const openedAtTs = new Date(openPosition.openedAt).getTime();
    if (!Number.isFinite(openedAtTs)) return null;

    const entryPrice = openPosition.costBasisUsd / openPosition.quantity;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;

    const sinceEntry = candles.filter((bar) => bar.ts >= openedAtTs);
    const peak = Math.max(entryPrice, ...sinceEntry.map((bar) => bar.high));
    const candleHeldBars = Math.max(0, Math.floor((latest.ts - openedAtTs) / timeframeMs));
    const wallClockHeldBars = Math.max(0, Math.floor((Date.now() - openedAtTs) / timeframeMs));
    const heldBars = Math.min(candleHeldBars, wallClockHeldBars);
    const trail = resolveLiveIdleBreakoutTrail(symbol, entryPrice, peak, latestIndicator, openPosition, options);
    const runnerLabel = `1H runner_${options.idleBreakoutMaxHoldBars ?? 72}h`;

    if (
        trail.activationPct != null &&
        trail.retracePct != null &&
        peak >= entryPrice * (1 + trail.activationPct) &&
        latest.close <= peak * (1 - trail.retracePct)
    ) {
        const peakPct = ((peak / entryPrice) - 1) * 100;
        const retracePct = ((latest.close / peak) - 1) * 100;
        return {
            symbol: current.symbol,
            reason: trail.conditionalEarly
                ? `${symbol} ${runnerLabel}早利確です。ピーク +${peakPct.toFixed(2)}%、ピークから ${retracePct.toFixed(2)}%。`
                : `${symbol} ${runnerLabel}トレーリング決済です。ピーク +${peakPct.toFixed(2)}%、ピークから ${retracePct.toFixed(2)}%。`,
        };
    }

    const maxHoldBars = options.idleBreakoutMaxHoldBars;
    if (maxHoldBars != null && heldBars >= maxHoldBars) {
        return {
            symbol: current.symbol,
            reason: `${symbol} ${runnerLabel}の最大保有 ${maxHoldBars} 本に到達したためUSDTへ戻します。held ${heldBars}本 / opened ${new Date(openedAtTs).toISOString()} / latest ${new Date(latest.ts).toISOString()}。`,
        };
    }

    const weakMinHoldBars = options.idleBreakoutWeakExitMinHoldBars ?? 0;
    const weakExitEnabled =
        options.idleBreakoutWeakExitMom20Below != null ||
        options.idleBreakoutWeakExitMomAccelBelow != null ||
        options.idleBreakoutWeakExitRequireCloseBelowSma40 === true;
    const weakExitLossPct = latest.close > 0 && entryPrice > 0 ? (latest.close / entryPrice) - 1 : 0;
    if (
        weakExitEnabled &&
        heldBars >= weakMinHoldBars &&
        optionalMaxOk(latestIndicator.mom20, options.idleBreakoutWeakExitMom20Below) &&
        optionalMaxOk(latestIndicator.momAccel, options.idleBreakoutWeakExitMomAccelBelow) &&
        (
            options.idleBreakoutWeakExitRequireCloseBelowSma40 !== true ||
            (latestIndicator.sma40 > 0 && latest.close <= latestIndicator.sma40)
        ) &&
        (
            options.idleBreakoutWeakExitOnlyWhenLoss !== true ||
            weakExitLossPct < 0
        ) &&
        (
            options.idleBreakoutWeakExitMinLossPct == null ||
            weakExitLossPct <= -Math.abs(options.idleBreakoutWeakExitMinLossPct)
        )
    ) {
        return {
            symbol: current.symbol,
            reason: `${symbol} ${runnerLabel}弱退出です。mom20 ${(latestIndicator.mom20 * 100).toFixed(2)}%、momAccel ${(latestIndicator.momAccel * 100).toFixed(2)}%、損益 ${(weakExitLossPct * 100).toFixed(2)}%、held ${heldBars}本。`,
        };
    }

    return null;
}

async function resolvePartialRunnerExitPlan(
    wallet: OperationalWalletRecord,
    current: OperationalWalletHolding,
    options: HybridVariantOptions,
) {
    const symbol = current.symbol.toUpperCase();
    const rule = options.partialExitBySymbol?.[symbol];
    if (!rule) return null;

    const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
    if (!openPosition?.partialExitTakenAt || !openPosition.quantity || !openPosition.costBasisUsd) return null;

    const currentPrice = resolveHoldingPriceUsd(current);
    if (currentPrice <= 0) return null;

    const entryPrice = openPosition.costBasisUsd / openPosition.quantity;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;

    const storedPeak = Number(openPosition.partialExitPeakPriceUsd || 0);
    const peakPrice = Math.max(storedPeak, currentPrice);
    if (peakPrice > storedPeak) {
        await updateOpenPositionPartialExitPeak(wallet.id, current.symbol, peakPrice);
    }

    if (
        rule.stopAfterPartialPct != null
        && currentPrice <= entryPrice * (1 + rule.stopAfterPartialPct)
    ) {
        const pnlPct = ((currentPrice / entryPrice) - 1) * 100;
        return {
            symbol: current.symbol,
            reason: `${current.symbol} 半分利確後の残り玉を利益保護で決済します。現在損益 ${pnlPct.toFixed(2)}%。`,
        };
    }

    if (
        rule.runnerTrailActivationPct != null
        && rule.runnerTrailRetracePct != null
        && peakPrice >= entryPrice * (1 + rule.runnerTrailActivationPct)
        && currentPrice <= peakPrice * (1 - rule.runnerTrailRetracePct)
    ) {
        const retracePct = ((currentPrice / peakPrice) - 1) * 100;
        return {
            symbol: current.symbol,
            reason: `${current.symbol} 半分利確後の残り玉をトレーリングで決済します。ピークから ${retracePct.toFixed(2)}%。`,
        };
    }

    return null;
}

async function resolvePartialExitPlan(
    wallet: OperationalWalletRecord,
    current: OperationalWalletHolding,
    details: HybridLiveDecisionDetails,
    options: HybridVariantOptions,
) {
    const symbol = current.symbol.toUpperCase();
    const rule = options.partialExitBySymbol?.[symbol];
    if (!rule || rule.fraction <= 0 || rule.fraction >= 1) return null;

    const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
    if (!openPosition?.openedAt || !openPosition.quantity || !openPosition.costBasisUsd) return null;
    if (await hasPartialExitAfterOpen(wallet.id, current.symbol, openPosition.openedAt)) return null;

    const currentUsd = Number(current.usdValue || 0);
    if (currentUsd <= 0 || openPosition.costBasisUsd <= 0) return null;

    const currentEval = findTrendEvaluation(details, current.symbol);
    const strongPartial =
        rule.strongTakeProfitPct != null &&
        (rule.strongMinMomAccel == null || (currentEval?.momAccel ?? -Infinity) >= rule.strongMinMomAccel) &&
        (rule.strongMinVolumeRatio == null || (currentEval?.volumeRatio ?? -Infinity) >= rule.strongMinVolumeRatio);
    const takeProfitPct = strongPartial ? rule.strongTakeProfitPct! : rule.baseTakeProfitPct;
    const unrealizedPct = currentUsd / openPosition.costBasisUsd - 1;
    if (unrealizedPct < takeProfitPct) return null;

    return {
        symbol: current.symbol,
        fraction: rule.fraction,
        reason: `${current.symbol} が +${(takeProfitPct * 100).toFixed(1)}% 以上に到達したため、V7部分利確ルールで半分利確します。`,
    };
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

async function resolvePenguOffRotationDecision(
    wallet: OperationalWalletRecord,
    current: OperationalWalletHolding,
    baseDecision: EffectiveWalletDecision,
    options: HybridVariantOptions,
) {
    if (!options.penguOffRotationEntry || options.penguOffRotationAllowWhileHolding === false) return null;

    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const currentSymbol = current.symbol.toUpperCase();
    if (currentSymbol === reserveSymbol || currentSymbol === "PENGU") return null;

    const currentSymbols = (options.penguOffRotationCurrentSymbols || []).map((symbol) => symbol.toUpperCase());
    if (currentSymbols.length && !currentSymbols.includes(currentSymbol)) return null;

    const targetSymbols = (options.penguOffRotationSymbols || []).map((symbol) => symbol.toUpperCase());
    if (!targetSymbols.length || targetSymbols.includes(currentSymbol)) return null;

    const rotationOptions: HybridVariantOptions = {
        ...options,
        trendDecisionTimeframe: options.penguOffRotationTimeframe ?? "1h",
        expandedTrendSymbols: [
            ...new Set([
                ...(options.expandedTrendSymbols || []),
                currentSymbol,
                ...targetSymbols,
            ]),
        ],
        idleCashTrendContext: options.penguOffRotationAllowTradeGateOff === true,
        idleCashTrendAllowTrendGateOff: options.penguOffRotationAllowTradeGateOff,
    };
    const rotationDetails = await evaluateHybridLiveDecisionDetails("RETQ22", rotationOptions);
    if (!rotationDetails) return null;

    const currentEval = rotationDetails.trendEvaluations.find((item) => item.symbol.toUpperCase() === currentSymbol) || null;
    const rotationEval = rotationDetails.trendEvaluations
        .filter((item) => targetSymbols.includes(item.symbol.toUpperCase()))
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score)[0] || null;
    if (!currentEval || !rotationEval || rotationEval.symbol.toUpperCase() === currentSymbol) return null;

    const scoreGap = rotationEval.score - currentEval.score;
    if (scoreGap < (options.penguOffRotationScoreGap ?? 0)) return null;

    const minHoldBars = options.penguOffRotationMinHoldBars ?? 0;
    if (minHoldBars > 0) {
        const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
        if (!openPosition?.openedAt) return null;
        const barMs = liveTimeframeToMs(options.penguOffRotationTimeframe ?? "1h");
        const heldBars = Math.floor(
            (new Date(rotationDetails.decision.isoTime).getTime() - new Date(openPosition.openedAt).getTime()) / barMs,
        );
        if (heldBars < minHoldBars) return null;
    }

    return {
        desiredSymbol: rotationEval.symbol,
        desiredSide: "trend" as const,
        desiredAlloc: baseDecision.desiredAlloc,
        reason: `PENGU非保有中に ${rotationEval.symbol} の1HローテーションScoreが ${scoreGap.toFixed(2)} 点上回ったため、${current.symbol} から置き換えます。`,
        rotation: {
            fromSymbol: current.symbol,
            toSymbol: rotationEval.symbol,
            scoreGap,
        },
    };
}

async function resolvePenguStrongOverrideDecision(
    wallet: OperationalWalletRecord,
    current: OperationalWalletHolding,
    baseDecision: EffectiveWalletDecision,
    options: HybridVariantOptions,
    precomputedDetails?: HybridLiveDecisionDetails,
) {
    if (!options.penguStrongOverrideEntry) return null;

    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const currentSymbol = current.symbol.toUpperCase();
    if (currentSymbol === reserveSymbol || currentSymbol === "PENGU") return null;

    const currentSymbols = (options.penguStrongOverrideCurrentSymbols || []).map((symbol) => symbol.toUpperCase());
    if (currentSymbols.length && !currentSymbols.includes(currentSymbol)) return null;

    const targetSymbols = (options.penguStrongOverrideSymbols || ["PENGU"]).map((symbol) => symbol.toUpperCase());
    if (!targetSymbols.length || targetSymbols.includes(currentSymbol)) return null;

    const overrideOptions: HybridVariantOptions = {
        ...options,
        trendDecisionTimeframe: options.penguStrongOverrideTimeframe ?? "15m",
        expandedTrendSymbols: [
            ...new Set([
                ...(options.expandedTrendSymbols || []),
                currentSymbol,
                ...targetSymbols,
            ]),
        ],
        idleCashTrendContext: options.penguStrongOverrideAllowTradeGateOff === true,
        idleCashTrendAllowTrendGateOff: options.penguStrongOverrideAllowTradeGateOff,
    };
    const overrideDetails = precomputedDetails || await evaluateHybridLiveDecisionDetails("RETQ22", overrideOptions);
    if (!overrideDetails) return null;

    const currentEval = overrideDetails.trendEvaluations.find((item) => item.symbol.toUpperCase() === currentSymbol) || null;
    const overrideEval = overrideDetails.trendEvaluations
        .filter((item) => targetSymbols.includes(item.symbol.toUpperCase()))
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score)[0] || null;
    if (!currentEval || !overrideEval || overrideEval.symbol.toUpperCase() === currentSymbol) return null;

    const scoreGap = overrideEval.score - currentEval.score;
    if (scoreGap < (options.penguStrongOverrideScoreGap ?? 0)) return null;

    const minHoldBars = options.penguStrongOverrideMinHoldBars ?? 0;
    if (minHoldBars > 0) {
        const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
        if (!openPosition?.openedAt) return null;
        const barMs = liveTimeframeToMs(options.penguStrongOverrideTimeframe ?? "15m");
        const heldBars = Math.floor(
            (new Date(overrideDetails.decision.isoTime).getTime() - new Date(openPosition.openedAt).getTime()) / barMs,
        );
        if (heldBars < minHoldBars) return null;
    }

    return {
        desiredSymbol: overrideEval.symbol,
        desiredSide: "trend" as const,
        desiredAlloc: baseDecision.desiredAlloc,
        reason: `PENGU 15分強判定が ${current.symbol} を ${scoreGap.toFixed(2)} 点上回ったため、弱い保有からPENGUへ切り替えます。`,
        rotation: {
            fromSymbol: current.symbol,
            toSymbol: overrideEval.symbol,
            scoreGap,
        },
    };
}

async function resolveSolWaveOverrideDecision(
    wallet: OperationalWalletRecord,
    current: OperationalWalletHolding,
    baseDecision: EffectiveWalletDecision,
    options: HybridVariantOptions,
) {
    if (!options.solWaveOverrideEntry) return null;

    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const currentSymbol = current.symbol.toUpperCase();
    if (currentSymbol === reserveSymbol || currentSymbol === "SOL") return null;

    const currentSymbols = (options.solWaveOverrideCurrentSymbols || []).map((symbol) => symbol.toUpperCase());
    if (currentSymbols.length && !currentSymbols.includes(currentSymbol)) return null;

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    if (![10, 11, 12].includes(currentMonth)) return null;

    const targetSymbol = "SOL";
    const overrideOptions: HybridVariantOptions = {
        ...options,
        trendDecisionTimeframe: options.solWaveOverrideTimeframe ?? "1h",
        expandedTrendSymbols: [
            ...new Set([
                ...(options.expandedTrendSymbols || []),
                currentSymbol,
                targetSymbol,
            ]),
        ],
        trendBreakoutLookbackBarsBySymbol: {
            ...(options.trendBreakoutLookbackBarsBySymbol ?? {}),
            [targetSymbol]: options.solWaveOverrideBreakoutLookbackBars ?? options.trendBreakoutLookbackBars ?? 16,
        },
        trendBreakoutMinPctBySymbol: {
            ...(options.trendBreakoutMinPctBySymbol ?? {}),
            [targetSymbol]: options.solWaveOverrideBreakoutMinPct ?? options.trendBreakoutMinPct ?? 0.006,
        },
        trendMinVolumeRatioBySymbol: {
            ...(options.trendMinVolumeRatioBySymbol ?? {}),
            [targetSymbol]: options.solWaveOverrideMinVolumeRatio ?? options.trendMinVolumeRatio ?? 1.25,
        },
        trendMinMomAccelBySymbol: {
            ...(options.trendMinMomAccelBySymbol ?? {}),
            [targetSymbol]: options.solWaveOverrideMinMomAccel ?? options.trendMinMomAccel ?? 0,
        },
        trendMinEfficiencyRatioBySymbol: {
            ...(options.trendMinEfficiencyRatioBySymbol ?? {}),
            [targetSymbol]: options.solWaveOverrideMinEfficiencyRatio ?? options.trendMinEfficiencyRatio ?? 0.12,
        },
        idleCashTrendContext: options.solWaveOverrideAllowTradeGateOff === true,
        idleCashTrendAllowTrendGateOff: options.solWaveOverrideAllowTradeGateOff,
    };
    const overrideDetails = await evaluateHybridLiveDecisionDetails("RETQ22", overrideOptions);
    if (!overrideDetails) return null;

    const currentEval = overrideDetails.trendEvaluations.find((item) => item.symbol.toUpperCase() === currentSymbol) || null;
    const solEval = overrideDetails.trendEvaluations.find((item) => item.symbol.toUpperCase() === targetSymbol) || null;
    if (!currentEval || !solEval?.eligible) return null;

    const scoreGap = solEval.score - currentEval.score;
    if (scoreGap < (options.solWaveOverrideScoreGap ?? 0)) return null;

    const minHoldBars = options.solWaveOverrideMinHoldBars ?? 0;
    if (minHoldBars > 0) {
        const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
        if (!openPosition?.openedAt) return null;
        const barMs = liveTimeframeToMs(options.solWaveOverrideTimeframe ?? "1h");
        const heldBars = Math.floor(
            (new Date(overrideDetails.decision.isoTime).getTime() - new Date(openPosition.openedAt).getTime()) / barMs,
        );
        if (heldBars < minHoldBars) return null;
    }

    return {
        desiredSymbol: solEval.symbol,
        desiredSide: "trend" as const,
        desiredAlloc: baseDecision.desiredAlloc,
        reason: `Q4のSOL 1H大波判定がUNIを ${scoreGap.toFixed(2)} 点上回ったため、UNIからSOLへ置き換えます。`,
        rotation: {
            fromSymbol: current.symbol,
            toSymbol: solEval.symbol,
            scoreGap,
        },
    };
}

export async function evaluateLiveHybridDecisionState(
    baseOptions: HybridVariantOptions = buildReclaimHybridVariantOptions(),
): Promise<LiveHybridDecisionState> {
    const cashRescueOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
    const cashRescueDetails = await evaluateHybridLiveDecisionDetails("RETQ22", cashRescueOptions);
    if (cashRescueDetails) {
        return {
            baseDetails: cashRescueDetails,
            baseOptions,
            details: cashRescueDetails,
            options: cashRescueOptions,
            cashRescueApplied: true,
        };
    }

    const baseDetails = await evaluateHybridLiveDecisionDetails("RETQ22", baseOptions);
    if (!baseDetails) {
        throw new Error("ライブシグナル判定に失敗しました。");
    }

    return {
        baseDetails,
        baseOptions,
        details: baseDetails,
        options: baseOptions,
        cashRescueApplied: false,
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

async function resolveWalletDecisionBase(
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
    const portfolioDrawdownCashExitPct = options.portfolioDrawdownCashExitPct;
    const portfolioDrawdownPct = Number(wallet.lastPortfolioDrawdownPct || 0);
    if (
        currentSymbol !== reserveSymbol
        && portfolioDrawdownCashExitPct != null
        && portfolioDrawdownPct <= portfolioDrawdownCashExitPct
    ) {
        const highWaterUsd = Number(wallet.lastPortfolioHighWaterUsd || 0);
        const portfolioUsd = Number(wallet.lastPortfolioUsd || 0);
        return {
            desiredSymbol: reserveSymbol,
            desiredSide: "cash",
            desiredAlloc: 0,
            reason: `ポートフォリオDDが ${portfolioDrawdownPct.toFixed(2)}% となり、退避基準 ${portfolioDrawdownCashExitPct.toFixed(2)}% 以下のため、全額USDTへ退避します。高値評価額 ${highWaterUsd.toFixed(2)} USD / 現在評価額 ${portfolioUsd.toFixed(2)} USD。`,
            rotation: null,
            forcedExit: {
                symbol: current.symbol,
                reason: "portfolio-dd-cash",
            },
        };
    }
    const injSpringCashOnlySignal =
        baseDecision.desiredSymbol.toUpperCase() === "INJ" &&
        baseDecision.reason.includes("inj-spring-cash");
    if (injSpringCashOnlySignal && currentSymbol !== reserveSymbol) {
        return {
            desiredSymbol: current.symbol,
            desiredSide: currentSymbol === reserveSymbol ? "cash" : "trend",
            desiredAlloc: 0,
            reason: `INJ春1h cash判定はUSDT待機中のみ有効です。現在は ${current.symbol} 保有中のため発注しません。`,
            rotation: null,
        };
    }
    const idleBreakoutExit = (options.idleBreakoutSymbols || []).map((symbol) => symbol.toUpperCase()).includes(currentSymbol)
        ? await resolveIdleBreakoutExitPlan(wallet, current, options)
        : null;
    if (idleBreakoutExit) {
        return {
            desiredSymbol: reserveSymbol,
            desiredSide: "cash",
            desiredAlloc: 0,
            reason: idleBreakoutExit.reason,
            rotation: null,
            forcedExit: idleBreakoutExit,
        };
    }

    const idleBreakoutSymbols = new Set((options.idleBreakoutSymbols || []).map((symbol) => symbol.toUpperCase()));
    if (
        idleBreakoutSymbols.has(currentSymbol)
        && baseDecision.desiredSymbol.toUpperCase() === reserveSymbol
    ) {
        const openPosition = await loadOpenPositionForWalletSymbol(wallet.id, current.symbol);
        if (openPosition?.entryReason && isIdleBreakoutLedgerEntry(openPosition.entryReason)) {
            const runnerLabel = `1H runner_${options.idleBreakoutMaxHoldBars ?? 72}h`;
            return {
                desiredSymbol: current.symbol,
                desiredSide: "trend",
                desiredAlloc: baseDecision.desiredAlloc,
                reason: `${current.symbol} は${runnerLabel}由来の保有中です。専用の弱退出・トレーリング・最大保有出口が未成立のため、12H本体のUSDT待機では決済しません。`,
                rotation: null,
            };
        }
    }

    const partialRunnerExit = currentSymbol !== reserveSymbol
        ? await resolvePartialRunnerExitPlan(wallet, current, options)
        : null;
    if (partialRunnerExit) {
        return {
            desiredSymbol: reserveSymbol,
            desiredSide: "cash",
            desiredAlloc: 0,
            reason: partialRunnerExit.reason,
            rotation: null,
            forcedExit: partialRunnerExit,
        };
    }

    const partialExit = currentSymbol !== reserveSymbol && baseDecision.desiredSymbol.toUpperCase() === currentSymbol
        ? await resolvePartialExitPlan(wallet, current, details, options)
        : null;
    if (partialExit) {
        return {
            desiredSymbol: baseDecision.desiredSymbol,
            desiredSide: baseDecision.desiredSide,
            desiredAlloc: baseDecision.desiredAlloc,
            reason: partialExit.reason,
            rotation: null,
            partialExit,
        };
    }

    const penguOffRotation = await resolvePenguOffRotationDecision(wallet, current, {
        desiredSymbol: baseDecision.desiredSymbol,
        desiredSide: baseDecision.desiredSide,
        desiredAlloc: baseDecision.desiredAlloc,
        reason: baseDecision.reason,
        rotation: null,
    }, options);
    if (penguOffRotation) {
        return penguOffRotation;
    }

    const penguStrongOverride = await resolvePenguStrongOverrideDecision(wallet, current, {
        desiredSymbol: baseDecision.desiredSymbol,
        desiredSide: baseDecision.desiredSide,
        desiredAlloc: baseDecision.desiredAlloc,
        reason: baseDecision.reason,
        rotation: null,
    }, options);
    if (penguStrongOverride) {
        return penguStrongOverride;
    }

    const solWaveOverride = await resolveSolWaveOverrideDecision(wallet, current, {
        desiredSymbol: baseDecision.desiredSymbol,
        desiredSide: baseDecision.desiredSide,
        desiredAlloc: baseDecision.desiredAlloc,
        reason: baseDecision.reason,
        rotation: null,
    }, options);
    if (solWaveOverride) {
        return solWaveOverride;
    }

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

function sortedEligibleTrendEvaluations(details: HybridLiveDecisionDetails) {
    return [...details.trendEvaluations]
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score);
}

function hasCloseMultipleCandidates(details: HybridLiveDecisionDetails) {
    const eligible = sortedEligibleTrendEvaluations(details);
    return Boolean(eligible[0] && eligible[1] && eligible[0].score - eligible[1].score <= 10);
}

function shouldApplyAiMarketJudgement(judgement: AiMarketJudgement) {
    return judgement.source === "openai" || process.env.AI_MARKET_JUDGEMENT_APPLY_HEURISTIC === "1";
}

function withAppliedJudgement(judgement: AiMarketJudgement) {
    return { ...judgement, applied: true };
}

async function buildAiMarketJudgementInput(
    wallet: OperationalWalletRecord,
    details: HybridLiveDecisionDetails,
    plan: EffectiveWalletDecision,
) {
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const current = resolveCurrentSymbol(wallet);
    if (!current) return null;

    const currentSymbol = current.symbol.toUpperCase();
    const desiredSymbol = plan.desiredSymbol.toUpperCase();
    const currentEval = findTrendEvaluation(details, current.symbol);
    const desiredEval = findTrendEvaluation(details, plan.desiredSymbol);
    const openPosition = currentSymbol !== reserveSymbol
        ? await loadOpenPositionForWalletSymbol(wallet.id, current.symbol)
        : null;
    const unrealizedPnlPct = openPosition?.costBasisUsd
        ? ((Number(current.usdValue || 0) - openPosition.costBasisUsd) / openPosition.costBasisUsd) * 100
        : null;
    const openPositionAgeHours = openPosition?.openedAt
        ? (new Date(details.decision.isoTime).getTime() - new Date(openPosition.openedAt).getTime()) / (60 * 60 * 1000)
        : null;

    let trigger: "multiple_candidates" | "rotation_check" | "profit_exit" | null = null;
    if (plan.rotation || (currentSymbol !== reserveSymbol && desiredSymbol !== currentSymbol)) {
        trigger = Number(unrealizedPnlPct || 0) >= 8 ? "profit_exit" : "rotation_check";
    } else if (currentSymbol === reserveSymbol && hasCloseMultipleCandidates(details)) {
        trigger = "multiple_candidates";
    }

    if (!trigger) return null;

    return {
        trigger,
        currentSymbol,
        desiredSymbol,
        desiredSide: plan.desiredSide,
        currentEval,
        desiredEval,
        candidateEvaluations: sortedEligibleTrendEvaluations(details),
        decision: details.decision,
        rotation: plan.rotation,
        unrealizedPnlPct,
        openPositionAgeHours,
    };
}

export async function resolveWalletDecision(
    wallet: OperationalWalletRecord,
    details: HybridLiveDecisionDetails,
    options: HybridVariantOptions,
): Promise<EffectiveWalletDecision> {
    const basePlan = await resolveWalletDecisionBase(wallet, details, options);
    if (basePlan.forcedExit) return basePlan;
    const twtSleevePlan = await resolveTwtUsdtSleeveDecision(wallet, basePlan);
    if (twtSleevePlan) return twtSleevePlan;
    const sidecarPlan = await resolveIdleBigWaveSidecarDecision(wallet, details, basePlan);
    if (sidecarPlan) return sidecarPlan;

    const judgementInput = await buildAiMarketJudgementInput(wallet, details, basePlan);
    if (!judgementInput) return basePlan;

    const judgement = await evaluateAiMarketJudgement(judgementInput);
    const canApply = shouldApplyAiMarketJudgement(judgement);
    const current = resolveCurrentSymbol(wallet);
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;

    if (
        canApply
        && current
        && current.symbol !== reserveSymbol
        && current.symbol !== basePlan.desiredSymbol
        && judgement.confidence >= 0.7
        && ["delay_rotation", "block_rotation", "wide_trail"].includes(judgement.decision)
        && judgement.preferredSymbol.toUpperCase() === current.symbol.toUpperCase()
    ) {
        const applied = withAppliedJudgement(judgement);
        return {
            desiredSymbol: current.symbol,
            desiredSide: basePlan.desiredSide === "range" ? "range" : "trend",
            desiredAlloc: basePlan.desiredAlloc,
            reason: `GPT相場判定により、今回は ${current.symbol} の保有を継続します。${applied.reasonJa}`,
            marketJudgement: applied,
            rotation: null,
        };
    }

    if (
        canApply
        && current?.symbol === reserveSymbol
        && judgement.decision === "prefer_candidate"
        && judgement.confidence >= 0.74
    ) {
        const preferred = details.trendEvaluations.find((item) =>
            item.symbol.toUpperCase() === judgement.preferredSymbol.toUpperCase()
            && item.eligible
        );
        const desired = findTrendEvaluation(details, basePlan.desiredSymbol);
        if (preferred && (!desired || Math.abs(preferred.score - desired.score) <= 8)) {
            const applied = withAppliedJudgement(judgement);
            return {
                desiredSymbol: preferred.symbol,
                desiredSide: "trend",
                desiredAlloc: basePlan.desiredAlloc,
                reason: `GPT相場判定により、複数候補の中では ${preferred.symbol} を優先します。${applied.reasonJa}`,
                marketJudgement: applied,
                rotation: null,
            };
        }
    }

    return {
        ...basePlan,
        marketJudgement: judgement,
    };
}

async function persistLiveDecisionDisplayCache(
    details: HybridLiveDecisionDetails,
    options: HybridVariantOptions,
    cashRescueApplied: boolean,
    wallets: OperationalWalletRecord[],
) {
    const activeWallet = wallets.find((wallet) => !wallet.deletedAt && wallet.status !== "paused") || null;
    let walletDecision: {
        currentSymbol: string;
        desiredSymbol: string;
        desiredSide: "trend" | "range" | "cash";
        desiredAlloc: number;
        reason: string;
        marketJudgement?: unknown;
        rotation: {
            fromSymbol: string;
            toSymbol: string;
            scoreGap: number;
        } | null;
    } | null = null;
    let sidecarEvaluations: IdleBigWaveSidecarEvaluation[] = [];
    const idleRunnerEvaluations = await evaluateIdleRunnerDisplay();

    if (activeWallet) {
        sidecarEvaluations = await evaluateIdleBigWaveSidecarDisplay(activeWallet, details);
        const effective = await resolveWalletDecision(activeWallet, details, options);
        walletDecision = {
            currentSymbol: resolveDisplayCurrentSymbol(activeWallet),
            desiredSymbol: effective.desiredSymbol,
            desiredSide: effective.desiredSide,
            desiredAlloc: effective.desiredAlloc,
            reason: effective.reason,
            marketJudgement: effective.marketJudgement,
            rotation: effective.rotation,
        };
        details = {
            ...details,
            decision: {
                ...details.decision,
                desiredSymbol: effective.desiredSymbol,
                desiredSide: effective.desiredSide,
                desiredAlloc: effective.desiredAlloc,
                reason: effective.reason,
            },
        };
    }

    const payload = {
        ok: true,
        details,
        walletDecision,
        sidecarEvaluations,
        idleRunnerEvaluations,
        cashRescueApplied,
        cachedAt: Date.now(),
    } as const;

    await writeLiveDecisionCache(payload);
    return payload;
}

export async function refreshLiveDecisionDisplayCache(
    options: HybridVariantOptions = buildReclaimHybridVariantOptions(),
) {
    const state = await evaluateLiveHybridDecisionState(options);
    const wallets = await loadOperationalWallets();
    const activeWallets = wallets.filter((wallet) => !wallet.deletedAt && wallet.status !== "paused");
    const refreshedWallets: OperationalWalletRecord[] = [];

    for (const wallet of activeWallets) {
        try {
            refreshedWallets.push(await refreshWalletBalance(wallet));
        } catch (error) {
            console.warn(`[live-decision-cache] Failed to refresh wallet ${wallet.address}:`, error);
            refreshedWallets.push(wallet);
        }
    }

    const latestWallets = refreshedWallets.length > 0
        ? [
            ...refreshedWallets,
            ...wallets.filter((wallet) => !activeWallets.some((item) => item.id === wallet.id)),
        ]
        : wallets;

    if (refreshedWallets.length > 0) {
        await saveOperationalWallets(latestWallets);
    }

    return persistLiveDecisionDisplayCache(state.details, state.options, state.cashRescueApplied, latestWallets);
}

function decideWalletAction(wallet: OperationalWalletRecord, plan: EffectiveWalletDecision) {
    const reserveSymbol = RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol;
    const current = resolveCurrentSymbol(wallet);
    const smallWalletGuard = RECLAIM_HYBRID_EXECUTION_PROFILE.smallWalletNonPenguGuard;
    const portfolioUsd = Number(wallet.lastPortfolioUsd || 0);
    const isSmallWalletGuardActive =
        smallWalletGuard.enabled
        && portfolioUsd > 0
        && portfolioUsd < smallWalletGuard.minPortfolioUsd;
    const smallWalletAllowedSymbols = new Set(smallWalletGuard.allowedSymbols.map((symbol) => symbol.toUpperCase()));
    const desiredUpper = plan.desiredSymbol.toUpperCase();
    const blocksSmallWalletEntry = (symbol: string) =>
        isSmallWalletGuardActive
        && symbol.toUpperCase() !== reserveSymbol
        && !smallWalletAllowedSymbols.has(symbol.toUpperCase());
    if (!current) {
        return {
            kind: "skip" as const,
            currentSymbol: "NONE",
            reason: "運用対象の残高が見つからないため、今回は見送ります。",
        };
    }

    if (plan.sidecar?.type === "twt_usdt_sleeve") {
        const reserveHolding = findHolding(wallet, reserveSymbol);
        const twtHolding = findHolding(wallet, plan.sidecar.symbol);
        if (blocksSmallWalletEntry(plan.sidecar.symbol) && plan.desiredSymbol === plan.sidecar.symbol) {
            return {
                kind: "skip" as const,
                currentSymbol: current.symbol,
                reason: `小口ウォレット保護中（${portfolioUsd.toFixed(2)} USD < ${smallWalletGuard.minPortfolioUsd} USD）のため、許可対象外のTWT余剰USDT枠は見送ります。`,
            };
        }
        if (plan.desiredSymbol === reserveSymbol) {
            if (!twtHolding || BigInt(twtHolding.balanceWei || "0") <= 0n) {
                return {
                    kind: "noop" as const,
                    currentSymbol: current.symbol,
                    reason: "TWT余剰USDT枠の保有残高がないため、そのまま維持します。",
                };
            }
            return {
                kind: "trade" as const,
                currentSymbol: current.symbol,
                srcSymbol: plan.sidecar.symbol,
                destSymbol: reserveSymbol,
                amountWei: twtHolding.balanceWei,
                action: "SELL" as const,
                reason: plan.reason,
            };
        }

        if (plan.desiredSymbol === plan.sidecar.symbol) {
            if (twtHolding && Number(twtHolding.usdValue || 0) >= 3) {
                return {
                    kind: "noop" as const,
                    currentSymbol: current.symbol,
                    reason: plan.reason,
                };
            }
            const reserveUsd = Number(reserveHolding?.usdValue || 0);
            if (!reserveHolding || reserveUsd < 10) {
                return {
                    kind: "skip" as const,
                    currentSymbol: current.symbol,
                    reason: "TWT余剰USDT枠に使えるUSDTが不足しているため、今回は見送ります。",
                };
            }
            const spendUsd = reserveUsd * RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar.sleeveFraction;
            const amountWei = proportionalWeiAmount(reserveHolding.balanceWei, reserveUsd > 0 ? spendUsd / reserveUsd : 0);
            if (!amountWei || amountWei === "0") {
                return {
                    kind: "skip" as const,
                    currentSymbol: current.symbol,
                    reason: "TWT余剰USDT枠へ回せるUSDTが不足しているため、今回は見送ります。",
                };
            }
            return {
                kind: "trade" as const,
                currentSymbol: current.symbol,
                srcSymbol: reserveSymbol,
                destSymbol: plan.sidecar.symbol,
                amountWei,
                action: "BUY" as const,
                reason: plan.reason,
            };
        }
    }

    if (plan.partialExit && current.symbol.toUpperCase() === plan.partialExit.symbol.toUpperCase()) {
        const amountWei = amountWeiForFraction(current.balanceWei, plan.partialExit.fraction);
        if (BigInt(amountWei) > 0n) {
            return {
                kind: "trade" as const,
                currentSymbol: current.symbol,
                srcSymbol: current.symbol,
                destSymbol: RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol,
                amountWei,
                action: "SELL" as const,
                reason: plan.partialExit.reason,
            };
        }
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
        if (blocksSmallWalletEntry(plan.desiredSymbol)) {
            return {
                kind: "noop" as const,
                currentSymbol: current.symbol,
                reason: `小口ウォレット保護中（${portfolioUsd.toFixed(2)} USD < ${smallWalletGuard.minPortfolioUsd} USD）のため、${current.symbol} から ${plan.desiredSymbol} への許可対象外ローテーションは見送ります。`,
            };
        }
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
    const effectivePortfolioUsd = Number(wallet.lastPortfolioUsd || current.usdValue || reserveUsd || 0);
    const effectiveAlloc = plan.desiredAlloc;
    if (blocksSmallWalletEntry(plan.desiredSymbol)) {
        return {
            kind: "skip" as const,
            currentSymbol: current.symbol,
            reason: `小口ウォレット保護中（${effectivePortfolioUsd.toFixed(2)} USD < ${smallWalletGuard.minPortfolioUsd} USD）のため、USDTから ${plan.desiredSymbol} への許可対象外エントリーは見送ります。`,
        };
    }
    if (!reserveHolding || reserveUsd < 10) {
        return {
            kind: "skip" as const,
            currentSymbol: current.symbol,
            reason: "新規エントリーに使えるUSDTが不足しているため、今回は見送ります。",
        };
    }

    const reserveBufferUsd = effectivePortfolioUsd * (RECLAIM_HYBRID_EXECUTION_PROFILE.stableReservePct / 100);
    const deployUsd = Math.max(0, (effectivePortfolioUsd * effectiveAlloc) - reserveBufferUsd);
    const rawSpendUsd = Math.min(
        reserveUsd,
        deployUsd > 0 ? deployUsd : reserveUsd * effectiveAlloc,
    );
    const spendUsd = Math.min(rawSpendUsd, plan.maxSpendUsd ?? Number.POSITIVE_INFINITY);

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
        walletAfterTrade = await refreshWalletBalanceAfterTrade(wallet, action, trade);
        const historyEntry = await appendTradeHistory({
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
        if (historyEntry) await notifyTradeFill(historyEntry);
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

export async function runPenguStrongOverrideAutotrade(): Promise<LiveHybridRunSummary> {
    const runtime = isAutoTradePaused();
    if (runtime.paused) {
        return buildPausedRunSummary("pengu_15m", "PENGU 15分強判定", runtime.reason);
    }

    const options = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
    const overrideOptions: HybridVariantOptions = {
        ...options,
        penguStrongOverrideEntry: true,
        penguStrongOverrideTimeframe: "15m",
        penguStrongOverrideSymbols: ["PENGU"],
        penguStrongOverrideCurrentSymbols: ["ETH", "SOL", "INJ"],
        penguStrongOverrideScoreGap: 15,
        penguStrongOverrideMinHoldBars: 2,
        penguStrongOverrideAllowTradeGateOff: true,
        trendDecisionTimeframe: "15m",
        expandedTrendSymbols: [
            ...new Set([
                ...(options.expandedTrendSymbols || []),
                "ETH",
                "SOL",
                "INJ",
                "PENGU",
            ]),
        ],
        idleCashTrendContext: true,
        idleCashTrendAllowTrendGateOff: true,
    };

    const details = await evaluateHybridLiveDecisionDetails("RETQ22", overrideOptions);
    if (!details) {
        throw new Error("PENGU 15分強判定のライブシグナル取得に失敗しました。");
    }

    const wallets = await loadOperationalWallets();
    const activeWallets = wallets.filter((wallet) => !wallet.deletedAt && wallet.status !== "paused");
    const refreshedWallets: OperationalWalletRecord[] = [];
    const walletResults: LiveHybridWalletRunResult[] = [];

    for (const wallet of activeWallets) {
        const refreshed = await refreshWalletBalance(wallet);
        refreshedWallets.push(refreshed);
        const current = resolveCurrentSymbol(refreshed);
        const effectiveStatus = resolveEffectiveWalletStatus(refreshed);

        if (!refreshed.backupConfirmed) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "skipped",
                step: "hold",
                stepLabel: "停止",
                reason: "バックアップ未確認のため、PENGU 15分強判定は実行しません。",
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: current?.symbol || "NONE",
            });
            continue;
        }

        if (effectiveStatus !== "running" || !current) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "skipped",
                step: "hold",
                stepLabel: "見送り",
                reason: "運用対象の実残高がないため、PENGU 15分強判定は見送ります。",
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: current?.symbol || "NONE",
            });
            continue;
        }

        const currentSymbol = current.symbol.toUpperCase();
        const idleBreakoutTarget = details.decision.desiredSymbol.toUpperCase();
        const idleBreakoutSymbols = new Set(
            (RECLAIM_HYBRID_EXECUTION_PROFILE.idleBreakoutSymbols ?? []).map((symbol) => symbol.toUpperCase()),
        );
        const idleBreakoutSymbolLabel = [...idleBreakoutSymbols].join("/");
        const idleBreakoutRunnerLabel = `1H runner_${RECLAIM_HYBRID_EXECUTION_PROFILE.idleBreakoutMaxHoldBars ?? 72}h`;
        const isIdleBreakoutEntry =
            currentSymbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
            && idleBreakoutSymbols.has(idleBreakoutTarget)
            && details.decision.reason.includes("idle-breakout-entry");
        if (isIdleBreakoutEntry) {
            const targetEval = details.trendEvaluations.find((item) => item.symbol.toUpperCase() === idleBreakoutTarget) || null;
            const entryTags = [
                entryReasonMetricTag("entryMom80", targetEval?.mom80),
                entryReasonMetricTag("entryVolumeRatio", targetEval?.volumeRatio),
            ].filter(Boolean).join(" ");
            const plan: EffectiveWalletDecision = {
                desiredSymbol: idleBreakoutTarget,
                desiredSide: "trend",
                desiredAlloc: details.decision.desiredAlloc || 1,
                reason: `USDT待機中の${idleBreakoutTarget} ${idleBreakoutRunnerLabel}条件成立: ${details.decision.reason}${entryTags ? ` ${entryTags}` : ""}`,
                rotation: null,
            };
            const action = decideWalletAction(refreshed, plan);
            if (action.kind !== "trade" || action.action !== "BUY") {
                walletResults.push({
                    walletId: refreshed.id,
                    address: refreshed.address,
                    status: action.kind === "noop" ? "noop" : "skipped",
                    step: action.kind === "noop" ? "hold" : "wait",
                    stepLabel: action.kind === "noop" ? "維持" : "見送り",
                    reason: action.reason,
                    desiredSymbol: idleBreakoutTarget,
                    desiredSide: "trend",
                    currentSymbol: action.currentSymbol,
                });
                continue;
            }

            const quoteGate = await quoteIdleBreakoutEntry(refreshed, idleBreakoutTarget, action.amountWei);
            if (!quoteGate.ok) {
                walletResults.push({
                    walletId: refreshed.id,
                    address: refreshed.address,
                    status: "skipped",
                    step: "wait",
                    stepLabel: "quote見送り",
                    reason: quoteGate.reason,
                    desiredSymbol: idleBreakoutTarget,
                    desiredSide: "trend",
                    currentSymbol: current.symbol,
                    amountWei: action.amountWei,
                });
                continue;
            }

            try {
                const step = await executeWalletAction(refreshed, plan.desiredSymbol, plan.desiredSide, {
                    ...action,
                    reason: `${plan.reason} ${quoteGate.reason}`,
                });
                walletResults.push(step.result);
                const refreshedIndex = refreshedWallets.findIndex((item) => item.id === step.walletAfterTrade.id);
                if (refreshedIndex >= 0) refreshedWallets[refreshedIndex] = step.walletAfterTrade;
            } catch (error) {
                walletResults.push({
                    walletId: refreshed.id,
                    address: refreshed.address,
                    status: "error",
                    step: "buy",
                    stepLabel: "買付ステップ",
                    reason: error instanceof Error ? error.message : `${idleBreakoutTarget} ${idleBreakoutRunnerLabel}の買付準備でエラーが発生しました。`,
                    desiredSymbol: idleBreakoutTarget,
                    desiredSide: "trend",
                    currentSymbol: current.symbol,
                    amountWei: action.amountWei,
                });
            }
            continue;
        }

        if (currentSymbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol) {
            const targetEval = details.trendEvaluations.find((item) => item.symbol.toUpperCase() === idleBreakoutTarget) || null;
            const blockers = [
                idleBreakoutSymbols.has(idleBreakoutTarget) ? null : `${idleBreakoutRunnerLabel}の採用候補は ${details.decision.desiredSymbol}`,
                details.decision.reason.includes("idle-breakout-entry") ? null : "idle-breakout-entry未成立",
                targetEval?.eligible ? null : `${idleBreakoutTarget} eligible=false (${targetEval?.reasons.join(", ") || "評価なし"})`,
            ].filter(Boolean).join(" / ");
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "noop",
                step: "hold",
                stepLabel: "条件未達",
                reason: blockers
                    ? `USDT待機中${idleBreakoutSymbolLabel} ${idleBreakoutRunnerLabel}条件未達: ${blockers}。USDTを維持します。`
                    : `USDT待機中${idleBreakoutSymbolLabel} ${idleBreakoutRunnerLabel}条件未達のため、USDTを維持します。`,
                desiredSymbol: idleBreakoutTarget,
                desiredSide: "trend",
                currentSymbol: current.symbol,
            });
            continue;
        }

        if (!["ETH", "SOL", "INJ"].includes(currentSymbol)) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "skipped",
                step: "hold",
                stepLabel: "対象外",
                reason: `現在保有が ${current.symbol} のため、PENGU 15分強判定の乗り換え対象外です。`,
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: current.symbol,
            });
            continue;
        }

        const penguHolding = findHolding(refreshed, "PENGU");
        if (Number(penguHolding?.usdValue || 0) >= 3) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "noop",
                step: "hold",
                stepLabel: "維持",
                reason: "PENGUをすでに保有しているため、追加の15分乗り換えは行いません。",
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: current.symbol,
            });
            continue;
        }

        const plan = await resolvePenguStrongOverrideDecision(refreshed, current, {
            desiredSymbol: details.decision.desiredSymbol,
            desiredSide: details.decision.desiredSide,
            desiredAlloc: 1,
            reason: details.decision.reason,
            rotation: null,
        }, overrideOptions, details);

        if (!plan || plan.desiredSymbol.toUpperCase() !== "PENGU") {
            const currentEval = details.trendEvaluations.find((item) => item.symbol.toUpperCase() === currentSymbol) || null;
            const penguEval = details.trendEvaluations.find((item) => item.symbol.toUpperCase() === "PENGU") || null;
            const scoreGap = penguEval && currentEval ? penguEval.score - currentEval.score : null;
            const blockers = [
                penguEval?.eligible ? null : `PENGU eligible=false (${penguEval?.reasons.join(", ") || "評価なし"})`,
                scoreGap != null && scoreGap < 15 ? `Score差 ${scoreGap.toFixed(2)} < 15` : null,
                currentEval ? null : `${current.symbol} の15分評価なし`,
            ].filter(Boolean).join(" / ");
            const reason = blockers
                ? `PENGU 15分強判定の条件未達: ${blockers}。現在保有を維持します。`
                : "PENGU 15分強判定の条件未達のため、現在保有を維持します。";
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "noop",
                step: "hold",
                stepLabel: "条件未達",
                reason,
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: current.symbol,
            });
            continue;
        }

        const quoteGate = await quotePenguStrongOverrideRotation(refreshed, current);
        if (!quoteGate.ok) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "skipped",
                step: "wait",
                stepLabel: "quote見送り",
                reason: quoteGate.reason,
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: current.symbol,
            });
            continue;
        }

        const action = decideWalletAction(refreshed, plan);
        if (action.kind !== "trade" || action.action !== "SELL" || action.destSymbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: action.kind === "noop" ? "noop" : "skipped",
                step: action.kind === "noop" ? "hold" : "wait",
                stepLabel: "見送り",
                reason: action.reason,
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: action.currentSymbol,
            });
            continue;
        }

        let firstStep: Awaited<ReturnType<typeof executeWalletAction>>;
        try {
            firstStep = await executeWalletAction(refreshed, plan.desiredSymbol, plan.desiredSide, {
                ...action,
                reason: `${action.reason} ${quoteGate.reason}`,
            });
        } catch (error) {
            walletResults.push({
                walletId: refreshed.id,
                address: refreshed.address,
                status: "error",
                step: "sell",
                stepLabel: "売却ステップ",
                reason: error instanceof Error ? error.message : "PENGU 15分強判定の売却準備でエラーが発生しました。",
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: current.symbol,
                amountWei: action.amountWei,
            });
            continue;
        }

        let latestWallet = firstStep.walletAfterTrade;
        walletResults.push(firstStep.result);

        const refreshedIndex = refreshedWallets.findIndex((item) => item.id === latestWallet.id);
        if (refreshedIndex >= 0) refreshedWallets[refreshedIndex] = latestWallet;

        let followUpAction = decideWalletAction(latestWallet, plan);
        let resolvedBuyAction: Extract<ReturnType<typeof decideWalletAction>, { kind: "trade"; action: "BUY" }> | null = null;
        if (followUpAction.kind === "trade" && followUpAction.action === "BUY") {
            resolvedBuyAction = followUpAction;
        } else {
            for (let attempt = 0; attempt < POST_SELL_REFRESH_MAX_ATTEMPTS; attempt += 1) {
                await sleep(POST_SELL_REFRESH_RETRY_MS);
                latestWallet = await refreshWalletBalance(latestWallet);
                followUpAction = decideWalletAction(latestWallet, plan);
                if (followUpAction.kind === "trade" && followUpAction.action === "BUY") {
                    resolvedBuyAction = followUpAction;
                    break;
                }
            }
        }

        if (!resolvedBuyAction) {
            walletResults.push({
                walletId: latestWallet.id,
                address: latestWallet.address,
                status: "skipped",
                step: "wait",
                stepLabel: "残高反映待ち",
                reason: `${current.symbol}を売却後、USDT残高反映が追いつかずPENGU買付へ進めませんでした。次回15分判定で再確認します。`,
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: resolveCurrentSymbol(latestWallet)?.symbol || followUpAction.currentSymbol,
            });
            continue;
        }

        try {
            const secondStep = await executeWalletAction(latestWallet, plan.desiredSymbol, plan.desiredSide, {
                ...resolvedBuyAction,
                reason: `${current.symbol} から PENGU へ15分強判定で乗り換えました。${quoteGate.reason}`,
            });
            latestWallet = secondStep.walletAfterTrade;
            walletResults.push(secondStep.result);
            const secondIndex = refreshedWallets.findIndex((item) => item.id === latestWallet.id);
            if (secondIndex >= 0) refreshedWallets[secondIndex] = latestWallet;
        } catch (error) {
            walletResults.push({
                walletId: latestWallet.id,
                address: latestWallet.address,
                status: "error",
                step: "buy",
                stepLabel: "買付ステップ",
                reason: error instanceof Error ? error.message : "PENGU 15分強判定の買付準備でエラーが発生しました。",
                desiredSymbol: "PENGU",
                desiredSide: "trend",
                currentSymbol: resolvedBuyAction.currentSymbol,
                amountWei: resolvedBuyAction.amountWei,
            });
        }
    }

    let latestWallets = wallets;
    if (refreshedWallets.length > 0) {
        const unchanged = wallets.filter((wallet) => !activeWallets.some((item) => item.id === wallet.id));
        latestWallets = [...refreshedWallets, ...unchanged];
        await saveOperationalWallets(latestWallets);
    }

    const summaryResult =
        walletResults.find((item) => item.status === "traded")
        || walletResults.find((item) => item.status === "noop")
        || walletResults.find((item) => item.status === "skipped")
        || null;
    const summaryReason = summaryResult?.reason || "PENGU 15分強判定を確認しました。";
    const summaryIsIdleRunner = summaryReason.includes("1H runner_");
    const summaryDesiredSymbol = summaryResult?.desiredSymbol || "PENGU";
    const summaryDesiredSide = summaryResult?.desiredSide || "trend";
    const summary: LiveHybridRunSummary = {
        strategyId: RECLAIM_HYBRID_STRATEGY_ID,
        trigger: "pengu_15m",
        triggerLabel: summaryIsIdleRunner ? `1H runner_${RECLAIM_HYBRID_EXECUTION_PROFILE.idleBreakoutMaxHoldBars ?? 72}h判定` : "PENGU 15分強判定",
        executedAt: new Date().toISOString(),
        decisionTime: details.decision.isoTime,
        desiredSymbol: summaryDesiredSymbol,
        desiredSide: summaryDesiredSide,
        reason: summaryReason,
        marketJudgement: null,
        walletResults,
    };

    await appendAutoTradeHistory(summary);
    await notifyAutoTrade(summary);
    return summary;
}

export async function runLiveHybridAutotrade(
    options: HybridVariantOptions = buildReclaimHybridVariantOptions(),
    context: { trigger?: "scheduled" | "manual" | "pengu_15m" | "inj_spring" } = {},
): Promise<LiveHybridRunSummary> {
    const runtime = isAutoTradePaused();
    if (runtime.paused) {
        const trigger = context.trigger || "manual";
        const triggerLabel =
            trigger === "scheduled" ? "12H定期判定"
                : trigger === "pengu_15m" ? "PENGU 15分強判定"
                    : trigger === "inj_spring" ? "INJ spring判定"
                        : "手動トレード判定";
        return buildPausedRunSummary(trigger, triggerLabel, runtime.reason);
    }

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
                marketJudgement: plan.marketJudgement,
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
        firstStep.result.marketJudgement = plan.marketJudgement;
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
            && plan.desiredSymbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
            && !plan.partialExit;

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
        secondStep.result.marketJudgement = plan.marketJudgement;
        walletResults.push(secondStep.result);

        const secondIndex = refreshedWallets.findIndex((item) => item.id === latestWallet.id);
        if (secondIndex >= 0) {
            refreshedWallets[secondIndex] = latestWallet;
        } else {
            refreshedWallets.push(latestWallet);
        }
    }

    let latestWallets = wallets;
    if (refreshedWallets.length > 0) {
        const unchanged = wallets.filter((wallet) => !activeWallets.some((item) => item.id === wallet.id));
        latestWallets = [...refreshedWallets, ...unchanged];
        await saveOperationalWallets(latestWallets);
    }

    const uniqueDesiredSymbols = [...new Set(walletResults.map((item) => item.desiredSymbol).filter(Boolean))];
    const uniqueDesiredSides = [...new Set(walletResults.map((item) => item.desiredSide).filter(Boolean))];
    const summaryDesiredSymbol = uniqueDesiredSymbols.length === 1 ? uniqueDesiredSymbols[0] : decision.desiredSymbol;
    const summaryDesiredSide = uniqueDesiredSides.length === 1 ? uniqueDesiredSides[0] : decision.desiredSide;
    const summaryReason =
        walletResults.find((item) => item.status === "traded")?.reason
        || walletResults.find((item) => item.status === "noop")?.reason
        || decision.reason;
    const summaryMarketJudgement =
        walletResults.find((item) => item.marketJudgement)?.marketJudgement || null;

    const summary: LiveHybridRunSummary = {
        strategyId: RECLAIM_HYBRID_STRATEGY_ID,
        trigger: context.trigger ?? "scheduled",
        triggerLabel: context.trigger === "manual"
            ? "手動トレード判定"
            : context.trigger === "pengu_15m"
                ? "PENGU 15分強判定"
                : context.trigger === "inj_spring"
                    ? "INJ春1H cash判定"
                    : "12H定期トレード判定",
        executedAt: new Date().toISOString(),
        decisionTime: decision.isoTime,
        desiredSymbol: summaryDesiredSymbol,
        desiredSide: summaryDesiredSide,
        reason: summaryReason,
        marketJudgement: summaryMarketJudgement,
        walletResults,
    };

    await persistLiveDecisionDisplayCache(details, options, state.cashRescueApplied, latestWallets);
    await appendAutoTradeHistory(summary);
    await notifyAutoTrade(summary);

    return summary;
}


