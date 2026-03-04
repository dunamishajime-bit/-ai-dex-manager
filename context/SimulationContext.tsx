"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { Flame, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { fetchMarketPrices } from "@/lib/market-service";

import { useAccount } from "wagmi";
import { fetchDEXRanking, fetchMarketOverview, fetchPairs, fetchTokensByChain, getTopMovers, getCryptoNews, ChainId } from "@/lib/dex-service";
import { AGENTS, Agent, Message, normalizeToUSDTPair } from "@/lib/ai-agents";
import { resolveToken, NATIVE_TOKEN_ADDRESS } from "@/lib/tokens";
import { isSupportedChain } from "@/lib/chains";
import { parseUnits, formatUnits } from "viem";
import { useSendTransaction, usePublicClient, useWalletClient, useBalance } from "wagmi";
import { ERC20_ABI } from "@/lib/erc20-abi";
import { Achievement } from "@/components/features/AchievementHub";
import { useAgents } from "./AgentContext";
import { isMaintenanceMode } from "@/lib/user-store";
import { useSoundFX } from "@/hooks/useSoundFX";
import { useCurrency } from "./CurrencyContext";
import { generateRandomNews, convertRealToMarketNews, MarketNews } from "@/lib/news-service";
import { GeminiDiscussionResult } from "@/lib/gemini-service";
import { TRADE_CONFIG } from "@/config/tradeConfig";

export type { Message };

export type Currency = "BTC" | "ETH" | "SOL" | "BNB" | "MATIC" | "DOGE";
export type ProposalFrequency = "OFF" | "LOW" | "MEDIUM" | "HIGH";
export type DemoStrategy = "AGGRESSIVE" | "MODERATE" | "CONSERVATIVE";
export type Chain = "BNB" | "POLYGON";

