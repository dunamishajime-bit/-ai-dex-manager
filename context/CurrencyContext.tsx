"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

type CurrencyCode = "USD" | "JPY";

interface CurrencyContextType {
    currency: CurrencyCode;
    setCurrency: (code: CurrencyCode) => void;
    jpyRate: number;
    setJpyRate: (rate: number) => void;
    symbol: string;
    toggleCurrency: () => void;
    formatPrice: (usdPrice: number | null | undefined) => string;
    formatLarge: (usdValue: number | null | undefined) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const JPY_RATE_LS = "jdex_jpy_rate";
const STORAGE_KEY = "jdex_currency_pref";

export const CurrencyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
        if (typeof window === "undefined") return "JPY";
        const stored = localStorage.getItem(STORAGE_KEY);
        return (stored as CurrencyCode) || "JPY";
    });

    const [jpyRate, setJpyRate] = useState<number>(() => {
        if (typeof window === "undefined") return 150;
        return parseFloat(localStorage.getItem(JPY_RATE_LS) || "150");
    });

    const syncJpyRate = useCallback(async () => {
        try {
            const response = await fetch("/api/market/dashboard");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const payload = await response.json();
            if (payload.ok && payload.fxRate) {
                const nextRate = Number(payload.fxRate);
                setJpyRate(nextRate);
                localStorage.setItem(JPY_RATE_LS, String(nextRate));
            }
        } catch (error) {
            console.warn("[CurrencyContext] Failed to sync JPY rate from dashboard, using fallback:", error);
        }
    }, []);

    useEffect(() => {
        syncJpyRate();
        const interval = setInterval(syncJpyRate, 600_000);
        return () => clearInterval(interval);
    }, [syncJpyRate]);

    const setCurrency = (code: CurrencyCode) => {
        setCurrencyState(code);
        localStorage.setItem(STORAGE_KEY, code);
    };

    const toggleCurrency = () => {
        setCurrency(currency === "USD" ? "JPY" : "USD");
    };

    const symbol = currency === "JPY" ? "¥" : "$";

    const formatPrice = (usdPrice: number | null | undefined) => {
        const safeUsdPrice = Number(usdPrice);
        if (!Number.isFinite(safeUsdPrice)) {
            return currency === "JPY" ? "¥-" : "$-";
        }

        if (currency === "JPY") {
            const jpyPrice = safeUsdPrice * jpyRate;
            if (jpyPrice < 1) {
                return `¥${jpyPrice.toLocaleString("ja-JP", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
            }
            return `¥${Math.round(jpyPrice).toLocaleString("ja-JP")}`;
        }

        if (safeUsdPrice < 1) {
            return `$${safeUsdPrice.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
        }

        return `$${safeUsdPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatLarge = (usdValue: number | null | undefined) => {
        const safeUsdValue = Number(usdValue);
        if (!Number.isFinite(safeUsdValue)) {
            return currency === "JPY" ? "¥-" : "$-";
        }

        const convertedValue = currency === "JPY" ? safeUsdValue * jpyRate : safeUsdValue;
        const prefix = currency === "JPY" ? "¥" : "$";

        if (convertedValue >= 1e12) return `${prefix}${(convertedValue / 1e12).toFixed(2)}T`;
        if (convertedValue >= 1e9) return `${prefix}${(convertedValue / 1e9).toFixed(2)}B`;
        if (convertedValue >= 1e6) return `${prefix}${(convertedValue / 1e6).toFixed(2)}M`;
        return `${prefix}${convertedValue.toLocaleString()}`;
    };

    return (
        <CurrencyContext.Provider
            value={{
                currency,
                setCurrency,
                toggleCurrency,
                jpyRate,
                setJpyRate,
                symbol,
                formatPrice,
                formatLarge,
            }}
        >
            {children}
        </CurrencyContext.Provider>
    );
};

export const useCurrency = () => {
    const ctx = useContext(CurrencyContext);
    if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
    return ctx;
};
