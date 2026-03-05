"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { AI_AGENTS, AIAgent, AgentMessage, generateDiscussion, DiscussionResult, normalizeToUSDTPair } from "@/lib/ai-agents";
import { BarChart3, Heart, Shield, Lightbulb, Star, AlertTriangle, Maximize2, Minimize2, Bot, CheckCircle, ShoppingCart, ArrowRightLeft, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSimulation } from "@/context/SimulationContext";
import { useAgents } from "@/context/AgentContext";
import { fetchCoinDetails, CoinDetails } from "@/lib/dex-service";

interface Props {
    pair: string;
    coinId?: string; // Optional Internal ID
    price?: number; // Optional, fetched internally if not provided
    autoStart?: boolean;
}

import { AutoTradeSimulator } from "./AutoTradeSimulator";

// ========== Framer Motion variants ==========
const idleVariants: Variants = {
    idle: {
        y: [0, -4, 0],
        transition: { duration: 2.5, repeat: Infinity, ease: "easeInOut" },
    },
};

const speakingVariants: Variants = {
    speaking: {
        scale: [1, 1.12, 1.05, 1.12, 1],
        transition: { duration: 0.6, ease: "easeOut" },
    },
};

const thinkingVariants: Variants = {
    thinking: {
        scale: [1, 1.05, 1],
        opacity: [1, 0.85, 1],
        transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
    },
};

const alertVariants: Variants = {
    alert: {
        scale: [1, 1.15, 1],
        transition: { duration: 0.3, ease: "easeOut" },
    },
};

const finalVariants: Variants = {
    final: {
        scale: [1, 1.1, 1.05],
        transition: { duration: 0.8, ease: "easeOut" },
    },
};

const messageVariants: Variants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration: 0.4, ease: "easeOut" },
    },
};

// ========== Role-specific particle icons ==========
function RoleParticles({ agentId, isActive }: { agentId: string; isActive: boolean }) {
    if (!isActive) return null;
    const particleConfig: Record<string, { icon: React.ReactNode; color: string }> = {
        technical: { icon: <BarChart3 className="w-3 h-3" />, color: "text-cyan-400" },
        sentiment: { icon: <Heart className="w-3 h-3" />, color: "text-pink-400" },
        security: { icon: <Shield className="w-3 h-3" />, color: "text-red-400" },
        fundamental: { icon: <Lightbulb className="w-3 h-3" />, color: "text-green-400" },
        coordinator: { icon: <Star className="w-3 h-3" />, color: "text-gold-400" },
    };
    const config = particleConfig[agentId] || particleConfig.coordinator;
    return (
        <>
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className={cn("absolute", config.color)}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{
                        opacity: [0, 1, 0],
                        scale: [0, 1, 0.5],
                        x: [0, (i - 1) * 20],
                        y: [0, -15 - i * 8],
                        rotate: [0, 360],
                    }}
                    transition={{
                        duration: 1.5,
                        delay: i * 0.3,
                        repeat: Infinity,
                        ease: "easeOut",
                    }}
                    style={{ top: "-4px", right: `${4 + i * 6}px` }}
                >
                    {config.icon}
                </motion.div>
            ))}
        </>
    );
}

function AlertBadge({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <motion.div
            className="absolute -top-2 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold z-10"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.3, 1], opacity: 1 }}
            transition={{ duration: 0.4 }}
        >
            !
        </motion.div>
    );
}

function GlowRing({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <motion.div
            className="absolute inset-[-4px] rounded-full border-2 border-gold-400 z-0"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
                opacity: [0, 0.8, 0.4, 0.8],
                scale: [0.9, 1.1, 1.05, 1.1],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            style={{
                boxShadow: "0 0 15px rgba(255, 215, 0, 0.4), 0 0 30px rgba(255, 215, 0, 0.2)",
            }}
        />
    );
}

function RedFlash({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <motion.div
            className="absolute inset-0 rounded-full bg-red-500/30 z-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.5, 0, 0.3, 0] }}
            transition={{ duration: 1.2, repeat: 2 }}
        />
    );
}

