"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
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

export function SimulationProvider({ children }: { children: ReactNode }) {
    // Wagmi Connection hook
    const { isConnected, address, chainId } = useAccount();
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();
    const { sendTransactionAsync } = useSendTransaction();
    const [isAuthenticated, setIsAuthenticatedState] = useState(false);

    /**
     * ウォレット接続を監視し、接続直後にシミュレーションループを起動する。
     * isConnected が false→true に変化した瞬間のみ実行（冪等性確保）。
     */
    const prevConnectedRef = useRef<boolean>(false);
    const manualTestDoneRef = useRef<boolean>(false);
    // 一時フラグ（本番でのテスト完了後に削除する）
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

        // 実トレードを有効化
        setIsDemoMode(false);
        localStorage.removeItem("jdex_demo_mode"); // 整合性確保のため確実に削除

        console.log('[TRADE MODE]', {
            isConnected,
            demo: false,
        });

        if (!IS_PROD) {
            setIsAutoPilotEnabled(true);
        }

        // ループが未起動なら起動
        if (!isSimulating) {
            setIsSimulating(true);
        }
    }, [isConnected, isSimulating]);


    // アンマウント時・切断時のクリーンアップ
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
                id: `strat-${entry.id}`,
                agentId: "coordinator",
                title: `AI評議会提案: ${normalizedPair}`,
                description: `${normalizedPair}の分析に基づく${entry.result.action}戦略。`,
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
    const [achievements, setAchievements] = useState<Achievement[]>([]);
    const [disPoints, setDisPoints] = useState(0);
    const [leaderboard, setLeaderboard] = useState([
        { name: "Global Whale", score: 1250000, dailyProfit: 45000, dailyChange: 3.6, rank: 1 },
        { name: "AI Master", score: 854000, dailyProfit: 12000, dailyChange: 1.4, rank: 2 },
        { name: "Crypto King", score: 621000, dailyProfit: -5000, dailyChange: -0.8, rank: 3 },
        { name: "DIS Fan", score: 450000, dailyProfit: 8000, dailyChange: 1.8, rank: 4 },
        { name: "Anonymous", score: 320000, dailyProfit: 2500, dailyChange: 0.8, rank: 5 },
    ]);

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

    const startFixedDemo = (startingSymbol: string = "BNB", jpyPricePerUnit?: number) => {
        // Find matching config from TRADE_CONFIG.DEMO_FUNDS
        // Find a demo fund key that matches the requested startingSymbol
        const demoFundKey = Object.keys(TRADE_CONFIG.DEMO_FUNDS).find(key =>
            (TRADE_CONFIG.DEMO_FUNDS as any)[key].symbol === startingSymbol
        );
        const demoFundConfig = demoFundKey ? (TRADE_CONFIG.DEMO_FUNDS as any)[demoFundKey] : { symbol: startingSymbol, amount: 100 };

        const amount = demoFundConfig.amount;

        // Use passed-in market price if available, otherwise fall back to allMarketPrices
        let usdPrice: number;
        if (jpyPricePerUnit && jpyPricePerUnit > 0) {
            usdPrice = jpyPricePerUnit / 155; // Approximation to get USD value
        } else {
            const priceData = allMarketPrices[startingSymbol] || initialData[startingSymbol];
            usdPrice = priceData ? priceData.price : (TRADE_CONFIG.STABLECOINS.includes(startingSymbol) ? 1 : 0);
        }

        const totalValUSD = usdPrice * amount;
        const totalValJPY = convertJPY(totalValUSD);
        const jpyPrice = convertJPY(usdPrice);

        // Stablecoins go to cashbalance; volatile crypto goes to positions
        const isStable = TRADE_CONFIG.STABLECOINS.includes(startingSymbol);

        const initialPositions = isStable ? [] : [{
            symbol: startingSymbol,
            amount: amount,
            entryPrice: usdPrice,
            highestPrice: usdPrice
        }];

        const initialCash = isStable ? totalValUSD : 0;

        // Set Demo Mode
        setIsDemoModeState(true);
        localStorage.setItem("jdex_demo_mode", "true");

        const newPortfolio: Portfolio = {
            totalValue: totalValUSD,
            pnl24h: 0,
            cashbalance: initialCash,
            positions: initialPositions
        };

        setPortfolio(newPortfolio);
        localStorage.setItem("jdex_portfolio", JSON.stringify(newPortfolio));
        setDemoBalanceState(newPortfolio.totalValue);
        localStorage.setItem("jdex_demo_balance", newPortfolio.totalValue.toString());

        // Reset Simulation State
        setTransactions([]);
        setMessages([]);
        setTradeNotifications([]);
        setDiscussionHistory([]);
        setPriceHistory([]);

        setHasInitialTradeExecuted(true);

        // Set Allowed Start Tokens
        const tokens = TRADE_CONFIG.ALLOWED_START_FUNDS;
        setAllowedStartTokensState(tokens);
        localStorage.setItem("jdex_allowed_start_tokens", JSON.stringify(tokens));

        // Clear other persistence
        localStorage.removeItem("jdex_transactions");
        localStorage.removeItem("jdex_chat_history");
        localStorage.removeItem("jdex_price_history");

        addMessage("coordinator", `🚀 固定資産デモモードを開始しました。初期資産: ${amount} ${startingSymbol}`, "SYSTEM");

        // Sync Market Data & Selection
        setSelectedCurrency(startingSymbol as Currency);
        const priceData = allMarketPrices[startingSymbol] || initialData[startingSymbol];
        if (priceData) {
            setMarketData(prev => ({
                ...prev,
                price: priceData.price,
                volume: priceData.volume
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
        addMessage("SYSTEM", `パイプライン追加: ${newPipeline.baseToken}/${newPipeline.targetToken} (${dexs.join(", ")})`, "SYSTEM");
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
            addMessage("coordinator", `🎉 ${agent.name} がレベルアップ！ Lv.${newLevel} に到達し、新たな知見を獲得しました。`, "SYSTEM");

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

        const topics = ["市場構造の再理解", "アルゴリズムの最適化", "ナラティブの深掘り", "リスク管理モデルの更新"];
        const topic = topics[Math.floor(Math.random() * topics.length)];

        addLearningEvent({
            agentId,
            topic,
            content: news ? `${news.title} に基づき、専門領域の知識をアップデートしました。` : "非構造化データから新しいパターンを抽出しました。"
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

    // Initial fund: ¥30,000 (Demo requirement)
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
    const [hasInitialTradeExecuted, setHasInitialTradeExecuted] = useState(false);

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

    /** 通貨ペア価格取得の再開 */
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

        addMessage("manager", `学習フィードバック: ${feedback} - パラメータ自動調整完了`, "SYSTEM");
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
            addMessage("SYSTEM", "⚠️ [安全ガード] 現在取引機能はメンテナンスのため停止されています。", "ALERT");
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

        if (IS_PROD && (reason === "AI technical signal" || reason?.startsWith("IMMEDIATE_TEST_TRIGGER") || reason?.includes("戦略:"))) {
            console.log(`[SAFEGUARD] Automated trade ${action} ${tokenSymbol} blocked in Production.`);
            setTradeInProgress(false);
            return false;
        }

        if (!effectiveIsConnected && !currentDemoMode) {
            addMessage("SYSTEM", "⚠️ ウォレットが接続されていません。取引を実行するにはウォレットを接続してください。", "ALERT");
            console.log('[DEBUG] executeTrade: Stopped - Wallet not connected.');
            setTradeInProgress(false);
            return false;
        }

        const now = Date.now();
        if (now - lastTradeErrorTime.current < 5000) {
            const remaining = Math.ceil((5000 - (now - lastTradeErrorTime.current)) / 1000);
            addMessage("SYSTEM", `⚠️ クールダウン中... あと ${remaining}秒待ってください。`, "ALERT");
            setTradeInProgress(false);
            return false;
        }

        if (!currentDemoMode && effectiveAddress && effectiveChainId) {
            console.log('[DEBUG] executeTrade: Starting ParaSwap On-Chain Execution...', { tokenSymbol, action, amount, effectiveChainId, effectiveAddress });
            setTradeInProgress(true);
            try {
                if (!isSupportedChain(effectiveChainId)) {
                    throw new Error(`Chain ${effectiveChainId} is not supported by our implementation.`);
                }

                // Resolve Addresses & Decimals through Registry
                const stableSymbol = "USDT";
                const srcTokenInfo = resolveToken(action === "BUY" ? stableSymbol : tokenSymbol, effectiveChainId);
                const destTokenInfo = resolveToken(action === "BUY" ? tokenSymbol : stableSymbol, effectiveChainId);

                // Amount in Wei
                const srcAmountNumber = action === "BUY" ? (amount * price) : amount;
                const amountInWei = parseUnits(srcAmountNumber.toFixed(srcTokenInfo.decimals), srcTokenInfo.decimals).toString();

                setTradeInProgress(true);
                addMessage("SYSTEM", `🔄 ParaSwapで${action === "BUY" ? "購入" : "売却"}プロセスを開始中...`, "SYSTEM");

                console.warn("[TRADE_CALL]", {
                    chainId: effectiveChainId,
                    srcSymbol: action === "BUY" ? stableSymbol : tokenSymbol,
                    destSymbol: action === "BUY" ? tokenSymbol : stableSymbol,
                    amountWei: amountInWei,
                    fromAddress: effectiveAddress,
                    mode: currentDemoMode ? "demo" : "real",
                    auto: (reason === "AI technical signal" || reason?.includes("戦略:"))
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
                    throw new Error(`Trade API Non-JSON response (Status:${tradeRes.status}): ${tradeResText.slice(0, 200)}`);
                }

                if (!tradeRes.ok || !tradeData.ok) {
                    throw new Error(tradeData.error || `Trade API failed (Status:${tradeRes.status})`);
                }

                const txHash = tradeData.txHash;
                setLastAction(action);
                addMessage("SYSTEM", `🚀 トレード実行完了！ (Tx: ${txHash.slice(0, 10)}...)`, "SYSTEM");

                if (publicClient) {
                    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
                    if (receipt.status === 'success') {
                        addMessage("manager", `✅ ParaSwapでの取引が成功しました！`, "EXECUTION");
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
                addMessage("SYSTEM", `❌ [取引失敗] ${errorMsg}`, "ALERT");
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
        if (selectedDex.includes("Uniswap")) gasFee = 400 + Math.random() * 400; // Ethereum: ¥400-800
        else if (selectedDex.includes("PancakeSwap")) gasFee = 10 + Math.random() * 20; // BSC: ¥10-30
        else if (selectedDex.includes("QuickSwap")) gasFee = 1 + Math.random() * 5; // Polygon: ¥1-6
        else if (selectedDex.includes("SushiSwap")) gasFee = 50 + Math.random() * 50; // Mixed: ¥50-100

        const totalFee = swapFee + slippage + gasFee;

        // Effective Price for calculations (including slippage impact on price)
        const effectivePrice = action === "BUY" ? validPrice * 1.001 : validPrice * 0.999;

        if (action === "BUY") {
            if (portfolioRef.current.cashbalance < (totalValue + totalFee)) {
                addMessage("SYSTEM", `⚠️ 残高不足: 必要 ¥${(totalValue + totalFee).toLocaleString()} / 保有 ¥${portfolioRef.current.cashbalance.toLocaleString()}`, "ALERT");
                setTradeInProgress(false);
                return false;
            }
        } else {
            const pos = portfolioRef.current.positions.find(p => p.symbol === tokenSymbol);
            if (!pos || pos.amount < amount) {
                addMessage("SYSTEM", `⚠️ 保有トークン不足: ${tokenSymbol}`, "ALERT");
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
        const pairDisplay = `${tokenSymbol}/${stablePair}`;

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
            title: action === "BUY" ? "購入注文実行" : "売却注文実行",
            message: `${selectedDex} で ${amount.toFixed(4)} ${tokenSymbol} を ¥${(totalValue).toLocaleString()} で${action === "BUY" ? "購入" : "売却"}しました。 (手数料: ¥${totalFee.toFixed(0)})`,
            type: action,
            symbol: tokenSymbol,
            timestamp: Date.now(),
        };
        setTradeNotifications(prev => [notification, ...prev]);

        if (action === "SELL" && tradePnl > 0) {
            const pointsToAdd = Math.floor(tradePnl / 100);
            if (pointsToAdd > 0) {
                addDisPoints(pointsToAdd);
                addMessage("manager", `💰 利益確定ボーナス獲得: +${pointsToAdd} DISポイント`, "ALERT");
            }
            agents.forEach(a => awardExp(a.id, 50));
            updateAchievementProgress("profit-100", tradePnl);
        } else if (action === "SELL") {
            agents.forEach(a => awardExp(a.id, 10));
        } else {
            agents.forEach(a => awardExp(a.id, 5));
        }

        addMessage("manager", `[実行完了] ${action === "BUY" ? "購 入" : "売 却"}完了: ${amount} ${tokenSymbol} @ ¥${price.toLocaleString()}${action === "SELL" ? ` (損益: ¥${tradePnl.toLocaleString()})` : ""}`, "EXECUTION");
        if (isSoundEnabled) playSuccess();
        unlockAchievement("first-trade");

        setTradeInProgress(false);
        return true;
    }, [isConnected, isDemoMode, addMessage, isSoundEnabled, playTrade, playSuccess, takeProfitThreshold, agents, awardExp, updateAchievementProgress, addDisPoints, unlockAchievement]);

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

                    addMessage("SYSTEM", `戦略適応: ${updated.title} (ブロック: ${updated.durationBlock || "N/A"})`, "SYSTEM");
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
        addMessage("manager", "【デモ口座リセット】すべての取引データが初期化されました。運用資産をリセットし、接続を再開します。", "SYSTEM");
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
            setTransactions([]);
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
    }, []);

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


            // Wipe demo transaction history
            setTransactions([]);
            localStorage.removeItem("jdex_transactions");

            addMessage("manager", "✅ ウォレット接続を検知しました。デモモードを解除し、残高を同期します。", "SYSTEM");
        }
    }, [isConnected, isDemoMode, addMessage]);

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
            console.log(`[J-DEX SYNC] Symbol: ${nativeSymbol}, USD Price: ${usdPrice}, Formatted: ${balanceData.formatted}, USD Result: ${usdPriceTotal}`);

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
                            console.log(`[J-DEX] Filtering ghost position: ${symbol} (${pos.amount})`);
                            return acc;
                        }
                    }
                    const pData = allMarketPrices[pos.symbol] || initialData[pos.symbol];
                    const val = (pos.amount * (pData ? pData.price : 0));
                    return acc + val;
                }, 0);

                const newTotalValue = usdPriceTotal + trackedPositionsValue;

                if (Math.abs(newTotalValue - prev.totalValue) > 1) {
                    console.log(`[J-DEX] Portfolio Updated: USD ${newTotalValue.toLocaleString()}`);
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
                            addMessage("manager", `⚠️ [残高警告] 口座残高が極めて少額です（${balanceData.formatted} ${nativeSymbol}）。DEXの最低注文ルールやガス代不足により、リアルトレードがエラーになる可能性が高いです。最低 1 USD相当（約150円）以上の入金を推奨します。`, "ALERT");
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

            addMessage("manager", `【システム復帰】おかえりなさい！不在の${elapsedMinutes}分間の市場動向を分析し、自動トレードを同期しています...`, "SYSTEM");

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
                            id: `offline-${Date.now()}-${i}`,
                            agentId: "technical",
                            type: isWin ? "SELL" : "SELL",
                            symbol: selectedCurrency,
                            amount: 0.5,
                            price: convertJPY(marketData.price),
                            timestamp: Date.now() - (Math.random() * elapsedMs),
                            txHash: "0x_offline_processed_" + i,
                            fee: 50,
                            pnl: pnl,
                            pair: `USDT-${selectedCurrency}`
                        };
                        setTransactions(prev => [mockTx, ...prev].slice(0, 50));
                    }

                    setPortfolio(prev => ({
                        ...prev,
                        cashbalance: prev.cashbalance + pnlGained,
                        totalValue: prev.totalValue + pnlGained
                    }));

                    addMessage("manager", `不在期間の同期完了：AIが${numPotentialTrades}件の取引を処理しました。損益合計: ¥${pnlGained.toLocaleString()}`, "EXECUTION");
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
            const isBuyActuallyAllowed = isDemoMode; // Strictly disable BUY in Real Mode test phase


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
                    // Reactions to price moves
                    if (agent.id === "technical") {
                        content = `${selectedCurrency} が動きましたね。短期的には ${priceChangePct > 0 ? "上昇ウェッジ" : "サポートライン"} の攻防になりそうです。`;
                    } else if (agent.id === "sentiment") {
                        content = `${selectedCurrency} のボラティリティに反応してSNSも盛り上がってきました。ポジティブなナラティブが形成されています。`;
                    } else if (agent.id === "security") {
                        content = `急激な動きはフラッシュローン攻撃の予兆である場合もあります。コントラクトの状態に異常はありませんが、警戒が必要です。`;
                    } else if (agent.id === "fundamental") {
                        content = `価格の変動はありますが、${selectedCurrency} の本質的な価値（ユースケース）に揺るぎはありません。ホールドが賢明でしょう。`;
                    }
                } else if (Math.random() > 0.7) {
                    // "Interesting coins to trade" - Pick a random coin from allMarketPrices (Filter out stables)
                    const allSymbols = Object.keys(allMarketPrices).filter(s => isInterestingToken(s));
                    const randomCoin = allSymbols[Math.floor(Math.random() * allSymbols.length)];
                    const coinData = allMarketPrices[randomCoin] as any;

                    // Note: allMarketPrices items might be CoinDetails or simple {price, volume}
                    // Let's use current_price and price_change_percentage_24h if they exist.
                    const timeframe = ["15m", "1h", "4h"][Math.floor(Math.random() * 3)];
                    const change = coinData.price_change_percentage_24h || coinData.change24h || 0;

                    if (agent.id === "technical" && change > 5) {
                        content = `【テクニカル分析/ ${randomCoin}-JPY (${timeframe})】MACDがゴールデンクロスへ向かっています。24hで +${change.toFixed(1)}% です。押し目買いの好機。`;
                    } else if (agent.id === "sentiment" && Math.random() > 0.5) {
                        content = `【センチメント/ ${randomCoin}-JPY (${timeframe})】著名アカウントがこのペアについてポジティブな言及をしています。コミュニティの勢いが加速中。`;
                    } else if (agent.id === "fundamental" && change < -10) {
                        content = `【ファンダメンタル/ ${randomCoin}-JPY (${timeframe})】現在の急落は開発進捗に影響しません。長期的なファンダメンタルは健全、買い場と判断。`;
                    } else if (agent.id === "coordinator") {
                        content = `【戦略提案/ ${selectedCurrency}/${randomCoin}】現在の市場環境では ${selectedCurrency} 以外の ${randomCoin} ペアもチャンスがあります。分散投資を推奨。`;
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
                            content = `${action === "BUY" ? "購入実行" : "売却実行"}: ${amount} ${selectedCurrency} @ ¥${jpyPrice.toLocaleString()}`;
                            executeTrade(selectedCurrency, action, amount, newPrice, "AI technical signal"); // Use USD price for logic
                            addMessage(agent.id, content, type);
                        } else if (action === "SELL" && hasInventory) {
                            type = "EXECUTION";
                            const jpyPrice = convertJPY(newPrice);
                            content = `${action === "SELL" ? "売却実行" : "購入実行"}: ${amount} ${selectedCurrency} @ ¥${jpyPrice.toLocaleString()}`;
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
                let reactionPrefix = news.category === "REAL" ? `【⚠️ REAL-TIME NEWS from ${news.source}】` : `【Market Intelligence】`;
                if (news.impact === "BULLISH") {
                    addMessage(reactingAgent.id, `${reactionPrefix} ${news.title} - ポジティブなニュースを検知。${selectedCurrency}は上昇傾向と予測。`, "OPINION");
                } else if (news.impact === "BEARISH") {
                    addMessage(reactingAgent.id, `${reactionPrefix} ${news.title} - ネガティブなニュースを検知。警戒が必要です。`, "ALERT");
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
                        executeTrade(pos.symbol, "SELL", pos.amount, posPrice, `⚠️ ストップロス発動 (${stopLossThreshold}%)`);
                        addMessage("security", `⚠️ [緊急決済] ${pos.symbol} がストップロス（${stopLossThreshold}%）に達したため売却しました。`, "ALERT");
                    }
                    // Take Profit Check
                    else if (pnlPct >= takeProfitThreshold) {
                        executeTrade(pos.symbol, "SELL", pos.amount, posPrice, `💰 利益確定注文実行 (+${takeProfitThreshold}%)`);
                        addMessage("manager", `💰 [利確完了] ${pos.symbol} が目標利益（${takeProfitThreshold}%）に到達しました。`, "EXECUTION");
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
                            executeTrade(pos.symbol, "SELL", pos.amount, posPrice, `📉 トレーリングストップ決済 (最高値 $${highest.toLocaleString()} から -${trailingThreshold}%)`);
                            addMessage("manager", `📉 [利益確保] ${pos.symbol} が最高値から反落したため、利益確定しました。`, "EXECUTION");
                        }
                    }

                    // 3. Smart Stop-Loss (Emergency)
                    if (riskStatus === "CRITICAL" && pnlPct < -2) {
                        executeTrade(pos.symbol, "SELL", pos.amount, posPrice, `🛡️ 緊急回避: 市場リスク高騰に伴う早期損切り`);
                        addMessage("security", `🛡️ [緊急回避] 市場リスクレベル「CRITICAL」検知。${pos.symbol} を早期損切りしました。`, "ALERT");
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
                                executeTrade(topPos.symbol, "SELL", hedgeAmount, priceData.price, `🛡️ リスクヘッジ: 市場センチメント悪化に伴う資金待避`);
                            }
                        }
                    }
                }

                // 2. Fund Validation Logic (Real Wallet only)
                if (!isDemoMode && isConnected) {
                    const availableFundSymbols = currentPortfolio.positions
                        .filter(p => p.amount > 0)
                        .map(p => p.symbol);

                    const hasRequiredFunds = allowedStartTokens.some(token => availableFundSymbols.includes(token));

                    if (!hasRequiredFunds && allowedStartTokens.length > 0) {
                        // Trigger AI Warning every 30 seconds or so to not spam
                        if (Math.random() > 0.95) {
                            const warningTokenStr = allowedStartTokens.join(", ");
                            addMessage("manager", `⚠️ [Warning] ウォレット内に指定された開始資金（${warningTokenStr}）が見つかりません。自動トレードを開始するには、これらのいずれかを準備してください。`, "ALERT");
                        }
                    }
                }

                // 3. Demo/Auto Automation Logic
                if (isDemoMode || isAutoPilotEnabled) {
                    const baseBalance = isDemoMode ? demoBalance : (portfolioRef.current.cashbalance);
                    let targetSymbol = selectedCurrency;

                    // MARKET SCANNING (Multi-currency)
                    if (hasInitialTradeExecuted && Math.random() > 0.6) {
                        const otherSymbols = Object.keys(allMarketPrices).filter(s => s !== selectedCurrency && isInterestingToken(s));
                        const opportunity = otherSymbols.find(s => {
                            const p = allMarketPrices[s] as any;
                            return p && Math.abs(p.change24h || p.price_change_percentage_24h || 0) > 3;
                        });

                        if (opportunity) {
                            targetSymbol = opportunity as Currency;
                        } else {
                            if (otherSymbols.length > 0) {
                                targetSymbol = otherSymbols[Math.floor(Math.random() * otherSymbols.length)] as Currency;
                            }
                        }
                    }

                    // Strict Stablecoin Prevention during Automated Trading
                    const isTargetStable = TRADE_CONFIG.STABLECOINS.includes(targetSymbol.toUpperCase());
                    if (isTargetStable && hasInitialTradeExecuted) {
                        targetSymbol = "BNB" as Currency;
                        addMessage("manager", `🔄 ステーブルコインが選択されたため、対取引通貨を強制的に BNB に変更して取引機会を確保します。`, "SYSTEM");
                    }

                    const currentTokenPrice = allMarketPrices[targetSymbol]?.price || initialData[targetSymbol]?.price || 0;
                    if (currentTokenPrice === 0) {
                        if (isActiveRef.current) timeoutId = setTimeout(loop, Math.random() * 3000 + 1000);
                        return;
                    }

                    const volatility = Math.abs(currentTokenPrice - (priceHistory[priceHistory.length - 2]?.price || currentTokenPrice)) / currentTokenPrice;

                    // --- NEW: Regime Detection ---
                    if (priceHistory.length > 5 && targetSymbol === selectedCurrency) {
                        const startP = priceHistory[0].price;
                        const endP = priceHistory[priceHistory.length - 1].price;
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
                    // -----------------------------

                    let shouldBuy = false;
                    let shouldSell = false;

                    // Ensure we trade within our cash limits. 
                    // To prevent exceeding the 100 USDT (or whatever) starting balance, we cap amountInJPY.
                    let amountInJPY = baseBalance * (TRADE_CONFIG.MAX_TRADE_SIZE_PERCENT / 100);


                    // RISK HEDGING: Volatility scaling
                    if (volatility > 0.03) {
                        amountInJPY *= 0.5; // Reduce size by 50% in high volatility
                    }

                    let amountToTrade = amountInJPY / currentTokenPrice;

                    // STRICT INITIAL ENFORCEMENT: 
                    // If no trade has happened yet, we MUST use one of the allowed start tokens.
                    if (!hasInitialTradeExecuted) {
                        if (!allowedStartTokens.includes(targetSymbol)) {
                            // If user selected a coin not in start funds, pick one from allowed list
                            if (allowedStartTokens.length > 0) {
                                targetSymbol = allowedStartTokens[0] as Currency;
                            } else {
                                targetSymbol = "BNB" as Currency; // Default fallback
                            }
                        }
                    }

                    // Initial Trade Logic (Story-telling)
                    if (!hasInitialTradeExecuted) {
                        const isInitialSymbolStable = TRADE_CONFIG.STABLECOINS.includes(initialTradeSymbol.toUpperCase());

                        // If user chose a non-stablecoin as initial (like ETH), we buy it.
                        // If user chose a stablecoin (like USDT), we SHOULD NOT buy it because it does nothing.
                        // Instead, we just mark the trade as executed and pick a random highly volatile coin to start the story.

                        if (isInitialSymbolStable) {
                            // Skip the initial buy trade of stablecoins
                            setHasInitialTradeExecuted(true);
                            addMessage("coordinator", `🚀 シミュレーション開始: 初期資金 ${initialTradeSymbol} の運用をスタートします。`, "SYSTEM");
                        } else {
                            targetSymbol = initialTradeSymbol as Currency;
                            shouldBuy = true;
                            setHasInitialTradeExecuted(true);
                            addMessage("coordinator", `🚀 トレードを開始します。設定通貨 ${targetSymbol} のポジションを構築します。`, "SYSTEM");

                            // Multi-chain bridging simulation after 5 seconds for visual flavor
                            setTimeout(() => {
                                addMessage("security", `🌐 [Bridge] ${targetSymbol} から レイヤー2ネットワークへの資産ブリッジを検知。運用効率を最大化します。`, "OPINION");
                            }, 5000);
                        }
                    } else {
                        // --- REALISTIC FREQUENCY CHECK (Cooldown) ---
                        // Aggressive: 5 mins, Moderate: 15 mins, Conservative: 30 mins
                        const aggressiveCooldown = 5 * 60 * 1000;
                        const moderateCooldown = 15 * 60 * 1000;
                        const conservativeCooldown = 30 * 60 * 1000;

                        const now = Date.now();

                        // Standard Strategy Logic
                        if (demoStrategy === "AGGRESSIVE" && (now - lastTradeRef.current) > aggressiveCooldown) {
                            if (volatility > 0.005) {
                                if (newPrice < (priceHistory[priceHistory.length - 2]?.price || newPrice)) shouldBuy = true;
                                else shouldSell = true;
                                amountInJPY = baseBalance * 0.2;
                                amountToTrade = amountInJPY / newPrice;
                            }
                        } else if (demoStrategy === "MODERATE" && (now - lastTradeRef.current) > moderateCooldown) {
                            if (volatility > 0.01) {
                                if (newPrice < (priceHistory[priceHistory.length - 2]?.price || newPrice)) shouldBuy = true;
                                else shouldSell = true;
                            }
                        } else if (demoStrategy === "CONSERVATIVE" && (now - lastTradeRef.current) > conservativeCooldown) { // CONSERVATIVE
                            if (volatility > 0.02) {
                                if (newPrice < (priceHistory[priceHistory.length - 2]?.price || newPrice)) shouldBuy = true;
                                else shouldSell = true;
                                amountInJPY = Math.min(baseBalance * 0.05, baseBalance);
                                amountToTrade = amountInJPY / newPrice;
                            }
                        }
                    }


                    if (shouldBuy && currentPortfolio.cashbalance >= (amountInJPY + (amountInJPY * 0.003)) && isBuyActuallyAllowed) {
                        // CONCENTRATION LIMIT & POSITION COUNT CHECK
                        const existingPosCount = currentPortfolio.positions.length;
                        const existingPos = currentPortfolio.positions.find(p => p.symbol === targetSymbol);
                        const totalPortfolioValue = currentPortfolio.totalValue || baseBalance;
                        const hypotheticalNewValue = (existingPos ? existingPos.amount * currentTokenPrice : 0) + amountInJPY;

                        if (existingPosCount < 5 || existingPos) {
                            if (hypotheticalNewValue <= totalPortfolioValue * 0.4) {
                                executeTrade(targetSymbol as Currency, "BUY", amountToTrade, currentTokenPrice, `${demoStrategy}戦略: 分散投資実行`);
                                lastTradeRef.current = Date.now();
                            } else {
                                if (Math.random() > 0.95) {
                                    addMessage("manager", `⚠️ [資金集中警告] ${targetSymbol} の保有比率が 40% を超えるため、購入を制限しました。`, "ALERT");
                                }
                            }
                        } else {
                            if (Math.random() > 0.95) {
                                addMessage("manager", `⚠️ [分散制限] 最大保有銘柄数（5）に達しています。新規銘柄の追加を控えます。`, "ALERT");
                            }
                        }

                    } else if (shouldSell) {
                        const pos = currentPortfolio.positions.find(p => p.symbol === targetSymbol);
                        if (pos && pos.amount >= (amountToTrade)) {
                            executeTrade(targetSymbol as Currency, "SELL", amountToTrade, currentTokenPrice, `${demoStrategy}戦略: リバランス売却`);
                            lastTradeRef.current = Date.now();
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
        if (IS_PROD) return; // Productionでは完全停止

        // shouldFireOnceRef が true の場合のみ、接続直後に SELL をトリガーする
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