const isInterestingToken = (symbol: string) => TRADE_CONFIG.isTradeableVolatilityToken(symbol);

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
    durationBlock?: "0-6" | "6-12" | "12-18" | "18-24"; // New: 6h block
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
    executeTrade: (tokenSymbol: string, action: "BUY" | "SELL", amount: number, price: number, reason?: string) => Promise<boolean>;
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


    // 繧｢繝ｳ繝槭え繝ｳ繝域凾繝ｻ蛻・妙譎ゅ・繧ｯ繝ｪ繝ｼ繝ｳ繧｢繝・・
    useEffect(() => {
        if (!isConnected && isSimulating) {
            setIsSimulating(false);
            setIsAutoPilotEnabled(false);
        }
    }, [isConnected, isSimulating]);

    const [messages, setMessages] = useState<Message[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
    const [strategyProposals, setStrategyProposals] = useState<StrategyProposal[]>([]);
    const [aiPopupMessage, setAiPopupMessage] = useState<Message | null>(null);
    const [selectedCurrency, setSelectedCurrency] = useState<Currency>("BNB");
    const [tradeInProgress, setTradeInProgress] = useState(false);
    const lastTradeErrorTime = useRef<number>(0);
    const [news, setNews] = useState<MarketNews[]>([]);
    const [lastAction, setLastAction] = useState<"BUY" | "SELL" | null>(null);

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

    useEffect(() => {
        const storedLiveInit = localStorage.getItem("jdex_live_initial_balance");
        if (storedLiveInit) setLiveInitialBalance(parseFloat(storedLiveInit));
    }, []);

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
            const blocks = ["0:00-6:00", "6:00-12:00", "12:00-18:00", "18:00-24:00"];
            const currentHour = new Date().getHours();
            const blockIndex = Math.floor(currentHour / 6);
            const block = blocks[blockIndex];

            const normalizedPair = normalizeToUSDTPair(entry.pair);
            const proposal: StrategyProposal = {
                id: "strat-" + entry.id,
                agentId: "coordinator",
                title: "AI 戦略提案: " + normalizedPair,
                description: normalizedPair + " の分析に基づく " + entry.result.action + " 戦略です。",
                status: "PENDING",
                timestamp: Date.now(),
                durationBlock: block as any,
                proposedSettings: {
                    riskTolerance: entry.result.confidence >= 80 ? 5 : entry.result.confidence >= 60 ? 3 : 2,
                    stopLoss: entry.result.stopLoss || -3,
                    takeProfit: entry.result.takeProfit || 5
                }
            };
            setStrategyProposals(prev => {
                // Remove duplicates if same id
                const filtered = prev.filter(p => p.id !== proposal.id);
                return [proposal, ...filtered].slice(0, 20);
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

    const requestProposal = () => [setForceProposal(true)];

    // ... (Initial Data same)
    // Fallback initial data (overridden by Market Data API)
    const initialData: Record<string, { price: number, volume: number }> = {
        BTC: { price: 65000.00, volume: 35000000 },
        ETH: { price: 3450.20, volume: 12000000 },
        SOL: { price: 145.50, volume: 8000000 },
        BNB: { price: 580.20, volume: 5000000 },
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
    const [riskTolerance, setRiskTolerance] = useState(4); // 1-5
    const [stopLossThreshold, setStopLossThreshold] = useState(-5);
    const [takeProfitThreshold, setTakeProfitThreshold] = useState(10);
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

    const executeTrade = useCallback(async (tokenSymbol: string, action: "BUY" | "SELL", amount: number, price: number, reason?: string, dex?: string): Promise<boolean> => {
        // --- HARD STOP (temporary) ---
        // Mitigation: Setting to false as we are implementing robust locks
        const HARD_STOP_TRADING = false;

        if (tradeInProgress) {
            console.warn("[TRADE_BLOCKED] Trade already in progress. Skipping duplicate request.", { tokenSymbol, action });
            return false;
        }

        console.warn("[UI_TRADE_CLICK]", {
            symbol: tokenSymbol,
            action,
            amount,
            price,
            reason,
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
        if (tradeInProgress) {
            console.warn("[TRADE_BLOCKED] Trade already in progress.");
            return false;
        }

        // Set lock early
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
        if (now - lastTradeErrorTime.current < 5000) {
            const remaining = Math.ceil((5000 - (now - lastTradeErrorTime.current)) / 1000);
            addMessage("SYSTEM", "[制限中] 連続発注を抑制しています。あと " + remaining + " 秒待ってください。", "ALERT");
            setTradeInProgress(false);
            return false;
        }

        if (!currentDemoMode && effectiveAddress && effectiveChainId) {
            console.log('[DEBUG] executeTrade: Starting ParaSwap On-Chain Execution...', { tokenSymbol, action, amount, effectiveChainId, effectiveAddress });
            setTradeInProgress(true);
            try {
                if (!isSupportedChain(effectiveChainId)) {
                    throw new Error("Chain " + effectiveChainId + " is not supported by our implementation.");
                }

                // Resolve Addresses & Decimals through Registry
                const stableSymbol = "USDT";
                const srcTokenInfo = resolveToken(action === "BUY" ? stableSymbol : tokenSymbol, effectiveChainId);
                const destTokenInfo = resolveToken(action === "BUY" ? tokenSymbol : stableSymbol, effectiveChainId);

                // Amount in Wei
                const srcAmountNumber = action === "BUY" ? (amount * price) : amount;
                const amountInWei = parseUnits(srcAmountNumber.toFixed(srcTokenInfo.decimals), srcTokenInfo.decimals).toString();

                setTradeInProgress(true);
                addMessage("SYSTEM", "ParaSwap で " + (action === "BUY" ? "購入" : "売却") + " を開始します。", "SYSTEM");

                console.warn("[TRADE_CALL]", {
                    chainId: effectiveChainId,
                    srcSymbol: action === "BUY" ? stableSymbol : tokenSymbol,
                    destSymbol: action === "BUY" ? tokenSymbol : stableSymbol,
                    amountWei: amountInWei,
                    fromAddress: effectiveAddress,
                    mode: currentDemoMode ? "demo" : "real",
                    auto: (reason === "AI technical signal" || reason?.includes("謌ｦ逡･:"))
                });

                const tradeRes = await fetch("/api/trade", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chainId: effectiveChainId,
                        srcSymbol: action === "BUY" ? stableSymbol : tokenSymbol,
                        destSymbol: action === "BUY" ? tokenSymbol : stableSymbol,
                        amountWei: amountInWei,
                        fromAddress: effectiveAddress,
                    }),
                });

                const tradeResText = await tradeRes.text();
                let tradeData: any;
                try {
                    tradeData = JSON.parse(tradeResText);
                } catch (e) {
                    throw new Error("Trade API Non-JSON response (Status:" + tradeRes.status + "): " + tradeResText.slice(0, 200));
                }

                if (!tradeRes.ok || !tradeData.ok) {
                    throw new Error(tradeData.error || ("Trade API failed (Status:" + tradeRes.status + ")"));
                }

                const txHash = tradeData.txHash;
                const livePosition = portfolioRef.current.positions.find((position) => position.symbol === tokenSymbol);
                const estimatedFeeUsd = action === "BUY" ? (amount * price * 0.003) : Math.max(amount * price * 0.003, 0);
                const realizedPnl = action === "SELL" && livePosition
                    ? ((price - livePosition.entryPrice) * amount) - estimatedFeeUsd
                    : undefined;
                setLastAction(action);
                addMessage("SYSTEM", "トレード送信完了 (Tx: " + txHash.slice(0, 10) + "...)", "SYSTEM");

                if (publicClient) {
                    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as any });
                    if (receipt.status === 'success') {
                        const chainName = effectiveChainId === 137 ? "Polygon" : "BNB Chain";
                        const txPair = action === "BUY" ? `${tokenSymbol}/USDT` : `${tokenSymbol}/USDT`;
                        const liveTx: Transaction = {
                            id: Math.random().toString(36).substring(7),
                            agentId: "manager",
                            type: action,
                            symbol: tokenSymbol,
                            amount,
                            price,
                            timestamp: Date.now(),
                            txHash,
                            fee: estimatedFeeUsd,
                            pnl: realizedPnl,
                            pair: txPair,
                            dex: "ParaSwap",
                            chain: chainName,
                            reason,
                            entryPrice: livePosition?.entryPrice,
                            plannedTakeProfit: action === "BUY" ? price * (1 + takeProfitThreshold / 100) : undefined,
                            plannedStopLoss: action === "BUY" ? price * (1 + stopLossThreshold / 100) : undefined,
                            decisionSummary: action === "BUY"
                                ? "短期モメンタムと候補ランキングに基づいてエントリーしました。"
                                : (reason || "利益確定またはリスク管理条件に基づいて決済しました。"),
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
                return true;
            } catch (error: any) {
                setTradeInProgress(false);
                lastTradeErrorTime.current = Date.now();
                console.error("ParaSwap trade error:", error);
                let errorMsg = error.message.substring(0, 150);
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
            chain: chain
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
    }, [isConnected, isDemoMode, addMessage, isSoundEnabled, playTrade, playSuccess, takeProfitThreshold, stopLossThreshold, agents, awardExp, updateAchievementProgress, addDisPoints, unlockAchievement, latestNews]);

    const updateProposalStatus = (id: string, status: "APPROVED" | "REJECTED" | "ACTIVE" | "PENDING") => {
        setStrategyProposals(prev => prev.map(p => {
            if (p.id === id) {
                const updated = { ...p, status };
                if (status === "ACTIVE") {
                    // Add to active strategies if not already there
                    setActiveStrategies(current => [...current, updated]);

                    // Apply settings if present
                    if (updated.proposedSettings) {
                        setRiskTolerance(updated.proposedSettings.riskTolerance);
                        setStopLossThreshold(updated.proposedSettings.stopLoss);
                        setTakeProfitThreshold(updated.proposedSettings.takeProfit);
                    }

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
                setRiskTolerance(r.tolerance);
                setStopLossThreshold(r.stopLoss);
                setTakeProfitThreshold(r.takeProfit);
            } catch (e) { }
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
                const symbols = ["BTC", "ETH", "SOL", "BNB", "MATIC", "DOGE"];
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

    // Sync Wallet Balance to Portfolio Cash when Connected
    useEffect(() => {
        if (isConnected && !isDemoMode && balanceData) {
            // Web3 connections sometimes append "t" for testnets, normalize back to mainnet ticker for Market Data Lookup
            let nativeSymbol = (balanceData.symbol || "BNB").toUpperCase();
            if (nativeSymbol === "TBNB" || nativeSymbol === "WBNB") nativeSymbol = "BNB";
            if (nativeSymbol === "TMATIC" || nativeSymbol === "POL") nativeSymbol = "MATIC";

            const priceData = allMarketPrices[nativeSymbol] || initialData[nativeSymbol];
            const usdPrice = priceData ? priceData.price : 0;
            const usdPriceTotal = usdPrice * Number(balanceData.formatted);

            // TELEMETRY: Help debug why the user sees 340k
            console.log("[J-DEX SYNC] Symbol: " + nativeSymbol + ", USD Price: " + usdPrice + ", Formatted: " + balanceData.formatted + ", USD Result: " + usdPriceTotal);

            setPortfolio((prev) => {
                // Prevent ghost calculations by enforcing 0 positions on live initial load hook
                if (prev.totalValue >= 200 && prev.positions.length === 0 && prev.cashbalance >= 200) {
                    return prev; // Ignore the $200 (approx 30,000 JPY) spike
                }

                // Calculate active position values
                // CRITICAL: Filter out any demo-only positions if we are in live mode.
                const trackedPositionsValue = prev.positions.reduce((acc, pos) => {
                    const symbol = pos.symbol.toUpperCase();
                    // If it's a major asset and we aren't explicitly tracking a LIVE trade for it, skip.
                    if (["BNB", "BTC", "ETH", "SOL", "MATIC"].includes(symbol)) {
                        if (!localStorage.getItem("jdex_live_active_trade_" + symbol)) {
                            console.log("[J-DEX] Filtering ghost position: " + symbol + " (" + pos.amount + ")");
                            return acc;
                        }
                    }
                    const pData = allMarketPrices[pos.symbol] || initialData[pos.symbol];
                    const val = (pos.amount * (pData ? pData.price : 0));
                    return acc + val;
                }, 0);

                const newTotalValue = usdPriceTotal + trackedPositionsValue;

                if (Math.abs(newTotalValue - prev.totalValue) > 1) {
                    console.log("[J-DEX] Portfolio Updated: USD " + newTotalValue.toLocaleString());
                }

                // Strictly sync the initial balance if it deviates significantly from the newly established true balance
                setLiveInitialBalance((prevInit) => {
                    if (prevInit === 0 || Math.abs(prevInit - newTotalValue) > newTotalValue * 2) {
                        // It's likely a leaked demo balance or a completely stale cache if it's vastly different.
                        localStorage.setItem("jdex_live_initial_balance", newTotalValue.toString());
                        return newTotalValue;
                    }

                    // Only set warning if no realistic live balance was previously tracked
                    if (usdPrice > 0 && Number(balanceData.formatted) * usdPrice < 1.0) {
                        setTimeout(() => {
                            addMessage("manager", "残高警告: ネイティブ残高 " + balanceData.formatted + " " + nativeSymbol + " は小さすぎます。DEX の最低注文やガス代不足で失敗しやすい状態です。", "ALERT");
                        }, 3000);
                    }

                    return prevInit;
                });

                return {
                    ...prev,
                    cashbalance: usdPriceTotal,
                    totalValue: newTotalValue,
                };
            });
        }
    }, [isConnected, isDemoMode, balanceData, allMarketPrices]);

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
                    const isTargetStable = TRADE_CONFIG.STABLECOINS.includes(selectedCurrency.toUpperCase());

                    // [REFINED GUARD] Autonomous execution must respect locks and cooldown
                    const now = Date.now();
                    const autonomousCooldown = 30000; // 30s cooldown for auto
                    const canExecuteAutonomous = isAutoPilotEnabled &&
                        !tradeInProgress &&
                        (now - lastTradeRef.current > autonomousCooldown);

                    if (canExecuteAutonomous && agent.id === "technical" && Math.random() > 0.8 && !isTargetStable) {
                        const action = Math.random() > 0.5 ? "BUY" : "SELL";
                        const amount = parseFloat((Math.random() * 0.5 + 0.1).toFixed(4));
                        const currentPositions = currentPortfolio.positions.length;
                        const pos = currentPortfolio.positions.find(p => p.symbol === selectedCurrency);
                        const hasInventory = action === "SELL" ? (pos && pos.amount >= amount) : true;

                        if (action === "BUY" && currentPositions < 3 && isBuyActuallyAllowed) {
                            type = "EXECUTION";
                            const jpyPrice = convertJPY(newPrice);
                            content = (action === "BUY" ? "購入" : "売却") + "シグナル: " + amount + " " + selectedCurrency + " @ ¥" + jpyPrice.toLocaleString();
                            executeTrade(selectedCurrency, action, amount, newPrice, "AI technical signal"); // Use USD price for logic
                            addMessage(agent.id, content, type);
                        } else if (action === "SELL" && hasInventory) {
                            type = "EXECUTION";
                            const jpyPrice = convertJPY(newPrice);
                            content = (action === "SELL" ? "売却" : "購入") + "シグナル: " + amount + " " + selectedCurrency + " @ ¥" + jpyPrice.toLocaleString();
                            executeTrade(selectedCurrency, action, amount, newPrice, "AI technical signal"); // Use USD price for logic
                            addMessage(agent.id, content, type);
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

                    const currentPriceJPY = convertJPY(posPrice);
                    const pnlPct = ((currentPriceJPY - pos.entryPrice) / pos.entryPrice) * 100;

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
                    const trailingThreshold = 3; // 3%
                    const highest = pos.highestPrice || posPrice;
                    if (highest > 0 && posPrice < highest * (1 - trailingThreshold / 100)) {
                        if (posPrice > pos.entryPrice * 1.02) { // Secure at least 2% profit
                            executeTrade(pos.symbol, "SELL", pos.amount, posPrice, "トレーリングストップ決済 (最高値 $" + highest.toLocaleString() + " から -" + trailingThreshold + "%)");
                            addMessage("manager", "[利益確保] " + pos.symbol + " が最高値から反落したため決済しました。", "EXECUTION");
                        }
                    }

                    // 3. Smart Stop-Loss (Emergency)
                    if (riskStatus === "CRITICAL" && pnlPct < -2) {
                        executeTrade(pos.symbol, "SELL", pos.amount, posPrice, "緊急回避: 市場リスク高騰に伴う早期損切り");
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

                if (isDemoMode || isAutoPilotEnabled) {
                    if (!isDemoMode && (!effectiveIsConnected || !effectiveAddress || !effectiveChainId)) {
                        if (isActiveRef.current) {
                            timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                        }
                        return;
                    }

                    const baseBalance = isDemoMode ? demoBalance : portfolioRef.current.cashbalance;
                    let targetSymbol = selectedCurrency;

                    const rankedCandidates = Object.keys(allMarketPrices)
                        .filter((symbol) => isInterestingToken(symbol) && !TRADE_CONFIG.STABLECOINS.includes(symbol.toUpperCase()))
                        .map((symbol) => {
                            const data = allMarketPrices[symbol] as any;
                            const change24h = Math.abs(data?.change24h || data?.price_change_percentage_24h || 0);
                            const alreadyHeld = currentPortfolio.positions.some((position) => position.symbol === symbol);
                            const selectedPenalty = symbol === selectedCurrency ? 5 : 0;
                            const heldPenalty = alreadyHeld ? 20 : 0;
                            return {
                                symbol,
                                score: change24h - heldPenalty - selectedPenalty,
                            };
                        })
                        .sort((left, right) => right.score - left.score);

                    if (!hasInitialTradeExecuted) {
                        const preferredInitialCandidate =
                            rankedCandidates.find((candidate) =>
                                candidate.symbol !== selectedCurrency &&
                                candidate.symbol !== initialTradeSymbol &&
                                !currentPortfolio.positions.some((position) => position.symbol === candidate.symbol)
                            ) ||
                            rankedCandidates.find((candidate) => candidate.symbol !== selectedCurrency) ||
                            rankedCandidates[0];

                        targetSymbol = (preferredInitialCandidate?.symbol || initialTradeSymbol || selectedCurrency) as Currency;
                        if (initialTradeSymbol !== targetSymbol) {
                            setInitialTradeSymbol(targetSymbol);
                        }
                    } else if (rankedCandidates.length > 0 && rankedCandidates[0]?.symbol) {
                        targetSymbol = rankedCandidates[0].symbol as Currency;
                    }

                    const currentTokenPrice = allMarketPrices[targetSymbol]?.price || initialData[targetSymbol]?.price || 0;
                    if (currentTokenPrice === 0) {
                        if (isActiveRef.current) timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                        return;
                    }

                    const previousPrice = priceHistory[priceHistory.length - 2]?.price || currentTokenPrice;
                    const volatility = Math.abs(currentTokenPrice - previousPrice) / currentTokenPrice;

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
                    let amountInJPY = baseBalance * (TRADE_CONFIG.MAX_TRADE_SIZE_PERCENT / 100);
                    if (volatility > 0.03) {
                        amountInJPY *= 0.5;
                    }
                    let amountToTrade = amountInJPY / currentTokenPrice;

                    if (!hasInitialTradeExecuted) {
                        shouldBuy = true;
                        if (lastInitialCandidateRef.current !== targetSymbol) {
                            lastInitialCandidateRef.current = targetSymbol;
                            addMessage(
                                "coordinator",
                                "初回候補 " + targetSymbol + ": 1分 / 3分 / 5分の短期モメンタムと 24h 変動率を確認し、買い目安 " + currentTokenPrice.toFixed(4) + " USD を基準に監視します。",
                                "SYSTEM"
                            );
                        }
                    } else {
                        const aggressiveCooldown = 5 * 60 * 1000;
                        const moderateCooldown = 15 * 60 * 1000;
                        const conservativeCooldown = 30 * 60 * 1000;
                        const now = Date.now();

                        if (demoStrategy === "AGGRESSIVE" && now - lastTradeRef.current > aggressiveCooldown) {
                            if (volatility > 0.005) {
                                shouldBuy = currentTokenPrice < previousPrice;
                                shouldSell = !shouldBuy;
                                amountInJPY = baseBalance * 0.2;
                                amountToTrade = amountInJPY / currentTokenPrice;
                            }
                        } else if (demoStrategy === "MODERATE" && now - lastTradeRef.current > moderateCooldown) {
                            if (volatility > 0.01) {
                                shouldBuy = currentTokenPrice < previousPrice;
                                shouldSell = !shouldBuy;
                            }
                        } else if (demoStrategy === "CONSERVATIVE" && now - lastTradeRef.current > conservativeCooldown) {
                            if (volatility > 0.02) {
                                shouldBuy = currentTokenPrice < previousPrice;
                                shouldSell = !shouldBuy;
                                amountInJPY = Math.min(baseBalance * 0.05, baseBalance);
                                amountToTrade = amountInJPY / currentTokenPrice;
                            }
                        }
                    }

                    if (shouldBuy && currentPortfolio.cashbalance >= amountInJPY * 1.003 && isBuyActuallyAllowed) {
                        const existingPosCount = currentPortfolio.positions.length;
                        const existingPos = currentPortfolio.positions.find(p => p.symbol === targetSymbol);
                        const totalPortfolioValue = currentPortfolio.totalValue || baseBalance;
                        const hypotheticalNewValue = (existingPos ? existingPos.amount * currentTokenPrice : 0) + amountInJPY;
                        const concentrationLimit = hasInitialTradeExecuted ? 0.4 : 0.85;

                        if (existingPosCount < 5 || existingPos) {
                            if (hypotheticalNewValue <= totalPortfolioValue * concentrationLimit) {
                                const executed = await executeTrade(
                                    targetSymbol as Currency,
                                    "BUY",
                                    amountToTrade,
                                    currentTokenPrice,
                                    demoStrategy + "戦略: 短期モメンタム買い"
                                );
                                if (executed) {
                                    lastTradeRef.current = Date.now();
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
                        const pos = currentPortfolio.positions.find(p => p.symbol === targetSymbol);
                        if (pos && pos.amount >= amountToTrade) {
                            const executed = await executeTrade(
                                targetSymbol as Currency,
                                "SELL",
                                amountToTrade,
                                currentTokenPrice,
                                demoStrategy + "戦略: リバランス売り"
                            );
                            if (executed) {
                                lastTradeRef.current = Date.now();
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
    }, [isSimulating, selectedCurrency, addMessage, isDemoMode, isAutoPilotEnabled, demoBalance, hasInitialTradeExecuted, executeTrade, demoStrategy, allowedStartTokens]);

    // Expose addDiscussion to window for background tasks (like TraderChat's auto-council)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as any).jdex_addDiscussion = addDiscussion;
            (window as any).__DIS_EXECUTE_TRADE__ = executeTrade;
            console.warn("[DEBUG] window.__DIS_EXECUTE_TRADE__ ready");
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



