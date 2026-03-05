"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
    const [latestMessage, setLatestMessage] = useState<{ agentId: string; text: string; timestamp: number } | null>(null);
    const [isCouncilActive, setIsCouncilActive] = useState(false);
    const [learningEvents, setLearningEvents] = useState<LearningEvent[]>([]);

    useEffect(() => {
        const stored = localStorage.getItem("jdex_agents");
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                const merged = AI_AGENTS.map((defaultAgent) => {
                    const found = parsed.find((entry: AIAgent) => entry.id === defaultAgent.id);
                    return found ? { ...defaultAgent, ...found } : defaultAgent;
                });
                setAgents(merged);
            } catch (error) {
                console.error("Failed to parse stored agents", error);
            }
        }
        setIsLoaded(true);
    }, []);

    const updateAgent = (id: string, updates: Partial<AIAgent>) => {
        setAgents((prev) => {
            const next = prev.map((agent) => (agent.id === id ? { ...agent, ...updates } : agent));
            localStorage.setItem("jdex_agents", JSON.stringify(next));
            return next;
        });
    };

    const resetAgents = () => {
        setAgents(AI_AGENTS);
        localStorage.removeItem("jdex_agents");
    };

    const getAgent = (id: string) => agents.find((agent) => agent.id === id);

    const addLearningEvent = (event: Omit<LearningEvent, "id" | "timestamp">) => {
        const newEvent: LearningEvent = {
            ...event,
            id: `learn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
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

            setLatestMessage({
                agentId: "coordinator",
                text: `${agent.name} updated its analysis profile based on the latest market information.`,
                timestamp: Date.now(),
            });
        } catch (error) {
            console.error("Evolution failed", error);
        }
    };

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
