// AUTO_CONTINUE: enabled
"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { AIAgent, AI_AGENTS } from "@/lib/ai-agents";

export interface LearningEvent {
    id: string;
    agentId: string;
    topic: string;
    content: string;
    timestamp: number;
}

interface AgentContextType {
    agents: AIAgent[];
    updateAgent: (id: string, updates: Partial<AIAgent>) => void;
    resetAgents: () => void;
    getAgent: (id: string) => AIAgent | undefined;
    latestMessage: { agentId: string; text: string; timestamp: number } | null;
    pushLiveMessage: (agentId: string, text: string) => void;
    isCouncilActive: boolean;
    setIsCouncilActive: (active: boolean) => void;
    learningEvents: LearningEvent[];
    addLearningEvent: (event: Omit<LearningEvent, "id" | "timestamp">) => void;
    evolveAgent: (id: string, latestNews: any[]) => Promise<void>;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export function AgentProvider({ children }: { children: ReactNode }) {
    const [agents, setAgents] = useState<AIAgent[]>(AI_AGENTS);
    const [isLoaded, setIsLoaded] = useState(false);
    const [latestMessage, setLatestMessage] = useState<{ agentId: string; text: string; timestamp: number } | null>(null);
    const [isCouncilActive, setIsCouncilActive] = useState(false);
    const [learningEvents, setLearningEvents] = useState<LearningEvent[]>([]);

    const lastExternalMessageAtRef = useRef(0);
    const lastInsightNoticeAtRef = useRef(0);

    useEffect(() => {
        const stored = localStorage.getItem("jdex_agents");
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                const merged = AI_AGENTS.map((defaultAgent) => {
                    const found = parsed.find((p: AIAgent) => p.id === defaultAgent.id);
                    return found ? { ...defaultAgent, ...found } : defaultAgent;
                });
                setAgents(merged);
            } catch (e) {
                console.error("Failed to parse stored agents", e);
            }
        }
        setIsLoaded(true);
    }, []);

    const updateAgent = (id: string, updates: Partial<AIAgent>) => {
        setAgents((prev) => {
            const newAgents = prev.map((agent) =>
                agent.id === id ? { ...agent, ...updates } : agent
            );
            localStorage.setItem("jdex_agents", JSON.stringify(newAgents));
            return newAgents;
        });
    };

    const resetAgents = () => {
        setAgents(AI_AGENTS);
        localStorage.removeItem("jdex_agents");
    };

    const getAgent = (id: string) => agents.find((a) => a.id === id);

    const pushLiveMessage = (agentId: string, text: string) => {
        lastExternalMessageAtRef.current = Date.now();
        setLatestMessage({
            agentId,
            text,
            timestamp: Date.now(),
        });
    };

    const addLearningEvent = (event: Omit<LearningEvent, "id" | "timestamp">) => {
        const newEvent = {
            ...event,
            id: `learn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
        };
        setLearningEvents((prev) => [newEvent, ...prev].slice(0, 50));

        updateAgent(event.agentId, {
            knowledge: [
                ...(getAgent(event.agentId)?.knowledge || []),
                {
                    id: newEvent.id,
                    topic: event.topic,
                    content: event.content,
                    timestamp: newEvent.timestamp,
                    importance: 5,
                },
            ].slice(-10),
        });
    };

    const evolveAgent = async (id: string, latestNews: any[]) => {
        const agent = getAgent(id);
        if (!agent) return;

        try {
            const { evolveAgent: evolveAgentService } = await import("@/lib/gemini-service");
            const result = await evolveAgentService(agent, latestNews, agent.knowledge);

            updateAgent(id, {
                personality: result.personality,
                personalityMatrix: result.personalityMatrix,
                rolePrompt: result.rolePrompt,
            });

            const now = Date.now();
            if (now - lastInsightNoticeAtRef.current > 30 * 60 * 1000) {
                lastInsightNoticeAtRef.current = now;
                setLatestMessage({
                    agentId: "coordinator",
                    text: `重要な学習更新: ${agent.name} が分析モデルを再調整しました。`,
                    timestamp: now,
                });
            }
        } catch (e) {
            console.error("Evolution failed", e);
        }
    };

    useEffect(() => {
        if (!isLoaded) return;
        if (isCouncilActive) return;

        const welcomeTimer = setTimeout(() => {
            if (!isCouncilActive) {
                setLatestMessage({
                    agentId: "coordinator",
                    text: "AI LIVEを開始します。重要な市場変化と執行イベントのみ通知します。",
                    timestamp: Date.now(),
                });
            }
        }, 3000);

        const intervalId = setInterval(() => {
            if (isCouncilActive) return;

            const now = Date.now();
            if (now - lastExternalMessageAtRef.current < 120 * 1000) return;

            let focusPair = "複数候補";
            try {
                const runtimeFocusPair = localStorage.getItem("jdex_auto_focus_pair");
                if (runtimeFocusPair) {
                    focusPair = runtimeFocusPair;
                }
                const raw = localStorage.getItem("jdex_pipelines");
                if (!runtimeFocusPair && raw) {
                    const pipelines = JSON.parse(raw) as Array<{ isActive?: boolean; baseToken?: string; targetToken?: string }>;
                    const active = pipelines.find((p) => p.isActive && p.baseToken && p.targetToken);
                    if (active) focusPair = `${String(active.baseToken).toUpperCase()}/${String(active.targetToken).toUpperCase()}`;
                }
            } catch {
                // no-op
            }

            let tradeCount = 0;
            let winRate = 0.5;
            try {
                const lp = localStorage.getItem("jdex_learning_params");
                if (lp) {
                    const parsed = JSON.parse(lp) as { totalTrades?: number; winRate?: number };
                    tradeCount = Number(parsed.totalTrades || 0);
                    winRate = Number(parsed.winRate || 0.5);
                }
            } catch {
                // no-op
            }

            const msgPool = [
                `監視中ペア ${focusPair}: 直近ノイズを除外し、次の高確度シグナル待機中。`,
                `執行優先度: ${focusPair}。手数料を上回る期待純益の条件を満たした場合のみ発注。`,
                `学習統計: totalTrades=${tradeCount}, winRate=${(winRate * 100).toFixed(1)}%。低品質シグナルは除外中。`,
                `リスク管理: ${focusPair} のサイズを分割し、急変時の逆行リスクを抑制。`,
            ];
            const agentOrder = ["coordinator", "technical", "security", "fundamental"] as const;
            const idx = Math.floor(now / (3 * 60 * 1000)) % msgPool.length;

            setLatestMessage({
                agentId: agentOrder[idx % agentOrder.length],
                text: msgPool[idx],
                timestamp: now,
            });
        }, 3 * 60 * 1000);

        return () => {
            clearTimeout(welcomeTimer);
            clearInterval(intervalId);
        };
    }, [isLoaded, isCouncilActive]);

    if (!isLoaded) {
        return null;
    }

    return (
        <AgentContext.Provider
            value={{
                agents,
                updateAgent,
                resetAgents,
                getAgent,
                latestMessage,
                pushLiveMessage,
                isCouncilActive,
                setIsCouncilActive,
                learningEvents,
                addLearningEvent,
                evolveAgent,
            }}
        >
            {children}
        </AgentContext.Provider>
    );
}

export function useAgents() {
    const context = useContext(AgentContext);
    if (context === undefined) {
        throw new Error("useAgents must be used within an AgentProvider");
    }
    return context;
}
