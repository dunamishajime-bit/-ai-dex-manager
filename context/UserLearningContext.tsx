"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { UserAgentState, createInitialUserState } from "@/lib/ai-agents";
import { updateUserInsights } from "@/lib/gemini-service";

interface UserLearningContextType {
    userState: UserAgentState;
    addInteraction: (role: "user" | "assistant", content: string, agentId?: string) => Promise<void>;
    updateUserTraits: (updates: Partial<UserAgentState["traits"]>) => void;
    updatePreferences: (updates: Partial<UserAgentState["preferences"]>) => void;
    resetLearning: () => void;
    clearChatHistory: () => void;
}

const UserLearningContext = createContext<UserLearningContextType | undefined>(undefined);

export function UserLearningProvider({ children }: { children: ReactNode }) {
    const [userState, setUserState] = useState<UserAgentState>(() => {
        // Initial state or load from localStorage
        return createInitialUserState("user-1", "ゲストユーザー");
    });
    const [userId, setUserId] = useState("user-1");
    const [isLoaded, setIsLoaded] = useState(false);

    // Initialize from server/localStorage
    useEffect(() => {
        let activeUserId = "user-1";
        const currentUserData = localStorage.getItem("jdex_current_user");
        if (currentUserData) {
            try {
                const parsed = JSON.parse(currentUserData);
                if (parsed && parsed.id) {
                    activeUserId = parsed.id;
                }
            } catch (e) { }
        }
        setUserId(activeUserId);

        const loadState = async () => {
            // 1. Try to fetch from server first
            try {
                const res = await fetch(`/api/user/agent-state?userId=${activeUserId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.state) {
                        setUserState(data.state);
                        localStorage.setItem("jdex_user_learning", JSON.stringify(data.state));
                        setIsLoaded(true);
                        return;
                    }
                }
            } catch (e) {
                console.warn("Failed to sync from server, falling back to local storage");
            }

            // 2. Fallback to localStorage if server fails or returns null
            const stored = localStorage.getItem("jdex_user_learning");
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    setUserState({ ...parsed, userId: activeUserId });
                } catch (e) {
                    console.error("Failed to parse user learning data", e);
                }
            } else {
                setUserState(createInitialUserState(activeUserId, "ゲストユーザー"));
            }
            setIsLoaded(true);
        };

        loadState();
    }, []);

    // Save to localStorage and Server whenever state changes
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem("jdex_user_learning", JSON.stringify(userState));
            // Sync to server
            fetch('/api/user/agent-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: userState.userId || userId, state: userState })
            }).catch(e => console.error("Failed to sync agent state to server:", e));
        }
    }, [userState, isLoaded, userId]);

    const addInteraction = async (role: "user" | "assistant", content: string, agentId?: string) => {
        const newMessage = {
            role,
            content,
            agentId,
            timestamp: Date.now()
        };

        setUserState(prev => {
            const newState = {
                ...prev,
                interactionHistory: [...prev.interactionHistory, newMessage].slice(-50), // Keep last 50
                lastUpdated: Date.now()
            };
            return newState;
        });

        // If it's an assistant response, trigger insight update
        if (role === "assistant") {
            // Find last user message FROM STORED STATE (prev) for accuracy
            const lastUserMsg = [...userState.interactionHistory, newMessage]
                .filter(m => m.role === "user")
                .slice(-1)[0]?.content;

            if (lastUserMsg) {
                try {
                    const insights = await updateUserInsights(lastUserMsg, content, userState);
                    if (Object.keys(insights).length > 0) {
                        setUserState(prev => ({
                            ...prev,
                            traits: { ...prev.traits, ...insights.traits },
                            preferences: { ...prev.preferences, ...insights.preferences },
                            lastUpdated: Date.now()
                        }));
                    }
                } catch (e) {
                    console.error("Failed to update insights", e);
                }
            }
        }
    };

    const updateUserTraits = (updates: Partial<UserAgentState["traits"]>) => {
        setUserState(prev => ({
            ...prev,
            traits: { ...prev.traits, ...updates },
            lastUpdated: Date.now()
        }));
    };

    const updatePreferences = (updates: Partial<UserAgentState["preferences"]>) => {
        setUserState(prev => ({
            ...prev,
            preferences: { ...prev.preferences, ...updates },
            lastUpdated: Date.now()
        }));
    };

    const resetLearning = () => {
        const initialState = createInitialUserState("user-1", "ゲストユーザー");
        setUserState(initialState);
        localStorage.removeItem("jdex_user_learning");
    };

    const clearChatHistory = () => {
        setUserState(prev => ({
            ...prev,
            interactionHistory: [],
            lastUpdated: Date.now()
        }));
    };

    if (!isLoaded) return null;

    return (
        <UserLearningContext.Provider value={{ userState, addInteraction, updateUserTraits, updatePreferences, resetLearning, clearChatHistory }}>
            {children}
        </UserLearningContext.Provider>
    );
}

export function useUserLearning() {
    const context = useContext(UserLearningContext);
    if (context === undefined) {
        throw new Error("useUserLearning must be used within a UserLearningProvider");
    }
    return context;
}