function GoldSparkles({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <>
            {[0, 1, 2, 3, 4].map((i) => (
                <motion.div
                    key={i}
                    className="absolute w-1 h-1 bg-gold-400 rounded-full"
                    initial={{ opacity: 0 }}
                    animate={{
                        opacity: [0, 1, 0],
                        scale: [0, 1.5, 0],
                        x: [0, Math.cos((i / 5) * Math.PI * 2) * 25],
                        y: [0, Math.sin((i / 5) * Math.PI * 2) * 25],
                    }}
                    transition={{
                        duration: 1.8,
                        delay: i * 0.2,
                        repeat: Infinity,
                        ease: "easeOut",
                    }}
                    style={{ top: "50%", left: "50%" }}
                />
            ))}
        </>
    );
}

// ========== Level Badge & Evolution Effects ==========
function LevelBadge({ level }: { level: number }) {
    if (level <= 1) return null;
    return (
        <div className="absolute -bottom-1 -right-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-white/20 z-20 shadow-lg">
            Lv.{level}
        </div>
    );
}

function EvolutionAura({ level }: { level: number }) {
    if (level < 3) return null; // Unlock visuals at Lv.3

    const isMax = level >= 5;
    const color = isMax ? "border-gold-400/50" : "border-blue-400/50";
    const particleColor = isMax ? "bg-gold-400" : "bg-blue-400";

    return (
        <motion.div
            className={cn("absolute inset-[-6px] rounded-full border z-0", color)}
            animate={{ rotate: 360, scale: [1, 1.05, 1] }}
            transition={{ rotate: { duration: isMax ? 8 : 15, repeat: Infinity, ease: "linear" }, scale: { duration: 2, repeat: Infinity } }}
        >
            <div className={cn("absolute top-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full shadow-[0_0_10px_currentColor]", particleColor)} />
            {isMax && <div className={cn("absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full shadow-[0_0_10px_currentColor]", particleColor)} />}
        </motion.div>
    );
}

