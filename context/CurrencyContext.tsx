"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

/**
 * [IMPORTANT] This file MUST NOT call external market data providers directly.
 * All FX rates should come from internal /api/market/dashboard or be hardcoded.
 */

export type CurrencyCode = "USD" | "JPY";

interface CurrencyContextValue {
    currency: CurrencyCode;
    toggleCurrency: () => void;
    jpyRate: number;
    setJpyRate: (rate: number) => void;
    formatPrice: (usdValue: number) => string;
    formatLarge: (usdValue: number) => string;
    symbol: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const STORAGE_KEY = "disdex_currency";
const JPY_RATE_LS = "disdex_jpy_rate";

export function CurrencyProvider({ children }: { children: ReactNode }) {
    const [currency, setCurrency] = useState<CurrencyCode>(() => {
        if (typeof window === "undefined") return "JPY";
        const stored = localStorage.getItem(STORAGE_KEY);
        // Default to JPY for this platform
        return (stored as CurrencyCode) || "JPY";
    });

    const [jpyRate, setJpyRate] = useState<number>(() => {
        if (typeof window === "undefined") return 150;
        return parseFloat(localStorage.getItem(JPY_RATE_LS) || "150");
    });

    // Sync JPY rate from Dashboard API (Internal source ONLY)
    // No external direct API calls allowed here.
    const syncJpyRate = useCallback(async () => {
        try {
            console.log("[CurrencyContext] Syncing JPY rate via internal dashboard...");
            const res = await fetch("/api/market/dashboard");
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

            const data = await res.json();
            if (data.ok && data.fxRate) {
                const newRate = Number(data.fxRate);
                setJpyRate(newRate);
                localStorage.setItem(JPY_RATE_LS, String(newRate));
            }
        } catch (err) {
            console.warn("[CurrencyContext] Failed to sync JPY rate from dashboard, using fallback:", err);
            // Keeping current rate or default 150
        }
    }, []);

    useEffect(() => {
        syncJpyRate();
        const interval = setInterval(syncJpyRate, 10 * 60 * 1000); // Sync every 10 mins
        return () => clearInterval(interval);
    }, [syncJpyRate]);

    const toggleCurrency = useCallback(() => {
        setCurrency(prev => {
            const next = prev === "USD" ? "JPY" : "USD";
            localStorage.setItem(STORAGE_KEY, next);
            return next;
        });
    }, []);

    const formatPrice = useCallback((usdValue: number): string => {
        if (!isFinite(usdValue)) return currency === "JPY" ? "¥0" : "$0";
        if (currency === "JPY") {
            const jpy = usdValue * jpyRate;
            if (jpy < 1) return `¥${jpy.toLocaleString("ja-JP", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
            return `¥${jpy.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}`;
        }
        if (usdValue < 0.001) return `$${usdValue.toFixed(8)}`;
        if (usdValue < 1) return `$${usdValue.toFixed(6)}`;
        return `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }, [currency, jpyRate]);

    const formatLarge = useCallback((usdValue: number): string => {
        if (!isFinite(usdValue)) return currency === "JPY" ? "¥0" : "$0";
        const value = currency === "JPY" ? usdValue * jpyRate : usdValue;
        const sym = currency === "JPY" ? "¥" : "$";
        if (value >= 1e12) return `${sym}${(value / 1e12).toFixed(2)}T`;
        if (value >= 1e9) return `${sym}${(value / 1e9).toFixed(2)}B`;
        if (value >= 1e6) return `${sym}${(value / 1e6).toFixed(1)}M`;
        if (value >= 1e3) return `${sym}${(value / 1e3).toFixed(1)}K`;
        return `${sym}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }, [currency, jpyRate]);

    const symbol = currency === "JPY" ? "¥" : "$";

    return (
        <CurrencyContext.Provider value={{ currency, toggleCurrency, jpyRate, setJpyRate, formatPrice, formatLarge, symbol }}>
            {children}
        </CurrencyContext.Provider>
    );
}

export function useCurrency(): CurrencyContextValue {
    const ctx = useContext(CurrencyContext);
    if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
    return ctx;
}
