"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { Flame, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { fetchMarketPrices } from "@/lib/market-service";

import { useAccount } from "wagmi";
import { fetchDEXRanking, fetchMarketOverview, fetchPairs, fetchTokensByChain, getTopMovers, getCryptoNews, ChainId } from "@/lib/dex-service";
import { AGENTS, Agent, Message, normalizeToUSDTPair } from "@/lib/ai-agents";
import { resolveToken, NATIVE_TOKEN_ADDRESS, TOKEN_REGISTRY } from "@/lib/tokens";
import { isSupportedChain } from "@/lib/chains";
import { parseUnits, formatUnits, erc20Abi } from "viem";
import { useSendTransaction, usePublicClient, useWalletClient, useBalance } from "wagmi";
import { Achievement } from "@/components/features/AchievementHub";
import { useAgents } from "./AgentContext";
import { isMaintenanceMode } from "@/lib/user-store";
import { useSoundFX } from "@/hooks/useSoundFX";
import { useCurrency } from "./CurrencyContext";
import { generateRandomNews, convertRealToMarketNews, MarketNews } from "@/lib/news-service";
import { GeminiDiscussionResult } from "@/lib/gemini-service";
import { TRADE_CONFIG } from "@/config/tradeConfig";

export type { Message };

export type Currency = "BTC" | "ETH" | "SOL" | "BNB" | "MATIC" | "DOGE" | "LINK" | "SHIB";
export type ProposalFrequency = "OFF" | "LOW" | "MEDIUM" | "HIGH";
export type DemoStrategy = "AGGRESSIVE" | "MODERATE" | "CONSERVATIVE";
export type Chain = "BNB" | "POLYGON";

const isInterestingToken = (symbol: string) => TRADE_CONFIG.isTradeableVolatilityToken(symbol);
const DAILY_STRATEGY_BLOCKS = ["0:00-6:00", "6:00-12:00", "12:00-18:00", "18:00-24:00"] as const;
const DAILY_COMPOUND_TARGET_PCT = 10;
const LIVE_MIN_ORDER_USD = 3.5;
const LIVE_TARGET_ORDER_USD = 3.7;
const BNB_GAS_RESERVE_USD = 1.0;
const DEFAULT_RISK_TOLERANCE = 4; // Aggressive
const DEFAULT_STOP_LOSS_THRESHOLD = -5;
const DEFAULT_TAKE_PROFIT_THRESHOLD = 8;
const LIVE_EXECUTION_PREFERRED_SYMBOLS: Record<number, Set<string>> = {
    56: new Set(["BNB", "ETH", "LINK", "SHIB"]),
    137: new Set(["MATIC"]),
};

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

function getLiveInitialBalanceStorageKey(address?: string, chainId?: number) {
    if (!address || !chainId) return null;
    const day = new Date().toISOString().slice(0, 10);
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
    plannedTakeProfit?: number;
    plannedStopLoss?: number;
    decisionSummary?: string;
    newsTitle?: string;
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
    status: "PENDING" | "APPROVED" | "REJECTED" | "ACTIVE"; // Added ACTIVE
    timestamp: number;
    durationBlock?: (typeof DAILY_STRATEGY_BLOCKS)[number];
    assetSymbol?: string;
    pairLabel?: string;
    proposedSettings?: {
        riskTolerance: number;
        stopLoss: number;
        takeProfit: number;
    }
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
    score: number;
    change24h: number;
    price: number;
    volume: number;
}

interface SymbolPriceSample {
    ts: number;
    price: number;
}

interface ShortMomentumSignal {
    r1: number;
    r5: number;
    r15: number;
    score: number;
    confidence: number;
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
    ) => Promise<boolean>;
    latestDiscussion: GeminiDiscussionResult | null;
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
    isMockConnected: boolean;
    mockAddress: string;
    toggleMockConnection: () => void;
    isAutoPilotEnabled: boolean;
    setIsAutoPilotEnabled: (val: boolean) => void;
    isPricingPaused: boolean;
    resumePricing: () => void;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

const DEFAULT_ACHIEVEMENTS: Achievement[] = [
    { id: "first-trade", title: "初回トレード", description: "最初のトレードを完了する", icon: Zap, unlocked: false, rarity: "COMMON" },
    { id: "profit-100", title: "利益達成", description: "累計利益 100 円以上を達成する", icon: TrendingUp, unlocked: false, rarity: "COMMON", progress: 0, target: 100 },
    { id: "risk-setup-done", title: "リスク設定完了", description: "リスク管理設定を反映する", icon: ShieldCheck, unlocked: false, rarity: "COMMON" },
    { id: "win-streak-3", title: "3連勝", description: "3 回連続で利益決済する", icon: Flame, unlocked: false, rarity: "RARE", progress: 0, target: 3 },
];

