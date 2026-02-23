"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

/**
 * [IMPORTANT] This file MUST NOT call external market data providers directly.
 * All FX rates should come from internal /api/market/dashboard or be hardcoded.
 */

type CurrencyCode = "USD" | "JPY";

interface CurrencyContextType {
    currency: CurrencyCode;
    setCurrency: (code: CurrencyCode) => void;
    jpyRate: number;
    formatPrice: (usdPrice: number) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const JPY_RATE_LS = "jdex_jpy_rate";
const STORAGE_KEY = "jdex_currency_pref";

export const CurrencyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
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
        const interval = setInterval(syncJpyRate, 600000); // Sync every 10 mins
        return () => clearInterval(interval);
    }, [syncJpyRate]);

    const setCurrency = (code: CurrencyCode) => {
        setCurrencyState(code);
        localStorage.setItem(STORAGE_KEY, code);
    };

    const formatPrice = (usdPrice: number) => {
        if (currency === "JPY") {
            const jpyPrice = usdPrice * jpyRate;
            if (jpyPrice < 1) {
                return `¥${jpyPrice.toLocaleString("ja-JP", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
            }
            return `¥${Math.round(jpyPrice).toLocaleString("ja-JP")}`;
        } else {
            if (usdPrice < 1) {
                return `$${usdPrice.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
            }
            return `$${usdPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
    };

    return (
        <CurrencyContext.Provider value={{ currency, setCurrency, jpyRate, formatPrice }}>
            {children}
        </CurrencyContext.Provider>
    );
};

export const useCurrency = () => {
    const ctx = useContext(CurrencyContext);
    if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
    return ctx;
}
