/**
 * User Store - ユーザー別データ管理
 * localStorage/IndexedDB ベース。ユーザーごとに完全独立したAI状態を保持。
 */

import { UserAgentState, createInitialUserState } from "./ai-agents";

const isBrowser = typeof window !== "undefined";

export interface UserProfile {
    id: string;
    email: string;
    displayName: string;
    role: "user" | "admin";
    createdAt: number;
    lastLogin: number;
    isApproved: boolean;
    totpSecret?: string;
    isTotpEnabled: boolean;
    hasPasskey?: boolean;
    webAuthnCredentials?: any[];
    passwordHash?: string; // For server synchronization
    securitySettings?: {
        requireAllMethods: boolean;
    };
    currentWebAuthnChallenge?: string;
}

export interface StrategyPlan {
    id: string;
    userId: string;
    pair: string;
    action: "BUY" | "SELL" | "HOLD";
    entryPrice: { min: number; max: number };
    takeProfit: number;
    stopLoss: number;
    confidence: number;
    status: "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
    createdAt: number;
    completedAt?: number;
    pnl?: number;
    backtestResult?: BacktestResult;
}

export interface BacktestResult {
    id: string;
    pair: string;
    startDate: string;
    endDate: string;
    initialCapital: number;
    finalCapital: number;
    trades: number;
    winRate: number;
    maxDrawdown: number;
    sharpeRatio: number;
    chartData: { time: string; value: number }[];
}

export interface WatchlistItem {
    id: string;
    userId: string;
    pair: string;
    dexId: string;
    addedAt: number;
    alertPrice?: number;
    alertDirection?: "ABOVE" | "BELOW";
}

export interface AlertSetting {
    id: string;
    userId: string;
    type: "PRICE" | "VOLUME" | "SENTIMENT";
    pair: string;
    condition: string;
    threshold: number;
    isActive: boolean;
    createdAt: number;
    lastTriggered?: number;
}

// ========== Storage Keys ==========

const KEYS = {
    users: "jdex_users",
    currentUser: "jdex_current_user",
    agentState: (userId: string) => `jdex_agent_state_${userId}`,
    strategies: (userId: string) => `jdex_strategies_${userId}`,
    watchlist: (userId: string) => `jdex_watchlist_${userId}`,
    alerts: (userId: string) => `jdex_alerts_${userId}`,
    maintenance: "jdex_maintenance_mode",
    registrationDisabled: "jdex_registration_disabled",
    activityLog: "jdex_activity_log",
};

// ========== User Management ==========

export function getAllUsers(): UserProfile[] {
    if (!isBrowser) return [];
    try {
        const data = localStorage.getItem(KEYS.users);
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

export function saveUser(user: UserProfile): void {
    const users = getAllUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx >= 0) users[idx] = user;
    else users.push(user);
    localStorage.setItem(KEYS.users, JSON.stringify(users));
}

export function deleteUser(userId: string): void {
    const users = getAllUsers().filter(u => u.id !== userId);
    localStorage.setItem(KEYS.users, JSON.stringify(users));
    // Clean up user-specific data
    localStorage.removeItem(KEYS.agentState(userId));
    localStorage.removeItem(KEYS.strategies(userId));
    localStorage.removeItem(KEYS.watchlist(userId));
    localStorage.removeItem(KEYS.alerts(userId));
}

export function getCurrentUser(): UserProfile | null {
    try {
        const data = localStorage.getItem(KEYS.currentUser);
        return data ? JSON.parse(data) : null;
    } catch { return null; }
}

export function setCurrentUser(user: UserProfile | null): void {
    if (user) localStorage.setItem(KEYS.currentUser, JSON.stringify(user));
    else localStorage.removeItem(KEYS.currentUser);
}

export function registerUser(email: string, displayName: string, password: string): { success: boolean; user?: UserProfile; error?: string } {
    const users = getAllUsers();
    if (users.find(u => u.email === email)) {
        return { success: false, error: "このメールアドレスは既に登録されています" };
    }

    const user: UserProfile = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email,
        displayName,
        role: "user",
        createdAt: Date.now(),
        lastLogin: Date.now(),
        isApproved: false,
        isTotpEnabled: false,
        passwordHash: btoa(password), // Simple encoding for demo sync
        securitySettings: {
            requireAllMethods: false,
        },
    };

    users.push(user);
    localStorage.setItem(KEYS.users, JSON.stringify(users));

    // Store hashed password (simple hash for demo)
    // In a real app, never store passwords in localStorage. This is a demo constraint.
    localStorage.setItem(`jdex_pw_${user.id}`, btoa(password));

    return { success: true, user };
}

export function verifyUserCredential(email: string, password: string): UserProfile | null {
    const users = getAllUsers();
    const user = users.find(u => u.email === email);
    if (!user) return null;

    const inputHash = btoa(password);

    // 1. Check separate storage key (Legacy/Local-only)
    const storedPw = localStorage.getItem(`jdex_pw_${user.id}`);
    if (storedPw === inputHash) {
        return user;
    }

    // 2. Check passwordHash in user object (Synced/Restored)
    if (user.passwordHash === inputHash) {
        // Also restore the separate key for consistency
        localStorage.setItem(`jdex_pw_${user.id}`, inputHash);
        return user;
    }

    return null;
}

export function updateLocalPassword(email: string, newPassword: string): boolean {
    const users = getAllUsers();
    const user = users.find(u => u.email === email);
    if (!user) return false;

    // Update password hash
    localStorage.setItem(`jdex_pw_${user.id}`, btoa(newPassword));
    return true;
}