export function SimulationProvider({ children }: { children: ReactNode }) {
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
    const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
    const [strategyProposals, setStrategyProposals] = useState<StrategyProposal[]>([]);
    const [aiPopupMessage, setAiPopupMessage] = useState<Message | null>(null);
    const [selectedCurrency, setSelectedCurrency] = useState<Currency>("BNB");
    const [tradeInProgress, setTradeInProgress] = useState(false);
    const tradeExecutionLockRef = useRef(false);
    const lastTradeErrorTime = useRef<number>(0);
    const nextTradeAllowedAtRef = useRef<number>(0);
    const symbolCooldownRef = useRef<Record<string, number>>({});
    const [news, setNews] = useState<MarketNews[]>([]);
    const [lastAction, setLastAction] = useState<"BUY" | "SELL" | null>(null);

    useEffect(() => {
        if (!tradeInProgress) {
            tradeExecutionLockRef.current = false;
        }
    }, [tradeInProgress]);

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
    const liveInitialBalanceStorageKey = getLiveInitialBalanceStorageKey(address, chainId);

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
    const [latestDiscussion, setLatestDiscussion] = useState<GeminiDiscussionResult | null>(null);
    const [riskStatus, setRiskStatus] = useState<"SAFE" | "CAUTION" | "CRITICAL">("SAFE");
    const [tradingPipelines, setTradingPipelines] = useState<TradingPipeline[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [latestNews, setLatestNews] = useState<MarketNews | null>(null);
    const [isSoundEnabled, setIsSoundEnabled] = useState(false);
    const [atmosphere, setAtmosphere] = useState<"NEUTRAL" | "POSITIVE" | "NEGATIVE" | "ALERT">("NEUTRAL");
    const [achievements, setAchievements] = useState<Achievement[]>(DEFAULT_ACHIEVEMENTS);
    const [disPoints, setDisPoints] = useState(0);
    const [leaderboard, setLeaderboard] = useState<{ name: string; score: number; dailyProfit: number; dailyChange: number; rank: number }[]>([]);

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

    useEffect(() => {
        const stored = localStorage.getItem("jdex_autopilot_enabled");
        if (stored !== null) setIsAutoPilotEnabledState(stored === "true");
    }, []);

    const setIsAutoPilotEnabled = (val: boolean) => {
        setIsAutoPilotEnabledState(val);
        localStorage.setItem("jdex_autopilot_enabled", val.toString());
    };

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
    const liveTransactionsStorageKey = effectiveAddress ? `jdex_live_transactions_${effectiveAddress.toLowerCase()}` : null;

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
    const { agents, updateAgent, evolveAgent, addLearningEvent } = useAgents();

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
            addMessage("coordinator", agent.name + " がレベルアップしました。Lv." + newLevel + " に到達し、新たな知見を獲得しました。", "SYSTEM");

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

    const toggleChain = (chain: Chain) => {
        setActiveChains(prev => prev.includes(chain) ? prev.filter(c => c !== chain) : [...prev, chain]);
    };

    const requestProposal = () => {
        setForceProposal(true);
    };

    // ... (Initial Data same)
    // Fallback initial data (overridden by Market Data API)
    const initialData: Record<string, { price: number, volume: number }> = {
        BTC: { price: 65000.00, volume: 35000000 },
        ETH: { price: 3450.20, volume: 12000000 },
        SOL: { price: 145.50, volume: 8000000 },
        BNB: { price: 580.20, volume: 5000000 },
        LINK: { price: 17.50, volume: 2500000 },
        SHIB: { price: 0.000013, volume: 12000000 },
        MATIC: { price: 0.95, volume: 2000000 },
        POL: { price: 0.95, volume: 2000000 },
        DOGE: { price: 0.15, volume: 15000000 },
        USDT: { price: 1.00, volume: 50000000 },
        USD1: { price: 1.00, volume: 1000000 },
    };

    const [allMarketPrices, setAllMarketPrices] = useState(initialData);
    const [realPricesLoaded, setRealPricesLoaded] = useState(false);

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

        return supported;
    }, [effectiveChainId, activeChains]);

    const buildRankedAutoCandidates = useCallback((): RankedTokenCandidate[] => {
        const unique = new Map<string, RankedTokenCandidate>();
        const executionSupportedSymbols = getExecutionSupportedSymbols();
        const requiresOnchainSupport =
            !isDemoMode &&
            !!effectiveIsConnected &&
            !!effectiveChainId &&
            isSupportedChain(effectiveChainId);
        const preferredExecutionSymbols = requiresOnchainSupport
            ? LIVE_EXECUTION_PREFERRED_SYMBOLS[effectiveChainId]
            : undefined;

        Object.entries(allMarketPrices).forEach(([rawSymbol, rawData]) => {
            const symbol = normalizeTrackedSymbol(rawSymbol);
            const upper = symbol.toUpperCase();
            if (!isInterestingToken(upper) || TRADE_CONFIG.STABLECOINS.includes(upper)) return;
            if (!executionSupportedSymbols.has(symbol)) return;

            if (requiresOnchainSupport) {
                try {
                    resolveToken(symbol, effectiveChainId);
                } catch {
                    return;
                }
            }

            const fallback = initialData[symbol];
            const price = Number((rawData as any)?.price ?? fallback?.price ?? 0);
            if (!Number.isFinite(price) || price <= 0) return;

            const change24h = Number((rawData as any)?.change24h ?? (rawData as any)?.price_change_percentage_24h ?? 0);
            const volume = Number((rawData as any)?.volume ?? fallback?.volume ?? 0);
            const momentumScore = Math.abs(change24h);
            const liquidityScore = Math.log10(Math.max(volume, 1)) * 0.6;
            const selectedPenalty = symbol === selectedCurrency ? 2 : 0;
            const recentPenalty = symbol === lastAutoTradeSymbolRef.current ? 4 : 0;
            const preferredBoost = symbol === "SHIB" ? 1.6 : symbol === "LINK" ? 1.0 : symbol === "ETH" ? 0.8 : 0;
            const nonPreferredPenalty =
                requiresOnchainSupport && preferredExecutionSymbols && !preferredExecutionSymbols.has(symbol)
                    ? 1.2
                    : 0;

            unique.set(symbol, {
                symbol,
                price,
                change24h,
                volume,
                score: momentumScore + liquidityScore + preferredBoost - selectedPenalty - recentPenalty - nonPreferredPenalty,
            });
        });

        return Array.from(unique.values()).sort((left, right) => right.score - left.score);
    }, [allMarketPrices, selectedCurrency, isDemoMode, effectiveIsConnected, effectiveChainId, getExecutionSupportedSymbols]);

    const pushSymbolPriceSample = useCallback((symbol: string, price: number, ts: number = Date.now()) => {
        if (!Number.isFinite(price) || price <= 0) return;
        const normalized = normalizeTrackedSymbol(symbol);
        const current = symbolPriceHistoryRef.current[normalized] || [];
        const last = current[current.length - 1];
        const smallMove = last ? Math.abs(last.price - price) <= Math.max(last.price * 0.00003, 0.0000001) : false;
        if (last && ts - last.ts < 8000 && smallMove) {
            return;
        }

        const next = [...current, { ts, price }].filter((sample) => ts - sample.ts <= 20 * 60 * 1000);
        symbolPriceHistoryRef.current[normalized] = next.slice(-240);
    }, []);

    const getShortMomentumSignal = useCallback((symbol: string, currentPrice: number): ShortMomentumSignal => {
        const normalized = normalizeTrackedSymbol(symbol);
        const samples = symbolPriceHistoryRef.current[normalized] || [];
        if (samples.length === 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
            return { r1: 0, r5: 0, r15: 0, score: 0, confidence: 0 };
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

        const r1 = p1 > 0 ? (currentPrice - p1) / p1 : 0;
        const r5 = p5 > 0 ? (currentPrice - p5) / p5 : 0;
        const r15 = p15 > 0 ? (currentPrice - p15) / p15 : 0;

        const score = r1 * 0.45 + r5 * 0.35 + r15 * 0.2;
        const sampleCoverage = Math.min(1, samples.length / 30);
        const moveStrength = Math.min(1, (Math.abs(r1) + Math.abs(r5) + Math.abs(r15)) * 120);
        const confidence = Number((sampleCoverage * moveStrength).toFixed(3));

        return { r1, r5, r15, score, confidence };
    }, []);

    const getUsdPrice = useCallback((symbol: string) => {
        const normalized = normalizeTrackedSymbol(symbol);
        if (TRADE_CONFIG.STABLECOINS.includes(normalized)) return 1;
        return allMarketPrices[normalized]?.price || initialData[normalized]?.price || 0;
    }, [allMarketPrices]);

    const pickFundingSourceForBuy = useCallback((
        targetSymbol: string,
        desiredUsd: number,
    currentPortfolio: Portfolio,
    ): { sourceSymbol?: string; budgetUsd: number } => {
        const supportedSymbols = getExecutionSupportedSymbols();
        const preferredSymbols = (!isDemoMode && effectiveChainId && isSupportedChain(effectiveChainId))
            ? LIVE_EXECUTION_PREFERRED_SYMBOLS[effectiveChainId]
            : undefined;
        const safeDesiredUsd = Math.max(0, desiredUsd);
        const stableUsd = Math.max(0, Number(currentPortfolio.cashbalance || 0));

        const nonStableFunding = currentPortfolio.positions
            .map((position) => {
                const symbol = normalizeTrackedSymbol(position.symbol);
                const price = getUsdPrice(symbol);
                const usdValue = position.amount * price;
                return {
                    symbol,
                    amount: position.amount,
                    price,
                    usdValue,
                };
            })
            .filter((entry) =>
                entry.symbol !== normalizeTrackedSymbol(targetSymbol) &&
                entry.price > 0 &&
                entry.amount > 0 &&
                entry.usdValue > 5 &&
                supportedSymbols.has(entry.symbol),
            )
            .filter((entry) => {
                if (!(!isDemoMode && effectiveChainId === 56 && entry.symbol === "BNB")) return true;
                return entry.usdValue > (BNB_GAS_RESERVE_USD + LIVE_MIN_ORDER_USD);
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

        if (nonStableFunding.length === 0) {
            const stableOnlyBudget = Math.min(safeDesiredUsd, stableUsd);
            if (stableOnlyBudget < LIVE_MIN_ORDER_USD) {
                return { sourceSymbol: undefined, budgetUsd: 0 };
            }
            return { sourceSymbol: undefined, budgetUsd: stableOnlyBudget };
        }

        const chosen = nonStableFunding[0];
        const budgetFromToken = Math.min(chosen.usdValue * 0.35, Math.max(5, safeDesiredUsd));
        if (budgetFromToken < LIVE_MIN_ORDER_USD) {
            return { sourceSymbol: undefined, budgetUsd: 0 };
        }
        return {
            sourceSymbol: chosen.symbol,
            budgetUsd: budgetFromToken,
        };
    }, [getExecutionSupportedSymbols, getUsdPrice, isDemoMode, effectiveChainId]);

    const refreshDailyStrategyProposals = useCallback((trigger: "timer" | "manual" | "symbol-change" = "timer") => {
        const rankedCandidates = buildRankedAutoCandidates();
        if (rankedCandidates.length === 0) return;

        const prioritized: RankedTokenCandidate[] = [];
        const selectedCandidate = rankedCandidates.find((candidate) => candidate.symbol === selectedCurrency);
        if (selectedCandidate) prioritized.push(selectedCandidate);
        rankedCandidates.forEach((candidate) => {
            if (!prioritized.some((entry) => entry.symbol === candidate.symbol)) {
                prioritized.push(candidate);
            }
        });

        const candidatePool = prioritized.slice(0, Math.min(8, prioritized.length));
        const now = Date.now();

        const generatedStrategies: StrategyProposal[] = DAILY_STRATEGY_BLOCKS.map((block, index) => {
            const candidate = candidatePool[index % candidatePool.length];
            const action = candidate.change24h >= 1 ? "BUY" : candidate.change24h <= -1 ? "SELL" : "HOLD";
            const adaptiveRisk = Math.max(
                1,
                Math.min(5, Math.round((riskTolerance + Math.min(5, Math.max(1, Math.abs(candidate.change24h) / 1.5))) / 2)),
            );
            const scalpTakeProfit = clampScalpTakeProfit(1.3 + Math.min(1.1, Math.abs(candidate.change24h) * 0.08));
            const scalpStopLoss = clampScalpStopLoss(-(0.8 + Math.min(0.8, Math.abs(candidate.change24h) * 0.05)));
            const reasoning =
                "24h変動率 "
                + candidate.change24h.toFixed(2)
                + "% / 価格 "
                + "$"
                + candidate.price.toFixed(candidate.price >= 1 ? 2 : 6)
                + " / 流動性 "
                + Math.round(candidate.volume).toLocaleString("ja-JP")
                + ` / 日次目標 +${DAILY_COMPOUND_TARGET_PCT}%`;

            return {
                id: `auto-daily-${block.replace(":", "").replace("-", "_")}`,
                agentId: "coordinator",
                title: `${candidate.symbol} 日次戦略 ${block}`,
                description: getStrategyBlockDescription(block, candidate.symbol, action, reasoning),
                status: "ACTIVE",
                timestamp: now + index,
                durationBlock: block,
                assetSymbol: candidate.symbol,
                pairLabel: `${candidate.symbol}/USDT`,
                proposedSettings: {
                    riskTolerance: adaptiveRisk,
                    stopLoss: scalpStopLoss,
                    takeProfit: scalpTakeProfit,
                },
            };
        });

        setStrategyProposals((prev) => {
            const manual = prev.filter((proposal) => !proposal.id.startsWith("auto-daily-"));
            return [...generatedStrategies, ...manual].slice(0, 24);
        });
        setActiveStrategies((prev) => {
            const manual = prev.filter((strategy) => !strategy.id.startsWith("auto-daily-"));
            return [...generatedStrategies, ...manual].slice(0, 24);
        });

        if (trigger !== "timer") {
            addMessage("coordinator", "1日のストラテジーを最新相場で更新しました。", "SYSTEM");
        }
        lastStrategyRefreshRef.current = now;
    }, [addMessage, buildRankedAutoCandidates, riskTolerance, selectedCurrency, stopLossThreshold, takeProfitThreshold]);

    useEffect(() => {
        if (lastStrategyRefreshRef.current === 0) {
            refreshDailyStrategyProposals("timer");
        }
    }, [refreshDailyStrategyProposals]);

    useEffect(() => {
        if (lastStrategyCurrencyRef.current === selectedCurrency) return;
        lastStrategyCurrencyRef.current = selectedCurrency;
        refreshDailyStrategyProposals("symbol-change");
    }, [refreshDailyStrategyProposals, selectedCurrency]);

    useEffect(() => {
        if (!forceProposal) return;
        refreshDailyStrategyProposals("manual");
        setForceProposal(false);
    }, [forceProposal, refreshDailyStrategyProposals]);

    useEffect(() => {
        if (!isSimulating) return;
        const interval = setInterval(() => {
            if (Date.now() - lastStrategyRefreshRef.current > 15 * 60 * 1000) {
                refreshDailyStrategyProposals("timer");
            }
        }, 60 * 1000);
        return () => clearInterval(interval);
    }, [isSimulating, refreshDailyStrategyProposals]);

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

        addMessage("manager", "学習フィードバック: " + feedback + " - パラメータ自動調整を反映しました。", "SYSTEM");
    }, [addMessage]);

    const executeTrade = useCallback(async (
        tokenSymbol: string,
        action: "BUY" | "SELL",
        amount: number,
        price: number,
        reason?: string,
        dex?: string,
        fundingSymbol?: string,
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
        lastTradeRef.current = Date.now();

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
        const isAutoTriggeredOrder =
            (reason?.includes("AI technical signal") ?? false)
            || (reason?.includes("戦略") ?? false)
            || (reason?.includes("自動") ?? false);

        if (action === "SELL") {
            const livePos = portfolioRef.current.positions.find(
                (p) => normalizeTrackedSymbol(p.symbol) === normalizedTokenSymbol,
            );
            const livePrice = allMarketPrices[normalizedTokenSymbol]?.price || initialData[normalizedTokenSymbol]?.price || price || 0;
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

        if (!currentDemoMode && effectiveChainId && isAutoTriggeredOrder) {
            const preferredSymbols = LIVE_EXECUTION_PREFERRED_SYMBOLS[effectiveChainId];
            if (preferredSymbols && !preferredSymbols.has(normalizedTokenSymbol)) {
                addMessage(
                    "SYSTEM",
                    `${normalizedTokenSymbol} は実行優先度が低いため、ルート取得に失敗した場合はスキップされます。`,
                    "SYSTEM",
                );
            }
        }

        if (!currentDemoMode && effectiveChainId) {
            try {
                resolveToken(normalizedTokenSymbol, effectiveChainId);
            } catch {
                addMessage(
                    "SYSTEM",
                    normalizedTokenSymbol + " はチェーン " + effectiveChainId + " で未対応のため注文をスキップしました。",
                    "ALERT",
                );
                setTradeInProgress(false);
                return false;
            }
            if (normalizedFundingSymbol && normalizedFundingSymbol !== normalizedTokenSymbol) {
                try {
                    resolveToken(normalizedFundingSymbol, effectiveChainId);
                } catch {
                    addMessage(
                        "SYSTEM",
                        normalizedFundingSymbol + " はチェーン " + effectiveChainId + " で未対応のため資金源に使用できません。",
                        "ALERT",
                    );
                    setTradeInProgress(false);
                    return false;
                }
            }
        }

        if (!currentDemoMode && effectiveAddress && effectiveChainId) {
            console.log('[DEBUG] executeTrade: Starting ParaSwap On-Chain Execution...', { tokenSymbol, action, amount, effectiveChainId, effectiveAddress });
            setTradeInProgress(true);
            try {
                if (!isSupportedChain(effectiveChainId)) {
                    throw new Error("Chain " + effectiveChainId + " is not supported by our implementation.");
                }

                // Resolve Addresses & Decimals through Registry
                const quoteCandidates = ["USDT", "USDC", "USD1", "BUSD", "FDUSD", "DAI"];
                const supportedQuotes = quoteCandidates.filter((symbol) => {
                    try {
                        resolveToken(symbol, effectiveChainId);
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
                    const tokenInfo = resolveToken(symbol, effectiveChainId);
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
                    const candidates = portfolioRef.current.positions
                        .map((position) => {
                            const symbol = normalizeTrackedSymbol(position.symbol);
                            const usdPrice = getUsdPrice(symbol);
                            const estimatedUsd = position.amount * usdPrice;
                            return { symbol, usdPrice, estimatedUsd };
                        })
                        .filter((entry) =>
                            entry.symbol !== normalizedTokenSymbol
                            && entry.usdPrice > 0
                            && entry.estimatedUsd >= 2
                            && !TRADE_CONFIG.STABLECOINS.includes(entry.symbol),
                        )
                        .filter((entry) => {
                            try {
                                resolveToken(entry.symbol, effectiveChainId);
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
                        if (usdValue >= Math.max(LIVE_MIN_ORDER_USD, requiredUsd * 0.35)) {
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
                    const requiredQuoteAmount = amount * price * 1.003;
                    const quoteBalances: { symbol: string; amount: number }[] = [];

                    for (const quoteSymbol of supportedQuotes) {
                        const quoteInfo = resolveToken(quoteSymbol, effectiveChainId);
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
                            if (maxBalance) {
                                throw new Error(
                                    `ステーブル残高不足: 必要 ${requiredQuoteAmount.toFixed(4)} / 最大保有 ${maxBalance.symbol} ${maxBalance.amount.toFixed(4)}`,
                                );
                            }
                            throw new Error("資金源となる残高が不足しているため発注できません。");
                        }
                    }
                }

                if (!TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)) {
                    const srcPrice = getUsdPrice(tradeSourceSymbol);
                    if (srcPrice <= 0) {
                        throw new Error(`${tradeSourceSymbol} の価格が取得できないため発注できません。`);
                    }
                }

                const srcTokenInfo = resolveToken(tradeSourceSymbol, effectiveChainId);
                const destTokenInfo = resolveToken(tradeDestSymbol, effectiveChainId);
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
                            ? (amount * price)
                            : ((amount * price) / Math.max(getUsdPrice(tradeSourceSymbol), 0.0000001))
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
                    && effectiveChainId === 56
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
                    ? 2.0
                    : LIVE_MIN_ORDER_USD;
                if (!currentDemoMode && sourceUsdNotional < minLiveNotionalUsd) {
                    throw new Error(`発注額が小さすぎます (${sourceUsdNotional.toFixed(3)} USD / 最低 ${minLiveNotionalUsd.toFixed(1)} USD)`);
                }

                setTradeInProgress(true);
                addMessage("SYSTEM", "ParaSwap で " + (action === "BUY" ? "購入" : "売却") + " を開始します。", "SYSTEM");
                if (action === "BUY" && tradeSourceSymbol !== "USDT") {
                    addMessage("SYSTEM", "資金源として " + tradeSourceSymbol + " を使用して注文します。", "SYSTEM");
                }
                if (action === "BUY" && !TRADE_CONFIG.STABLECOINS.includes(tradeSourceSymbol)) {
                    addMessage("SYSTEM", "非ステーブル建てペア: " + tradeSourceSymbol + "/" + normalizedTokenSymbol, "SYSTEM");
                }

                let tradeData: any;
                let lastTradeError = "";
                let finalSizeFactor = executedSizeFactor;
                const retrySizeFactors = [1, 0.72, 0.5];
                const isNonRetryableTradeError = (message: string) =>
                    /cooldown|unsupported|wallet address mismatch|security check failed|chain .* not supported|invalid|exceeds the balance of the account|insufficient|gas fee|total cost/i.test(message);

                for (const retryFactor of retrySizeFactors) {
                    const attemptSrcAmount = srcAmountNumber * retryFactor;
                    if (!Number.isFinite(attemptSrcAmount) || attemptSrcAmount <= 0) continue;

                    const amountInWei = parseUnits(
                        attemptSrcAmount.toFixed(srcTokenInfo.decimals),
                        srcTokenInfo.decimals,
                    ).toString();

                    console.warn("[TRADE_CALL]", {
                        chainId: effectiveChainId,
                        srcSymbol: tradeSourceSymbol,
                        destSymbol: tradeDestSymbol,
                        amountWei: amountInWei,
                        fromAddress: effectiveAddress,
                        mode: currentDemoMode ? "demo" : "real",
                        auto: (reason === "AI technical signal" || reason?.includes("自動")),
                        retryFactor,
                    });

                    const tradeRes = await fetch("/api/trade", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chainId: effectiveChainId,
                            srcSymbol: tradeSourceSymbol,
                            destSymbol: tradeDestSymbol,
                            amountWei: amountInWei,
                            fromAddress: effectiveAddress,
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
                    if (isNonRetryableTradeError(lastTradeError)) break;
                    await new Promise((resolve) => setTimeout(resolve, 400));
                }

                if (!tradeData?.ok) {
                    throw new Error(lastTradeError || "Trade API failed");
                }
                executedTokenAmount = Math.max(0, amount * finalSizeFactor);

                const txHash = tradeData.txHash;
                const livePosition = portfolioRef.current.positions.find((position) => normalizeTrackedSymbol(position.symbol) === normalizedTokenSymbol);
                const estimatedFeeUsd = action === "BUY"
                    ? (executedTokenAmount * price * 0.003)
                    : Math.max(executedTokenAmount * price * 0.003, 0);
                const realizedPnl = action === "SELL" && livePosition
                    ? ((price - livePosition.entryPrice) * executedTokenAmount) - estimatedFeeUsd
                    : undefined;
                setLastAction(action);
                addMessage("SYSTEM", "トレード送信完了 (Tx: " + txHash.slice(0, 10) + "...)", "SYSTEM");

                if (publicClient) {
                    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as any });
                    if (receipt.status === 'success') {
                        const chainName = effectiveChainId === 137 ? "Polygon" : "BNB Chain";
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
                            dex: "ParaSwap",
                            chain: chainName,
                            reason: detailedReason,
                            entryPrice: livePosition?.entryPrice,
                            plannedTakeProfit: action === "BUY" ? price * (1 + takeProfitThreshold / 100) : undefined,
                            plannedStopLoss: action === "BUY" ? price * (1 + stopLossThreshold / 100) : undefined,
                            decisionSummary: action === "BUY"
                                ? detailedReason
                                : (detailedReason || "利益確定またはリスク管理条件に基づいて決済しました。"),
                            newsTitle: latestNews?.title,
                        };

                        setTransactions(prev => [liveTx, ...prev].slice(0, 200));
                        addDisPoints(1);
                        if (action === "SELL") {
                            addDisPoints((realizedPnl || 0) > 0 ? 5 : -3);
                        }
                        addMessage("manager", "ParaSwap の取引が約定しました。", "EXECUTION");
                        if (isSoundEnabled) playTrade();
                        unlockAchievement("first-trade");
                    } else {
                        throw new Error("Transaction execution failed on blockchain.");
                    }
                }

                setTradeInProgress(false);
                nextTradeAllowedAtRef.current = 0;
                return true;
            } catch (error: any) {
                setTradeInProgress(false);
                console.error("ParaSwap trade error:", error);
                const rawMessage = String(error?.message || "Unknown trade error");
                const hardInsufficient = /insufficient|残高不足|保有不足|exceeds balance|balance/i.test(rawMessage);
                const insufficientLike = hardInsufficient || /small|liquidity|no routes|cooldown/i.test(rawMessage);
                const backoffMs = hardInsufficient ? 90000 : (insufficientLike ? 45000 : 10000);
                lastTradeErrorTime.current = Date.now();
                nextTradeAllowedAtRef.current = Date.now() + backoffMs;
                if (hardInsufficient) {
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
        };
        setTransactions(prev => [newTx, ...prev].slice(0, 100));

        // Add to notifications
        const notification: TradeNotification = {
            id: Math.random().toString(36).substring(7),
            agentId: "manager",
            agentName: "AI Trading Manager",
            title: action === "BUY" ? "購入注文を実行" : "売却注文を実行",
            message: selectedDex + " で " + amount.toFixed(4) + " " + tokenSymbol + " を ¥" + convertJPY(totalValue).toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + " で" + (action === "BUY" ? "購入" : "売却") + "しました。",
            type: action,
            symbol: tokenSymbol,
            timestamp: Date.now(),
        };
        setTradeNotifications(prev => [notification, ...prev].slice(0, 50));

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
        tradeInProgress,
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
        localStorage.removeItem("jdex_portfolio");
        localStorage.removeItem("jdex_transactions");
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
                try { setTransactions(JSON.parse(storedTx)); } catch (e) { }
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
                        setTransactions(JSON.parse(storedLiveTx));
                    } catch (e) {
                        setTransactions([]);
                    }
                } else {
                    setTransactions([]);
                }
            } else {
                setTransactions([]);
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
    }, [liveTransactionsStorageKey]);

    // Save state on changes (only if in demo mode to protect live state isolation)
    useEffect(() => {
        if (isDemoMode) {
            localStorage.setItem("jdex_portfolio", JSON.stringify(portfolio));
        }
    }, [portfolio, isDemoMode]);

    useEffect(() => {
        if (isDemoMode) {
            localStorage.setItem("jdex_transactions", JSON.stringify(transactions));
        }
    }, [transactions, isDemoMode]);

    useEffect(() => {
        if (!isDemoMode && liveTransactionsStorageKey) {
            localStorage.setItem(liveTransactionsStorageKey, JSON.stringify(transactions));
        }
    }, [transactions, isDemoMode, liveTransactionsStorageKey]);

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
                    "BTC",
                    "ETH",
                    "SOL",
                    "BNB",
                    "MATIC",
                    "LINK",
                    "SHIB",
                    ...Object.keys(TOKEN_REGISTRY[56] || {}),
                    ...Object.keys(TOKEN_REGISTRY[137] || {}),
                ]));
                const prices = await fetchMarketPrices(symbols);
                if (prices && Object.keys(prices).length > 0) {
                    setAllMarketPrices(prev => {
                        const updated = { ...prev };
                        Object.entries(prices).forEach(([symbol, data]) => {
                            updated[symbol] = {
                                price: data.price,
                                volume: prev[symbol]?.volume || 0,
                            };
                        });
                        return updated;
                    });
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
                        setTransactions(JSON.parse(storedLiveTx));
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
            const nativeSymbol = normalizeTrackedSymbol(balanceData.symbol || (chainId === 137 ? "MATIC" : "BNB"));
            const nativeAmount = Number(balanceData.formatted || 0);

            const registry = TOKEN_REGISTRY[chainId] || {};
            const tokenEntries = Object.entries(registry).filter(
                ([, tokenInfo]) => tokenInfo.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase(),
            );
            const tokenBalances: { symbol: string; amount: number }[] = [];

            if (tokenEntries.length > 0) {
                const results = await publicClient.multicall({
                    allowFailure: true,
                    contracts: tokenEntries.map(([, tokenInfo]) => ({
                        address: tokenInfo.address as `0x${string}`,
                        abi: erc20Abi,
                        functionName: "balanceOf",
                        args: [address as `0x${string}`],
                    })),
                });

                tokenEntries.forEach(([symbol, tokenInfo], index) => {
                    const result = results[index];
                    if (result.status !== "success") return;

                    const rawBalance = result.result as bigint;
                    if (rawBalance <= 0n) return;

                    const amount = Number(formatUnits(rawBalance, tokenInfo.decimals));
                    if (!Number.isFinite(amount) || amount <= 0) return;
                    tokenBalances.push({ symbol: normalizeTrackedSymbol(symbol), amount });
                });
            }

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

            let priceSnapshot = allMarketPrices;
            if (missingPriceSymbols.length > 0) {
                try {
                    const fetchedPrices = await fetchMarketPrices(missingPriceSymbols);
                    if (Object.keys(fetchedPrices).length > 0) {
                        setAllMarketPrices((prev) => {
                            const updated = { ...prev };
                            Object.entries(fetchedPrices).forEach(([symbol, data]) => {
                                updated[symbol] = {
                                    price: data.price,
                                    volume: prev[symbol]?.volume || 0,
                                };
                            });
                            priceSnapshot = updated;
                            return updated;
                        });
                    }
                } catch (error) {
                    console.warn("[J-DEX] Failed to fetch missing wallet prices:", error);
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

            const resolveUsdPrice = (symbol: string) => {
                if (TRADE_CONFIG.STABLECOINS.includes(symbol)) return 1;
                const livePrice = priceSnapshot[symbol]?.price;
                if (typeof livePrice === "number" && livePrice > 0) return livePrice;
                const fallbackPrice = initialData[symbol]?.price;
                if (typeof fallbackPrice === "number" && fallbackPrice > 0) return fallbackPrice;
                return previousPriceBySymbol.get(symbol) || 0;
            };

            let unresolvedPriceCount = 0;
            const nativeUsdPrice = resolveUsdPrice(nativeSymbol);
            if (!TRADE_CONFIG.STABLECOINS.includes(nativeSymbol) && nativeAmount > 0 && nativeUsdPrice <= 0) {
                unresolvedPriceCount += 1;
            }

            let walletTotalUsd = nativeAmount * nativeUsdPrice;
            let stableLiquidityUsd = TRADE_CONFIG.STABLECOINS.includes(nativeSymbol) ? walletTotalUsd : 0;

            tokenBalances.forEach(({ symbol, amount }) => {
                const usdPrice = resolveUsdPrice(symbol);
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
                    const price = resolveUsdPrice(symbol);
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
        allMarketPrices,
        balanceData,
        chainId,
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
                        content = "【テクニカル分析/" + randomCoin + "-JPY (" + timeframe + ")】短期モメンタムが強く、順張り候補として監視します。24h変動率は +" + change.toFixed(1) + "% です。";
                    } else if (agent.id === "sentiment" && Math.random() > 0.5) {
                        content = "【センチメント/" + randomCoin + "-JPY (" + timeframe + ")】コミュニティの関心が高まっています。短期の資金流入に注意します。";
                    } else if (agent.id === "fundamental" && change < -10) {
                        content = "【ファンダメンタル/" + randomCoin + "-JPY (" + timeframe + ")】急落していますが、ニュース次第では逆張り候補として再評価します。";
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
                                    "AI technical signal",
                                    undefined,
                                    fundingSymbolForBuy,
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
                                const executed = await executeTrade(signalSymbol, action, amount, signalPrice, "AI technical signal");
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
                        executeTrade(pos.symbol, "SELL", pos.amount, posPrice, "ストップロス発動 (" + stopLossThreshold + "%)");
                        addMessage("security", "[緊急決済] " + pos.symbol + " がストップロス (" + stopLossThreshold + "%) に達したため売却しました。", "ALERT");
                    }
                    // Take Profit Check
                    else if (pnlPct >= takeProfitThreshold) {
                        executeTrade(pos.symbol, "SELL", pos.amount, posPrice, "利益確定注文実行 (+" + takeProfitThreshold + "%)");
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
                            executeTrade(pos.symbol, "SELL", pos.amount, posPrice, "トレーリングストップ決済 (最高値 $" + highest.toLocaleString() + " から -" + trailingThreshold + "%)");
                            addMessage("manager", "[利益確保] " + pos.symbol + " が最高値から反落したため決済しました。", "EXECUTION");
                        }
                    }

                    // 3. Smart Stop-Loss (Emergency)
                    const emergencyCutoff = Math.min(stopLossThreshold - 1, -6);
                    if (riskStatus === "CRITICAL" && pnlPct <= emergencyCutoff) {
                        executeTrade(pos.symbol, "SELL", pos.amount, posPrice, "緊急回避: 市場リスク高騰に伴う防御損切り");
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
                                executeTrade(topPos.symbol, "SELL", hedgeAmount, priceData.price, "リスクヘッジ: 市場センチメント悪化に伴う資金待避");
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
                                demoStrategy + "戦略: 短期モメンタム売り"
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

            const currentPortfolio = portfolioRef.current;
            const candidates = buildRankedAutoCandidates();
            if (candidates.length === 0) {
                emitLiveAutoStatus("skip: no ranked candidates", {
                    auto: isAutoPilotEnabled,
                    chainId: effectiveChainId,
                    positions: currentPortfolio.positions.length,
                });
                return;
            }

            const candidate =
                candidates.find((item) => item.symbol !== lastAutoTradeSymbolRef.current)
                || candidates[0];
            const symbol = candidate.symbol;
            const price = candidate.price || getUsdPrice(symbol);
            if (!Number.isFinite(price) || price <= 0) {
                emitLiveAutoStatus("skip: invalid price", { symbol, price });
                return;
            }

            const hasAnySellableInventory = currentPortfolio.positions.some((entry) => {
                const normalized = normalizeTrackedSymbol(entry.symbol);
                const usd = entry.amount * Math.max(getUsdPrice(normalized), 0);
                return usd >= 2;
            });
            const stableLiquidityUsd = Number(currentPortfolio.cashbalance || 0);

            if (!hasAnySellableInventory && stableLiquidityUsd >= LIVE_MIN_ORDER_USD) {
                const bootstrapSymbol = candidate.symbol;
                const bootstrapPrice = candidate.price || getUsdPrice(bootstrapSymbol);
                if (!Number.isFinite(bootstrapPrice) || bootstrapPrice <= 0) {
                    emitLiveAutoStatus("skip: bootstrap invalid price", { bootstrapSymbol, bootstrapPrice });
                    return;
                }

                const requestedBudget = Math.min(
                    Math.max(LIVE_TARGET_ORDER_USD, currentPortfolio.totalValue * 0.08),
                    Math.max(LIVE_TARGET_ORDER_USD, Math.min(stableLiquidityUsd * 0.45, 8)),
                );
                const bootstrapFunding = pickFundingSourceForBuy(bootstrapSymbol, requestedBudget, currentPortfolio);
                if (bootstrapFunding.budgetUsd < LIVE_MIN_ORDER_USD) {
                    emitLiveAutoStatus("skip: bootstrap budget too small", {
                        stableLiquidityUsd,
                        requestedBudget,
                        budgetUsd: bootstrapFunding.budgetUsd,
                    });
                    return;
                }

                const bootstrapAmount = bootstrapFunding.budgetUsd / bootstrapPrice;
                if (!Number.isFinite(bootstrapAmount) || bootstrapAmount <= 0) {
                    emitLiveAutoStatus("skip: bootstrap amount invalid", { bootstrapAmount, bootstrapPrice });
                    return;
                }

                const bootstrapReason =
                    bootstrapFunding.sourceSymbol && !TRADE_CONFIG.STABLECOINS.includes(bootstrapFunding.sourceSymbol)
                        ? `自動戦略: 初回エントリー（資金再配分 ${bootstrapFunding.sourceSymbol}→${bootstrapSymbol}。初期分散のため）`
                        : "自動戦略: 初回エントリー";

                const executed = await executeTrade(
                    bootstrapSymbol,
                    "BUY",
                    bootstrapAmount,
                    bootstrapPrice,
                    bootstrapReason,
                    undefined,
                    bootstrapFunding.sourceSymbol,
                );
                if (executed) {
                    lastTradeRef.current = Date.now();
                    lastAutoTradeSymbolRef.current = bootstrapSymbol;
                    emitLiveAutoStatus("executed: bootstrap BUY", {
                        symbol: bootstrapSymbol,
                        budgetUsd: bootstrapFunding.budgetUsd,
                        source: bootstrapFunding.sourceSymbol || "USDT",
                    });
                } else {
                    emitLiveAutoStatus("skip: bootstrap BUY execution failed", { symbol: bootstrapSymbol });
                }
                return;
            }

            const signal = getShortMomentumSignal(symbol, price);
            const bullish = signal.score > 0.00008 && signal.r1 > -0.0002 && signal.r5 > 0;
            const bearish =
                signal.score < -0.00025
                && signal.r1 < -0.00012
                && signal.r5 < -0.00005;

            const position = currentPortfolio.positions.find((entry) => normalizeTrackedSymbol(entry.symbol) === symbol);
            const positionPnlPct =
                position && position.entryPrice > 0
                    ? ((price - position.entryPrice) / position.entryPrice) * 100
                    : 0;
            const shouldStopLossExit = !!position && positionPnlPct <= stopLossThreshold;
            const shouldMomentumExit = !!position && bearish && positionPnlPct >= 1.2;

            if ((shouldStopLossExit || shouldMomentumExit) && position && position.amount > 0) {
                const sellAmount = shouldStopLossExit
                    ? Math.min(position.amount, Math.max(position.amount * 0.5, 0.0001))
                    : Math.min(position.amount, Math.max(position.amount * 0.25, 0.0001));
                const sellUsd = sellAmount * price;
                if (sellUsd >= 2) {
                    const sellReason = shouldStopLossExit
                        ? `自動戦略: ストップロス発動 (${positionPnlPct.toFixed(2)}% <= ${stopLossThreshold}%)`
                        : `自動戦略: 逆行警戒の資金再配分売り（ストップロス未到達 ${positionPnlPct.toFixed(2)}% / 短期反転シグナル）`;
                    const executed = await executeTrade(
                        symbol,
                        "SELL",
                        sellAmount,
                        price,
                        sellReason,
                    );
                    if (executed) {
                        lastTradeRef.current = Date.now();
                        lastAutoTradeSymbolRef.current = symbol;
                        emitLiveAutoStatus("executed: momentum SELL", {
                            symbol,
                            sellUsd,
                            pnlPct: positionPnlPct,
                            exitType: shouldStopLossExit ? "stop-loss" : "reallocation",
                        });
                    }
                }
                return;
            }

            if (!bullish) {
                emitLiveAutoStatus("skip: no bullish signal", {
                    symbol,
                    r1: signal.r1,
                    r5: signal.r5,
                    r15: signal.r15,
                    score: signal.score,
                });
                return;
            }

            const funding = pickFundingSourceForBuy(symbol, Math.max(LIVE_TARGET_ORDER_USD, currentPortfolio.totalValue * 0.08), currentPortfolio);
            if (funding.budgetUsd < LIVE_MIN_ORDER_USD) {
                emitLiveAutoStatus("skip: budget too small", {
                    symbol,
                    budgetUsd: funding.budgetUsd,
                    stableLiquidityUsd,
                });
                return;
            }

            const amount = funding.budgetUsd / price;
            if (!Number.isFinite(amount) || amount <= 0) {
                emitLiveAutoStatus("skip: invalid amount", { symbol, amount, price });
                return;
            }

            const buyReason =
                funding.sourceSymbol && !TRADE_CONFIG.STABLECOINS.includes(funding.sourceSymbol)
                    ? `自動戦略: 短期モメンタム買い（資金再配分 ${funding.sourceSymbol}→${symbol}。短期上昇シグナル優位のため）`
                    : "自動戦略: 短期モメンタム買い（短期上昇シグナル優位）";

            const executed = await executeTrade(
                symbol,
                "BUY",
                amount,
                price,
                buyReason,
                undefined,
                funding.sourceSymbol,
            );
            if (executed) {
                lastTradeRef.current = Date.now();
                lastAutoTradeSymbolRef.current = symbol;
                emitLiveAutoStatus("executed: momentum BUY", {
                    symbol,
                    budgetUsd: funding.budgetUsd,
                    source: funding.sourceSymbol || "USDT",
                });
            } else {
                emitLiveAutoStatus("skip: momentum BUY execution failed", { symbol });
            }
        };

        const timer = setInterval(() => {
            runLiveAutoTick().catch((error) => {
                console.warn("[J-DEX] Live auto-trade scheduler error:", error);
            });
        }, 15_000);

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
        buildRankedAutoCandidates,
        getUsdPrice,
        getShortMomentumSignal,
        pickFundingSourceForBuy,
        executeTrade,
    ]);

    // Expose addDiscussion to window for background tasks (like TraderChat's auto-council)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as any).jdex_addDiscussion = addDiscussion;
            (window as any).__DIS_EXECUTE_TRADE__ = executeTrade;
        }
    }, [addDiscussion, executeTrade]);

    // [VERIFICATION ONLY] One-time Manual SELL test to trigger Signature UI
    useEffect(() => {
        const IS_PROD = process.env.NODE_ENV === "production";
        if (IS_PROD) return; // Production縺ｧ縺ｯ螳悟・蛛懈ｭ｢

        // shouldFireOnceRef 縺・true 縺ｮ蝣ｴ蜷医・縺ｿ縲∵磁邯夂峩蠕後↓ SELL 繧偵ヨ繝ｪ繧ｬ繝ｼ縺吶ｋ
        if (effectiveIsConnected && !isDemoMode && effectiveAddress && effectiveChainId && shouldFireOnceRef.current && executeTrade) {
            console.log('[DEBUG] Immediate one-time SELL test triggered on connection');
            const bnbPrice = allMarketPrices["BNB"]?.price || 600;
            // Execute a small sell trade for verification
            executeTrade("BNB", "SELL", 0.005, bnbPrice, "IMMEDIATE_TEST_TRIGGER").catch(err => {
                console.log('[DEBUG] Immediate test SELL error (expected/ignored):', err.message);
            });
        }
    }, [effectiveIsConnected, isDemoMode, effectiveAddress, effectiveChainId, executeTrade, allMarketPrices]);

    return (
        <SimulationContext.Provider value={{
            messages, isAuthenticated, setIsAuthenticated, isSimulating, toggleSimulation,
            marketData, allMarketData: allMarketPrices, portfolio, agents, activeStrategies,
            riskTolerance, setRiskTolerance, stopLossThreshold, setStopLossThreshold,
            takeProfitThreshold, setTakeProfitThreshold, isFlashEnabled, setIsFlashEnabled,
            transactions, priceHistory, strategyProposals, updateProposalStatus,
            deleteProposal, addUserMessage, aiPopupMessage, closePopup: () => setAiPopupMessage(null),
            selectedCurrency, setSelectedCurrency, proposalFrequency, setProposalFrequency,
            activeChains, toggleChain, targetTop100, setTargetTop100,
            targetAllCurrencies, setTargetAllCurrencies, targetMemeCoins, setTargetMemeCoins,
            requestProposal, nickname, setNickname, favorites, toggleFavorite,
            discussionHistory, addDiscussion, tradeNotifications, dismissNotification, clearNotifications,
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
            isAutoPilotEnabled, setIsAutoPilotEnabled,
            isPricingPaused, resumePricing,
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