// ========== Animated Agent Avatar ==========
function AnimatedAvatar({
    agent,
    state,
}: {
    agent: AIAgent;
    state: "idle" | "speaking" | "thinking" | "alert" | "final";
}) {
    const isAlert = state === "alert" && agent.id === "security";
    const isFinal = state === "final" && agent.id === "coordinator";
    const isSpeaking = state === "speaking";
    const isThinking = state === "thinking";

    const currentVariant =
        isFinal ? finalVariants : isAlert ? alertVariants : isSpeaking ? speakingVariants : isThinking ? thinkingVariants : idleVariants;
    const animateKey = isFinal ? "final" : isAlert ? "alert" : isSpeaking ? "speaking" : isThinking ? "thinking" : "idle";

    return (
        <div className="relative shrink-0">
            <EvolutionAura level={agent.level} />
            <GlowRing show={isFinal} />
            <RedFlash show={isAlert} />
            <AlertBadge show={isAlert} />
            <RoleParticles agentId={agent.id} isActive={isThinking || isSpeaking} />
            <GoldSparkles show={isFinal} />

            <motion.img
                src={agent.avatar}
                alt={agent.shortName}
                className={cn(
                    "w-10 h-10 rounded-full object-cover border-2 relative z-[1] transition-all duration-300",
                    agent.borderColor,
                    isFinal && "border-gold-400",
                    isAlert && "border-red-500",
                    isSpeaking && "scale-125 z-50",
                    agent.mood === "HAPPY" && "aura-happy",
                    agent.mood === "SERIOUS" && "aura-serious",
                    agent.mood === "ALARMED" && "aura-alarmed",
                    agent.mood === "NORMAL" && "aura-normal"
                )}
                variants={currentVariant}
                animate={animateKey}
                whileHover={{ scale: 1.2, rotate: 5 }}
                transition={{ type: "spring", stiffness: 300 }}
                onError={(e) => {
                    // Fallback to initial avatar if image fails to load
                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${agent.shortName}&background=333&color=fff`;
                }}
            />
            <LevelBadge level={agent.level} />
        </div>
    );
}

// ========== Typewriter Effect Component ==========
function TypewriterText({ text, onComplete, isLeft }: { text: string; onComplete?: () => void; isLeft?: boolean }) {
    const [displayedText, setDisplayedText] = useState("");
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (currentIndex < text.length) {
            const timeout = setTimeout(() => {
                setDisplayedText(prev => prev + text[currentIndex]);
                setCurrentIndex(prev => prev + 1);
            }, 10);
            return () => clearTimeout(timeout);
        } else {
            if (onComplete) onComplete();
        }
    }, [currentIndex, text, onComplete]);

    return (
        <div className={cn(
            "text-sm md:text-sm leading-relaxed whitespace-pre-wrap break-words inline-block text-left",
            isLeft ? "text-white" : "text-white"
        )}>
            {displayedText.split("\n").map((line, li) => (
                <p key={li} className={cn(
                    li > 0 && "mt-1",
                    line.startsWith("**") && "font-bold"
                )}>
                    {line}
                </p>
            ))}
            <span className="animate-pulse inline-block w-1.5 h-3 bg-gold-400 ml-0.5 align-middle" style={{ opacity: currentIndex < text.length ? 1 : 0 }} />
        </div>
    );
}

// ========== Information Gathering Progress Component ==========
function GatheringStep({ icon, label, active, completed }: { icon: React.ReactNode; label: string; active: boolean; completed: boolean }) {
    return (
        <motion.div
            className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-300",
                active ? "bg-gold-500/10 border border-gold-500/30" : "bg-transparent opacity-50"
            )}
            animate={active ? { x: [0, 4, 0] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
        >
            <div className={cn(
                "shrink-0 p-1.5 rounded-md",
                completed ? "bg-green-500/20 text-green-400" : active ? "bg-gold-500/20 text-gold-400" : "bg-gray-800 text-gray-500"
            )}>
                {completed ? <CheckCircle className="w-4 h-4" /> : icon}
            </div>
            <span className={cn(
                "text-xs font-medium",
                completed ? "text-green-400" : active ? "text-gold-300" : "text-gray-500"
            )}>
                {label}
            </span>
            {active && (
                <div className="flex gap-1 ml-auto">
                    {[0, 1, 2].map(i => (
                        <motion.div
                            key={i}
                            className="w-1 h-1 rounded-full bg-gold-400"
                            animate={{ opacity: [0.2, 1, 0.2] }}
                            transition={{ duration: 0.8, delay: i * 0.2, repeat: Infinity }}
                        />
                    ))}
                </div>
            )}
        </motion.div>
    );
}

// ========== Main Component ==========
export function AIDiscussionPanel({ pair, coinId: initialCoinId, price, autoStart = true }: Props) {
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [result, setResult] = useState<DiscussionResult | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [visibleCount, setVisibleCount] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const [tradeRequested, setTradeRequested] = useState(false);
    const [isGatheringData, setIsGatheringData] = useState(false);
    const [gatheringStep, setGatheringStep] = useState<number>(0);
    const [showSimulator, setShowSimulator] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [currentPrice, setCurrentPrice] = useState(price || 100);
    const [marketData, setMarketData] = useState<CoinDetails | null>(null);
    const hasStartedRef = useRef(false);

    // Track when current message finishes typing
    const [isTypingComplete, setIsTypingComplete] = useState(true);

    // Hooks
    const { addDiscussion, executeTrade, latestNews, portfolio, convertJPY } = useSimulation();
    const { agents } = useAgents();

    // Phase 3: Short-term memory key per pair
    const memoryKey = `dis_memory_${pair.replace('/', '_')}`;

    // Fetch price if not provided
    useEffect(() => {
        if (!price) {
            setCurrentPrice(Math.random() * 1000 + 100);
        } else {
            setCurrentPrice(price);
        }
    }, [price]);

    // Fetch market data on pair change
    useEffect(() => {
        const fetchMarketData = async () => {
            const symbol = pair.split("/")[0]; // e.g. "BTC" from "BTC/JPY"
            const coinId = initialCoinId || symbol;
            if (coinId) {
                try {
                    const data = await fetchCoinDetails(coinId);
                    if (data) {
                        setMarketData(data);
                        // Sync current price with real market data
                        if (data.current_price) {
                            setCurrentPrice(data.current_price);
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch coin details in panel:", e);
                }
            }
        };
        fetchMarketData();
    }, [pair, initialCoinId]);

    // Auto-start discussion on mount or pair change (wait for marketData)
    useEffect(() => {
        // Reset state when pair changes
        setMessages([]);
        setResult(null);
        setIsRunning(false);
        setActiveAgentId(null);
        setVisibleCount(0);
        setIsTypingComplete(true);
        setAgreed(false);
        setTradeRequested(false);
        hasStartedRef.current = false;

        // Note: Actual start is triggered when marketData is loaded or timeout occurs
    }, [pair]);

    // Auto-start discussion on mount
    useEffect(() => {
        // Condition: autoStart is true AND marketData is loaded AND not already running
        if (autoStart && marketData && !hasStartedRef.current && !isRunning && messages.length === 0) {
            hasStartedRef.current = true;
            startDiscussion();
        }
    }, [autoStart, marketData, isRunning, messages.length]);

    // Fallback timer removed to ensure we only start with real market data

    const startDiscussion = async () => {
        // Phase 3: Dispatch AI active event to boost ParticleBackground
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ai-activity', { detail: { active: true } }));
        }

        setIsThinking(true);
        setMessages([]);
        setResult(null);
        setActiveAgentId(null);
        setVisibleCount(0);
        setIsTypingComplete(true);
        setAgreed(false);
        setTradeRequested(false);
        setIsGatheringData(true);
        setGatheringStep(0);

        const normalizedPair = normalizeToUSDTPair(pair);
        const memoryKey = `dis_memory_${normalizedPair.replace('/', '_')}`;
        let lastDiscussionSummary: string | undefined;
        try {
            const stored = localStorage.getItem(memoryKey);
            if (stored) lastDiscussionSummary = stored;
        } catch { }

        try {
            let currentMarketData = marketData;

            // Try to fetch if missing
            if (!currentMarketData && pair) {
                const symbol = pair.split("/")[0];
                const finalCoinId = initialCoinId || symbol;
                if (finalCoinId) {
                    try {
                        currentMarketData = await fetchCoinDetails(finalCoinId);
                        if (currentMarketData) {
                            setMarketData(currentMarketData);
                            if (currentMarketData.current_price) {
                                setCurrentPrice(currentMarketData.current_price);
                            }
                        }
                    } catch (e) {
                        console.error("Failed to fetch data in startDiscussion", e);
                    }
                }
            }

            const priceToUse = currentMarketData?.current_price || currentPrice;
            const newsArray = latestNews ? [latestNews] : [];

            // --- Explicit Information Gathering Phase ---
            // Step 1: Technical Analysis
            setGatheringStep(1);
            await new Promise(r => setTimeout(r, 1000));

            // Step 2: Sentiment Analysis
            setGatheringStep(2);
            await new Promise(r => setTimeout(r, 1000));

            // Step 3: Security Audit
            setGatheringStep(3);
            await new Promise(r => setTimeout(r, 1000));

            // Step 4: Finalizing Context
            setGatheringStep(4);
            await new Promise(r => setTimeout(r, 800));

            const { messages: newMsgs, result: newResult } = await generateDiscussion(normalizedPair, priceToUse, agents, currentMarketData || undefined, newsArray);
            setIsGatheringData(false);
            setGatheringStep(0);
            setMessages(newMsgs);
            setResult(newResult);
            setIsRunning(true);
            setVisibleCount(1); // Start with first message
            setIsTypingComplete(false); // Typing starts

            // Phase 3: Save discussion summary to localStorage (short-term memory)
            if (newResult && newMsgs.length > 0) {
                const summary = `[${new Date().toLocaleTimeString()}] ${pair}分析。判定: ${newResult.action}(信頼度${newResult.confidence}%)。理由: ${newResult.reasoning?.substring(0, 200) || ''}...`;
                try { localStorage.setItem(memoryKey, summary); } catch { }
            }

            addDiscussion({
                id: `disc-${Date.now()}`,
                pair,
                messages: newMsgs.map(m => ({ agentId: m.agentId, content: m.content })),
                result: newResult ? {
                    action: newResult.action,
                    confidence: newResult.confidence,
                    reasoning: newResult.reasoning,
                    takeProfit: newResult.takeProfit,
                    stopLoss: newResult.stopLoss
                } : undefined,
                source: "dex-tracker",
                timestamp: Date.now(),
            });
        } catch (error) {
            console.error("Failed to generate discussion:", error);
        } finally {
            setIsThinking(false);
            // Phase 3: Restore normal particle activity
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('ai-activity', { detail: { active: false } }));
            }
        }
    };

    // Auto-advance logic (triggered by Typewriter completion)
    useEffect(() => {
        if (!isRunning || !isTypingComplete) return;

        if (visibleCount < messages.length) {
            // Wait a bit after typing finishes before showing next agent
            // Increased delay to allow voice to finish if it's long
            const delay = 800; // Faster transition
            const timer = setTimeout(() => {
                setVisibleCount(prev => prev + 1);
                setIsTypingComplete(false);
            }, delay);
            return () => clearTimeout(timer);
        } else {
            // Finished all messages
            const timer = setTimeout(() => {
                setIsRunning(false);
                setActiveAgentId(null);
                setIsFullscreen(true);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [isRunning, isTypingComplete, visibleCount, messages.length]);

    // Track active agent
    useEffect(() => {
        if (visibleCount > 0 && visibleCount <= messages.length) {
            const currentMsg = messages[visibleCount - 1];
            setActiveAgentId(currentMsg.agentId);
        }
    }, [visibleCount, messages]);


    // Auto-scroll (only if user hasn't scrolled up, but for now we follow user request to "maintain screen")
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth"
            });
        }
    }, [visibleCount, messages.length]);

    const getAgent = (agentId: string) => agents.find(a => a.id === agentId);

    const getAvatarState = (msg: AgentMessage, index: number): "idle" | "speaking" | "thinking" | "alert" | "final" => {
        if (msg.agentId === "coordinator" && msg.type === "PROPOSAL") return "final";
        if (msg.agentId === "security" && (msg.type === "ALERT" || msg.content.includes("⚠") || msg.content.includes("リスク"))) return "alert";
        if (msg.type === "COT") return "thinking";

        // Only the currently typing message's agent is speaking
        if (index === visibleCount - 1 && isRunning && !isTypingComplete) return "speaking";

        return "idle";
    };

    const discussionComplete = result && !isRunning && visibleCount >= messages.length;

    const handleAgree = () => {
        setAgreed(true);
    };

    const handleRequestTrade = async () => {
        if (!result || result.action === "HOLD") return;

        // Suggested amount from AI or fixed demo amount (e.g. ¥50,000)
        const proposalAmount = result.autoTradeProposal?.amount;
        const jpyPerUsd = Math.max(convertJPY(1), 1);
        const fallbackUsd = 50000 / jpyPerUsd;

        let targetValueUsd = 0;
        if (typeof proposalAmount === "number" && Number.isFinite(proposalAmount) && proposalAmount > 0) {
            if (proposalAmount <= 1) {
                targetValueUsd = portfolio.cashbalance * proposalAmount;
            } else {
                targetValueUsd = proposalAmount;
            }
        }
        if (targetValueUsd <= 0) {
            targetValueUsd = fallbackUsd;
        }

        const safeUsd = Math.max(0, Math.min(targetValueUsd, Math.max(0, portfolio.cashbalance - 0.2)));
        const amount = currentPrice > 0 ? parseFloat((safeUsd / currentPrice).toFixed(6)) : 0;
        if (amount <= 0) return;

        console.warn("[UI_TRADE_CLICK]", {
            mode: "AI-PANEL-REQUEST",
            ts: Date.now(),
            pair,
            action: result.action,
            amount,
        });

        try {
            const success = await executeTrade(
                pair.split("/")[0],
                result.action,
                amount,
                currentPrice,
                `AI評議会提案: ${result.reasoning}`
            );

            if (success) {
                setTradeRequested(true);
            } else {
                console.warn("Trade execution failed or was cancelled");
            }
        } catch (e) {
            console.error("Trade execution encountered hard error", e);
        }
    };

    return (
        <div
            className={cn(
                "flex flex-col transition-all duration-500",
                isFullscreen
                    ? "fixed inset-0 z-50 bg-[#080b10]"
                    : "bg-[#0d1117] rounded-xl border border-gold-500/10"
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gold-500/10">
                <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                        {agents.map(agent => (
                            <AnimatedAvatar
                                key={agent.id}
                                agent={agent}
                                state={activeAgentId === agent.id ? "speaking" : "idle"}
                            />
                        ))}
                    </div>
                    <div className="ml-2">
                        <h3 className="text-xs font-bold text-gold-400">🤖 AI評議会</h3>
                        <p className="text-[10px] text-gray-500">{pair} • 3ラウンド制</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isRunning && (
                        <motion.div
                            className="flex items-center gap-1 text-[10px] text-gold-400"
                            animate={{ opacity: [1, 0.4, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                        >
                            <div className="w-1.5 h-1.5 rounded-full bg-gold-400" />
                            議論中...
                        </motion.div>
                    )}
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-1 text-gray-500 hover:text-gold-400 transition-colors"
                    >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* Messages Area - Mobile Optimized */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 custom-scrollbar relative" style={{ maxHeight: isFullscreen ? "calc(100vh - 120px)" : "600px" }}>
                {!isRunning && messages.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm z-10 p-6 text-center">
                        <div className="mb-6 relative">
                            <div className="absolute inset-0 bg-gold-500/20 blur-xl rounded-full animate-pulse" />
                            <Bot className="w-16 h-16 text-gold-400 relative z-10" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">AI戦略会議を開始</h3>
                        <p className="text-gray-400 mb-6 max-w-md">
                            5体の専門AIエージェントが{pair}の市場データをリアルタイム分析し、最適なトレード戦略を立案します。
                        </p>
                        <button
                            onClick={startDiscussion}
                            disabled={isThinking}
                            className="px-8 py-3 bg-gradient-to-r from-gold-600 to-gold-400 text-black font-bold rounded-lg shadow-[0_0_20px_rgba(255,215,0,0.3)] hover:scale-105 transition-transform flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isThinking ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                    戦略構築中...
                                </>
                            ) : (
                                <>
                                    <Lightbulb className="w-5 h-5" />
                                    議論を開始する
                                </>
                            )}
                        </button>
                    </div>
                )}

                <AnimatePresence mode="popLayout">
                    {messages.map((msg, i) => {
                        // Discussion messages obey visibleCount, Chat messages are always visible
                        const isVisible = i < visibleCount;
                        if (!isVisible) return null;

                        const agent = getAgent(msg.agentId);
                        const isLeft = msg.agentId !== "coordinator";
                        const isCoordFinal = msg.agentId === "coordinator" && msg.type === "PROPOSAL";
                        const isSecAlert = msg.agentId === "security" && msg.type === "ALERT";
                        const isLatest = i === visibleCount - 1;

                        // Current animation state for avatar
                        const avatarState = (activeAgentId === msg.agentId && !isTypingComplete) ? "speaking" : "idle";

                        return (
                            <motion.div
                                key={msg.id}
                                variants={messageVariants}
                                initial="hidden"
                                animate="visible"
                                className={cn(
                                    "flex gap-2 md:gap-3 max-w-[98%] sm:max-w-[90%] md:max-w-[75%]",
                                    isLeft ? "mr-auto" : "ml-auto flex-row-reverse"
                                )}
                            >
                                <div className="shrink-0 mt-1">
                                    {agent && <AnimatedAvatar agent={agent} state={avatarState} />}
                                </div>

                                <div className={cn(
                                    "flex-1 min-w-0 flex flex-col",
                                    isLeft ? "items-start" : "items-end"
                                )}>
                                    <div className={cn(
                                        "flex items-center gap-2 mb-1",
                                        isLeft ? "flex-row" : "flex-row-reverse"
                                    )}>
                                        <span className={cn(
                                            "text-[10px] font-bold",
                                            agent?.color || "text-gold-400"
                                        )}>
                                            {agent?.shortName || "SYSTEM"}
                                        </span>
                                        {msg.round && (
                                            <span className="text-[8px] px-1 py-0.5 rounded bg-white/10 text-gray-400 font-mono">
                                                Round {msg.round}
                                            </span>
                                        )}
                                    </div>

                                    {/* Speech Bubble Style */}
                                    <div className={cn(
                                        "relative px-4 py-3 rounded-2xl shadow-lg",
                                        isLeft
                                            ? "bg-[#182533] text-white rounded-tl-none border border-white/5"
                                            : "bg-[#2b5278] text-white rounded-tr-none border border-white/5",
                                        isCoordFinal && "border-gold-500/50 shadow-[0_0_15px_rgba(255,215,0,0.2)]",
                                        isSecAlert && "border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                                    )}>
                                        {(isLatest && isRunning) ? (
                                            <TypewriterText
                                                text={msg.content}
                                                isLeft={isLeft}
                                                onComplete={() => {
                                                    setIsTypingComplete(true);
                                                }}
                                            />
                                        ) : (
                                            <div className="text-sm md:text-sm leading-relaxed whitespace-pre-wrap break-words">
                                                {msg.content.split("\n").map((line, li) => (
                                                    <p key={li} className={cn(
                                                        li > 0 && "mt-1",
                                                        line.startsWith("**") && "font-bold"
                                                    )}>
                                                        {line}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                        {/* Bubble tail (simplified) */}
                                        <div className={cn(
                                            "absolute top-0 w-3 h-3",
                                            isLeft
                                                ? "-left-1.5 bg-[#182533] [clip-path:polygon(100%_0,0_0,100%_100%)]"
                                                : "-right-1.5 bg-[#2b5278] [clip-path:polygon(0_0,100%_0,0_100%)]"
                                        )} />
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {isThinking && (
                    <div className="flex flex-col items-center justify-center p-8 space-y-6 bg-gray-900/40 rounded-xl border border-blue-500/20 animate-in fade-in zoom-in duration-300 mt-4">
                        <div className="relative">
                            <motion.div
                                className="w-16 h-16 border-t-2 border-r-2 border-gold-500 rounded-full"
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            />
                            <Bot className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-gold-400" />
                        </div>

                        <div className="w-full max-w-xs space-y-3">
                            <GatheringStep
                                icon={<BarChart3 className="w-4 h-4" />}
                                label="テクニカル分析データを取得中..."
                                active={gatheringStep === 1}
                                completed={gatheringStep > 1}
                            />
                            <GatheringStep
                                icon={<Heart className="w-4 h-4" />}
                                label="SNS・センチメントをスキャン中..."
                                active={gatheringStep === 2}
                                completed={gatheringStep > 2}
                            />
                            <GatheringStep
                                icon={<Shield className="w-4 h-4" />}
                                label="セキュリティ・リスクを検証中..."
                                active={gatheringStep === 3}
                                completed={gatheringStep > 3}
                            />
                            <GatheringStep
                                icon={<Star className="w-4 h-4" />}
                                label="全データを集計・議論を初期化..."
                                active={gatheringStep === 4}
                                completed={gatheringStep > 4}
                            />
                        </div>

                        <div className="text-center">
                            <p className="text-[10px] text-gray-500 animate-pulse">
                                {gatheringStep === 0 ? "初期化中..." : "AIエージェントが情報の整合性を確認しています"}
                            </p>
                        </div>
                    </div>
                )}

                {/* Typing indicator (Next agent preparing) */}
                {isRunning && isTypingComplete && visibleCount < messages.length && (
                    <motion.div
                        className="flex items-center gap-2 p-2 ml-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        {(() => {
                            const nextAgentId = messages[visibleCount]?.agentId;
                            const nextAgent = getAgent(nextAgentId || "");
                            return nextAgent ? (
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <img src={nextAgent.avatar} className="w-6 h-6 rounded-full opacity-50 grayscale" />
                                        <div className="absolute -bottom-1 -right-1 flex gap-0.5">
                                            {[0, 1, 2].map(i => (
                                                <motion.div
                                                    key={i}
                                                    className="w-1 h-1 rounded-full bg-gold-400"
                                                    animate={{ y: [0, -3, 0] }}
                                                    transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <span className="text-[10px] text-gray-600 italic">
                                        {nextAgent.shortName} が入力中...
                                    </span>
                                </div>
                            ) : null;
                        })()}
                    </motion.div>
                )}
            </div>

            {/* Result Summary + Action Buttons */}
            {discussionComplete && (
                <motion.div
                    className="p-3 border-t border-gold-500/10"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">最終判定</span>
                        <div className="flex items-center gap-2">
                            {result.mvpAgent && (
                                <span className="text-[10px] text-gold-400 border border-gold-500/30 px-1.5 py-0.5 rounded">
                                    🏆 MVP: {getAgent(result.mvpAgent)?.shortName}
                                </span>
                            )}
                            <span className={cn(
                                "text-xs font-bold px-2 py-0.5 rounded",
                                result.action === "BUY" ? "bg-emerald-500/20 text-emerald-400" :
                                    result.action === "SELL" ? "bg-red-500/20 text-red-400" :
                                        "bg-yellow-500/20 text-yellow-400"
                            )}>
                                {result.action}
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-1.5 bg-black/30 rounded">
                            <div className="text-[10px] text-gray-500">信頼度</div>
                            <div className="text-sm font-bold text-gold-400 font-mono">{result.confidence}%</div>
                        </div>
                        <div className="p-1.5 bg-black/30 rounded">
                            <div className="text-[10px] text-gray-500">ターゲット</div>
                            <div className="text-sm font-bold text-white font-mono">¥{Math.round(convertJPY(result.takeProfit || 0)).toLocaleString("ja-JP")}</div>
                        </div>
                        <div className="p-1.5 bg-black/30 rounded">
                            <div className="text-[10px] text-gray-500">ストップ</div>
                            <div className="text-sm font-bold text-red-400 font-mono">¥{Math.round(convertJPY(result.stopLoss || 0)).toLocaleString("ja-JP")}</div>
                        </div>
                    </div>

                    {/* Action Buttons: Agree / Request Trade */}
                    <div className="flex gap-2 mt-3 flex-wrap">
                        {!agreed && !tradeRequested ? (
                            <>
                                <motion.button
                                    onClick={handleAgree}
                                    className="flex-1 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs font-bold hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-2"
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    <CheckCircle className="w-4 h-4" />
                                    同意する
                                </motion.button>
                                {result.confidence >= 70 && (
                                    <button
                                        onClick={handleRequestTrade}
                                        disabled={tradeRequested}
                                        className={cn(
                                            "flex-1 py-2 bg-gradient-to-r from-gold-600 to-gold-400 text-black font-bold rounded-lg shadow-[0_0_15px_rgba(255,215,0,0.3)] hover:scale-105 transition-all flex items-center justify-center gap-2",
                                            tradeRequested && "opacity-50 grayscale cursor-not-allowed"
                                        )}
                                    >
                                        {tradeRequested ? <CheckCircle className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                        {tradeRequested ? "実行済み" : "戦略を自動実行"}
                                    </button>
                                )}
                                <button
                                    onClick={() => setShowSimulator(true)}
                                    className="flex-1 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg text-xs font-bold hover:bg-blue-500/20 transition-colors flex items-center justify-center gap-2"
                                >
                                    <BarChart3 className="w-4 h-4" /> シミュレーション
                                </button>
                            </>
                        ) : agreed ? (
                            <motion.div
                                className="flex-1 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs text-center font-bold flex items-center justify-center gap-2"
                                initial={{ scale: 0.95 }}
                                animate={{ scale: 1 }}
                            >
                                <CheckCircle className="w-4 h-4" />
                                分析に同意しました ✓
                            </motion.div>
                        ) : (
                            <motion.div
                                className="flex-1 py-2 bg-gold-500/10 border border-gold-500/30 text-gold-400 rounded-lg text-xs text-center font-bold flex items-center justify-center gap-2"
                                initial={{ scale: 0.95 }}
                                animate={{ scale: [1, 1.02, 1] }}
                                transition={{ duration: 1, repeat: Infinity }}
                            >
                                <ArrowRightLeft className="w-4 h-4 animate-pulse" />
                                デモ取引を実行中... ({result.action} {pair})
                            </motion.div>
                        )}
                    </div>

                    <motion.button
                        onClick={startDiscussion}
                        className="w-full mt-2 py-1.5 bg-gold-500/10 border border-gold-500/30 text-gold-400 rounded text-xs hover:bg-gold-500/20 transition-colors"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        🔄 再議論する
                    </motion.button>
                </motion.div>
            )}


            {/* Simulator Overlay */}
            {showSimulator && result?.autoTradeProposal && (
                <AutoTradeSimulator
                    marketData={marketData}
                    proposal={result.autoTradeProposal}
                    onClose={() => setShowSimulator(false)}
                />
            )}
        </div>
    );
}
