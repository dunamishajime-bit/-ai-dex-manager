"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from "react";
import { Flame, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { fetchMarketPrices, fetchStrategyUniverseMetrics } from "@/lib/market-service";

import { useAccount } from "wagmi";
import { fetchDEXRanking, fetchMarketOverview, fetchPairs, fetchTokensByChain, getTopMovers, getCryptoNews, ChainId } from "@/lib/dex-service";
import { resolveToken, NATIVE_TOKEN_ADDRESS, TOKEN_REGISTRY } from "@/lib/tokens";
import { isSupportedChain } from "@/lib/chains";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { useSendTransaction, usePublicClient, useWalletClient, useBalance } from "wagmi";
import { Achievement } from "@/lib/types/achievement";
import { useAuth } from "./AuthContext";
import { isMaintenanceMode } from "@/lib/user-store";
import { useSoundFX } from "@/hooks/useSoundFX";
import { useCurrency } from "./CurrencyContext";
import { generateRandomNews, convertRealToMarketNews, MarketNews } from "@/lib/news-service";
import { getStrategyAssetMeta, STRATEGY_UNIVERSE_SYMBOLS } from "@/config/strategyUniverse";
import { TRADE_CONFIG, BNB_LIVE_ALLOWED_SYMBOLS } from "@/config/tradeConfig";
import { STRATEGY_CONFIG } from "@/config/strategyConfig";
import { loadStrategyCandleSamples, persistStrategyCandleSamples, pruneStrategyCandleSamples, type StrategyCandleSample } from "@/lib/strategy-candle-store";
import {
    buildContinuousStrategyMonitor,
    buildDailyPlan,
    deriveContinuousBasketCap,
    type ContinuousMonitorRuntimeState,
    type ContinuousStrategyCandidate,
    type ContinuousStrategyMonitor,
    type CycleDebugInfo,
    getTokyoCycleInfo,
    type CandidateAnalysis,
    type CyclePerformanceSnapshot,
    type CyclePlanDraft,
    type DailyPlanBuildResult,
    type MarketSnapshot,
    type StrategyRegime,
    type StrategyTriggerState,
    type StrategyTriggerType,
} from "@/lib/cycle-strategy";
import {
    aggregateStrategyPerformance,
    appendStrategyCandidateEvents,
    appendStrategyExecutionEvent,
    createEmptyStrategyPerformanceStore,
    deriveExitReason,
    normalizeStrategyPerformanceStore,
    type StrategyChain,
    type StrategyDecision,
    type StrategyExitReason,
    type StrategyPerformanceStore,
    type StrategyPerformanceSummary,
    type StrategyPositionSize,
    type StrategyRouteType,
} from "@/lib/strategy-performance";
import {
    getRuntimeStrategyConfigValue,
    setRuntimeStrategyConfigOverrides,
    type RuntimeStrategyConfigOverrides,
} from "@/lib/ai-improvements";
import { normalizeStrategyMode, setStoredStrategyMode } from "@/config/strategyMode";
import {
    getProxyExecutionAssetLabel,
    normalizeExecutionTarget,
} from "@/lib/proxy-assets";

export type { Message };

type Agent = {
    id: string;
    name: string;
    exp: number;
    level: number;
};

type Message = {
    id: string;
    agentId: string;
    content: string;
    timestamp: number;
    type: "ANALYSIS" | "OPINION" | "ALERT" | "EXECUTION" | "SYSTEM" | "PROPOSAL" | "COT" | "FEEDBACK";
    chainOfThought?: string;
    round?: number;
};

type DiscussionResult = {
    action: "BUY" | "SELL" | "HOLD";
    confidence: number;
    reasoning: string;
    entryPrice?: { min: number; max: number };
    takeProfit?: number;
    stopLoss?: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
    agentVotes: { agentId: string; vote: "BUY" | "SELL" | "HOLD"; reason: string }[];
    mvpAgent?: string;
    autoTradeProposal?: {
        action: "BUY" | "SELL";
        entryPrice: number;
        targetPrice: number;
        stopLoss: number;
        amount: number;
        reason: string;
    };
};

const AGENTS: Agent[] = [
    { id: "manager", name: "運用メモ", exp: 0, level: 1 },
    { id: "technical", name: "売買判定", exp: 0, level: 1 },
    { id: "sentiment", name: "市場観測", exp: 0, level: 1 },
    { id: "security", name: "リスク監視", exp: 0, level: 1 },
    { id: "fundamental", name: "補助判定", exp: 0, level: 1 },
    { id: "coordinator", name: "システム", exp: 0, level: 1 },
];

function normalizeToUSDTPair(pair: string) {
    const normalized = String(pair || "").trim().toUpperCase().replace("-", "/");
    if (!normalized) return "USDT/USDT";
    if (normalized.includes("/")) {
        const [base, quote] = normalized.split("/");
        return `${base || "USDT"}/${quote || "USDT"}`;
    }
    if (normalized.endsWith("USDT")) {
        return `${normalized.slice(0, -4) || "USDT"}/USDT`;
    }
    return `${normalized}/USDT`;
}

export type Currency = "BTC" | "ETH" | "SOL" | "BNB" | "MATIC" | "DOGE" | "LINK" | "SHIB";
export type ProposalFrequency = "OFF" | "LOW" | "MEDIUM" | "HIGH";
export type DemoStrategy = "AGGRESSIVE" | "MODERATE" | "CONSERVATIVE";
export type Chain = "BNB" | "POLYGON";

const isInterestingToken = (symbol: string) => TRADE_CONFIG.isTradeableVolatilityToken(symbol);
const DAILY_STRATEGY_BLOCKS = ["0:00-6:00", "6:00-12:00", "12:00-18:00", "18:00-24:00"] as const;
const DAILY_COMPOUND_TARGET_PCT = 10;
const LIVE_MIN_ORDER_USD = 3.5;
const LIVE_ORDER_JPY_SCALE = 3.5 / 2000; // 2,000円->3.5USD, 4,000円->7USD, 20,000円->35USD
const LIVE_TARGET_ORDER_MULTIPLIER = 1.06;
const BNB_GAS_RESERVE_USD = 1.0;
const DEFAULT_RISK_TOLERANCE = 4; // Aggressive
const DEFAULT_STOP_LOSS_THRESHOLD = -5;
const DEFAULT_TAKE_PROFIT_THRESHOLD = 8;
const LIVE_EXECUTION_PREFERRED_SYMBOLS: Record<number, Set<string>> = {
    56: new Set(BNB_LIVE_ALLOWED_SYMBOLS),
    137: new Set(["MATIC"]),
};

const STRATEGY_CANDLE_SYMBOL_SET = new Set<string>(STRATEGY_UNIVERSE_SYMBOLS.map((symbol) => normalizeTrackedSymbol(symbol)));
const WALLET_SCAN_ALIAS_TOKENS: Record<number, Array<{
    aliasKey: string;
    trackedSymbol?: string;
    displaySymbol: string;
    address: string;
    decimals?: number;
    requiresDynamicDecimals?: boolean;
}>> = {
    56: [
        {
            aliasKey: "FLOKI_LEGACY",
            displaySymbol: "FLOKI",
            address: "0x2B3F34e9D4b127797CE6244Ea341a83733ddd6E4",
            decimals: 9,
        },
        {
            aliasKey: "NBL_PREVIOUS",
            displaySymbol: "NBL",
            address: "0x11f331c62aB3cA958c5212d21f332A81C66F06E7",
            decimals: 18,
        },
        {
            aliasKey: "NBL_LEGACY",
            displaySymbol: "NBL",
            address: "0xA67a13c9283Da5AABB199Da54a9Cb4cD8B9b16bA",
            decimals: 18,
        },
        {
            aliasKey: "PENGU_PROXY",
            trackedSymbol: "PENGU.SOL",
            displaySymbol: "PENGU",
            address: "0x6418c0dd099a9fda397c766304cdd918233e8847",
            requiresDynamicDecimals: true,
        },
        {
            aliasKey: "PUMPBTC_PROXY",
            trackedSymbol: "PUMP.SOL",
            displaySymbol: "PUMPBTC",
            address: "0xB7C0007ab75350c582d5eAb1862b872B5cF53F0C",
            requiresDynamicDecimals: true,
        },
    ],
};
const DAILY_STRATEGY_STORAGE_KEY = "jdex_daily_strategy_fixed_v13";
const STRATEGY_PERFORMANCE_STORAGE_KEY = "jdex_strategy_performance_v1";
const LIVE_STRATEGY_MONITOR_STORAGE_KEY = "jdex_live_strategy_monitor_v2";
const STRATEGY_CANDLE_RETENTION_MS = 24 * 60 * 60 * 1000;
const CUSTOM_BNB_CONTRACTS_STORAGE_KEY = "jdex_custom_bnb_contracts";
const CUSTOM_SOLANA_MINTS_STORAGE_KEY = "jdex_custom_solana_mints";

function clampScalpStopLoss(value: number) {
    const abs = Math.max(1, Math.min(5, Math.abs(Number(value) || Math.abs(DEFAULT_STOP_LOSS_THRESHOLD))));
    return -abs;
}

function clampScalpTakeProfit(value: number) {
    return Math.max(1, Math.min(10, Number(value) || DEFAULT_TAKE_PROFIT_THRESHOLD));
}

function normalizeTrackedSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper === "POL" || upper === "TMATIC") return "MATIC";
    if (upper === "TBNB" || upper === "WBNB") return "BNB";
    return upper;
}

function comparableTradeSymbol(symbol: string): string {
    return normalizeTrackedSymbol(symbol).replace(/\.SOL$/i, "");
}

function startOfJstDayTs(referenceTs: number) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const [year, month, day] = formatter.format(new Date(referenceTs)).split("-");
    return new Date(`${year}-${month}-${day}T00:00:00+09:00`).getTime();
}

function resolveLiveRouteLiquidity(candidate: {
    liquidity?: number;
    executionLiquidityUsd?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
}) {
    if (candidate.executionRouteKind === "proxy" || candidate.executionRouteKind === "cross-chain") {
        return Number(candidate.executionLiquidityUsd || candidate.liquidity || 0);
    }
    return Number(candidate.liquidity || candidate.executionLiquidityUsd || 0);
}

function hasPriorityOrderProfile(plan: {
    rank?: string;
    score?: number;
    regime?: "Trend" | "Range" | "No-trade";
    mode?: "TREND" | "MEAN_REVERSION";
    triggerProgressRatio?: number;
    positionSizeMultiplier?: number;
    autoTradeTarget?: boolean;
    conditionalReferencePass?: boolean;
    executionLiquidityUsd?: number;
    liquidity?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
}) {
    const isRange = plan.regime === "Range" || plan.mode === "MEAN_REVERSION";
    const scoreFloor = isRange
        ? Math.max(58, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_SCORE - 2)
        : Math.max(78, STRATEGY_CONFIG.SCORE_THRESHOLD_A - 2);
    const progressFloor = isRange
        ? STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS
        : Math.max(0.68, STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS - 0.02);
    return (
        Boolean(plan.autoTradeTarget)
        || Boolean(plan.conditionalReferencePass)
        || Number(plan.positionSizeMultiplier || 0) >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
        || Number(plan.triggerProgressRatio || 0) >= Math.max(progressFloor, 0.8)
    )
        && (
            String(plan.rank || "") === "A"
            || Number(plan.score || 0) >= scoreFloor
        )
        && Number(plan.triggerProgressRatio || 0) >= progressFloor;
}

function resolveLiveEntryWindow(plan: {
    symbol: string;
    mode: "TREND" | "MEAN_REVERSION";
    regime?: "Trend" | "Range" | "No-trade";
    conditionalReferencePass?: boolean;
    positionSizeMultiplier?: number;
    autoTradeTarget?: boolean;
    rank?: string;
    score?: number;
    triggerProgressRatio?: number;
    executionLiquidityUsd?: number;
    liquidity?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
}) {
    const isProbation = Number(plan.positionSizeMultiplier || 0) <= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER;
    const isRange = plan.regime === "Range" || plan.mode === "MEAN_REVERSION";
    const isPriority = hasPriorityOrderProfile(plan);
    const minMultiplier = plan.autoTradeTarget
        ? STRATEGY_CONFIG.AUTO_TRADE_SELECTED_ENTRY_MIN_MULTIPLIER
        : STRATEGY_CONFIG.AUTO_TRADE_ENTRY_MIN_FLOOR_MULTIPLIER;

    if (!isRange) {
        return {
            minMultiplier,
            maxMultiplier: plan.autoTradeTarget || plan.conditionalReferencePass || isPriority
                ? STRATEGY_CONFIG.AUTO_TRADE_SELECTED_ENTRY_MAX_TREND_MULTIPLIER
                : STRATEGY_CONFIG.AUTO_TRADE_ENTRY_MAX_TREND_MULTIPLIER,
        };
    }

    let maxMultiplier: number = STRATEGY_CONFIG.AUTO_TRADE_ENTRY_MAX_MEAN_MULTIPLIER;
    if (plan.autoTradeTarget || plan.conditionalReferencePass || isPriority) {
        maxMultiplier = Math.max(maxMultiplier, STRATEGY_CONFIG.AUTO_TRADE_SELECTED_ENTRY_MAX_MEAN_MULTIPLIER);
    }
    if (isProbation) {
        maxMultiplier = Math.max(maxMultiplier, STRATEGY_CONFIG.AUTO_TRADE_PROBATION_ENTRY_MAX_MEAN_MULTIPLIER);
    }
    return { minMultiplier, maxMultiplier };
}

function walletHoldingKey(symbol: string, chain?: "BNB" | "SOLANA") {
    return `${chain || resolveHoldingChain(symbol)}:${comparableTradeSymbol(symbol)}`;
}

const SOLANA_WALLET_ADDRESS_STORAGE_KEY = "jdex_solana_wallet_address";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_CONTRACT_RE = /^0x[a-fA-F0-9]{40}$/;

function normalizeSolanaWalletAddress(value?: string | null) {
    const trimmed = String(value || "").trim();
    return SOLANA_ADDRESS_RE.test(trimmed) ? trimmed : "";
}

function normalizeCustomBnbContract(value?: string | null) {
    const trimmed = String(value || "").trim();
    return EVM_CONTRACT_RE.test(trimmed) ? trimmed.toLowerCase() : "";
}

function normalizeCustomSolanaMint(value?: string | null) {
    const trimmed = String(value || "").trim();
    return SOLANA_ADDRESS_RE.test(trimmed) ? trimmed : "";
}

function uniqueStrings(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}

function resolveHoldingChain(symbol: string, fallback?: "BNB" | "SOLANA") {
    if (fallback) return fallback;
    const meta = getStrategyAssetMeta(symbol);
    return meta.chain === "SOLANA" ? "SOLANA" : "BNB";
}

function isPassiveGasReserveHolding(row: Pick<WalletHoldingRow, "symbol" | "chain" | "amount" | "usdValue">) {
    if (row.chain !== "SOLANA") return false;
    if (comparableTradeSymbol(row.symbol) !== "SOL") return false;
    return row.amount <= 0.2 && row.usdValue <= 50;
}

function displayStrategySymbol(row: { displaySymbol?: string; symbol: string; chain?: "BNB" | "SOLANA" }) {
    const display = (row.displaySymbol || row.symbol).replace(/\.SOL$/i, "");
    return row.chain === "SOLANA" ? `${display} (Solana)` : display;
}

function getLiveInitialBalanceStorageKey(address?: string, chainId?: number) {
    if (!address || !chainId) return null;
    const day = getJstDateKey();
    return `jdex_live_initial_balance:${chainId}:${address.toLowerCase()}:${day}`;
}

function getStrategyBlockDescription(
    block: (typeof DAILY_STRATEGY_BLOCKS)[number],
    symbol: string,
    action: string,
    reasoning: string,
) {
    const direction = action === "SELL" ? "戻り売りと失速" : action === "HOLD" ? "様子見と条件整理" : "押し目買いとブレイク";
    const scalpTarget = `日次目標は小幅利確を積み重ねて +${DAILY_COMPOUND_TARGET_PCT}% です。`;
    switch (block) {
        case "0:00-6:00":
            return `${symbol} の初動を監視する時間帯です。${direction} を前提に、薄商い時のダマシを避けつつ流動性を確認します。判断材料: ${reasoning}。${scalpTarget}`;
        case "6:00-12:00":
            return `${symbol} の出来高増加を見ながら、ニュースとSNS反応を照合します。トレンド継続なら追随、失速ならエントリーを見送ります。判断材料: ${reasoning}。${scalpTarget}`;
        case "12:00-18:00":
            return `${symbol} の欧州時間帯を想定した戦略です。ブレイク継続か反落かを見極め、損切りラインを厳守しながら柔軟にポジション調整します。判断材料: ${reasoning}。${scalpTarget}`;
        case "18:00-24:00":
            return `${symbol} の一日終盤の戦略です。米国時間の値動きと材料変化を確認し、利確優先か持ち越し回避かを判断します。判断材料: ${reasoning}。${scalpTarget}`;
        default:
            return `${symbol} を対象に、市場の変化へ柔軟に対応する戦略です。${scalpTarget}`;
    }
}

function getLiveOrderTargets(totalUsd: number, usdJpy: number) {
    const safeTotalUsd = Number.isFinite(totalUsd) && totalUsd > 0 ? totalUsd : 0;
    const safeUsdJpy = Number.isFinite(usdJpy) && usdJpy > 0 ? usdJpy : 155;
    const walletJpy = safeTotalUsd * safeUsdJpy;
    const scaledMinUsd = walletJpy * LIVE_ORDER_JPY_SCALE;
    const minOrderUsd = Math.max(LIVE_MIN_ORDER_USD, Number(scaledMinUsd.toFixed(2)));
    const targetOrderUsd = Math.max(minOrderUsd, Number((minOrderUsd * LIVE_TARGET_ORDER_MULTIPLIER).toFixed(2)));
    return { walletJpy, minOrderUsd, targetOrderUsd };
}

function resolveExitPositionSizeLabel(input?: {
    positionSizeLabel?: StrategyPositionSize | "1.0x" | "0.25x";
    positionSizeMultiplier?: number;
}) {
    if (input?.positionSizeLabel === "1.0x") return "0.5x";
    if (input?.positionSizeLabel === "0.25x") return "0.2x";
    if (input?.positionSizeLabel) return input.positionSizeLabel;
    const multiplier = Number(input?.positionSizeMultiplier || 0);
    if (multiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER) return "0.5x";
    if (multiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER) return "0.3x";
    if (multiplier >= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER) return "0.2x";
    return "0x";
}

function resolveExitRegime(input?: {
    regime?: StrategyRegime;
    mode?: "TREND" | "MEAN_REVERSION";
}) {
    if (input?.regime) return input.regime;
    return input?.mode === "MEAN_REVERSION" ? "Range" : "Trend";
}

function resolveMinimumHoldMinutes(input?: {
    regime?: StrategyRegime;
    mode?: "TREND" | "MEAN_REVERSION";
    positionSizeLabel?: StrategyPositionSize;
    positionSizeMultiplier?: number;
}) {
    const sizeLabel = resolveExitPositionSizeLabel(input);
    if (sizeLabel === "0.2x") return getRuntimeStrategyConfigValue("AUTO_TRADE_PROBATION_MIN_HOLD_MINUTES");
    return resolveExitRegime(input) === "Range"
        ? getRuntimeStrategyConfigValue("AUTO_TRADE_RANGE_MIN_HOLD_MINUTES")
        : getRuntimeStrategyConfigValue("AUTO_TRADE_TREND_MIN_HOLD_MINUTES");
}

function resolveMinimumProfitableExit(input: {
    amount: number;
    entryPrice: number;
    minOrderUsd: number;
    regime?: StrategyRegime;
    mode?: "TREND" | "MEAN_REVERSION";
    positionSizeLabel?: StrategyPositionSize;
    positionSizeMultiplier?: number;
}) {
    const notionalUsd = Math.max(0, input.amount * input.entryPrice);
    const sizeLabel = resolveExitPositionSizeLabel(input);
    const regime = resolveExitRegime(input);
    let minProfitUsd = Math.max(
        getRuntimeStrategyConfigValue("AUTO_TRADE_MIN_PROFIT_EXIT_USD"),
        input.minOrderUsd * 0.08,
        notionalUsd * 0.002,
    );
    let minProfitPct = getRuntimeStrategyConfigValue("AUTO_TRADE_MIN_PROFIT_EXIT_PCT");

    if (regime === "Trend") {
        minProfitUsd *= sizeLabel === "0.5x" ? 1.08 : 1.02;
        minProfitPct *= sizeLabel === "0.5x" ? 1.15 : 1.08;
    } else {
        minProfitUsd *= sizeLabel === "0.2x" ? 0.82 : 0.9;
        minProfitPct *= sizeLabel === "0.2x" ? 0.8 : 0.88;
    }

    return {
        minProfitUsd: Number(minProfitUsd.toFixed(4)),
        minProfitPct: Number(minProfitPct.toFixed(4)),
    };
}

function resolvePartialTakeProfitFraction(input?: {
    regime?: StrategyRegime;
    mode?: "TREND" | "MEAN_REVERSION";
    positionSizeLabel?: StrategyPositionSize;
    positionSizeMultiplier?: number;
}) {
    const sizeLabel = resolveExitPositionSizeLabel(input);
    if (sizeLabel === "0.2x") return 1;
    const regime = resolveExitRegime(input);
    if (regime === "Range") {
        return sizeLabel === "0.3x"
            ? Math.min(0.8, STRATEGY_CONFIG.AUTO_TRADE_RANGE_PARTIAL_TP_FRACTION + 0.1)
            : STRATEGY_CONFIG.AUTO_TRADE_RANGE_PARTIAL_TP_FRACTION;
    }
    return sizeLabel === "0.3x"
        ? Math.min(0.55, STRATEGY_CONFIG.AUTO_TRADE_TREND_PARTIAL_TP_FRACTION + 0.05)
        : Math.max(0.3, STRATEGY_CONFIG.AUTO_TRADE_TREND_PARTIAL_TP_FRACTION - 0.08);
}

function resolveTrailingStopPct(input?: {
    regime?: StrategyRegime;
    mode?: "TREND" | "MEAN_REVERSION";
    positionSizeLabel?: StrategyPositionSize;
    positionSizeMultiplier?: number;
}) {
    const sizeLabel = resolveExitPositionSizeLabel(input);
    if (sizeLabel === "0.2x") return getRuntimeStrategyConfigValue("AUTO_TRADE_PROBATION_TRAILING_STOP_PCT");
    const regime = resolveExitRegime(input);
    if (regime === "Range") {
        const base = getRuntimeStrategyConfigValue("AUTO_TRADE_RANGE_TRAILING_STOP_PCT");
        return Number((sizeLabel === "0.3x" ? Math.max(0.35, base - 0.08) : base).toFixed(4));
    }
    const base = getRuntimeStrategyConfigValue("AUTO_TRADE_TREND_TRAILING_STOP_PCT");
    return Number((sizeLabel === "0.3x" ? base + 0.06 : base + 0.18).toFixed(4));
}

function hasStrongExitDeterioration(signal: { score: number; r60: number }, pnlPct: number) {
    return signal.score <= STRATEGY_CONFIG.AUTO_TRADE_TIMED_EXIT_NEGATIVE_SCORE
        || signal.r60 <= STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_NEGATIVE_R60
        || pnlPct <= STRATEGY_CONFIG.AUTO_TRADE_TIMED_EXIT_NEGATIVE_PCT;
}

function getJstDateKey(ts: number = Date.now()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return formatter.format(new Date(ts));
}

function getJstHourMinute(ts: number = Date.now()) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const [hour, minute] = formatter.format(new Date(ts)).split(":").map((value) => Number(value));
    return {
        hour: Number.isFinite(hour) ? hour : 0,
        minute: Number.isFinite(minute) ? minute : 0,
    };
}

function hasStrategySnapshotData(strategies: StrategyProposal[]) {
    return strategies.some((strategy) =>
        (strategy.symbolPlans?.length || 0) > 0
        || (strategy.candidateSnapshots?.length || 0) > 0
        || (strategy.selectionStats?.universeCount || 0) > 0,
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
}

function isPendingCrossChainStatus(status: CrossChainExecutionOrder["status"]) {
    return status === "accepted" || status === "queued" || status === "submitted";
}

function deterministicHashFallback(seed: string) {
    const base = seed.replace(/[^a-fA-F0-9]/g, "").padEnd(64, "0").slice(0, 64);
    return `0x${base}`;
}

function deterministicExecutionHash(executionId?: string) {
    const base = String(executionId || "").replace(/[^a-fA-F0-9]/g, "").padEnd(64, "0").slice(0, 64);
    return base ? `0x${base}` : "";
}

function isSyntheticCrossChainHash(hash?: string, input?: { executionId?: string; symbol?: string }) {
    if (!hash) return false;
    if (hash.startsWith("0x_offline_processed_")) return true;
    const executionHash = deterministicExecutionHash(input?.executionId);
    if (executionHash && hash.toLowerCase() === executionHash.toLowerCase()) return true;
    if (input?.symbol && hash === deterministicHashFallback(normalizeTrackedSymbol(input.symbol))) return true;
    return false;
}

function sanitizeStoredTransactions(records: Transaction[]) {
    return records.filter((tx) => {
        if (tx.routeType !== "cross-chain") return true;
        return !isSyntheticCrossChainHash(tx.txHash, {
            executionId: tx.executionId,
            symbol: tx.symbol,
        });
    });
}

function sanitizeStoredCrossChainOrders(records: CrossChainExecutionOrder[]) {
    return records.map((order) => {
        if (
            order.routeType !== "cross-chain"
            || !isSyntheticCrossChainHash(order.txHash, {
                executionId: order.executionId,
                symbol: order.symbol,
            })
        ) {
            return order;
        }

        return {
            ...order,
            status: (order.status === "cancelled" ? "cancelled" : "failed") as CrossChainExecutionOrder["status"],
            txHash: undefined,
            executionReceipt: "not-submitted",
            positionApplied: false,
            exitManaged: false,
            failureReason: order.failureReason || "実チェーンへ送信されていない擬似約定を無効化しました。",
            updatedAt: Date.now(),
            completedAt: order.completedAt || Date.now(),
        };
    });
}

function scoreToCandidateRank(score: number): "A" | "B" | "C" | "D" {
    if (score >= STRATEGY_CONFIG.SCORE_THRESHOLD_A) return "A";
    if (score >= STRATEGY_CONFIG.SCORE_THRESHOLD_B) return "B";
    if (score >= 50) return "C";
    return "D";
}

function formatJstTimeLabel(ts: number) {
    return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(ts));
}

function getJstAnchorTs(dayKey: string, hour: number, minute: number) {
    const [year, month, day] = dayKey.split("-").map((value) => Number(value));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return Date.now();
    }
    return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function normalizedStrategyCandidateScore(candidate: NonNullable<StrategyProposal["candidateSnapshots"]>[number]) {
    const score = Number(candidate.marketScore ?? candidate.score ?? 0);
    const rawScore = Number(candidate.rawScore ?? score);
    const maxPossibleScore = Number(candidate.maxPossibleScore || 100);
    const looksLegacyScale = maxPossibleScore > 0 && maxPossibleScore <= 25 && score <= maxPossibleScore + 1;
    if (looksLegacyScale) {
        return clamp(Math.round((clamp(rawScore, 0, maxPossibleScore) / maxPossibleScore) * 100), 0, 100);
    }
    return clamp(Math.round(score), 0, 100);
}

function newMuchDecisionLabel(candidate: NonNullable<StrategyProposal["candidateSnapshots"]>[number]) {
    if (candidate.tradeDecision === "Selected") return "通常採用";
    if (candidate.tradeDecision === "Half-size Eligible") return "半ロット候補";
    if (candidate.tradeDecision === "Watchlist") return "Watchlist";
    return "見送り";
}

function newMuchRankedRows(strategy?: StrategyProposal | null) {
    return [...(strategy?.candidateSnapshots || [])]
        .sort((left, right) => normalizedStrategyCandidateScore(right) - normalizedStrategyCandidateScore(left));
}

function newMuchTopRanked(strategy?: StrategyProposal | null, limit: number = 3) {
    return newMuchRankedRows(strategy).slice(0, limit).map((candidate) => {
        const score = normalizedStrategyCandidateScore(candidate);
        const rank = candidate.rank || scoreToCandidateRank(score);
        return `${displayStrategySymbol(candidate)} ${score}/100 ${rank}`;
    });
}

function newMuchNearMisses(strategy?: StrategyProposal | null, limit: number = 3) {
    return newMuchRankedRows(strategy)
        .filter((candidate) => {
            const decision = candidate.tradeDecision || "Blocked";
            return decision !== "Selected" && decision !== "Half-size Eligible" && normalizedStrategyCandidateScore(candidate) >= STRATEGY_CONFIG.SCORE_THRESHOLD_B;
        })
        .slice(0, limit)
        .map((candidate) => {
            const score = normalizedStrategyCandidateScore(candidate);
            const rank = candidate.rank || scoreToCandidateRank(score);
            return `${displayStrategySymbol(candidate)} ${score}/100 ${rank}`;
        });
}

function serializeEvaluationShape(strategy?: StrategyProposal | null) {
    if (!strategy) return "";
    return JSON.stringify({
        block: strategy.durationBlock,
        ranked: newMuchRankedRows(strategy).slice(0, 10).map((candidate) => ({
            symbol: candidate.symbol,
            displaySymbol: candidate.displaySymbol,
            chain: candidate.chain,
            score: normalizedStrategyCandidateScore(candidate),
            rank: candidate.rank || scoreToCandidateRank(normalizedStrategyCandidateScore(candidate)),
            executionStatus: candidate.executionStatus,
            tradeDecision: candidate.tradeDecision,
            rrStatus: candidate.rrStatus,
            resistanceStatus: candidate.resistanceStatus,
        })),
        basket: (strategy.symbolPlans || []).map((plan) => ({
            symbol: plan.symbol,
            displaySymbol: plan.displaySymbol,
            chain: plan.chain,
            positionSizeLabel: plan.positionSizeLabel,
            weight: Number(plan.weight.toFixed(4)),
        })),
        intradayPromoted: (strategy.intradayPromoted || []).map((item) => ({
            symbol: item.symbol,
            source: item.source,
            positionSizeLabel: item.positionSizeLabel,
        })),
    });
}

function buildIntradayPromotedFromMonitor(
    fixed: StrategyProposal | null | undefined,
    liveMonitor: ContinuousStrategyMonitor | null,
): NonNullable<StrategyProposal["intradayPromoted"]> {
    if ((fixed?.symbolPlans || []).length > 0 || !liveMonitor) return [];

    return [...liveMonitor.candidates]
        .filter((candidate) =>
            candidate.regime !== "No-trade"
            && (candidate.triggerState === "Triggered" || candidate.autoTradeTarget || candidate.selectionEligible || candidate.orderArmEligible)
            && (candidate.executionStatus === "Pass" || candidate.conditionalReferencePass)
            && !candidate.autoTradeExcludedReason
            && candidate.resistanceStatus !== "Blocked"
            && candidate.metrics.rr >= Math.max(0.96, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR)
            && candidate.positionSizeMultiplier > 0
        )
        .sort((left, right) =>
            Number(Boolean(right.autoTradeTarget)) - Number(Boolean(left.autoTradeTarget))
            || Number(Boolean(right.orderArmEligible)) - Number(Boolean(left.orderArmEligible))
            || right.eventPriority - left.eventPriority
            || right.marketScore - left.marketScore,
        )
        .slice(0, 3)
        .map((candidate) => ({
            symbol: candidate.symbol,
            displaySymbol: candidate.displaySymbol,
            chain: candidate.chain,
            triggerState: candidate.triggerState,
            triggerType: candidate.triggerType,
            regime: candidate.regime,
            positionSizeLabel: candidate.positionSizeLabel || "0.5x",
            source: candidate.autoTradeTarget ? "selected" as const : candidate.orderArmEligible ? "armed" as const : "triggered" as const,
            routeType: candidate.executionRouteKind || "native",
            score: Math.round(candidate.marketScore),
            reason: candidate.conditionalReferencePass
                ? "条件付き通過"
                : candidate.mainReason || candidate.triggerReason || "日中昇格",
        }));
}

function buildNewMuchHighlights(previous: StrategyProposal | null | undefined, next: StrategyProposal, fixed: StrategyProposal | null | undefined) {
    const prevRows = newMuchRankedRows(previous);
    const nextRows = newMuchRankedRows(next);
    const prevMap = new Map(prevRows.map((candidate) => [normalizeTrackedSymbol(candidate.symbol), candidate]));
    const nextMap = new Map(nextRows.map((candidate) => [normalizeTrackedSymbol(candidate.symbol), candidate]));
    const symbols = Array.from(new Set([
        ...prevRows.slice(0, 8).map((candidate) => normalizeTrackedSymbol(candidate.symbol)),
        ...nextRows.slice(0, 8).map((candidate) => normalizeTrackedSymbol(candidate.symbol)),
    ]));

    const highlights = symbols.map((symbol) => {
        const previousCandidate = prevMap.get(symbol);
        const nextCandidate = nextMap.get(symbol);
        if (!nextCandidate && !previousCandidate) return null;

        const previousScore = previousCandidate ? normalizedStrategyCandidateScore(previousCandidate) : null;
        const nextScore = nextCandidate ? normalizedStrategyCandidateScore(nextCandidate) : null;
        const previousDecision = previousCandidate ? newMuchDecisionLabel(previousCandidate) : "圏外";
        const nextDecision = nextCandidate ? newMuchDecisionLabel(nextCandidate) : "圏外";
        const delta = previousScore === null || nextScore === null ? 0 : nextScore - previousScore;
        const changedDecision = previousDecision !== nextDecision;
        const changedScore = previousScore !== nextScore;
        if (!changedDecision && !changedScore) return null;

        const current = nextCandidate || previousCandidate!;
        return {
            score: Math.abs(delta) + (changedDecision ? 6 : 0),
            text: `${displayStrategySymbol(current)}: ${previousScore ?? "--"} → ${nextScore ?? "--"} / ${previousDecision} → ${nextDecision}`,
        };
    }).filter((entry): entry is { score: number; text: string } => Boolean(entry))
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map((entry) => entry.text);

    const fixedBasket = (fixed?.symbolPlans || next.symbolPlans || [])
        .map((plan) => `${displayStrategySymbol(plan)} ${plan.positionSizeLabel || (Number(plan.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER ? "0.5x" : Number(plan.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER ? "0.3x" : Number(plan.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER ? "0.2x" : "0x")}`)
        .join(" / ") || "見送り";
    const intradayPromoted = next.intradayPromoted || [];
    const topRanked = newMuchTopRanked(next, 3);
    const nearMisses = newMuchNearMisses(next, 3);
    const changed = serializeEvaluationShape(previous) !== serializeEvaluationShape(next);

    if (!changed) return null;

    return {
        block: next.durationBlock || DAILY_STRATEGY_BLOCKS[0],
        fixedBasket,
        fixedBasketEmpty: (fixed?.symbolPlans || []).length === 0,
        topRanked,
        nearMisses,
        highlights,
        intradayPromoted,
        summary: intradayPromoted.length
            ? `${next.durationBlock} の固定バスケットは空のままですが、intraday promotion で候補を補完しました。`
            : `${next.durationBlock} の相場評価が更新されました。固定バスケットは据え置きです。`,
    } satisfies NewMuchEvaluationChange;
}

function normalizeStoredStrategies(strategies: StrategyProposal[]) {
    return strategies.map((strategy) => {
        const originalThreshold = Number(strategy.selectionStats?.thresholdScore || STRATEGY_CONFIG.SCORE_THRESHOLD);
        const thresholdScore = originalThreshold > 0 && originalThreshold <= 25
            ? STRATEGY_CONFIG.SCORE_THRESHOLD
            : clamp(Math.round(originalThreshold), 0, 100);
        const normalizedCandidates = (strategy.candidateSnapshots || [])
            .filter((candidate) => STRATEGY_CANDLE_SYMBOL_SET.has(normalizeTrackedSymbol(candidate.symbol)))
            .map((candidate) => {
            const rawScore = Number(candidate.rawScore ?? candidate.weightedScore ?? candidate.score ?? 0);
            const weightedScore = Number(candidate.weightedScore ?? rawScore);
            const maxPossibleScore = Number(candidate.maxPossibleScore || 100);
            const storedScore = Number(candidate.score || 0);
            const legacyScaled = maxPossibleScore > 0 && maxPossibleScore <= 25 && storedScore <= maxPossibleScore + 1;
            const normalizedScore = legacyScaled
                ? clamp(Math.round((clamp(rawScore, 0, maxPossibleScore) / maxPossibleScore) * 100), 0, 100)
                : clamp(Math.round(storedScore), 0, 100);
            const marketScore = clamp(Math.round(Number(candidate.marketScore ?? normalizedScore)), 0, 100);
            const executionStatus = candidate.executionStatus
                || (!Number.isFinite(candidate.price) || candidate.price <= 0 || (candidate.dataCompleteness ?? 1) <= 0
                    ? "Data Missing"
                    : candidate.executionSupported === false
                      ? "Route Missing"
                      : candidate.veto
                        ? "VETO NG"
                        : candidate.marketSource === "seed"
                          ? "Seed Fallback"
                          : "Pass");
            const tradeDecision = candidate.tradeDecision
                || (candidate.selectionStage === "SELECTED" || candidate.status === "Selected"
                    ? Number(candidate.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.B_RANK_POSITION_SIZE_MULTIPLIER
                        && Number(candidate.positionSizeMultiplier ?? 0) < STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                        ? "Half-size Eligible"
                        : "Selected"
                    : candidate.autoTradeExcludedReason
                      ? "Blocked"
                    : executionStatus !== "Pass" || candidate.selectionStage === "CORRELATION"
                      ? "Blocked"
                      : marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B && Number(candidate.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.B_RANK_POSITION_SIZE_MULTIPLIER
                        ? "Half-size Eligible"
                        : marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B
                        ? "Watchlist"
                        : "Blocked");
            const positionSizeMultiplier = Number(candidate.positionSizeMultiplier ?? (
                tradeDecision === "Selected"
                    ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                    : tradeDecision === "Half-size Eligible"
                      ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                      : 0
            ));
            const positionSizeLabel = candidate.positionSizeLabel
                || (
                    positionSizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                        ? "0.5x"
                        : positionSizeMultiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                            ? "0.3x"
                            : positionSizeMultiplier >= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER
                                ? "0.2x"
                                : "0x"
                );

            return {
                ...candidate,
                marketScore,
                score: marketScore,
                rawScore: Number(rawScore.toFixed(2)),
                weightedScore: Number(weightedScore.toFixed(2)),
                maxPossibleScore: maxPossibleScore > 0 ? maxPossibleScore : 100,
                executionStatus,
                tradeDecision,
                positionSizeMultiplier,
                positionSizeLabel,
                rank: scoreToCandidateRank(marketScore),
                thresholdGap: marketScore - thresholdScore,
                vetoPass: typeof candidate.vetoPass === "boolean" ? candidate.vetoPass : !candidate.veto,
                autoTradeExcludedReason: candidate.autoTradeExcludedReason,
                fullSizeEligible: typeof candidate.fullSizeEligible === "boolean"
                    ? candidate.fullSizeEligible
                    : executionStatus === "Pass" && marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_A && !candidate.autoTradeExcludedReason,
                aHalfSizeEligible: typeof candidate.aHalfSizeEligible === "boolean"
                    ? candidate.aHalfSizeEligible
                    : false,
                bHalfSizeEligible: typeof candidate.bHalfSizeEligible === "boolean"
                    ? candidate.bHalfSizeEligible
                    : false,
                selectionEligible: typeof candidate.selectionEligible === "boolean"
                    ? candidate.selectionEligible
                    : tradeDecision === "Selected" || tradeDecision === "Half-size Eligible",
                conditionalReferencePass: typeof candidate.conditionalReferencePass === "boolean"
                    ? candidate.conditionalReferencePass
                    : false,
                routeMissing: typeof candidate.routeMissing === "boolean" ? candidate.routeMissing : executionStatus === "Route Missing",
                seedFallback: typeof candidate.seedFallback === "boolean" ? candidate.seedFallback : executionStatus === "Seed Fallback" || candidate.marketSource === "seed",
                rrCheck: typeof candidate.rrCheck === "boolean" ? candidate.rrCheck : true,
                rrStatus: candidate.rrStatus === "OK" || candidate.rrStatus === "Weak" || candidate.rrStatus === "NG"
                    ? candidate.rrStatus
                    : (candidate.rrCheck === false ? "NG" : "OK"),
                resistanceStatus: candidate.resistanceStatus === "Open" || candidate.resistanceStatus === "Tight" || candidate.resistanceStatus === "Blocked"
                    ? candidate.resistanceStatus
                    : "Open",
                halfSizeMinRr: Number(candidate.halfSizeMinRr ?? STRATEGY_CONFIG.HALF_SIZE_MIN_RR),
                correlationRejected: Boolean(candidate.correlationRejected || candidate.selectionStage === "CORRELATION"),
                finalSelectedEligible: typeof candidate.finalSelectedEligible === "boolean"
                    ? candidate.finalSelectedEligible
                    : tradeDecision === "Selected" || tradeDecision === "Half-size Eligible",
                finalRejectReason: candidate.finalRejectReason || candidate.exclusionReason || candidate.mainReason,
            };
        });
        const candidateMap = new Map(normalizedCandidates.map((candidate) => [normalizeTrackedSymbol(candidate.symbol), candidate]));
        const normalizedSymbolPlans = (strategy.symbolPlans || []).filter((plan) => {
            const symbol = normalizeTrackedSymbol(plan.symbol);
            if (!STRATEGY_CANDLE_SYMBOL_SET.has(symbol)) return false;
            const candidate = candidateMap.get(symbol);
            if (candidate?.autoTradeExcludedReason) return false;
            return true;
        });

        return {
            ...strategy,
            symbolPlans: normalizedSymbolPlans,
            candidateSnapshots: normalizedCandidates,
            selectionStats: strategy.selectionStats ? {
                ...strategy.selectionStats,
                thresholdScore,
                prefilterMode: strategy.selectionStats.prefilterMode,
                prefilterRescuedCount: strategy.selectionStats.prefilterRescuedCount,
                prefilterTargetMin: strategy.selectionStats.prefilterTargetMin,
                fullSizeEligibleCount: strategy.selectionStats.fullSizeEligibleCount,
                halfSizeEligibleCount: strategy.selectionStats.halfSizeEligibleCount,
                finalSelectionEligibleCount: strategy.selectionStats.finalSelectionEligibleCount,
                finalSelectedCount: normalizedSymbolPlans.length,
            } : strategy.selectionStats,
            intradayPromoted: Array.isArray(strategy.intradayPromoted) ? strategy.intradayPromoted.slice(0, 3) : undefined,
        };
    });
}

type LiveOrderDiagnostic = {
    status: "armed" | "slot" | "blocked";
    reason: string;
    detail: string;
    orderTriggeredAt?: number;
};

function countLiveCheckRowsByChain(rows: Array<{ chain: "BNB" | "SOLANA" }>) {
    return rows.reduce(
        (acc, row) => {
            acc[row.chain] += 1;
            return acc;
        },
        { BNB: 0, SOLANA: 0 } as { BNB: number; SOLANA: number },
    );
}

function formatLiveCheckSymbol(symbol: string, displaySymbol?: string) {
    return (displaySymbol || symbol).replace(/\.SOL$/i, "");
}

function toLiveCheckRow(candidate: ContinuousStrategyCandidate) {
    return {
        symbol: formatLiveCheckSymbol(candidate.symbol, candidate.displaySymbol),
        chain: candidate.chain,
        positionSizeLabel: candidate.positionSizeLabel,
        triggerState: candidate.triggerState,
        orderGateStatus: candidate.orderGateStatus,
        reason:
            candidate.orderGateDetail
            || candidate.orderGateReason
            || candidate.finalRejectReason
            || candidate.mainReason
            || candidate.triggerReason,
    };
}

function summarizeIntradayPromoted(update: NewMuchUpdate | null) {
    const rows = (update?.evaluationChanges || []).flatMap((change) => Array.isArray(change.intradayPromoted) ? change.intradayPromoted : []);
    const symbols = Array.from(
        new Set(
            rows
                .map((entry) => formatLiveCheckSymbol(entry.symbol, entry.displaySymbol))
                .filter(Boolean),
        ),
    ).slice(0, 8);
    return {
        count: rows.length,
        symbols,
    };
}

function applyLiveOrderDiagnosticsToMonitor(
    monitor: ContinuousStrategyMonitor,
    diagnostics: Record<string, LiveOrderDiagnostic>,
) {
    const candidates = monitor.candidates.map((candidate) => {
        const diagnostic = diagnostics[normalizeTrackedSymbol(candidate.symbol)];
        if (!diagnostic) return candidate;
        return {
            ...candidate,
            orderGateStatus: diagnostic.status,
            orderGateReason: diagnostic.reason,
            orderGateDetail: diagnostic.detail,
            orderTriggeredAt: diagnostic.orderTriggeredAt,
        };
    });
    const selected = candidates.filter((candidate) => candidate.autoTradeTarget);
    const selectedOrderBlockedRows = candidates.filter((candidate) =>
        candidate.autoTradeTarget && candidate.orderGateStatus !== "armed",
    );
    const finalAlignmentWaitCount = candidates.filter((candidate) =>
        candidate.selectionEligible
        && candidate.orderGateStatus === "blocked"
        &&
        /final trigger alignment|trigger not ready|order not armed/i.test(`${candidate.orderGateReason || ""} ${candidate.orderGateDetail || ""}`),
    ).length;
    const volumeHeldCount = 0;
    const ordersTodayCount = candidates.filter((candidate) =>
        Number.isFinite(candidate.orderTriggeredAt)
        && Number(candidate.orderTriggeredAt) >= startOfJstDayTs(monitor.monitoredAt),
    ).length;
    const selectedOrderBlockedReasons = Array.from(
        selectedOrderBlockedRows.reduce((map, candidate) => {
            const key = candidate.orderGateReason || candidate.finalRejectReason || candidate.mainReason || "Selection blocked";
            map.set(key, (map.get(key) || 0) + 1);
            return map;
        }, new Map<string, number>()),
    )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count }));

    return {
        ...monitor,
        candidates,
        selected,
        fullSizeTargets: selected.filter((candidate) => candidate.positionSizeLabel === "0.5x"),
        halfSizeTargets: selected.filter((candidate) => candidate.positionSizeLabel === "0.3x"),
        armed: candidates.filter((candidate) => candidate.triggerState === "Armed").slice(0, 8),
        triggered: candidates.filter((candidate) => candidate.triggerState === "Triggered").slice(0, 8),
        executed: candidates.filter((candidate) => candidate.triggerState === "Executed").slice(0, 8),
        cooldown: candidates.filter((candidate) => candidate.triggerState === "Cooldown").slice(0, 8),
        watchlist: candidates.filter((candidate) => candidate.tradeDecision === "Watchlist").slice(0, 12),
        blocked: candidates.filter((candidate) => candidate.tradeDecision === "Blocked").slice(0, 12),
        stats: {
            ...monitor.stats,
            waitingForSlotCount: candidates.filter((candidate) => candidate.orderGateStatus === "slot").length,
            orderArmedCount: candidates.filter((candidate) => candidate.orderGateStatus === "armed").length,
            finalAlignmentWaitCount,
            volumeHeldCount,
            ordersTodayCount,
            selectedOrderBlockedCount: selectedOrderBlockedRows.length,
            selectedOrderBlockedReasons,
        },
    } satisfies ContinuousStrategyMonitor;
}

function trimStoredText(value: unknown, maxLength: number) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function compactNewMuchStrategies(strategies: StrategyProposal[]): StrategyProposal[] {
    return strategies.slice(0, 3).map((strategy): StrategyProposal => {
        const compactPlans: NonNullable<StrategyProposal["symbolPlans"]> = (strategy.symbolPlans || []).slice(0, 4).map((plan) => {
            const chain: "BNB" | "SOLANA" | undefined = plan.chain === "SOLANA" ? "SOLANA" : plan.chain === "BNB" ? "BNB" : undefined;
            const executionChain: "BNB" | "SOLANA" | undefined = plan.executionChain === "SOLANA" ? "SOLANA" : plan.executionChain === "BNB" ? "BNB" : undefined;
            const executionRouteKind: "native" | "proxy" | "cross-chain" | undefined = plan.executionRouteKind === "native" || plan.executionRouteKind === "proxy" || plan.executionRouteKind === "cross-chain"
                ? plan.executionRouteKind
                : undefined;
            const rank: "A" | "B" | "C" | "D" | undefined = plan.rank === "A" || plan.rank === "B" || plan.rank === "C" || plan.rank === "D" ? plan.rank : undefined;
            const mode: "TREND" | "MEAN_REVERSION" | "SKIP" | undefined = plan.mode === "TREND" || plan.mode === "MEAN_REVERSION" || plan.mode === "SKIP" ? plan.mode : undefined;
            const positionSizeLabel: "0.5x" | "0.3x" | "0.2x" | "0x" | undefined =
                plan.positionSizeLabel === "0.5x"
                || plan.positionSizeLabel === "0.3x"
                || plan.positionSizeLabel === "0.2x"
                || plan.positionSizeLabel === "0x"
                ? plan.positionSizeLabel
                : undefined;

            return {
                symbol: String(plan.symbol || ""),
                displaySymbol: typeof plan.displaySymbol === "string" ? plan.displaySymbol : undefined,
                chain,
                executionChain,
                executionChainId: Number.isFinite(plan.executionChainId) ? Number(plan.executionChainId) : undefined,
                executionAddress: typeof plan.executionAddress === "string" ? plan.executionAddress : undefined,
                executionDecimals: Number.isFinite(plan.executionDecimals) ? Number(plan.executionDecimals) : undefined,
                executionRouteKind,
                executionSource: typeof plan.executionSource === "string" ? plan.executionSource : undefined,
                executionPairUrl: typeof plan.executionPairUrl === "string" ? plan.executionPairUrl : undefined,
                weight: Number.isFinite(plan.weight) ? Number(plan.weight) : 0,
                source: plan.source === "current" || plan.source === "next" ? plan.source : undefined,
                rank,
                mode,
                positionSizeMultiplier: Number.isFinite(plan.positionSizeMultiplier) ? Number(plan.positionSizeMultiplier) : undefined,
                positionSizeLabel,
                plannedEntryAt: Number.isFinite(plan.plannedEntryAt) ? Number(plan.plannedEntryAt) : undefined,
                plannedExitAt: Number.isFinite(plan.plannedExitAt) ? Number(plan.plannedExitAt) : undefined,
                entryMin: Number.isFinite(plan.entryMin) ? Number(plan.entryMin) : 0,
                entryMax: Number.isFinite(plan.entryMax) ? Number(plan.entryMax) : 0,
                plannedTakeProfit: Number.isFinite(plan.plannedTakeProfit) ? Number(plan.plannedTakeProfit) : 0,
                plannedStopLoss: Number.isFinite(plan.plannedStopLoss) ? Number(plan.plannedStopLoss) : 0,
                reasonTags: Array.isArray(plan.reasonTags) ? plan.reasonTags.slice(0, 4).map((tag) => trimStoredText(tag, 40)).filter(Boolean) : [],
                indicatorNotes: Array.isArray(plan.indicatorNotes) ? plan.indicatorNotes.slice(0, 4).map((note) => trimStoredText(note, 60)).filter(Boolean) : [],
                score: Number.isFinite(plan.score) ? Number(plan.score) : undefined,
            };
        });

        return {
            id: String(strategy.id || `newmuch-${Date.now()}`),
            agentId: String(strategy.agentId || "newmuch"),
            title: trimStoredText(strategy.title, 80) || "Strategy Snapshot",
            description: trimStoredText(strategy.description, 220),
            status: strategy.status === "PENDING" || strategy.status === "APPROVED" || strategy.status === "REJECTED" || strategy.status === "ACTIVE"
                ? strategy.status
                : "ACTIVE",
            timestamp: Number(strategy.timestamp || Date.now()),
            dayKey: typeof strategy.dayKey === "string" ? strategy.dayKey : undefined,
            durationBlock: DAILY_STRATEGY_BLOCKS.includes(strategy.durationBlock as (typeof DAILY_STRATEGY_BLOCKS)[number])
                ? strategy.durationBlock
                : undefined,
            settlementSymbol: typeof strategy.settlementSymbol === "string" ? strategy.settlementSymbol : undefined,
            rankSummary: trimStoredText(strategy.rankSummary, 160) || undefined,
            mode: strategy.mode === "TREND" || strategy.mode === "MEAN_REVERSION" || strategy.mode === "MIXED"
                ? strategy.mode
                : undefined,
            symbolPlans: compactPlans,
            intradayPromoted: Array.isArray(strategy.intradayPromoted)
                ? strategy.intradayPromoted.slice(0, 3).map((item) => ({
                    symbol: String(item.symbol || ""),
                    displaySymbol: typeof item.displaySymbol === "string" ? item.displaySymbol : undefined,
                    chain: item.chain === "SOLANA" || item.chain === "BNB" ? item.chain : undefined,
                    triggerState: item.triggerState,
                    triggerType: typeof item.triggerType === "string" ? trimStoredText(item.triggerType, 32) : undefined,
                    regime: item.regime,
                    positionSizeLabel:
                        item.positionSizeLabel === "0.5x"
                        || item.positionSizeLabel === "0.3x"
                        || item.positionSizeLabel === "0.2x"
                        || item.positionSizeLabel === "0x"
                        ? item.positionSizeLabel
                        : undefined,
                    source: item.source === "selected" || item.source === "triggered" ? item.source : undefined,
                    routeType: item.routeType === "native" || item.routeType === "proxy" || item.routeType === "cross-chain" ? item.routeType : undefined,
                    score: Number.isFinite(item.score) ? Number(item.score) : undefined,
                    reason: typeof item.reason === "string" ? trimStoredText(item.reason, 60) : undefined,
                }))
                : undefined,
            candidateSnapshots: [],
            selectionStats: strategy.selectionStats ? {
                rawUniverseCount: Number.isFinite(strategy.selectionStats.rawUniverseCount) ? Number(strategy.selectionStats.rawUniverseCount) : undefined,
                universeCount: Number.isFinite(strategy.selectionStats.universeCount) ? Number(strategy.selectionStats.universeCount) : 0,
                universeExcludedCount: Number.isFinite(strategy.selectionStats.universeExcludedCount) ? Number(strategy.selectionStats.universeExcludedCount) : undefined,
                monitoredUniverseCount: Number.isFinite(strategy.selectionStats.monitoredUniverseCount) ? Number(strategy.selectionStats.monitoredUniverseCount) : undefined,
                prefilterPassCount: Number.isFinite(strategy.selectionStats.prefilterPassCount) ? Number(strategy.selectionStats.prefilterPassCount) : undefined,
                prefilterExcludedCount: Number.isFinite(strategy.selectionStats.prefilterExcludedCount) ? Number(strategy.selectionStats.prefilterExcludedCount) : undefined,
                prefilterMode: strategy.selectionStats.prefilterMode === "Trend" || strategy.selectionStats.prefilterMode === "Range"
                    ? strategy.selectionStats.prefilterMode
                    : undefined,
                prefilterRescuedCount: Number.isFinite(strategy.selectionStats.prefilterRescuedCount) ? Number(strategy.selectionStats.prefilterRescuedCount) : undefined,
                prefilterTargetMin: Number.isFinite(strategy.selectionStats.prefilterTargetMin) ? Number(strategy.selectionStats.prefilterTargetMin) : undefined,
                marketDataPassCount: Number.isFinite(strategy.selectionStats.marketDataPassCount) ? Number(strategy.selectionStats.marketDataPassCount) : 0,
                vetoCount: Number.isFinite(strategy.selectionStats.vetoCount) ? Number(strategy.selectionStats.vetoCount) : 0,
                vetoPassCount: Number.isFinite(strategy.selectionStats.vetoPassCount) ? Number(strategy.selectionStats.vetoPassCount) : 0,
                scoreCalculatedCount: Number.isFinite(strategy.selectionStats.scoreCalculatedCount) ? Number(strategy.selectionStats.scoreCalculatedCount) : 0,
                thresholdScore: Number.isFinite(strategy.selectionStats.thresholdScore) ? Number(strategy.selectionStats.thresholdScore) : STRATEGY_CONFIG.SCORE_THRESHOLD,
                thresholdPassCount: Number.isFinite(strategy.selectionStats.thresholdPassCount) ? Number(strategy.selectionStats.thresholdPassCount) : 0,
                fullSizeEligibleCount: Number.isFinite(strategy.selectionStats.fullSizeEligibleCount) ? Number(strategy.selectionStats.fullSizeEligibleCount) : undefined,
                halfSizeEligibleCount: Number.isFinite(strategy.selectionStats.halfSizeEligibleCount) ? Number(strategy.selectionStats.halfSizeEligibleCount) : undefined,
                finalSelectionEligibleCount: Number.isFinite(strategy.selectionStats.finalSelectionEligibleCount) ? Number(strategy.selectionStats.finalSelectionEligibleCount) : undefined,
                scoreRejectedCount: Number.isFinite(strategy.selectionStats.scoreRejectedCount) ? Number(strategy.selectionStats.scoreRejectedCount) : 0,
                correlationPassCount: Number.isFinite(strategy.selectionStats.correlationPassCount) ? Number(strategy.selectionStats.correlationPassCount) : 0,
                correlationRejectedCount: Number.isFinite(strategy.selectionStats.correlationRejectedCount) ? Number(strategy.selectionStats.correlationRejectedCount) : 0,
                finalSelectedCount: Number.isFinite(strategy.selectionStats.finalSelectedCount) ? Number(strategy.selectionStats.finalSelectedCount) : 0,
                topUniverseAssets: Array.isArray(strategy.selectionStats.topUniverseAssets)
                    ? strategy.selectionStats.topUniverseAssets.slice(0, 5)
                    : undefined,
                experimentalTierAssets: Array.isArray(strategy.selectionStats.experimentalTierAssets)
                    ? strategy.selectionStats.experimentalTierAssets.slice(0, 5)
                    : undefined,
            } : undefined,
            agentScenarios: Array.isArray(strategy.agentScenarios)
                ? strategy.agentScenarios.slice(0, 3).map((scenario) => ({
                    agentId: scenario.agentId,
                    title: trimStoredText(scenario.title, 48),
                    summary: trimStoredText(scenario.summary, 120),
                }))
                : undefined,
            proposedSettings: strategy.proposedSettings ? {
                riskTolerance: Number.isFinite(strategy.proposedSettings.riskTolerance) ? Number(strategy.proposedSettings.riskTolerance) : 0,
                stopLoss: Number.isFinite(strategy.proposedSettings.stopLoss) ? Number(strategy.proposedSettings.stopLoss) : 0,
                takeProfit: Number.isFinite(strategy.proposedSettings.takeProfit) ? Number(strategy.proposedSettings.takeProfit) : 0,
            } : undefined,
        };
    });
}

function compactNewMuchUpdate(update: NewMuchUpdate): NewMuchUpdate {
    return {
        id: String(update.id),
        title: trimStoredText(update.title, 80) || "NewMuch",
        summary: trimStoredText(update.summary, 320),
        createdAt: Number(update.createdAt || Date.now()),
        announcementSlot: trimStoredText(update.announcementSlot, 24) || formatJstTimeLabel(Date.now()),
        kind: update.kind === "market-update" ? "market-update" : "daily-fixed",
        changedBlocks: (update.changedBlocks || []).slice(0, 4).map((block) => ({
            block: DAILY_STRATEGY_BLOCKS.includes(block.block as (typeof DAILY_STRATEGY_BLOCKS)[number])
                ? block.block
                : DAILY_STRATEGY_BLOCKS[0],
            previousBasket: trimStoredText(block.previousBasket, 140),
            nextBasket: trimStoredText(block.nextBasket, 140),
            reason: trimStoredText(block.reason, 220),
        })),
        evaluationChanges: (update.evaluationChanges || []).slice(0, 4).map((change) => ({
            block: DAILY_STRATEGY_BLOCKS.includes(change.block as (typeof DAILY_STRATEGY_BLOCKS)[number])
                ? change.block
                : DAILY_STRATEGY_BLOCKS[0],
            fixedBasket: trimStoredText(change.fixedBasket, 140),
            fixedBasketEmpty: Boolean(change.fixedBasketEmpty),
            topRanked: Array.isArray(change.topRanked) ? change.topRanked.slice(0, 5).map((item) => trimStoredText(item, 48)).filter(Boolean) : [],
            nearMisses: Array.isArray(change.nearMisses) ? change.nearMisses.slice(0, 5).map((item) => trimStoredText(item, 48)).filter(Boolean) : [],
            highlights: Array.isArray(change.highlights) ? change.highlights.slice(0, 5).map((item) => trimStoredText(item, 80)).filter(Boolean) : [],
            intradayPromoted: Array.isArray(change.intradayPromoted)
                ? change.intradayPromoted.slice(0, 3).map((item) => ({
                    symbol: String(item.symbol || ""),
                    displaySymbol: typeof item.displaySymbol === "string" ? item.displaySymbol : undefined,
                    chain: item.chain === "SOLANA" || item.chain === "BNB" ? item.chain : undefined,
                    triggerState: item.triggerState,
                    triggerType: typeof item.triggerType === "string" ? trimStoredText(item.triggerType, 32) : undefined,
                    regime: item.regime,
                    positionSizeLabel:
                        item.positionSizeLabel === "0.5x"
                        || item.positionSizeLabel === "0.3x"
                        || item.positionSizeLabel === "0.2x"
                        || item.positionSizeLabel === "0x"
                        ? item.positionSizeLabel
                        : undefined,
                    source: item.source === "selected" || item.source === "triggered" ? item.source : undefined,
                    routeType: item.routeType === "native" || item.routeType === "proxy" || item.routeType === "cross-chain" ? item.routeType : undefined,
                    score: Number.isFinite(item.score) ? Number(item.score) : undefined,
                    reason: typeof item.reason === "string" ? trimStoredText(item.reason, 60) : undefined,
                }))
                : undefined,
            summary: trimStoredText(change.summary, 220),
        })),
        strategies: compactNewMuchStrategies(update.strategies || []),
    };
}

function isQuotaExceededStorageError(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
    const code = "code" in error ? Number((error as { code?: unknown }).code ?? NaN) : NaN;
    return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

function normalizeNewMuchFeed(updates: NewMuchUpdate[]) {
    const normalized: NewMuchUpdate[] = [];
    const seen = new Set<string>();
    let keptMarketUpdate = false;

    for (const update of updates) {
        if (!update || typeof update.id !== "string" || seen.has(update.id)) continue;
        if (update.kind === "market-update") {
            if (keptMarketUpdate) continue;
            keptMarketUpdate = true;
        }
        seen.add(update.id);
        normalized.push(update);
        if (normalized.length >= 20) break;
    }

    return normalized;
}

function persistNewMuchUpdatesSafely(updates: NewMuchUpdate[], storageKey: string) {
    if (typeof window === "undefined") return;

    const compacted = normalizeNewMuchFeed(updates).map(compactNewMuchUpdate);
    const fallbackBatches = [
        compacted.slice(0, 8),
        compacted.slice(0, 4),
        compacted.slice(0, 2),
        compacted.slice(0, 1),
    ];

    for (const batch of fallbackBatches) {
        try {
            localStorage.setItem(storageKey, JSON.stringify(batch));
            return;
        } catch (error) {
            if (!isQuotaExceededStorageError(error)) return;
        }
    }

    try {
        localStorage.removeItem(storageKey);
    } catch {}
}

function persistStrategyPerformanceSafely(store: StrategyPerformanceStore) {
    if (typeof window === "undefined") return;
    const normalized = normalizeStrategyPerformanceStore(store);
    const candidateLimits = [normalized.candidateEvents.length, 1200, 600, 300];
    const executionLimits = [normalized.executionEvents.length, 900, 450, 225];
    for (const candidateLimit of candidateLimits) {
        for (const executionLimit of executionLimits) {
            try {
                localStorage.setItem(
                    STRATEGY_PERFORMANCE_STORAGE_KEY,
                    JSON.stringify({
                        ...normalized,
                        candidateEvents: normalized.candidateEvents.slice(-candidateLimit),
                        executionEvents: normalized.executionEvents.slice(-executionLimit),
                    }),
                );
                return;
            } catch (error) {
                if (!isQuotaExceededStorageError(error)) return;
            }
        }
    }
    try {
        localStorage.removeItem(STRATEGY_PERFORMANCE_STORAGE_KEY);
    } catch {}
}

type StoredLiveStrategyMonitorCandidate = Pick<
    ContinuousStrategyCandidate,
    | "symbol"
    | "displaySymbol"
    | "chain"
    | "price"
    | "change24h"
    | "executionSupported"
    | "executionChain"
    | "executionChainId"
    | "executionAddress"
    | "executionRouteKind"
    | "executionSource"
    | "executionPairUrl"
    | "executionLiquidityUsd"
    | "executionVolume24hUsd"
    | "executionTxns1h"
    | "mode"
    | "rank"
    | "status"
    | "executionStatus"
    | "tradeDecision"
    | "marketScore"
    | "score"
    | "confidence"
    | "veto"
    | "vetoPass"
    | "mainReason"
    | "supportDistancePct"
    | "resistanceDistancePct"
    | "atrPct"
    | "volumeRatio"
    | "relativeStrengthScore"
    | "correlationGroup"
    | "selectionStage"
    | "positionSizeMultiplier"
    | "positionSizeLabel"
    | "halfSizeEligible"
    | "fullSizeEligible"
    | "conditionalReferencePass"
    | "probationaryEligible"
    | "selectionEligible"
    | "relativeStrengthPercentile"
    | "volumeConfirmed"
    | "routeMissing"
    | "seedFallback"
    | "rrCheck"
    | "rrStatus"
    | "resistanceStatus"
    | "halfSizeMinRr"
    | "correlationRejected"
    | "finalSelectedEligible"
    | "finalRejectReason"
    | "prefilterPass"
    | "prefilterReason"
    | "regime"
    | "triggerType"
    | "triggerFamily"
    | "triggerState"
    | "triggerReason"
    | "triggerScore"
    | "triggerPassedCount"
    | "triggerRuleCount"
    | "triggerProgressRatio"
    | "cooldownUntil"
    | "autoTradeLiveEligible"
    | "autoTradeTarget"
    | "allocationWeight"
    | "timedExitMinutes"
    | "dynamicTakeProfit"
    | "dynamicStopLoss"
    | "eventPriority"
    | "orderGateStatus"
    | "orderGateReason"
    | "orderGateDetail"
    | "orderTriggeredAt"
    | "orderArmEligible"
> & {
    triggerMissingReasons?: string[];
    metrics: Partial<ContinuousStrategyCandidate["metrics"]>;
};

type StoredLiveStrategyMonitor = {
    dayKey: string;
    currentBlock: ContinuousStrategyMonitor["currentBlock"];
    monitoredAt: number;
    regimeUpdatedAt: number;
    candidateUpdatedAt: number;
    triggerUpdatedAt: number;
    stats: ContinuousStrategyMonitor["stats"];
    candidates: StoredLiveStrategyMonitorCandidate[];
    selectedSymbols: string[];
    fullSizeSymbols: string[];
    halfSizeSymbols: string[];
    armedSymbols: string[];
    triggeredSymbols: string[];
    executedSymbols: string[];
    cooldownSymbols: string[];
    watchlistSymbols: string[];
    blockedSymbols: string[];
};

function compactLiveStrategyMonitorCandidate(candidate: ContinuousStrategyCandidate): StoredLiveStrategyMonitorCandidate {
    return {
        symbol: candidate.symbol,
        displaySymbol: candidate.displaySymbol,
        chain: candidate.chain,
        price: Number(candidate.price || 0),
        change24h: Number(candidate.change24h || 0),
        executionSupported: candidate.executionSupported,
        executionChain: candidate.executionChain,
        executionChainId: candidate.executionChainId,
        executionAddress: candidate.executionAddress,
        executionRouteKind: candidate.executionRouteKind,
        executionSource: trimStoredText(candidate.executionSource, 24) || undefined,
        executionPairUrl: candidate.executionPairUrl,
        executionLiquidityUsd: Number(candidate.executionLiquidityUsd || 0),
        executionVolume24hUsd: Number(candidate.executionVolume24hUsd || 0),
        executionTxns1h: Number(candidate.executionTxns1h || 0),
        mode: candidate.mode,
        rank: candidate.rank,
        status: candidate.status,
        executionStatus: candidate.executionStatus,
        tradeDecision: candidate.tradeDecision,
        marketScore: Number(candidate.marketScore || 0),
        score: Number(candidate.score || 0),
        confidence: Number(candidate.confidence || 0),
        veto: Boolean(candidate.veto),
        vetoPass: Boolean(candidate.vetoPass),
        mainReason: trimStoredText(candidate.mainReason, 120),
        supportDistancePct: Number(candidate.supportDistancePct || 0),
        resistanceDistancePct: Number(candidate.resistanceDistancePct || 0),
        atrPct: Number(candidate.atrPct || 0),
        volumeRatio: Number(candidate.volumeRatio || 0),
        relativeStrengthScore: Number(candidate.relativeStrengthScore || 0),
        correlationGroup: trimStoredText(candidate.correlationGroup, 32),
        selectionStage: candidate.selectionStage,
        positionSizeMultiplier: Number(candidate.positionSizeMultiplier || 0),
        positionSizeLabel: candidate.positionSizeLabel,
        halfSizeEligible: Boolean(candidate.halfSizeEligible),
        fullSizeEligible: Boolean(candidate.fullSizeEligible),
        conditionalReferencePass: Boolean(candidate.conditionalReferencePass),
        probationaryEligible: Boolean(candidate.probationaryEligible),
        selectionEligible: Boolean(candidate.selectionEligible),
        relativeStrengthPercentile: Number(candidate.relativeStrengthPercentile || 0),
        volumeConfirmed: Boolean(candidate.volumeConfirmed),
        routeMissing: Boolean(candidate.routeMissing),
        seedFallback: Boolean(candidate.seedFallback),
        rrCheck: Boolean(candidate.rrCheck),
        rrStatus: candidate.rrStatus,
        resistanceStatus: candidate.resistanceStatus,
        halfSizeMinRr: Number(candidate.halfSizeMinRr || 0),
        correlationRejected: Boolean(candidate.correlationRejected),
        finalSelectedEligible: Boolean(candidate.finalSelectedEligible),
        finalRejectReason: trimStoredText(candidate.finalRejectReason, 120),
        prefilterPass: Boolean(candidate.prefilterPass),
        prefilterReason: trimStoredText(candidate.prefilterReason, 120),
        regime: candidate.regime,
        triggerType: candidate.triggerType,
        triggerFamily: candidate.triggerFamily,
        triggerState: candidate.triggerState,
        triggerReason: trimStoredText(candidate.triggerReason, 160),
        triggerScore: Number(candidate.triggerScore || 0),
        triggerPassedCount: Number(candidate.triggerPassedCount || 0),
        triggerRuleCount: Number(candidate.triggerRuleCount || 0),
        triggerProgressRatio: Number(candidate.triggerProgressRatio || 0),
        triggerMissingReasons: Array.isArray(candidate.triggerMissingReasons)
            ? candidate.triggerMissingReasons.slice(0, 4).map((reason) => trimStoredText(reason, 60)).filter(Boolean)
            : [],
        cooldownUntil: candidate.cooldownUntil,
        autoTradeLiveEligible: Boolean(candidate.autoTradeLiveEligible),
        autoTradeTarget: Boolean(candidate.autoTradeTarget),
        allocationWeight: Number(candidate.allocationWeight || 0),
        timedExitMinutes: Number(candidate.timedExitMinutes || 0),
        dynamicTakeProfit: Number(candidate.dynamicTakeProfit || 0),
        dynamicStopLoss: Number(candidate.dynamicStopLoss || 0),
        eventPriority: Number(candidate.eventPriority || 0),
        orderGateStatus: candidate.orderGateStatus,
        orderGateReason: trimStoredText(candidate.orderGateReason, 80),
        orderGateDetail: trimStoredText(candidate.orderGateDetail, 140),
        orderTriggeredAt: candidate.orderTriggeredAt,
        metrics: {
            r60: Number(candidate.metrics?.r60 || 0),
            rsi1h: Number(candidate.metrics?.rsi1h || 0),
            vwap1h: Number(candidate.metrics?.vwap1h || 0),
            vwap15m: Number(candidate.metrics?.vwap15m || 0),
            plusDi1h: Number(candidate.metrics?.plusDi1h || 0),
            minusDi1h: Number(candidate.metrics?.minusDi1h || 0),
            emaBull1h: Boolean(candidate.metrics?.emaBull1h),
            emaBull4h: Boolean(candidate.metrics?.emaBull4h),
            bandWidth1h: Number(candidate.metrics?.bandWidth1h || 0),
            chop1h: Number(candidate.metrics?.chop1h || 0),
            chop15m: Number(candidate.metrics?.chop15m || 0),
            rr: Number(candidate.metrics?.rr || 0),
        },
    };
}

function pickStoredLiveMonitorSymbols(rows: ContinuousStrategyCandidate[], limit: number) {
    return rows.slice(0, limit).map((row) => normalizeTrackedSymbol(row.symbol));
}

function serializeLiveStrategyMonitor(
    monitor: ContinuousStrategyMonitor,
    candidateLimit: number,
    symbolLimit: number,
): StoredLiveStrategyMonitor {
    return {
        dayKey: monitor.dayKey,
        currentBlock: monitor.currentBlock,
        monitoredAt: monitor.monitoredAt,
        regimeUpdatedAt: monitor.regimeUpdatedAt,
        candidateUpdatedAt: monitor.candidateUpdatedAt,
        triggerUpdatedAt: monitor.triggerUpdatedAt,
        stats: monitor.stats,
        candidates: monitor.candidates.slice(0, candidateLimit).map(compactLiveStrategyMonitorCandidate),
        selectedSymbols: pickStoredLiveMonitorSymbols(monitor.selected, symbolLimit),
        fullSizeSymbols: pickStoredLiveMonitorSymbols(monitor.fullSizeTargets, symbolLimit),
        halfSizeSymbols: pickStoredLiveMonitorSymbols(monitor.halfSizeTargets, symbolLimit),
        armedSymbols: pickStoredLiveMonitorSymbols(monitor.armed, symbolLimit),
        triggeredSymbols: pickStoredLiveMonitorSymbols(monitor.triggered, symbolLimit),
        executedSymbols: pickStoredLiveMonitorSymbols(monitor.executed, symbolLimit),
        cooldownSymbols: pickStoredLiveMonitorSymbols(monitor.cooldown, symbolLimit),
        watchlistSymbols: pickStoredLiveMonitorSymbols(monitor.watchlist, symbolLimit),
        blockedSymbols: pickStoredLiveMonitorSymbols(monitor.blocked, symbolLimit),
    };
}

function hydrateStoredLiveStrategyMonitor(raw: unknown): ContinuousStrategyMonitor | null {
    if (!raw || typeof raw !== "object") return null;
    const source = raw as Partial<StoredLiveStrategyMonitor & ContinuousStrategyMonitor>;
    const metricsDefaults: ContinuousStrategyCandidate["metrics"] = {
        r1: 0,
        r5: 0,
        r15: 0,
        r60: 0,
        r360: 0,
        r1440: 0,
        rsi1d: 0,
        rsi6h: 0,
        rsi1h: 0,
        macd1d: 0,
        macd6h: 0,
        macd1h: 0,
        vwap1h: 0,
        vwap15m: 0,
        adx1h: 0,
        plusDi1h: 0,
        minusDi1h: 0,
        emaBull1h: false,
        emaBull4h: false,
        emaSlope1h: 0,
        emaSlope4h: 0,
        bandWidth1h: 0,
        chop1h: 0,
        chop15m: 0,
        rr: 0,
    };

    const candidates = Array.isArray(source.candidates)
        ? source.candidates.map((candidateRaw) => {
            const candidate = candidateRaw as Partial<StoredLiveStrategyMonitorCandidate & ContinuousStrategyCandidate>;
            const displaySymbol = trimStoredText(candidate.displaySymbol, 24) || normalizeTrackedSymbol(candidate.symbol || "").replace(/\.SOL$/i, "");
            return {
                symbol: normalizeTrackedSymbol(candidate.symbol || ""),
                displaySymbol,
                chain: candidate.chain === "SOLANA" ? "SOLANA" : "BNB",
                price: Number(candidate.price || 0),
                change24h: Number(candidate.change24h || 0),
                volume: 0,
                liquidity: 0,
                spreadBps: 0,
                txns1h: Number(candidate.executionTxns1h || 0),
                dexPairFound: true,
                historyBars: 0,
                dataCompleteness: 1,
                universeRankScore: 0,
                executionSupported: candidate.executionSupported,
                contractAddress: undefined,
                dexPairUrl: undefined,
                executionChain: candidate.executionChain,
                executionChainId: candidate.executionChainId,
                executionAddress: candidate.executionAddress,
                executionDecimals: undefined,
                executionRouteKind: candidate.executionRouteKind,
                executionSource: candidate.executionSource,
                executionPairUrl: candidate.executionPairUrl,
                executionLiquidityUsd: Number(candidate.executionLiquidityUsd || 0),
                executionVolume24hUsd: Number(candidate.executionVolume24hUsd || 0),
                executionTxns1h: Number(candidate.executionTxns1h || 0),
                marketSource: undefined,
                mode: candidate.mode || "MEAN_REVERSION",
                rank: candidate.rank || "Out",
                status: candidate.status || "Out",
                executionStatus: candidate.executionStatus || "Pass",
                tradeDecision: candidate.tradeDecision || "Watchlist",
                marketScore: Number(candidate.marketScore || 0),
                score: Number(candidate.score || 0),
                rawScore: 0,
                weightedScore: 0,
                maxPossibleScore: 0,
                confidence: Number(candidate.confidence || 0),
                veto: Boolean(candidate.veto),
                vetoPass: Boolean(candidate.vetoPass),
                vetoReasons: [],
                mainReason: trimStoredText(candidate.mainReason, 120),
                reasonTags: [],
                indicatorNotes: [],
                scoreBreakdown: {},
                supportDistancePct: Number(candidate.supportDistancePct || 0),
                resistanceDistancePct: Number(candidate.resistanceDistancePct || 0),
                atrPct: Number(candidate.atrPct || 0),
                volumeRatio: Number(candidate.volumeRatio || 0),
                relativeStrengthScore: Number(candidate.relativeStrengthScore || 0),
                correlationGroup: trimStoredText(candidate.correlationGroup, 32),
                selectionStage: candidate.selectionStage,
                thresholdGap: 0,
                exclusionReason: undefined,
                autoTradeExcludedReason: undefined,
                positionSizeMultiplier: Number(candidate.positionSizeMultiplier || 0),
                positionSizeLabel: candidate.positionSizeLabel || "0x",
                halfSizeEligible: Boolean(candidate.halfSizeEligible),
                fullSizeEligible: Boolean(candidate.fullSizeEligible),
                aHalfSizeEligible: false,
                bHalfSizeEligible: false,
                seedProxyHalfSizeEligible: false,
                conditionalReferencePass: Boolean(candidate.conditionalReferencePass),
                probationaryEligible: Boolean(candidate.probationaryEligible),
                selectionEligible: Boolean(candidate.selectionEligible),
                relativeStrengthPercentile: Number(candidate.relativeStrengthPercentile || 0),
                volumeConfirmed: Boolean(candidate.volumeConfirmed),
                routeMissing: Boolean(candidate.routeMissing),
                seedFallback: Boolean(candidate.seedFallback),
                rrCheck: Boolean(candidate.rrCheck),
                rrStatus: candidate.rrStatus || "Weak",
                resistanceStatus: candidate.resistanceStatus || "OK",
                halfSizeMinRr: Number(candidate.halfSizeMinRr || 0),
                correlationRejected: Boolean(candidate.correlationRejected),
                finalSelectedEligible: Boolean(candidate.finalSelectedEligible),
                finalRejectReason: trimStoredText(candidate.finalRejectReason, 120),
                prefilterPass: Boolean(candidate.prefilterPass),
                prefilterReason: trimStoredText(candidate.prefilterReason, 120),
                metrics: {
                    ...metricsDefaults,
                    ...(candidate.metrics || {}),
                },
                regime: candidate.regime || "No-trade",
                triggerType: candidate.triggerType || "None",
                triggerFamily: candidate.triggerFamily || "Trend",
                triggerState: candidate.triggerState || "Ready",
                triggerReason: trimStoredText(candidate.triggerReason, 160),
                triggerScore: Number(candidate.triggerScore || 0),
                triggerPassedCount: Number(candidate.triggerPassedCount || 0),
                triggerRuleCount: Number(candidate.triggerRuleCount || 0),
                triggerProgressRatio: Number(candidate.triggerProgressRatio || 0),
                triggerMissingReasons: Array.isArray(candidate.triggerMissingReasons) ? candidate.triggerMissingReasons.slice(0, 4) : [],
                cooldownUntil: candidate.cooldownUntil,
                autoTradeLiveEligible: Boolean(candidate.autoTradeLiveEligible),
                autoTradeTarget: Boolean(candidate.autoTradeTarget),
                allocationWeight: Number(candidate.allocationWeight || 0),
                timedExitMinutes: Number(candidate.timedExitMinutes || 0),
                dynamicTakeProfit: Number(candidate.dynamicTakeProfit || 0),
                dynamicStopLoss: Number(candidate.dynamicStopLoss || 0),
                eventPriority: Number(candidate.eventPriority || 0),
                orderGateStatus: candidate.orderGateStatus,
                orderGateReason: trimStoredText(candidate.orderGateReason, 80),
                orderGateDetail: trimStoredText(candidate.orderGateDetail, 140),
                orderTriggeredAt: candidate.orderTriggeredAt,
                orderArmEligible: Boolean(candidate.orderArmEligible),
            } as ContinuousStrategyCandidate;
        }).filter((candidate) => candidate.symbol) : [];

    const candidateMap = new Map(candidates.map((candidate) => [normalizeTrackedSymbol(candidate.symbol), candidate]));
    const pickRows = (symbols: string[] | undefined, fallback: (candidate: ContinuousStrategyCandidate) => boolean) => {
        if (Array.isArray(symbols) && symbols.length) {
            return symbols
                .map((symbol) => candidateMap.get(normalizeTrackedSymbol(symbol)))
                .filter((candidate): candidate is ContinuousStrategyCandidate => Boolean(candidate));
        }
        return candidates.filter(fallback);
    };

    return {
        dayKey: typeof source.dayKey === "string" ? source.dayKey : getJstDateKey(),
        currentBlock: source.currentBlock || "0:00-6:00",
        monitoredAt: Number(source.monitoredAt || Date.now()),
        regimeUpdatedAt: Number(source.regimeUpdatedAt || Date.now()),
        candidateUpdatedAt: Number(source.candidateUpdatedAt || Date.now()),
        triggerUpdatedAt: Number(source.triggerUpdatedAt || Date.now()),
        stats: {
            rawUniverseCount: Number(source.stats?.rawUniverseCount || 0),
            monitoredUniverseCount: Number(source.stats?.monitoredUniverseCount || 0),
            prefilterPassCount: Number(source.stats?.prefilterPassCount || 0),
            prefilterMode: source.stats?.prefilterMode,
            prefilterRescuedCount: Number(source.stats?.prefilterRescuedCount || 0),
            prefilterTargetMin: Number(source.stats?.prefilterTargetMin || 0),
            scoredCount: Number(source.stats?.scoredCount || 0),
            readyCount: Number(source.stats?.readyCount || 0),
            armedCount: Number(source.stats?.armedCount || 0),
            triggeredCount: Number(source.stats?.triggeredCount || 0),
            executedCount: Number(source.stats?.executedCount || 0),
            cooldownCount: Number(source.stats?.cooldownCount || 0),
            selectedCount: Number(source.stats?.selectedCount || 0),
            selectedBasketCap: Number(source.stats?.selectedBasketCap || 0),
            selectionEligibleCount: Number(source.stats?.selectionEligibleCount || 0),
            conditionalReferencePassCount: Number(source.stats?.conditionalReferencePassCount || 0),
            probationaryCount: Number(source.stats?.probationaryCount || 0),
            waitingForSlotCount: Number(source.stats?.waitingForSlotCount || 0),
            orderArmedCount: Number(source.stats?.orderArmedCount || 0),
            finalAlignmentWaitCount: Number(source.stats?.finalAlignmentWaitCount || 0),
            volumeHeldCount: Number(source.stats?.volumeHeldCount || 0),
            ordersTodayCount: Number(source.stats?.ordersTodayCount || 0),
            selectedOrderBlockedCount: Number(source.stats?.selectedOrderBlockedCount || 0),
            selectedOrderBlockedReasons: Array.isArray(source.stats?.selectedOrderBlockedReasons)
                ? source.stats.selectedOrderBlockedReasons.slice(0, 6)
                : [],
        },
        candidates,
        selected: pickRows((source as StoredLiveStrategyMonitor).selectedSymbols, (candidate) => candidate.autoTradeTarget),
        fullSizeTargets: pickRows((source as StoredLiveStrategyMonitor).fullSizeSymbols, (candidate) => candidate.autoTradeTarget && candidate.positionSizeLabel === "0.5x"),
        halfSizeTargets: pickRows((source as StoredLiveStrategyMonitor).halfSizeSymbols, (candidate) => candidate.autoTradeTarget && candidate.positionSizeLabel === "0.3x"),
        armed: pickRows((source as StoredLiveStrategyMonitor).armedSymbols, (candidate) => candidate.triggerState === "Armed"),
        triggered: pickRows((source as StoredLiveStrategyMonitor).triggeredSymbols, (candidate) => candidate.triggerState === "Triggered"),
        executed: pickRows((source as StoredLiveStrategyMonitor).executedSymbols, (candidate) => candidate.triggerState === "Executed"),
        cooldown: pickRows((source as StoredLiveStrategyMonitor).cooldownSymbols, (candidate) => candidate.triggerState === "Cooldown"),
        watchlist: pickRows((source as StoredLiveStrategyMonitor).watchlistSymbols, (candidate) => candidate.tradeDecision === "Watchlist"),
        blocked: pickRows((source as StoredLiveStrategyMonitor).blockedSymbols, (candidate) => candidate.tradeDecision === "Blocked"),
    };
}

function persistLiveStrategyMonitorSafely(monitor: ContinuousStrategyMonitor) {
    if (typeof window === "undefined") return;

    const fallbacks = [
        serializeLiveStrategyMonitor(monitor, 48, 18),
        serializeLiveStrategyMonitor(monitor, 24, 12),
        serializeLiveStrategyMonitor(monitor, 12, 8),
        {
            ...serializeLiveStrategyMonitor(monitor, 0, 0),
            candidates: [],
        },
    ];

    for (const snapshot of fallbacks) {
        try {
            localStorage.setItem(LIVE_STRATEGY_MONITOR_STORAGE_KEY, JSON.stringify(snapshot));
            return;
        } catch (error) {
            if (!isQuotaExceededStorageError(error)) return;
        }
    }

    try {
        localStorage.removeItem(LIVE_STRATEGY_MONITOR_STORAGE_KEY);
    } catch {}
}

function loadStoredDailyStrategies(dayKey: string): StrategyProposal[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(DAILY_STRATEGY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as { dayKey?: string; strategies?: StrategyProposal[] };
        if (parsed?.dayKey !== dayKey || !Array.isArray(parsed?.strategies)) return [];
        return normalizeStoredStrategies(parsed.strategies);
    } catch {
        return [];
    }
}

function standardDeviation(values: number[]) {
    if (values.length < 2) return 0;
    const avg = average(values);
    const variance = average(values.map((value) => (value - avg) ** 2));
    return Math.sqrt(variance);
}

function getBlockWindow(block: (typeof DAILY_STRATEGY_BLOCKS)[number], referenceTs: number = Date.now()) {
    const parts = block.split("-");
    const startHour = Number(parts[0].split(":")[0]);
    const endHour = Number(parts[1].split(":")[0]);
    const base = new Date(referenceTs);
    const jstBase = new Date(base.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    jstBase.setHours(0, 0, 0, 0);
    const start = new Date(jstBase);
    start.setHours(startHour, 0, 0, 0);
    const end = new Date(jstBase);
    end.setHours(endHour === 24 ? 23 : endHour, endHour === 24 ? 59 : 0, endHour === 24 ? 59 : 0, endHour === 24 ? 999 : 0);
    return {
        startTs: start.getTime(),
        endTs: end.getTime(),
        startHour,
        endHour,
    };
}

function ema(values: number[], period: number) {
    if (!values.length) return 0;
    if (values.length < period) return average(values);
    const multiplier = 2 / (period + 1);
    let current = average(values.slice(0, period));
    for (let index = period; index < values.length; index += 1) {
        current = (values[index] - current) * multiplier + current;
    }
    return current;
}

function rsi(values: number[], period = 14) {
    if (values.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let index = values.length - period; index < values.length; index += 1) {
        const diff = values[index] - values[index - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function macd(values: number[]) {
    if (values.length < 35) {
        return { line: 0, signal: 0, histogram: 0 };
    }
    const macdSeries: number[] = [];
    for (let index = 0; index < values.length; index += 1) {
        const slice = values.slice(0, index + 1);
        macdSeries.push(ema(slice, 12) - ema(slice, 26));
    }
    const line = macdSeries[macdSeries.length - 1] || 0;
    const signal = ema(macdSeries, 9);
    return {
        line,
        signal,
        histogram: line - signal,
    };
}

function atrProxyPct(values: number[], period = 14) {
    if (values.length <= period) return 0;
    const ranges: number[] = [];
    for (let index = 1; index < values.length; index += 1) {
        const previous = values[index - 1];
        const current = values[index];
        if (previous <= 0) continue;
        ranges.push(Math.abs(current - previous) / previous);
    }
    if (!ranges.length) return 0;
    return average(ranges.slice(-period));
}

function bollingerWidthPct(values: number[], period = 20) {
    if (values.length < period) return 0;
    const window = values.slice(-period);
    const basis = average(window);
    if (basis <= 0) return 0;
    const sigma = standardDeviation(window);
    const upper = basis + sigma * 2;
    const lower = basis - sigma * 2;
    return Math.max(0, (upper - lower) / basis);
}

function choppiness(values: number[], period = 14) {
    if (values.length <= period) return 50;
    const window = values.slice(-(period + 1));
    const highs = Math.max(...window);
    const lows = Math.min(...window);
    const sumRanges = window.slice(1).reduce((sum, value, index) => sum + Math.abs(value - window[index]), 0);
    const denominator = highs - lows;
    if (denominator <= 0 || sumRanges <= 0) return 50;
    const ratio = sumRanges / denominator;
    return clamp((Math.log10(ratio) / Math.log10(period)) * 100, 0, 100);
}

function vwapProxyDeltaPct(values: number[], currentPrice: number) {
    if (!values.length || currentPrice <= 0) return 0;
    const weighted = values.reduce((sum, value, index) => sum + value * (index + 1), 0);
    const weights = values.reduce((sum, _value, index) => sum + (index + 1), 0);
    if (!weights) return 0;
    const proxy = weighted / weights;
    if (proxy <= 0) return 0;
    return (currentPrice - proxy) / proxy;
}

function supportResistancePct(values: number[], currentPrice: number) {
    if (!values.length || currentPrice <= 0) {
        return { supportPct: 0, resistancePct: 0 };
    }
    const support = Math.min(...values);
    const resistance = Math.max(...values);
    return {
        supportPct: support > 0 ? (currentPrice - support) / currentPrice : 0,
        resistancePct: resistance > 0 ? (resistance - currentPrice) / currentPrice : 0,
    };
}

function correlation(left: number[], right: number[]) {
    const length = Math.min(left.length, right.length);
    if (length < 8) return 0;
    const x = left.slice(-length);
    const y = right.slice(-length);
    const avgX = average(x);
    const avgY = average(y);
    let numerator = 0;
    let denominatorX = 0;
    let denominatorY = 0;
    for (let index = 0; index < length; index += 1) {
        const dx = x[index] - avgX;
        const dy = y[index] - avgY;
        numerator += dx * dy;
        denominatorX += dx * dx;
        denominatorY += dy * dy;
    }
    const denominator = Math.sqrt(denominatorX * denominatorY);
    if (!denominator) return 0;
    return clamp(numerator / denominator, -1, 1);
}

function hashString(input: string) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
}

export interface DiscussionEntry {
    id: string;
    pair: string;
    messages: { agentId: string; content: string; round?: number; type?: string }[];
    result?: {
        action: string;
        confidence: number;
        reasoning: string;
        takeProfit?: number;
        stopLoss?: number;
    };
    source: "dex-tracker" | "council";
    timestamp: number;
}

export interface TradeNotification {
    id: string;
    agentId: string;
    agentName: string;
    title: string;
    message: string;
    type: "BUY" | "SELL" | "ALERT";
    symbol: string;
    timestamp: number;
    autoTradeTarget?: boolean;
}

interface MarketData {
    price: number;
    change24h: number;
    volume: number;
    trend: "BULL" | "BEAR" | "SIDEWAYS";
}

interface Portfolio {
    totalValue: number;
    pnl24h: number;
    cashbalance: number;
    positions: {
        symbol: string;
        amount: number;
        entryPrice: number;
        highestPrice?: number; // New: High watermark for trailing stop
        reason?: string; // New: Why bought
        exitStrategy?: string; // New: Exit plan
    }[];
}

interface CrossChainShadowPosition {
    symbol: string;
    amount: number;
    entryPrice: number;
    highestPrice?: number;
    reason?: string;
    exitStrategy?: string;
    chain: "SOLANA";
    routeKind: "cross-chain";
    executionAddress?: string;
    updatedAt: number;
}

interface TradeExecutionMeta {
    chain?: "BNB" | "SOLANA";
    routeType?: "native" | "proxy" | "cross-chain";
    routeSource?: string;
    sourceToken?: string;
    destinationToken?: string;
    destinationChain?: "BNB" | "SOLANA";
    executionTarget?: string;
    positionSizeLabel?: StrategyPositionSize;
    tradeDecision?: "Selected" | "Half-size Eligible" | "Watchlist" | "Blocked";
    selectedReason?: string;
    autoTradeTarget?: boolean;
    regime?: StrategyRegime;
    triggerState?: StrategyTriggerState;
    triggerType?: StrategyTriggerType;
    score?: number;
    triggeredAt?: number;
    selectedAt?: number;
    exitReason?: StrategyExitReason;
    failureReason?: string;
    reviewApproved?: boolean;
    reviewReason?: string;
    reviewDetail?: string;
    reviewStrategy?: string;
    reviewExitPlan?: string;
}

type RemoteAiTradeReview = {
    source: string;
    approve: boolean;
    priorityScore: number;
    sizeMultiplier: number;
    entryAdjustmentPct: number;
    takeProfitAdjustmentPct: number;
    stopLossAdjustmentPct: number;
    holdMinutes: number;
    reason: string;
    detail: string;
    strategy: string;
    exitPlan: string;
};

type LiveReviewDecision = {
    pass: boolean;
    reason: string;
    detail: string;
    source: "rules" | "openai" | "cache" | "fallback";
    priorityScore?: number;
    sizeMultiplier?: number;
    entryAdjustmentPct?: number;
    takeProfitAdjustmentPct?: number;
    stopLossAdjustmentPct?: number;
    holdMinutes?: number;
    strategy?: string;
    exitPlan?: string;
};

type AutoTradeEmailCategory =
    | "buy-filled"
    | "sell-filled"
    | "failed"
    | "take-profit"
    | "stop-loss";

const AUTO_TRADE_NOTIFICATION_META: TradeExecutionMeta = {
    autoTradeTarget: true,
};

export interface CrossChainExecutionOrder {
    orderId: string;
    executionId: string;
    symbol: string;
    action: "BUY" | "SELL";
    status: "accepted" | "queued" | "submitted" | "success" | "failed" | "cancelled";
    routeType: "cross-chain";
    routeSource?: string;
    sourceToken?: string;
    destinationToken?: string;
    sourceChain?: "BNB" | "SOLANA";
    destinationChain?: "BNB" | "SOLANA";
    executionTarget?: string;
    txHash?: string;
    executionReceipt?: string;
    failureReason?: string;
    positionSizeLabel?: StrategyPositionSize;
    tradeDecision?: "Selected" | "Half-size Eligible" | "Watchlist" | "Blocked";
    selectedReason?: string;
    autoTradeTarget?: boolean;
    positionApplied?: boolean;
    exitManaged?: boolean;
    queuedAt?: number;
    submittedAt?: number;
    completedAt?: number;
    cancelledAt?: number;
    testMode?: boolean;
    testOutcome?: "success" | "failed" | "cancelled";
    createdAt: number;
    updatedAt: number;
}

export interface Transaction {
    id: string;
    agentId: string;
    type: "BUY" | "SELL";
    symbol: string; // Ensure symbol is here
    amount: number;
    price: number;
    timestamp: number;
    txHash: string;
    fee: number;
    pnl?: number;
    targetPrice?: number;
    pair?: string; // New: e.g. USDT-ETH(ETH)
    dex?: string; // New: e.g. Uniswap
    chain?: string; // New: e.g. Ethereum, Polygon
    feedback?: "GOOD" | "BAD";
    reason?: string;
    entryPrice?: number;
    plannedEntryMin?: number;
    plannedEntryMax?: number;
    plannedTakeProfit?: number;
    plannedStopLoss?: number;
    decisionSummary?: string;
    newsTitle?: string;
    routeType?: "native" | "proxy" | "cross-chain";
    routeSource?: string;
    sourceToken?: string;
    destinationToken?: string;
    destinationChain?: "BNB" | "SOLANA";
    executionTarget?: string;
    positionSizeLabel?: StrategyPositionSize;
    tradeDecision?: "Selected" | "Half-size Eligible" | "Watchlist" | "Blocked";
    selectedReason?: string;
    autoTradeTarget?: boolean;
    regime?: StrategyRegime;
    triggerState?: StrategyTriggerState;
    triggerType?: StrategyTriggerType;
    score?: number;
    orderId?: string;
    executionId?: string;
    triggeredAt?: number;
    selectedAt?: number;
    filledAt?: number;
    exitedAt?: number;
    exitReason?: StrategyExitReason;
    pnlPct?: number;
    success?: boolean;
    failureReason?: string;
    reviewReason?: string;
    reviewDetail?: string;
    reviewStrategy?: string;
    reviewExitPlan?: string;
}

export interface PricePoint {
    time: string;
    price: number;
    timestamp: number; // Unix seconds for chart continuity
}

export interface LearningParams {
    rsiWeight: number;
    macdWeight: number;
    sentimentWeight: number;
    securityWeight: number;
    fundamentalWeight: number;
    winRate: number;
    totalTrades: number;
}

export interface StrategyProposal {
    id: string;
    agentId: string;
    title: string;
    description: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | "ACTIVE";
    timestamp: number;
    dayKey?: string;
    durationBlock?: (typeof DAILY_STRATEGY_BLOCKS)[number];
    assetSymbol?: string;
    pairLabel?: string;
    basketItems?: {
        symbol: string;
        displaySymbol?: string;
        chain?: "BNB" | "SOLANA";
        weight: number;
        source?: "current" | "next";
    }[];
    symbolPlans?: {
        symbol: string;
        displaySymbol?: string;
        chain?: "BNB" | "SOLANA";
        executionChain?: "BNB" | "SOLANA";
        executionChainId?: number;
        executionAddress?: string;
        executionDecimals?: number;
        executionRouteKind?: "native" | "proxy" | "cross-chain";
        executionSource?: string;
        executionPairUrl?: string;
        weight: number;
        source?: "current" | "next";
        rank?: "A" | "B" | "C" | "D";
        mode?: "TREND" | "MEAN_REVERSION" | "SKIP";
        positionSizeMultiplier?: number;
        positionSizeLabel?: StrategyPositionSize;
        plannedEntryAt?: number;
        plannedExitAt?: number;
        entryMin: number;
        entryMax: number;
        plannedTakeProfit: number;
        plannedStopLoss: number;
        reasonTags?: string[];
        indicatorNotes?: string[];
        score?: number;
    }[];
    intradayPromoted?: {
        symbol: string;
        displaySymbol?: string;
        chain?: "BNB" | "SOLANA";
        triggerState?: "Ready" | "Armed" | "Triggered" | "Cooldown" | "Executed";
        triggerType?: string;
        regime?: "Trend" | "Range" | "No-trade";
        positionSizeLabel?: StrategyPositionSize;
        source?: "selected" | "armed" | "triggered";
        routeType?: "native" | "proxy" | "cross-chain";
        score?: number;
        reason?: string;
    }[];
    candidateSnapshots?: {
        symbol: string;
        displaySymbol?: string;
        chain?: "BNB" | "SOLANA";
        tier?: "core" | "secondary" | "experimental";
        price: number;
        marketScore?: number;
        score: number;
        rawScore: number;
        weightedScore: number;
        maxPossibleScore: number;
        status?: "Selected" | "Watchlist" | "Below Threshold" | "VETO Rejected" | "Correlation Rejected" | "Data Missing";
        executionStatus?: "Pass" | "VETO NG" | "Route Missing" | "Seed Fallback" | "Data Missing";
        tradeDecision?: "Selected" | "Half-size Eligible" | "Watchlist" | "Blocked";
        positionSizeMultiplier?: number;
        positionSizeLabel?: StrategyPositionSize;
        halfSizeEligible?: boolean;
        fullSizeEligible?: boolean;
        aHalfSizeEligible?: boolean;
        bHalfSizeEligible?: boolean;
        selectionEligible?: boolean;
        conditionalReferencePass?: boolean;
        relativeStrengthPercentile?: number;
        volumeConfirmed?: boolean;
        routeMissing?: boolean;
        seedFallback?: boolean;
        rrCheck?: boolean;
        rrStatus?: "OK" | "Weak" | "NG";
        resistanceStatus?: "Open" | "Tight" | "Blocked";
        halfSizeMinRr?: number;
        correlationRejected?: boolean;
        finalSelectedEligible?: boolean;
        finalRejectReason?: string;
        rank: "A" | "B" | "C" | "D";
        mode: "TREND" | "MEAN_REVERSION";
        correlationGroup: string;
        veto: boolean;
        vetoPass?: boolean;
        vetoReasons: string[];
        selectionStage?: "SELECTED" | "VETO" | "SCORE" | "CORRELATION" | "RESERVE";
        thresholdGap?: number;
        exclusionReason?: string;
        autoTradeExcludedReason?: string;
        mainReason?: string;
        reasonTags: string[];
        indicatorNotes: string[];
        scoreBreakdown: Record<string, number>;
        liquidity?: number;
        spreadBps?: number;
        historyBars?: number;
        dataCompleteness?: number;
        universeRankScore?: number;
        contractAddress?: string;
        dexPairUrl?: string;
        executionSupported?: boolean;
        executionChain?: "BNB" | "SOLANA";
        executionChainId?: number;
        executionAddress?: string;
        executionDecimals?: number;
        executionRouteKind?: "native" | "proxy" | "cross-chain";
        executionSource?: string;
        executionPairUrl?: string;
        executionLiquidityUsd?: number;
        executionVolume24hUsd?: number;
        executionTxns1h?: number;
        marketSource?: string;
        supportDistancePct: number;
        resistanceDistancePct: number;
        atrPct: number;
        volumeRatio: number;
        relativeStrengthScore: number;
        confidence: number;
    }[];
    selectionStats?: {
        rawUniverseCount?: number;
        universeCount: number;
        universeExcludedCount?: number;
        monitoredUniverseCount?: number;
        prefilterPassCount?: number;
        prefilterExcludedCount?: number;
        prefilterMode?: "Trend" | "Range";
        prefilterRescuedCount?: number;
        prefilterTargetMin?: number;
        marketDataPassCount: number;
        vetoCount: number;
        vetoPassCount: number;
        scoreCalculatedCount: number;
        thresholdScore: number;
        thresholdPassCount: number;
        fullSizeEligibleCount?: number;
        halfSizeEligibleCount?: number;
        finalSelectionEligibleCount?: number;
        scoreRejectedCount: number;
        correlationPassCount: number;
        correlationRejectedCount: number;
        finalSelectedCount: number;
        topUniverseAssets?: { symbol: string; displaySymbol?: string; chain?: "BNB" | "SOLANA"; tier: "core" | "secondary" | "experimental"; universeRankScore: number }[];
        experimentalTierAssets?: { symbol: string; displaySymbol?: string; chain?: "BNB" | "SOLANA"; universeRankScore: number }[];
        debug?: CycleDebugInfo;
    };
    settlementSymbol?: string;
    rankSummary?: string;
    mode?: "TREND" | "MEAN_REVERSION" | "MIXED";
    agentScenarios?: {
        agentId: "technical" | "sentiment" | "security" | "fundamental";
        title: string;
        summary: string;
    }[];
    proposedSettings?: {
        riskTolerance: number;
        stopLoss: number;
        takeProfit: number;
    }
}

export interface NewMuchChangedBlock {
    block: (typeof DAILY_STRATEGY_BLOCKS)[number];
    previousBasket: string;
    nextBasket: string;
    reason: string;
}

export interface NewMuchEvaluationChange {
    block: (typeof DAILY_STRATEGY_BLOCKS)[number];
    fixedBasket: string;
    fixedBasketEmpty?: boolean;
    topRanked: string[];
    nearMisses: string[];
    highlights: string[];
    intradayPromoted?: {
        symbol: string;
        displaySymbol?: string;
        chain?: "BNB" | "SOLANA";
        triggerState?: "Ready" | "Armed" | "Triggered" | "Cooldown" | "Executed";
        triggerType?: string;
        regime?: "Trend" | "Range" | "No-trade";
        positionSizeLabel?: StrategyPositionSize;
        source?: "selected" | "armed" | "triggered";
        routeType?: "native" | "proxy" | "cross-chain";
        score?: number;
        reason?: string;
    }[];
    summary: string;
}

export interface NewMuchUpdate {
    id: string;
    title: string;
    summary: string;
    createdAt: number;
    announcementSlot: string;
    kind: "daily-fixed" | "market-update";
    changedBlocks: NewMuchChangedBlock[];
    evaluationChanges: NewMuchEvaluationChange[];
    strategies: StrategyProposal[];
}

export interface WalletHoldingRow {
    symbol: string;
    displaySymbol?: string;
    address?: string;
    amount: number;
    usdValue: number;
    entryPrice: number;
    isStable: boolean;
    chain: "BNB" | "SOLANA";
    isGasReserve?: boolean;
}

export interface TradingPipeline {
    id: string;
    baseToken: string;
    targetToken: string;
    selectedDEXs: string[];
    isActive: boolean;
    lastPrice?: number;
}

interface RankedTokenCandidate {
    symbol: string;
    tier?: "core" | "secondary" | "experimental";
    score: number;
    change24h: number;
    price: number;
    volume: number;
    liquidity?: number;
    spreadBps?: number;
    historyBars?: number;
    dataCompleteness?: number;
    universeRankScore?: number;
    mode?: "TREND" | "MEAN_REVERSION";
    rank?: "A" | "B" | "C" | "D";
    status?: "Selected" | "Watchlist" | "Below Threshold" | "VETO Rejected" | "Correlation Rejected" | "Data Missing";
    veto?: boolean;
    vetoPass?: boolean;
    vetoReasons?: string[];
    mainReason?: string;
    reasonTags?: string[];
    indicatorNotes?: string[];
    scoreBreakdown?: Record<string, number>;
    plannedEntryAt?: number;
    plannedExitAt?: number;
    plannedEntryMin?: number;
    plannedEntryMax?: number;
    plannedTakeProfit?: number;
    plannedStopLoss?: number;
    settlementSymbol?: string;
    confidence?: number;
    supportDistancePct?: number;
    resistanceDistancePct?: number;
    atrPct?: number;
    volumeRatio?: number;
    relativeStrengthScore?: number;
    correlationGroup?: string;
    contractAddress?: string;
    dexPairUrl?: string;
    executionSupported?: boolean;
    marketSource?: string;
}

interface SymbolPriceSample {
    ts: number;
    price: number;
}

interface StrategyMarketQuote {
    price: number;
    volume: number;
    change24h?: number;
    updatedAt?: number;
    executionPriceUsd?: number;
    executionPriceUpdatedAt?: number;
    chain?: "BNB" | "SOLANA";
    displaySymbol?: string;
    liquidity?: number;
    spreadBps?: number;
    marketCap?: number;
    tokenAgeDays?: number;
    txns1h?: number;
    dexPairFound?: boolean;
    contractAddress?: string;
    dexPairUrl?: string;
    executionSupported?: boolean;
    executionChain?: "BNB" | "SOLANA";
    executionChainId?: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionSource?: string;
    executionPairUrl?: string;
    executionLiquidityUsd?: number;
    executionVolume24hUsd?: number;
    executionTxns1h?: number;
    source?: string;
}

interface TradeExecutionOverride {
    chain?: "BNB" | "SOLANA";
    chainId?: number;
    address?: string;
    decimals?: number;
    routeKind?: "native" | "proxy" | "cross-chain";
    source?: string;
}

interface ShortMomentumSignal {
    r1: number;
    r5: number;
    r15: number;
    r60: number;
    score: number;
    confidence: number;
}

interface CycleSelection {
    block: (typeof DAILY_STRATEGY_BLOCKS)[number];
    candidates: RankedTokenCandidate[];
    settlementSymbol?: string;
    mode?: "TREND" | "MEAN_REVERSION" | "MIXED";
    rankSummary: string;
}

interface SimulationContextType {
    // ... existing
    messages: Message[];
    isAuthenticated: boolean;
    setIsAuthenticated: (auth: boolean) => void;
    isSimulating: boolean;
    toggleSimulation: () => void;
    marketData: MarketData;
    allMarketData: Record<string, { price: number }>;
    convertJPY: (usd: number) => number;
    portfolio: Portfolio;
    agents: Agent[];
    activeStrategies: StrategyProposal[]; // Changed from single strategy string
    liveStrategyMonitor: ContinuousStrategyMonitor | null;
    strategyPerformanceStore: StrategyPerformanceStore;
    strategyPerformanceSummary: StrategyPerformanceSummary;
    // ... risk settings
    riskTolerance: number;
    setRiskTolerance: (level: number) => void;
    stopLossThreshold: number;
    setStopLossThreshold: (val: number) => void;
    takeProfitThreshold: number;
    setTakeProfitThreshold: (val: number) => void;
    isFlashEnabled: boolean;
    setIsFlashEnabled: (enabled: boolean) => void;
    transactions: Transaction[];
    priceHistory: PricePoint[];
    strategyProposals: StrategyProposal[];
    registerStrategyProposal: (proposal: StrategyProposal, activate?: boolean) => void;
    // Updated proposal actions
    updateProposalStatus: (id: string, status: "APPROVED" | "REJECTED" | "ACTIVE" | "PENDING") => void;
    deleteProposal: (id: string) => void;
    addUserMessage: (content: string) => void;
    aiPopupMessage: Message | null;
    closePopup: () => void;
    selectedCurrency: Currency;
    setSelectedCurrency: (c: Currency) => void;
    initialTradeSymbol: string;
    setInitialTradeSymbol: (s: string) => void;
    // ... existing new features
    proposalFrequency: ProposalFrequency;
    setProposalFrequency: (f: ProposalFrequency) => void;
    activeChains: Chain[];
    toggleChain: (c: Chain) => void;
    targetTop100: boolean;
    setTargetTop100: (b: boolean) => void;
    targetAllCurrencies: boolean;
    setTargetAllCurrencies: (b: boolean) => void;
    targetMemeCoins: boolean;
    setTargetMemeCoins: (b: boolean) => void;
    requestProposal: () => void;
    // Nickname
    nickname: string;
    setNickname: (name: string) => void;
    favorites: Set<string>;
    toggleFavorite: (id: string) => void;
    // Discussion history
    discussionHistory: DiscussionEntry[];
    addDiscussion: (entry: DiscussionEntry) => void;
    // Trade notifications
    tradeNotifications: TradeNotification[];
    dismissNotification: (id: string) => void;
    clearNotifications: () => void;
    crossChainOrders: CrossChainExecutionOrder[];
    // New: Wallet & Trade Execution
    isWalletConnected: boolean;
    executeTrade: (
        tokenSymbol: string,
        action: "BUY" | "SELL",
        amount: number,
        price: number,
        reason?: string,
        dex?: string,
        fundingSymbol?: string,
        executionOverride?: TradeExecutionOverride,
        tradeMeta?: TradeExecutionMeta,
    ) => Promise<boolean>;
    latestDiscussion: DiscussionResult | null;
    riskStatus: "SAFE" | "CAUTION" | "CRITICAL";
    atmosphere: "NEUTRAL" | "POSITIVE" | "NEGATIVE" | "ALERT";
    // Pipeline Management
    tradingPipelines: TradingPipeline[];
    addPipeline: (base: string, target: string, dexs: string[]) => void;
    removePipeline: (id: string) => void;
    togglePipeline: (id: string) => void;
    latestNews: MarketNews | null;
    awardExp: (agentId: string, amount: number) => void;
    disPoints: number;
    addDisPoints: (amount: number) => void;
    leaderboard: { name: string; score: number; dailyProfit: number; dailyChange: number; rank: number }[];
    isSoundEnabled: boolean;
    setIsSoundEnabled: (enabled: boolean) => void;
    achievements: Achievement[];
    unlockAchievement: (id: string) => void;
    updateAchievementProgress: (id: string, progress: number) => void;
    resetSimulation: () => void;
    clearMessages: () => void;
    // Demo Mode
    isDemoMode: boolean;
    setIsDemoMode: (val: boolean) => void;
    demoBalance: number;
    setDemoBalance: (val: number) => void;
    demoStrategy: DemoStrategy;
    setDemoStrategy: (val: DemoStrategy) => void;
    demoAddress: string;
    // Demo modal control (shared state so Header button and DemoModal can talk)
    showDemoModal: boolean;
    setShowDemoModal: (val: boolean) => void;
    // New: Start Fund Selection
    allowedStartTokens: string[];
    setAllowedStartTokens: (tokens: string[]) => void;
    startFixedDemo: (startingSymbol?: string, jpyPricePerUnit?: number) => void;
    // Learning & Tuning
    learningParams: LearningParams;
    provideTradeFeedback: (txId: string, feedback: "GOOD" | "BAD") => void;
    marketRegime: "TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE";
    addMessage: (sender: string, text: string, type?: "NORMAL" | "ALERT" | "EXECUTION" | "SYSTEM") => void;
    liveInitialBalance: number;
    walletHoldings: WalletHoldingRow[];
    solanaWalletAddress: string;
    setSolanaWalletAddress: (value: string) => void;
    solanaWalletSyncError: string | null;
    customBnbContracts: string[];
    registerCustomBnbContract: (value: string) => boolean;
    removeCustomBnbContract: (value: string) => void;
    customSolanaMints: string[];
    registerCustomSolanaMint: (value: string) => boolean;
    removeCustomSolanaMint: (value: string) => void;
    isMockConnected: boolean;
    mockAddress: string;
    toggleMockConnection: () => void;
    isAutoPilotEnabled: boolean;
    setIsAutoPilotEnabled: (val: boolean) => void;
    lastAutoPilotStatus: string;
    isPricingPaused: boolean;
    resumePricing: () => void;
    newMuchUpdates: NewMuchUpdate[];
    latestNewMuchUpdate: NewMuchUpdate | null;
    unreadNewMuchCount: number;
    markNewMuchRead: () => void;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

const DEFAULT_ACHIEVEMENTS: Achievement[] = [
    { id: "first-trade", title: "初回トレード", description: "最初のトレードを完了する", icon: Zap, unlocked: false, rarity: "COMMON" },
    { id: "profit-100", title: "利益達成", description: "累計利益 100 円以上を達成する", icon: TrendingUp, unlocked: false, rarity: "COMMON", progress: 0, target: 100 },
    { id: "risk-setup-done", title: "リスク設定完了", description: "リスク管理設定を反映する", icon: ShieldCheck, unlocked: false, rarity: "COMMON" },
    { id: "win-streak-3", title: "3連勝", description: "3 回連続で利益決済する", icon: Flame, unlocked: false, rarity: "RARE", progress: 0, target: 3 },
];

export function SimulationProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    // Wagmi Connection hook
    const { isConnected, address, chainId } = useAccount();
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();
    const { sendTransactionAsync } = useSendTransaction();
    const [isAuthenticated, setIsAuthenticatedState] = useState(false);

    /**
     * 繧ｦ繧ｩ繝ｬ繝・ヨ謗･邯壹ｒ逶｣隕悶＠縲∵磁邯夂峩蠕後↓繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ繝ｫ繝ｼ繝励ｒ襍ｷ蜍輔☆繧九・
     * isConnected 縺・false竊稚rue 縺ｫ螟牙喧縺励◆迸ｬ髢薙・縺ｿ螳溯｡鯉ｼ亥・遲画ｧ遒ｺ菫晢ｼ峨・
     */
    const prevConnectedRef = useRef<boolean>(false);
    const manualTestDoneRef = useRef<boolean>(false);
    // 荳譎ゅヵ繝ｩ繧ｰ・域悽逡ｪ縺ｧ縺ｮ繝・せ繝亥ｮ御ｺ・ｾ後↓蜑企勁縺吶ｋ・・
    const shouldFireOnceRef = useRef(true);
    const crossChainShadowPositionsRef = useRef<Record<string, CrossChainShadowPosition>>({});

    const [isSimulating, setIsSimulatingState] = useState(true);

    // Fetch live wallet native balance
    const { data: balanceData } = useBalance({
        address: address,
        chainId: chainId,
        query: { enabled: isConnected },
    });

    // Wrap setIsAuthenticated to update sessionStorage
    const setIsAuthenticated = (auth: boolean) => {
        setIsAuthenticatedState(auth);
        if (auth) {
            sessionStorage.setItem("jdex_auth", "true");
        } else {
            sessionStorage.removeItem("jdex_auth");
        }
    };

    useEffect(() => {
        const storedAuth = sessionStorage.getItem("jdex_auth");
        if (storedAuth === "true") {
            setIsAuthenticatedState(true);
        }
    }, []);

    useEffect(() => {
        const justConnected = isConnected && !prevConnectedRef.current;
        prevConnectedRef.current = isConnected;

        if (!justConnected) return;

        const IS_PROD = process.env.NODE_ENV === "production";

        // 螳溘ヨ繝ｬ繝ｼ繝峨ｒ譛牙柑蛹・
        setIsDemoMode(false);
        localStorage.removeItem("jdex_demo_mode"); // 謨ｴ蜷域ｧ遒ｺ菫昴・縺溘ａ遒ｺ螳溘↓蜑企勁

        console.log('[TRADE MODE]', {
            isConnected,
            demo: false,
        });

        if (!IS_PROD) {
            setIsAutoPilotEnabled(true);
        }

        // 繝ｫ繝ｼ繝励′譛ｪ襍ｷ蜍輔↑繧芽ｵｷ蜍・
        if (!isSimulating) {
            setIsSimulating(true);
        }
    }, [isConnected, isSimulating]);


    // On disconnect, stop simulation loop only.
    // Keep Auto-Pilot preference unchanged to avoid route-change flicker forcing OFF.
    useEffect(() => {
        if (!isConnected && isSimulating) {
            setIsSimulating(false);
        }
    }, [isConnected, isSimulating]);

    const [messages, setMessages] = useState<Message[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [crossChainOrders, setCrossChainOrders] = useState<CrossChainExecutionOrder[]>([]);
    const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
    const [strategyProposals, setStrategyProposals] = useState<StrategyProposal[]>([]);
    const [liveStrategyMonitor, setLiveStrategyMonitor] = useState<ContinuousStrategyMonitor | null>(null);
    const [strategyPerformanceStore, setStrategyPerformanceStore] = useState<StrategyPerformanceStore>(() => createEmptyStrategyPerformanceStore());
    const [newMuchUpdates, setNewMuchUpdates] = useState<NewMuchUpdate[]>([]);
    const [unreadNewMuchCount, setUnreadNewMuchCount] = useState(0);
    const [aiPopupMessage, setAiPopupMessage] = useState<Message | null>(null);
    const [selectedCurrency, setSelectedCurrency] = useState<Currency>("BNB");
    const [tradeInProgress, setTradeInProgress] = useState(false);
    const tradeExecutionLockRef = useRef(false);
    const lastTradeErrorTime = useRef<number>(0);
    const nextTradeAllowedAtRef = useRef<number>(0);
    const symbolCooldownRef = useRef<Record<string, number>>({});
    const [news, setNews] = useState<MarketNews[]>([]);
    const [lastAction, setLastAction] = useState<"BUY" | "SELL" | null>(null);
    const transactionsRef = useRef<Transaction[]>([]);
    const liveStrategyMonitorRef = useRef<ContinuousStrategyMonitor | null>(null);
    const strategyPerformanceStoreRef = useRef<StrategyPerformanceStore>(createEmptyStrategyPerformanceStore());
    const lastLiveStrategyMonitorRefreshRef = useRef<number>(0);
    const lastLiveCheckPayloadRef = useRef("");
    const lastLiveCheckSyncAtRef = useRef(0);
    const liveCheckSyncInFlightRef = useRef(false);
    const aiTradeReviewCacheRef = useRef<Record<string, { expiresAt: number; result: RemoteAiTradeReview | null }>>({});
    const lastAiAuditAtRef = useRef(0);
    const aiAuditInFlightRef = useRef(false);
    const lastAiRuntimeConfigSyncAtRef = useRef(0);
    const processedLossPostmortemIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!tradeInProgress) {
            tradeExecutionLockRef.current = false;
        }
    }, [tradeInProgress]);

    useEffect(() => {
        transactionsRef.current = transactions;
    }, [transactions]);

    useEffect(() => {
        crossChainOrdersRef.current = crossChainOrders;
    }, [crossChainOrders]);

    useEffect(() => {
        liveStrategyMonitorRef.current = liveStrategyMonitor;
    }, [liveStrategyMonitor]);

    useEffect(() => {
        strategyPerformanceStoreRef.current = strategyPerformanceStore;
    }, [strategyPerformanceStore]);

    const updateStrategyPerformanceStore = useCallback((updater: (previous: StrategyPerformanceStore) => StrategyPerformanceStore) => {
        setStrategyPerformanceStore((previous) => {
            const next = normalizeStrategyPerformanceStore(updater(previous));
            strategyPerformanceStoreRef.current = next;
            return next;
        });
    }, []);

    const strategyPerformanceSummary = useMemo(
        () => aggregateStrategyPerformance(strategyPerformanceStore, Date.now()),
        [strategyPerformanceStore],
    );

    const refreshAiImprovementRuntimeConfig = useCallback(async () => {
        if (typeof window === "undefined") return null;
        const now = Date.now();
        if (now - lastAiRuntimeConfigSyncAtRef.current < 60_000) return null;
        try {
            const response = await fetch("/api/ai/improvements/runtime-config", {
                method: "GET",
                cache: "no-store",
            });
            if (!response.ok) return null;
            const data = await response.json().catch(() => null);
            if (!data?.ok) return null;
            setRuntimeStrategyConfigOverrides((data.overrides || {}) as RuntimeStrategyConfigOverrides);
            if (data?.environment?.strategyMode || data?.strategyMode) {
                setStoredStrategyMode(normalizeStrategyMode(data.environment?.strategyMode || data.strategyMode));
            }
            lastAiRuntimeConfigSyncAtRef.current = now;
            return data;
        } catch (error) {
            console.error("[ai/improvements/runtime-config] Failed to refresh runtime overrides:", error);
            return null;
        }
    }, []);


    // Persist isSimulating
    const setIsSimulating = (val: boolean) => {
        setIsSimulatingState(val);
        localStorage.setItem("jdex_simulating", val.toString());
    };

    const toggleSimulation = () => setIsSimulating(!isSimulating);

    // New/Updated State
    const [activeStrategies, setActiveStrategies] = useState<StrategyProposal[]>([]);

    // ... (ProposalFrequency, activeChains etc same)
    const [proposalFrequency, setProposalFrequency] = useState<ProposalFrequency>("MEDIUM");
    const [activeChains, setActiveChains] = useState<Chain[]>(["BNB", "POLYGON"]);
    const [allowedStartTokens, setAllowedStartTokensState] = useState<string[]>(TRADE_CONFIG.ALLOWED_START_FUNDS);
    const [showDemoModal, setShowDemoModal] = useState(false);

    const [liveInitialBalance, setLiveInitialBalance] = useState<number>(0);
    const [liveWalletHoldings, setLiveWalletHoldings] = useState<WalletHoldingRow[]>([]);
    const [liveSolanaWalletHoldings, setLiveSolanaWalletHoldings] = useState<WalletHoldingRow[]>([]);
    const [solanaWalletAddressState, setSolanaWalletAddressState] = useState("");
    const [customBnbContracts, setCustomBnbContracts] = useState<string[]>([]);
    const [customSolanaMints, setCustomSolanaMints] = useState<string[]>([]);
    const [solanaWalletSyncError, setSolanaWalletSyncError] = useState<string | null>(null);
    const liveInitialBalanceStorageKey = getLiveInitialBalanceStorageKey(address, chainId);
    const liveCrossChainOrdersStorageKey = address ? `jdex_cross_chain_orders_${address.toLowerCase()}` : null;

    useEffect(() => {
        if (typeof window === "undefined") return;

        if (!liveInitialBalanceStorageKey) {
            setLiveInitialBalance(0);
            return;
        }

        const storedLiveInit = localStorage.getItem(liveInitialBalanceStorageKey);
        const parsed = storedLiveInit ? parseFloat(storedLiveInit) : 0;
        setLiveInitialBalance(Number.isFinite(parsed) ? parsed : 0);
    }, [liveInitialBalanceStorageKey]);

    const setAllowedStartTokens = (tokens: string[]) => {
        setAllowedStartTokensState(tokens);
        localStorage.setItem("jdex_allowed_start_tokens", JSON.stringify(tokens));
    };
    const [targetTop100, setTargetTop100] = useState(false);
    const [targetAllCurrencies, setTargetAllCurrencies] = useState(true);
    const [targetMemeCoins, setTargetMemeCoins] = useState(false);
    const [forceProposal, setForceProposal] = useState(false);

    // Nickname
    const [nickname, setNicknameState] = useState("");
    useEffect(() => {
        const stored = localStorage.getItem("jdex_nickname");
        if (stored) setNicknameState(stored);
    }, []);
    const setNickname = (name: string) => {
        setNicknameState(name);
        localStorage.setItem("jdex_nickname", name);
    };

    // Discussion history
    const [discussionHistory, setDiscussionHistory] = useState<DiscussionEntry[]>([]);
    const addDiscussion = (entry: any) => {
        setDiscussionHistory(prev => [entry as DiscussionEntry, ...prev].slice(0, 50));

        // Auto-sync to strategy proposals if result exists
        if (entry.result) {
            const normalizedPair = normalizeToUSDTPair(entry.pair);
            const assetSymbol = normalizeTrackedSymbol(normalizedPair.split("/")[0] || entry.pair);
            const baseRiskTolerance = entry.result.confidence >= 80 ? 5 : entry.result.confidence >= 60 ? 3 : 2;
            const proposals: StrategyProposal[] = DAILY_STRATEGY_BLOCKS.map((block, index) => ({
                id: `strat-${entry.id}-${index}`,
                agentId: "coordinator",
                title: `${assetSymbol} 日次戦略 ${block}`,
                description: getStrategyBlockDescription(
                    block,
                    assetSymbol,
                    entry.result.action,
                    entry.result.reasoning,
                ),
                status: "PENDING",
                timestamp: Date.now() + index,
                durationBlock: block,
                assetSymbol,
                pairLabel: normalizedPair,
                proposedSettings: {
                    riskTolerance: Math.max(1, Math.min(5, baseRiskTolerance + (index === 1 ? 1 : index === 3 ? -1 : 0))),
                    stopLoss: entry.result.stopLoss || -3,
                    takeProfit: entry.result.takeProfit || 5,
                },
            }));

            setStrategyProposals(prev => {
                const filtered = prev.filter((proposal) => !proposal.id.startsWith(`strat-${entry.id}-`));
                return [...proposals, ...filtered].slice(0, 24);
            });
        }
    };

    // Trade notifications
    const [tradeNotifications, setTradeNotifications] = useState<TradeNotification[]>([]);
    const [latestDiscussion, setLatestDiscussion] = useState<DiscussionResult | null>(null);
    const [riskStatus, setRiskStatus] = useState<"SAFE" | "CAUTION" | "CRITICAL">("SAFE");
    const [tradingPipelines, setTradingPipelines] = useState<TradingPipeline[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [latestNews, setLatestNews] = useState<MarketNews | null>(null);
    const [isSoundEnabled, setIsSoundEnabledState] = useState(() => {
        if (typeof window === "undefined") return false;
        return localStorage.getItem("jdex_sound_enabled") === "true";
    });
    const [atmosphere, setAtmosphere] = useState<"NEUTRAL" | "POSITIVE" | "NEGATIVE" | "ALERT">("NEUTRAL");
    const [achievements, setAchievements] = useState<Achievement[]>(DEFAULT_ACHIEVEMENTS);
    const [disPoints, setDisPoints] = useState(0);
    const [leaderboard, setLeaderboard] = useState<{ name: string; score: number; dailyProfit: number; dailyChange: number; rank: number }[]>([]);
    const crossChainOrdersRef = useRef<CrossChainExecutionOrder[]>([]);

    // Demo Mode State
    const [isDemoMode, setIsDemoModeState] = useState(false);
    const [demoBalance, setDemoBalanceState] = useState(0);
    const [demoAddress] = useState("demo-" + Math.random().toString(36).substring(2, 10));

    const [demoStrategy, setDemoStrategyState] = useState<DemoStrategy>("MODERATE");

    const setIsDemoMode = (val: boolean) => {
        setIsDemoModeState(val);
        localStorage.setItem("jdex_demo_mode", val.toString());
    };

    const setDemoStrategy = (val: DemoStrategy) => {
        setDemoStrategyState(val);
        localStorage.setItem("jdex_demo_strategy", val);
    };

    const [isAutoPilotEnabled, setIsAutoPilotEnabledState] = useState(false);
    const [lastAutoPilotStatus, setLastAutoPilotStatus] = useState("");

    useEffect(() => {
        const stored = localStorage.getItem("jdex_autopilot_enabled");
        if (stored !== null) setIsAutoPilotEnabledState(stored === "true");
    }, []);

    const setIsAutoPilotEnabled = (val: boolean) => {
        setIsAutoPilotEnabledState(val);
        localStorage.setItem("jdex_autopilot_enabled", val.toString());
    };

    const NEWMUCH_STORAGE_KEY = "jdex_newmuch_updates_v5";
    const NEWMUCH_READ_KEY = "jdex_newmuch_read_v5";

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const stored = localStorage.getItem(NEWMUCH_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as Partial<NewMuchUpdate>[];
                const filtered: NewMuchUpdate[] = Array.isArray(parsed)
                    ? parsed
                        .filter((entry) => entry && typeof entry.id === "string" && typeof entry.createdAt === "number")
                        .map((entry) => ({
                            id: String(entry.id),
                            title: String(entry.title || "NewMuch"),
                            summary: String(entry.summary || ""),
                            createdAt: Number(entry.createdAt || Date.now()),
                            announcementSlot: String(entry.announcementSlot || formatJstTimeLabel(Date.now())),
                            kind: (entry.kind === "market-update" ? "market-update" : "daily-fixed") as "daily-fixed" | "market-update",
                            changedBlocks: Array.isArray(entry.changedBlocks) ? entry.changedBlocks as NewMuchChangedBlock[] : [],
                            evaluationChanges: Array.isArray(entry.evaluationChanges) ? entry.evaluationChanges as NewMuchEvaluationChange[] : [],
                            strategies: Array.isArray(entry.strategies) ? normalizeStoredStrategies(entry.strategies as StrategyProposal[]) : [],
                        }))
                    : [];
                setNewMuchUpdates(normalizeNewMuchFeed(filtered));
            }
            const unread = Number(localStorage.getItem(NEWMUCH_READ_KEY) || "0");
            setUnreadNewMuchCount(Number.isFinite(unread) ? unread : 0);
        } catch {
            setNewMuchUpdates([]);
            setUnreadNewMuchCount(0);
            try {
                localStorage.removeItem(NEWMUCH_STORAGE_KEY);
            } catch {}
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        persistNewMuchUpdatesSafely(newMuchUpdates.slice(0, 20), NEWMUCH_STORAGE_KEY);
    }, [newMuchUpdates]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const stored = localStorage.getItem(STRATEGY_PERFORMANCE_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored);
            const normalized = normalizeStrategyPerformanceStore(parsed);
            setStrategyPerformanceStore(normalized);
            strategyPerformanceStoreRef.current = normalized;
        } catch {
            setStrategyPerformanceStore(createEmptyStrategyPerformanceStore());
            strategyPerformanceStoreRef.current = createEmptyStrategyPerformanceStore();
            try {
                localStorage.removeItem(STRATEGY_PERFORMANCE_STORAGE_KEY);
            } catch {}
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        persistStrategyPerformanceSafely(strategyPerformanceStore);
    }, [strategyPerformanceStore]);

    useEffect(() => {
        if (strategyPerformanceStore.executionEvents.length > 0 || transactions.length === 0) return;
        updateStrategyPerformanceStore((previousStore) => {
            let nextStore = previousStore;
            transactions
                .slice()
                .reverse()
                .forEach((tx) => {
                    nextStore = appendStrategyExecutionEvent(nextStore, {
                        id: `tx-fill:${tx.id}`,
                        kind: "fill",
                        action: tx.type,
                        timestamp: tx.timestamp,
                        symbol: normalizeTrackedSymbol(tx.symbol),
                        chain: resolveHoldingChain(tx.symbol, tx.destinationChain || (tx.chain?.toUpperCase().includes("SOL") ? "SOLANA" : undefined)),
                        routeType: (tx.routeType || "unknown") as StrategyRouteType,
                        regime: tx.regime || "No-trade",
                        score: Number(tx.score || 0),
                        triggerState: tx.triggerState || "Ready",
                        triggerType: tx.triggerType || "None",
                        decision: (tx.tradeDecision || "Blocked") as StrategyDecision,
                        positionSize: (tx.positionSizeLabel || "0x") as StrategyPositionSize,
                        orderId: tx.orderId,
                        executionId: tx.executionId,
                        triggeredAt: tx.triggeredAt,
                        selectedAt: tx.selectedAt,
                        filledAt: tx.filledAt || (tx.type === "BUY" ? tx.timestamp : undefined),
                        exitedAt: tx.exitedAt || (tx.type === "SELL" ? tx.timestamp : undefined),
                        exitReason: tx.exitReason || (tx.type === "SELL" ? deriveExitReason(tx.reason, tx.failureReason) : undefined),
                        pnl: tx.pnl,
                        pnlPct: tx.pnlPct,
                        success: tx.success ?? true,
                        failureReason: tx.failureReason,
                    });
                });
            return nextStore;
        });
    }, [strategyPerformanceStore.executionEvents.length, transactions, updateStrategyPerformanceStore]);

    const latestNewMuchUpdate = newMuchUpdates[0] || null;

    const pushNewMuchUpdate = useCallback((update: NewMuchUpdate) => {
        setNewMuchUpdates((prev) => normalizeNewMuchFeed([update, ...prev.filter((entry) => entry.id !== update.id)]));
        setUnreadNewMuchCount((prev) => {
            const next = prev + 1;
            if (typeof window !== "undefined") {
                localStorage.setItem(NEWMUCH_READ_KEY, String(next));
            }
            return next;
        });
    }, []);

    const markNewMuchRead = useCallback(() => {
        setUnreadNewMuchCount(0);
        if (typeof window !== "undefined") {
            localStorage.setItem(NEWMUCH_READ_KEY, "0");
        }
    }, []);

    const setDemoBalance = (val: number) => {
        setDemoBalanceState(val);
        localStorage.setItem("jdex_demo_balance", val.toString());

        // Comprehensive reset for Demo Mode
        // Note: We reset even if isDemoMode is not yet true because this is often called just before setIsDemoMode(true)
        const newPortfolio = {
            totalValue: val,
            pnl24h: 0,
            cashbalance: val,
            positions: []
        };
        setPortfolio(newPortfolio);
        localStorage.setItem("jdex_portfolio", JSON.stringify(newPortfolio));
        setTransactions([]);
        setMessages([]);
        setTradeNotifications([]);
        setDiscussionHistory([]);
        setPriceHistory([]);
        setHasInitialTradeExecuted(false);

        // Clear persistence (except portfolio which we just set)
        localStorage.removeItem("jdex_price_history");
    };

    // --- MOCK CONNECTION FOR DEV/TESTING ---
    const [isMockConnected, setIsMockConnected] = useState(false);
    const mockAddress = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"; // Standard mock address

    const toggleMockConnection = () => {
        setIsMockConnected(prev => !prev);
    };

    // Effective connection status (Real or Mock)
    const effectiveIsConnected = isConnected || isMockConnected;
    const effectiveAddress = address || (isMockConnected ? mockAddress : undefined);
    const effectiveChainId = chainId || (isMockConnected ? 56 : undefined); // Default to BSC for mock
    const getLiveOwnerId = useCallback(() => (
        effectiveAddress ? `${effectiveChainId || 0}:${effectiveAddress.toLowerCase()}` : "public"
    ), [effectiveAddress, effectiveChainId]);
    const liveTransactionsStorageKey = effectiveAddress ? `jdex_live_transactions_${effectiveAddress.toLowerCase()}` : null;
    const solanaWalletAddress = solanaWalletAddressState;
    const setSolanaWalletAddress = useCallback((value: string) => {
        const normalized = normalizeSolanaWalletAddress(value);
        setSolanaWalletAddressState(normalized);
        if (typeof window === "undefined") return;
        if (normalized) localStorage.setItem(SOLANA_WALLET_ADDRESS_STORAGE_KEY, normalized);
        else localStorage.removeItem(SOLANA_WALLET_ADDRESS_STORAGE_KEY);
    }, []);
    const registerCustomBnbContract = useCallback((value: string) => {
        const normalized = normalizeCustomBnbContract(value);
        if (!normalized) return false;
        setCustomBnbContracts((prev) => {
            const next = uniqueStrings([...prev, normalized]);
            if (typeof window !== "undefined") {
                localStorage.setItem(CUSTOM_BNB_CONTRACTS_STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        });
        return true;
    }, []);
    const removeCustomBnbContract = useCallback((value: string) => {
        const normalized = normalizeCustomBnbContract(value);
        if (!normalized) return;
        setCustomBnbContracts((prev) => {
            const next = prev.filter((entry) => entry !== normalized);
            if (typeof window !== "undefined") {
                localStorage.setItem(CUSTOM_BNB_CONTRACTS_STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        });
    }, []);
    const registerCustomSolanaMint = useCallback((value: string) => {
        const normalized = normalizeCustomSolanaMint(value);
        if (!normalized) return false;
        setCustomSolanaMints((prev) => {
            const next = uniqueStrings([...prev, normalized]);
            if (typeof window !== "undefined") {
                localStorage.setItem(CUSTOM_SOLANA_MINTS_STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        });
        return true;
    }, []);
    const removeCustomSolanaMint = useCallback((value: string) => {
        const normalized = normalizeCustomSolanaMint(value);
        if (!normalized) return;
        setCustomSolanaMints((prev) => {
            const next = prev.filter((entry) => entry !== normalized);
            if (typeof window !== "undefined") {
                localStorage.setItem(CUSTOM_SOLANA_MINTS_STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        });
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const stored = normalizeSolanaWalletAddress(localStorage.getItem(SOLANA_WALLET_ADDRESS_STORAGE_KEY));
        if (stored) {
            setSolanaWalletAddressState(stored);
        }
        try {
            const storedBnbContracts = JSON.parse(localStorage.getItem(CUSTOM_BNB_CONTRACTS_STORAGE_KEY) || "[]");
            if (Array.isArray(storedBnbContracts)) {
                setCustomBnbContracts(uniqueStrings(storedBnbContracts.map((entry) => normalizeCustomBnbContract(String(entry))).filter(Boolean) as string[]));
            }
        } catch {
            setCustomBnbContracts([]);
        }
        try {
            const storedSolanaMints = JSON.parse(localStorage.getItem(CUSTOM_SOLANA_MINTS_STORAGE_KEY) || "[]");
            if (Array.isArray(storedSolanaMints)) {
                setCustomSolanaMints(uniqueStrings(storedSolanaMints.map((entry) => normalizeCustomSolanaMint(String(entry))).filter(Boolean) as string[]));
            }
        } catch {
            setCustomSolanaMints([]);
        }
    }, []);

    useEffect(() => {
        void refreshAiImprovementRuntimeConfig();
        const timer = setInterval(() => {
            void refreshAiImprovementRuntimeConfig();
        }, STRATEGY_CONFIG.AUTO_TRADE_REVIEW_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [refreshAiImprovementRuntimeConfig]);


    useEffect(() => {
        if (typeof window === "undefined") return;
        const pathname = window.location.pathname || "";
        if (!pathname.startsWith("/strategy") && !pathname.startsWith("/newmuch")) return;
        if (!liveStrategyMonitor) return;

        const latestFixedUpdate = newMuchUpdates.find((entry) => entry.kind === "daily-fixed") || null;
        const latestEvaluationUpdate = newMuchUpdates.find((entry) => entry.kind === "market-update") || null;
        const selectedRows = liveStrategyMonitor.selected.slice(0, 8);
        const orderArmedRows = liveStrategyMonitor.candidates.filter((candidate) => candidate.orderGateStatus === "armed").slice(0, 8);
        const blockedRows = liveStrategyMonitor.candidates.filter((candidate) => candidate.autoTradeTarget && candidate.orderGateStatus !== "armed").slice(0, 8);
        const probationRows = liveStrategyMonitor.candidates.filter((candidate) =>
            candidate.positionSizeLabel === "0.2x"
            && (candidate.probationaryEligible || candidate.selectionEligible || candidate.autoTradeTarget),
        ).slice(0, 8);
        const intradayPromoted = summarizeIntradayPromoted(latestEvaluationUpdate);
        const ownerId = getLiveOwnerId();
        const snapshot = {
            syncedAt: Date.now(),
            liveMonitor: {
                monitoredAt: liveStrategyMonitor.monitoredAt,
                currentBlock: liveStrategyMonitor.currentBlock,
                selectedBasketCap: liveStrategyMonitor.stats.selectedBasketCap,
                prefilterMode: liveStrategyMonitor.stats.prefilterMode,
                prefilterPassCount: liveStrategyMonitor.stats.prefilterPassCount,
                selectionEligibleCount: liveStrategyMonitor.stats.selectionEligibleCount,
                selectedCount: liveStrategyMonitor.stats.selectedCount,
                orderArmedCount: liveStrategyMonitor.stats.orderArmedCount,
                selectedOrderBlockedCount: liveStrategyMonitor.stats.selectedOrderBlockedCount,
                finalAlignmentWaitCount: liveStrategyMonitor.stats.finalAlignmentWaitCount,
                waitingForSlotCount: liveStrategyMonitor.stats.waitingForSlotCount,
                probationaryCount: liveStrategyMonitor.stats.probationaryCount,
                triggeredCount: liveStrategyMonitor.stats.triggeredCount,
                readyCount: liveStrategyMonitor.stats.readyCount,
                armedCount: liveStrategyMonitor.stats.armedCount,
                ordersTodayCount: liveStrategyMonitor.stats.ordersTodayCount,
                selectedByChain: countLiveCheckRowsByChain(selectedRows),
                orderArmedByChain: countLiveCheckRowsByChain(orderArmedRows),
                probationByChain: countLiveCheckRowsByChain(probationRows),
                selectedRows: selectedRows.map(toLiveCheckRow),
                orderArmedRows: orderArmedRows.map(toLiveCheckRow),
                blockedRows: blockedRows.map(toLiveCheckRow),
                probationRows: probationRows.map(toLiveCheckRow),
                topBlockers: liveStrategyMonitor.stats.selectedOrderBlockedReasons?.slice(0, 5) || [],
            },
            newMuch: {
                latestFixedSlot: latestFixedUpdate?.announcementSlot || null,
                latestFixedAt: latestFixedUpdate?.createdAt || null,
                latestEvaluationSlot: latestEvaluationUpdate?.announcementSlot || null,
                latestEvaluationAt: latestEvaluationUpdate?.createdAt || null,
                latestIntradayPromotedCount: intradayPromoted.count,
                latestIntradayPromotedSymbols: intradayPromoted.symbols,
            },
            runtime: {
                lastAutoPilotStatus: lastAutoPilotStatus || null,
                isAutoPilotEnabled,
                isSimulating,
                isDemoMode,
                walletConnected: effectiveIsConnected,
            },
        };
        const serialized = JSON.stringify(snapshot);
        const now = Date.now();
        if (
            serialized === lastLiveCheckPayloadRef.current
            && now - lastLiveCheckSyncAtRef.current < STRATEGY_CONFIG.AUTO_TRADE_REVIEW_INTERVAL_MS
        ) {
            return;
        }
        if (liveCheckSyncInFlightRef.current) return;

        liveCheckSyncInFlightRef.current = true;
        void fetch("/api/strategy/live-check", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                ownerId,
                walletAddress: effectiveAddress || solanaWalletAddress || null,
                chainId: effectiveChainId || null,
                snapshot,
            }),
            keepalive: true,
        })
            .then((response) => {
                if (!response.ok) return null;
                lastLiveCheckPayloadRef.current = serialized;
                lastLiveCheckSyncAtRef.current = now;
                return response.json().catch(() => null);
            })
            .catch((error) => {
                console.error("[strategy/live-check] Failed to sync browser snapshot:", error);
            })
            .finally(() => {
                liveCheckSyncInFlightRef.current = false;
            });
    }, [
        liveStrategyMonitor,
        newMuchUpdates,
        lastAutoPilotStatus,
        isAutoPilotEnabled,
        isSimulating,
        isDemoMode,
        effectiveIsConnected,
        effectiveAddress,
        effectiveChainId,
        getLiveOwnerId,
        solanaWalletAddress,
    ]);

    const startFixedDemo = (startingSymbol: string = "BNB", jpyPricePerUnit?: number) => {
        const demoFundKey = Object.keys(TRADE_CONFIG.DEMO_FUNDS).find(
            (key) => (TRADE_CONFIG.DEMO_FUNDS as any)[key].symbol === startingSymbol
        );
        const demoFundConfig = demoFundKey
            ? (TRADE_CONFIG.DEMO_FUNDS as any)[demoFundKey]
            : { symbol: startingSymbol, amount: 100 };

        const amount = demoFundConfig.amount;
        const fallbackPriceData = allMarketPrices[startingSymbol] || initialData[startingSymbol];
        const usdPrice =
            jpyPricePerUnit && jpyPricePerUnit > 0
                ? jpyPricePerUnit / 155
                : fallbackPriceData
                    ? fallbackPriceData.price
                    : TRADE_CONFIG.STABLECOINS.includes(startingSymbol)
                        ? 1
                        : 0;

        const totalValUSD = usdPrice * amount;
        const isStable = TRADE_CONFIG.STABLECOINS.includes(startingSymbol);
        const initialPositions = isStable
            ? []
            : [{
                symbol: startingSymbol,
                amount,
                entryPrice: usdPrice,
                highestPrice: usdPrice,
            }];
        const initialCash = isStable ? totalValUSD : 0;

        setIsDemoModeState(true);
        localStorage.setItem("jdex_demo_mode", "true");

        const newPortfolio: Portfolio = {
            totalValue: totalValUSD,
            pnl24h: 0,
            cashbalance: initialCash,
            positions: initialPositions,
        };

        setPortfolio(newPortfolio);
        localStorage.setItem("jdex_portfolio", JSON.stringify(newPortfolio));
        setDemoBalanceState(newPortfolio.totalValue);
        localStorage.setItem("jdex_demo_balance", newPortfolio.totalValue.toString());

        setTransactions([]);
        setMessages([]);
        setTradeNotifications([]);
        setDiscussionHistory([]);
        setPriceHistory([]);
        setHasInitialTradeExecuted(true);

        const tokens = TRADE_CONFIG.ALLOWED_START_FUNDS;
        setAllowedStartTokensState(tokens);
        localStorage.setItem("jdex_allowed_start_tokens", JSON.stringify(tokens));
        localStorage.removeItem("jdex_transactions");
        localStorage.removeItem("jdex_chat_history");
        localStorage.removeItem("jdex_price_history");

        addMessage("coordinator", "固定資産デモモードを開始しました。初期資産: " + amount + " " + startingSymbol, "SYSTEM");

        setSelectedCurrency(startingSymbol as Currency);
        if (fallbackPriceData) {
            setMarketData((prev) => ({
                ...prev,
                price: fallbackPriceData.price,
                volume: fallbackPriceData.volume,
            }));
        }
    };

    const { playSuccess, playNotification, playAlert, playTrade } = useSoundFX();
    const setIsSoundEnabled = useCallback((enabled: boolean) => {
        setIsSoundEnabledState(enabled);
        localStorage.setItem("jdex_sound_enabled", String(enabled));
        if (enabled) {
            playNotification();
        }
    }, [playNotification]);
    const agents = AGENTS;
    const updateAgent = useCallback((_agentId?: string, _updates?: Record<string, unknown>) => { }, []);
    const evolveAgent = useCallback(async (_agentId?: string, _newsArr?: MarketNews[]) => { }, []);
    const addLearningEvent = useCallback((_event?: Record<string, unknown>) => { }, []);

    useEffect(() => {
        const storedPoints = localStorage.getItem("jdex_dis_points");
        if (storedPoints) setDisPoints(parseInt(storedPoints));
    }, []);

    const addDisPoints = (amount: number) => {
        setDisPoints(prev => {
            const next = prev + amount;
            localStorage.setItem("jdex_dis_points", next.toString());
            return next;
        });
    };


    const saveFavorites = (favs: Set<string>) => {
        setFavorites(favs);
        localStorage.setItem("jdex_favorites", JSON.stringify(Array.from(favs)));
    };

    const toggleFavorite = (id: string) => {
        const next = new Set(favorites);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        saveFavorites(next);
    };

    const savePipelines = (pipelines: TradingPipeline[]) => {
        setTradingPipelines(pipelines);
        localStorage.setItem("jdex_pipelines", JSON.stringify(pipelines));
    };

    const addPipeline = (base: string, target: string, dexs: string[]) => {
        const newPipeline: TradingPipeline = {
            id: Math.random().toString(36).substring(7),
            baseToken: base.toUpperCase(),
            targetToken: target.toUpperCase(),
            selectedDEXs: dexs,
            isActive: true
        };
        const next = [...tradingPipelines, newPipeline];
        savePipelines(next);
        addMessage("SYSTEM", "パイプライン追加: " + newPipeline.baseToken + "/" + newPipeline.targetToken + " (" + dexs.join(", ") + ")", "SYSTEM");
    };

    const removePipeline = (id: string) => {
        const next = tradingPipelines.filter(p => p.id !== id);
        savePipelines(next);
    };

    const clearMessages = () => {
        setMessages([]);
        localStorage.removeItem("jdex_chat_history");
    };

    const awardExp = async (agentId: string, amount: number) => {
        const agent = agents.find(a => a.id === agentId);
        if (!agent) return;

        const newExp = (agent.exp || 0) + amount;
        const currentLevel = agent.level || 1;
        const nextLevelExp = currentLevel * 100;
        let newLevel = currentLevel;

        if (newExp >= nextLevelExp) {
            newLevel += 1;
            addMessage("coordinator", agent.name + " の内部設定を更新しました。Lv." + newLevel + " に到達しています。", "SYSTEM");

            // Trigger Evolution
            const newsArr = latestNews ? [latestNews] : [];
            await evolveAgent(agentId, newsArr);
        }

        updateAgent(agentId, { exp: newExp, level: newLevel });
    };

    const triggerLearningPulse = useCallback((news?: MarketNews) => {
        // Pick a relevant agent for the news, or random
        let agentId = agents[Math.floor(Math.random() * agents.length)].id;

        if (news) {
            if (news.category === "REAL" || news.source === "X") agentId = "sentiment";
            else if (news.category === "SECURITY") agentId = "security";
        }

        const topics = ["市場構造の理解", "アルゴリズム最適化", "ナラティブ分析", "リスク管理の更新"];
        const topic = topics[Math.floor(Math.random() * topics.length)];

        addLearningEvent({
            agentId,
            topic,
            content: news
                ? news.title + " をもとに、関連知識をアップデートしました。"
                : "市場データから新しいパターンを抽出しました。",
        });

        awardExp(agentId, 25);
    }, [agents, latestNews, evolveAgent, addLearningEvent]);

    const togglePipeline = (id: string) => {
        const next = tradingPipelines.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p);
        savePipelines(next);
    };

    const dismissNotification = (id: string) => {
        setTradeNotifications(prev => prev.filter(n => n.id !== id));
    };

    const clearNotifications = () => {
        setTradeNotifications([]);
    };

    const enqueueTradeNotification = ({
        action,
        symbol,
        venue,
        amount,
        notionalUsd,
        autoTradeTarget,
    }: {
        action: "BUY" | "SELL";
        symbol: string;
        venue: string;
        amount: number;
        notionalUsd: number;
        autoTradeTarget?: boolean;
    }) => {
        if (!autoTradeTarget) return;
        const actionLabel = action === "BUY" ? "購入" : "売却";
        setTradeNotifications((prev) => [
            {
                id: Math.random().toString(36).substring(7),
                agentId: "manager",
                agentName: "AI AUTO TRADE",
                title: `自動売買で${actionLabel}を実行`,
                message: `${venue} で ${amount.toFixed(4)} ${symbol} を ¥${convertJPY(Math.max(notionalUsd, 0)).toLocaleString("ja-JP", { maximumFractionDigits: 0 })} で${actionLabel}しました。`,
                type: action,
                symbol,
                timestamp: Date.now(),
                autoTradeTarget: true,
            },
            ...prev,
        ].slice(0, 50));
    };

    const sendAutoTradeEmailNotification = async ({
        category,
        symbol,
        displaySymbol,
        chain,
        venue,
        entryPriceUsd,
        finalPriceUsd,
        pnlUsd,
        txHash,
        executionTarget,
        reason,
        positionSizeLabel,
    }: {
        category: AutoTradeEmailCategory;
        symbol: string;
        displaySymbol?: string;
        chain?: string;
        venue?: string;
        entryPriceUsd?: number;
        finalPriceUsd?: number;
        pnlUsd?: number;
        txHash?: string;
        executionTarget?: string;
        reason?: string;
        positionSizeLabel?: string;
    }) => {
        if (!user?.email) return;

        const categoryLabelMap: Record<AutoTradeEmailCategory, string> = {
            "buy-filled": "BUY 約定",
            "sell-filled": "SELL 約定",
            failed: "失敗",
            "take-profit": "利確",
            "stop-loss": "損切り",
        };

        const formatMailPrice = (usd?: number) => {
            if (!Number.isFinite(usd) || Number(usd) <= 0) return "未確定";
            const numeric = Number(usd);
            const jpy = numeric * jpyRate;
            return `¥${Math.round(jpy).toLocaleString("ja-JP")} (${numeric.toFixed(6)} USD)`;
        };

        const entryLabel = formatMailPrice(entryPriceUsd);
        const finalLabel = formatMailPrice(finalPriceUsd);
        const pnlLabel =
            Number.isFinite(pnlUsd)
                ? `¥${Math.round(Number(pnlUsd) * jpyRate).toLocaleString("ja-JP")} (${Number(pnlUsd).toFixed(6)} USD)`
                : "未確定";

        const normalizedTarget = normalizeExecutionTarget(executionTarget);
        const resolvedDisplaySymbol =
            getProxyExecutionAssetLabel(normalizedTarget)
            || String(displaySymbol || symbol || "").replace(/\.SOL$/i, "").trim()
            || "未設定";

        const subject = `[DIS TERMINAL] 自動売買 ${categoryLabelMap[category]}: ${resolvedDisplaySymbol}`;
        const lines = [
            `種別: ${categoryLabelMap[category]}`,
            `通貨: ${resolvedDisplaySymbol}`,
            `チェーン: ${chain || "未設定"}`,
            `ルート: ${venue || "自動判定"}`,
            `ロット: ${positionSizeLabel || "未設定"}`,
            `エントリー価格: ${entryLabel}`,
            `最終売却価格: ${finalLabel}`,
            `損益価格: ${pnlLabel}`,
            `理由: ${reason || "自動売買フローに基づく実行"}`,
            `Tx Hash: ${txHash || "未発行"}`,
            `時刻: ${new Date().toLocaleString("ja-JP")}`,
        ];
        const text = lines.join("\n");
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #111;">
                <h2 style="margin: 0 0 12px; color: #0f172a;">${subject}</h2>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    ${lines.map((line) => {
                        const separator = line.indexOf(":");
                        const label = separator >= 0 ? line.slice(0, separator) : line;
                        const value = separator >= 0 ? line.slice(separator + 1).trim() : "";
                        return `
                            <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: 700; width: 180px;">${label}</td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${value}</td>
                            </tr>
                        `;
                    }).join("")}
                </table>
            </div>
        `;

        try {
            await fetch("/api/send-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: user.email,
                    subject,
                    text,
                    html,
                }),
            });
        } catch (error) {
            console.error("[AutoTradeEmail] Failed to send email notification", error);
        }
    };

    const requestLossPostmortem = useCallback(async (transaction: Transaction) => {
        if (!user?.email) return;
        try {
            await fetch("/api/ai/improvements/postmortem", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    notifyEmail: user.email,
                    transaction: {
                        id: transaction.id,
                        symbol: normalizeTrackedSymbol(transaction.symbol),
                        chain: transaction.chain,
                        routeType: transaction.routeType,
                        executionTarget: transaction.executionTarget,
                        reason: transaction.reason,
                        reviewReason: transaction.reviewReason,
                        reviewDetail: transaction.reviewDetail,
                        reviewStrategy: transaction.reviewStrategy,
                        reviewExitPlan: transaction.reviewExitPlan,
                        positionSizeLabel: transaction.positionSizeLabel,
                        regime: transaction.regime,
                        triggerState: transaction.triggerState,
                        triggerType: transaction.triggerType,
                        entryPrice: transaction.entryPrice,
                        finalPrice: transaction.price,
                        pnlUsd: Number(transaction.pnl || 0),
                        timestamp: transaction.timestamp,
                        txHash: transaction.txHash,
                    },
                    portfolioSummary: {
                        totalValueUsd: portfolio.totalValue,
                        cashbalanceUsd: portfolio.cashbalance,
                        positions: portfolio.positions,
                    },
                }),
            });
        } catch (error) {
            console.error("[AutoTradePostmortem] Failed to request OpenAI loss review", error);
        }
    }, [user?.email]);

    const resolveAutoTradeEmailCategory = useCallback((
        action: "BUY" | "SELL",
        success: boolean,
        exitReason?: string,
    ): AutoTradeEmailCategory => {
        if (!success) return "failed";
        if (action === "BUY") return "buy-filled";

        const normalizedExitReason = String(exitReason || "").toLowerCase();
        if (/take|profit|利確/.test(normalizedExitReason)) return "take-profit";
        if (/stop|loss|損切|trailing/.test(normalizedExitReason)) return "stop-loss";
        return "sell-filled";
    }, []);

    useEffect(() => {
        const losingAutoTrades = transactions.filter((transaction) =>
            transaction.autoTradeTarget
            && transaction.type === "SELL"
            && Number.isFinite(Number(transaction.pnl))
            && Number(transaction.pnl) < 0,
        );

        losingAutoTrades.forEach((transaction) => {
            if (processedLossPostmortemIdsRef.current.has(transaction.id)) return;
            processedLossPostmortemIdsRef.current.add(transaction.id);
            void requestLossPostmortem(transaction);
        });
    }, [requestLossPostmortem, transactions]);

    const toggleChain = (chain: Chain) => {
        setActiveChains(prev => prev.includes(chain) ? prev.filter(c => c !== chain) : [...prev, chain]);
    };

    const requestProposal = () => {
        setForceProposal(true);
    };

    // ... (Initial Data same)
    // Fallback initial data (overridden by Market Data API)
    const initialData: Record<string, StrategyMarketQuote> = {
        BTC: { price: 65000.00, volume: 35000000, change24h: 0 },
        ETH: { price: 3450.20, volume: 12000000, change24h: 0 },
        SOL: { price: 145.50, volume: 8000000, change24h: 0 },
        BNB: { price: 580.20, volume: 5000000, change24h: 0 },
        LINK: { price: 17.50, volume: 2500000, change24h: 0 },
        SHIB: { price: 0.000013, volume: 12000000, change24h: 0 },
        MATIC: { price: 0.95, volume: 2000000, change24h: 0 },
        POL: { price: 0.95, volume: 2000000, change24h: 0 },
        DOGE: { price: 0.15, volume: 15000000, change24h: 0 },
        USDT: { price: 1.00, volume: 50000000, change24h: 0 },
        USD1: { price: 1.00, volume: 1000000, change24h: 0 },
    };

    const [allMarketPrices, setAllMarketPrices] = useState<Record<string, StrategyMarketQuote>>(initialData);
    const allMarketPricesRef = useRef<Record<string, StrategyMarketQuote>>(initialData);
    const [realPricesLoaded, setRealPricesLoaded] = useState(false);
    const [isStrategyCandleStoreReady, setIsStrategyCandleStoreReady] = useState(false);

    const [marketData, setMarketData] = useState<MarketData>({
        price: initialData["BNB"].price,
        change24h: 0,
        volume: initialData["BNB"].volume,
        trend: "SIDEWAYS",
    });

    // Initial fund: ﾂ･30,000 (Demo requirement)
    // Base currency for calculations is USD. 
    // Formatters in CurrencyContext will handle the conversion to JPY if selected.
    const INITIAL_CASH_USD = 200; // Approx 30,000 JPY
    const INITIAL_PORTFOLIO: Portfolio = {
        totalValue: INITIAL_CASH_USD,
        pnl24h: 0,
        cashbalance: INITIAL_CASH_USD,
        positions: [], // Start with no positions - pure cash
    };
    // We initialize as 0 if we detect we're likely in a live environment to prevent flashes of 30,000 JPY
    // Note: since localStorage takes a tick to load, we assume 0 until proven otherwise if auth might exist
    const isLikelyLive = typeof window !== 'undefined' && sessionStorage.getItem("jdex_auth") === "true";

    const [portfolio, setPortfolio] = useState<Portfolio>(isLikelyLive ? {
        totalValue: 0,
        pnl24h: 0,
        cashbalance: 0,
        positions: []
    } : INITIAL_PORTFOLIO);

    // Strategy Management
    const [riskTolerance, setRiskTolerance] = useState(DEFAULT_RISK_TOLERANCE); // 1-5 (default Aggressive)
    const [stopLossThreshold, setStopLossThreshold] = useState(DEFAULT_STOP_LOSS_THRESHOLD);
    const [takeProfitThreshold, setTakeProfitThreshold] = useState(DEFAULT_TAKE_PROFIT_THRESHOLD);
    const [isFlashEnabled, setIsFlashEnabled] = useState(true);

    const { jpyRate } = useCurrency();

    const convertJPY = useCallback((usd: number) => {
        return usd * jpyRate; // Use the dynamic rate from CurrencyContext
    }, [jpyRate]);

    const [initialTradeSymbol, setInitialTradeSymbol] = useState("BNB");
    const [hasInitialTradeExecutedState, setHasInitialTradeExecutedState] = useState(() => {
        if (typeof window === "undefined") return false;
        return localStorage.getItem("jdex_initial_trade_done") === "true";
    });
    const setHasInitialTradeExecuted = useCallback((next: boolean) => {
        setHasInitialTradeExecutedState(next);
        if (typeof window === "undefined") return;
        if (next) {
            localStorage.setItem("jdex_initial_trade_done", "true");
        } else {
            localStorage.removeItem("jdex_initial_trade_done");
        }
    }, []);
    const hasInitialTradeExecuted = hasInitialTradeExecutedState;

    const addMessage = useCallback((agentId: string, content: string, type: Message["type"] | "NORMAL" = "OPINION") => {
        const actualType = type === "NORMAL" ? "OPINION" : type;
        const newMessage: Message = {
            id: Math.random().toString(36).substring(7),
            agentId,
            content,
            timestamp: Date.now(),
            type: actualType,
        };
        setMessages((prev) => [...prev, newMessage]);

        if (actualType === "EXECUTION" || actualType === "ALERT") {
            setAiPopupMessage(newMessage);
            if (isSoundEnabled) {
                if (actualType === "EXECUTION") playTrade();
                else playAlert();
            }
        }

        if (isSoundEnabled && actualType === "OPINION") {
            playNotification();
        }

        return newMessage;
    }, [isSoundEnabled, playTrade, playAlert, playNotification]);

    const resumerRef = useRef<(() => void) | null>(null);
    const [isPricingPaused, setIsPricingPaused] = useState(false);

    const resumePricing = useCallback(() => {
        addMessage("SYSTEM", "価格更新を再開しました。", "SYSTEM");
    }, [addMessage]);

    const unlockAchievement = useCallback((id: string) => {
        setAchievements(prev => prev.map(a => a.id === id ? { ...a, unlocked: true } : a));
    }, []);

    const updateAchievementProgress = useCallback((id: string, progress: number) => {
        setAchievements(prev => prev.map(a => {
            if (a.id === id) {
                const newProgress = Math.min(a.target || 0, (a.progress || 0) + progress);
                return { ...a, progress: newProgress, unlocked: a.unlocked || (a.target ? newProgress >= a.target : false) };
            }
            return a;
        }));
    }, []);

    const marketDataRef = useRef(marketData);
    const portfolioRef = useRef(portfolio);
    const agentsRef = useRef(agents);
    const isActiveRef = useRef(false);
    const lastTradeRef = useRef(0); // Cooldown for demo trades
    const lastInitialCandidateRef = useRef<string | null>(null);
    const autoTradeRotationIndexRef = useRef(0);
    const lastAutoTradeSymbolRef = useRef<string | null>(null);
    const lastLiveAutoStatusRef = useRef(0);
    const lastStrategyRefreshRef = useRef(0);
    const lastStrategyCurrencyRef = useRef<string | null>(null);
    const symbolPriceHistoryRef = useRef<Record<string, SymbolPriceSample[]>>({});
    const pendingStrategyCandleWritesRef = useRef<Record<string, StrategyCandleSample>>({});
    const lastPersistedStrategyCandleTsRef = useRef<Record<string, number>>({});
    const lastStrategyCandlePruneRef = useRef(0);
    const strategyUniverseMetricsHydratedRef = useRef(false);
    const strategyPriceHydratedRef = useRef(false);
    const contractPriceCacheRef = useRef(new Map<string, { expiresAt: number; data: Record<string, number> }>());
    const contractPriceInFlightRef = useRef(new Map<string, Promise<Record<string, number>>>());

    useEffect(() => {
        allMarketPricesRef.current = allMarketPrices;
    }, [allMarketPrices]);

    useEffect(() => {
        let active = true;

        const hydrateStrategyCandles = async () => {
            try {
                const loaded = await loadStrategyCandleSamples(
                    Array.from(STRATEGY_CANDLE_SYMBOL_SET),
                    Date.now() - STRATEGY_CANDLE_RETENTION_MS,
                );

                if (!active) return;

                symbolPriceHistoryRef.current = {
                    ...symbolPriceHistoryRef.current,
                    ...loaded,
                };

                Object.entries(loaded).forEach(([symbol, samples]) => {
                    const last = samples[samples.length - 1];
                    if (last) {
                        lastPersistedStrategyCandleTsRef.current[symbol] = Math.floor(last.ts / 60_000) * 60_000;
                    }
                });
            } catch (error) {
                console.warn("[StrategyCandles] Hydration failed:", error);
            } finally {
                if (active) {
                    setIsStrategyCandleStoreReady(true);
                }
            }
        };

        void hydrateStrategyCandles();

        return () => {
            active = false;
        };
    }, []);

    const getExecutionSupportedSymbols = useCallback(() => {
        const resolvedChainIds: number[] = [];

        if (effectiveChainId && isSupportedChain(effectiveChainId)) {
            resolvedChainIds.push(effectiveChainId);
        } else {
            if (activeChains.includes("BNB")) resolvedChainIds.push(56);
            if (activeChains.includes("POLYGON")) resolvedChainIds.push(137);
        }

        if (resolvedChainIds.length === 0) {
            resolvedChainIds.push(56);
        }

        const supported = new Set<string>();
        resolvedChainIds.forEach((chainId) => {
            Object.keys(TOKEN_REGISTRY[chainId] || {}).forEach((symbol) => {
                const normalized = normalizeTrackedSymbol(symbol);
                if (!TRADE_CONFIG.STABLECOINS.includes(normalized)) {
                    supported.add(normalized);
                }
            });
        });

        Object.entries(allMarketPricesRef.current).forEach(([symbol, quote]) => {
            if (quote?.executionSupported && quote.executionAddress) {
                const normalized = normalizeTrackedSymbol(symbol);
                if (!TRADE_CONFIG.STABLECOINS.includes(normalized)) {
                    supported.add(normalized);
                }
            }
        });

        return supported;
    }, [effectiveChainId, activeChains]);

    const buildCyclePerformanceSnapshots = useCallback((referenceTs: number): CyclePerformanceSnapshot[] => {
        const cutoff = referenceTs - 14 * 24 * 60 * 60 * 1000;
        const grouped = new Map<string, { wins: number; trades: number; returns: number[] }>();

        transactions
            .filter((tx) => tx.type === "SELL" && tx.timestamp >= cutoff && Number.isFinite(tx.price) && tx.price > 0 && Number.isFinite(tx.amount) && tx.amount > 0)
            .forEach((tx) => {
                const symbol = normalizeTrackedSymbol(tx.symbol || "");
                if (!symbol) return;
                const block = getTokyoCycleInfo(tx.timestamp).block;
                const key = `${symbol}:${block}`;
                const bucket = grouped.get(key) || { wins: 0, trades: 0, returns: [] };
                const notional = tx.price * tx.amount;
                const expectancyPct = notional > 0 ? ((Number(tx.pnl || 0) / notional) * 100) : 0;
                bucket.trades += 1;
                if ((tx.pnl || 0) > 0) bucket.wins += 1;
                bucket.returns.push(expectancyPct);
                grouped.set(key, bucket);
            });

        return Array.from(grouped.entries()).map(([key, bucket]) => {
            const [symbol, block] = key.split(":");
            return {
                symbol,
                block: block as CyclePerformanceSnapshot["block"],
                trades: bucket.trades,
                winRate: bucket.trades > 0 ? (bucket.wins / bucket.trades) * 100 : 0,
                expectancyPct: bucket.returns.length ? average(bucket.returns) : 0,
            };
        });
    }, [transactions]);

    const buildStrategyEngineInput = useCallback((referenceTs: number = Date.now()) => {
        const universeSymbols = Array.from(new Set(STRATEGY_UNIVERSE_SYMBOLS.map((symbol) => normalizeTrackedSymbol(symbol))));
        const marketPriceSnapshot = allMarketPricesRef.current;

        const marketSnapshots: Record<string, MarketSnapshot | undefined> = Object.fromEntries(
            universeSymbols.map((symbol) => {
                const normalized = normalizeTrackedSymbol(symbol);
                const data = marketPriceSnapshot[normalized] || initialData[normalized] || {};
                return [normalized, {
                    price: Number(data?.price || 0),
                    change24h: Number(data?.change24h ?? 0),
                    chain: data?.chain === "SOLANA" ? "SOLANA" : "BNB",
                    displaySymbol: typeof data?.displaySymbol === "string" ? data.displaySymbol : normalized.replace(/\\.SOL$/, ""),
                    volume: Number(data?.volume ?? 0),
                    liquidity: Number(data?.liquidity ?? 0),
                    spreadBps: Number(data?.spreadBps ?? 0),
                    marketCap: Number(data?.marketCap ?? 0),
                    tokenAgeDays: Number(data?.tokenAgeDays ?? 0),
                    txns1h: Number(data?.txns1h ?? 0),
                    dexPairFound: Boolean(data?.dexPairFound),
                    contractAddress: data?.contractAddress,
                    dexPairUrl: data?.dexPairUrl,
                    executionSupported: typeof data?.executionSupported === "boolean" ? data.executionSupported : undefined,
                    executionChain: data?.executionChain === "SOLANA" ? "SOLANA" : data?.executionChain === "BNB" ? "BNB" : undefined,
                    executionChainId: Number.isFinite(Number(data?.executionChainId)) ? Number(data?.executionChainId) : undefined,
                    executionAddress: typeof data?.executionAddress === "string" ? data.executionAddress : undefined,
                    executionDecimals: Number.isFinite(Number(data?.executionDecimals)) ? Number(data?.executionDecimals) : undefined,
                    executionRouteKind:
                        data?.executionRouteKind === "proxy"
                            ? "proxy"
                            : data?.executionRouteKind === "native"
                                ? "native"
                                : data?.executionRouteKind === "cross-chain"
                                    ? "cross-chain"
                                    : undefined,
                    executionSource: typeof data?.executionSource === "string" ? data.executionSource : undefined,
                    executionPairUrl: typeof data?.executionPairUrl === "string" ? data.executionPairUrl : undefined,
                    executionLiquidityUsd: Number.isFinite(Number(data?.executionLiquidityUsd)) ? Number(data?.executionLiquidityUsd) : undefined,
                    executionVolume24hUsd: Number.isFinite(Number(data?.executionVolume24hUsd)) ? Number(data?.executionVolume24hUsd) : undefined,
                    executionTxns1h: Number.isFinite(Number(data?.executionTxns1h)) ? Number(data?.executionTxns1h) : undefined,
                    source: data?.source,
                }];
            }),
        );

        const historyMap = Object.fromEntries(
            universeSymbols.map((symbol) => {
                const normalized = normalizeTrackedSymbol(symbol);
                return [normalized, symbolPriceHistoryRef.current[normalized] || []];
            }),
        );

        const positions = portfolioRef.current.positions.map((position) => ({
            symbol: normalizeTrackedSymbol(position.symbol),
            amount: position.amount,
            entryPrice: position.entryPrice,
        }));

        return {
            referenceTs,
            marketSnapshots,
            priceHistory: historyMap,
            positions,
            cyclePerformance: buildCyclePerformanceSnapshots(referenceTs),
            lastAutoTradeSymbol: lastAutoTradeSymbolRef.current || undefined,
            preferredSymbol: normalizeTrackedSymbol(selectedCurrency),
        };
    }, [buildCyclePerformanceSnapshots, selectedCurrency]);

    const buildStrategyEngineResult = useCallback((referenceTs: number = Date.now()): DailyPlanBuildResult => {
        return buildDailyPlan(buildStrategyEngineInput(referenceTs));
    }, [buildStrategyEngineInput]);

    const refreshContinuousStrategyMonitor = useCallback((trigger: "timer" | "manual" | "market" = "timer") => {
        if (!isStrategyCandleStoreReady) return null;
        const referenceTs = Date.now();
        const runtimeState: ContinuousMonitorRuntimeState = {
            openSymbols: [
                ...portfolioRef.current.positions.map((position) => normalizeTrackedSymbol(position.symbol)),
                ...Object.values(crossChainShadowPositionsRef.current).map((position) => normalizeTrackedSymbol(position.symbol)),
            ],
            pendingSymbols: crossChainOrdersRef.current
                .filter((order) => isPendingCrossChainStatus(order.status))
                .map((order) => normalizeTrackedSymbol(order.symbol)),
            recentTrades: transactionsRef.current
                .slice(-120)
                .map((tx) => ({
                    symbol: normalizeTrackedSymbol(tx.symbol),
                    action: tx.type,
                    timestamp: tx.timestamp,
                })),
        };
        const monitor = buildContinuousStrategyMonitor(buildStrategyEngineInput(referenceTs), runtimeState);
        updateStrategyPerformanceStore((previousStore) => appendStrategyCandidateEvents(
            previousStore,
            liveStrategyMonitorRef.current,
            monitor,
        ));
        setLiveStrategyMonitor(monitor);
        liveStrategyMonitorRef.current = monitor;
        lastLiveStrategyMonitorRefreshRef.current = referenceTs;

        if (trigger === "manual") {
            addMessage("SYSTEM", "常時監視ストラテジーを更新しました。", "SYSTEM");
        }

        persistLiveStrategyMonitorSafely(monitor);

        return monitor;
    }, [addMessage, buildStrategyEngineInput, isStrategyCandleStoreReady, updateStrategyPerformanceStore]);

    const buildRankedAutoCandidates = useCallback((): RankedTokenCandidate[] => {
        const engine = buildStrategyEngineResult(Date.now());
        return engine.candidates.map((candidate) => ({
            symbol: candidate.symbol,
            tier: candidate.tier,
            score: candidate.score,
            change24h: candidate.change24h,
            price: candidate.price,
            volume: candidate.volume,
            liquidity: candidate.liquidity,
            spreadBps: candidate.spreadBps,
            historyBars: candidate.historyBars,
            dataCompleteness: candidate.dataCompleteness,
            universeRankScore: candidate.universeRankScore,
            mode: candidate.mode,
            rank: candidate.rank,
            status: candidate.status,
            veto: candidate.veto,
            vetoPass: candidate.vetoPass,
            vetoReasons: candidate.vetoReasons,
            mainReason: candidate.mainReason,
            reasonTags: candidate.reasonTags,
            indicatorNotes: candidate.indicatorNotes,
            scoreBreakdown: candidate.scoreBreakdown,
            plannedEntryMin: candidate.price * (1 - Math.max(candidate.atrPct, 0.004) * 0.2),
            plannedEntryMax: candidate.price * (1 + Math.max(candidate.atrPct, 0.004) * 0.15),
            plannedTakeProfit: candidate.price * (1 + Math.max(candidate.atrPct, 0.004) * (candidate.mode === "TREND" ? 1.6 : 1.05)),
            plannedStopLoss: candidate.price * (1 - Math.max(candidate.atrPct, 0.004) * (candidate.mode === "TREND" ? 1.0 : 0.8)),
            confidence: candidate.confidence,
            supportDistancePct: candidate.supportDistancePct,
            resistanceDistancePct: candidate.resistanceDistancePct,
            atrPct: candidate.atrPct,
            volumeRatio: candidate.volumeRatio,
            relativeStrengthScore: candidate.relativeStrengthScore,
            correlationGroup: candidate.correlationGroup,
            contractAddress: candidate.contractAddress,
            dexPairUrl: candidate.dexPairUrl,
            executionSupported: candidate.executionSupported,
            marketSource: candidate.marketSource,
        }));
    }, [buildStrategyEngineResult]);

    const pushSymbolPriceSample = useCallback((symbol: string, price: number, ts: number = Date.now()) => {
        if (!Number.isFinite(price) || price <= 0) return;
        const normalized = normalizeTrackedSymbol(symbol);
        const current = symbolPriceHistoryRef.current[normalized] || [];
        const last = current[current.length - 1];
        const smallMove = last ? Math.abs(last.price - price) <= Math.max(last.price * 0.00003, 0.0000001) : false;
        if (last && ts - last.ts < 30_000 && smallMove) {
            return;
        }

        const next = [...current, { ts, price }].filter((sample) => ts - sample.ts <= STRATEGY_CANDLE_RETENTION_MS);
        symbolPriceHistoryRef.current[normalized] = next.slice(-2_400);

        if (STRATEGY_CANDLE_SYMBOL_SET.has(normalized)) {
            const candleTs = Math.floor(ts / 60_000) * 60_000;
            lastPersistedStrategyCandleTsRef.current[normalized] = candleTs;
            pendingStrategyCandleWritesRef.current[`${normalized}:${candleTs}`] = {
                symbol: normalized,
                ts: candleTs,
                price,
            };
        }
    }, []);

    useEffect(() => {
        if (!isStrategyCandleStoreReady) return;

        const flush = async () => {
            const queued = Object.values(pendingStrategyCandleWritesRef.current);
            pendingStrategyCandleWritesRef.current = {};

            if (queued.length > 0) {
                try {
                    await persistStrategyCandleSamples(queued);
                } catch (error) {
                    console.warn("[StrategyCandles] Persist failed:", error);
                    queued.forEach((sample) => {
                        pendingStrategyCandleWritesRef.current[`${sample.symbol}:${sample.ts}`] = sample;
                    });
                }
            }

            if (Date.now() - lastStrategyCandlePruneRef.current > 30 * 60 * 1000) {
                lastStrategyCandlePruneRef.current = Date.now();
                try {
                    await pruneStrategyCandleSamples(Date.now() - STRATEGY_CANDLE_RETENTION_MS);
                } catch (error) {
                    console.warn("[StrategyCandles] Prune failed:", error);
                }
            }
        };

        const interval = setInterval(() => {
            void flush();
        }, 45_000);

        void flush();

        return () => {
            clearInterval(interval);
            void flush();
        };
    }, [isStrategyCandleStoreReady]);

    const getShortMomentumSignal = useCallback((symbol: string, currentPrice: number): ShortMomentumSignal => {
        const normalized = normalizeTrackedSymbol(symbol);
        const samples = symbolPriceHistoryRef.current[normalized] || [];
        if (samples.length === 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
            return { r1: 0, r5: 0, r15: 0, r60: 0, score: 0, confidence: 0 };
        }

        const now = Date.now();
        const lookupPrice = (msAgo: number) => {
            const target = now - msAgo;
            for (let i = samples.length - 1; i >= 0; i -= 1) {
                if (samples[i].ts <= target) return samples[i].price;
            }
            return samples[0]?.price || currentPrice;
        };

        const p1 = lookupPrice(60 * 1000);
        const p5 = lookupPrice(5 * 60 * 1000);
        const p15 = lookupPrice(15 * 60 * 1000);
        const p60 = lookupPrice(60 * 60 * 1000);

        const r1 = p1 > 0 ? (currentPrice - p1) / p1 : 0;
        const r5 = p5 > 0 ? (currentPrice - p5) / p5 : 0;
        const r15 = p15 > 0 ? (currentPrice - p15) / p15 : 0;
        const r60 = p60 > 0 ? (currentPrice - p60) / p60 : 0;

        const score = r1 * 0.2 + r5 * 0.25 + r15 * 0.25 + r60 * 0.3;
        const sampleCoverage = Math.min(1, samples.length / 30);
        const moveStrength = Math.min(1, (Math.abs(r1) + Math.abs(r5) + Math.abs(r15) + Math.abs(r60)) * 90);
        const confidence = Number((sampleCoverage * moveStrength).toFixed(3));

        return { r1, r5, r15, r60, score, confidence };
    }, []);

        const requestAiTradeReview = useCallback(async (payload: {
            kind: "entry" | "exit";
            symbol: string;
            chain?: "BNB" | "SOLANA";
            candidate: Record<string, unknown>;
            peers?: Array<Record<string, unknown>>;
            portfolio?: Record<string, unknown>;
        }): Promise<RemoteAiTradeReview | null> => {
            if (!STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_ENABLED) return null;

            const normalizedPayload = {
                reviewVersion: "v2-runtime-funding",
                ...payload,
                ownerId: getLiveOwnerId(),
                symbol: normalizeTrackedSymbol(payload.symbol),
            };
        const cacheKey = JSON.stringify(normalizedPayload);
        const cached = aiTradeReviewCacheRef.current[cacheKey];
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
            return cached.result;
        }

        try {
            const response = await fetch("/api/ai/trade-review", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(normalizedPayload),
                keepalive: true,
            });
            if (!response.ok) {
                throw new Error(`ai_trade_review_http_${response.status}`);
            }
            const data = await response.json();
            const review = data?.review
                ? {
                    source: String(data?.source || "openai"),
                    approve: Boolean(data.review.approve),
                    priorityScore: Number(data.review.priorityScore || 0),
                    sizeMultiplier: Number(data.review.sizeMultiplier || 1),
                    entryAdjustmentPct: Number(data.review.entryAdjustmentPct || 0),
                    takeProfitAdjustmentPct: Number(data.review.takeProfitAdjustmentPct || 0),
                    stopLossAdjustmentPct: Number(data.review.stopLossAdjustmentPct || 0),
                    holdMinutes: Number(data.review.holdMinutes || 0),
                    reason: String(data.review.reason || ""),
                    detail: String(data.review.detail || ""),
                    strategy: String(data.review.strategy || ""),
                    exitPlan: String(data.review.exitPlan || ""),
                } satisfies RemoteAiTradeReview
                : null;
            aiTradeReviewCacheRef.current[cacheKey] = {
                expiresAt: now + STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_CACHE_TTL_MS,
                result: review,
            };
            return review;
        } catch (error) {
            console.warn("[AI Review] Falling back to local review:", error);
            aiTradeReviewCacheRef.current[cacheKey] = {
                expiresAt: now + 60_000,
                result: null,
            };
            return null;
        }
    }, [getLiveOwnerId]);

    const getUsdPrice = useCallback((symbol: string) => {
        const normalized = normalizeTrackedSymbol(symbol);
        if (TRADE_CONFIG.STABLECOINS.includes(normalized)) return 1;
        return allMarketPrices[normalized]?.price || initialData[normalized]?.price || 0;
    }, [allMarketPrices]);

    const getExecutionAwareUsdPrice = useCallback((
        symbol: string,
        routeKind?: "native" | "proxy" | "cross-chain",
    ) => {
        const normalized = normalizeTrackedSymbol(symbol);
        if (TRADE_CONFIG.STABLECOINS.includes(normalized)) return 1;

        const liveQuote = allMarketPricesRef.current[normalized];
        const initialQuote = initialData[normalized];

        if (routeKind === "proxy") {
            const executionPrice = Number(liveQuote?.executionPriceUsd || initialQuote?.executionPriceUsd || 0);
            if (Number.isFinite(executionPrice) && executionPrice > 0) {
                return executionPrice;
            }
        }

        const livePrice = Number(liveQuote?.price || 0);
        if (Number.isFinite(livePrice) && livePrice > 0) {
            return livePrice;
        }

        const initialPrice = Number(initialQuote?.price || 0);
        if (Number.isFinite(initialPrice) && initialPrice > 0) {
            return initialPrice;
        }

        return 0;
    }, []);

    const resolveWalletAssetChain = useCallback((symbol: string, fallback?: "BNB" | "SOLANA") => {
        const normalized = normalizeTrackedSymbol(symbol);
        const quote = allMarketPrices[normalized];
        if (quote?.executionRouteKind === "proxy" && quote.executionChain) {
            return quote.executionChain;
        }
        const latestTx = [...transactions].reverse().find(
            (tx) => normalizeTrackedSymbol(tx.symbol) === normalized && tx.routeType === "proxy",
        );
        const latestExecutionChain = String(latestTx?.destinationChain || "").toUpperCase();
        if (latestExecutionChain.includes("SOL")) return "SOLANA";
        if (latestExecutionChain.includes("BNB")) return "BNB";
        if (latestTx?.routeType === "proxy" && latestTx?.executionTarget) return "BNB";
        if (latestTx?.chain?.toUpperCase().includes("SOL")) return "SOLANA";
        if (latestTx?.chain?.toUpperCase().includes("BNB")) return "BNB";
        return resolveHoldingChain(normalized, fallback);
    }, [allMarketPrices, transactions]);

    const findStrategyCandidate = useCallback((symbol: string): ContinuousStrategyCandidate | undefined => {
        const normalized = normalizeTrackedSymbol(symbol);
        return liveStrategyMonitorRef.current?.candidates.find(
            (candidate) => normalizeTrackedSymbol(candidate.symbol) === normalized,
        );
    }, []);

    const buildPerformanceTradeMeta = useCallback((symbol: string, tradeMeta?: TradeExecutionMeta) => {
        const candidate = findStrategyCandidate(symbol);
        const lifecycleKey = `${resolveHoldingChain(symbol, tradeMeta?.chain)}:${normalizeTrackedSymbol(symbol)}`;
        const lifecycle = strategyPerformanceStoreRef.current.lifecycles[lifecycleKey];
        return {
            chain: (tradeMeta?.chain || candidate?.chain || resolveHoldingChain(symbol)) as StrategyChain,
            routeType: (tradeMeta?.routeType || candidate?.executionRouteKind || lifecycle?.routeType || "unknown") as StrategyRouteType,
            regime: tradeMeta?.regime || candidate?.regime || lifecycle?.regime || "No-trade",
            score: Number(tradeMeta?.score ?? candidate?.marketScore ?? lifecycle?.score ?? 0),
            triggerState: tradeMeta?.triggerState || candidate?.triggerState || lifecycle?.triggerState || "Ready",
            triggerType: tradeMeta?.triggerType || candidate?.triggerType || lifecycle?.triggerType || "None",
            decision: (tradeMeta?.tradeDecision || candidate?.tradeDecision || lifecycle?.decision || "Blocked") as StrategyDecision,
            positionSize: (tradeMeta?.positionSizeLabel || candidate?.positionSizeLabel || lifecycle?.positionSize || "0x") as StrategyPositionSize,
            triggeredAt: tradeMeta?.triggeredAt || lifecycle?.triggeredAt,
            selectedAt: tradeMeta?.selectedAt || lifecycle?.selectedAt,
        };
    }, [findStrategyCandidate]);

    const recordStrategyExecution = useCallback((
        symbol: string,
        payload: {
            id?: string;
            kind: "order" | "fill" | "failure";
            action: "BUY" | "SELL";
            timestamp: number;
            chain?: StrategyChain;
            routeType?: StrategyRouteType;
            regime?: StrategyRegime;
            score?: number;
            triggerState?: StrategyTriggerState;
            triggerType?: StrategyTriggerType;
            decision?: StrategyDecision;
            positionSize?: StrategyPositionSize;
            orderId?: string;
            executionId?: string;
            triggeredAt?: number;
            selectedAt?: number;
            filledAt?: number;
            exitedAt?: number;
            exitReason?: StrategyExitReason;
            pnl?: number;
            pnlPct?: number;
            success?: boolean;
            failureReason?: string;
        },
        tradeMeta?: TradeExecutionMeta,
    ) => {
        const performanceMeta = buildPerformanceTradeMeta(symbol, tradeMeta);
        const merged = {
            chain: payload.chain || performanceMeta.chain,
            routeType: payload.routeType || performanceMeta.routeType,
            regime: payload.regime || performanceMeta.regime,
            score: Number(payload.score ?? performanceMeta.score),
            triggerState: payload.triggerState || performanceMeta.triggerState,
            triggerType: payload.triggerType || performanceMeta.triggerType,
            decision: payload.decision || performanceMeta.decision,
            positionSize: payload.positionSize || performanceMeta.positionSize,
            triggeredAt: payload.triggeredAt || performanceMeta.triggeredAt,
            selectedAt: payload.selectedAt || performanceMeta.selectedAt,
        };
        updateStrategyPerformanceStore((previousStore) => appendStrategyExecutionEvent(previousStore, {
            ...payload,
            symbol: normalizeTrackedSymbol(symbol),
            chain: merged.chain,
            routeType: merged.routeType,
            regime: merged.regime,
            score: merged.score,
            triggerState: merged.triggerState,
            triggerType: merged.triggerType,
            decision: merged.decision,
            positionSize: merged.positionSize,
            triggeredAt: merged.triggeredAt,
            selectedAt: merged.selectedAt,
        }));
    }, [buildPerformanceTradeMeta, updateStrategyPerformanceStore]);

    useEffect(() => {
        if (!effectiveIsConnected || isDemoMode || !solanaWalletAddress) {
            setLiveSolanaWalletHoldings([]);
            setSolanaWalletSyncError(null);
            return;
        }

        let cancelled = false;
        const sync = async () => {
            try {
                setSolanaWalletSyncError(null);
                const customMintQuery = customSolanaMints
                    .map((mint) => `mint=${encodeURIComponent(mint)}`)
                    .join("&");
                const response = await fetch(
                    `/api/wallet/solana-holdings?address=${encodeURIComponent(solanaWalletAddress)}${customMintQuery ? `&${customMintQuery}` : ""}`,
                    { cache: "no-store" },
                );
                const payload = await response.json();
                if (!response.ok || !payload?.ok) {
                    throw new Error(String(payload?.error || "solana_wallet_sync_failed"));
                }

                const holdings = Array.isArray(payload?.holdings) ? payload.holdings : [];
                if (holdings.length === 0) {
                    if (!cancelled) setLiveSolanaWalletHoldings([]);
                    return;
                }

                const symbols = holdings.map((row: any) => String(row?.symbol || "")).filter((symbol: string) => Boolean(symbol));
                const universeMetrics = await fetchStrategyUniverseMetrics(symbols);
                const fallbackPrices = symbols.includes("SOL.SOL") ? await fetchMarketPrices(["SOL"]) : {};
                const customAddressRows = holdings
                    .map((row: any) => ({
                        symbol: String(row?.symbol || "").trim(),
                        address: String(row?.address || row?.symbol || "").trim(),
                    }))
                    .filter((row: { symbol: string; address: string }) => (
                        Boolean(row.symbol)
                        && SOLANA_ADDRESS_RE.test(row.address)
                    ));
                const customPriceQuery = customAddressRows
                    .map((row: { symbol: string; address: string }) => `address=${encodeURIComponent(row.address)}&key=${encodeURIComponent(row.address)}`)
                    .join("&");
                const customContractPrices = customPriceQuery
                    ? await fetch(`/api/market/contract-prices?chainId=101&${customPriceQuery}`, { cache: "no-store" })
                        .then(async (response) => (response.ok ? response.json() : {}))
                        .catch(() => ({}))
                    : {};

                const nextRows: WalletHoldingRow[] = holdings
                    .map((row: any) => {
                        const rawSymbol = String(row?.symbol || "").trim();
                        const symbol = SOLANA_ADDRESS_RE.test(rawSymbol) ? rawSymbol : rawSymbol.toUpperCase();
                        const amount = Number(row?.amount || 0);
                        if (!symbol || !Number.isFinite(amount) || amount <= 0) return null;
                        const payloadAddress = typeof row?.address === "string" ? row.address.trim() : "";
                        const payloadUsdPrice = Number(row?.usdPrice || 0);
                        const payloadUsdValue = Number(row?.usdValue || 0);
                        const metricPrice = Number(universeMetrics[symbol]?.price || 0);
                        const customContractPrice = Number(
                            customContractPrices?.[payloadAddress || String(row?.symbol || "").trim()] || 0,
                        );
                        const fallbackPrice = symbol === "SOL.SOL" ? Number(fallbackPrices?.SOL?.price || 0) : 0;
                        const usdPrice = payloadUsdPrice > 0
                            ? payloadUsdPrice
                            : customContractPrice > 0
                                ? customContractPrice
                                : metricPrice > 0
                                    ? metricPrice
                                    : fallbackPrice;
                        const usdValue = payloadUsdValue > 0 ? payloadUsdValue : amount * usdPrice;
                        return {
                            symbol,
                            displaySymbol: typeof row?.displaySymbol === "string" ? row.displaySymbol : undefined,
                            amount,
                            usdValue,
                            entryPrice: usdPrice,
                            address: payloadAddress && SOLANA_ADDRESS_RE.test(payloadAddress)
                                ? payloadAddress
                                : typeof row?.symbol === "string" && SOLANA_ADDRESS_RE.test(row.symbol)
                                    ? row.symbol
                                    : undefined,
                            isStable: false,
                            chain: "SOLANA",
                            isGasReserve: isPassiveGasReserveHolding({
                                symbol,
                                amount,
                                usdValue,
                                chain: "SOLANA",
                            }),
                        } satisfies WalletHoldingRow;
                    })
                    .filter((row: WalletHoldingRow | null): row is WalletHoldingRow => Boolean(row));

                if (!cancelled) {
                    setLiveSolanaWalletHoldings(
                        nextRows.sort((left, right) => {
                            if (right.usdValue !== left.usdValue) return right.usdValue - left.usdValue;
                            return right.amount - left.amount;
                        }),
                    );
                }
            } catch (error) {
                if (!cancelled) {
                    setLiveSolanaWalletHoldings([]);
                    setSolanaWalletSyncError(error instanceof Error ? error.message : "solana_wallet_sync_failed");
                }
            }
        };

        sync();
        return () => {
            cancelled = true;
        };
    }, [customSolanaMints, effectiveIsConnected, isDemoMode, solanaWalletAddress]);

    useEffect(() => {
        if (!isConnected || isDemoMode) {
            setLiveWalletHoldings([]);
            setLiveSolanaWalletHoldings([]);
            setSolanaWalletSyncError(null);
        }
    }, [isConnected, isDemoMode]);

    const walletHoldings = useMemo<WalletHoldingRow[]>(() => {
        const rows: WalletHoldingRow[] = !isDemoMode && (liveWalletHoldings.length > 0 || liveSolanaWalletHoldings.length > 0)
            ? [...liveWalletHoldings, ...liveSolanaWalletHoldings]
            : portfolio.positions.map((position) => {
                const symbol = normalizeTrackedSymbol(position.symbol);
                const livePrice = getUsdPrice(symbol) || position.entryPrice || 0;
                return {
                    symbol,
                    amount: position.amount,
                    usdValue: position.amount * livePrice,
                    entryPrice: position.entryPrice,
                    address: undefined,
                    isStable: false,
                    chain: resolveWalletAssetChain(symbol),
                    isGasReserve: false,
                };
            });

        if ((!isDemoMode || rows.length === 0) && portfolio.cashbalance > 0) {
            const hasStable = rows.some((row) => row.symbol === "USDT" && row.isStable);
            if (!hasStable) {
                rows.push({
                    symbol: "USDT",
                    amount: portfolio.cashbalance,
                    usdValue: portfolio.cashbalance,
                    entryPrice: 1,
                    address: undefined,
                    isStable: true,
                    chain: "BNB",
                    isGasReserve: false,
                });
            }
        }

        const existingHoldingKeys = new Set(rows.map((row) => walletHoldingKey(row.symbol, row.chain)));
        const supplementalRows: WalletHoldingRow[] = [];

        portfolio.positions.forEach((position) => {
            const symbol = normalizeTrackedSymbol(position.symbol);
            const chain = resolveWalletAssetChain(symbol);
            const holdingKey = walletHoldingKey(symbol, chain);
            if (existingHoldingKeys.has(holdingKey)) return;
            const livePrice = getUsdPrice(symbol) || position.entryPrice || 0;
            if (position.amount <= 0) return;
            supplementalRows.push({
                symbol,
                displaySymbol: allMarketPrices[symbol]?.displaySymbol,
                address: undefined,
                amount: position.amount,
                usdValue: position.amount * livePrice,
                entryPrice: livePrice,
                isStable: TRADE_CONFIG.STABLECOINS.includes(symbol),
                chain,
                isGasReserve: false,
            });
            existingHoldingKeys.add(holdingKey);
        });

        Object.values(crossChainShadowPositionsRef.current).forEach((position) => {
            const symbol = normalizeTrackedSymbol(position.symbol);
            const holdingKey = walletHoldingKey(symbol, "SOLANA");
            if (existingHoldingKeys.has(holdingKey) || position.amount <= 0) return;
            const livePrice = getUsdPrice(symbol) || position.entryPrice || 0;
            supplementalRows.push({
                symbol,
                address: undefined,
                amount: position.amount,
                usdValue: position.amount * livePrice,
                entryPrice: livePrice,
                isStable: TRADE_CONFIG.STABLECOINS.includes(symbol),
                chain: "SOLANA",
                isGasReserve: false,
            });
            existingHoldingKeys.add(holdingKey);
        });

        return [...rows, ...supplementalRows]
            .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
            .sort((left, right) => {
                if (right.usdValue !== left.usdValue) return right.usdValue - left.usdValue;
                return right.amount - left.amount;
            });
    }, [allMarketPrices, getUsdPrice, isDemoMode, liveSolanaWalletHoldings, liveWalletHoldings, portfolio.cashbalance, portfolio.positions, resolveWalletAssetChain]);

    const pickFundingSourceForBuy = useCallback((
        targetSymbol: string,
        desiredUsd: number,
        currentPortfolio: Portfolio,
        options?: { minOrderUsd?: number },
    ): { sourceSymbol?: string; budgetUsd: number } => {
        const minOrderUsd = Math.max(LIVE_MIN_ORDER_USD, Number(options?.minOrderUsd || LIVE_MIN_ORDER_USD));
        const supportedSymbols = getExecutionSupportedSymbols();
        const targetQuote = allMarketPricesRef.current?.[normalizeTrackedSymbol(targetSymbol)];
        const targetExecutionChainId = Number(targetQuote?.executionChainId || effectiveChainId || 0);
        const preferredSymbols = (!isDemoMode && targetExecutionChainId && isSupportedChain(targetExecutionChainId))
            ? LIVE_EXECUTION_PREFERRED_SYMBOLS[targetExecutionChainId]
            : undefined;
        const safeDesiredUsd = Math.max(0, desiredUsd);
        const targetComparable = comparableTradeSymbol(targetSymbol);
        const fundingRows = (!isDemoMode && walletHoldings.length > 0)
            ? walletHoldings.map((row) => {
                const symbol = normalizeTrackedSymbol(row.symbol);
                const price = TRADE_CONFIG.STABLECOINS.includes(symbol)
                    ? 1
                    : (getUsdPrice(symbol) || (row.amount > 0 ? row.usdValue / row.amount : 0));
                return {
                    symbol,
                    amount: row.amount,
                    price,
                    usdValue: row.usdValue,
                    isStable: row.isStable || TRADE_CONFIG.STABLECOINS.includes(symbol),
                    isGasReserve: row.isGasReserve === true,
                };
            })
            : [
                ...currentPortfolio.positions.map((position) => {
                    const symbol = normalizeTrackedSymbol(position.symbol);
                    const price = getUsdPrice(symbol);
                    const usdValue = position.amount * price;
                    return {
                        symbol,
                        amount: position.amount,
                        price,
                        usdValue,
                        isStable: false,
                        isGasReserve: false,
                    };
                }),
                ...(currentPortfolio.cashbalance > 0
                    ? [{
                        symbol: "USDT",
                        amount: currentPortfolio.cashbalance,
                        price: 1,
                        usdValue: currentPortfolio.cashbalance,
                        isStable: true,
                        isGasReserve: false,
                    }]
                    : []),
            ];
        const stableRowsUsd = fundingRows
            .filter((entry) => entry.isStable)
            .reduce((sum, entry) => sum + Math.max(0, entry.usdValue), 0);
        const stableUsd = Math.max(
            stableRowsUsd,
            Math.max(0, Number(currentPortfolio.cashbalance || 0)),
        );

        const nonStableFunding = fundingRows
            .filter((entry) =>
                !entry.isStable &&
                !entry.isGasReserve &&
                comparableTradeSymbol(entry.symbol) !== targetComparable &&
                entry.price > 0 &&
                entry.amount > 0 &&
                entry.usdValue > 5 &&
                supportedSymbols.has(entry.symbol),
            )
            .filter((entry) => {
                if (!(!isDemoMode && targetExecutionChainId === 56 && entry.symbol === "BNB")) return true;
                return entry.usdValue > (BNB_GAS_RESERVE_USD + minOrderUsd);
            })
            .filter((entry) => !preferredSymbols || preferredSymbols.has(entry.symbol))
            .sort((left, right) => {
                const leftPriority = left.symbol === "BNB" ? 1 : 0;
                const rightPriority = right.symbol === "BNB" ? 1 : 0;
                if (leftPriority !== rightPriority) return rightPriority - leftPriority;
                return right.usdValue - left.usdValue;
            });

        if (stableUsd >= safeDesiredUsd * 1.003) {
            return {
                sourceSymbol: undefined,
                budgetUsd: Math.min(safeDesiredUsd, stableUsd * 0.95),
            };
        }

        if (stableUsd >= minOrderUsd) {
            return {
                sourceSymbol: undefined,
                budgetUsd: Math.max(
                    minOrderUsd,
                    Math.min(safeDesiredUsd, stableUsd * 0.95),
                ),
            };
        }

        if (nonStableFunding.length === 0) {
            const stableOnlyBudget = Math.min(safeDesiredUsd, stableUsd);
            if (stableOnlyBudget < minOrderUsd) {
                return { sourceSymbol: undefined, budgetUsd: 0 };
            }
            return { sourceSymbol: undefined, budgetUsd: stableOnlyBudget };
        }

        const chosen = nonStableFunding[0];
        const fundingFraction = stableUsd > 0 ? 0.65 : 0.8;
        const budgetFromToken = Math.min(chosen.usdValue * fundingFraction, Math.max(minOrderUsd + 0.2, safeDesiredUsd));
        if (budgetFromToken < minOrderUsd) {
            return { sourceSymbol: undefined, budgetUsd: 0 };
        }
        return {
            sourceSymbol: chosen.symbol,
            budgetUsd: budgetFromToken,
        };
    }, [getExecutionSupportedSymbols, getUsdPrice, isDemoMode, effectiveChainId, walletHoldings]);

    const runAiStrategyAudit = useCallback(async () => {
        if (!STRATEGY_CONFIG.OPENAI_STRATEGY_AUDIT_ENABLED) return null;
        if (typeof window === "undefined") return null;
        if (!liveStrategyMonitor) return null;
        if (aiAuditInFlightRef.current) return null;
        const now = Date.now();
        if (now - lastAiAuditAtRef.current < STRATEGY_CONFIG.OPENAI_STRATEGY_AUDIT_INTERVAL_MS) return null;

        aiAuditInFlightRef.current = true;
        try {
            const latestFixedUpdate = newMuchUpdates.find((entry) => entry.kind === "daily-fixed") || null;
            const latestEvaluationUpdate = newMuchUpdates.find((entry) => entry.kind === "market-update") || null;
            const holdingsSummary = {
                totalRows: walletHoldings.length,
                combinedUsd: Number(walletHoldings.reduce((sum, row) => sum + row.usdValue, 0).toFixed(2)),
                topRows: walletHoldings
                    .filter((row) => !row.isGasReserve)
                    .sort((left, right) => right.usdValue - left.usdValue)
                    .slice(0, 8)
                    .map((row) => ({
                        symbol: row.symbol,
                        displaySymbol: row.displaySymbol || row.symbol,
                        chain: row.chain,
                        usdValue: Number(row.usdValue.toFixed(2)),
                        amount: Number(row.amount.toFixed(6)),
                        stable: row.isStable,
                    })),
            };
            const performanceWindow = strategyPerformanceSummary.windows["24h"];
            const liveSnapshot = {
                lastAutoPilotStatus,
                liveMonitor: {
                    monitoredAt: liveStrategyMonitor.monitoredAt,
                    currentBlock: liveStrategyMonitor.currentBlock,
                    prefilterMode: liveStrategyMonitor.stats.prefilterMode,
                    prefilterPassCount: liveStrategyMonitor.stats.prefilterPassCount,
                    readyCount: liveStrategyMonitor.stats.readyCount,
                    armedCount: liveStrategyMonitor.stats.armedCount,
                    triggeredCount: liveStrategyMonitor.stats.triggeredCount,
                    selectionEligibleCount: liveStrategyMonitor.stats.selectionEligibleCount,
                    selectedCount: liveStrategyMonitor.stats.selectedCount,
                    orderArmedCount: liveStrategyMonitor.stats.orderArmedCount,
                    selectedOrderBlockedCount: liveStrategyMonitor.stats.selectedOrderBlockedCount,
                    finalAlignmentWaitCount: liveStrategyMonitor.stats.finalAlignmentWaitCount,
                    waitingForSlotCount: liveStrategyMonitor.stats.waitingForSlotCount,
                    ordersTodayCount: liveStrategyMonitor.stats.ordersTodayCount,
                    topBlockers: liveStrategyMonitor.stats.selectedOrderBlockedReasons?.slice(0, 5) || [],
                    selectedRows: liveStrategyMonitor.selected.slice(0, 5).map((candidate) => ({
                        symbol: candidate.symbol,
                        chain: candidate.chain,
                        score: candidate.score,
                        triggerState: candidate.triggerState,
                        positionSizeLabel: candidate.positionSizeLabel,
                        blocker: candidate.orderGateReason || candidate.mainReason || null,
                    })),
                },
                newMuch: {
                    latestFixedSlot: latestFixedUpdate?.announcementSlot || null,
                    latestEvaluationSlot: latestEvaluationUpdate?.announcementSlot || null,
                    intradayPromotedCount: summarizeIntradayPromoted(latestEvaluationUpdate).count,
                },
            };
            const performanceSummaryPayload = {
                today: strategyPerformanceSummary.windows.today,
                trailing24h: {
                    triggered: performanceWindow.triggeredCount,
                    selected: performanceWindow.selectedCount,
                    orders: performanceWindow.orderCount,
                    fills: performanceWindow.fillCount,
                    winRate: performanceWindow.winRate,
                    totalPnlUsd: performanceWindow.totalPnl,
                },
                topFailures: performanceWindow.topFailures.slice(0, 5),
                routeBreakdown: Object.entries(performanceWindow.byRoute).map(([routeType, bucket]) => ({
                    routeType,
                    fills: bucket.fills,
                    pnl: bucket.totalPnl,
                    winRate: bucket.winRate,
                })).slice(0, 5),
                regimeBreakdown: Object.entries(performanceWindow.byRegime).map(([regime, bucket]) => ({
                    regime,
                    fills: bucket.fills,
                    pnl: bucket.totalPnl,
                    winRate: bucket.winRate,
                })).slice(0, 5),
            };
            const portfolioSummary = {
                totalValueUsd: Number((portfolio.totalValue || 0).toFixed(2)),
                cashbalanceUsd: Number((portfolio.cashbalance || 0).toFixed(2)),
                positions: portfolio.positions.slice(0, 8).map((position) => ({
                    symbol: position.symbol,
                    amount: Number(position.amount.toFixed(6)),
                    entryPrice: Number(position.entryPrice.toFixed(6)),
                    currentPrice: Number(getUsdPrice(position.symbol).toFixed(6)),
                    pnl: Number(((getUsdPrice(position.symbol) - position.entryPrice) * position.amount).toFixed(2)),
                })),
            };
            const response = await fetch("/api/ai/improvements/audit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerId: getLiveOwnerId(),
                    notifyEmail: user?.email || undefined,
                    walletConnected: effectiveIsConnected,
                    autoTradeActive: Boolean(isAutoPilotEnabled),
                    allowExceptionNotify: false,
                    liveSnapshot,
                    holdingsSummary,
                    performanceSummary: performanceSummaryPayload,
                    portfolioSummary,
                }),
            });
            if (!response.ok) {
                throw new Error(`audit request failed: ${response.status}`);
            }
            const data = await response.json().catch(() => null);
            if (data?.runtimeOverrides) {
                setRuntimeStrategyConfigOverrides(data.runtimeOverrides as RuntimeStrategyConfigOverrides);
                lastAiRuntimeConfigSyncAtRef.current = now;
            }
            if (data?.strategyMode) {
                setStoredStrategyMode(normalizeStrategyMode(data.strategyMode));
            }
            lastAiAuditAtRef.current = now;
            return data;
        } catch (error) {
            console.error("[ai/improvements/audit] Failed to run strategy audit:", error);
            return null;
        } finally {
            aiAuditInFlightRef.current = false;
        }
    }, [
        getLiveOwnerId,
        getUsdPrice,
        effectiveIsConnected,
        lastAutoPilotStatus,
        liveStrategyMonitor,
        isAutoPilotEnabled,
        newMuchUpdates,
        portfolio,
        strategyPerformanceSummary,
        user?.email,
        walletHoldings,
    ]);

    useEffect(() => {
        if (!STRATEGY_CONFIG.OPENAI_STRATEGY_AUDIT_ENABLED) return undefined;
        if (!effectiveIsConnected || !isAutoPilotEnabled) return undefined;
        void runAiStrategyAudit();
        const timer = setInterval(() => {
            if (!effectiveIsConnected || !isAutoPilotEnabled) return;
            void runAiStrategyAudit();
        }, STRATEGY_CONFIG.OPENAI_STRATEGY_AUDIT_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [effectiveIsConnected, isAutoPilotEnabled, runAiStrategyAudit]);

    const serializeStrategyShape = useCallback((proposal: StrategyProposal) => JSON.stringify({
        block: proposal.durationBlock,
        basket: (proposal.symbolPlans || []).map((plan) => ({
            symbol: plan.symbol,
            weight: Number(plan.weight.toFixed(4)),
            rank: plan.rank,
            mode: plan.mode,
            entryMin: Number(plan.entryMin.toFixed(6)),
            entryMax: Number(plan.entryMax.toFixed(6)),
            takeProfit: Number(plan.plannedTakeProfit.toFixed(6)),
            stopLoss: Number(plan.plannedStopLoss.toFixed(6)),
        })),
        settlement: proposal.settlementSymbol,
        mode: proposal.mode,
    }), []);

    const buildStrategyProposalFromPlan = useCallback((dayKey: string, plan: CyclePlanDraft, index: number): StrategyProposal => {
        const topPlan = plan.symbolPlans[0];
        const entryCenter = topPlan ? average([topPlan.entryMin, topPlan.entryMax]) : 0;
        const stopLossPct = topPlan && entryCenter > 0
            ? -Math.abs(((entryCenter - topPlan.plannedStopLoss) / entryCenter) * 100)
            : stopLossThreshold;
        const takeProfitPct = topPlan && entryCenter > 0
            ? Math.abs(((topPlan.plannedTakeProfit - entryCenter) / entryCenter) * 100)
            : takeProfitThreshold;

        return {
            id: `auto-daily-${dayKey}-${plan.block.replace(":", "").replace("-", "_")}`,
            agentId: "coordinator",
            title: `${plan.block} 採用バスケット戦略`,
            description: plan.symbolPlans.length
                ? `${plan.block} は ${plan.symbolPlans.map((item) => `${displayStrategySymbol(item)} ${Math.round(item.weight * 100)}%`).join(" / ")} を採用します。利確・損切り・保有整理以外は採用バスケット内だけを売買します。`
                : `${plan.block} は明確な優位性がないため見送りです。`,
            status: "ACTIVE",
            timestamp: Date.now() + index,
            dayKey,
            durationBlock: plan.block,
            assetSymbol: topPlan?.displaySymbol || topPlan?.symbol,
            pairLabel: plan.symbolPlans.map((item) => displayStrategySymbol(item)).join(" / "),
            basketItems: plan.symbolPlans.map((item) => ({
                symbol: item.symbol,
                displaySymbol: item.displaySymbol,
                chain: item.chain,
                weight: item.weight,
                source: item.source,
            })),
            symbolPlans: plan.symbolPlans.map((item) => ({
                symbol: item.symbol,
                displaySymbol: item.displaySymbol,
                chain: item.chain,
                executionChain: item.executionChain,
                executionChainId: item.executionChainId,
                executionAddress: item.executionAddress,
                executionDecimals: item.executionDecimals,
                executionRouteKind: item.executionRouteKind,
                executionSource: item.executionSource,
                executionPairUrl: item.executionPairUrl,
                weight: item.weight,
                source: item.source,
                rank: item.rank,
                mode: item.mode,
                positionSizeMultiplier: item.positionSizeMultiplier,
                positionSizeLabel: item.positionSizeLabel,
                plannedEntryAt: item.plannedEntryAt,
                plannedExitAt: item.plannedExitAt,
                entryMin: item.entryMin,
                entryMax: item.entryMax,
                plannedTakeProfit: item.plannedTakeProfit,
                plannedStopLoss: item.plannedStopLoss,
                reasonTags: item.reasonTags,
                indicatorNotes: item.indicatorNotes,
                score: item.score,
            })),
            candidateSnapshots: plan.topCandidates.map((candidate) => ({
                symbol: candidate.symbol,
                displaySymbol: candidate.displaySymbol,
                chain: candidate.chain,
                tier: candidate.tier,
                price: candidate.price,
                marketScore: candidate.marketScore,
                score: candidate.score,
                rawScore: candidate.rawScore,
                weightedScore: candidate.weightedScore,
                maxPossibleScore: candidate.maxPossibleScore,
                status: candidate.status,
                executionStatus: candidate.executionStatus,
                tradeDecision: candidate.tradeDecision,
                positionSizeMultiplier: candidate.positionSizeMultiplier,
                positionSizeLabel: candidate.positionSizeLabel,
                halfSizeEligible: candidate.halfSizeEligible,
                fullSizeEligible: candidate.fullSizeEligible,
                aHalfSizeEligible: candidate.aHalfSizeEligible,
                bHalfSizeEligible: candidate.bHalfSizeEligible,
                selectionEligible: candidate.selectionEligible,
                conditionalReferencePass: candidate.conditionalReferencePass,
                relativeStrengthPercentile: candidate.relativeStrengthPercentile,
                volumeConfirmed: candidate.volumeConfirmed,
                routeMissing: candidate.routeMissing,
                seedFallback: candidate.seedFallback,
                rrCheck: candidate.rrCheck,
                rrStatus: candidate.rrStatus,
                resistanceStatus: candidate.resistanceStatus,
                halfSizeMinRr: candidate.halfSizeMinRr,
                correlationRejected: candidate.correlationRejected,
                finalSelectedEligible: candidate.finalSelectedEligible,
                finalRejectReason: candidate.finalRejectReason,
                rank: candidate.rank,
                mode: candidate.mode,
                correlationGroup: candidate.correlationGroup,
                veto: candidate.veto,
                vetoPass: candidate.vetoPass,
                vetoReasons: candidate.vetoReasons,
                selectionStage: candidate.selectionStage,
                thresholdGap: candidate.thresholdGap,
                exclusionReason: candidate.exclusionReason,
                autoTradeExcludedReason: candidate.autoTradeExcludedReason,
                mainReason: candidate.mainReason,
                reasonTags: candidate.reasonTags,
                indicatorNotes: candidate.indicatorNotes,
                scoreBreakdown: candidate.scoreBreakdown,
                liquidity: candidate.liquidity,
                spreadBps: candidate.spreadBps,
                historyBars: candidate.historyBars,
                dataCompleteness: candidate.dataCompleteness,
                universeRankScore: candidate.universeRankScore,
                contractAddress: candidate.contractAddress,
                dexPairUrl: candidate.dexPairUrl,
                executionSupported: candidate.executionSupported,
                executionChain: candidate.executionChain,
                executionChainId: candidate.executionChainId,
                executionAddress: candidate.executionAddress,
                executionDecimals: candidate.executionDecimals,
                executionRouteKind: candidate.executionRouteKind,
                executionSource: candidate.executionSource,
                executionPairUrl: candidate.executionPairUrl,
                executionLiquidityUsd: candidate.executionLiquidityUsd,
                executionVolume24hUsd: candidate.executionVolume24hUsd,
                executionTxns1h: candidate.executionTxns1h,
                marketSource: candidate.marketSource,
                supportDistancePct: candidate.supportDistancePct,
                resistanceDistancePct: candidate.resistanceDistancePct,
                atrPct: candidate.atrPct,
                volumeRatio: candidate.volumeRatio,
                relativeStrengthScore: candidate.relativeStrengthScore,
                confidence: candidate.confidence,
            })),
            selectionStats: plan.selectionStats,
            settlementSymbol: plan.settlementSymbol,
            rankSummary: plan.rankSummary,
            mode: plan.mode,
            agentScenarios: plan.agentScenarios,
            proposedSettings: {
                riskTolerance: plan.symbolPlans.some((item) => item.rank === "A") ? 4 : 3,
                stopLoss: Number(stopLossPct.toFixed(2)),
                takeProfit: Number(takeProfitPct.toFixed(2)),
            },
        };
    }, [stopLossThreshold, takeProfitThreshold]);

    const writeAutoStrategySnapshot = useCallback((dayKey: string, strategies: StrategyProposal[]) => {
        if (typeof window === "undefined") return;
        localStorage.setItem(DAILY_STRATEGY_STORAGE_KEY, JSON.stringify({ dayKey, strategies }));
    }, []);

    const upsertAutoStrategies = useCallback((dayKey: string, strategies: StrategyProposal[]) => {
        const autoIds = new Set(strategies.map((item) => item.id));
        setStrategyProposals((prev) => {
            const manual = prev.filter((proposal) => !proposal.id.startsWith("auto-daily-"));
            return [...strategies, ...manual].slice(0, 32);
        });
        setActiveStrategies((prev) => {
            const manual = prev.filter((proposal) => !proposal.id.startsWith("auto-daily-") || !autoIds.has(proposal.id));
            return [...strategies, ...manual].slice(0, 16);
        });
        writeAutoStrategySnapshot(dayKey, strategies);
    }, [writeAutoStrategySnapshot]);

    const refreshDailyStrategyProposals = useCallback((trigger: "timer" | "manual" | "symbol-change" = "timer") => {
        if (!isStrategyCandleStoreReady) return;

        const now = Date.now();
        const dayKey = getJstDateKey(now);
        const { hour, minute } = getJstHourMinute(now);
        const allowDailyReset = !(hour === 0 && minute < 1);
        const fixedAnalysisTs = getJstAnchorTs(dayKey, 0, 1);

        let storedDayKey = "";
        let storedStrategies: StrategyProposal[] = [];
        if (typeof window !== "undefined") {
            try {
                const storedRaw = localStorage.getItem(DAILY_STRATEGY_STORAGE_KEY);
                if (storedRaw) {
                    const parsed = JSON.parse(storedRaw) as { dayKey?: string; strategies?: StrategyProposal[] };
                    storedDayKey = parsed?.dayKey || "";
                    storedStrategies = Array.isArray(parsed?.strategies) ? normalizeStoredStrategies(parsed.strategies) : [];
                }
            } catch {
                storedDayKey = "";
                storedStrategies = [];
            }
        }

        const hasTodayPlan = storedDayKey === dayKey && storedStrategies.length > 0;
        const hasUsableTodayPlan = hasTodayPlan && hasStrategySnapshotData(storedStrategies);
        const storedScoreCalculatedCount = storedStrategies.reduce((sum, strategy) => sum + (strategy.selectionStats?.scoreCalculatedCount || 0), 0);
        const storedMinUniverseCount = storedStrategies.reduce((min, strategy) => {
            const count = strategy.selectionStats?.monitoredUniverseCount || strategy.selectionStats?.universeCount || 0;
            return Math.min(min, count);
        }, Number.POSITIVE_INFINITY);
        const storedMinPrefilterCount = storedStrategies.reduce((min, strategy) => {
            const count = strategy.selectionStats?.prefilterPassCount || strategy.selectionStats?.marketDataPassCount || 0;
            return Math.min(min, count);
        }, Number.POSITIVE_INFINITY);
        const snapshotLooksSparse = Number.isFinite(storedMinUniverseCount) && (
            storedMinUniverseCount < Math.min(40, STRATEGY_CONFIG.UNIVERSE_MAX_SIZE / 2)
            || storedMinPrefilterCount < 4
        );
        if (!hasTodayPlan && !allowDailyReset) {
            if (storedStrategies.length > 0) {
                upsertAutoStrategies(storedDayKey || dayKey, storedStrategies);
            }
            return;
        }

        if (!hasUsableTodayPlan || storedScoreCalculatedCount === 0 || snapshotLooksSparse) {
            const draft = buildStrategyEngineResult(fixedAnalysisTs);
            const strategies = draft.plans.map((plan, index) => buildStrategyProposalFromPlan(dayKey, plan, index));
            upsertAutoStrategies(dayKey, strategies);
            const dailyUpdateId = `newmuch-${dayKey}-daily-fixed`;
            if (!newMuchUpdates.some((entry) => entry.id === dailyUpdateId)) {
                pushNewMuchUpdate({
                    id: dailyUpdateId,
                    title: "NewMuch 00:01 固定戦略",
                    summary: "本日のストラテジーを 00:01 JST 基準で固定しました。/strategy の採用バスケットは本日中変更せず、相場評価の変化だけを NewMuch で追跡します。",
                    createdAt: now,
                    announcementSlot: "00:01固定",
                    kind: "daily-fixed",
                    changedBlocks: strategies.map((strategy) => ({
                        block: strategy.durationBlock || DAILY_STRATEGY_BLOCKS[0],
                        previousBasket: "未設定",
                        nextBasket: (strategy.symbolPlans || []).map((item) => `${displayStrategySymbol(item)} ${item.positionSizeLabel || "0x"}`).join(" / ") || "見送り",
                        reason: `${strategy.durationBlock} の固定バスケットを確定しました。`,
                    })),
                    evaluationChanges: [],
                    strategies,
                });
            }
            lastStrategyRefreshRef.current = now;
            if (trigger !== "timer") {
                addMessage("coordinator", "日次ストラテジーを 00:01 JST 基準で固定しました。", "SYSTEM");
            }
            return;
        }

        upsertAutoStrategies(dayKey, storedStrategies);
        const fresh = buildStrategyEngineResult(now);
        const freshStrategies = fresh.plans.map((plan, index) => buildStrategyProposalFromPlan(dayKey, plan, index));
        const storedByBlock = new Map(storedStrategies.map((strategy) => [strategy.durationBlock, strategy]));
        const promotedStrategies = freshStrategies.map((strategy) => {
            const intradayPromoted = buildIntradayPromotedFromMonitor(
                storedByBlock.get(strategy.durationBlock),
                liveStrategyMonitorRef.current,
            );
            return intradayPromoted.length > 0
                ? { ...strategy, intradayPromoted }
                : strategy;
        });
        const latestSameDayUpdate = newMuchUpdates.find((entry) => getJstDateKey(entry.createdAt) === dayKey && entry.kind === "market-update");
        const baselineStrategies = latestSameDayUpdate?.strategies?.length ? latestSameDayUpdate.strategies : storedStrategies;
        const baselineByBlock = new Map(baselineStrategies.map((strategy) => [strategy.durationBlock, strategy]));

        const evaluationChanges = promotedStrategies
            .map((strategy) => buildNewMuchHighlights(
                baselineByBlock.get(strategy.durationBlock),
                strategy,
                storedByBlock.get(strategy.durationBlock),
            ))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

        if (evaluationChanges.length > 0) {
            const promotedBlocks = evaluationChanges.filter((entry) => (entry.intradayPromoted || []).length > 0).map((entry) => entry.block);
            pushNewMuchUpdate({
                id: `newmuch-${dayKey}-${formatJstTimeLabel(now).replace(":", "")}-${evaluationChanges.map((entry) => entry.block.replace(/[^0-9]/g, "")).join("_")}`,
                title: `NewMuch ${formatJstTimeLabel(now)}`,
                summary: promotedBlocks.length > 0
                    ? `固定バスケットは据え置きのまま、${evaluationChanges.map((entry) => entry.block).join(" / ")} を再評価しました。${promotedBlocks.join(" / ")} は fixed empty のため intraday promotion を追加しています。`
                    : `固定バスケットは据え置きのまま、${evaluationChanges.map((entry) => entry.block).join(" / ")} の相場評価を更新しました。`,
                createdAt: now,
                announcementSlot: formatJstTimeLabel(now),
                kind: "market-update",
                changedBlocks: [],
                evaluationChanges,
                strategies: promotedStrategies.filter((strategy) =>
                    evaluationChanges.some((entry) => entry.block === strategy.durationBlock),
                ),
            });
        }

        lastStrategyRefreshRef.current = now;
    }, [addMessage, buildStrategyEngineResult, buildStrategyProposalFromPlan, isStrategyCandleStoreReady, newMuchUpdates, pushNewMuchUpdate, upsertAutoStrategies]);

    useEffect(() => {
        if (lastStrategyRefreshRef.current === 0) {
            refreshDailyStrategyProposals("timer");
        }
    }, [refreshDailyStrategyProposals]);

    useEffect(() => {
        if (typeof window === "undefined" || liveStrategyMonitorRef.current) return;
        try {
            const raw = localStorage.getItem(LIVE_STRATEGY_MONITOR_STORAGE_KEY);
            if (!raw) return;
            const parsed = hydrateStoredLiveStrategyMonitor(JSON.parse(raw));
            if (!parsed) return;
            if (parsed?.dayKey === getJstDateKey()) {
                setLiveStrategyMonitor(parsed);
                liveStrategyMonitorRef.current = parsed;
            }
        } catch {
            try {
                localStorage.removeItem(LIVE_STRATEGY_MONITOR_STORAGE_KEY);
            } catch {}
        }
    }, []);

    useEffect(() => {
        if (!realPricesLoaded || !isStrategyCandleStoreReady || strategyPriceHydratedRef.current) return;
        strategyPriceHydratedRef.current = true;
        refreshDailyStrategyProposals("manual");
        refreshContinuousStrategyMonitor("manual");
    }, [isStrategyCandleStoreReady, realPricesLoaded, refreshContinuousStrategyMonitor, refreshDailyStrategyProposals]);

    useEffect(() => {
        if (lastStrategyCurrencyRef.current === selectedCurrency) return;
        lastStrategyCurrencyRef.current = selectedCurrency;
        refreshDailyStrategyProposals("symbol-change");
        refreshContinuousStrategyMonitor("market");
    }, [refreshContinuousStrategyMonitor, refreshDailyStrategyProposals, selectedCurrency]);

    useEffect(() => {
        if (!forceProposal) return;
        refreshDailyStrategyProposals("manual");
        refreshContinuousStrategyMonitor("manual");
        setForceProposal(false);
    }, [forceProposal, refreshContinuousStrategyMonitor, refreshDailyStrategyProposals]);

    useEffect(() => {
        if (!isSimulating) return;
        const interval = setInterval(() => {
            if (Date.now() - lastStrategyRefreshRef.current > 15 * 60 * 1000) {
                refreshDailyStrategyProposals("timer");
            }
            if (Date.now() - lastLiveStrategyMonitorRefreshRef.current > STRATEGY_CONFIG.TRIGGER_REFRESH_MINUTES * 60 * 1000) {
                refreshContinuousStrategyMonitor("timer");
            }
        }, 60 * 1000);
        return () => clearInterval(interval);
    }, [isSimulating, refreshContinuousStrategyMonitor, refreshDailyStrategyProposals]);

    useEffect(() => {
        if (!isStrategyCandleStoreReady) return;
        refreshContinuousStrategyMonitor("market");
    }, [crossChainOrders.length, isStrategyCandleStoreReady, portfolio.positions.length, refreshContinuousStrategyMonitor, transactions.length]);

    useEffect(() => {
        marketDataRef.current = marketData;
    }, [marketData]);

    useEffect(() => {
        portfolioRef.current = portfolio;
    }, [portfolio]);

    useEffect(() => {
        agentsRef.current = agents;
    }, [agents]);

    // Learning System
    const [learningParams, setLearningParams] = useState<LearningParams>({
        rsiWeight: 1.0,
        macdWeight: 1.0,
        sentimentWeight: 1.0,
        securityWeight: 1.0,
        fundamentalWeight: 1.0,
        winRate: 0.5,
        totalTrades: 0,
    });
    const [marketRegime, setMarketRegime] = useState<"TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE">("RANGE");

    useEffect(() => {
        const stored = localStorage.getItem("jdex_learning_params");
        if (stored) {
            try { setLearningParams(JSON.parse(stored)); } catch (e) { }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem("jdex_learning_params", JSON.stringify(learningParams));
    }, [learningParams]);

    const provideTradeFeedback = useCallback((txId: string, feedback: "GOOD" | "BAD") => {
        setTransactions(prev => prev.map(tx => {
            if (tx.id === txId) {
                return { ...tx, feedback };
            }
            return tx;
        }));

        // Update Learning Params based on feedback
        const isGood = feedback === "GOOD";
        const multiplier = isGood ? 1.05 : 0.95;

        setLearningParams(prev => ({
            ...prev,
            rsiWeight: Math.max(0.1, Math.min(2.0, parseFloat((prev.rsiWeight * multiplier).toFixed(2)))),
            macdWeight: Math.max(0.1, Math.min(2.0, parseFloat((prev.macdWeight * multiplier).toFixed(2)))),
            sentimentWeight: Math.max(0.1, Math.min(2.0, parseFloat((prev.sentimentWeight * multiplier).toFixed(2)))),
            totalTrades: prev.totalTrades + 1,
        }));

        addMessage("manager", "学習フィードバックを反映し、内部パラメータを調整しました: " + feedback, "SYSTEM");
    }, [addMessage]);

    const getCrossChainShadowPositions = useCallback(() => {
        return Object.values(crossChainShadowPositionsRef.current).map((position) => ({
            symbol: position.symbol,
            amount: position.amount,
            entryPrice: position.entryPrice,
            highestPrice: position.highestPrice,
            reason: position.reason,
            exitStrategy: position.exitStrategy,
        }));
    }, []);

    const upsertCrossChainOrder = useCallback((nextOrder: CrossChainExecutionOrder) => {
        setCrossChainOrders((prev) => {
            const filtered = prev.filter((order) => order.executionId !== nextOrder.executionId);
            return [nextOrder, ...filtered].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 100);
        });
    }, []);

    const mergeCrossChainOrder = useCallback((executionId: string, patch: Partial<CrossChainExecutionOrder>) => {
        setCrossChainOrders((prev) => prev.map((order) => {
            if (order.executionId !== executionId) return order;
            return {
                ...order,
                ...patch,
                updatedAt: Number(patch.updatedAt || Date.now()),
            };
        }));
    }, []);

    const executeTrade = useCallback(async (
        tokenSymbol: string,
        action: "BUY" | "SELL",
        amount: number,
        price: number,
        reason?: string,
        dex?: string,
        fundingSymbol?: string,
        executionOverride?: TradeExecutionOverride,
        tradeMeta?: TradeExecutionMeta,
    ): Promise<boolean> => {
        // --- HARD STOP (temporary) ---
        // Mitigation: Setting to false as we are implementing robust locks
        const HARD_STOP_TRADING = false;

        if (tradeExecutionLockRef.current || tradeInProgress) {
            console.warn("[TRADE_BLOCKED] Trade already in progress. Skipping duplicate request.", { tokenSymbol, action });
            return false;
        }

        console.warn("[UI_TRADE_CLICK]", {
            symbol: tokenSymbol,
            action,
            amount,
            price,
            reason,
            fundingSymbol,
            executionOverride,
            tradeMeta,
            ts: Date.now(),
            walletConnected: effectiveIsConnected,
            chainId: effectiveChainId,
        });

        if (HARD_STOP_TRADING) {
            console.warn("[TRADE_BLOCKED] HARD_STOP_TRADING is enabled. No request will be sent.");
            addMessage("SYSTEM", "[取引制限] 自動トレードは現在メンテナンス中のため停止しています。", "ALERT");
            return false;
        }

        const currentDemoMode = isDemoMode || typeof window !== 'undefined' && localStorage.getItem("jdex_demo_mode") === "true";
        const IS_PROD = process.env.NODE_ENV === "production";

        // [LOCK GUARD] Prevent concurrent trades
        if (tradeExecutionLockRef.current || tradeInProgress) {
            console.warn("[TRADE_BLOCKED] Trade already in progress.");
            return false;
        }

        // Set lock early
        tradeExecutionLockRef.current = true;
        setTradeInProgress(true);

        if (IS_PROD && reason?.startsWith("IMMEDIATE_TEST_TRIGGER")) {
            console.log("[SAFEGUARD] Immediate test trade " + action + " " + tokenSymbol + " blocked in Production.");
            setTradeInProgress(false);
            return false;
        }

        if (!effectiveIsConnected && !currentDemoMode) {
            addMessage("SYSTEM", "[警告] ウォレット未接続です。トレードを開始するにはウォレットを接続してください。", "ALERT");
            console.log('[DEBUG] executeTrade: Stopped - Wallet not connected.');
            setTradeInProgress(false);
            return false;
        }

        const now = Date.now();
        if (now < nextTradeAllowedAtRef.current) {
            const remaining = Math.ceil((nextTradeAllowedAtRef.current - now) / 1000);
            addMessage("SYSTEM", "[制限中] 発注クールダウン中です。あと " + remaining + " 秒待ってください。", "ALERT");
            setTradeInProgress(false);
            return false;
        }
        if (now - lastTradeErrorTime.current < 5000) {
            const remaining = Math.ceil((5000 - (now - lastTradeErrorTime.current)) / 1000);
            addMessage("SYSTEM", "[制限中] 連続発注を抑制しています。あと " + remaining + " 秒待ってください。", "ALERT");
            setTradeInProgress(false);
            return false;
        }

        const normalizedTokenSymbol = normalizeTrackedSymbol(tokenSymbol);
        const normalizedFundingSymbol = fundingSymbol ? normalizeTrackedSymbol(fundingSymbol) : undefined;
        if (!currentDemoMode && tradeMeta?.autoTradeTarget && tradeMeta.reviewApproved !== true) {
            addMessage("SYSTEM", "[AI審査] 事前審査を通っていない自動売買注文は実行しません。", "ALERT");
            setTradeInProgress(false);
            tradeExecutionLockRef.current = false;
            return false;
        }
        const marketExecutionOverride = (() => {
            const quote = allMarketPricesRef.current[normalizedTokenSymbol];
            if (!quote?.executionAddress) return undefined;
            return {
                chain: quote.executionChain,
                chainId: quote.executionChainId,
                address: quote.executionAddress,
                decimals: quote.executionDecimals,
                routeKind: quote.executionRouteKind,
                source: quote.executionSource,
            } satisfies TradeExecutionOverride;
        })();
        const effectiveExecutionOverride = executionOverride?.address ? executionOverride : marketExecutionOverride;
        const effectiveTradeChainId = effectiveExecutionOverride?.chainId || effectiveChainId;
        const effectiveRouteKind = effectiveExecutionOverride?.routeKind || marketExecutionOverride?.routeKind;
        const isCrossChainExecution = effectiveRouteKind === "cross-chain";
        const executionAwarePrice = getExecutionAwareUsdPrice(normalizedTokenSymbol, effectiveRouteKind);
        const tradePrice = Number.isFinite(executionAwarePrice) && executionAwarePrice > 0
            ? executionAwarePrice
            : ((price && price > 0) ? price : 0);
        const resolveExecutionTokenInfo = async (symbol: string, chainId: number, override?: TradeExecutionOverride) => {
            if (!override?.address) {
                return resolveToken(symbol, chainId);
            }

            let decimals = Number.isFinite(Number(override.decimals)) ? Number(override.decimals) : undefined;
            if (!decimals && publicClient && override.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
                try {
                    const rawDecimals = await publicClient.readContract({
                        address: override.address as `0x${string}`,
                        abi: erc20Abi,
                        functionName: "decimals",
                    });
                    decimals = Number(rawDecimals);
                } catch {
                    decimals = undefined;
                }
            }

            return {
                address: override.address,
                decimals: decimals ?? 18,
            };
        };
        const liveOrderTargets = getLiveOrderTargets(portfolioRef.current.totalValue || 0, jpyRate);
        const dynamicLiveMinOrderUsd = liveOrderTargets.minOrderUsd;
        const isAutoTriggeredOrder =
            (reason?.includes("自動トレードシグナル") ?? false)
            || (reason?.includes("戦略") ?? false)
            || (reason?.includes("自動") ?? false);

        if (action === "SELL") {
            const livePos = portfolioRef.current.positions.find(
                (p) => normalizeTrackedSymbol(p.symbol) === normalizedTokenSymbol,
            ) || (isCrossChainExecution ? crossChainShadowPositionsRef.current[normalizedTokenSymbol] : undefined);
            const livePrice = tradePrice || allMarketPrices[normalizedTokenSymbol]?.price || initialData[normalizedTokenSymbol]?.price || 0;
            const liveUsd = (livePos?.amount || 0) * Math.max(livePrice, 0);
            if (!livePos || livePos.amount <= 0 || liveUsd < 2) {
                addMessage(
                    "SYSTEM",
                    `${normalizedTokenSymbol} は保有残高が小さいため売却をスキップしました (約 ${liveUsd.toFixed(3)} USD)。`,
                    "ALERT",
                );
                setTradeInProgress(false);
                return false;
            }
        }

        const cooldownKey = `${normalizedTokenSymbol}:${action}`;
        const symbolCooldown = symbolCooldownRef.current[cooldownKey] || 0;
        if (now < symbolCooldown) {
            const remain = Math.ceil((symbolCooldown - now) / 1000);
            addMessage("SYSTEM", `[制限中] ${normalizedTokenSymbol} の${action}はクールダウン中です。あと ${remain} 秒`, "ALERT");
            setTradeInProgress(false);
            return false;
        }

        if (!currentDemoMode && effectiveTradeChainId && isAutoTriggeredOrder) {
            const preferredSymbols = LIVE_EXECUTION_PREFERRED_SYMBOLS[effectiveTradeChainId];
            if (preferredSymbols && !preferredSymbols.has(normalizedTokenSymbol)) {
                addMessage(
                    "SYSTEM",
                    `${normalizedTokenSymbol} は実行優先度が低いため、ルート取得に失敗した場合はスキップされます。`,
                    "SYSTEM",
                );
            }
        }

        if (!currentDemoMode && effectiveTradeChainId) {
            if (isCrossChainExecution) {
                try {
                    const routeSource = tradeMeta?.routeSource || effectiveExecutionOverride?.source || marketExecutionOverride?.source || "cross-chain-aggregator";
                    const executionChain = tradeMeta?.destinationChain || effectiveExecutionOverride?.chain || "SOLANA";
                    const sourceChain = action === "BUY" ? "BNB" : executionChain;
                    const destinationChain = action === "BUY" ? executionChain : "BNB";
                    const tradeSourceSymbol = action === "BUY"
                        ? (normalizedFundingSymbol || tradeMeta?.sourceToken || "USDT")
                        : normalizedTokenSymbol;
                    const tradeDestSymbol = action === "BUY"
                        ? (tradeMeta?.destinationToken || normalizedTokenSymbol)
                        : (normalizedFundingSymbol || "USDT");
                    const selectedReason = tradeMeta?.selectedReason || reason || `自動戦略: ${normalizedTokenSymbol} を cross-chain 実行`;
                    const sourceUsdNotional = Math.max(amount * Math.max(price, 0), 0);
                    const minLiveNotionalUsd = action === "SELL"
                        ? Math.max(2.0, dynamicLiveMinOrderUsd * 0.55)
                        : dynamicLiveMinOrderUsd;

                    if (sourceUsdNotional + 0.000001 < minLiveNotionalUsd) {
                        throw new Error(`発注額が小さすぎます (${tradeSourceSymbol} -> ${tradeDestSymbol}, ${sourceUsdNotional.toFixed(3)} USD / 最低 ${minLiveNotionalUsd.toFixed(1)} USD${reason ? `, 理由: ${reason}` : ""})`);
                    }

                    const idempotencyKey = [
                        "cross",
                        effectiveAddress || "wallet",
                        action,
                        tradeSourceSymbol,
                        tradeDestSymbol,
                        normalizedTokenSymbol,
                        Math.floor(Date.now() / 15_000),
                    ].join(":");
                    const payload = {
                        idempotencyKey,
                        pair: `${tradeSourceSymbol}/${tradeDestSymbol}`,
                        action,
                        amount,
                        price,
                        routeType: "cross-chain" as const,
                        routeSource,
                        sourceToken: tradeSourceSymbol,
                        destinationToken: tradeDestSymbol,
                        sourceChain,
                        destinationChain,
                        executionTarget: tradeMeta?.executionTarget || effectiveExecutionOverride?.address || marketExecutionOverride?.address,
                        aggregatorTarget: tradeMeta?.executionTarget || effectiveExecutionOverride?.address || marketExecutionOverride?.address,
                        positionSize: tradeMeta?.positionSizeLabel,
                        tradeDecision: tradeMeta?.tradeDecision,
                        selectedReason,
                        symbol: normalizedTokenSymbol,
                        autoTradeTarget: tradeMeta?.autoTradeTarget ?? isAutoTriggeredOrder,
                    };

                    addMessage("SYSTEM", `Cross-chain Aggregator で ${action === "BUY" ? "購入" : "売却"} を開始します。`, "SYSTEM");
                    const crossChainRes = await fetch("/api/trade/execute", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });
                    const crossChainData = await crossChainRes.json();
                    if (!crossChainRes.ok || !crossChainData?.ok) {
                        throw new Error(crossChainData?.error || "Cross-chain execution queue failed");
                    }
                    const executionId = String(crossChainData.executionId || "");
                    const orderId = String(crossChainData.orderId || executionId || "");
                    if (!executionId) {
                        throw new Error("Cross-chain execution id is missing");
                    }

                    recordStrategyExecution(normalizedTokenSymbol, {
                        kind: "order",
                        action,
                        timestamp: Date.now(),
                        orderId,
                        executionId,
                        success: crossChainData.status !== "failed" && crossChainData.status !== "cancelled",
                        failureReason: typeof crossChainData.failureReason === "string" ? crossChainData.failureReason : undefined,
                    }, tradeMeta);

                    upsertCrossChainOrder({
                        orderId,
                        executionId,
                        symbol: normalizedTokenSymbol,
                        action,
                        status: crossChainData.status || "accepted",
                        routeType: "cross-chain",
                        routeSource,
                        sourceToken: tradeSourceSymbol,
                        destinationToken: tradeDestSymbol,
                        sourceChain,
                        destinationChain,
                        executionTarget: String(payload.executionTarget || ""),
                        txHash: typeof crossChainData.txHash === "string" ? crossChainData.txHash : undefined,
                        executionReceipt: typeof crossChainData.executionReceipt === "string" ? crossChainData.executionReceipt : undefined,
                        failureReason: typeof crossChainData.failureReason === "string" ? crossChainData.failureReason : undefined,
                        positionSizeLabel: tradeMeta?.positionSizeLabel,
                        tradeDecision: tradeMeta?.tradeDecision,
                        selectedReason,
                        autoTradeTarget: Boolean(payload.autoTradeTarget),
                        positionApplied: false,
                        exitManaged: false,
                        queuedAt: Number(crossChainData.queuedAt || 0) || undefined,
                        submittedAt: Number(crossChainData.submittedAt || 0) || undefined,
                        completedAt: Number(crossChainData.completedAt || 0) || undefined,
                        cancelledAt: Number(crossChainData.cancelledAt || 0) || undefined,
                        testMode: Boolean(crossChainData.testMode || false),
                        testOutcome:
                            crossChainData.testOutcome === "failed"
                            || crossChainData.testOutcome === "cancelled"
                                ? crossChainData.testOutcome
                                : crossChainData.testMode
                                    ? "success"
                                    : undefined,
                        createdAt: Number(crossChainData.createdAt || Date.now()),
                        updatedAt: Number(crossChainData.updatedAt || Date.now()),
                    });

                    let terminalStatus: CrossChainExecutionOrder["status"] = crossChainData.status || "accepted";
                    let terminalTxHash = typeof crossChainData.txHash === "string" ? crossChainData.txHash : undefined;
                    let terminalFailureReason: string | undefined;
                    let pollCount = 0;

                    while (pollCount < 16 && isPendingCrossChainStatus(terminalStatus)) {
                        pollCount += 1;
                        await new Promise((resolve) => setTimeout(resolve, 1250));
                        const pollRes = await fetch(`/api/trade/execute?executionId=${encodeURIComponent(executionId)}`, {
                            method: "GET",
                            headers: { Accept: "application/json" },
                        });
                        const pollData = await pollRes.json();
                        if (!pollRes.ok || !pollData?.ok) {
                            terminalStatus = "failed";
                            terminalFailureReason = pollData?.error || "Cross-chain execution polling failed";
                            break;
                        }
                        terminalStatus = pollData.status || terminalStatus;
                        terminalTxHash = typeof pollData.txHash === "string" ? pollData.txHash : terminalTxHash;
                        terminalFailureReason = typeof pollData.failureReason === "string" ? pollData.failureReason : terminalFailureReason;
                        mergeCrossChainOrder(executionId, {
                            status: terminalStatus,
                            txHash: terminalTxHash,
                            executionReceipt: typeof pollData.executionReceipt === "string" ? pollData.executionReceipt : undefined,
                            failureReason: terminalFailureReason,
                            queuedAt: Number(pollData.queuedAt || 0) || undefined,
                            submittedAt: Number(pollData.submittedAt || 0) || undefined,
                            completedAt: Number(pollData.completedAt || 0) || undefined,
                            cancelledAt: Number(pollData.cancelledAt || 0) || undefined,
                            testMode: Boolean(pollData.testMode || false),
                            testOutcome:
                                pollData.testOutcome === "failed"
                                || pollData.testOutcome === "cancelled"
                                    ? pollData.testOutcome
                                    : pollData.testMode
                                        ? "success"
                                        : undefined,
                            updatedAt: Number(pollData.updatedAt || Date.now()),
                        });
                    }

                    if (isPendingCrossChainStatus(terminalStatus)) {
                        const cancelRes = await fetch("/api/trade/execute", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                executionId,
                                status: "cancelled",
                                failureReason: "Polling timeout",
                            }),
                        });
                        const cancelData = await cancelRes.json().catch(() => ({}));
                        terminalStatus = "cancelled";
                        terminalFailureReason = typeof cancelData?.failureReason === "string" ? cancelData.failureReason : "Polling timeout";
                        mergeCrossChainOrder(executionId, {
                            status: "cancelled",
                            failureReason: terminalFailureReason,
                            cancelledAt: Date.now(),
                            updatedAt: Date.now(),
                        });
                    }

                    if (terminalStatus !== "success") {
                        throw new Error(terminalFailureReason || `Cross-chain execution ${terminalStatus}`);
                    }

                    if (!terminalTxHash) {
                        mergeCrossChainOrder(executionId, {
                            status: "failed",
                            executionReceipt: "not-submitted",
                            failureReason: "実チェーンの tx hash が返らなかったため未約定として扱いました。",
                            positionApplied: false,
                            exitManaged: false,
                            completedAt: Date.now(),
                            updatedAt: Date.now(),
                        });
                        throw new Error("Cross-chain executor did not return a real on-chain tx hash");
                    }

                    const livePosition = portfolioRef.current.positions.find(
                        (position) => normalizeTrackedSymbol(position.symbol) === normalizedTokenSymbol,
                    ) || crossChainShadowPositionsRef.current[normalizedTokenSymbol];
                    const estimatedFeeUsd = Math.max(sourceUsdNotional * 0.0035, 0);
                    const realizedPnl = action === "SELL" && livePosition
                        ? ((price - livePosition.entryPrice) * amount) - estimatedFeeUsd
                        : undefined;
                    const pnlPct = action === "SELL" && livePosition?.entryPrice
                        ? (((price - livePosition.entryPrice) / livePosition.entryPrice) * 100)
                        : undefined;

                    if (action === "BUY") {
                        const previous = crossChainShadowPositionsRef.current[normalizedTokenSymbol];
                        const currentAmount = previous?.amount || 0;
                        const nextAmount = currentAmount + amount;
                        const nextEntryPrice = currentAmount > 0
                            ? ((previous?.entryPrice || price) * currentAmount + price * amount) / nextAmount
                            : price;
                        crossChainShadowPositionsRef.current[normalizedTokenSymbol] = {
                            symbol: normalizedTokenSymbol,
                            amount: nextAmount,
                            entryPrice: nextEntryPrice,
                            highestPrice: Math.max(previous?.highestPrice || 0, price),
                            reason: selectedReason,
                            exitStrategy: "Cross-chain auto-trade managed exit",
                            chain: "SOLANA",
                            routeKind: "cross-chain",
                            executionAddress: payload.executionTarget,
                            updatedAt: Date.now(),
                        };
                    } else {
                        const previous = crossChainShadowPositionsRef.current[normalizedTokenSymbol];
                        if (previous) {
                            const remaining = Math.max(0, previous.amount - amount);
                            if (remaining <= 0.000001) {
                                delete crossChainShadowPositionsRef.current[normalizedTokenSymbol];
                            } else {
                                crossChainShadowPositionsRef.current[normalizedTokenSymbol] = {
                                    ...previous,
                                    amount: remaining,
                                    highestPrice: Math.max(previous.highestPrice || 0, price),
                                    updatedAt: Date.now(),
                                };
                            }
                        }
                    }

                    mergeCrossChainOrder(executionId, {
                        status: "success",
                        txHash: terminalTxHash,
                        executionReceipt: "success",
                        failureReason: undefined,
                        positionApplied: true,
                        exitManaged: action === "BUY",
                        completedAt: Date.now(),
                        updatedAt: Date.now(),
                    });

                    const crossChainTx: Transaction = {
                        id: orderId,
                        agentId: "manager",
                        type: action,
                        symbol: normalizedTokenSymbol,
                        amount,
                        price,
                        timestamp: Date.now(),
                        txHash: terminalTxHash,
                        fee: estimatedFeeUsd,
                        pnl: realizedPnl,
                        pair: `${tradeSourceSymbol}/${tradeDestSymbol}`,
                        dex: "Cross-chain Aggregator",
                        chain: `${sourceChain} → ${destinationChain}`,
                        reason: selectedReason,
                        entryPrice: action === "BUY" ? tradePrice : livePosition?.entryPrice,
                        plannedTakeProfit: action === "BUY" ? tradePrice * (1 + takeProfitThreshold / 100) : undefined,
                        plannedStopLoss: action === "BUY" ? tradePrice * (1 + stopLossThreshold / 100) : undefined,
                        decisionSummary: selectedReason,
                        newsTitle: latestNews?.title,
                        routeType: "cross-chain",
                        routeSource,
                        sourceToken: tradeSourceSymbol,
                        destinationToken: tradeDestSymbol,
                        destinationChain,
                        executionTarget: String(payload.executionTarget || ""),
                        positionSizeLabel: tradeMeta?.positionSizeLabel,
                        tradeDecision: tradeMeta?.tradeDecision,
                        selectedReason,
                        autoTradeTarget: Boolean(payload.autoTradeTarget),
                        regime: tradeMeta?.regime,
                        triggerState: tradeMeta?.triggerState,
                        triggerType: tradeMeta?.triggerType,
                        score: tradeMeta?.score,
                        reviewReason: tradeMeta?.reviewReason,
                        reviewDetail: tradeMeta?.reviewDetail,
                        reviewStrategy: tradeMeta?.reviewStrategy,
                        reviewExitPlan: tradeMeta?.reviewExitPlan,
                        orderId,
                        executionId,
                        triggeredAt: tradeMeta?.triggeredAt,
                        selectedAt: tradeMeta?.selectedAt,
                        filledAt: action === "BUY" ? Date.now() : undefined,
                        exitedAt: action === "SELL" ? Date.now() : undefined,
                        exitReason: action === "SELL" ? (tradeMeta?.exitReason || deriveExitReason(reason)) : undefined,
                        pnlPct,
                        success: true,
                    };

                    setTransactions((prev) => [crossChainTx, ...prev].slice(0, 200));
                    recordStrategyExecution(normalizedTokenSymbol, {
                        kind: "fill",
                        action,
                        timestamp: crossChainTx.timestamp,
                        orderId,
                        executionId,
                        filledAt: action === "BUY" ? crossChainTx.timestamp : undefined,
                        exitedAt: action === "SELL" ? crossChainTx.timestamp : undefined,
                        exitReason: action === "SELL" ? (crossChainTx.exitReason || deriveExitReason(reason)) : undefined,
                        pnl: realizedPnl,
                        pnlPct,
                        success: true,
                    }, tradeMeta);
                    enqueueTradeNotification({
                        action,
                        symbol: normalizedTokenSymbol,
                        venue: "Cross-chain Aggregator",
                        amount,
                        notionalUsd: sourceUsdNotional,
                        autoTradeTarget: Boolean(payload.autoTradeTarget),
                    });
                    if (payload.autoTradeTarget) {
                        void sendAutoTradeEmailNotification({
                            category: resolveAutoTradeEmailCategory(action, true, crossChainTx.exitReason),
                            symbol: normalizedTokenSymbol,
                            chain: crossChainTx.chain,
                            venue: crossChainTx.dex,
                            entryPriceUsd: crossChainTx.entryPrice,
                            finalPriceUsd: action === "SELL" ? tradePrice : undefined,
                            pnlUsd: crossChainTx.pnl,
                            txHash: crossChainTx.txHash,
                            executionTarget: crossChainTx.executionTarget,
                            reason: crossChainTx.reason,
                            positionSizeLabel: crossChainTx.positionSizeLabel,
                        });
                    }
                    setLastAction(action);
                    addDisPoints(1);
                    if (action === "SELL") {
                        addDisPoints((realizedPnl || 0) > 0 ? 5 : -3);
                    }
                    addMessage("manager", "Cross-chain Aggregator の注文が実行完了しました。", "EXECUTION");
                    if (isSoundEnabled) playTrade();
                    unlockAchievement("first-trade");
                    setTradeInProgress(false);
                    nextTradeAllowedAtRef.current = 0;
                    return true;
                } catch (error: any) {
                    setTradeInProgress(false);
                    console.error("Cross-chain trade error:", error);
                    recordStrategyExecution(normalizedTokenSymbol, {
                        kind: "failure",
                        action,
                        timestamp: Date.now(),
                        success: false,
                        failureReason: String(error?.message || "Cross-chain trade error"),
                    }, tradeMeta);
                    const rawMessage = String(error?.message || "Unknown cross-chain trade error");
                    if (tradeMeta?.autoTradeTarget) {
                        void sendAutoTradeEmailNotification({
                            category: "failed",
                            symbol: normalizedTokenSymbol,
                            chain: effectiveExecutionOverride?.chain || effectiveRouteKind || "cross-chain",
                            venue: "Cross-chain Aggregator",
                            entryPriceUsd: tradePrice,
                            pnlUsd: undefined,
                            txHash: undefined,
                            executionTarget: tradeMeta?.executionTarget || effectiveExecutionOverride?.address,
                            reason: rawMessage,
                            positionSizeLabel: tradeMeta?.positionSizeLabel,
                        });
                    }
                    lastTradeErrorTime.current = Date.now();
                    nextTradeAllowedAtRef.current = Date.now() + 15000;
                    addMessage("SYSTEM", "取引失敗: " + rawMessage.substring(0, 150), "ALERT");
                    return false;
                }
            }

            try {
                await resolveExecutionTokenInfo(normalizedTokenSymbol, effectiveTradeChainId, effectiveExecutionOverride);
            } catch {
                addMessage(
                    "SYSTEM",
                    normalizedTokenSymbol + " はチェーン " + effectiveTradeChainId + " で未対応のため注文をスキップしました。",
                    "ALERT",
                );
                setTradeInProgress(false);
                return false;
            }
            if (normalizedFundingSymbol && normalizedFundingSymbol !== normalizedTokenSymbol) {
                try {
                    resolveToken(normalizedFundingSymbol, effectiveTradeChainId);
                } catch {
                    addMessage(
                        "SYSTEM",
                        normalizedFundingSymbol + " はチェーン " + effectiveTradeChainId + " で未対応のため資金源に使用できません。",
                        "ALERT",
                    );
                    setTradeInProgress(false);
                    return false;
                }
            }
        }

        if (!currentDemoMode && effectiveAddress && effectiveTradeChainId) {
            console.log('[DEBUG] executeTrade: Starting ParaSwap On-Chain Execution...', { tokenSymbol, action, amount, effectiveTradeChainId, effectiveAddress, executionOverride: effectiveExecutionOverride });
            setTradeInProgress(true);
            try {
                if (!isSupportedChain(effectiveTradeChainId)) {
                    throw new Error("Chain " + effectiveTradeChainId + " is not supported by our implementation.");
                }

                // Resolve Addresses & Decimals through Registry
                const quoteCandidates = ["USDT", "USDC", "USD1", "BUSD", "FDUSD", "DAI"];
                const supportedQuotes = quoteCandidates.filter((symbol) => {
                    try {
                        resolveToken(symbol, effectiveTradeChainId);
                        return true;
                    } catch {
                        return false;
                    }
                });
                if (supportedQuotes.length === 0) {
                    throw new Error("このチェーンで利用可能なステーブル資金が見つかりません。");
                }

                let stableSymbol = supportedQuotes.includes("USDT") ? "USDT" : supportedQuotes[0];
                let tradeSourceSymbol = action === "BUY" ? stableSymbol : normalizedTokenSymbol;
                let tradeDestSymbol = action === "BUY" ? normalizedTokenSymbol : stableSymbol;

                if (action === "BUY" && normalizedFundingSymbol && normalizedFundingSymbol !== normalizedTokenSymbol) {
                    tradeSourceSymbol = normalizedFundingSymbol;
                }

                const readSourceBalance = async (symbol: string): Promise<number | null> => {
                    if (!publicClient || !effectiveAddress) return null;
                    const tokenInfo = await resolveExecutionTokenInfo(
                        symbol,
                        effectiveTradeChainId,
                        symbol === normalizedTokenSymbol ? effectiveExecutionOverride : undefined,
                    );
                    try {
                        if (tokenInfo.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
                            const rawNative = await publicClient.getBalance({
                                address: effectiveAddress as `0x${string}`,
                            });
                            return Number(formatUnits(rawNative, tokenInfo.decimals));
                        }
                        const rawToken = await publicClient.readContract({
                            address: tokenInfo.address as `0x${string}`,
                            abi: erc20Abi,
                            functionName: "balanceOf",
                            args: [effectiveAddress as `0x${string}`],
                        });
                        return Number(formatUnits(rawToken as bigint, tokenInfo.decimals));
                    } catch {
                        return null;
                    }
                };

                const findBestOnchainFundingSource = async (requiredUsd: number) => {
                    const fundingRows = (!currentDemoMode && walletHoldings.length > 0)
                        ? walletHoldings.map((row) => {
                            const symbol = normalizeTrackedSymbol(row.symbol);
                            const usdPrice = TRADE_CONFIG.STABLECOINS.includes(symbol)
                                ? 1
                                : (getUsdPrice(symbol) || (row.amount > 0 ? row.usdValue / row.amount : 0));
                            return {
                                symbol,
                                usdPrice,
                                estimatedUsd: row.usdValue,
                                isGasReserve: row.isGasReserve === true,
                            };
                        })
                        : portfolioRef.current.positions.map((position) => {
                            const symbol = normalizeTrackedSymbol(position.symbol);
                            const usdPrice = getUsdPrice(symbol);
                            const estimatedUsd = position.amount * usdPrice;
                            return { symbol, usdPrice, estimatedUsd, isGasReserve: false };
                        });
                    const targetComparable = comparableTradeSymbol(normalizedTokenSymbol);
                    const candidates = fundingRows
                        .filter((entry) =>
                            comparableTradeSymbol(entry.symbol) !== targetComparable
                            && entry.usdPrice > 0
                            && entry.estimatedUsd >= 2
                            && !entry.isGasReserve
                            && !TRADE_CONFIG.STABLECOINS.includes(entry.symbol),
                        )
                        .filter((entry) => {
                            try {
                                resolveToken(entry.symbol, effectiveTradeChainId);
                                return true;
                            } catch {
                                return false;
                            }
                        })
                        .sort((a, b) => b.estimatedUsd - a.estimatedUsd);

                    const verified: { symbol: string; amount: number; usdValue: number }[] = [];
                    for (const candidate of candidates.slice(0, 8)) {
                        const onchainAmount = await readSourceBalance(candidate.symbol);
                        if (onchainAmount === null || onchainAmount <= 0) continue;
                        const safeAmount = onchainAmount * 0.985;
                        const usdValue = safeAmount * candidate.usdPrice;
                        if (usdValue >= Math.max(dynamicLiveMinOrderUsd, Math.min(requiredUsd * 0.35, requiredUsd - 0.05))) {
                            verified.push({
                                symbol: candidate.symbol,
                                amount: safeAmount,
                                usdValue,
                            });
                        }
                    }

                    verified.sort((a, b) => b.usdValue - a.usdValue);
                    return verified[0];
                };

                if (action === "BUY" && publicClient && TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)) {
                    const requiredQuoteAmount = amount * tradePrice * 1.003;
                    const quoteBalances: { symbol: string; amount: number }[] = [];

                    for (const quoteSymbol of supportedQuotes) {
                        const quoteInfo = resolveToken(quoteSymbol, effectiveTradeChainId);
                        if (quoteInfo.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) continue;
                        try {
                            const rawBalance = await publicClient.readContract({
                                address: quoteInfo.address as `0x${string}`,
                                abi: erc20Abi,
                                functionName: "balanceOf",
                                args: [effectiveAddress as `0x${string}`],
                            });
                            const amountFloat = Number(formatUnits(rawBalance as bigint, quoteInfo.decimals));
                            if (Number.isFinite(amountFloat) && amountFloat > 0) {
                                quoteBalances.push({ symbol: quoteSymbol, amount: amountFloat });
                            }
                        } catch {
                            // ignore per-token read failures
                        }
                    }

                    const candidatesWithFunds = quoteBalances
                        .filter((item) => item.amount >= requiredQuoteAmount)
                        .sort((a, b) => {
                            const aPreferred = a.symbol === "USDT" ? 1 : 0;
                            const bPreferred = b.symbol === "USDT" ? 1 : 0;
                            if (aPreferred !== bPreferred) return bPreferred - aPreferred;
                            return b.amount - a.amount;
                        });

                    if (candidatesWithFunds.length > 0) {
                        stableSymbol = candidatesWithFunds[0].symbol;
                        tradeSourceSymbol = stableSymbol;
                    } else {
                        const funding = await findBestOnchainFundingSource(requiredQuoteAmount);
                        if (funding) {
                            tradeSourceSymbol = funding.symbol;
                            addMessage(
                                "SYSTEM",
                                `ステーブル残高不足のため資金源を ${funding.symbol} に切り替えて発注します (約${funding.usdValue.toFixed(2)} USD)。`,
                                "SYSTEM",
                            );
                        } else {
                            const maxBalance = quoteBalances.sort((a, b) => b.amount - a.amount)[0];
                            if (maxBalance && maxBalance.amount >= dynamicLiveMinOrderUsd) {
                                stableSymbol = maxBalance.symbol;
                                tradeSourceSymbol = stableSymbol;
                                addMessage(
                                    "SYSTEM",
                                    `ステーブル残高が不足しているため、${maxBalance.symbol} 残高 ${maxBalance.amount.toFixed(4)} に合わせて縮小発注します。`,
                                    "SYSTEM",
                                );
                            } else if (maxBalance) {
                                throw new Error(
                                    `ステーブル残高不足: 必要 ${requiredQuoteAmount.toFixed(4)} / 最大保有 ${maxBalance.symbol} ${maxBalance.amount.toFixed(4)}`,
                                );
                            }
                            else {
                                throw new Error("資金源となる残高が不足しているため発注できません。");
                            }
                        }
                    }
                }

                if (!TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)) {
                    const srcPrice = getUsdPrice(tradeSourceSymbol);
                    if (srcPrice <= 0) {
                        throw new Error(`${tradeSourceSymbol} の価格が取得できないため発注できません。`);
                    }
                }

                const srcTokenInfo = await resolveExecutionTokenInfo(
                    tradeSourceSymbol,
                    effectiveTradeChainId,
                    action === "SELL" && tradeSourceSymbol === normalizedTokenSymbol ? effectiveExecutionOverride : undefined,
                );
                const destTokenInfo = await resolveExecutionTokenInfo(
                    tradeDestSymbol,
                    effectiveTradeChainId,
                    action === "BUY" && tradeDestSymbol === normalizedTokenSymbol ? effectiveExecutionOverride : undefined,
                );
                const baseReason = (reason || "").trim() || (action === "BUY" ? "手動買い" : "手動売り");
                const sourceIsStable = TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol);
                const crossAssetReallocation =
                    action === "BUY"
                    && !sourceIsStable
                    && tradeSourceSymbol !== normalizedTokenSymbol;
                let detailedReason = baseReason;
                if (crossAssetReallocation) {
                    const sourcePosition = portfolioRef.current.positions.find(
                        (position) => normalizeTrackedSymbol(position.symbol) === tradeSourceSymbol,
                    );
                    const sourcePrice = getUsdPrice(tradeSourceSymbol);
                    const sourcePnlPct =
                        sourcePosition && sourcePosition.entryPrice > 0 && sourcePrice > 0
                            ? ((sourcePrice - sourcePosition.entryPrice) / sourcePosition.entryPrice) * 100
                            : undefined;
                    const sourcePnlText = sourcePnlPct === undefined ? "評価率 N/A" : `評価率 ${sourcePnlPct.toFixed(2)}%`;
                    detailedReason =
                        `${baseReason}｜資金再配分: ${tradeSourceSymbol}→${normalizedTokenSymbol}｜`
                        + `${sourcePnlText} / ${normalizedTokenSymbol} の短期優位シグナルを優先`;
                } else if (action === "SELL" && !baseReason.includes("ストップロス")) {
                    detailedReason = `${baseReason}｜注記: ストップロス未到達時は短期反転シグナルに基づく戦略売却`;
                }

                // Amount in Wei
                let srcAmountNumber = action === "BUY"
                    ? (
                        TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)
                            ? (amount * tradePrice)
                            : ((amount * tradePrice) / Math.max(getUsdPrice(tradeSourceSymbol), 0.0000001))
                    )
                    : amount;
                if (!Number.isFinite(srcAmountNumber) || srcAmountNumber <= 0) {
                    throw new Error("Invalid trade amount");
                }
                let executedSizeFactor = 1;
                let executedTokenAmount = amount;

                const onchainSourceBalance = await readSourceBalance(tradeSourceSymbol);
                if (onchainSourceBalance === null) {
                    throw new Error(`${tradeSourceSymbol} 残高の取得に失敗したため発注を中止しました。`);
                }
                if (onchainSourceBalance <= 0) {
                    throw new Error(`${tradeSourceSymbol} 残高が不足しているため発注できません。`);
                }
                const safeAvailable = onchainSourceBalance * 0.985;
                const shouldKeepBnbReserve =
                    !currentDemoMode
                    && effectiveTradeChainId === 56
                    && tradeSourceSymbol === "BNB";
                const bnbUsd = shouldKeepBnbReserve ? Math.max(getUsdPrice("BNB"), 0) : 0;
                const gasReserveAmount = shouldKeepBnbReserve && bnbUsd > 0
                    ? (BNB_GAS_RESERVE_USD / bnbUsd)
                    : 0;
                const availableAfterReserve = shouldKeepBnbReserve
                    ? Math.max(0, safeAvailable - gasReserveAmount)
                    : safeAvailable;
                if (safeAvailable <= 0) {
                    throw new Error(`${tradeSourceSymbol} 残高が不足しているため発注できません。`);
                }
                if (availableAfterReserve <= 0) {
                    throw new Error(`BNBガス保護: 最低 ${BNB_GAS_RESERVE_USD.toFixed(1)} USD 相当の BNB を残すため発注をスキップしました。`);
                }
                if (srcAmountNumber > availableAfterReserve) {
                    const requestedBeforeClamp = srcAmountNumber;
                    srcAmountNumber = availableAfterReserve;
                    executedSizeFactor = requestedBeforeClamp > 0 ? srcAmountNumber / requestedBeforeClamp : 0;
                    executedSizeFactor = Math.max(0.05, Math.min(1, executedSizeFactor));
                    executedTokenAmount = amount * executedSizeFactor;
                    addMessage(
                        "SYSTEM",
                        `発注量を残高に合わせて調整しました (${tradeSourceSymbol}: ${onchainSourceBalance.toFixed(4)} 保有)`,
                        "SYSTEM",
                    );
                }

                if (action === "BUY") {
                    if (TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)) {
                        const availableStableUsd = Number(portfolioRef.current.cashbalance || 0);
                        if (srcAmountNumber > availableStableUsd * 1.05 && currentDemoMode) {
                            throw new Error(
                                `残高不足: 必要 ${srcAmountNumber.toFixed(4)} ${tradeSourceSymbol} / 保有 ${availableStableUsd.toFixed(4)} ${tradeSourceSymbol}`,
                            );
                        }
                    } else {
                        const heldSourceAmount = portfolioRef.current.positions.find(
                            (position) => normalizeTrackedSymbol(position.symbol) === tradeSourceSymbol,
                        )?.amount || 0;
                        if (heldSourceAmount > 0 && srcAmountNumber > heldSourceAmount) {
                            throw new Error(
                                `保有不足: ${tradeSourceSymbol} 必要 ${srcAmountNumber.toFixed(6)} / 保有 ${heldSourceAmount.toFixed(6)}`,
                            );
                        }
                    }
                } else {
                    const held = portfolioRef.current.positions.find((position) => normalizeTrackedSymbol(position.symbol) === normalizedTokenSymbol)?.amount || 0;
                    if (currentDemoMode && executedTokenAmount > held) {
                        throw new Error(`保有不足: ${normalizedTokenSymbol} 必要 ${executedTokenAmount.toFixed(6)} / 保有 ${held.toFixed(6)}`);
                    }
                }
                const sourceUsdNotional = TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)
                    ? srcAmountNumber
                    : srcAmountNumber * Math.max(getUsdPrice(tradeSourceSymbol), 0);
                const minLiveNotionalUsd = action === "SELL"
                    ? Math.max(2.0, dynamicLiveMinOrderUsd * 0.55)
                    : dynamicLiveMinOrderUsd;
                if (!currentDemoMode && sourceUsdNotional + 0.000001 < minLiveNotionalUsd) {
                    throw new Error(`発注額が小さすぎます (${tradeSourceSymbol} -> ${tradeDestSymbol}, ${sourceUsdNotional.toFixed(3)} USD / 最低 ${minLiveNotionalUsd.toFixed(1)} USD${reason ? `, 理由: ${reason}` : ""})`);
                }

                setTradeInProgress(true);
                addMessage("SYSTEM", "ParaSwap で " + (action === "BUY" ? "購入" : "売却") + " を開始します。", "SYSTEM");
                if (action === "BUY" && tradeSourceSymbol !== "USDT") {
                    addMessage("SYSTEM", "資金源として " + tradeSourceSymbol + " を使用して注文します。", "SYSTEM");
                }
                if (action === "BUY" && !TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)) {
                    addMessage("SYSTEM", "非ステーブル建てペア: " + tradeSourceSymbol + "/" + normalizedTokenSymbol, "SYSTEM");
                }
                recordStrategyExecution(normalizedTokenSymbol, {
                    kind: "order",
                    action,
                    timestamp: Date.now(),
                    success: true,
                }, tradeMeta);

                let tradeData: any;
                let lastTradeError = "";
                let finalSizeFactor = executedSizeFactor;
                const retrySizeFactors = [1, 0.72, 0.5];
                const isNonRetryableTradeError = (message: string) =>
                    /cooldown|unsupported|wallet address mismatch|security check failed|chain .* not supported|invalid|exceeds the balance of the account|insufficient|gas fee|total cost|max[_\s-]*impact|estimated_loss_greater_than_max_impact|price impact/i.test(message);

                for (const retryFactor of retrySizeFactors) {
                    const attemptSrcAmount = srcAmountNumber * retryFactor;
                    if (!Number.isFinite(attemptSrcAmount) || attemptSrcAmount <= 0) continue;

                    const amountInWei = parseUnits(
                        attemptSrcAmount.toFixed(srcTokenInfo.decimals),
                        srcTokenInfo.decimals,
                    ).toString();

                    console.warn("[TRADE_CALL]", {
                        chainId: effectiveTradeChainId,
                        srcSymbol: tradeSourceSymbol,
                        destSymbol: tradeDestSymbol,
                        amountWei: amountInWei,
                        fromAddress: effectiveAddress,
                        mode: currentDemoMode ? "demo" : "real",
                        auto: (reason === "自動トレードシグナル" || reason?.includes("自動")),
                        retryFactor,
                        srcTokenOverride: action === "SELL" && tradeSourceSymbol === normalizedTokenSymbol ? effectiveExecutionOverride : undefined,
                        destTokenOverride: action === "BUY" && tradeDestSymbol === normalizedTokenSymbol ? effectiveExecutionOverride : undefined,
                    });

                    const tradeRes = await fetch("/api/trade", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chainId: effectiveTradeChainId,
                            srcSymbol: tradeSourceSymbol,
                            destSymbol: tradeDestSymbol,
                            amountWei: amountInWei,
                            fromAddress: effectiveAddress,
                            action,
                            srcTokenOverride: action === "SELL" && tradeSourceSymbol === normalizedTokenSymbol ? effectiveExecutionOverride : undefined,
                            destTokenOverride: action === "BUY" && tradeDestSymbol === normalizedTokenSymbol ? effectiveExecutionOverride : undefined,
                        }),
                    });

                    const tradeResText = await tradeRes.text();
                    let parsedData: any;
                    try {
                        parsedData = JSON.parse(tradeResText);
                    } catch {
                        parsedData = { ok: false, error: `Trade API Non-JSON response (Status:${tradeRes.status})`, details: tradeResText.slice(0, 200) };
                    }

                    if (tradeRes.ok && parsedData?.ok) {
                        tradeData = parsedData;
                        finalSizeFactor = executedSizeFactor * retryFactor;
                        break;
                    }

                    const detail = typeof parsedData?.details === "string" && parsedData.details.length > 0
                        ? ": " + parsedData.details
                        : "";
                    lastTradeError = (parsedData?.error || ("Trade API failed (Status:" + tradeRes.status + ")")) + detail;
                    if (parsedData?.code === "MAX_IMPACT" || isNonRetryableTradeError(lastTradeError)) break;
                    await new Promise((resolve) => setTimeout(resolve, 400));
                }

                if (!tradeData?.ok) {
                    throw new Error(lastTradeError || "Trade API failed");
                }
                if (action === "SELL" && typeof tradeData.executedDestSymbol === "string" && tradeData.executedDestSymbol) {
                    tradeDestSymbol = normalizeTrackedSymbol(tradeData.executedDestSymbol);
                }
                executedTokenAmount = Math.max(0, amount * finalSizeFactor);

                const txHash = tradeData.txHash;
                const executedProvider = String(tradeData.provider || "paraswap");
                const livePosition = portfolioRef.current.positions.find((position) => normalizeTrackedSymbol(position.symbol) === normalizedTokenSymbol);
                const estimatedFeeUsd = action === "BUY"
                    ? (executedTokenAmount * tradePrice * 0.003)
                    : Math.max(executedTokenAmount * tradePrice * 0.003, 0);
                const realizedPnl = action === "SELL" && livePosition
                    ? ((tradePrice - livePosition.entryPrice) * executedTokenAmount) - estimatedFeeUsd
                    : undefined;
                const pnlPct = action === "SELL" && livePosition?.entryPrice
                    ? (((tradePrice - livePosition.entryPrice) / livePosition.entryPrice) * 100)
                    : undefined;
                setLastAction(action);
                addMessage("SYSTEM", "トレード送信完了 (Tx: " + txHash.slice(0, 10) + "...)", "SYSTEM");

                if (tradeData.receiptStatus === "success") {
                    const chainName = "BNB Chain";
                    const txPair = `${tradeSourceSymbol}/${tradeDestSymbol}`;
                    const liveTx: Transaction = {
                        id: Math.random().toString(36).substring(7),
                        agentId: "manager",
                        type: action,
                        symbol: normalizedTokenSymbol,
                        amount: executedTokenAmount,
                        price,
                        timestamp: Date.now(),
                        txHash,
                        fee: estimatedFeeUsd,
                        pnl: realizedPnl,
                        pair: txPair,
                        dex: executedProvider === "openocean" ? "OpenOcean" : "ParaSwap",
                        chain: chainName,
                        reason: detailedReason,
                        entryPrice: livePosition?.entryPrice,
                        plannedTakeProfit: action === "BUY" ? price * (1 + takeProfitThreshold / 100) : undefined,
                        plannedStopLoss: action === "BUY" ? price * (1 + stopLossThreshold / 100) : undefined,
                        decisionSummary: action === "BUY"
                            ? detailedReason
                            : (detailedReason || "利益確定またはリスク管理条件に基づいて決済しました。"),
                        newsTitle: latestNews?.title,
                        routeType: tradeMeta?.routeType || effectiveExecutionOverride?.routeKind,
                        routeSource: tradeMeta?.routeSource || effectiveExecutionOverride?.source,
                        sourceToken: tradeMeta?.sourceToken || tradeSourceSymbol,
                        destinationToken: tradeMeta?.destinationToken || tradeDestSymbol,
                        destinationChain: tradeMeta?.destinationChain || effectiveExecutionOverride?.chain,
                        executionTarget: tradeMeta?.executionTarget || effectiveExecutionOverride?.address,
                        positionSizeLabel: tradeMeta?.positionSizeLabel,
                        tradeDecision: tradeMeta?.tradeDecision,
                        selectedReason: tradeMeta?.selectedReason,
                        autoTradeTarget: tradeMeta?.autoTradeTarget,
                        regime: tradeMeta?.regime,
                        triggerState: tradeMeta?.triggerState,
                        triggerType: tradeMeta?.triggerType,
                        score: tradeMeta?.score,
                        reviewReason: tradeMeta?.reviewReason,
                        reviewDetail: tradeMeta?.reviewDetail,
                        reviewStrategy: tradeMeta?.reviewStrategy,
                        reviewExitPlan: tradeMeta?.reviewExitPlan,
                        triggeredAt: tradeMeta?.triggeredAt,
                        selectedAt: tradeMeta?.selectedAt,
                        filledAt: action === "BUY" ? Date.now() : undefined,
                        exitedAt: action === "SELL" ? Date.now() : undefined,
                        exitReason: action === "SELL" ? (tradeMeta?.exitReason || deriveExitReason(detailedReason)) : undefined,
                        pnlPct,
                        success: true,
                    };

                    setTransactions(prev => [liveTx, ...prev].slice(0, 200));
                    recordStrategyExecution(normalizedTokenSymbol, {
                        kind: "fill",
                        action,
                        timestamp: liveTx.timestamp,
                        filledAt: action === "BUY" ? liveTx.timestamp : undefined,
                        exitedAt: action === "SELL" ? liveTx.timestamp : undefined,
                        exitReason: action === "SELL" ? (liveTx.exitReason || deriveExitReason(detailedReason)) : undefined,
                        pnl: realizedPnl,
                        pnlPct,
                        success: true,
                    }, tradeMeta);
                    enqueueTradeNotification({
                        action,
                        symbol: normalizedTokenSymbol,
                        venue: executedProvider === "openocean" ? "OpenOcean" : "ParaSwap",
                        amount: executedTokenAmount,
                        notionalUsd: executedTokenAmount * tradePrice,
                        autoTradeTarget: Boolean(tradeMeta?.autoTradeTarget),
                    });
                    if (tradeMeta?.autoTradeTarget) {
                        void sendAutoTradeEmailNotification({
                            category: resolveAutoTradeEmailCategory(action, true, liveTx.exitReason),
                            symbol: normalizedTokenSymbol,
                            chain: liveTx.chain,
                            venue: liveTx.dex,
                            entryPriceUsd: liveTx.entryPrice,
                            finalPriceUsd: action === "SELL" ? tradePrice : undefined,
                            pnlUsd: liveTx.pnl,
                            txHash: liveTx.txHash,
                            executionTarget: liveTx.executionTarget,
                            reason: liveTx.reason,
                            positionSizeLabel: liveTx.positionSizeLabel,
                        });
                    }
                    addDisPoints(1);
                    if (action === "SELL") {
                        addDisPoints((realizedPnl || 0) > 0 ? 5 : -3);
                    }
                    addMessage("manager", `${executedProvider === "openocean" ? "OpenOcean" : "ParaSwap"} の取引が約定しました。`, "EXECUTION");
                    if (isSoundEnabled) playTrade();
                    unlockAchievement("first-trade");
                } else if (publicClient) {
                    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as any });
                    if (receipt.status === 'success') {
                        const chainName = "BNB Chain";
                        const txPair = `${tradeSourceSymbol}/${tradeDestSymbol}`;
                        const liveTx: Transaction = {
                            id: Math.random().toString(36).substring(7),
                            agentId: "manager",
                            type: action,
                            symbol: normalizedTokenSymbol,
                            amount: executedTokenAmount,
                            price,
                            timestamp: Date.now(),
                            txHash,
                            fee: estimatedFeeUsd,
                            pnl: realizedPnl,
                            pair: txPair,
                            dex: executedProvider === "openocean" ? "OpenOcean" : "ParaSwap",
                            chain: chainName,
                            reason: detailedReason,
                            entryPrice: action === "BUY" ? tradePrice : livePosition?.entryPrice,
                            plannedTakeProfit: action === "BUY" ? tradePrice * (1 + takeProfitThreshold / 100) : undefined,
                            plannedStopLoss: action === "BUY" ? tradePrice * (1 + stopLossThreshold / 100) : undefined,
                            decisionSummary: action === "BUY"
                                ? detailedReason
                                : (detailedReason || "利益確定またはリスク管理条件に基づいて決済しました。"),
                            newsTitle: latestNews?.title,
                            routeType: tradeMeta?.routeType || effectiveExecutionOverride?.routeKind,
                            routeSource: tradeMeta?.routeSource || effectiveExecutionOverride?.source,
                            sourceToken: tradeMeta?.sourceToken || tradeSourceSymbol,
                            destinationToken: tradeMeta?.destinationToken || tradeDestSymbol,
                            destinationChain: tradeMeta?.destinationChain || effectiveExecutionOverride?.chain,
                            executionTarget: tradeMeta?.executionTarget || effectiveExecutionOverride?.address,
                            positionSizeLabel: tradeMeta?.positionSizeLabel,
                            tradeDecision: tradeMeta?.tradeDecision,
                            selectedReason: tradeMeta?.selectedReason,
                            autoTradeTarget: tradeMeta?.autoTradeTarget,
                            regime: tradeMeta?.regime,
                            triggerState: tradeMeta?.triggerState,
                            triggerType: tradeMeta?.triggerType,
                            score: tradeMeta?.score,
                            reviewReason: tradeMeta?.reviewReason,
                            reviewDetail: tradeMeta?.reviewDetail,
                            reviewStrategy: tradeMeta?.reviewStrategy,
                            reviewExitPlan: tradeMeta?.reviewExitPlan,
                            triggeredAt: tradeMeta?.triggeredAt,
                            selectedAt: tradeMeta?.selectedAt,
                            filledAt: action === "BUY" ? Date.now() : undefined,
                            exitedAt: action === "SELL" ? Date.now() : undefined,
                            exitReason: action === "SELL" ? (tradeMeta?.exitReason || deriveExitReason(detailedReason)) : undefined,
                            pnlPct,
                            success: true,
                        };

                        setTransactions(prev => [liveTx, ...prev].slice(0, 200));
                        recordStrategyExecution(normalizedTokenSymbol, {
                            kind: "fill",
                            action,
                            timestamp: liveTx.timestamp,
                            filledAt: action === "BUY" ? liveTx.timestamp : undefined,
                            exitedAt: action === "SELL" ? liveTx.timestamp : undefined,
                            exitReason: action === "SELL" ? (liveTx.exitReason || deriveExitReason(detailedReason)) : undefined,
                            pnl: realizedPnl,
                            pnlPct,
                            success: true,
                        }, tradeMeta);
                        enqueueTradeNotification({
                            action,
                            symbol: normalizedTokenSymbol,
                            venue: executedProvider === "openocean" ? "OpenOcean" : "ParaSwap",
                            amount: executedTokenAmount,
                            notionalUsd: executedTokenAmount * tradePrice,
                            autoTradeTarget: Boolean(tradeMeta?.autoTradeTarget),
                        });
                        if (tradeMeta?.autoTradeTarget) {
                            void sendAutoTradeEmailNotification({
                                category: resolveAutoTradeEmailCategory(action, true, liveTx.exitReason),
                                symbol: normalizedTokenSymbol,
                                chain: liveTx.chain,
                                venue: liveTx.dex,
                                entryPriceUsd: liveTx.entryPrice,
                                finalPriceUsd: action === "SELL" ? tradePrice : undefined,
                                pnlUsd: liveTx.pnl,
                                txHash: liveTx.txHash,
                                executionTarget: liveTx.executionTarget,
                                reason: liveTx.reason,
                                positionSizeLabel: liveTx.positionSizeLabel,
                            });
                        }
                        addDisPoints(1);
                        if (action === "SELL") {
                            addDisPoints((realizedPnl || 0) > 0 ? 5 : -3);
                        }
                        addMessage("manager", `${executedProvider === "openocean" ? "OpenOcean" : "ParaSwap"} の取引が約定しました。`, "EXECUTION");
                        if (isSoundEnabled) playTrade();
                        unlockAchievement("first-trade");
                    } else {
                        throw new Error(tradeData.error || "Transaction execution failed on blockchain.");
                    }
                }

                setTradeInProgress(false);
                nextTradeAllowedAtRef.current = 0;
                return true;
            } catch (error: any) {
                setTradeInProgress(false);
                console.error("ParaSwap trade error:", error);
                recordStrategyExecution(normalizedTokenSymbol, {
                    kind: "failure",
                    action,
                    timestamp: Date.now(),
                    success: false,
                    failureReason: String(error?.message || "Trade API failed"),
                }, tradeMeta);
                const rawMessage = String(error?.message || "Unknown trade error");
                if (tradeMeta?.autoTradeTarget) {
                    void sendAutoTradeEmailNotification({
                        category: "failed",
                        symbol: normalizedTokenSymbol,
                        chain: "BNB Chain",
                        venue: effectiveRouteKind === "proxy" ? "Proxy / ParaSwap" : "ParaSwap",
                        entryPriceUsd: tradePrice,
                        finalPriceUsd: undefined,
                        pnlUsd: undefined,
                        txHash: undefined,
                        executionTarget: tradeMeta?.executionTarget || effectiveExecutionOverride?.address,
                        reason: rawMessage,
                        positionSizeLabel: tradeMeta?.positionSizeLabel,
                    });
                }
                const hardInsufficient = /insufficient|残高不足|保有不足|exceeds balance|balance/i.test(rawMessage);
                const maxImpactLike = /max[_\s-]*impact|estimated_loss_greater_than_max_impact|price impact/i.test(rawMessage);
                const insufficientLike = hardInsufficient || maxImpactLike || /small|liquidity|no routes|cooldown/i.test(rawMessage);
                const backoffMs = hardInsufficient ? 90000 : (maxImpactLike ? 20 * 60 * 1000 : (insufficientLike ? 45000 : 10000));
                lastTradeErrorTime.current = Date.now();
                nextTradeAllowedAtRef.current = Date.now() + backoffMs;
                if (hardInsufficient || maxImpactLike) {
                    const coolUntil = Date.now() + 10 * 60 * 1000;
                    symbolCooldownRef.current[`${normalizedTokenSymbol}:${action}`] = coolUntil;
                }
                let errorMsg = rawMessage.substring(0, 150);
                addMessage("SYSTEM", "取引失敗: " + errorMsg, "ALERT");
                return false;
            }
        }

        // ==========================================
        // DEMO EXECUTION PATH (Simulation)
        // ==========================================
        const validPrice = (price && price > 0) ? price : (allMarketPrices[tokenSymbol]?.price || 0);
        const totalValue = amount * validPrice;
        const selectedDex = dex || ["Uniswap", "QuickSwap", "PancakeSwap", "SushiSwap"][Math.floor(Math.random() * 4)];

        // Phase 11: Accurate Fee & Slippage (0.3% Swap + 0.1% Slip + Dynamic Gas)
        const swapFee = totalValue * 0.003;
        const slippage = totalValue * 0.001;

        // Gas Fee Calculation based on DEX (Chain approximation)
        let gasFee = 50; // Default Low
        if (selectedDex.includes("Uniswap")) gasFee = 400 + Math.random() * 400; // Ethereum: ﾂ･400-800
        else if (selectedDex.includes("PancakeSwap")) gasFee = 10 + Math.random() * 20; // BSC: ﾂ･10-30
        else if (selectedDex.includes("QuickSwap")) gasFee = 1 + Math.random() * 5; // Polygon: ﾂ･1-6
        else if (selectedDex.includes("SushiSwap")) gasFee = 50 + Math.random() * 50; // Mixed: ﾂ･50-100

        const totalFee = swapFee + slippage + gasFee;
        recordStrategyExecution(normalizedTokenSymbol, {
            kind: "order",
            action,
            timestamp: Date.now(),
            success: true,
        }, tradeMeta);

        // Effective Price for calculations (including slippage impact on price)
        const effectivePrice = action === "BUY" ? validPrice * 1.001 : validPrice * 0.999;

        if (action === "BUY") {
            if (portfolioRef.current.cashbalance < (totalValue + totalFee)) {
                addMessage("SYSTEM", "残高不足: 必要 " + (totalValue + totalFee).toFixed(4) + " USD / 保有 " + portfolioRef.current.cashbalance.toFixed(4) + " USD", "ALERT");
                setTradeInProgress(false);
                return false;
            }
        } else {
            const pos = portfolioRef.current.positions.find(p => p.symbol === tokenSymbol);
            if (!pos || pos.amount < amount) {
                addMessage("SYSTEM", "保有トークン不足: " + tokenSymbol, "ALERT");
                setTradeInProgress(false);
                return false;
            }
        }

        let tradePnl = 0;
        setPortfolio(prev => {
            let newCash = prev.cashbalance;
            let newPositions = [...prev.positions];
            const posIndex = newPositions.findIndex(p => p.symbol === tokenSymbol);

            if (action === "BUY") {
                newCash -= (totalValue + totalFee);
                if (posIndex >= 0) {
                    const currentAmount = newPositions[posIndex].amount;
                    const newAmount = currentAmount + amount;
                    const newEntryPrice = (newPositions[posIndex].entryPrice * currentAmount + effectivePrice * amount) / newAmount;

                    newPositions[posIndex] = {
                        ...newPositions[posIndex],
                        amount: newAmount,
                        entryPrice: newEntryPrice,
                        highestPrice: Math.max(newPositions[posIndex].highestPrice || 0, effectivePrice)
                    };
                } else {
                    newPositions.push({
                        symbol: tokenSymbol,
                        amount,
                        entryPrice: effectivePrice,
                        highestPrice: effectivePrice,
                        reason: reason || "Manual Trade",
                        exitStrategy: "Target +30~50%, Stop -10%" // Phase 11 Aggressive
                    });
                }
            } else {
                newCash += (totalValue - totalFee);
                if (posIndex >= 0) {
                    const entryPrice = newPositions[posIndex].entryPrice;
                    tradePnl = (effectivePrice - entryPrice) * amount; // PnL based on effective price
                    newPositions[posIndex].amount -= amount;
                    if (newPositions[posIndex].amount < 0.000001) {
                        newPositions.splice(posIndex, 1);
                    }
                }
            }
            return { ...prev, cashbalance: newCash, positions: newPositions };
        });

        const txHash = "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join("");

        // Ensure pair display format - use proper stablecoin pairs usually (Demo fallback)
        const stablePair = "USDT";
        const pairDisplay = tokenSymbol + "/" + stablePair;

        const chain = tokenSymbol === "POL" || tokenSymbol === "MATIC" ? "Polygon" : "BNB Chain";

        const newTx: Transaction = {
            id: Math.random().toString(36).substring(7),
            agentId: "user",
            type: action,
            amount: amount,
            price: price,
            symbol: tokenSymbol,
            timestamp: Date.now(),
            txHash,
            fee: totalFee,
            pnl: action === "SELL" ? tradePnl : undefined,
            pair: pairDisplay,
            targetPrice: action === "BUY" ? price * (1 + takeProfitThreshold / 100) : undefined, // Integration of TP
            dex: selectedDex,
            chain: chain,
            reason: reason || (action === "BUY" ? "デモ買い" : "デモ売り"),
            entryPrice: action === "BUY" ? effectivePrice : undefined,
            plannedTakeProfit: action === "BUY" ? effectivePrice * (1 + takeProfitThreshold / 100) : undefined,
            plannedStopLoss: action === "BUY" ? effectivePrice * (1 + stopLossThreshold / 100) : undefined,
            decisionSummary: reason || (action === "BUY" ? "デモモードの戦略エントリー" : "デモモードの戦略決済"),
            regime: tradeMeta?.regime,
            triggerState: tradeMeta?.triggerState,
            triggerType: tradeMeta?.triggerType,
            score: tradeMeta?.score,
            reviewReason: tradeMeta?.reviewReason,
            reviewDetail: tradeMeta?.reviewDetail,
            reviewStrategy: tradeMeta?.reviewStrategy,
            reviewExitPlan: tradeMeta?.reviewExitPlan,
            triggeredAt: tradeMeta?.triggeredAt,
            selectedAt: tradeMeta?.selectedAt,
            filledAt: action === "BUY" ? Date.now() : undefined,
            exitedAt: action === "SELL" ? Date.now() : undefined,
            exitReason: action === "SELL" ? (tradeMeta?.exitReason || deriveExitReason(reason)) : undefined,
            pnlPct: action === "SELL" && portfolioRef.current.positions.find((position) => position.symbol === tokenSymbol)?.entryPrice
                ? (((effectivePrice - (portfolioRef.current.positions.find((position) => position.symbol === tokenSymbol)?.entryPrice || effectivePrice)) / (portfolioRef.current.positions.find((position) => position.symbol === tokenSymbol)?.entryPrice || effectivePrice)) * 100)
                : undefined,
            success: true,
        };
        setTransactions(prev => [newTx, ...prev].slice(0, 100));
        recordStrategyExecution(normalizedTokenSymbol, {
            kind: "fill",
            action,
            timestamp: newTx.timestamp,
            filledAt: action === "BUY" ? newTx.timestamp : undefined,
            exitedAt: action === "SELL" ? newTx.timestamp : undefined,
            exitReason: action === "SELL" ? (newTx.exitReason || deriveExitReason(reason)) : undefined,
            pnl: action === "SELL" ? tradePnl : undefined,
            pnlPct: newTx.pnlPct,
            success: true,
        }, tradeMeta);

        // Add to notifications
        enqueueTradeNotification({
            action,
            symbol: tokenSymbol,
            venue: selectedDex,
            amount,
            notionalUsd: totalValue,
            autoTradeTarget: Boolean(tradeMeta?.autoTradeTarget),
        });
        if (tradeMeta?.autoTradeTarget) {
            void sendAutoTradeEmailNotification({
                category: resolveAutoTradeEmailCategory(action, true, newTx.exitReason),
                symbol: tokenSymbol,
                chain,
                venue: selectedDex,
                entryPriceUsd: newTx.entryPrice,
                finalPriceUsd: action === "SELL" ? effectivePrice : undefined,
                pnlUsd: newTx.pnl,
                txHash: newTx.txHash,
                executionTarget: newTx.executionTarget,
                reason: newTx.reason,
                positionSizeLabel: newTx.positionSizeLabel,
            });
        }

        addDisPoints(1);
        if (action === "SELL" && tradePnl > 0) {
            addDisPoints(5);
            addMessage("manager", "利益決済ボーナス: +5 DIS POINTS", "ALERT");
            agents.forEach(a => awardExp(a.id, 50));
            updateAchievementProgress("profit-100", convertJPY(tradePnl));
        } else if (action === "SELL") {
            addDisPoints(-3);
            agents.forEach(a => awardExp(a.id, 10));
        } else {
            agents.forEach(a => awardExp(a.id, 5));
        }

        addMessage(
            "manager",
            "[実行完了] " + (action === "BUY" ? "購入" : "売却") + ": " + amount.toFixed(6) + " " + tokenSymbol + " @ " + price.toFixed(6) + " USD" + (action === "SELL" ? " (実現損益: " + tradePnl.toFixed(4) + " USD)" : ""),
            "EXECUTION"
        );
        if (isSoundEnabled) playSuccess();
        unlockAchievement("first-trade");

        setTradeInProgress(false);
        return true;
    }, [
        isDemoMode,
        addMessage,
        isSoundEnabled,
        playTrade,
        playSuccess,
        takeProfitThreshold,
        stopLossThreshold,
        agents,
        awardExp,
        updateAchievementProgress,
        addDisPoints,
        unlockAchievement,
        latestNews,
        effectiveIsConnected,
        effectiveAddress,
        effectiveChainId,
        publicClient,
        allMarketPrices,
        getUsdPrice,
        getExecutionAwareUsdPrice,
        walletHoldings,
        upsertCrossChainOrder,
        mergeCrossChainOrder,
        recordStrategyExecution,
        resolveAutoTradeEmailCategory,
        sendAutoTradeEmailNotification,
        tradeInProgress,
        jpyRate,
    ]);

    const updateProposalStatus = (id: string, status: "APPROVED" | "REJECTED" | "ACTIVE" | "PENDING") => {
        setStrategyProposals(prev => prev.map(p => {
            if (p.id === id) {
                const updated = { ...p, status };
                if (status === "ACTIVE") {
                    // Add to active strategies if not already there
                    setActiveStrategies((current) => {
                        const filtered = current.filter((strategy) => strategy.id !== updated.id);
                        return [...filtered, updated];
                    });

                    addMessage("SYSTEM", "戦略を有効化: " + updated.title + " (ブロック: " + (updated.durationBlock || "N/A") + ")", "SYSTEM");
                }
                return updated;
            }
            return p;
        }));
    };

    const registerStrategyProposal = useCallback((proposal: StrategyProposal, activate = false) => {
        const nextProposal: StrategyProposal = {
            ...proposal,
            status: activate ? "ACTIVE" : (proposal.status || "PENDING"),
        };

        setStrategyProposals((prev) => {
            const filtered = prev.filter((entry) => entry.id !== nextProposal.id);
            return [nextProposal, ...filtered].slice(0, 48);
        });

        if (activate) {
            setActiveStrategies((prev) => {
                const filtered = prev.filter((entry) => entry.id !== nextProposal.id);
                return [nextProposal, ...filtered].slice(0, 16);
            });
        }
    }, []);

    const deleteProposal = (id: string) => {
        setStrategyProposals(prev => prev.filter(p => p.id !== id));
        setActiveStrategies(prev => prev.filter(p => p.id !== id));
    };

    const addUserMessage = (content: string) => {
        addMessage("USER", content, "OPINION");
    };

    const resetSimulation = () => {
        setPortfolio(INITIAL_PORTFOLIO);
        setTransactions([]);
        setTradingPipelines([]);
        setMessages([]); // Clear chat history as requested
        setFavorites(new Set());
        setStrategyProposals([]);
        setDiscussionHistory([]);
        setTradeNotifications([]);
        setCrossChainOrders([]);
        crossChainShadowPositionsRef.current = {};
        localStorage.removeItem("jdex_portfolio");
        localStorage.removeItem("jdex_transactions");
        if (liveCrossChainOrdersStorageKey) localStorage.removeItem(liveCrossChainOrdersStorageKey);
        localStorage.removeItem("jdex_pipelines");
        localStorage.removeItem("jdex_favorites");
        localStorage.removeItem("jdex_risk_settings");
        localStorage.removeItem("jdex_last_active");
        addMessage("manager", "デモ口座をリセットしました。運用資産を初期化し、接続状態を再同期します。", "SYSTEM");
        window.location.reload();
    };

    useEffect(() => {
        const storedPoints = localStorage.getItem("jdex_dis_points");
        if (storedPoints) setDisPoints(parseInt(storedPoints));
    }, []);

    // Load all persisted states
    useEffect(() => {
        const storedSim = localStorage.getItem("jdex_simulating");
        if (storedSim !== null) setIsSimulatingState(storedSim === "true");
        const storedInitialDone = localStorage.getItem("jdex_initial_trade_done");
        if (storedInitialDone !== null) {
            setHasInitialTradeExecutedState(storedInitialDone === "true");
        }

        const storedPipelines = localStorage.getItem("jdex_pipelines");
        if (storedPipelines) {
            try { setTradingPipelines(JSON.parse(storedPipelines)); } catch (e) { }
        }

        const storedFavs = localStorage.getItem("jdex_favorites");
        if (storedFavs) {
            try { setFavorites(new Set(JSON.parse(storedFavs))); } catch (e) { }
        }

        const storedDemo = localStorage.getItem("jdex_demo_mode");
        const isDemo = storedDemo === "true";

        if (storedDemo !== null) setIsDemoModeState(isDemo);

        if (isDemo && !sessionStorage.getItem("jdex_auth")) {
            const storedPortfolio = localStorage.getItem("jdex_portfolio");
            if (storedPortfolio) {
                try {
                    setPortfolio(JSON.parse(storedPortfolio));
                } catch (e) { }
            } else {
                // Check for demo mode fallback
                const demoBalStr = localStorage.getItem("jdex_demo_balance");
                if (demoBalStr) {
                    const val = parseFloat(demoBalStr);
                    setPortfolio({
                        totalValue: val,
                        pnl24h: 0,
                        cashbalance: val,
                        positions: []
                    });
                }
            }

            const storedTx = localStorage.getItem("jdex_transactions");
            if (storedTx) {
                try { setTransactions(sanitizeStoredTransactions(JSON.parse(storedTx))); } catch (e) { }
            }
        } else {
            // Force flat initialization if connected to Live Wallet to prevent ghost caches
            setPortfolio({
                totalValue: 0,
                pnl24h: 0,
                cashbalance: 0,
                positions: []
            });
            if (liveTransactionsStorageKey) {
                const storedLiveTx = localStorage.getItem(liveTransactionsStorageKey);
                if (storedLiveTx) {
                    try {
                        setTransactions(sanitizeStoredTransactions(JSON.parse(storedLiveTx)));
                    } catch (e) {
                        setTransactions([]);
                    }
                } else {
                    setTransactions([]);
                }
            } else {
                setTransactions([]);
            }
            if (liveCrossChainOrdersStorageKey) {
                const storedCrossChainOrders = localStorage.getItem(liveCrossChainOrdersStorageKey);
                if (storedCrossChainOrders) {
                    try {
                        setCrossChainOrders(sanitizeStoredCrossChainOrders(JSON.parse(storedCrossChainOrders)));
                    } catch {
                        setCrossChainOrders([]);
                    }
                } else {
                    setCrossChainOrders([]);
                }
            } else {
                setCrossChainOrders([]);
            }
            setIsDemoModeState(false);
            localStorage.setItem("jdex_demo_mode", "false");
            localStorage.removeItem("jdex_portfolio"); // Ensure demo data is wiped on fresh load for live users
            localStorage.removeItem("jdex_transactions");
            localStorage.removeItem("jdex_live_initial_balance"); // Prevent stale ghost balance
        }

        const storedRisk = localStorage.getItem("jdex_risk_settings");
        if (storedRisk) {
            try {
                const r = JSON.parse(storedRisk);
                const nextTolerance = Math.max(1, Math.min(5, Number(r.tolerance) || DEFAULT_RISK_TOLERANCE));
                const nextStopLoss = clampScalpStopLoss(r.stopLoss);
                const nextTakeProfit = clampScalpTakeProfit(r.takeProfit);
                setRiskTolerance(nextTolerance);
                setStopLossThreshold(nextStopLoss);
                setTakeProfitThreshold(nextTakeProfit);
            } catch (e) {
                setRiskTolerance(DEFAULT_RISK_TOLERANCE);
                setStopLossThreshold(DEFAULT_STOP_LOSS_THRESHOLD);
                setTakeProfitThreshold(DEFAULT_TAKE_PROFIT_THRESHOLD);
            }
        } else {
            setRiskTolerance(DEFAULT_RISK_TOLERANCE);
            setStopLossThreshold(DEFAULT_STOP_LOSS_THRESHOLD);
            setTakeProfitThreshold(DEFAULT_TAKE_PROFIT_THRESHOLD);
        }

        const storedDemoBalance = localStorage.getItem("jdex_demo_balance");
        let demoBal = 0;
        if (storedDemoBalance) {
            demoBal = parseFloat(storedDemoBalance);
            setDemoBalanceState(demoBal);
        }



        const storedStartTokens = localStorage.getItem("jdex_allowed_start_tokens");
        if (storedStartTokens) {
            try { setAllowedStartTokensState(JSON.parse(storedStartTokens)); } catch (e) { }
        }
    }, [liveTransactionsStorageKey, liveCrossChainOrdersStorageKey]);

    // Save state on changes (only if in demo mode to protect live state isolation)
    useEffect(() => {
        if (isDemoMode) {
            localStorage.setItem("jdex_portfolio", JSON.stringify(portfolio));
        }
    }, [portfolio, isDemoMode]);

    useEffect(() => {
        if (isDemoMode) {
            localStorage.setItem("jdex_transactions", JSON.stringify(sanitizeStoredTransactions(transactions)));
        }
    }, [transactions, isDemoMode]);

    useEffect(() => {
        if (!isDemoMode && liveTransactionsStorageKey) {
            localStorage.setItem(liveTransactionsStorageKey, JSON.stringify(sanitizeStoredTransactions(transactions)));
        }
    }, [transactions, isDemoMode, liveTransactionsStorageKey]);

    useEffect(() => {
        if (!isDemoMode && liveCrossChainOrdersStorageKey) {
            localStorage.setItem(liveCrossChainOrdersStorageKey, JSON.stringify(sanitizeStoredCrossChainOrders(crossChainOrders)));
        }
    }, [crossChainOrders, isDemoMode, liveCrossChainOrdersStorageKey]);

    useEffect(() => {
        localStorage.setItem("jdex_risk_settings", JSON.stringify({
            tolerance: riskTolerance,
            stopLoss: stopLossThreshold,
            takeProfit: takeProfitThreshold
        }));
    }, [riskTolerance, stopLossThreshold, takeProfitThreshold]);

    const riskAlertTriggered = useRef({ stopLoss: false, takeProfit: false });

    // Fetch real market prices from internal aggregator API
    useEffect(() => {
        const loadPrices = async () => {
            try {
                const symbols = Array.from(new Set([
                    ...STRATEGY_UNIVERSE_SYMBOLS,
                    ...Object.keys(TOKEN_REGISTRY[56] || {}),
                    ...Object.keys(TOKEN_REGISTRY[137] || {}),
                ]));
                const prices = await fetchMarketPrices(symbols);
                if (prices && Object.keys(prices).length > 0) {
                    const updated = { ...allMarketPricesRef.current };
                    Object.entries(prices).forEach(([symbol, data]) => {
                        updated[symbol] = {
                            ...updated[symbol],
                            price: data.price,
                            change24h: data.change24h,
                            volume: updated[symbol]?.volume || 0,
                            updatedAt: data.updatedAt,
                        };
                    });
                    allMarketPricesRef.current = updated;
                    setAllMarketPrices(updated);
                    setRealPricesLoaded(true);
                }
            } catch (e) {
                console.warn("[J-DEX] Failed to fetch real prices:", e);
            }
        };
        loadPrices();
        const interval = setInterval(loadPrices, 60000); // Refresh every 60s
        return () => clearInterval(interval);
    }, [addMessage]);

    useEffect(() => {
        let active = true;

        const loadUniverseMetrics = async () => {
            try {
                const metrics = await fetchStrategyUniverseMetrics(Array.from(STRATEGY_CANDLE_SYMBOL_SET));
                if (!active || !metrics || Object.keys(metrics).length === 0) return;

                const updated = { ...allMarketPricesRef.current };
                Object.entries(metrics).forEach(([symbol, metric]) => {
                    updated[symbol] = {
                        ...updated[symbol],
                        ...metric,
                        price: metric.price > 0 ? metric.price : updated[symbol]?.price || 0,
                        change24h: Number.isFinite(metric.change24h) ? metric.change24h : updated[symbol]?.change24h || 0,
                        volume: metric.volume > 0 ? metric.volume : updated[symbol]?.volume || 0,
                        updatedAt: metric.updatedAt || updated[symbol]?.updatedAt || Date.now(),
                    };
                });
                allMarketPricesRef.current = updated;
                setAllMarketPrices(updated);

                if (!strategyUniverseMetricsHydratedRef.current && isStrategyCandleStoreReady) {
                    strategyUniverseMetricsHydratedRef.current = true;
                    refreshDailyStrategyProposals("manual");
                }
            } catch (error) {
                console.warn("[J-DEX] Failed to fetch strategy universe metrics:", error);
            }
        };

        void loadUniverseMetrics();
        const interval = setInterval(() => {
            void loadUniverseMetrics();
        }, 5 * 60 * 1000);

        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [isStrategyCandleStoreReady]);

    // Auto-exit Demo Mode when a live Wallet connects
    useEffect(() => {
        if (isConnected && isDemoMode) {
            setIsDemoModeState(false);
            localStorage.setItem("jdex_demo_mode", "false");

            // WIPE DEMO PORTFOLIO TO PREVENT LEAKING INTO LIVE DASHBOARD
            setPortfolio({
                totalValue: 0,
                pnl24h: 0,
                cashbalance: 0,
                positions: []
            });
            localStorage.removeItem("jdex_portfolio");
            localStorage.removeItem("jdex_live_initial_balance"); // Force clear on switch


            // Wipe demo transaction history and restore live history for this wallet
            localStorage.removeItem("jdex_transactions");
            if (liveTransactionsStorageKey) {
                const storedLiveTx = localStorage.getItem(liveTransactionsStorageKey);
                if (storedLiveTx) {
                    try {
                        setTransactions(sanitizeStoredTransactions(JSON.parse(storedLiveTx)));
                    } catch (e) {
                        setTransactions([]);
                    }
                } else {
                    setTransactions([]);
                }
            } else {
                setTransactions([]);
            }

            addMessage("manager", "ウォレット接続を検知しました。デモモードを解除し、残高を同期します。", "SYSTEM");
        }
    }, [isConnected, isDemoMode, addMessage, liveTransactionsStorageKey]);

    // Sync live wallet total and stablecoin liquidity when connected
    useEffect(() => {
        if (!isConnected || isDemoMode || !balanceData || !publicClient || !address || !chainId || !isSupportedChain(chainId)) {
            return;
        }

        let cancelled = false;

        const syncWalletPortfolio = async () => {
            const nativeSymbol = normalizeTrackedSymbol(balanceData.symbol || "BNB");
            const nativeAmount = Number(balanceData.formatted || 0);

            const registry = TOKEN_REGISTRY[chainId] || {};
            const readTokenDecimals = async (tokenInfo: { address: string }) => {
                try {
                    const result = await publicClient.readContract({
                        address: tokenInfo.address as `0x${string}`,
                        abi: erc20Abi,
                        functionName: "decimals",
                    });
                    return Number(result);
                } catch {
                    return null;
                }
            };
            const readTokenBalance = async (tokenInfo: { address: string }) => {
                try {
                    const result = await publicClient.readContract({
                        address: tokenInfo.address as `0x${string}`,
                        abi: erc20Abi,
                        functionName: "balanceOf",
                        args: [address as `0x${string}`],
                    });
                    return result as bigint;
                } catch {
                    return null;
                }
            };

            const tokenEntries = (() => {
                const baseEntries = Object.entries(registry)
                    .filter(([, tokenInfo]) => tokenInfo.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase())
                    .map(([symbol, tokenInfo]) => ({
                        key: symbol,
                        symbol: normalizeTrackedSymbol(symbol),
                        displaySymbol: normalizeTrackedSymbol(symbol),
                        tokenInfo,
                        requiresDynamicDecimals: false,
                    }));

                const aliasEntries = (WALLET_SCAN_ALIAS_TOKENS[chainId] || []).map((alias) => ({
                    key: alias.aliasKey,
                    symbol: normalizeTrackedSymbol(alias.trackedSymbol || alias.displaySymbol),
                    displaySymbol: alias.displaySymbol,
                    tokenInfo: {
                        address: alias.address,
                        decimals: alias.decimals,
                    },
                    requiresDynamicDecimals: Boolean(alias.requiresDynamicDecimals),
                    }));
                const customEntries = customBnbContracts.map((addressValue) => ({
                    key: `custom:${addressValue.toLowerCase()}`,
                    symbol: addressValue.toUpperCase(),
                    displaySymbol: `${addressValue.slice(0, 6)}...${addressValue.slice(-4)}`,
                    tokenInfo: {
                        address: addressValue,
                    },
                    requiresDynamicDecimals: true,
                }));
                const dynamicExecutionEntries = Object.entries(allMarketPricesRef.current || {})
                    .filter(([, quote]) =>
                        Number(quote?.executionChainId || 0) === chainId
                        && typeof quote?.executionAddress === "string"
                        && quote.executionAddress.length > 0
                        && quote.executionAddress.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase(),
                    )
                    .map(([symbol, quote]) => ({
                        key: `execution:${symbol}`,
                        symbol: normalizeTrackedSymbol(symbol),
                        displaySymbol: typeof quote?.displaySymbol === "string"
                            ? String(quote.displaySymbol)
                            : normalizeTrackedSymbol(symbol).replace(/\.SOL$/i, ""),
                        tokenInfo: {
                            address: String(quote?.executionAddress),
                            decimals: Number.isFinite(Number(quote?.executionDecimals))
                                ? Number(quote?.executionDecimals)
                                : undefined,
                        },
                        requiresDynamicDecimals: true,
                    }));

                const seenAddresses = new Set<string>();
                return [...baseEntries, ...aliasEntries, ...customEntries, ...dynamicExecutionEntries].filter(({ tokenInfo }) => {
                    const normalizedAddress = tokenInfo.address.toLowerCase();
                    if (normalizedAddress === NATIVE_TOKEN_ADDRESS.toLowerCase()) return false;
                    if (seenAddresses.has(normalizedAddress)) return false;
                    seenAddresses.add(normalizedAddress);
                    return true;
                });
            })();
            const tokenBalances: { symbol: string; displaySymbol?: string; amount: number; address?: string }[] = [];

            if (tokenEntries.length > 0) {
                for (let offset = 0; offset < tokenEntries.length; offset += 20) {
                    const chunk = tokenEntries.slice(offset, offset + 20);
                    let chunkResults: ({ status: "success"; result: bigint } | { status: "failure"; result?: bigint })[] = [];

                    try {
                        const results = await publicClient.multicall({
                            allowFailure: true,
                            contracts: chunk.map(({ tokenInfo }) => ({
                                address: tokenInfo.address as `0x${string}`,
                                abi: erc20Abi,
                                functionName: "balanceOf",
                                args: [address as `0x${string}`],
                            })),
                        });
                        chunkResults = results.map((result) => (
                            result.status === "success"
                                ? { status: "success", result: result.result as bigint }
                                : { status: "failure" }
                        ));
                    } catch (error) {
                        console.warn("[J-DEX] Wallet multicall chunk failed, falling back to per-token reads:", error);
                        chunkResults = await Promise.all(chunk.map(async ({ tokenInfo }) => {
                            const result = await readTokenBalance(tokenInfo);
                            if (result === null) {
                                return { status: "failure" } as const;
                            }
                            return { status: "success", result } as const;
                        }));
                    }

                    for (let index = 0; index < chunk.length; index += 1) {
                        const { symbol, displaySymbol, tokenInfo, requiresDynamicDecimals } = chunk[index];
                        const result = chunkResults[index];
                        let rawBalance: bigint | null =
                            result && result.status === "success"
                                ? (result.result as bigint)
                                : null;

                        if (rawBalance === null) {
                            rawBalance = await readTokenBalance(tokenInfo);
                        }

                        if (rawBalance === null || rawBalance <= 0n) continue;

                        let decimals = "decimals" in tokenInfo && Number.isFinite(Number(tokenInfo.decimals))
                            ? Number(tokenInfo.decimals)
                            : undefined;
                        if ((requiresDynamicDecimals || !Number.isFinite(Number(decimals))) && rawBalance > 0n) {
                            const resolvedDecimals = await readTokenDecimals(tokenInfo);
                            if (resolvedDecimals !== null && Number.isFinite(resolvedDecimals)) {
                                decimals = resolvedDecimals;
                            }
                        }
                        const amount = Number(formatUnits(rawBalance, Number.isFinite(Number(decimals)) ? Number(decimals) : 18));
                        if (!Number.isFinite(amount) || amount <= 0) continue;
                        tokenBalances.push({
                            symbol,
                            displaySymbol,
                            amount,
                            address: tokenInfo.address,
                        });
                    }
                }
            }

            const fetchContractTokenUsdPrices = async (
                entries: Array<{ symbol: string; address?: string }>,
            ): Promise<Record<string, number>> => {
                const trackedEntries = entries
                    .map((entry) => ({
                        symbol: normalizeTrackedSymbol(entry.symbol),
                        address: String(entry.address || "").trim().toLowerCase(),
                    }))
                    .filter((entry) => entry.address && entry.address !== NATIVE_TOKEN_ADDRESS.toLowerCase());
                if (trackedEntries.length === 0) return {};

                const dedupedEntries = Array.from(
                    new Map(trackedEntries.map((entry) => [entry.address, entry])).values(),
                );
                const cacheKey = `${chainId}:${dedupedEntries
                    .map((entry) => `${entry.symbol}@${entry.address}`)
                    .sort()
                    .join(",")}`;
                const cached = contractPriceCacheRef.current.get(cacheKey);
                if (cached && cached.expiresAt > Date.now()) {
                    return cached.data;
                }

                const inFlight = contractPriceInFlightRef.current.get(cacheKey);
                if (inFlight) {
                    return inFlight;
                }

                try {
                    const search = new URLSearchParams({ chainId: String(chainId) });
                    dedupedEntries.forEach((entry) => {
                        search.append("address", entry.address);
                        search.append("key", entry.symbol);
                    });
                    const request = fetch(`/api/market/contract-prices?${search.toString()}`, {
                        cache: "no-store",
                    })
                        .then(async (response) => {
                            if (!response.ok) {
                                throw new Error(`contract price request failed (${response.status})`);
                            }

                            const json = await response.json();
                            const out: Record<string, number> = {};
                            dedupedEntries.forEach((entry) => {
                                const symbol = entry.symbol;
                                const usd = Number(json?.[symbol]);
                                if (Number.isFinite(usd) && usd > 0) {
                                    out[symbol] = usd;
                                }
                            });

                            contractPriceCacheRef.current.set(cacheKey, {
                                expiresAt: Date.now() + 45_000,
                                data: out,
                            });

                            return out;
                        })
                        .finally(() => {
                            contractPriceInFlightRef.current.delete(cacheKey);
                        });

                    contractPriceInFlightRef.current.set(cacheKey, request);
                    return await request;
                } catch (error) {
                    console.warn("[J-DEX] Contract price fetch via API failed:", error);
                    if (cached?.data) {
                        return cached.data;
                    }
                    return {};
                }
            };

            if (cancelled) return;

            const heldSymbolsNeedingPrices = Array.from(new Set([
                nativeSymbol,
                ...tokenBalances.map((token) => token.symbol),
            ])).filter((symbol) => !TRADE_CONFIG.STABLECOINS.includes(symbol));

            const missingPriceSymbols = heldSymbolsNeedingPrices.filter((symbol) => {
                const livePrice = allMarketPrices[symbol]?.price;
                const fallbackPrice = initialData[symbol]?.price;
                return !(typeof livePrice === "number" && livePrice > 0) && !(typeof fallbackPrice === "number" && fallbackPrice > 0);
            });

            let priceSnapshot = { ...allMarketPricesRef.current };
            const executionPriceOverrides: Record<string, number> = {};

            const mergePricesIntoSnapshot = (priceMap: Record<string, number>) => {
                Object.entries(priceMap).forEach(([symbol, price]) => {
                    if (!Number.isFinite(price) || price <= 0) return;
                    priceSnapshot[symbol] = {
                        price,
                        volume: priceSnapshot[symbol]?.volume || initialData[symbol]?.volume || 0,
                    };
                });
            };

            if (missingPriceSymbols.length > 0) {
                try {
                    const fetchedPrices = await fetchMarketPrices(missingPriceSymbols);
                    const nextPrices: Record<string, number> = {};
                    Object.entries(fetchedPrices).forEach(([symbol, data]) => {
                        const usd = Number(data?.price);
                        if (Number.isFinite(usd) && usd > 0) {
                            nextPrices[symbol] = usd;
                        }
                    });

                    if (Object.keys(nextPrices).length > 0) {
                        mergePricesIntoSnapshot(nextPrices);
                        setAllMarketPrices((prev) => {
                            const updated = { ...prev };
                            Object.entries(nextPrices).forEach(([symbol, usd]) => {
                                updated[symbol] = {
                                    price: usd,
                                    volume: prev[symbol]?.volume || initialData[symbol]?.volume || 0,
                                };
                            });
                            return updated;
                        });
                    }
                } catch (error) {
                    console.warn("[J-DEX] Failed to fetch missing wallet prices:", error);
                }
            }

            const contractPriceEntries = tokenBalances.filter((token) => !TRADE_CONFIG.STABLECOINS.includes(token.symbol));
            if (contractPriceEntries.length > 0) {
                const contractPrices = await fetchContractTokenUsdPrices(contractPriceEntries);
                if (Object.keys(contractPrices).length > 0) {
                    setAllMarketPrices((prev) => {
                        const updated = { ...prev };
                        Object.entries(contractPrices).forEach(([symbol, usd]) => {
                            executionPriceOverrides[symbol] = usd;
                            updated[symbol] = {
                                ...updated[symbol],
                                price: updated[symbol]?.price || initialData[symbol]?.price || usd,
                                volume: updated[symbol]?.volume || initialData[symbol]?.volume || 0,
                                executionPriceUsd: usd,
                                executionPriceUpdatedAt: Date.now(),
                            };
                        });
                        return updated;
                    });
                    Object.entries(contractPrices).forEach(([symbol, usd]) => {
                        executionPriceOverrides[symbol] = usd;
                        priceSnapshot[symbol] = {
                            ...(priceSnapshot[symbol] || initialData[symbol] || { price: usd, volume: 0 }),
                            executionPriceUsd: usd,
                            executionPriceUpdatedAt: Date.now(),
                        };
                    });
                }
            }

            const previousPositions = portfolioRef.current.positions || [];
            const previousPriceBySymbol = new Map<string, number>();
            previousPositions.forEach((position) => {
                const normalized = normalizeTrackedSymbol(position.symbol);
                if (position.entryPrice > 0) {
                    previousPriceBySymbol.set(normalized, position.entryPrice);
                }
            });

            const resolveUsdPrice = (symbol: string, options?: { preferExecution?: boolean }) => {
                if (TRADE_CONFIG.STABLECOINS.includes(symbol)) return 1;
                if (options?.preferExecution) {
                    const executionOverride = executionPriceOverrides[symbol];
                    if (typeof executionOverride === "number" && executionOverride > 0) return executionOverride;
                    const executionPrice = priceSnapshot[symbol]?.executionPriceUsd;
                    if (typeof executionPrice === "number" && executionPrice > 0) return executionPrice;
                }
                const livePrice = priceSnapshot[symbol]?.price;
                if (typeof livePrice === "number" && livePrice > 0) return livePrice;
                const fallbackPrice = initialData[symbol]?.price;
                if (typeof fallbackPrice === "number" && fallbackPrice > 0) return fallbackPrice;
                return previousPriceBySymbol.get(symbol) || 0;
            };

            const rawWalletRows: WalletHoldingRow[] = [];
            if (nativeAmount > 0) {
                rawWalletRows.push({
                    symbol: nativeSymbol,
                    amount: nativeAmount,
                    usdValue: nativeAmount * resolveUsdPrice(nativeSymbol),
                    entryPrice: resolveUsdPrice(nativeSymbol),
                    address: undefined,
                    isStable: TRADE_CONFIG.STABLECOINS.includes(nativeSymbol),
                    chain: "BNB",
                    isGasReserve: false,
                });
            }
            tokenBalances.forEach(({ symbol, displaySymbol, amount, address }) => {
                const usdPrice = resolveUsdPrice(symbol, { preferExecution: true });
                rawWalletRows.push({
                    symbol,
                    displaySymbol,
                    address,
                    amount,
                    usdValue: TRADE_CONFIG.STABLECOINS.includes(symbol) ? amount : amount * usdPrice,
                    entryPrice: usdPrice,
                    isStable: TRADE_CONFIG.STABLECOINS.includes(symbol),
                    chain: resolveHoldingChain(symbol, "BNB"),
                    isGasReserve: false,
                });
            });
            setLiveWalletHoldings(
                rawWalletRows
                    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
                    .sort((left, right) => {
                        if (right.usdValue !== left.usdValue) return right.usdValue - left.usdValue;
                        return right.amount - left.amount;
                    }),
            );

            let unresolvedPriceCount = 0;
            const nativeUsdPrice = resolveUsdPrice(nativeSymbol);
            if (!TRADE_CONFIG.STABLECOINS.includes(nativeSymbol) && nativeAmount > 0 && nativeUsdPrice <= 0) {
                unresolvedPriceCount += 1;
            }

            let walletTotalUsd = nativeAmount * nativeUsdPrice;
            let stableLiquidityUsd = TRADE_CONFIG.STABLECOINS.includes(nativeSymbol) ? walletTotalUsd : 0;

            tokenBalances.forEach(({ symbol, amount }) => {
                const usdPrice = resolveUsdPrice(symbol, { preferExecution: true });
                if (!TRADE_CONFIG.STABLECOINS.includes(symbol) && amount > 0 && usdPrice <= 0) {
                    unresolvedPriceCount += 1;
                }

                const usdValue = amount * usdPrice;
                walletTotalUsd += usdValue;
                if (TRADE_CONFIG.STABLECOINS.includes(symbol)) {
                    stableLiquidityUsd += usdValue;
                }
            });

            const safeWalletTotalUsd = Number.isFinite(walletTotalUsd) ? walletTotalUsd : 0;
            const safeStableLiquidityUsd = Number.isFinite(stableLiquidityUsd) ? stableLiquidityUsd : 0;
            const livePositionMap = new Map<string, number>();

            if (!TRADE_CONFIG.STABLECOINS.includes(nativeSymbol) && nativeAmount > 0) {
                livePositionMap.set(nativeSymbol, nativeAmount);
            }
            tokenBalances.forEach(({ symbol, amount }) => {
                if (TRADE_CONFIG.STABLECOINS.includes(symbol) || amount <= 0) return;
                livePositionMap.set(symbol, (livePositionMap.get(symbol) || 0) + amount);
            });

            const livePositions = Array.from(livePositionMap.entries())
                .map(([symbol, amount]) => {
                    const price = resolveUsdPrice(symbol, { preferExecution: true });
                    const previous = previousPositions.find((p) => normalizeTrackedSymbol(p.symbol) === symbol);
                    const safePrice = price > 0 ? price : (previous?.entryPrice || 0);
                    return {
                        symbol,
                        amount,
                        entryPrice: safePrice,
                        highestPrice: previous?.highestPrice || (safePrice > 0 ? safePrice : undefined),
                    };
                })
                .filter((position) => Number.isFinite(position.amount) && position.amount > 0 && Number.isFinite(position.entryPrice) && position.entryPrice > 0);

            setPortfolio((prev) => ({
                ...prev,
                cashbalance: safeStableLiquidityUsd,
                totalValue: safeWalletTotalUsd,
                positions: livePositions,
            }));

            setLiveInitialBalance((prevInit) => {
                if (prevInit > 0 || safeWalletTotalUsd <= 0 || unresolvedPriceCount > 0 || !liveInitialBalanceStorageKey) {
                    return prevInit;
                }
                localStorage.setItem(liveInitialBalanceStorageKey, safeWalletTotalUsd.toString());
                return safeWalletTotalUsd;
            });
        };

        syncWalletPortfolio().catch((error) => {
            console.warn("[J-DEX] Failed to sync live wallet portfolio:", error);
        });

        const interval = setInterval(() => {
            syncWalletPortfolio().catch((error) => {
                console.warn("[J-DEX] Failed to refresh live wallet portfolio:", error);
            });
        }, 30000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [
        address,
        balanceData,
        chainId,
        customBnbContracts,
        isConnected,
        isDemoMode,
        liveInitialBalanceStorageKey,
        publicClient,
    ]);

    // Catch-up simulation on mount (Strictly Demo Strategy Only)
    useEffect(() => {
        if (!isSimulating || !realPricesLoaded || !isDemoMode) return;

        const runCatchUp = async () => {
            const lastTime = localStorage.getItem("jdex_last_active");
            if (!lastTime) {
                localStorage.setItem("jdex_last_active", Date.now().toString());
                return;
            }

            const elapsedMs = Date.now() - parseInt(lastTime);
            const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

            if (elapsedMinutes < 5) return; // Only catch up if away for > 5 mins

            addMessage("manager", "システム復帰: 不在の " + elapsedMinutes + " 分間の市場動向を分析し、取引状態を同期しています。", "SYSTEM");

            // Simplified Catch-up: Simulate a few potential trades
            const numPotentialTrades = Math.min(5, Math.floor(elapsedMinutes / 60));

            if (numPotentialTrades > 0) {
                setTimeout(() => {
                    let pnlGained = 0;
                    for (let i = 0; i < numPotentialTrades; i++) {
                        const isWin = Math.random() > 0.4;
                        const pnl = isWin ? Math.random() * 5000 : -Math.random() * 2000;
                        pnlGained += pnl;

                        const mockTx: Transaction = {
                            id: "offline-" + Date.now() + "-" + i,
                            agentId: "technical",
                            type: isWin ? "SELL" : "SELL",
                            symbol: selectedCurrency,
                            amount: 0.5,
                            price: convertJPY(marketData.price),
                            timestamp: Date.now() - (Math.random() * elapsedMs),
                            txHash: "0x_offline_processed_" + i,
                            fee: 50,
                            pnl: pnl,
                            pair: "USDT-" + selectedCurrency
                        };
                        setTransactions(prev => [mockTx, ...prev].slice(0, 50));
                    }

                    setPortfolio(prev => ({
                        ...prev,
                        cashbalance: prev.cashbalance + pnlGained,
                        totalValue: prev.totalValue + pnlGained
                    }));

                    addMessage("manager", "不在期間の同期完了: " + numPotentialTrades + " 件の取引を処理しました。損益合計: ¥" + pnlGained.toLocaleString(), "EXECUTION");
                }, 3000);
            }

            localStorage.setItem("jdex_last_active", Date.now().toString());
        };

        runCatchUp();
    }, [realPricesLoaded, isSimulating, selectedCurrency, addMessage, marketData.price]);

    // Update last active timestamp periodically
    useEffect(() => {
        if (!isSimulating) return;
        const interval = setInterval(() => {
            localStorage.setItem("jdex_last_active", Date.now().toString());
        }, 10000); // Every 10s
        return () => clearInterval(interval);
    }, [isSimulating]);

    useEffect(() => {
        const data = allMarketPrices[selectedCurrency] || initialData[selectedCurrency];
        setMarketData(prev => ({
            price: data.price,
            change24h: realPricesLoaded ? prev.change24h : 0,
            volume: data.volume,
            trend: prev.change24h > 0 ? "BULL" : prev.change24h < 0 ? "BEAR" : "SIDEWAYS",
        }));
        setPriceHistory([]);
    }, [selectedCurrency, realPricesLoaded]);

    // Simulation Loop
    useEffect(() => {
        if (!isSimulating) {
            isActiveRef.current = false;
            return;
        }

        isActiveRef.current = true;
        let timeoutId: NodeJS.Timeout;

        const loop = async () => {
            if (!isActiveRef.current) return;

            const currentMarketData = marketDataRef.current;
            const currentPortfolio = portfolioRef.current;
            const currentAgents = agentsRef.current;
            const isBuyActuallyAllowed = isDemoMode || (!!effectiveIsConnected && !tradeInProgress);


            let newPrice = currentMarketData.price;
            let newTrend = currentMarketData.trend;

            setMarketData((prev) => {
                const change = (Math.random() - 0.5) * (prev.price * 0.002);
                newPrice = prev.price + change;
                const newChange24h = prev.change24h + (change / prev.price) * 100;
                newTrend = newChange24h > 0 ? "BULL" : "BEAR";

                return {
                    ...prev,
                    price: parseFloat(newPrice.toFixed(2)),
                    change24h: parseFloat(newChange24h.toFixed(2)),
                    trend: newTrend,
                };
            });

            // Update Risk Status based on 24h change
            const currentPriceData = allMarketPrices[selectedCurrency] || initialData[selectedCurrency];
            const currentChange = (newPrice - currentPriceData.price) / currentPriceData.price * 100;

            if (currentChange < -5) {
                setRiskStatus("CRITICAL");
                setAtmosphere("ALERT");
            } else if (currentChange < -2) {
                setRiskStatus("CAUTION");
                setAtmosphere("NEGATIVE");
            } else if (currentChange > 3) {
                const initialBalance = 30000;
                const newProfit = currentPortfolio.totalValue - initialBalance;
                if (newProfit > 0) {
                    setAtmosphere("POSITIVE");
                    updateAchievementProgress("profit-100", Math.floor(newProfit));
                } else if (newProfit < -100) {
                    setAtmosphere("NEGATIVE");
                }
                setRiskStatus("SAFE");
            } else {
                setRiskStatus("SAFE");
                setAtmosphere("NEUTRAL");
            }

            setPriceHistory((history) => {
                const now = new Date();
                const ts = Math.floor(now.getTime() / 1000);
                const validPrice = typeof newPrice === 'number' && !isNaN(newPrice) ? newPrice : (history.length > 0 ? history[history.length - 1].price : currentMarketData.price);

                const newPoint: PricePoint = {
                    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    price: validPrice,
                    timestamp: ts
                };

                const newHistory = [...history.filter(p => p.timestamp !== ts), newPoint];
                if (newHistory.length > 50) newHistory.shift();
                return newHistory.sort((a, b) => a.timestamp - b.timestamp);
            });

            const tickTs = Date.now();
            pushSymbolPriceSample(selectedCurrency, newPrice, tickTs);
            Object.entries(allMarketPrices).forEach(([symbol, data]) => {
                if (symbol === selectedCurrency) return;
                const normalizedSymbol = normalizeTrackedSymbol(symbol);
                if (TRADE_CONFIG.STABLECOINS.includes(normalizedSymbol)) return;
                pushSymbolPriceSample(normalizedSymbol, Number((data as any)?.price || 0), tickTs);
            });

            if (isDemoMode) {
                setPortfolio((prevPortfolio) => {
                    const positionsValue = prevPortfolio.positions.reduce((acc, pos) => {
                        let price = 0;
                        if (pos.symbol === selectedCurrency) {
                            price = newPrice;
                        } else {
                            // Prices here are in USD
                            price = allMarketPrices[pos.symbol]?.price || initialData[pos.symbol]?.price || 0;
                        }
                        return acc + (pos.amount * price);
                    }, 0);
                    return {
                        ...prevPortfolio,
                        totalValue: parseFloat((positionsValue + prevPortfolio.cashbalance).toFixed(2)),
                    };
                });
            }

            // AI Logic Tick
            if (Math.random() > 0.6) {
                const favArray = Array.from(favorites);
                let currentSymbol = selectedCurrency;

                // 1. Reactive and Proactive Conversations
                const roll = Math.random();
                let agentIndex = roll < 0.2 ? 0 : roll < 0.4 ? 1 : roll < 0.6 ? 2 : roll < 0.8 ? 3 : 4;
                const agent = AGENTS[agentIndex];
                let content = "";
                let type: Message["type"] = "OPINION";

                // Check for significant price moves in the current selected currency
                const priceChangePct = (newPrice - currentMarketData.price) / currentMarketData.price * 100;

                if (Math.abs(priceChangePct) > 0.2) {
                    if (agent.id === "technical") {
                        content = selectedCurrency + " は短期で " + (priceChangePct > 0 ? "上昇" : "下落") + " に傾いています。1分足と5分足の勢いを確認します。";
                    } else if (agent.id === "sentiment") {
                        content = selectedCurrency + " に対する市場反応を監視中です。短期資金の流入変化を確認します。";
                    } else if (agent.id === "security") {
                        content = "急変時は逆行リスクが高まります。" + selectedCurrency + " の出来高と値動きの歪みを確認します。";
                    } else if (agent.id === "fundamental") {
                        content = selectedCurrency + " の短期変動はありますが、ニュースと市場構造をあわせて評価します。";
                    }
                } else if (Math.random() > 0.7) {
                    const allSymbols = Object.keys(allMarketPrices).filter((s) => isInterestingToken(s) && s !== selectedCurrency);
                    const randomCoin = allSymbols[Math.floor(Math.random() * allSymbols.length)];
                    const coinData = allMarketPrices[randomCoin] as any;
                    const timeframe = ["15m", "1h", "4h"][Math.floor(Math.random() * 3)];
                    const change = coinData.price_change_percentage_24h || coinData.change24h || 0;

                    if (agent.id === "technical" && change > 5) {
                        content = "【短期判定/" + randomCoin + "-JPY (" + timeframe + ")】短期モメンタムが強く、順張り候補として監視します。24h変動率は +" + change.toFixed(1) + "% です。";
                    } else if (agent.id === "sentiment" && Math.random() > 0.5) {
                        content = "【市場観測/" + randomCoin + "-JPY (" + timeframe + ")】市場の関心が高まっています。短期の資金流入に注意します。";
                    } else if (agent.id === "fundamental" && change < -10) {
                        content = "【補助判定/" + randomCoin + "-JPY (" + timeframe + ")】急落していますが、ニュース次第では逆張り候補として再評価します。";
                    } else if (agent.id === "coordinator" && randomCoin && randomCoin !== selectedCurrency) {
                        content = "【ローテーション監視】" + selectedCurrency + " と " + randomCoin + " の候補を比較し、材料と値動きが揃った通貨だけ執行します。";
                    }
                }

                if (content) {
                    addMessage(agent.id, content, type);
                } else {
                    // Signal based execution logic
                    const signalCandidates = buildRankedAutoCandidates();
                    if (signalCandidates.length === 0) {
                        if (!isDemoMode && Math.random() > 0.97) {
                            addMessage("manager", "現在のチェーンで実行可能な自動売買対象が見つからないため待機しています。", "ALERT");
                        }
                        if (isActiveRef.current) {
                            timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                        }
                        return;
                    }
                    const signalCandidate =
                        signalCandidates.find((candidate) => candidate.symbol !== lastAutoTradeSymbolRef.current)
                        || signalCandidates[0];
                    const signalSymbol = signalCandidate?.symbol || selectedCurrency;
                    const signalPrice =
                        signalCandidate?.price
                        || allMarketPrices[signalSymbol]?.price
                        || initialData[signalSymbol]?.price
                        || newPrice;
                    const isTargetStable = TRADE_CONFIG.STABLECOINS.includes(signalSymbol.toUpperCase());

                    // [REFINED GUARD] Autonomous execution must respect locks and cooldown
                    const now = Date.now();
                    const autonomousCooldown = isDemoMode ? 20000 : 12000; // live is faster for short-term scalping
                    const canExecuteAutonomous = isDemoMode &&
                        isAutoPilotEnabled &&
                        !tradeInProgress &&
                        (now - lastTradeRef.current > autonomousCooldown);

                    if (canExecuteAutonomous && agent.id === "technical" && !isTargetStable) {
                        const shortSignal = getShortMomentumSignal(signalSymbol, signalPrice);
                        const bullish =
                            shortSignal.r1 > 0.00015 &&
                            shortSignal.r5 > 0.00045 &&
                            shortSignal.r15 > 0.0009 &&
                            shortSignal.score > 0.0004;
                        const bearish =
                            shortSignal.r1 < -0.00015 &&
                            shortSignal.r5 < -0.00045 &&
                            shortSignal.r15 < -0.0009 &&
                            shortSignal.score < -0.0004;
                        if (!bullish && !bearish) {
                            // 短期足シグナルが揃わない場合は見送り
                            // keep loop alive
                        } else {
                            const action: "BUY" | "SELL" = bullish ? "BUY" : "SELL";
                            const currentPositions = currentPortfolio.positions.length;
                            const pos = currentPortfolio.positions.find((p) => p.symbol === signalSymbol);

                            const fundingDecision = pickFundingSourceForBuy(signalSymbol, Math.max(4, currentPortfolio.totalValue * 0.08), currentPortfolio);
                            const fundingSymbolForBuy = fundingDecision.sourceSymbol;
                            const suggestedBuyUsd = fundingDecision.budgetUsd;
                            const buyAmount = signalPrice > 0 ? parseFloat((suggestedBuyUsd / signalPrice).toFixed(6)) : 0;
                            const sellAmount = pos ? parseFloat((Math.min(pos.amount, Math.max(pos.amount * 0.25, 0.0001))).toFixed(6)) : 0;
                            const sellUsd = sellAmount * Math.max(signalPrice, 0);
                            const amount = action === "BUY" ? buyAmount : sellAmount;

                            const hasInventory = action === "SELL" ? !!pos && pos.amount >= amount && amount > 0 && sellUsd >= 2 : true;

                            if (action === "BUY" && currentPositions < 3 && isBuyActuallyAllowed && amount > 0 && suggestedBuyUsd >= 3) {
                                    type = "EXECUTION";
                                    const jpyPrice = convertJPY(signalPrice);
                                    const notionalJpy = convertJPY(suggestedBuyUsd);
                                    content =
                                    `購入シグナル: ${amount.toFixed(6)} ${signalSymbol} @ ¥${Math.round(jpyPrice).toLocaleString("ja-JP")}\n`
                                    + `1分:${(shortSignal.r1 * 100).toFixed(2)}% / 5分:${(shortSignal.r5 * 100).toFixed(2)}% / 15分:${(shortSignal.r15 * 100).toFixed(2)}%\n`
                                    + `想定発注額: ¥${Math.round(notionalJpy).toLocaleString("ja-JP")}`;
                                const executed = await executeTrade(
                                    signalSymbol,
                                    action,
                                    amount,
                                    signalPrice,
                                    "自動トレードシグナル",
                                    undefined,
                                    fundingSymbolForBuy,
                                    undefined,
                                    AUTO_TRADE_NOTIFICATION_META,
                                );
                                if (executed) {
                                    lastAutoTradeSymbolRef.current = signalSymbol;
                                    addMessage(agent.id, content, type);
                                }
                            } else if (action === "SELL" && hasInventory) {
                                type = "EXECUTION";
                                const jpyPrice = convertJPY(signalPrice);
                                const notionalJpy = convertJPY(amount * signalPrice);
                                content =
                                    `売却シグナル: ${amount.toFixed(6)} ${signalSymbol} @ ¥${Math.round(jpyPrice).toLocaleString("ja-JP")}\n`
                                    + `1分:${(shortSignal.r1 * 100).toFixed(2)}% / 5分:${(shortSignal.r5 * 100).toFixed(2)}% / 15分:${(shortSignal.r15 * 100).toFixed(2)}%\n`
                                    + `想定売却額: ¥${Math.round(notionalJpy).toLocaleString("ja-JP")}`;
                                const executed = await executeTrade(
                                    signalSymbol,
                                    action,
                                    amount,
                                    signalPrice,
                                    "自動トレードシグナル",
                                    undefined,
                                    undefined,
                                    undefined,
                                    AUTO_TRADE_NOTIFICATION_META,
                                );
                                if (executed) {
                                    lastAutoTradeSymbolRef.current = signalSymbol;
                                    addMessage(agent.id, content, type);
                                }
                            }
                        }
                    }
                }
            }

            // News Simulation
            if (Math.random() > 0.98) {
                let news: MarketNews;
                if (Math.random() > 0.7) {
                    try {
                        const realFeeds = await getCryptoNews();
                        news = realFeeds.length > 0 ? convertRealToMarketNews(realFeeds[Math.floor(Math.random() * realFeeds.length)]) : generateRandomNews(selectedCurrency);
                    } catch (e) {
                        news = generateRandomNews(selectedCurrency);
                    }
                } else {
                    news = generateRandomNews(selectedCurrency);
                }

                setLatestNews(news);
                triggerLearningPulse(news);

                const reactingAgent = currentAgents[Math.floor(Math.random() * currentAgents.length)];
                const reactionPrefix = news.category === "REAL"
                    ? ("【REAL-TIME NEWS from " + news.source + "】")
                    : "【Market Intelligence】";
                if (news.impact === "BULLISH") {
                    addMessage(reactingAgent.id, reactionPrefix + " " + news.title + " - ポジティブ材料です。" + selectedCurrency + " は上昇継続に注意します。", "OPINION");
                } else if (news.impact === "BEARISH") {
                    addMessage(reactingAgent.id, reactionPrefix + " " + news.title + " - ネガティブ材料です。慎重な執行が必要です。", "ALERT");
                }
            }

            if (isSimulating && isDemoMode) {
                // 1. Risk Management Check (Positions level)
                const currentPortfolio = portfolioRef.current;
                for (const pos of currentPortfolio.positions) {
                    const priceData = allMarketPrices[pos.symbol] || initialData[pos.symbol];
                    if (!priceData) continue;
                    const posPrice = priceData.price;
                    const posUsd = posPrice * pos.amount;
                    if (posUsd < 2) continue;

                    const pnlPct = pos.entryPrice > 0
                        ? ((posPrice - pos.entryPrice) / pos.entryPrice) * 100
                        : 0;

                    // Stop Loss Check
                    if (pnlPct <= stopLossThreshold) {
                        executeTrade(
                            pos.symbol,
                            "SELL",
                            pos.amount,
                            posPrice,
                            "ストップロス発動 (" + stopLossThreshold + "%)",
                            undefined,
                            undefined,
                            undefined,
                            AUTO_TRADE_NOTIFICATION_META,
                        );
                        addMessage("security", "[緊急決済] " + pos.symbol + " がストップロス (" + stopLossThreshold + "%) に達したため売却しました。", "ALERT");
                    }
                    // Take Profit Check
                    else if (pnlPct >= takeProfitThreshold) {
                        executeTrade(
                            pos.symbol,
                            "SELL",
                            pos.amount,
                            posPrice,
                            "利益確定注文実行 (+" + takeProfitThreshold + "%)",
                            undefined,
                            undefined,
                            undefined,
                            AUTO_TRADE_NOTIFICATION_META,
                        );
                        addMessage("manager", "[利確完了] " + pos.symbol + " が目標利益 (" + takeProfitThreshold + "%) に到達しました。", "EXECUTION");
                    }

                    // --- NEW RISK MANAGEMENT ---
                    // 1. Update Highest Price (Mutate ref for tracking during session)
                    if (!pos.highestPrice || posPrice > pos.highestPrice) {
                        pos.highestPrice = posPrice;
                    }

                    // 2. Trailing Stop
                    const trailingThreshold = 4; // 4%
                    const highest = pos.highestPrice || posPrice;
                    if (highest > 0 && posPrice < highest * (1 - trailingThreshold / 100)) {
                        if (posPrice > pos.entryPrice * 1.04) { // Secure at least 4% profit
                            executeTrade(
                                pos.symbol,
                                "SELL",
                                pos.amount,
                                posPrice,
                                "トレーリングストップ決済 (最高値 $" + highest.toLocaleString() + " から -" + trailingThreshold + "%)",
                                undefined,
                                undefined,
                                undefined,
                                AUTO_TRADE_NOTIFICATION_META,
                            );
                            addMessage("manager", "[利益確保] " + pos.symbol + " が最高値から反落したため決済しました。", "EXECUTION");
                        }
                    }

                    // 3. Smart Stop-Loss (Emergency)
                    const emergencyCutoff = Math.min(stopLossThreshold - 1, -6);
                    if (riskStatus === "CRITICAL" && pnlPct <= emergencyCutoff) {
                        executeTrade(
                            pos.symbol,
                            "SELL",
                            pos.amount,
                            posPrice,
                            "緊急回避: 市場リスク高騰に伴う防御損切り",
                            undefined,
                            undefined,
                            undefined,
                            AUTO_TRADE_NOTIFICATION_META,
                        );
                        addMessage("security", "[緊急回避] 市場リスクが高騰したため " + pos.symbol + " を早期損切りしました。", "ALERT");
                    }
                    // ---------------------------
                }

                // RISK HEDGING: Move to stables if atmosphere is bad
                if (atmosphere === "ALERT" || atmosphere === "NEGATIVE") {
                    if (Math.random() > 0.8) {
                        const topPos = [...currentPortfolio.positions].sort((a, b) => b.amount - a.amount)[0];
                        if (topPos && topPos.amount > 0) {
                            const priceData = allMarketPrices[topPos.symbol] || initialData[topPos.symbol];
                            if (priceData) {
                                const hedgeAmount = topPos.amount * 0.3; // Move 30% to cash
                                executeTrade(
                                    topPos.symbol,
                                    "SELL",
                                    hedgeAmount,
                                    priceData.price,
                                    "リスクヘッジ: 市場センチメント悪化に伴う資金待避",
                                    undefined,
                                    undefined,
                                    undefined,
                                    AUTO_TRADE_NOTIFICATION_META,
                                );
                            }
                        }
                    }
                }

                if (isDemoMode) {
                    const baseBalance = isDemoMode ? demoBalance : portfolioRef.current.cashbalance;
                    let targetSymbol = selectedCurrency;

                    const rankedCandidates = buildRankedAutoCandidates();
                    const topCandidates = rankedCandidates.slice(0, Math.min(8, rankedCandidates.length));
                    const diversifiedCandidates = topCandidates.filter((candidate) => candidate.symbol !== lastAutoTradeSymbolRef.current);
                    const rotationPool = diversifiedCandidates.length > 0 ? diversifiedCandidates : topCandidates;
                    if (rotationPool.length === 0) {
                        if (!isDemoMode && Math.random() > 0.95) {
                            addMessage("manager", "チェーン対応トークン不足のため自動売買を一時待機しています。", "ALERT");
                        }
                        if (isActiveRef.current) timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                        return;
                    }

                    if (!hasInitialTradeExecuted) {
                        const preferredInitialCandidate =
                            rotationPool.find((candidate) =>
                                candidate.symbol !== selectedCurrency &&
                                candidate.symbol !== initialTradeSymbol &&
                                !currentPortfolio.positions.some((position) => position.symbol === candidate.symbol)
                            ) ||
                            rotationPool.find((candidate) => candidate.symbol !== selectedCurrency) ||
                            rotationPool[0];

                        targetSymbol = (preferredInitialCandidate?.symbol || initialTradeSymbol || selectedCurrency) as Currency;
                        if (initialTradeSymbol !== targetSymbol) {
                            setInitialTradeSymbol(targetSymbol);
                        }
                    } else if (rotationPool.length > 0) {
                        const rotationIndex = autoTradeRotationIndexRef.current % rotationPool.length;
                        targetSymbol = rotationPool[rotationIndex].symbol as Currency;
                        autoTradeRotationIndexRef.current = (rotationIndex + 1) % Math.max(rotationPool.length, 1);
                    }

                    const currentTokenPrice = allMarketPrices[targetSymbol]?.price || initialData[targetSymbol]?.price || 0;
                    if (currentTokenPrice === 0) {
                        if (isActiveRef.current) timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                        return;
                    }

                    const shortSignal = getShortMomentumSignal(targetSymbol, currentTokenPrice);
                    const previousPrice = priceHistory[priceHistory.length - 2]?.price || currentTokenPrice;
                    const volatility = Math.max(
                        Math.abs(currentTokenPrice - previousPrice) / Math.max(currentTokenPrice, 0.0000001),
                        Math.abs(shortSignal.r1) + Math.abs(shortSignal.r5) + Math.abs(shortSignal.r15),
                    );

                    if (priceHistory.length > 5 && targetSymbol === selectedCurrency) {
                        const firstPoint = priceHistory[0];
                        const lastPoint = priceHistory[priceHistory.length - 1];
                        if (!firstPoint || !lastPoint) {
                            if (isActiveRef.current) timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                            return;
                        }
                        const startP = firstPoint.price;
                        const endP = lastPoint.price;
                        const chg = (endP - startP) / startP;
                        if (volatility > 0.03) {
                            setMarketRegime(prev => (prev !== "VOLATILE" ? "VOLATILE" : prev));
                        } else if (chg > 0.01) {
                            setMarketRegime(prev => (prev !== "TREND_UP" ? "TREND_UP" : prev));
                        } else if (chg < -0.01) {
                            setMarketRegime(prev => (prev !== "TREND_DOWN" ? "TREND_DOWN" : prev));
                        } else {
                            setMarketRegime(prev => (prev !== "RANGE" ? "RANGE" : prev));
                        }
                    }

                    let shouldBuy = false;
                    let shouldSell = false;
                    let amountInJPY = Math.max(1.2, baseBalance * 0.12);
                    amountInJPY = Math.min(amountInJPY, Math.max(1.2, Math.min(baseBalance * 0.35, 12)));
                    if (volatility > 0.03) {
                        amountInJPY *= 0.7;
                    }
                    let amountToTrade = amountInJPY / currentTokenPrice;

                    if (!hasInitialTradeExecuted) {
                        shouldBuy = true;
                        if (lastInitialCandidateRef.current !== targetSymbol) {
                            lastInitialCandidateRef.current = targetSymbol;
                            addMessage(
                                "coordinator",
                                "短期順張りエントリー: "
                                + targetSymbol
                                + "\n1分 / 5分 / 15分の短期モメンタムと 24h 変動率を確認中"
                                + `\n日次目標: +${DAILY_COMPOUND_TARGET_PCT}% (小幅利確の積み上げ)`
                                + "\n1分: "
                                + (shortSignal.r1 * 100).toFixed(2)
                                + "% / 5分: "
                                + (shortSignal.r5 * 100).toFixed(2)
                                + "% / 15分: "
                                + (shortSignal.r15 * 100).toFixed(2)
                                + "%"
                                + "\n買い目安: ¥"
                                + Math.round(convertJPY(currentTokenPrice)).toLocaleString("ja-JP")
                                + "\n利確目安: ¥"
                                + Math.round(convertJPY(currentTokenPrice * (1 + takeProfitThreshold / 100))).toLocaleString("ja-JP")
                                + "\n損切り目安: ¥"
                                + Math.round(convertJPY(currentTokenPrice * (1 + stopLossThreshold / 100))).toLocaleString("ja-JP"),
                                "SYSTEM"
                            );
                        }
                    } else {
                        const isLiveAutopilot = !isDemoMode && effectiveIsConnected;
                        const aggressiveCooldown = isLiveAutopilot ? 45 * 1000 : 2 * 60 * 1000;
                        const moderateCooldown = isLiveAutopilot ? 90 * 1000 : 5 * 60 * 1000;
                        const conservativeCooldown = isLiveAutopilot ? 180 * 1000 : 12 * 60 * 1000;
                        const now = Date.now();

                        const bullishStack =
                            shortSignal.r1 > 0.00005 &&
                            shortSignal.r5 > 0.00015 &&
                            shortSignal.r15 > 0.00025 &&
                            shortSignal.score > 0.00012;
                        const bearishStack =
                            shortSignal.r1 < -0.00005 &&
                            shortSignal.r5 < -0.00015 &&
                            shortSignal.r15 < -0.00025 &&
                            shortSignal.score < -0.00012;
                        const confidenceBoost = Math.max(0.08, Math.min(0.22, 0.08 + shortSignal.confidence * 0.14));

                        if (demoStrategy === "AGGRESSIVE" && now - lastTradeRef.current > aggressiveCooldown) {
                            if (volatility > 0.0012) {
                                shouldBuy = bullishStack;
                                shouldSell = bearishStack;
                                amountInJPY = Math.max(2, baseBalance * confidenceBoost);
                                amountToTrade = amountInJPY / currentTokenPrice;
                            }
                        } else if (demoStrategy === "MODERATE" && now - lastTradeRef.current > moderateCooldown) {
                            if (volatility > 0.0020) {
                                shouldBuy = bullishStack;
                                shouldSell = bearishStack;
                                amountInJPY = Math.max(2, baseBalance * Math.max(0.06, confidenceBoost * 0.85));
                                amountToTrade = amountInJPY / currentTokenPrice;
                            }
                        } else if (demoStrategy === "CONSERVATIVE" && now - lastTradeRef.current > conservativeCooldown) {
                            if (volatility > 0.0028) {
                                shouldBuy = bullishStack;
                                shouldSell = bearishStack;
                                amountInJPY = Math.min(baseBalance * 0.05, baseBalance);
                                amountToTrade = amountInJPY / currentTokenPrice;
                            }
                        }
                    }

                    amountInJPY = Math.max(1, Math.min(amountInJPY, Math.max(1, Math.min(baseBalance * 0.4, 12))));
                    amountToTrade = amountInJPY / Math.max(currentTokenPrice, 0.0000001);

                    const fundingDecision = pickFundingSourceForBuy(targetSymbol, amountInJPY, currentPortfolio);
                    const fundingSymbolForBuy = fundingDecision.sourceSymbol;
                    const effectiveBuyBudgetUsd = fundingDecision.budgetUsd;
                    const effectiveBuyAmount = effectiveBuyBudgetUsd > 0 ? (effectiveBuyBudgetUsd / currentTokenPrice) : 0;

                    if (shouldBuy && effectiveBuyBudgetUsd >= 3 && effectiveBuyAmount > 0 && isBuyActuallyAllowed) {
                        const existingPosCount = currentPortfolio.positions.length;
                        const existingPos = currentPortfolio.positions.find(p => p.symbol === targetSymbol);
                        const totalPortfolioValue = currentPortfolio.totalValue || baseBalance;
                        const hypotheticalNewValue = (existingPos ? existingPos.amount * currentTokenPrice : 0) + effectiveBuyBudgetUsd;
                        const concentrationLimit = hasInitialTradeExecuted ? 0.4 : 0.85;

                        if (existingPosCount < 5 || existingPos) {
                            if (hypotheticalNewValue <= totalPortfolioValue * concentrationLimit) {
                                const demoBuyReason =
                                    fundingSymbolForBuy && !TRADE_CONFIG.STABLECOINS.includes(fundingSymbolForBuy)
                                        ? `${demoStrategy}戦略: 短期モメンタム買い（資金再配分 ${fundingSymbolForBuy}→${targetSymbol}）`
                                        : `${demoStrategy}戦略: 短期モメンタム買い`;

                                const executed = await executeTrade(
                                    targetSymbol,
                                    "BUY",
                                    effectiveBuyAmount,
                                    currentTokenPrice,
                                    demoBuyReason,
                                    undefined,
                                    fundingSymbolForBuy,
                                    undefined,
                                    AUTO_TRADE_NOTIFICATION_META,
                                );
                                if (executed) {
                                    lastTradeRef.current = Date.now();
                                    lastAutoTradeSymbolRef.current = targetSymbol;
                                    if (!hasInitialTradeExecuted) {
                                        setHasInitialTradeExecuted(true);
                                        addMessage("coordinator", "初回トレード完了: " + targetSymbol + " を自動売買対象として監視に移行します。", "SYSTEM");
                                    }
                                }
                            } else if (Math.random() > 0.95) {
                                addMessage("manager", "保有比率上限により " + targetSymbol + " の追加購入を見送りました。", "ALERT");
                            }
                        } else if (Math.random() > 0.95) {
                            addMessage("manager", "保有銘柄数の上限に達しているため、新規買いを見送りました。", "ALERT");
                        }
                    } else if (shouldSell) {
                        const pos = currentPortfolio.positions.find(p => p.symbol === targetSymbol)
                            || [...currentPortfolio.positions]
                                .filter((p) => p.amount > 0)
                                .sort((a, b) => {
                                    const aPrice = allMarketPrices[a.symbol]?.price || initialData[a.symbol]?.price || 0;
                                    const bPrice = allMarketPrices[b.symbol]?.price || initialData[b.symbol]?.price || 0;
                                    return (b.amount * bPrice) - (a.amount * aPrice);
                                })[0];
                        if (pos && pos.amount > 0) {
                            const sellSymbol = pos.symbol;
                            const sellPrice = allMarketPrices[sellSymbol]?.price || initialData[sellSymbol]?.price || currentTokenPrice;
                            const sellAmount = Math.min(
                                pos.amount,
                                Math.max(pos.amount * 0.2, Math.min(amountToTrade, pos.amount)),
                            );
                            const sellUsd = sellAmount * Math.max(sellPrice, 0);
                            if (sellAmount <= 0 || sellUsd < 2.0) {
                                if (isActiveRef.current) timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                                return;
                            }
                            const executed = await executeTrade(
                                sellSymbol,
                                "SELL",
                                sellAmount,
                                sellPrice,
                                demoStrategy + "戦略: 短期モメンタム売り",
                                undefined,
                                undefined,
                                undefined,
                                AUTO_TRADE_NOTIFICATION_META,
                            );
                            if (executed) {
                                lastTradeRef.current = Date.now();
                                lastAutoTradeSymbolRef.current = sellSymbol;
                            }
                        }
                    }
                }
            }

            if (isActiveRef.current) {
                const delay = Math.random() * 3000 + 1000;
                timeoutId = setTimeout(loop, delay);
            }
        };

        timeoutId = setTimeout(loop, 1000);

        return () => {
            isActiveRef.current = false;
            clearTimeout(timeoutId);
        };
    }, [
        isSimulating,
        selectedCurrency,
        addMessage,
        isDemoMode,
        effectiveIsConnected,
        isAutoPilotEnabled,
        demoBalance,
        hasInitialTradeExecuted,
        executeTrade,
        buildRankedAutoCandidates,
        pushSymbolPriceSample,
        getShortMomentumSignal,
        pickFundingSourceForBuy,
        demoStrategy,
        allowedStartTokens,
        publicClient,
        convertJPY,
        stopLossThreshold,
        takeProfitThreshold,
    ]);

    // Live auto-trade scheduler: deterministic execution loop to avoid random no-trade windows.
    useEffect(() => {
        if (!isSimulating || isDemoMode || !isAutoPilotEnabled) return;
        if (!effectiveIsConnected || !effectiveAddress || !effectiveChainId || !publicClient) return;

        let cancelled = false;

        const emitLiveAutoStatus = (message: string, payload?: Record<string, unknown>) => {
            setLastAutoPilotStatus(message);
            const now = Date.now();
            if (now - lastLiveAutoStatusRef.current < 30_000) return;
            lastLiveAutoStatusRef.current = now;
            console.warn("[AUTO_LIVE]", message, payload || {});
        };

        const runLiveAutoTick = async () => {
            if (cancelled || tradeExecutionLockRef.current || tradeInProgress) {
                emitLiveAutoStatus("skip: tradeInProgress or cancelled");
                return;
            }

            const now = Date.now();
            if (now - lastTradeRef.current < 18_000) {
                emitLiveAutoStatus("skip: global cooldown", { remainingMs: 18_000 - (now - lastTradeRef.current) });
                return;
            }

            if (now - lastStrategyRefreshRef.current > 5 * 60 * 1000) {
                refreshDailyStrategyProposals("timer");
            }

            if (now - lastLiveStrategyMonitorRefreshRef.current > STRATEGY_CONFIG.TRIGGER_REFRESH_MINUTES * 60 * 1000 || !liveStrategyMonitorRef.current) {
                refreshContinuousStrategyMonitor("timer");
            }

            const currentPortfolio = portfolioRef.current;
            const { minOrderUsd } = getLiveOrderTargets(currentPortfolio.totalValue || 0, jpyRate);
            const currentCycleInfo = getTokyoCycleInfo(now);
            const liveMonitor = liveStrategyMonitorRef.current;

            if (!liveMonitor) {
                emitLiveAutoStatus("skip: monitor snapshot not ready", {
                    block: currentCycleInfo.block,
                    candleStoreReady: isStrategyCandleStoreReady,
                });
                return;
            }
            const candidateMap = new Map<string, ContinuousStrategyCandidate>(
                liveMonitor.candidates.map((candidate) => [normalizeTrackedSymbol(candidate.symbol), candidate] as const),
            );
            const buildOrderPlan = (candidate: ContinuousStrategyCandidate, source: "selected" | "supplemental") => ({
                symbol: candidate.symbol,
                displaySymbol: candidate.displaySymbol,
                chain: candidate.chain,
                executionChain: candidate.executionChain,
                executionChainId: candidate.executionChainId,
                executionAddress: candidate.executionAddress,
                executionDecimals: candidate.executionDecimals,
                executionRouteKind: candidate.executionRouteKind,
                executionSource: candidate.executionSource,
                executionPairUrl: candidate.executionPairUrl,
                weight: candidate.allocationWeight || (1 / Math.max(1, liveMonitor.selected.length + (source === "supplemental" ? 1 : 0))),
                rank: candidate.rank,
                mode: candidate.mode,
                score: candidate.marketScore,
                liquidity: candidate.liquidity,
                referencePrice: candidate.price,
                plannedEntryAt: 0,
                plannedExitAt: 0,
                entryMin: candidate.price * resolveLiveEntryWindow(candidate).minMultiplier,
                entryMax: candidate.price * resolveLiveEntryWindow(candidate).maxMultiplier,
                plannedTakeProfit: candidate.dynamicTakeProfit,
                plannedStopLoss: candidate.dynamicStopLoss,
                positionSizeMultiplier: candidate.positionSizeMultiplier,
                positionSizeLabel: candidate.positionSizeLabel,
                triggerState: candidate.triggerState,
                triggerType: candidate.triggerType,
                regime: candidate.regime,
                triggerProgressRatio: candidate.triggerProgressRatio,
                triggerMissingReasons: candidate.triggerMissingReasons,
                executionLiquidityUsd: candidate.executionLiquidityUsd,
                timedExitMinutes: candidate.timedExitMinutes,
                autoTradeTarget: candidate.autoTradeTarget,
                conditionalReferencePass: candidate.conditionalReferencePass,
                probationaryEligible: candidate.probationaryEligible,
                orderArmEligible:
                    candidate.orderArmEligible
                    || candidate.triggerState === "Triggered"
                    || (
                        candidate.autoTradeTarget
                        && candidate.triggerState === "Armed"
                        && (candidate.triggerProgressRatio || 0) >= (
                            candidate.regime === "Range"
                                ? Math.max(0.58, STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_PROGRESS)
                                : Math.max(0.56, STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS)
                        )
                        && candidate.resistanceStatus !== "Blocked"
                        && !candidate.autoTradeExcludedReason
                    ),
                eventPriority: candidate.eventPriority,
                orderSource: source,
                selectedAt: strategyPerformanceStoreRef.current.lifecycles[`${candidate.chain}:${normalizeTrackedSymbol(candidate.symbol)}`]?.selectedAt,
                triggeredAt: strategyPerformanceStoreRef.current.lifecycles[`${candidate.chain}:${normalizeTrackedSymbol(candidate.symbol)}`]?.triggeredAt,
            });
            const isTradeablePlan = (plan: ReturnType<typeof buildOrderPlan>) => {
                const symbol = normalizeTrackedSymbol(plan.symbol);
                const candidate = candidateMap.get(symbol);
                if (!STRATEGY_CANDLE_SYMBOL_SET.has(symbol)) return false;
                if (candidate?.autoTradeExcludedReason) return false;
                return true;
            };
            const derivePlanEdgeMetrics = (
                plan: ReturnType<typeof buildOrderPlan>,
                price: number,
                fundingUsd?: number,
            ) => {
                const notionalUsd = Math.max(
                    0,
                    Number.isFinite(fundingUsd || 0) && Number(fundingUsd || 0) > 0
                        ? Number(fundingUsd || 0)
                        : Math.max(minOrderUsd, (currentPortfolio.totalValue || 0) * plan.weight * Math.max(Number(plan.positionSizeMultiplier || 0), 0.25)),
                );
                const amount = price > 0 ? notionalUsd / price : 0;
                const expectedProfitUsd = Math.max(0, (plan.plannedTakeProfit - price) * amount);
                const expectedProfitPct = price > 0 ? ((plan.plannedTakeProfit - price) / price) * 100 : 0;
                const expectedLossUsd = Math.max(0, (price - plan.plannedStopLoss) * amount);
                const expectedLossPct = price > 0 ? ((price - plan.plannedStopLoss) / price) * 100 : 0;
                const edgeRatio = expectedLossUsd > 0 ? expectedProfitUsd / expectedLossUsd : Number.POSITIVE_INFINITY;
                const netExpectedUsd = expectedProfitUsd - (expectedLossUsd * 0.72);
                return {
                    amount,
                    notionalUsd,
                    expectedProfitUsd,
                    expectedProfitPct,
                    expectedLossUsd,
                    expectedLossPct,
                    edgeRatio,
                    netExpectedUsd,
                };
            };
            const scoreLiveOrderPlan = (plan: ReturnType<typeof buildOrderPlan>) => {
                const symbol = normalizeTrackedSymbol(plan.symbol);
                const candidate = candidateMap.get(symbol);
                const price = getExecutionAwareUsdPrice(symbol, plan.executionRouteKind);
                const signal = Number.isFinite(price) && price > 0
                    ? getShortMomentumSignal(symbol, price)
                    : { r1: 0, r5: 0, r15: 0, r60: 0, score: 0, confidence: 0 };
                const edge = derivePlanEdgeMetrics(plan, Math.max(price, 0));
                const oscillatorScore =
                    signal.score * 1200
                    + signal.confidence * 18
                    + (Number(candidate?.metrics.macd1h || 0) > 0 ? 7 : -2)
                    + (Number(candidate?.metrics.macd6h || 0) > 0 ? 5 : -1)
                    + (Number(candidate?.metrics.rsi1h || 50) >= 40 && Number(candidate?.metrics.rsi1h || 50) <= 70 ? 5 : -2)
                    + (Number(candidate?.metrics.rsi6h || 50) >= 38 && Number(candidate?.metrics.rsi6h || 50) <= 68 ? 4 : -1);
                const triggerScore =
                    (plan.triggerState === "Triggered" ? 18 : plan.triggerState === "Armed" ? 10 : 4)
                    + ((plan.triggerProgressRatio || 0) * 22);
                const regimeFit =
                    plan.regime === "Trend"
                        ? (signal.r15 >= -0.0015 ? 6 : -4) + (signal.r60 >= -0.0035 ? 4 : -3)
                        : (Math.abs(signal.r15) <= 0.018 ? 6 : 1) + (Math.abs(signal.r5) <= 0.012 ? 4 : 0);
                const edgeScore =
                    (edge.expectedProfitPct * 9)
                    + (edge.netExpectedUsd * 3.2)
                    + (Math.min(edge.edgeRatio, 4) * 12)
                    - (edge.expectedLossPct * 3.5);
                const executionBonus = plan.conditionalReferencePass ? 2 : 5;
                return (
                    ((plan.eventPriority || 0) * 7)
                    + (plan.score || 0)
                    + oscillatorScore
                    + triggerScore
                    + regimeFit
                    + edgeScore
                    + executionBonus
                );
            };
            const selectedPlans = liveMonitor.selected
                .map((candidate) => buildOrderPlan(candidate, "selected"))
                .filter(isTradeablePlan)
                .sort((left, right) => scoreLiveOrderPlan(right) - scoreLiveOrderPlan(left));
            const managedComparableExposure = new Map<string, number>();
            transactionsRef.current.forEach((tx) => {
                if (tx.success === false) return;
                if (!tx.autoTradeTarget) return;
                const comparable = comparableTradeSymbol(tx.symbol);
                const delta = tx.type === "BUY" ? tx.amount : -tx.amount;
                managedComparableExposure.set(comparable, (managedComparableExposure.get(comparable) || 0) + delta);
            });
            const managedComparableSet = new Set(
                Array.from(managedComparableExposure.entries())
                    .filter(([, amount]) => amount > 0.000001)
                    .map(([symbol]) => symbol),
            );
            const managedPortfolioPositions = currentPortfolio.positions.filter((position) =>
                managedComparableSet.has(comparableTradeSymbol(position.symbol)),
            );
            const syntheticPositions = getCrossChainShadowPositions().filter(
                (position) => !managedPortfolioPositions.some(
                    (entry) => normalizeTrackedSymbol(entry.symbol) === normalizeTrackedSymbol(position.symbol),
                ),
            );
            const pendingCrossChainSymbols = new Set(
                crossChainOrdersRef.current
                    .filter((order) => isPendingCrossChainStatus(order.status))
                    .map((order) => normalizeTrackedSymbol(order.symbol)),
            );
            const pendingComparableSymbols = new Set(
                crossChainOrdersRef.current
                    .filter((order) => isPendingCrossChainStatus(order.status))
                    .map((order) => comparableTradeSymbol(order.symbol)),
            );
            const effectivePositions = [...managedPortfolioPositions, ...syntheticPositions];
            const positionMap = new Map(
                effectivePositions.map((entry) => [normalizeTrackedSymbol(entry.symbol), entry]),
            );
            const managedExposureComparables = new Set(
                effectivePositions.map((entry) => comparableTradeSymbol(entry.symbol)),
            );
            const passiveWalletExposureComparables = new Set(
                walletHoldings
                    .filter((entry) => !entry.isStable && !entry.isGasReserve && entry.amount > 0 && entry.usdValue >= 2)
                    .map((entry) => comparableTradeSymbol(entry.symbol)),
            );
            const selectedBasketCap = liveMonitor.stats.selectedBasketCap || deriveContinuousBasketCap({
                selectionEligibleCount: liveMonitor.stats.selectionEligibleCount,
                probationaryCount: liveMonitor.stats.probationaryCount || 0,
                conditionalReferenceCount: liveMonitor.stats.conditionalReferencePassCount || 0,
                rangeCandidateCount: liveMonitor.candidates.filter((candidate) => candidate.regime === "Range" && candidate.selectionEligible).length,
                prefilterMode: liveMonitor.stats.prefilterMode,
                prefilterPassCount: liveMonitor.stats.prefilterPassCount,
            });
            const desiredBasketSlots = Math.min(
                STRATEGY_CONFIG.MAX_SELECTED_CANDIDATES + 4,
                Math.max(
                    liveMonitor.selected.length,
                    selectedBasketCap + (liveMonitor.stats.prefilterMode === "Range" ? 2 : 1),
                ),
            );
            const activeManagedSlots = new Set([
                ...managedExposureComparables,
                ...pendingComparableSymbols,
            ]).size;
            const freeEntrySlots = Math.max(0, desiredBasketSlots - activeManagedSlots);
            const supplementalPlans = freeEntrySlots > 0
                ? liveMonitor.candidates
                    .filter((candidate) =>
                        (candidate.orderArmEligible || candidate.triggerState === "Triggered")
                        && candidate.selectionEligible
                        && !candidate.autoTradeTarget
                        && !candidate.correlationRejected
                        && (candidate.executionStatus === "Pass" || candidate.conditionalReferencePass)
                        && !candidate.autoTradeExcludedReason
                    )
                    .sort((left, right) => scoreLiveOrderPlan(buildOrderPlan(right, "supplemental")) - scoreLiveOrderPlan(buildOrderPlan(left, "supplemental")))
                    .map((candidate) => buildOrderPlan(candidate, "supplemental"))
                    .filter(isTradeablePlan)
                    .slice(0, freeEntrySlots)
                : [];
            const basketPlans = [...selectedPlans, ...supplementalPlans];
            const selectedPlanSymbolSet = new Set(selectedPlans.map((plan) => normalizeTrackedSymbol(plan.symbol)));
            const basketSet = new Set(basketPlans.map((plan) => normalizeTrackedSymbol(plan.symbol)));
            const latestTradeRecord = (symbol: string, action: "BUY" | "SELL") => {
                const comparable = comparableTradeSymbol(symbol);
                return transactionsRef.current
                    .filter((tx) => tx.type === action && comparableTradeSymbol(tx.symbol) === comparable)
                    .sort((left, right) => right.timestamp - left.timestamp)[0];
            };
            const countExitReasonSinceBuy = (symbol: string, exitReason: StrategyExitReason, sinceTs: number) => {
                if (!sinceTs) return 0;
                const comparable = comparableTradeSymbol(symbol);
                return transactionsRef.current.filter((tx) =>
                    tx.type === "SELL"
                    && comparableTradeSymbol(tx.symbol) === comparable
                    && tx.timestamp >= sinceTs
                    && tx.exitReason === exitReason,
                ).length;
            };
            const todayStartTs = startOfJstDayTs(now);
            const realizedAutoPnlToday = transactionsRef.current
                .filter((tx) =>
                    tx.autoTradeTarget
                    && tx.type === "SELL"
                    && tx.timestamp >= todayStartTs
                    && tx.success !== false,
                )
                .reduce((sum, tx) => sum + Number(tx.pnl || 0), 0);
            const reviewOpenPositions = effectivePositions
                .map((position) => {
                    const symbol = normalizeTrackedSymbol(position.symbol);
                    const comparableSymbol = comparableTradeSymbol(symbol);
                    const price = getUsdPrice(symbol);
                    const usdValue = Number.isFinite(price) && price > 0 ? position.amount * price : 0;
                    const pnlUsd = Number.isFinite(price) && price > 0 ? (price - position.entryPrice) * position.amount : 0;
                    const pnlPct = position.entryPrice > 0 && Number.isFinite(price) && price > 0
                        ? ((price - position.entryPrice) / position.entryPrice) * 100
                        : 0;
                    const { minProfitUsd, minProfitPct } = resolveMinimumProfitableExit({
                        amount: position.amount,
                        entryPrice: position.entryPrice,
                        minOrderUsd,
                    });
                    return {
                        symbol,
                        comparableSymbol,
                        usdValue,
                        pnlUsd,
                        pnlPct,
                        profitLocked: pnlUsd >= minProfitUsd || pnlPct >= minProfitPct,
                    };
                })
                .filter((position) => position.usdValue >= 2);
            const evaluateRuleBasedPreTradeReview = (
                plan: ReturnType<typeof buildOrderPlan>,
                price: number,
                fundingUsd: number,
            ): LiveReviewDecision => {
                const symbol = normalizeTrackedSymbol(plan.symbol);
                const comparableSymbol = comparableTradeSymbol(symbol);
                const edge = derivePlanEdgeMetrics(plan, price, fundingUsd);
                const minExpectedProfitUsd = getRuntimeStrategyConfigValue("AUTO_TRADE_REVIEW_MIN_EXPECTED_PROFIT_USD");
                const minExpectedProfitPct = getRuntimeStrategyConfigValue("AUTO_TRADE_REVIEW_MIN_EXPECTED_PROFIT_PCT");
                const minEdgeRiskRatio = getRuntimeStrategyConfigValue("AUTO_TRADE_REVIEW_MIN_EDGE_RISK_RATIO");
                const maxActiveSymbols = getRuntimeStrategyConfigValue("AUTO_TRADE_REVIEW_MAX_ACTIVE_SYMBOLS");
                const costBufferUsd = Math.max(
                    minExpectedProfitUsd,
                    fundingUsd * (STRATEGY_CONFIG.AUTO_TRADE_REVIEW_COST_BUFFER_PCT / 100),
                );
                const availableStableUsd = Math.max(0, Number(currentPortfolio.cashbalance || 0));
                const profitLockStableBufferUsd = Math.max(
                    minOrderUsd * STRATEGY_CONFIG.AUTO_TRADE_REVIEW_PROFIT_LOCK_STABLE_BUFFER_MULTIPLIER,
                    costBufferUsd,
                );
                const stableFundingAllowsRotation = availableStableUsd + 1e-9 >= minOrderUsd;
                const otherOpenPositions = reviewOpenPositions.filter((position) => position.comparableSymbol !== comparableSymbol);
                const uniqueActiveSymbols = new Set(otherOpenPositions.map((position) => position.comparableSymbol)).size;

                if (uniqueActiveSymbols >= maxActiveSymbols) {
                    return {
                        pass: false,
                        reason: "AI審査NG: 同時保有上限",
                        detail: `同時保有は最大 ${maxActiveSymbols} 銘柄までに抑えています。`,
                        source: "rules",
                    };
                }

                if (
                    edge.expectedProfitUsd + 1e-9 < costBufferUsd
                    || edge.expectedProfitPct + 1e-9 < minExpectedProfitPct
                ) {
                    return {
                        pass: false,
                        reason: "AI審査NG: 期待利益不足",
                        detail: `期待利益 ${edge.expectedProfitUsd.toFixed(2)} USD / ${edge.expectedProfitPct.toFixed(2)}% が必要水準 ${costBufferUsd.toFixed(2)} USD / ${minExpectedProfitPct.toFixed(2)}% を下回っています。`,
                        source: "rules",
                    };
                }

                if (edge.edgeRatio + 1e-9 < minEdgeRiskRatio) {
                    return {
                        pass: false,
                        reason: "AI審査NG: 利益幅不足",
                        detail: `想定利益 ${edge.expectedProfitUsd.toFixed(2)} USD に対して想定損失 ${edge.expectedLossUsd.toFixed(2)} USD が近すぎます。`,
                        source: "rules",
                    };
                }

                return {
                    pass: true,
                    reason: "ルール事前審査OK",
                    detail: `期待利益 ${edge.expectedProfitUsd.toFixed(2)} USD / 想定損失 ${edge.expectedLossUsd.toFixed(2)} USD / RR ${edge.edgeRatio.toFixed(2)} / 本日損益 ${realizedAutoPnlToday.toFixed(2)} USD`,
                    source: "rules",
                    priorityScore: clamp(scoreLiveOrderPlan(plan), 0, 100),
                    sizeMultiplier: 1,
                };
            };
            const evaluateRuleBasedExitReview = (
                position: {
                    amount: number;
                    entryPrice: number;
                    regime?: StrategyRegime;
                    mode?: "TREND" | "MEAN_REVERSION";
                    positionSizeLabel?: StrategyPositionSize;
                    positionSizeMultiplier?: number;
                },
                price: number,
                pnlPct: number,
                exitReason: StrategyExitReason,
            ): LiveReviewDecision => {
                const pnlUsd = (price - position.entryPrice) * position.amount;
                const { minProfitUsd, minProfitPct } = resolveMinimumProfitableExit({
                    amount: position.amount,
                    entryPrice: position.entryPrice,
                    minOrderUsd,
                    regime: position.regime,
                    mode: position.mode,
                    positionSizeLabel: position.positionSizeLabel,
                    positionSizeMultiplier: position.positionSizeMultiplier,
                });
                const profitableExit = pnlUsd >= minProfitUsd || pnlPct >= minProfitPct;
                const protectiveExit = exitReason === "SL" || exitReason === "basket exit" || exitReason === "timed exit";
                if (!profitableExit && !protectiveExit) {
                    return {
                        pass: false,
                        reason: "AI審査NG: 利益未達",
                        detail: `損益 ${pnlUsd.toFixed(2)} USD / ${pnlPct.toFixed(2)}% が最低基準 ${minProfitUsd.toFixed(2)} USD / ${minProfitPct.toFixed(2)}% を下回っています。`,
                        source: "rules",
                    };
                }
                return {
                    pass: true,
                    reason: "ルール出口審査OK",
                    detail: `決済理由 ${exitReason} / 損益 ${pnlUsd.toFixed(2)} USD / ${pnlPct.toFixed(2)}%`,
                    source: "rules",
                    priorityScore: clamp((pnlPct * 8) + (protectiveExit ? 20 : 50), 0, 100),
                    sizeMultiplier: 1,
                };
            };
            const buildAiPeerSummary = (
                plans: Array<ReturnType<typeof buildOrderPlan>>,
                currentSymbol: string,
            ) => plans
                .filter((plan) => normalizeTrackedSymbol(plan.symbol) !== currentSymbol)
                .slice(0, getRuntimeStrategyConfigValue("OPENAI_TRADE_REVIEW_MAX_ENTRY_CANDIDATES"))
                .map((plan) => {
                    const symbol = normalizeTrackedSymbol(plan.symbol);
                    const price = getUsdPrice(symbol);
                    const signal = Number.isFinite(price) && price > 0
                        ? getShortMomentumSignal(symbol, price)
                        : { r1: 0, r5: 0, r15: 0, r60: 0, score: 0, confidence: 0 };
                    const edge = derivePlanEdgeMetrics(plan, Math.max(price, 0));
                    return {
                        symbol,
                        chain: plan.chain,
                        regime: plan.regime,
                        triggerType: plan.triggerType,
                        triggerState: plan.triggerState,
                        positionSizeLabel: plan.positionSizeLabel,
                        score: Number(plan.score || 0),
                        triggerProgressRatio: Number((plan.triggerProgressRatio || 0).toFixed(3)),
                        momentumScore: Number(signal.score.toFixed(6)),
                        confidence: Number(signal.confidence.toFixed(3)),
                        expectedProfitUsd: Number(edge.expectedProfitUsd.toFixed(2)),
                        expectedProfitPct: Number(edge.expectedProfitPct.toFixed(2)),
                        expectedLossUsd: Number(edge.expectedLossUsd.toFixed(2)),
                        edgeRatio: Number(edge.edgeRatio.toFixed(3)),
                        localPriority: Number(scoreLiveOrderPlan(plan).toFixed(2)),
                    };
                });
            const evaluateLivePreTradeReview = async (
                plan: ReturnType<typeof buildOrderPlan>,
                price: number,
                fundingUsd: number,
                rankedPlans: Array<ReturnType<typeof buildOrderPlan>>,
            ): Promise<LiveReviewDecision> => {
                const baseReview = evaluateRuleBasedPreTradeReview(plan, price, fundingUsd);
                if (!baseReview.pass) return baseReview;

                const symbol = normalizeTrackedSymbol(plan.symbol);
                const candidate = candidateMap.get(symbol);
                const shortSignal = getShortMomentumSignal(symbol, price);
                const comparableSymbol = comparableTradeSymbol(symbol);
                const peerSummaries = buildAiPeerSummary(rankedPlans, symbol);
                const availableStableUsd = Math.max(0, Number(currentPortfolio.cashbalance || 0));
                const stableFundingAllowsRotation = availableStableUsd + 1e-9 >= minOrderUsd;
                const edge = derivePlanEdgeMetrics(plan, price, fundingUsd);
                const aiReview = await requestAiTradeReview({
                    kind: "entry",
                    symbol,
                    chain: plan.chain,
                    candidate: {
                        symbol,
                        chain: plan.chain,
                        regime: plan.regime,
                        triggerType: plan.triggerType,
                        triggerState: plan.triggerState,
                        positionSizeLabel: plan.positionSizeLabel,
                        score: Number(plan.score || 0),
                        eventPriority: Number(plan.eventPriority || 0),
                        currentPrice: Number(price.toFixed(6)),
                        fundingUsd: Number(fundingUsd.toFixed(2)),
                        expectedProfitUsd: Number(edge.expectedProfitUsd.toFixed(2)),
                        expectedProfitPct: Number(edge.expectedProfitPct.toFixed(2)),
                        expectedLossUsd: Number(edge.expectedLossUsd.toFixed(2)),
                        expectedLossPct: Number(edge.expectedLossPct.toFixed(2)),
                        edgeRatio: Number(edge.edgeRatio.toFixed(3)),
                        netExpectedUsd: Number(edge.netExpectedUsd.toFixed(2)),
                        entryMin: Number(plan.entryMin.toFixed(6)),
                        entryMax: Number(plan.entryMax.toFixed(6)),
                        plannedTakeProfit: Number(plan.plannedTakeProfit.toFixed(6)),
                        plannedStopLoss: Number(plan.plannedStopLoss.toFixed(6)),
                        triggerProgressRatio: Number((plan.triggerProgressRatio || 0).toFixed(3)),
                        triggerMissingReasons: plan.triggerMissingReasons,
                        shortSignal,
                        metrics: candidate ? {
                            rr: Number(candidate.metrics.rr.toFixed(3)),
                            rsi1h: Number(candidate.metrics.rsi1h.toFixed(2)),
                            rsi6h: Number(candidate.metrics.rsi6h.toFixed(2)),
                            macd1h: Number(candidate.metrics.macd1h.toFixed(6)),
                            macd6h: Number(candidate.metrics.macd6h.toFixed(6)),
                            adx1h: Number(candidate.metrics.adx1h.toFixed(2)),
                            emaBull1h: candidate.metrics.emaBull1h,
                            emaBull4h: candidate.metrics.emaBull4h,
                            supportDistancePct: Number(candidate.supportDistancePct.toFixed(4)),
                            resistanceDistancePct: Number(candidate.resistanceDistancePct.toFixed(4)),
                        } : undefined,
                    },
                    peers: peerSummaries,
                    portfolio: {
                        totalValueUsd: Number((currentPortfolio.totalValue || 0).toFixed(2)),
                        realizedAutoPnlToday: Number(realizedAutoPnlToday.toFixed(2)),
                        activeComparableSymbols: Array.from(new Set(reviewOpenPositions.map((position) => position.comparableSymbol))).length,
                        stableFundingUsd: Number(availableStableUsd.toFixed(2)),
                        minOrderUsd: Number(minOrderUsd.toFixed(2)),
                        rotationPolicy: STRATEGY_CONFIG.AUTO_TRADE_REVIEW_REQUIRE_PROFIT_BEFORE_ROTATION
                            ? "profit-lock required"
                            : "stable funding override enabled",
                        blockingOpenPositions: STRATEGY_CONFIG.AUTO_TRADE_REVIEW_REQUIRE_PROFIT_BEFORE_ROTATION
                            ? reviewOpenPositions
                                .filter((position) => position.comparableSymbol !== comparableSymbol && !position.profitLocked)
                                .slice(0, 4)
                                .map((position) => ({
                                    symbol: position.symbol,
                                    pnlUsd: Number(position.pnlUsd.toFixed(2)),
                                    pnlPct: Number(position.pnlPct.toFixed(2)),
                                }))
                            : [],
                    },
                });

                if (!aiReview) {
                    if (STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_REMOTE_REQUIRED) {
                        return {
                            pass: false,
                            reason: "AI審査NG: API未応答",
                            detail: "OpenAI 審査が未応答のため、新規自動売買注文を止めました。",
                            source: "fallback",
                        };
                    }
                    return {
                        ...baseReview,
                        reason: "ローカル事前審査OK",
                        detail: `${baseReview.detail} / OpenAI未応答のためローカル審査のみで継続`,
                        source: "fallback",
                    };
                }

                const aiReasonText = `${aiReview.reason || ""} ${aiReview.detail || ""}`;
                const aiBlockedByProfitLock =
                    /利益ロック待ち|profit lock|rotation/i.test(aiReasonText);

                if (!aiReview.approve && !(aiBlockedByProfitLock && stableFundingAllowsRotation)) {
                    return {
                        pass: false,
                        reason: `AI審査NG: ${aiReview.reason}`,
                        detail: `${aiReview.detail} / 戦略: ${aiReview.strategy}`,
                        source: aiReview.source === "cache" ? "cache" : "openai",
                        priorityScore: aiReview.priorityScore,
                        sizeMultiplier: aiReview.sizeMultiplier,
                        entryAdjustmentPct: aiReview.entryAdjustmentPct,
                        takeProfitAdjustmentPct: aiReview.takeProfitAdjustmentPct,
                        stopLossAdjustmentPct: aiReview.stopLossAdjustmentPct,
                        holdMinutes: aiReview.holdMinutes,
                        strategy: aiReview.strategy,
                        exitPlan: aiReview.exitPlan,
                    };
                }

                return {
                    pass: true,
                    reason: aiBlockedByProfitLock && stableFundingAllowsRotation
                        ? "OpenAI審査OK: 安定資金で回転許可"
                        : aiReview.reason || "OpenAI審査OK",
                    detail: aiBlockedByProfitLock && stableFundingAllowsRotation
                        ? `安定資金 ${availableStableUsd.toFixed(2)} USD が live 最低発注額 ${minOrderUsd.toFixed(2)} USD を満たすため、利益ロック待ちは advisory として扱いました。${aiReview.strategy ? ` / 戦略: ${aiReview.strategy}` : ""}`
                        : `${aiReview.detail} / 戦略: ${aiReview.strategy}`,
                    source: aiReview.source === "cache" ? "cache" : "openai",
                    priorityScore: aiReview.priorityScore,
                    sizeMultiplier: aiReview.sizeMultiplier,
                    entryAdjustmentPct: aiReview.entryAdjustmentPct,
                    takeProfitAdjustmentPct: aiReview.takeProfitAdjustmentPct,
                    stopLossAdjustmentPct: aiReview.stopLossAdjustmentPct,
                    holdMinutes: aiReview.holdMinutes,
                    strategy: aiReview.strategy,
                    exitPlan: aiReview.exitPlan,
                };
            };
            const evaluateLiveExitReview = async (
                position: {
                    symbol?: string;
                    amount: number;
                    entryPrice: number;
                    highestPrice?: number;
                    regime?: StrategyRegime;
                    mode?: "TREND" | "MEAN_REVERSION";
                    positionSizeLabel?: StrategyPositionSize;
                    positionSizeMultiplier?: number;
                },
                price: number,
                pnlPct: number,
                exitReason: StrategyExitReason,
            ): Promise<LiveReviewDecision> => {
                const baseReview = evaluateRuleBasedExitReview(position, price, pnlPct, exitReason);
                if (!baseReview.pass) return baseReview;

                const symbol = normalizeTrackedSymbol(position.symbol || "");
                if (!symbol) return baseReview;
                const shortSignal = getShortMomentumSignal(symbol, price);
                const aiReview = await requestAiTradeReview({
                    kind: "exit",
                    symbol,
                    chain: resolveHoldingChain(symbol),
                    candidate: {
                        symbol,
                        price: Number(price.toFixed(6)),
                        amount: Number(position.amount.toFixed(8)),
                        entryPrice: Number(position.entryPrice.toFixed(6)),
                        highestPrice: Number((position.highestPrice || price).toFixed(6)),
                        pnlPct: Number(pnlPct.toFixed(2)),
                        exitReason,
                        shortSignal,
                    },
                    portfolio: {
                        realizedAutoPnlToday: Number(realizedAutoPnlToday.toFixed(2)),
                    },
                });

                if (!aiReview) {
                    if (STRATEGY_CONFIG.OPENAI_TRADE_REVIEW_REMOTE_REQUIRED) {
                        return {
                            pass: false,
                            reason: "AI審査NG: API未応答",
                            detail: "OpenAI 決済審査が未応答のため、自動決済を止めました。",
                            source: "fallback",
                        };
                    }
                    return {
                        ...baseReview,
                        reason: "ローカル出口審査OK",
                        detail: `${baseReview.detail} / OpenAI未応答のためローカル審査のみで継続`,
                        source: "fallback",
                    };
                }

                if (!aiReview.approve) {
                    return {
                        pass: false,
                        reason: `AI審査NG: ${aiReview.reason}`,
                        detail: `${aiReview.detail} / 出口戦略: ${aiReview.exitPlan}`,
                        source: aiReview.source === "cache" ? "cache" : "openai",
                        priorityScore: aiReview.priorityScore,
                        holdMinutes: aiReview.holdMinutes,
                        strategy: aiReview.strategy,
                        exitPlan: aiReview.exitPlan,
                    };
                }

                return {
                    pass: true,
                    reason: aiReview.reason || "OpenAI出口審査OK",
                    detail: `${aiReview.detail} / 出口戦略: ${aiReview.exitPlan}`,
                    source: aiReview.source === "cache" ? "cache" : "openai",
                    priorityScore: aiReview.priorityScore,
                    holdMinutes: aiReview.holdMinutes,
                    strategy: aiReview.strategy,
                    exitPlan: aiReview.exitPlan,
                };
            };
            const orderDiagnostics: Record<string, LiveOrderDiagnostic> = {};
            const setOrderDiagnostic = (
                symbol: string,
                status: LiveOrderDiagnostic["status"],
                reason: string,
                detail: string,
                orderTriggeredAt?: number,
            ) => {
                orderDiagnostics[normalizeTrackedSymbol(symbol)] = {
                    status,
                    reason,
                    detail,
                    orderTriggeredAt,
                };
            };
            const syncLiveOrderMonitor = () => {
                const baseMonitor = liveStrategyMonitorRef.current || liveMonitor;
                const nextMonitor = applyLiveOrderDiagnosticsToMonitor(baseMonitor, orderDiagnostics);
                setLiveStrategyMonitor(nextMonitor);
                liveStrategyMonitorRef.current = nextMonitor;
                persistLiveStrategyMonitorSafely(nextMonitor);
                return nextMonitor;
            };

            liveMonitor.candidates.forEach((candidate) => {
                const symbol = normalizeTrackedSymbol(candidate.symbol);
                if (candidate.selectionEligible && !candidate.autoTradeTarget) {
                    setOrderDiagnostic(
                        symbol,
                        candidate.correlationRejected ? "blocked" : "slot",
                        candidate.correlationRejected ? "相関重複で保留" : "空き枠待ち",
                        candidate.correlationRejected
                            ? "Selected-level candidate is still blocked by correlation overlap."
                            : freeEntrySlots <= 0
                                ? "Selected-level candidate is waiting because no free live basket slot is available."
                                : "Selected-level candidate is waiting for order promotion after higher-priority targets.",
                    );
                    return;
                }
                if (!candidate.selectionEligible) {
                    setOrderDiagnostic(
                        symbol,
                        "blocked",
                        candidate.finalRejectReason || candidate.mainReason || "選定条件未達",
                        candidate.finalRejectReason || candidate.mainReason || "選定条件がまだ満たされていません。",
                    );
                    return;
                }
                if (!candidate.orderArmEligible && candidate.triggerState !== "Triggered") {
                    setOrderDiagnostic(
                        symbol,
                        "blocked",
                        candidate.triggerState === "Armed"
                            ? "最終トリガー整合待ち"
                            : candidate.triggerReason || "注文未武装",
                        candidate.triggerState === "Armed"
                            ? "選定済み候補ですが、runtime 発注前に最後の 5m 整合がまだ必要です。"
                            : candidate.triggerReason || "5m trigger がまだ Triggered に届いていません。",
                    );
                }
            });

            liveMonitor.selected.forEach((candidate) => {
                const symbol = normalizeTrackedSymbol(candidate.symbol);
                if (selectedPlanSymbolSet.has(symbol)) return;
                if (!STRATEGY_CANDLE_SYMBOL_SET.has(symbol)) {
                    setOrderDiagnostic(symbol, "blocked", "ローソク足未取得", "selected 済み候補ですが、live candle 対象外です。");
                    return;
                }
                if (candidate.autoTradeExcludedReason) {
                    setOrderDiagnostic(symbol, "blocked", candidate.autoTradeExcludedReason, "selected 済み候補ですが、自動売買対象外です。");
                    return;
                }
            });

            selectedPlans.forEach((plan) => {
                const symbol = normalizeTrackedSymbol(plan.symbol);
                const candidate = candidateMap.get(symbol);
                if (!STRATEGY_CANDLE_SYMBOL_SET.has(symbol)) {
                    setOrderDiagnostic(symbol, "blocked", "Candle coverage missing", "This symbol is outside the live candle set.");
                    return;
                }
                if (candidate?.autoTradeExcludedReason) {
                    setOrderDiagnostic(symbol, "blocked", candidate.autoTradeExcludedReason, "Auto-trade exclusion is active.");
                    return;
                }
                setOrderDiagnostic(
                    symbol,
                    plan.orderArmEligible ? "armed" : "blocked",
                    plan.orderArmEligible
                        ? plan.triggerState === "Triggered"
                            ? "Order armed"
                            : "Range final trigger alignment pass"
                        : "Trigger not ready",
                    plan.orderArmEligible
                        ? plan.triggerState === "Triggered"
                            ? "Selected basket candidate is armed for runtime order checks."
                            : "Selected basket candidate passed the Range final-alignment soft gate and is ready for runtime checks."
                        : "Selected basket candidate is waiting for final trigger alignment.",
                );
            });

            supplementalPlans.forEach((plan) => {
                setOrderDiagnostic(
                    plan.symbol,
                    plan.orderArmEligible ? "armed" : "slot",
                    plan.orderArmEligible ? "Free slot promotion armed" : "Waiting for slot",
                    plan.orderArmEligible
                        ? "Supplemental candidate has been promoted because a live slot is free and final alignment is sufficient."
                        : "Supplemental candidate still needs a free live slot.",
                );
            });

            for (const position of effectivePositions) {
                const symbol = normalizeTrackedSymbol(position.symbol);
                const price = getUsdPrice(symbol);
                if (!Number.isFinite(price) || price <= 0) continue;

                const usdValue = position.amount * price;
                if (usdValue < 2) continue;

                const plan = basketPlans.find((item) => normalizeTrackedSymbol(item.symbol) === symbol);
                const signal = getShortMomentumSignal(symbol, price);
                const pnlPct = position.entryPrice > 0
                    ? ((price - position.entryPrice) / position.entryPrice) * 100
                    : 0;
                const latestBuyTrade = latestTradeRecord(symbol, "BUY");
                const latestBuyTs = latestBuyTrade?.timestamp || 0;
                const exitMode = plan?.mode;
                const latestBuySizeLabel = String(latestBuyTrade?.positionSizeLabel || "");
                const exitPositionSizeMultiplier =
                    plan?.positionSizeMultiplier
                    ?? (latestBuySizeLabel === "1.0x" || latestBuySizeLabel === "0.5x"
                        ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                        : latestBuySizeLabel === "0.3x"
                            ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                            : latestBuySizeLabel === "0.25x" || latestBuySizeLabel === "0.2x"
                                ? STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER
                                : 0);
                const exitSizeLabel = resolveExitPositionSizeLabel({
                    positionSizeLabel: plan?.positionSizeLabel || latestBuyTrade?.positionSizeLabel,
                    positionSizeMultiplier: exitPositionSizeMultiplier,
                });
                const exitRegime = resolveExitRegime({
                    regime: plan?.regime || latestBuyTrade?.regime,
                    mode: exitMode,
                });
                const minimumHoldMinutes = resolveMinimumHoldMinutes({
                    regime: exitRegime,
                    mode: exitMode,
                    positionSizeLabel: exitSizeLabel,
                    positionSizeMultiplier: exitPositionSizeMultiplier,
                });
                const minimumHoldUntil = latestBuyTs > 0
                    ? latestBuyTs + (minimumHoldMinutes * 60_000)
                    : 0;
                const holdActive = minimumHoldUntil > 0 && now < minimumHoldUntil;
                const { minProfitUsd, minProfitPct } = resolveMinimumProfitableExit({
                    amount: position.amount,
                    entryPrice: position.entryPrice,
                    minOrderUsd,
                    regime: exitRegime,
                    mode: exitMode,
                    positionSizeLabel: exitSizeLabel,
                    positionSizeMultiplier: exitPositionSizeMultiplier,
                });
                const pnlUsd = (price - position.entryPrice) * position.amount;
                const profitableEnough = pnlUsd >= minProfitUsd || pnlPct >= minProfitPct;
                const partialTakeProfitCount = countExitReasonSinceBuy(symbol, "TP", latestBuyTs);
                const partialTakeProfitDone = partialTakeProfitCount > 0;
                if (!position.highestPrice || price > position.highestPrice) {
                    position.highestPrice = price;
                }
                if (crossChainShadowPositionsRef.current[symbol] && price > (crossChainShadowPositionsRef.current[symbol].highestPrice || 0)) {
                    crossChainShadowPositionsRef.current[symbol] = {
                        ...crossChainShadowPositionsRef.current[symbol],
                        highestPrice: price,
                        updatedAt: Date.now(),
                    };
                }
                const highestPrice = Math.max(position.highestPrice || 0, price);
                const trailingStopPct = resolveTrailingStopPct({
                    regime: exitRegime,
                    mode: exitMode,
                    positionSizeLabel: exitSizeLabel,
                    positionSizeMultiplier: exitPositionSizeMultiplier,
                });
                const trailingStopPrice = partialTakeProfitDone
                    ? Math.max(
                        plan?.plannedStopLoss || 0,
                        position.entryPrice * (1 + (minProfitPct / 100)),
                        highestPrice * (1 - (trailingStopPct / 100)),
                    )
                    : 0;
                const strongNegativeExit = hasStrongExitDeterioration(signal, pnlPct);

                if (plan) {
                    if (price <= plan.plannedStopLoss) {
                        const exitReview = await evaluateLiveExitReview({
                            ...position,
                            regime: exitRegime,
                            mode: plan.mode,
                            positionSizeLabel: exitSizeLabel,
                            positionSizeMultiplier: plan.positionSizeMultiplier,
                        }, price, pnlPct, "SL");
                        if (!exitReview.pass) {
                            emitLiveAutoStatus("hold: AI exit review blocked", { symbol, reason: exitReview.reason, detail: exitReview.detail });
                            continue;
                        }
                        const executed = await executeTrade(
                            symbol,
                            "SELL",
                            position.amount,
                            price,
                            `常時監視: ${displayStrategySymbol(plan)} を損切り`,
                            undefined,
                            undefined,
                            undefined,
                            {
                                ...AUTO_TRADE_NOTIFICATION_META,
                                chain: plan.chain,
                                routeType: plan.executionRouteKind,
                                regime: plan.regime,
                                triggerState: plan.triggerState,
                                triggerType: plan.triggerType,
                                positionSizeLabel: plan.positionSizeLabel,
                                score: plan.score,
                                triggeredAt: plan.triggeredAt,
                                selectedAt: plan.selectedAt,
                                exitReason: "SL",
                                reviewApproved: true,
                                reviewReason: exitReview.reason,
                                reviewDetail: exitReview.detail,
                                reviewStrategy: exitReview.strategy,
                                reviewExitPlan: exitReview.exitPlan,
                            },
                        );
                        if (executed) {
                            lastTradeRef.current = Date.now();
                            lastAutoTradeSymbolRef.current = symbol;
                            emitLiveAutoStatus("executed: stop-loss SELL", { symbol, pnlPct });
                        }
                        return;
                    }

                    if (!partialTakeProfitDone && price >= plan.plannedTakeProfit) {
                        const exitReview = await evaluateLiveExitReview({
                            ...position,
                            regime: exitRegime,
                            mode: plan.mode,
                            positionSizeLabel: exitSizeLabel,
                            positionSizeMultiplier: plan.positionSizeMultiplier,
                        }, price, pnlPct, "TP");
                        if (!exitReview.pass) {
                            emitLiveAutoStatus("hold: AI exit review blocked", { symbol, reason: exitReview.reason, detail: exitReview.detail });
                            continue;
                        }
                        const sellFraction = resolvePartialTakeProfitFraction({
                            regime: exitRegime,
                            mode: plan.mode,
                            positionSizeLabel: exitSizeLabel,
                            positionSizeMultiplier: plan.positionSizeMultiplier,
                        });
                        const sellAmount = Math.max(position.amount * sellFraction, 0.0001);
                        const executed = await executeTrade(
                            symbol,
                            "SELL",
                            Math.min(position.amount, sellAmount),
                            price,
                            sellFraction >= 1
                                ? `常時監視: ${displayStrategySymbol(plan)} を利確`
                                : `常時監視: ${displayStrategySymbol(plan)} を部分利確`,
                            undefined,
                            undefined,
                            undefined,
                            {
                                ...AUTO_TRADE_NOTIFICATION_META,
                                chain: plan.chain,
                                routeType: plan.executionRouteKind,
                                regime: plan.regime,
                                triggerState: plan.triggerState,
                                triggerType: plan.triggerType,
                                positionSizeLabel: plan.positionSizeLabel,
                                score: plan.score,
                                triggeredAt: plan.triggeredAt,
                                selectedAt: plan.selectedAt,
                                exitReason: "TP",
                                reviewApproved: true,
                                reviewReason: exitReview.reason,
                                reviewDetail: exitReview.detail,
                                reviewStrategy: exitReview.strategy,
                                reviewExitPlan: exitReview.exitPlan,
                            },
                        );
                        if (executed) {
                            lastTradeRef.current = Date.now();
                            lastAutoTradeSymbolRef.current = symbol;
                            emitLiveAutoStatus(
                                sellFraction >= 1 ? "executed: take-profit SELL" : "executed: partial take-profit SELL",
                                { symbol, pnlPct },
                            );
                        }
                        return;
                    }

                    if (trailingStopPrice > 0 && price <= trailingStopPrice) {
                        const exitReview = await evaluateLiveExitReview({
                            ...position,
                            regime: exitRegime,
                            mode: plan.mode,
                            positionSizeLabel: exitSizeLabel,
                            positionSizeMultiplier: plan.positionSizeMultiplier,
                        }, price, pnlPct, "TP");
                        if (!exitReview.pass) {
                            emitLiveAutoStatus("hold: AI exit review blocked", { symbol, reason: exitReview.reason, detail: exitReview.detail });
                            continue;
                        }
                        const executed = await executeTrade(
                            symbol,
                            "SELL",
                            position.amount,
                            price,
                            `常時監視: ${displayStrategySymbol(plan)} をトレーリング保護で決済`,
                            undefined,
                            undefined,
                            undefined,
                            {
                                ...AUTO_TRADE_NOTIFICATION_META,
                                chain: plan.chain,
                                routeType: plan.executionRouteKind,
                                regime: plan.regime,
                                triggerState: plan.triggerState,
                                triggerType: plan.triggerType,
                                positionSizeLabel: plan.positionSizeLabel,
                                score: plan.score,
                                triggeredAt: plan.triggeredAt,
                                selectedAt: plan.selectedAt,
                                exitReason: "TP",
                                reviewApproved: true,
                                reviewReason: exitReview.reason,
                                reviewDetail: exitReview.detail,
                                reviewStrategy: exitReview.strategy,
                                reviewExitPlan: exitReview.exitPlan,
                            },
                        );
                        if (executed) {
                            lastTradeRef.current = Date.now();
                            lastAutoTradeSymbolRef.current = symbol;
                            emitLiveAutoStatus("executed: trailing-protected SELL", { symbol, pnlPct });
                        }
                        return;
                    }

                    const timedExitAt = latestBuyTs > 0
                        ? latestBuyTs + ((plan.timedExitMinutes || 360) * 60_000)
                        : 0;
                    if (timedExitAt && now >= timedExitAt) {
                        if (holdActive) {
                            emitLiveAutoStatus("hold: minimum hold active", { symbol, until: minimumHoldUntil, pnlPct });
                            continue;
                        }
                        const canExtend =
                            exitRegime === "Trend"
                                ? profitableEnough
                                    && signal.r60 > -0.0012
                                    && signal.score > -0.0022
                                    && signal.r15 >= -0.0025
                                : profitableEnough
                                    && pnlPct >= Math.max(minProfitPct * 0.8, 0.22)
                                    && signal.r60 > -0.0002
                                    && signal.score > -0.0006
                                    && signal.r15 >= -0.001;
                        if (canExtend) {
                            emitLiveAutoStatus("hold: extending profitable cycle winner", { symbol, pnlPct });
                            continue;
                        }
                        if (!profitableEnough && !strongNegativeExit) {
                            emitLiveAutoStatus("hold: timed exit waiting for profitable close", { symbol, pnlPct });
                            continue;
                        }
                        const exitReview = await evaluateLiveExitReview({
                            ...position,
                            regime: exitRegime,
                            mode: plan.mode,
                            positionSizeLabel: exitSizeLabel,
                            positionSizeMultiplier: plan.positionSizeMultiplier,
                        }, price, pnlPct, "timed exit");
                        if (!exitReview.pass) {
                            emitLiveAutoStatus("hold: AI exit review blocked", { symbol, reason: exitReview.reason, detail: exitReview.detail });
                            continue;
                        }

                        const executed = await executeTrade(
                            symbol,
                            "SELL",
                            position.amount,
                            price,
                            `常時監視: ${displayStrategySymbol(plan)} を時間決済`,
                            undefined,
                            undefined,
                            undefined,
                            {
                                ...AUTO_TRADE_NOTIFICATION_META,
                                chain: plan.chain,
                                routeType: plan.executionRouteKind,
                                regime: plan.regime,
                                triggerState: plan.triggerState,
                                triggerType: plan.triggerType,
                                positionSizeLabel: plan.positionSizeLabel,
                                score: plan.score,
                                triggeredAt: plan.triggeredAt,
                                selectedAt: plan.selectedAt,
                                exitReason: "timed exit",
                                reviewApproved: true,
                                reviewReason: exitReview.reason,
                                reviewDetail: exitReview.detail,
                                reviewStrategy: exitReview.strategy,
                                reviewExitPlan: exitReview.exitPlan,
                            },
                        );
                        if (executed) {
                            lastTradeRef.current = Date.now();
                            lastAutoTradeSymbolRef.current = symbol;
                            emitLiveAutoStatus("executed: timed SELL", { symbol, pnlPct });
                        }
                        return;
                    }

                    continue;
                }

                const shouldConsolidate =
                    (latestBuyTs > 0 && now >= latestBuyTs + (STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_MIN_HOLD_MINUTES * 60_000) && pnlPct >= STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_MIN_PROFIT_PCT)
                    || signal.score <= STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_NEGATIVE_SCORE
                    || signal.r60 <= STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_NEGATIVE_R60;

                if (shouldConsolidate) {
                    if (holdActive) {
                        emitLiveAutoStatus("hold: basket minimum hold active", { symbol, until: minimumHoldUntil, pnlPct });
                        continue;
                    }
                    if (!profitableEnough && !strongNegativeExit) {
                        emitLiveAutoStatus("hold: basket exit waiting for profitable close", { symbol, pnlPct });
                        continue;
                    }
                    const exitReview = await evaluateLiveExitReview({
                        ...position,
                        regime: exitRegime,
                        mode: exitMode,
                        positionSizeLabel: exitSizeLabel,
                        positionSizeMultiplier: exitPositionSizeMultiplier,
                    }, price, pnlPct, "basket exit");
                    if (!exitReview.pass) {
                        emitLiveAutoStatus("hold: AI exit review blocked", { symbol, reason: exitReview.reason, detail: exitReview.detail });
                        continue;
                    }
                    const executed = await executeTrade(
                        symbol,
                        "SELL",
                        position.amount,
                        price,
                        `常時監視: 採用対象外になったため ${symbol} を整理売り`,
                        undefined,
                        undefined,
                        undefined,
                        {
                            ...AUTO_TRADE_NOTIFICATION_META,
                            chain: resolveHoldingChain(symbol),
                            exitReason: "basket exit",
                            reviewApproved: true,
                            reviewReason: exitReview.reason,
                            reviewDetail: exitReview.detail,
                            reviewStrategy: exitReview.strategy,
                            reviewExitPlan: exitReview.exitPlan,
                        },
                    );
                    if (executed) {
                        lastTradeRef.current = Date.now();
                        lastAutoTradeSymbolRef.current = symbol;
                        emitLiveAutoStatus("executed: basket consolidation SELL", { symbol, pnlPct });
                    }
                    return;
                }
            }

            if (basketPlans.length === 0) {
                syncLiveOrderMonitor();
                emitLiveAutoStatus("skip: no selected basket", { block: liveMonitor.currentBlock });
                return;
            }

            const readyPlans = basketPlans
                .filter((plan) => plan.orderArmEligible || plan.triggerState === "Triggered")
                .sort((left, right) => scoreLiveOrderPlan(right) - scoreLiveOrderPlan(left));

            if (readyPlans.length === 0) {
                syncLiveOrderMonitor();
                emitLiveAutoStatus("skip: no armed entry", {
                    block: liveMonitor.currentBlock,
                    armed: liveMonitor.armed.map((candidate) => candidate.displaySymbol || candidate.symbol),
                    selected: basketPlans.map((plan) => displayStrategySymbol(plan)),
                });
                return;
            }

            for (const plan of readyPlans) {
                const symbol = normalizeTrackedSymbol(plan.symbol);
                const comparableSymbol = comparableTradeSymbol(symbol);
                const allowPassiveWalletOverlap =
                    passiveWalletExposureComparables.has(comparableSymbol)
                    && hasPriorityOrderProfile(plan)
                    && (
                        plan.autoTradeTarget
                        || plan.conditionalReferencePass
                        || Number(plan.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER
                    );
                if (positionMap.has(symbol) || managedExposureComparables.has(comparableSymbol)) {
                    setOrderDiagnostic(symbol, "blocked", "保有中ポジションあり", "この通貨は現在の live バスケットで既に管理中です。");
                    continue;
                }
                if (passiveWalletExposureComparables.has(comparableSymbol) && !allowPassiveWalletOverlap) {
                    setOrderDiagnostic(symbol, "blocked", "外部ウォレット保有あり", "外部ウォレット保有があるため、この通貨は優先条件を満たすまで新規発注しません。");
                    continue;
                }
                if (pendingCrossChainSymbols.has(symbol) || pendingComparableSymbols.has(comparableSymbol)) {
                    setOrderDiagnostic(symbol, "blocked", "発注処理中", "同一通貨の pending order が残っています。");
                    continue;
                }

                const price = getUsdPrice(symbol);
                if (!Number.isFinite(price) || price <= 0) {
                    setOrderDiagnostic(symbol, "blocked", "価格未取得", "live price が取れないため注文を武装できません。");
                    continue;
                }

                const entryWindow = resolveLiveEntryWindow(plan);
                const withinEntryZone =
                    price >= plan.entryMin
                    && price <= plan.entryMax;
                if (!withinEntryZone) {
                    setOrderDiagnostic(
                        symbol,
                        "blocked",
                        "エントリー帯外",
                        `現在価格 ${price.toFixed(6)} が ${plan.triggerType} の想定帯 ${plan.entryMin.toFixed(6)} - ${plan.entryMax.toFixed(6)} を外れています (${(entryWindow.minMultiplier * 100).toFixed(1)}% - ${(entryWindow.maxMultiplier * 100).toFixed(1)}%).`,
                    );
                    continue;
                }

                const positionSizeMultiplier = Number(
                    plan.positionSizeMultiplier
                    ?? (plan.rank === "A" ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER : STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER),
                );
                const desiredUsd = Math.max(minOrderUsd, (currentPortfolio.totalValue || 0) * plan.weight * positionSizeMultiplier);
                const unsupportedExecution =
                    plan.executionChain === "SOLANA"
                    || (
                        Number.isFinite(Number(plan.executionChainId || 0))
                        && Number(plan.executionChainId || 0) > 0
                        && !isSupportedChain(Number(plan.executionChainId || 0))
                    );
                if (unsupportedExecution) {
                    setOrderDiagnostic(
                        symbol,
                        "blocked",
                        plan.executionChain === "SOLANA" ? "Solana live未対応" : "live executor未対応",
                        plan.executionChain === "SOLANA"
                            ? "現在の live executor では Solana の実売買を送信できません。"
                            : "現在の live executor ではこの chain の実売買を送信できません。",
                    );
                    continue;
                }
                const funding = pickFundingSourceForBuy(symbol, desiredUsd, currentPortfolio, { minOrderUsd });
                if (funding.budgetUsd + 0.000001 < minOrderUsd) {
                    setOrderDiagnostic(
                        symbol,
                        "blocked",
                        "発注原資不足",
                        `利用可能資金 ${funding.budgetUsd.toFixed(2)} USD が live 最低発注額 ${minOrderUsd.toFixed(2)} USD を下回っています。`,
                    );
                    continue;
                }

                const preTradeReview = await evaluateLivePreTradeReview(plan, price, funding.budgetUsd, readyPlans);
                if (!preTradeReview.pass) {
                    setOrderDiagnostic(symbol, "blocked", preTradeReview.reason, preTradeReview.detail);
                    emitLiveAutoStatus("保留: AI事前審査で停止", {
                        symbol,
                        reason: preTradeReview.reason,
                        detail: preTradeReview.detail,
                    });
                    continue;
                }
                const reviewedFundingUsd = Math.max(
                    minOrderUsd,
                    Math.min(
                        funding.budgetUsd,
                        funding.budgetUsd * Math.max(0.25, Math.min(1, Number(preTradeReview.sizeMultiplier || 1))),
                    ),
                );
                const amount = reviewedFundingUsd / price;
                if (!Number.isFinite(amount) || amount <= 0) {
                    setOrderDiagnostic(symbol, "blocked", "注文数量不正", "AI審査後の注文数量が不正です。");
                    continue;
                }
                setOrderDiagnostic(
                    symbol,
                    "armed",
                    plan.orderSource === "supplemental" ? "空き枠昇格で注文可能" : "注文可能",
                    plan.orderSource === "supplemental"
                        ? `Triggered 候補が free slot へ昇格し、そのまま発注できる状態です。${preTradeReview.detail}`
                        : `selected 候補が slot・保有・価格帯・資金条件を通過しました。${preTradeReview.detail}`,
                );

                const modeLabel = plan.mode === "TREND" ? "順張り" : "逆張り";
                const basketLabel = basketPlans.map((item) => `${displayStrategySymbol(item)} ${item.positionSizeLabel}`).join(" / ");
                const buyReason =
                    funding.sourceSymbol && !TRADE_CONFIG.STABLECOINS.includes(funding.sourceSymbol)
                        ? `常時監視: ${plan.triggerType} 発火で ${basketLabel} を基準に ${symbol} を${modeLabel}で買い。資金再配分 ${funding.sourceSymbol}→${symbol}${plan.orderSource === "supplemental" ? " / free slot promotion" : ""} / ${preTradeReview.strategy || "AIレビュー反映"}`
                        : `常時監視: ${plan.triggerType} 発火で ${basketLabel} を基準に ${symbol} を${modeLabel}で買い${plan.orderSource === "supplemental" ? " / free slot promotion" : ""} / ${preTradeReview.strategy || "AIレビュー反映"}`;

                const planExecutionOverride = plan.executionAddress ? {
                    chain: plan.executionChain,
                    chainId: plan.executionChainId,
                    address: plan.executionAddress,
                    decimals: plan.executionDecimals,
                    routeKind: plan.executionRouteKind,
                    source: plan.executionSource,
                } satisfies TradeExecutionOverride : undefined;
                const planTradeDecision = Number(plan.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                    ? "Selected"
                    : "Half-size Eligible";
                const planTradeMeta: TradeExecutionMeta = {
                    chain: plan.chain,
                    routeType: plan.executionRouteKind,
                    routeSource: plan.executionSource,
                    sourceToken: funding.sourceSymbol,
                    destinationToken: symbol,
                    destinationChain: plan.executionChain,
                    executionTarget: plan.executionAddress,
                    positionSizeLabel: plan.positionSizeLabel,
                    tradeDecision: planTradeDecision,
                    selectedReason: buyReason,
                    autoTradeTarget: true,
                    regime: plan.regime,
                    triggerState: plan.triggerState,
                    triggerType: plan.triggerType,
                    score: plan.score,
                    triggeredAt: plan.triggeredAt,
                    selectedAt: plan.selectedAt || Date.now(),
                    reviewApproved: true,
                    reviewReason: preTradeReview.reason,
                    reviewDetail: preTradeReview.detail,
                    reviewStrategy: preTradeReview.strategy,
                    reviewExitPlan: preTradeReview.exitPlan,
                };
                const executed = await executeTrade(
                    symbol,
                    "BUY",
                    amount,
                    price,
                    buyReason,
                    undefined,
                    funding.sourceSymbol,
                    planExecutionOverride,
                    planTradeMeta,
                );
                if (executed) {
                    setOrderDiagnostic(symbol, "armed", "注文発火済み", "自動売買 order を送信しました。", Date.now());
                    syncLiveOrderMonitor();
                    lastTradeRef.current = Date.now();
                    lastAutoTradeSymbolRef.current = symbol;
                    emitLiveAutoStatus(plan.executionRouteKind === "cross-chain" ? "executed: cross-chain trigger BUY" : "executed: trigger BUY", {
                        block: liveMonitor.currentBlock,
                        symbol,
                        budgetUsd: reviewedFundingUsd,
                        rank: plan.rank,
                        route: plan.executionRouteKind,
                        target: plan.executionAddress,
                        source: plan.orderSource,
                        review: preTradeReview.detail,
                    });
                    return;
                }
            }

            if ([...positionMap.keys()].every((symbol) => basketSet.has(symbol) || TRADE_CONFIG.STABLECOINS.includes(symbol))) {
                syncLiveOrderMonitor();
                emitLiveAutoStatus("hold: triggered basket aligned", { block: liveMonitor.currentBlock, basket: basketPlans.map((plan) => displayStrategySymbol(plan)) });
                return;
            }

            const basketDiagnostics = basketPlans.map((plan) => {
                const symbol = normalizeTrackedSymbol(plan.symbol);
                const price = getExecutionAwareUsdPrice(symbol, plan.executionRouteKind);
                const entryWindow = resolveLiveEntryWindow(plan);
                const withinEntryZone = Number.isFinite(price) && price > 0
                    ? price >= plan.entryMin
                        && price <= plan.entryMax
                    : false;
                const desiredUsd = Math.max(minOrderUsd, (currentPortfolio.totalValue || 0) * plan.weight * Number(plan.positionSizeMultiplier ?? (plan.rank === "A" ? 1 : 0.5)));
                const funding = pickFundingSourceForBuy(symbol, desiredUsd, currentPortfolio, { minOrderUsd });
                const preTradeReview =
                    Number.isFinite(price) && price > 0 && funding.budgetUsd + 0.000001 >= minOrderUsd
                        ? evaluateRuleBasedPreTradeReview(plan, price, funding.budgetUsd)
                        : null;
                const comparableSymbol = comparableTradeSymbol(symbol);
                const allowPassiveWalletOverlap =
                    passiveWalletExposureComparables.has(comparableSymbol)
                    && hasPriorityOrderProfile(plan)
                    && (
                        plan.autoTradeTarget
                        || plan.conditionalReferencePass
                        || Number(plan.positionSizeMultiplier ?? 0) >= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER
                    );
                const reason = positionMap.has(symbol) || managedExposureComparables.has(comparableSymbol)
                    ? "managed-exposure"
                    : passiveWalletExposureComparables.has(comparableSymbol) && !allowPassiveWalletOverlap
                        ? "passive-wallet-exposure"
                    : pendingComparableSymbols.has(comparableSymbol)
                        ? "pending-order"
                    : !Number.isFinite(price) || price <= 0
                        ? "price-missing"
                    : !withinEntryZone
                        ? "outside-trigger-zone"
                    : funding.budgetUsd + 0.000001 < minOrderUsd
                        ? "funding-too-small"
                    : preTradeReview && !preTradeReview.pass
                        ? "pre-trade-review"
                    : "ready";
                return {
                    symbol,
                    reason,
                    price: Number.isFinite(price) ? Number(price.toFixed(6)) : 0,
                    desiredUsd: Number(desiredUsd.toFixed(2)),
                    fundingUsd: Number((funding.budgetUsd || 0).toFixed(2)),
                    withinEntryZone,
                    entryMin: Number(plan.entryMin.toFixed(6)),
                    entryMax: Number(plan.entryMax.toFixed(6)),
                    entryWindow: {
                        minMultiplier: Number(entryWindow.minMultiplier.toFixed(3)),
                        maxMultiplier: Number(entryWindow.maxMultiplier.toFixed(3)),
                    },
                    triggerState: plan.triggerState,
                    triggerType: plan.triggerType,
                    reviewReason: preTradeReview?.reason,
                    reviewDetail: preTradeReview?.detail,
                };
            });

            syncLiveOrderMonitor();
            emitLiveAutoStatus("skip: no executable trigger entry", {
                block: liveMonitor.currentBlock,
                basket: basketPlans.map((plan) => displayStrategySymbol(plan)),
                diagnostics: basketDiagnostics,
            });
        };

        const timer = setInterval(() => {
            runLiveAutoTick().catch((error) => {
                console.warn("[J-DEX] Live auto-trade scheduler error:", error);
            });
        }, STRATEGY_CONFIG.AUTO_TRADE_REVIEW_INTERVAL_MS);

        runLiveAutoTick().catch((error) => {
            console.warn("[J-DEX] Initial live auto-trade tick failed:", error);
        });

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [
        isSimulating,
        isDemoMode,
        isAutoPilotEnabled,
        effectiveIsConnected,
        effectiveAddress,
        effectiveChainId,
        publicClient,
        tradeInProgress,
        getUsdPrice,
        getExecutionAwareUsdPrice,
        getShortMomentumSignal,
        requestAiTradeReview,
        pickFundingSourceForBuy,
        executeTrade,
        getCrossChainShadowPositions,
        jpyRate,
        walletHoldings,
        isStrategyCandleStoreReady,
        refreshDailyStrategyProposals,
        refreshContinuousStrategyMonitor,
    ]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as any).__DIS_EXECUTE_TRADE__ = executeTrade;
        }
    }, [executeTrade]);

    return (
        <SimulationContext.Provider value={{
            messages, isAuthenticated, setIsAuthenticated, isSimulating, toggleSimulation,
            marketData, allMarketData: allMarketPrices, portfolio, agents, activeStrategies,
            liveStrategyMonitor,
            strategyPerformanceStore,
            strategyPerformanceSummary,
            riskTolerance, setRiskTolerance, stopLossThreshold, setStopLossThreshold,
            takeProfitThreshold, setTakeProfitThreshold, isFlashEnabled, setIsFlashEnabled,
            transactions, priceHistory, strategyProposals, registerStrategyProposal, updateProposalStatus,
            deleteProposal, addUserMessage, aiPopupMessage, closePopup: () => setAiPopupMessage(null),
            selectedCurrency, setSelectedCurrency, proposalFrequency, setProposalFrequency,
            activeChains, toggleChain, targetTop100, setTargetTop100,
            targetAllCurrencies, setTargetAllCurrencies, targetMemeCoins, setTargetMemeCoins,
            requestProposal, nickname, setNickname, favorites, toggleFavorite,
            discussionHistory, addDiscussion, tradeNotifications, dismissNotification, clearNotifications, crossChainOrders,
            isWalletConnected: isConnected || isDemoMode, executeTrade, latestDiscussion, riskStatus, atmosphere,
            tradingPipelines, addPipeline, removePipeline, togglePipeline, latestNews,
            awardExp, disPoints, addDisPoints, leaderboard, isSoundEnabled, setIsSoundEnabled,
            achievements, unlockAchievement, updateAchievementProgress, resetSimulation,
            clearMessages: () => setMessages([]),
            isMockConnected, mockAddress, toggleMockConnection,
            convertJPY,
            isDemoMode, setIsDemoMode, demoBalance, setDemoBalance, demoStrategy, setDemoStrategy, demoAddress,
            initialTradeSymbol, setInitialTradeSymbol,
            allowedStartTokens,
            setAllowedStartTokens,
            startFixedDemo,
            showDemoModal,
            setShowDemoModal,
            learningParams,
            provideTradeFeedback,
            marketRegime,
            addMessage,
            liveInitialBalance,
            walletHoldings,
            solanaWalletAddress,
            setSolanaWalletAddress,
            solanaWalletSyncError,
            customBnbContracts,
            registerCustomBnbContract,
            removeCustomBnbContract,
            customSolanaMints,
            registerCustomSolanaMint,
            removeCustomSolanaMint,
            isAutoPilotEnabled, setIsAutoPilotEnabled,
            lastAutoPilotStatus,
            isPricingPaused, resumePricing,
            newMuchUpdates,
            latestNewMuchUpdate,
            unreadNewMuchCount,
            markNewMuchRead,
        }}>
            {children}
        </SimulationContext.Provider>
    );
}

export function useSimulation() {
    const context = useContext(SimulationContext);
    if (context === undefined) {
        throw new Error("useSimulation must be used within a SimulationProvider");
    }
    return context;
}









