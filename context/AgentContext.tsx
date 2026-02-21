"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
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

    // Initialize from localStorage
    useEffect(() => {
        const stored = localStorage.getItem("jdex_agents");
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Merge with default ensuring new fields/agents are handled if structure changes
                // For now, simple replacement, but fallback to ID matching is safer
                const merged = AI_AGENTS.map(defaultAgent => {
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
        setAgents(prev => {
            const newAgents = prev.map(agent =>
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

    const getAgent = (id: string) => agents.find(a => a.id === id);

    // Autonomous Chat Logic hooks (Must be before any conditional return)
    const [latestMessage, setLatestMessage] = useState<{ agentId: string; text: string; timestamp: number } | null>(null);
    const [isCouncilActive, setIsCouncilActive] = useState(false);
    const [learningEvents, setLearningEvents] = useState<LearningEvent[]>([]);

    const addLearningEvent = (event: Omit<LearningEvent, "id" | "timestamp">) => {
        const newEvent = {
            ...event,
            id: `learn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now()
        };
        setLearningEvents(prev => [newEvent, ...prev].slice(0, 50)); // Keep last 50

        // Also update agent's knowledge
        updateAgent(event.agentId, {
            knowledge: [
                ...(getAgent(event.agentId)?.knowledge || []),
                {
                    id: newEvent.id,
                    topic: event.topic,
                    content: event.content,
                    timestamp: newEvent.timestamp,
                    importance: 5
                }
            ].slice(-10) // Keep last 10 knowledge items per agent
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
                rolePrompt: result.rolePrompt
            });

            // The notification will be handled by SimulationContext or here
            setLatestMessage({
                agentId: "coordinator",
                text: `[進化したAI] ${agent.name}が最新情報を学び、能力が強化されました: ${result.evolutionMessage}`,
                timestamp: Date.now()
            });

        } catch (e) {
            console.error("Evolution failed", e);
        }
    };

    useEffect(() => {
        if (!isLoaded) return;

        // Skip welcome and auto-chat if Council is active
        if (isCouncilActive) return;

        // Initial welcome message (only if not active)
        const welcomeTimer = setTimeout(() => {
            if (!isCouncilActive) {
                setLatestMessage({
                    agentId: "coordinator",
                    text: "DIS-DEXへようこそ。市場の監視を開始します。",
                    timestamp: Date.now()
                });
            }
        }, 2000);

        // Auto-chat loop
        const intervalId = setInterval(async () => {
            if (isCouncilActive) return; // Don't chat during council
            try {
                const { generateIdleChat } = await import("@/lib/gemini-service");
                const result = await generateIdleChat(agents);
                setLatestMessage({
                    agentId: result.agentId,
                    text: result.text,
                    timestamp: Date.now()
                });

                // Random learning event simulation (10% chance)
                if (Math.random() > 0.9) {
                    const topics = ["MACDゴールデンクロス", "SNSセンチメント急騰", "ラグプル危機の回避", "長期ファンダメンタル指標"];
                    const randomTopic = topics[Math.floor(Math.random() * topics.length)];
                    addLearningEvent({
                        agentId: result.agentId,
                        topic: randomTopic,
                        content: `市場の特定の挙動から、新しい${randomTopic}のパターンを学習しました。今後の提案に反映します。`
                    });
                }
            } catch (e) {
                console.error("Auto chat error", e);
            }
        }, 45000);

        return () => {
            clearTimeout(welcomeTimer);
            clearInterval(intervalId);
        };
    }, [isLoaded, agents, isCouncilActive]);

    if (!isLoaded) {
        return null; // Hook calling order is now safe
    }

    return (
        <AgentContext.Provider value={{
            agents, updateAgent, resetAgents, getAgent, latestMessage, isCouncilActive, setIsCouncilActive,
            learningEvents, addLearningEvent, evolveAgent
        }}>
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
