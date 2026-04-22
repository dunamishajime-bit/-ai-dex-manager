"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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

const CurrencyContext = createContext<CurrencyContextType | undefined>(
  undefined,
);

const JPY_RATE_LS = "jdex_jpy_rate_v2";
const STORAGE_KEY = "jdex_currency_pref";
const DEFAULT_USD_JPY_RATE = 157;
const JPY_SYMBOL = "¥";

export const CurrencyProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    if (typeof window === "undefined") {
      return "JPY";
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as CurrencyCode) || "JPY";
  });

  const [jpyRate, setJpyRate] = useState<number>(DEFAULT_USD_JPY_RATE);

  const syncJpyRate = useCallback(async () => {
    try {
      const response = await fetch("/api/market/dashboard", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (payload.ok && payload.fxRate) {
        const nextRate = Number(payload.fxRate);
        if (Number.isFinite(nextRate) && nextRate > 0) {
          setJpyRate(nextRate);
          localStorage.setItem(JPY_RATE_LS, String(nextRate));
        }
      }
    } catch (error) {
      console.warn(
        "[CurrencyContext] Failed to sync JPY rate from dashboard, using fallback:",
        error,
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = parseFloat(localStorage.getItem(JPY_RATE_LS) || "");
      if (Number.isFinite(stored) && stored > 0) {
        setJpyRate(stored);
      }
    }

    void syncJpyRate();
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

  const symbol = currency === "JPY" ? JPY_SYMBOL : "$";

  const formatPrice = (usdPrice: number | null | undefined) => {
    const safeUsdPrice = Number(usdPrice);
    if (!Number.isFinite(safeUsdPrice)) {
      return currency === "JPY" ? `${JPY_SYMBOL}-` : "$-";
    }

    if (currency === "JPY") {
      return `${JPY_SYMBOL}${Math.round(safeUsdPrice * jpyRate).toLocaleString(
        "ja-JP",
      )}`;
    }

    return `$${safeUsdPrice.toLocaleString("en-US", {
      minimumFractionDigits: safeUsdPrice >= 100 ? 2 : safeUsdPrice >= 1 ? 3 : 6,
      maximumFractionDigits: safeUsdPrice >= 100 ? 2 : safeUsdPrice >= 1 ? 3 : 6,
    })}`;
  };

  const formatLarge = (usdValue: number | null | undefined) => {
    const safeUsdValue = Number(usdValue);
    if (!Number.isFinite(safeUsdValue)) {
      return currency === "JPY" ? `${JPY_SYMBOL}-` : "$-";
    }

    if (currency === "JPY") {
      return `${JPY_SYMBOL}${Math.round(safeUsdValue * jpyRate).toLocaleString(
        "ja-JP",
      )}`;
    }

    return `$${safeUsdValue.toLocaleString("en-US", {
      minimumFractionDigits: safeUsdValue >= 100 ? 2 : 3,
      maximumFractionDigits: safeUsdValue >= 100 ? 2 : 6,
    })}`;
  };

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        jpyRate,
        setJpyRate,
        symbol,
        toggleCurrency,
        formatPrice,
        formatLarge,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}
