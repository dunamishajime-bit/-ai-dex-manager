"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export type CurrencyCode = "USD" | "JPY";

interface CurrencyContextValue {
    currency: CurrencyCode;
    toggleCurrency: () => void;
    jpyRate: number;           // 1 USD = X JPY
    /** 価格を現在の通貨でフォーマット */
    formatPrice: (usdValue: number) => string;
    /** 大きな数値（時価総額・出来高）を現在の通貨でフォーマット */
    formatLarge: (usdValue: number) => string;
    /** 通貨シンボルのみ */
    symbol: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const STORAGE_KEY = "disdex_currency";
const JPY_RATE_LS = "disdex_jpy_rate";

export function CurrencyProvider({ children }: { children: ReactNode }) {
    const [currency, setCurrency] = useState<CurrencyCode>(() => {
        if (typeof window === "undefined") return "JPY";
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "USD") {
            localStorage.setItem(STORAGE_KEY, "JPY");
            return "JPY";
        }
        return (stored as CurrencyCode) || "JPY";
    });
    const [jpyRate, setJpyRate] = useState<number>(() => {
        if (typeof window === "undefined") return 150;
        return parseFloat(localStorage.getItem(JPY_RATE_LS) || "150");
    });

    // CoinGecko から USD→JPY レートを取得
    const fetchJpyRate = useCallback(async () => {
        try {
            const res = await fetch(
                "/api/coingecko?path=/simple/price?ids=usd&vs_currencies=jpy"
            );
            const data = await res.json();
            const rate = data?.usd?.jpy as number | undefined;
            if (rate && rate > 100) {
                setJpyRate(rate);
                localStorage.setItem(JPY_RATE_LS, String(rate));
            }
        } catch {
            // fallback: keep cached rate
        }
    }, []);

    useEffect(() => {
        fetchJpyRate();
        const interval = setInterval(fetchJpyRate, 10 * 60 * 1000); // 10分ごとに更新
        return () => clearInterval(interval);
    }, [fetchJpyRate]);

    const toggleCurrency = useCallback(() => {
        setCurrency(prev => {
            const next = prev === "USD" ? "JPY" : "USD";
            localStorage.setItem(STORAGE_KEY, next);
            return next;
        });
    }, []);

    // ヘルパー: 価格フォーマット
    const formatPrice = useCallback((usdValue: number): string => {
        if (!isFinite(usdValue)) return currency === "JPY" ? "¥0" : "$0";
        if (currency === "JPY") {
            const jpy = usdValue * jpyRate;
            if (jpy < 1) return `¥${jpy.toLocaleString("ja-JP", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
            return `¥${jpy.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}`;
        }
        // USD
        if (usdValue < 0.001) return `$${usdValue.toFixed(8)}`;
        if (usdValue < 1) return `$${usdValue.toFixed(6)}`;
        return `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }, [currency, jpyRate]);

    // ヘルパー: 大きな数値（時価総額・出来高）
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
        <CurrencyContext.Provider value={{ currency, toggleCurrency, jpyRate, formatPrice, formatLarge, symbol }}>
            {children}
        </CurrencyContext.Provider>
    );
}

export function useCurrency(): CurrencyContextValue {
    const ctx = useContext(CurrencyContext);
    if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
    return ctx;
}