// ========== AI Agent State (Per-User) ==========

export function getUserAgentState(userId: string): UserAgentState {
    try {
        const data = localStorage.getItem(KEYS.agentState(userId));
        return data ? JSON.parse(data) : createInitialUserState(userId);
    } catch { return createInitialUserState(userId); }
}

export function saveUserAgentState(state: UserAgentState): void {
    localStorage.setItem(KEYS.agentState(state.userId), JSON.stringify(state));
}

// ========== Strategy Plans ==========

export function getUserStrategies(userId: string): StrategyPlan[] {
    try {
        const data = localStorage.getItem(KEYS.strategies(userId));
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

export function saveStrategy(userId: string, strategy: StrategyPlan): void {
    const strategies = getUserStrategies(userId);
    const idx = strategies.findIndex(s => s.id === strategy.id);
    if (idx >= 0) strategies[idx] = strategy;
    else strategies.push(strategy);
    localStorage.setItem(KEYS.strategies(userId), JSON.stringify(strategies));
}

export function deleteStrategy(userId: string, strategyId: string): void {
    const strategies = getUserStrategies(userId).filter(s => s.id !== strategyId);
    localStorage.setItem(KEYS.strategies(userId), JSON.stringify(strategies));
}

// ========== Watchlist ==========

export function getUserWatchlist(userId: string): WatchlistItem[] {
    try {
        const data = localStorage.getItem(KEYS.watchlist(userId));
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

export function addToWatchlist(userId: string, item: Omit<WatchlistItem, "id" | "userId" | "addedAt">): WatchlistItem {
    const watchItem: WatchlistItem = {
        ...item,
        id: `wl_${Date.now()}`,
        userId,
        addedAt: Date.now(),
    };
    const list = getUserWatchlist(userId);
    list.push(watchItem);
    localStorage.setItem(KEYS.watchlist(userId), JSON.stringify(list));
    return watchItem;
}

export function removeFromWatchlist(userId: string, itemId: string): void {
    const list = getUserWatchlist(userId).filter(w => w.id !== itemId);
    localStorage.setItem(KEYS.watchlist(userId), JSON.stringify(list));
}

// ========== Alerts ==========

export function getUserAlerts(userId: string): AlertSetting[] {
    try {
        const data = localStorage.getItem(KEYS.alerts(userId));
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

export function saveAlert(userId: string, alert: AlertSetting): void {
    const alerts = getUserAlerts(userId);
    const idx = alerts.findIndex(a => a.id === alert.id);
    if (idx >= 0) alerts[idx] = alert;
    else alerts.push(alert);
    localStorage.setItem(KEYS.alerts(userId), JSON.stringify(alerts));
}

// ========== Maintenance Mode ==========

export function isMaintenanceMode(): boolean {
    if (!isBrowser) return false;
    return localStorage.getItem(KEYS.maintenance) === "true";
}

export function setMaintenanceMode(enabled: boolean): void {
    if (!isBrowser) return;
    localStorage.setItem(KEYS.maintenance, enabled ? "true" : "false");
}

// ========== Registration Control ==========

export function isRegistrationDisabled(): boolean {
    if (!isBrowser) return false;
    return localStorage.getItem(KEYS.registrationDisabled) === "true";
}

export function setRegistrationDisabled(enabled: boolean): void {
    if (!isBrowser) return;
    localStorage.setItem(KEYS.registrationDisabled, enabled ? "true" : "false");
}

// ========== Activity Log ==========

export interface ActivityLogEntry {
    id: string;
    userId: string;
    action: string;
    details: string;
    timestamp: number;
}

export function logActivity(userId: string, action: string, details: string): void {
    try {
        const log = getActivityLog();
        log.unshift({
            id: `log_${Date.now()}`,
            userId,
            action,
            details,
            timestamp: Date.now(),
        });
        // Keep last 1000 entries
        localStorage.setItem(KEYS.activityLog, JSON.stringify(log.slice(0, 1000)));
    } catch { /* ignore storage errors */ }
}

export function getActivityLog(): ActivityLogEntry[] {
    try {
        const data = localStorage.getItem(KEYS.activityLog);
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

// ========== Backtest Generation ==========

export function generateBacktest(pair: string, action: "BUY" | "SELL", _entryPrice: number): BacktestResult {
    const days = 30;
    const chartData: { time: string; value: number }[] = [];
    let value = 10000; // Initial capital

    for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (days - i));
        const change = (Math.random() - 0.48) * value * 0.03;
        value += action === "BUY" ? change : -change;
        value = Math.max(value * 0.8, value);
        chartData.push({
            time: date.toISOString().split("T")[0],
            value: parseFloat(value.toFixed(2)),
        });
    }

    const finalValue = chartData[chartData.length - 1].value;
    const returns = chartData.map((d, i) => i === 0 ? 0 : (d.value - chartData[i - 1].value) / chartData[i - 1].value);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((a, r) => a + (r - avgReturn) ** 2, 0) / returns.length);

    return {
        id: `bt_${Date.now()}`,
        pair,
        startDate: chartData[0].time,
        endDate: chartData[chartData.length - 1].time,
        initialCapital: 10000,
        finalCapital: finalValue,
        trades: Math.floor(5 + Math.random() * 20),
        winRate: 0.45 + Math.random() * 0.2,
        maxDrawdown: -(5 + Math.random() * 15),
        sharpeRatio: stdDev > 0 ? avgReturn / stdDev : 0,
        chartData,
    };
}
