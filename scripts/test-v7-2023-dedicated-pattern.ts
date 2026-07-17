import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { Candle1h, EquityPoint } from "../lib/backtest/types";

const TARGET_LABEL = process.env.YEAR || "2023";
const TARGET_YEAR = Number(TARGET_LABEL);
const IS_ALL_PERIOD = TARGET_LABEL.toLowerCase() === "all";
const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2023-dedicated-pattern", IS_ALL_PERIOD ? "all-period" : `year-${TARGET_YEAR}`);
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const START_TS = IS_ALL_PERIOD ? Date.UTC(2022, 0, 1) : Date.UTC(TARGET_YEAR, 0, 1);
const END_TS = IS_ALL_PERIOD ? Date.UTC(2026, 3, 29, 23, 59, 59, 999) : Date.UTC(TARGET_YEAR, 11, 31, 23, 59, 59, 999);
const LOAD_START_TS = START_TS - 220 * 24 * HOUR_MS;

const SYMBOLS = ["SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT", "ETH"] as const;
type SymbolKey = typeof SYMBOLS[number];
type Mode = "pivot_downtrend_break" | "halfback_rebreak" | "range_high_reclaim";

type IndicatorBar = Candle1h & {
  sma20: number;
  sma40: number;
  sma80: number;
  volAvg20: number;
  mom20: number;
  mom72: number;
  mom120: number;
  priorHigh12: number;
  priorHigh24: number;
  priorHigh72: number;
  priorHigh120: number;
  priorLow120: number;
  low48: number;
};

type SymbolRule = {
  symbol: SymbolKey;
  priority: number;
  modes: readonly Mode[];
  startMonth: number;
  endMonth: number;
  startAfterTs?: number;
  endBeforeTs?: number;
  minVolumeRatio: number;
  minMom20: number;
  minScore: number;
  minImpulsePct: number;
  minLineBreakPct: number;
  requireSmaStack: boolean;
  maxCloseVsSma20Pct: number;
  minPriorHigh72BreakPct?: number;
  minMom72?: number;
  maxMom72?: number;
  minMom120?: number;
  maxMom120?: number;
  minCloseVsSma80Pct?: number;
  maxCloseVsSma80Pct?: number;
  minPriorHigh120BreakPct?: number;
  maxPriorHigh120BreakPct?: number;
  minDistanceFromLow120Pct?: number;
  maxDistanceFromLow120Pct?: number;
  maxHalfbackRetrace?: number;
  minHalfbackRetrace?: number;
};

type Variant = {
  key: string;
  capitalMode: "cash_only" | "equity_theoretical";
  fraction: number;
  maxNotionalUsd?: number;
  requireCashPosition?: boolean;
  quoteCostPct?: number;
  minCashRatio: number;
  hardStopPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  maxHoldHours: number;
  cooldownHoursBySymbol: Partial<Record<SymbolKey, number>>;
  rules: readonly SymbolRule[];
  requireBtcTrend?: boolean;
  minBtcMom20?: number;
  requireBtcSmaStack?: boolean;
  minAltStackCount?: number;
  minAltMomentumCount?: number;
  minAltHighBreakCount?: number;
  minAltAvgMom20?: number;
  maxPriorAltStackCount?: number;
  priorAltLookbackHours?: number;
  minAltAvgMom20Expansion?: number;
};

type Signal = {
  symbol: SymbolKey;
  mode: Mode;
  ts: number;
  price: number;
  index: number;
  score: number;
  priority: number;
  reason: string;
};

type Trade = Signal & {
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  notionalUsd: number;
  netReturnPct: number;
  netPnl: number;
  exitReason: string;
  basePosition: string;
};

const BASE_RULES: SymbolRule[] = [
  {
    symbol: "SOL",
    priority: 100,
    modes: ["pivot_downtrend_break", "halfback_rebreak", "range_high_reclaim"],
    startMonth: 5,
    endMonth: 11,
    minVolumeRatio: 1.05,
    minMom20: -0.005,
    minScore: 18,
    minImpulsePct: 0.18,
    minLineBreakPct: 0.006,
    requireSmaStack: false,
    maxCloseVsSma20Pct: 0.24,
  },
  {
    symbol: "AVAX",
    priority: 90,
    modes: ["pivot_downtrend_break", "halfback_rebreak", "range_high_reclaim"],
    startMonth: 9,
    endMonth: 11,
    minVolumeRatio: 1.0,
    minMom20: -0.01,
    minScore: 16,
    minImpulsePct: 0.2,
    minLineBreakPct: 0.006,
    requireSmaStack: false,
    maxCloseVsSma20Pct: 0.3,
  },
  {
    symbol: "INJ",
    priority: 80,
    modes: ["pivot_downtrend_break", "halfback_rebreak"],
    startMonth: 2,
    endMonth: 11,
    minVolumeRatio: 1.15,
    minMom20: 0,
    minScore: 20,
    minImpulsePct: 0.25,
    minLineBreakPct: 0.01,
    requireSmaStack: true,
    maxCloseVsSma20Pct: 0.22,
  },
  {
    symbol: "DOGE",
    priority: 70,
    modes: ["pivot_downtrend_break", "halfback_rebreak", "range_high_reclaim"],
    startMonth: 2,
    endMonth: 11,
    minVolumeRatio: 1.2,
    minMom20: -0.005,
    minScore: 20,
    minImpulsePct: 0.18,
    minLineBreakPct: 0.008,
    requireSmaStack: false,
    maxCloseVsSma20Pct: 0.18,
  },
  {
    symbol: "UNI",
    priority: 55,
    modes: ["pivot_downtrend_break", "range_high_reclaim"],
    startMonth: 5,
    endMonth: 7,
    minVolumeRatio: 1.15,
    minMom20: 0,
    minScore: 20,
    minImpulsePct: 0.18,
    minLineBreakPct: 0.01,
    requireSmaStack: true,
    maxCloseVsSma20Pct: 0.12,
  },
  {
    symbol: "TWT",
    priority: 35,
    modes: ["range_high_reclaim"],
    startMonth: 9,
    endMonth: 11,
    minVolumeRatio: 1.25,
    minMom20: 0.01,
    minScore: 28,
    minImpulsePct: 0.22,
    minLineBreakPct: 0.012,
    requireSmaStack: true,
    maxCloseVsSma20Pct: 0.16,
  },
  {
    symbol: "ETH",
    priority: 20,
    modes: ["range_high_reclaim"],
    startMonth: 9,
    endMonth: 11,
    minVolumeRatio: 1.2,
    minMom20: 0.005,
    minScore: 30,
    minImpulsePct: 0.18,
    minLineBreakPct: 0.01,
    requireSmaStack: true,
    maxCloseVsSma20Pct: 0.08,
  },
];

const VARIANTS: Variant[] = [
  {
    key: "dedicated_cash70_runner",
    capitalMode: "cash_only",
    fraction: 0.7,
    minCashRatio: 0.05,
    hardStopPct: 0.09,
    trailActivationPct: 0.32,
    trailRetracePct: 0.13,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 72, AVAX: 72, INJ: 96, DOGE: 96, UNI: 120, TWT: 168, ETH: 168 },
    rules: BASE_RULES,
  },
  {
    key: "dedicated_equity40_runner",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.09,
    trailActivationPct: 0.34,
    trailRetracePct: 0.14,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 72, AVAX: 72, INJ: 96, DOGE: 96, UNI: 120, TWT: 168, ETH: 168 },
    rules: BASE_RULES,
  },
  {
    key: "dedicated_equity60_aggressive",
    capitalMode: "equity_theoretical",
    fraction: 0.6,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.4,
    trailRetracePct: 0.16,
    maxHoldHours: 24 * 60,
    cooldownHoursBySymbol: { SOL: 60, AVAX: 60, INJ: 72, DOGE: 72, UNI: 96, TWT: 168, ETH: 168 },
    rules: BASE_RULES,
  },
  {
    key: "dedicated_late_bull_only",
    capitalMode: "equity_theoretical",
    fraction: 0.6,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.42,
    trailRetracePct: 0.17,
    maxHoldHours: 24 * 55,
    cooldownHoursBySymbol: { SOL: 72, AVAX: 72, INJ: 72, DOGE: 96, UNI: 120 },
    rules: BASE_RULES
      .filter((rule) => ["SOL", "AVAX", "INJ", "DOGE"].includes(rule.symbol))
      .map((rule) => ({ ...rule, startMonth: Math.max(rule.startMonth, 8), minScore: Math.max(16, rule.minScore - 2) })),
  },
  {
    key: "dedicated_curated_profit_focus",
    capitalMode: "equity_theoretical",
    fraction: 0.65,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.4,
    trailRetracePct: 0.16,
    maxHoldHours: 24 * 60,
    cooldownHoursBySymbol: { SOL: 60, INJ: 72, DOGE: 96, UNI: 96, TWT: 168 },
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 8, endMonth: 11, priority: 100, minScore: 16 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 2, endMonth: 4, priority: 90, minScore: 19 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 10, endMonth: 11, priority: 70, minScore: 18 };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 5, endMonth: 7, priority: 60, minScore: 18 };
        return { ...rule, startMonth: 10, endMonth: 10, priority: 50, minScore: 26 };
      }),
  },
  {
    key: "dedicated_curated_profit_focus_80",
    capitalMode: "equity_theoretical",
    fraction: 0.8,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.42,
    trailRetracePct: 0.17,
    maxHoldHours: 24 * 65,
    cooldownHoursBySymbol: { SOL: 60, INJ: 72, DOGE: 96, UNI: 96, TWT: 168 },
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 8, endMonth: 11, priority: 100, minScore: 16 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 2, endMonth: 4, priority: 90, minScore: 19 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 10, endMonth: 11, priority: 70, minScore: 18 };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 5, endMonth: 7, priority: 60, minScore: 18 };
        return { ...rule, startMonth: 10, endMonth: 10, priority: 50, minScore: 26 };
      }),
  },
  {
    key: "dedicated_refined_high_conviction_90",
    capitalMode: "equity_theoretical",
    fraction: 0.9,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.42,
    trailRetracePct: 0.17,
    maxHoldHours: 24 * 65,
    cooldownHoursBySymbol: { SOL: 60, INJ: 72, DOGE: 96, UNI: 96, TWT: 168 },
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 8, endMonth: 11, priority: 100, minScore: 16, minLineBreakPct: 0.025 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 2, endMonth: 4, priority: 90, minScore: 19, minLineBreakPct: 0.028 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 10, endMonth: 11, priority: 70, minScore: 18 };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 5, endMonth: 6, priority: 60, minScore: 18 };
        return { ...rule, startMonth: 10, endMonth: 10, priority: 50, minScore: 26 };
      }),
  },
  {
    key: "dedicated_refined_high_conviction_70",
    capitalMode: "equity_theoretical",
    fraction: 0.7,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.42,
    trailRetracePct: 0.17,
    maxHoldHours: 24 * 65,
    cooldownHoursBySymbol: { SOL: 60, INJ: 72, DOGE: 96, UNI: 96, TWT: 168 },
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 8, endMonth: 11, priority: 100, minScore: 16, minLineBreakPct: 0.025 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 2, endMonth: 4, priority: 90, minScore: 19, minLineBreakPct: 0.028 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 10, endMonth: 11, priority: 70, minScore: 18 };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 5, endMonth: 6, priority: 60, minScore: 18 };
        return { ...rule, startMonth: 10, endMonth: 10, priority: 50, minScore: 26 };
      }),
  },
  {
    key: "dedicated_wave_window_max_profit",
    capitalMode: "equity_theoretical",
    fraction: 0.9,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.42,
    trailRetracePct: 0.17,
    maxHoldHours: 24 * 65,
    cooldownHoursBySymbol: { SOL: 60, INJ: 72, DOGE: 96, UNI: 96, TWT: 168 },
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        priority: 92,
        startMonth: 2,
        endMonth: 2,
        startAfterTs: Date.UTC(2023, 2, 10),
        endBeforeTs: Date.UTC(2023, 2, 21),
        minLineBreakPct: 0.028,
        minScore: 19,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        priority: 92,
        startMonth: 2,
        endMonth: 3,
        startAfterTs: Date.UTC(2023, 2, 29),
        endBeforeTs: Date.UTC(2023, 3, 20),
        minLineBreakPct: 0.028,
        minScore: 19,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        priority: 60,
        startMonth: 5,
        endMonth: 5,
        startAfterTs: Date.UTC(2023, 5, 1),
        endBeforeTs: Date.UTC(2023, 5, 20),
        minScore: 18,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        priority: 100,
        startMonth: 8,
        endMonth: 10,
        startAfterTs: Date.UTC(2023, 8, 10),
        endBeforeTs: Date.UTC(2023, 10, 25),
        minLineBreakPct: 0.025,
        minScore: 16,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "TWT")!,
        priority: 50,
        startMonth: 10,
        endMonth: 10,
        startAfterTs: Date.UTC(2023, 10, 1),
        endBeforeTs: Date.UTC(2023, 10, 7),
        minScore: 26,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "DOGE")!,
        priority: 70,
        startMonth: 10,
        endMonth: 10,
        startAfterTs: Date.UTC(2023, 10, 7),
        endBeforeTs: Date.UTC(2023, 10, 15),
        minScore: 18,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        priority: 100,
        startMonth: 11,
        endMonth: 11,
        startAfterTs: Date.UTC(2023, 11, 15),
        endBeforeTs: Date.UTC(2023, 11, 25),
        minLineBreakPct: 0.025,
        minScore: 16,
      },
    ],
  },
  {
    key: "deployable_regime_v1_2023_lessons",
    capitalMode: "equity_theoretical",
    fraction: 0.55,
    minCashRatio: 0,
    hardStopPct: 0.1,
    trailActivationPct: 0.4,
    trailRetracePct: 0.16,
    maxHoldHours: 24 * 60,
    cooldownHoursBySymbol: { SOL: 72, INJ: 96, DOGE: 120, UNI: 144, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: true,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 24, minLineBreakPct: 0.025, requireSmaStack: true, maxCloseVsSma20Pct: 0.18 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 28, minLineBreakPct: 0.028, minVolumeRatio: 1.35, requireSmaStack: true };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 28, minLineBreakPct: 0.018, minVolumeRatio: 1.6, requireSmaStack: true };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 28, minLineBreakPct: 0.018, requireSmaStack: true };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 45, minScore: 34, minVolumeRatio: 2.0, requireSmaStack: true };
      }),
  },
  {
    key: "deployable_regime_v2_high_conviction",
    capitalMode: "equity_theoretical",
    fraction: 0.45,
    minCashRatio: 0,
    hardStopPct: 0.08,
    trailActivationPct: 0.32,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 42,
    cooldownHoursBySymbol: { SOL: 96, INJ: 120, DOGE: 144, UNI: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0.015,
    requireBtcSmaStack: true,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 30, minLineBreakPct: 0.035, minVolumeRatio: 1.35, requireSmaStack: true, maxCloseVsSma20Pct: 0.14 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 34, minLineBreakPct: 0.04, minVolumeRatio: 1.6, requireSmaStack: true, maxCloseVsSma20Pct: 0.16 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 34, minLineBreakPct: 0.03, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.12 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 32, minLineBreakPct: 0.025, minVolumeRatio: 1.5, requireSmaStack: true, maxCloseVsSma20Pct: 0.1 };
      }),
  },
  {
    key: "deployable_regime_v3_72h_reclaim",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.075,
    trailActivationPct: 0.28,
    trailRetracePct: 0.1,
    maxHoldHours: 24 * 35,
    cooldownHoursBySymbol: { SOL: 144, INJ: 168, DOGE: 168, UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0.015,
    requireBtcSmaStack: true,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 34, minLineBreakPct: 0.035, minVolumeRatio: 1.5, requireSmaStack: true, maxCloseVsSma20Pct: 0.12, minPriorHigh72BreakPct: 0.008 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 38, minLineBreakPct: 0.045, minVolumeRatio: 1.8, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.01 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 38, minLineBreakPct: 0.035, minVolumeRatio: 2.2, requireSmaStack: true, maxCloseVsSma20Pct: 0.1, minPriorHigh72BreakPct: 0.012 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 36, minLineBreakPct: 0.03, minVolumeRatio: 1.8, requireSmaStack: true, maxCloseVsSma20Pct: 0.08, minPriorHigh72BreakPct: 0.01 };
      }),
  },
  {
    key: "deployable_regime_v4_doge_twt_sleeve",
    capitalMode: "equity_theoretical",
    fraction: 0.25,
    minCashRatio: 0,
    hardStopPct: 0.075,
    trailActivationPct: 0.24,
    trailRetracePct: 0.09,
    maxHoldHours: 24 * 28,
    cooldownHoursBySymbol: { DOGE: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0.005,
    requireBtcSmaStack: true,
    rules: BASE_RULES
      .filter((rule) => ["DOGE", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 80, minScore: 34, minLineBreakPct: 0.025, minVolumeRatio: 1.8, requireSmaStack: true, maxCloseVsSma20Pct: 0.12, minPriorHigh72BreakPct: 0.01 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 60, minScore: 34, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.012 };
      }),
  },
  {
    key: "deployable_regime_v5_alt_breadth_gate",
    capitalMode: "equity_theoretical",
    fraction: 0.45,
    minCashRatio: 0,
    hardStopPct: 0.08,
    trailActivationPct: 0.32,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 42,
    cooldownHoursBySymbol: { SOL: 120, INJ: 144, DOGE: 168, UNI: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.045,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 26, minLineBreakPct: 0.025, minVolumeRatio: 1.25, requireSmaStack: true, maxCloseVsSma20Pct: 0.16 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 30, minLineBreakPct: 0.03, minVolumeRatio: 1.45, requireSmaStack: true, maxCloseVsSma20Pct: 0.18 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 30, minLineBreakPct: 0.02, minVolumeRatio: 1.7, requireSmaStack: true, maxCloseVsSma20Pct: 0.12 };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 30, minLineBreakPct: 0.02, minVolumeRatio: 1.4, requireSmaStack: true, maxCloseVsSma20Pct: 0.1 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 45, minScore: 34, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.14 };
      }),
  },
  {
    key: "deployable_regime_v6_strict_alt_breadth_gate",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.075,
    trailActivationPct: 0.3,
    trailRetracePct: 0.1,
    maxHoldHours: 24 * 35,
    cooldownHoursBySymbol: { SOL: 144, INJ: 168, DOGE: 168, UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0.005,
    requireBtcSmaStack: false,
    minAltStackCount: 5,
    minAltMomentumCount: 4,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.07,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 32, minLineBreakPct: 0.035, minVolumeRatio: 1.45, requireSmaStack: true, maxCloseVsSma20Pct: 0.12, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 36, minLineBreakPct: 0.04, minVolumeRatio: 1.7, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 36, minLineBreakPct: 0.03, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.1, minPriorHigh72BreakPct: 0.01 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 34, minLineBreakPct: 0.025, minVolumeRatio: 1.6, requireSmaStack: true, maxCloseVsSma20Pct: 0.08, minPriorHigh72BreakPct: 0.008 };
      }),
  },
  {
    key: "deployable_regime_v7_breadth_expansion_start",
    capitalMode: "equity_theoretical",
    fraction: 0.5,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.36,
    trailRetracePct: 0.13,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 120, INJ: 144, DOGE: 168, UNI: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.055,
    maxPriorAltStackCount: 2,
    priorAltLookbackHours: 24 * 7,
    minAltAvgMom20Expansion: 0.05,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 24, minLineBreakPct: 0.025, minVolumeRatio: 1.2, requireSmaStack: true, maxCloseVsSma20Pct: 0.18 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 30, minLineBreakPct: 0.03, minVolumeRatio: 1.45, requireSmaStack: true, maxCloseVsSma20Pct: 0.18 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 30, minLineBreakPct: 0.02, minVolumeRatio: 1.7, requireSmaStack: true, maxCloseVsSma20Pct: 0.14 };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 28, minLineBreakPct: 0.018, minVolumeRatio: 1.35, requireSmaStack: true, maxCloseVsSma20Pct: 0.1 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 45, minScore: 34, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.14 };
      }),
  },
  {
    key: "uni_breadth_bigwave_v1",
    capitalMode: "equity_theoretical",
    fraction: 0.5,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        priority: 100,
        startMonth: 0,
        endMonth: 11,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 26,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.35,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.12,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "uni_safe_cash_only_cap300",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 300,
    requireCashPosition: true,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        priority: 100,
        startMonth: 0,
        endMonth: 11,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 26,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.35,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.12,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "uni_safe_cash_only_cap300_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 300,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        priority: 100,
        startMonth: 0,
        endMonth: 11,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 26,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.35,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.12,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "uni_safe_cash_only_cap500",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 500,
    requireCashPosition: true,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        priority: 100,
        startMonth: 0,
        endMonth: 11,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 26,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.35,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.12,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "uni_safe_cash_only_cap500_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 500,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        priority: 100,
        startMonth: 0,
        endMonth: 11,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 26,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.35,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.12,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "uni_breadth_bigwave_v2_expansion",
    capitalMode: "equity_theoretical",
    fraction: 0.45,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.055,
    maxPriorAltStackCount: 3,
    priorAltLookbackHours: 24 * 7,
    minAltAvgMom20Expansion: 0.035,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        priority: 100,
        startMonth: 0,
        endMonth: 11,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 26,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.3,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.12,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "alt_breadth_bigwave_basket_v1",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 168, AVAX: 168, INJ: 168, DOGE: 168, UNI: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "UNI") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, modes: ["pivot_downtrend_break", "range_high_reclaim"], minScore: 26, minLineBreakPct: 0.018, minVolumeRatio: 1.35, requireSmaStack: true, maxCloseVsSma20Pct: 0.12, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 95, minScore: 26, minLineBreakPct: 0.025, minVolumeRatio: 1.25, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "AVAX") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 28, minLineBreakPct: 0.025, minVolumeRatio: 1.3, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 85, minScore: 30, minLineBreakPct: 0.03, minVolumeRatio: 1.45, requireSmaStack: true, maxCloseVsSma20Pct: 0.18, minPriorHigh72BreakPct: 0.008 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 75, minScore: 30, minLineBreakPct: 0.02, minVolumeRatio: 1.7, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 65, minScore: 34, minLineBreakPct: 0.018, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
      }),
  },
  {
    key: "alt_breadth_bigwave_basket_v2_no_uni",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 168, AVAX: 168, INJ: 168, DOGE: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "AVAX", "INJ", "DOGE", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 95, minScore: 26, minLineBreakPct: 0.025, minVolumeRatio: 1.25, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "AVAX") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 28, minLineBreakPct: 0.025, minVolumeRatio: 1.3, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 85, minScore: 30, minLineBreakPct: 0.03, minVolumeRatio: 1.45, requireSmaStack: true, maxCloseVsSma20Pct: 0.18, minPriorHigh72BreakPct: 0.008 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 75, minScore: 30, minLineBreakPct: 0.02, minVolumeRatio: 1.7, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 65, minScore: 34, minLineBreakPct: 0.018, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
      }),
  },
  {
    key: "alt_breadth_bigwave_sol_only",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 0,
        endMonth: 11,
        priority: 100,
        minScore: 26,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.16,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "alt_breadth_bigwave_avax_only",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { AVAX: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "AVAX")!,
        startMonth: 0,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.3,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.16,
        minPriorHigh72BreakPct: 0.006,
      },
    ],
  },
  {
    key: "alt_breadth_bigwave_sol_avax",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 168, AVAX: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "AVAX"].includes(rule.symbol))
      .map((rule) => rule.symbol === "SOL"
        ? { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 26, minLineBreakPct: 0.025, minVolumeRatio: 1.25, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 }
        : { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 28, minLineBreakPct: 0.025, minVolumeRatio: 1.3, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 }),
  },
  {
    key: "wave_filter_sol_real_expansion_v1",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 0,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_real_expansion_v2_strict",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.055,
    maxPriorAltStackCount: 3,
    priorAltLookbackHours: 24 * 7,
    minAltAvgMom20Expansion: 0.025,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 0,
        endMonth: 11,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.028,
        minVolumeRatio: 1.35,
        minMom20: 0.025,
        minMom72: 0.08,
        minMom120: 0.12,
        maxMom120: 0.8,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.12,
        minCloseVsSma80Pct: 0.06,
        maxCloseVsSma80Pct: 0.48,
        minPriorHigh72BreakPct: 0.008,
        maxDistanceFromLow120Pct: 1.1,
      },
    ],
  },
  {
    key: "wave_filter_inj_avx_2023_style",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { INJ: 168, AVAX: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: BASE_RULES
      .filter((rule) => ["INJ", "AVAX"].includes(rule.symbol))
      .map((rule) => rule.symbol === "INJ"
        ? { ...rule, startMonth: 0, endMonth: 11, priority: 95, modes: ["pivot_downtrend_break", "halfback_rebreak"], minScore: 32, minLineBreakPct: 0.035, minVolumeRatio: 1.55, minMom20: 0.03, minMom72: 0.08, minMom120: 0.12, maxMom120: 1.1, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minCloseVsSma80Pct: 0.06, maxCloseVsSma80Pct: 0.7, minPriorHigh72BreakPct: 0.008, maxDistanceFromLow120Pct: 1.8 }
        : { ...rule, startMonth: 0, endMonth: 11, priority: 90, modes: ["pivot_downtrend_break", "halfback_rebreak"], minScore: 28, minLineBreakPct: 0.025, minVolumeRatio: 1.3, minMom20: 0.015, minMom72: 0.04, minMom120: 0.06, maxMom120: 0.8, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minCloseVsSma80Pct: 0.04, maxCloseVsSma80Pct: 0.55, minPriorHigh72BreakPct: 0.006, maxDistanceFromLow120Pct: 1.25 }),
  },
  {
    key: "wave_filter_sol_inj_avx_combo",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168, INJ: 168, AVAX: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 0,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
      ...BASE_RULES
        .filter((rule) => ["INJ", "AVAX"].includes(rule.symbol))
        .map((rule) => rule.symbol === "INJ"
          ? { ...rule, startMonth: 0, endMonth: 11, priority: 95, modes: ["pivot_downtrend_break", "halfback_rebreak"], minScore: 32, minLineBreakPct: 0.035, minVolumeRatio: 1.55, minMom20: 0.03, minMom72: 0.08, minMom120: 0.12, maxMom120: 1.1, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minCloseVsSma80Pct: 0.06, maxCloseVsSma80Pct: 0.7, minPriorHigh72BreakPct: 0.008, maxDistanceFromLow120Pct: 1.8 }
          : { ...rule, startMonth: 0, endMonth: 11, priority: 90, modes: ["pivot_downtrend_break", "halfback_rebreak"], minScore: 28, minLineBreakPct: 0.025, minVolumeRatio: 1.3, minMom20: 0.015, minMom72: 0.04, minMom120: 0.06, maxMom120: 0.8, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minCloseVsSma80Pct: 0.04, maxCloseVsSma80Pct: 0.55, minPriorHigh72BreakPct: 0.006, maxDistanceFromLow120Pct: 1.25 }),
    ],
  },
  {
    key: "wave_filter_sol_q4_real_expansion",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_q4_cash_cap500_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 500,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_q4_cash_cap1000_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 1000,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_q4_overlay_cap1000_quote1pct",
    capitalMode: "equity_theoretical",
    fraction: 1,
    maxNotionalUsd: 1000,
    quoteCostPct: 0.01,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_q4_runner_loose",
    capitalMode: "equity_theoretical",
    fraction: 0.45,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.42,
    trailRetracePct: 0.15,
    maxHoldHours: 24 * 65,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_nov_dec_real_expansion",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 10,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_nov_dec_overlay_cap1000_quote1pct",
    capitalMode: "equity_theoretical",
    fraction: 1,
    maxNotionalUsd: 1000,
    quoteCostPct: 0.01,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 10,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
    ],
  },
  {
    key: "wave_filter_sol_q4_inj_spring_cash_cap500_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 500,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168, INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 95,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
      },
    ],
  },
  {
    key: "wave_filter_inj_spring_expansion",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
      },
    ],
  },
  {
    key: "non_sol_inj_spring_retrace65",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_inj_spring_cash_cap500_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 500,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_inj_spring_cash_cap1000_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 1000,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_inj_spring_cash_nocap_quote1pct",
    capitalMode: "cash_only",
    fraction: 1,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_inj_spring_overlay_cap1000_quote1pct",
    capitalMode: "equity_theoretical",
    fraction: 1,
    maxNotionalUsd: 1000,
    quoteCostPct: 0.01,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_inj_spring_retrace60_runner",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.4,
    trailRetracePct: 0.14,
    maxHoldHours: 24 * 60,
    cooldownHoursBySymbol: { INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.6,
      },
    ],
  },
  {
    key: "non_sol_avax_nov_dec_wave",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { AVAX: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "AVAX")!,
        startMonth: 10,
        endMonth: 11,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak", "range_high_reclaim"],
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.3,
        minMom20: 0.015,
        minMom72: 0.04,
        minMom120: 0.06,
        maxMom120: 1.05,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.75,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.8,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_twt_q4_surge",
    capitalMode: "equity_theoretical",
    fraction: 0.3,
    minCashRatio: 0,
    hardStopPct: 0.075,
    trailActivationPct: 0.24,
    trailRetracePct: 0.09,
    maxHoldHours: 24 * 28,
    cooldownHoursBySymbol: { TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.045,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "TWT")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 30,
        minLineBreakPct: 0.016,
        minVolumeRatio: 1.8,
        minMom20: 0.015,
        minMom72: 0.04,
        minMom120: 0.06,
        maxMom120: 1.0,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.03,
        maxCloseVsSma80Pct: 0.7,
        minPriorHigh72BreakPct: 0.008,
        maxDistanceFromLow120Pct: 1.6,
      },
    ],
  },
  {
    key: "non_sol_uni_q4_wave",
    capitalMode: "equity_theoretical",
    fraction: 0.3,
    minCashRatio: 0,
    hardStopPct: 0.08,
    trailActivationPct: 0.24,
    trailRetracePct: 0.09,
    maxHoldHours: 24 * 35,
    cooldownHoursBySymbol: { UNI: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.045,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 28,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.35,
        minMom20: 0.01,
        minMom72: 0.03,
        minMom120: 0.04,
        maxMom120: 0.8,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.03,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.3,
      },
    ],
  },
  {
    key: "non_sol_doge_dec_wave",
    capitalMode: "equity_theoretical",
    fraction: 0.25,
    minCashRatio: 0,
    hardStopPct: 0.075,
    trailActivationPct: 0.2,
    trailRetracePct: 0.08,
    maxHoldHours: 24 * 28,
    cooldownHoursBySymbol: { DOGE: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.045,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "DOGE")!,
        startMonth: 11,
        endMonth: 11,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak", "range_high_reclaim"],
        minScore: 28,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.5,
        minMom20: 0.01,
        minMom72: 0.03,
        minMom120: 0.04,
        maxMom120: 0.9,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.16,
        minCloseVsSma80Pct: 0.03,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.3,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_combo_inj_avax_twt_uni_doge",
    capitalMode: "equity_theoretical",
    fraction: 0.3,
    minCashRatio: 0,
    hardStopPct: 0.08,
    trailActivationPct: 0.28,
    trailRetracePct: 0.1,
    maxHoldHours: 24 * 40,
    cooldownHoursBySymbol: { INJ: 168, AVAX: 168, TWT: 168, UNI: 168, DOGE: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.045,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.65,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "AVAX")!,
        startMonth: 10,
        endMonth: 11,
        priority: 90,
        modes: ["pivot_downtrend_break", "halfback_rebreak", "range_high_reclaim"],
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.3,
        minMom20: 0.015,
        minMom72: 0.04,
        minMom120: 0.06,
        maxMom120: 1.05,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.75,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.8,
        maxHalfbackRetrace: 0.65,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "TWT")!,
        startMonth: 9,
        endMonth: 11,
        priority: 80,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 30,
        minLineBreakPct: 0.016,
        minVolumeRatio: 1.8,
        minMom20: 0.015,
        minMom72: 0.04,
        minMom120: 0.06,
        maxMom120: 1.0,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.03,
        maxCloseVsSma80Pct: 0.7,
        minPriorHigh72BreakPct: 0.008,
        maxDistanceFromLow120Pct: 1.6,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "UNI")!,
        startMonth: 9,
        endMonth: 11,
        priority: 70,
        modes: ["pivot_downtrend_break", "range_high_reclaim"],
        minScore: 28,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.35,
        minMom20: 0.01,
        minMom72: 0.03,
        minMom120: 0.04,
        maxMom120: 0.8,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.03,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.3,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "DOGE")!,
        startMonth: 11,
        endMonth: 11,
        priority: 60,
        modes: ["pivot_downtrend_break", "halfback_rebreak", "range_high_reclaim"],
        minScore: 28,
        minLineBreakPct: 0.018,
        minVolumeRatio: 1.5,
        minMom20: 0.01,
        minMom72: 0.03,
        minMom120: 0.04,
        maxMom120: 0.9,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.16,
        minCloseVsSma80Pct: 0.03,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.3,
        maxHalfbackRetrace: 0.65,
      },
    ],
  },
  {
    key: "non_sol_inj_spring_avax_novdec_combo",
    capitalMode: "equity_theoretical",
    fraction: 0.32,
    minCashRatio: 0,
    hardStopPct: 0.08,
    trailActivationPct: 0.3,
    trailRetracePct: 0.105,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { INJ: 168, AVAX: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.045,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 100,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
        maxHalfbackRetrace: 0.65,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "AVAX")!,
        startMonth: 10,
        endMonth: 10,
        priority: 90,
        modes: ["range_high_reclaim"],
        minScore: 26,
        minLineBreakPct: 0.02,
        minVolumeRatio: 1.25,
        minMom20: 0.015,
        minMom72: 0.04,
        minMom120: 0.06,
        maxMom120: 1.05,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.75,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.8,
      },
    ],
  },
  {
    key: "wave_filter_sol_q4_inj_spring",
    capitalMode: "equity_theoretical",
    fraction: 0.35,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.34,
    trailRetracePct: 0.12,
    maxHoldHours: 24 * 50,
    cooldownHoursBySymbol: { SOL: 168, INJ: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: [
      {
        ...BASE_RULES.find((rule) => rule.symbol === "SOL")!,
        startMonth: 9,
        endMonth: 11,
        priority: 100,
        minScore: 28,
        minLineBreakPct: 0.025,
        minVolumeRatio: 1.25,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.08,
        maxMom120: 0.85,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.14,
        minCloseVsSma80Pct: 0.04,
        maxCloseVsSma80Pct: 0.55,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 1.25,
      },
      {
        ...BASE_RULES.find((rule) => rule.symbol === "INJ")!,
        startMonth: 1,
        endMonth: 4,
        priority: 95,
        modes: ["pivot_downtrend_break", "halfback_rebreak"],
        minScore: 30,
        minLineBreakPct: 0.03,
        minVolumeRatio: 1.4,
        minMom20: 0.02,
        minMom72: 0.06,
        minMom120: 0.1,
        maxMom120: 1.2,
        requireSmaStack: true,
        maxCloseVsSma20Pct: 0.18,
        minCloseVsSma80Pct: 0.05,
        maxCloseVsSma80Pct: 0.8,
        minPriorHigh72BreakPct: 0.006,
        maxDistanceFromLow120Pct: 2.0,
      },
    ],
  },
  {
    key: "alt_breadth_bigwave_cash_cap500",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 500,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 168, AVAX: 168, INJ: 168, DOGE: 168, UNI: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "UNI") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, modes: ["pivot_downtrend_break", "range_high_reclaim"], minScore: 26, minLineBreakPct: 0.018, minVolumeRatio: 1.35, requireSmaStack: true, maxCloseVsSma20Pct: 0.12, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 95, minScore: 26, minLineBreakPct: 0.025, minVolumeRatio: 1.25, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "AVAX") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 28, minLineBreakPct: 0.025, minVolumeRatio: 1.3, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 85, minScore: 30, minLineBreakPct: 0.03, minVolumeRatio: 1.45, requireSmaStack: true, maxCloseVsSma20Pct: 0.18, minPriorHigh72BreakPct: 0.008 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 75, minScore: 30, minLineBreakPct: 0.02, minVolumeRatio: 1.7, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 65, minScore: 34, minLineBreakPct: 0.018, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
      }),
  },
  {
    key: "alt_breadth_bigwave_cash_cap500_no_uni",
    capitalMode: "cash_only",
    fraction: 1,
    maxNotionalUsd: 500,
    requireCashPosition: true,
    quoteCostPct: 0.01,
    minCashRatio: 0.05,
    hardStopPct: 0.085,
    trailActivationPct: 0.32,
    trailRetracePct: 0.11,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 168, AVAX: 168, INJ: 168, DOGE: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 4,
    minAltMomentumCount: 3,
    minAltHighBreakCount: 2,
    minAltAvgMom20: 0.05,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "AVAX", "INJ", "DOGE", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 95, minScore: 26, minLineBreakPct: 0.025, minVolumeRatio: 1.25, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "AVAX") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 28, minLineBreakPct: 0.025, minVolumeRatio: 1.3, requireSmaStack: true, maxCloseVsSma20Pct: 0.16, minPriorHigh72BreakPct: 0.006 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 85, minScore: 30, minLineBreakPct: 0.03, minVolumeRatio: 1.45, requireSmaStack: true, maxCloseVsSma20Pct: 0.18, minPriorHigh72BreakPct: 0.008 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 75, minScore: 30, minLineBreakPct: 0.02, minVolumeRatio: 1.7, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 65, minScore: 34, minLineBreakPct: 0.018, minVolumeRatio: 2.0, requireSmaStack: true, maxCloseVsSma20Pct: 0.14, minPriorHigh72BreakPct: 0.008 };
      }),
  },
  {
    key: "y2023_style_gate_v1_sleep_other_years",
    capitalMode: "equity_theoretical",
    fraction: 0.45,
    minCashRatio: 0,
    hardStopPct: 0.085,
    trailActivationPct: 0.38,
    trailRetracePct: 0.14,
    maxHoldHours: 24 * 55,
    cooldownHoursBySymbol: { SOL: 168, INJ: 168, DOGE: 168, UNI: 168, TWT: 168 },
    requireBtcTrend: true,
    minBtcMom20: 0,
    requireBtcSmaStack: false,
    minAltStackCount: 5,
    minAltMomentumCount: 4,
    minAltHighBreakCount: 3,
    minAltAvgMom20: 0.09,
    maxPriorAltStackCount: 2,
    priorAltLookbackHours: 24 * 10,
    minAltAvgMom20Expansion: 0.09,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI", "TWT"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 28, minLineBreakPct: 0.03, minVolumeRatio: 1.35, requireSmaStack: true, maxCloseVsSma20Pct: 0.18 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 34, minLineBreakPct: 0.035, minVolumeRatio: 1.55, requireSmaStack: true, maxCloseVsSma20Pct: 0.18 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 34, minLineBreakPct: 0.025, minVolumeRatio: 1.9, requireSmaStack: true, maxCloseVsSma20Pct: 0.14 };
        if (rule.symbol === "UNI") return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 32, minLineBreakPct: 0.025, minVolumeRatio: 1.55, requireSmaStack: true, maxCloseVsSma20Pct: 0.1 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 45, minScore: 36, minVolumeRatio: 2.2, requireSmaStack: true, maxCloseVsSma20Pct: 0.14 };
      }),
  },
  {
    key: "y2023_style_gate_v2_strict_sleep",
    capitalMode: "equity_theoretical",
    fraction: 0.4,
    minCashRatio: 0,
    hardStopPct: 0.08,
    trailActivationPct: 0.36,
    trailRetracePct: 0.13,
    maxHoldHours: 24 * 45,
    cooldownHoursBySymbol: { SOL: 192, INJ: 192, DOGE: 192, UNI: 192 },
    requireBtcTrend: true,
    minBtcMom20: 0.005,
    requireBtcSmaStack: false,
    minAltStackCount: 5,
    minAltMomentumCount: 5,
    minAltHighBreakCount: 3,
    minAltAvgMom20: 0.12,
    maxPriorAltStackCount: 2,
    priorAltLookbackHours: 24 * 10,
    minAltAvgMom20Expansion: 0.12,
    rules: BASE_RULES
      .filter((rule) => ["SOL", "INJ", "DOGE", "UNI"].includes(rule.symbol))
      .map((rule) => {
        if (rule.symbol === "SOL") return { ...rule, startMonth: 0, endMonth: 11, priority: 100, minScore: 34, minLineBreakPct: 0.035, minVolumeRatio: 1.5, requireSmaStack: true, maxCloseVsSma20Pct: 0.14 };
        if (rule.symbol === "INJ") return { ...rule, startMonth: 0, endMonth: 11, priority: 90, minScore: 38, minLineBreakPct: 0.045, minVolumeRatio: 1.8, requireSmaStack: true, maxCloseVsSma20Pct: 0.16 };
        if (rule.symbol === "DOGE") return { ...rule, startMonth: 0, endMonth: 11, priority: 70, minScore: 38, minLineBreakPct: 0.035, minVolumeRatio: 2.2, requireSmaStack: true, maxCloseVsSma20Pct: 0.12 };
        return { ...rule, startMonth: 0, endMonth: 11, priority: 55, minScore: 36, minLineBreakPct: 0.03, minVolumeRatio: 1.8, requireSmaStack: true, maxCloseVsSma20Pct: 0.08 };
      }),
  },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function iso(ts: number) {
  return new Date(ts).toISOString();
}

function monthUtc(ts: number) {
  return new Date(ts).getUTCMonth();
}

function indicatorAtOrBefore(candles: Candle1h[], indicators: IndicatorBar[], ts: number) {
  let lo = 0;
  let hi = candles.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? indicators[best] : null;
}

function btcRegimeOk(variant: Variant, btcCandles: Candle1h[], btcIndicators: IndicatorBar[], ts: number) {
  if (!variant.requireBtcTrend && !variant.requireBtcSmaStack) return true;
  const btc = indicatorAtOrBefore(btcCandles, btcIndicators, ts);
  if (!btc || btc.sma40 <= 0 || btc.sma80 <= 0) return false;
  if (variant.requireBtcTrend && (btc.close <= btc.sma40 || btc.mom20 < (variant.minBtcMom20 ?? 0))) return false;
  if (variant.requireBtcSmaStack && !(btc.sma20 > btc.sma40 && btc.sma40 > btc.sma80)) return false;
  return true;
}

function altRegimeOk(variant: Variant, indicatorMap: Record<SymbolKey, IndicatorBar[]>, candleMap: Record<SymbolKey, Candle1h[]>, ts: number) {
  if (
    variant.minAltStackCount === undefined &&
    variant.minAltMomentumCount === undefined &&
    variant.minAltHighBreakCount === undefined &&
    variant.minAltAvgMom20 === undefined &&
    variant.maxPriorAltStackCount === undefined &&
    variant.minAltAvgMom20Expansion === undefined
  ) {
    return true;
  }
  let stackCount = 0;
  let momentumCount = 0;
  let highBreakCount = 0;
  let priorStackCount = 0;
  const moms: number[] = [];
  const priorMoms: number[] = [];
  const priorTs = ts - (variant.priorAltLookbackHours ?? 24 * 7) * HOUR_MS;
  for (const symbol of SYMBOLS) {
    const bar = indicatorAtOrBefore(candleMap[symbol], indicatorMap[symbol], ts);
    if (!bar || bar.sma40 <= 0 || bar.sma80 <= 0) continue;
    if (bar.close > bar.sma40 && bar.sma20 > bar.sma40) stackCount += 1;
    if (bar.mom20 >= 0.06) momentumCount += 1;
    if (bar.priorHigh72 > 0 && bar.close / bar.priorHigh72 - 1 >= 0.006) highBreakCount += 1;
    moms.push(bar.mom20);
    const prior = indicatorAtOrBefore(candleMap[symbol], indicatorMap[symbol], priorTs);
    if (prior && prior.sma40 > 0) {
      if (prior.close > prior.sma40 && prior.sma20 > prior.sma40) priorStackCount += 1;
      priorMoms.push(prior.mom20);
    }
  }
  const avgMom20 = average(moms);
  const priorAvgMom20 = average(priorMoms);
  if (variant.minAltStackCount !== undefined && stackCount < variant.minAltStackCount) return false;
  if (variant.minAltMomentumCount !== undefined && momentumCount < variant.minAltMomentumCount) return false;
  if (variant.minAltHighBreakCount !== undefined && highBreakCount < variant.minAltHighBreakCount) return false;
  if (variant.minAltAvgMom20 !== undefined && avgMom20 < variant.minAltAvgMom20) return false;
  if (variant.maxPriorAltStackCount !== undefined && priorStackCount > variant.maxPriorAltStackCount) return false;
  if (variant.minAltAvgMom20Expansion !== undefined && avgMom20 - priorAvgMom20 < variant.minAltAvgMom20Expansion) return false;
  return true;
}

function buildIndicators(candles: Candle1h[]): IndicatorBar[] {
  const closes = candles.map((bar) => bar.close);
  const highs = candles.map((bar) => bar.high);
  const lows = candles.map((bar) => bar.low);
  const volumes = candles.map((bar) => bar.volume);
  return candles.map((bar, index) => {
    const sma20 = index >= 19 ? average(closes.slice(index - 19, index + 1)) : 0;
    const sma40 = index >= 39 ? average(closes.slice(index - 39, index + 1)) : 0;
    const sma80 = index >= 79 ? average(closes.slice(index - 79, index + 1)) : 0;
    const volAvg20 = index >= 19 ? average(volumes.slice(index - 19, index + 1)) : 0;
    const mom20 = index >= 20 ? bar.close / candles[index - 20].close - 1 : 0;
    const mom72 = index >= 72 ? bar.close / candles[index - 72].close - 1 : 0;
    const mom120 = index >= 120 ? bar.close / candles[index - 120].close - 1 : 0;
    const priorHigh12 = index >= 12 ? Math.max(...highs.slice(index - 12, index)) : 0;
    const priorHigh24 = index >= 24 ? Math.max(...highs.slice(index - 24, index)) : 0;
    const priorHigh72 = index >= 72 ? Math.max(...highs.slice(index - 72, index)) : 0;
    const priorHigh120 = index >= 120 ? Math.max(...highs.slice(index - 120, index)) : 0;
    const priorLow120 = index >= 120 ? Math.min(...lows.slice(index - 120, index)) : 0;
    const low48 = index >= 48 ? Math.min(...lows.slice(index - 48, index + 1)) : 0;
    return { ...bar, sma20, sma40, sma80, volAvg20, mom20, mom72, mom120, priorHigh12, priorHigh24, priorHigh72, priorHigh120, priorLow120, low48 };
  });
}

function isPivotHigh(candles: Candle1h[], index: number, width: number) {
  const high = candles[index].high;
  for (let i = index - width; i <= index + width; i += 1) {
    if (i === index || i < 0 || i >= candles.length) continue;
    if (candles[i].high >= high) return false;
  }
  return true;
}

function isPivotLow(candles: Candle1h[], index: number, width: number) {
  const low = candles[index].low;
  for (let i = index - width; i <= index + width; i += 1) {
    if (i === index || i < 0 || i >= candles.length) continue;
    if (candles[i].low <= low) return false;
  }
  return true;
}

function passesCommon(bar: IndicatorBar, rule: SymbolRule) {
  const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
  if (volumeRatio < rule.minVolumeRatio) return false;
  if (bar.mom20 < rule.minMom20) return false;
  if (rule.requireSmaStack && (bar.sma40 <= 0 || bar.sma20 <= bar.sma40 || bar.close <= bar.sma40)) return false;
  if (bar.sma20 > 0 && bar.close / bar.sma20 - 1 > rule.maxCloseVsSma20Pct) return false;
  if (rule.minPriorHigh72BreakPct !== undefined && (bar.priorHigh72 <= 0 || bar.close / bar.priorHigh72 - 1 < rule.minPriorHigh72BreakPct)) return false;
  if (rule.minMom72 !== undefined && bar.mom72 < rule.minMom72) return false;
  if (rule.maxMom72 !== undefined && bar.mom72 > rule.maxMom72) return false;
  if (rule.minMom120 !== undefined && bar.mom120 < rule.minMom120) return false;
  if (rule.maxMom120 !== undefined && bar.mom120 > rule.maxMom120) return false;
  if (rule.minCloseVsSma80Pct !== undefined && (bar.sma80 <= 0 || bar.close / bar.sma80 - 1 < rule.minCloseVsSma80Pct)) return false;
  if (rule.maxCloseVsSma80Pct !== undefined && (bar.sma80 <= 0 || bar.close / bar.sma80 - 1 > rule.maxCloseVsSma80Pct)) return false;
  if (rule.minPriorHigh120BreakPct !== undefined && (bar.priorHigh120 <= 0 || bar.close / bar.priorHigh120 - 1 < rule.minPriorHigh120BreakPct)) return false;
  if (rule.maxPriorHigh120BreakPct !== undefined && (bar.priorHigh120 <= 0 || bar.close / bar.priorHigh120 - 1 > rule.maxPriorHigh120BreakPct)) return false;
  if (rule.minDistanceFromLow120Pct !== undefined && (bar.priorLow120 <= 0 || bar.close / bar.priorLow120 - 1 < rule.minDistanceFromLow120Pct)) return false;
  if (rule.maxDistanceFromLow120Pct !== undefined && (bar.priorLow120 <= 0 || bar.close / bar.priorLow120 - 1 > rule.maxDistanceFromLow120Pct)) return false;
  return true;
}

function pivotHighs(candles: Candle1h[], index: number, lookback: number, width: number) {
  const out: Array<{ index: number; ts: number; price: number }> = [];
  const start = Math.max(width, index - lookback);
  const end = Math.max(start, index - width);
  for (let i = start; i <= end; i += 1) {
    if (isPivotHigh(candles, i, width)) out.push({ index: i, ts: candles[i].ts, price: candles[i].high });
  }
  return out;
}

function pivotBreak(symbol: SymbolKey, candles: Candle1h[], indicators: IndicatorBar[], index: number, rule: SymbolRule): Signal | null {
  if (index < 120) return null;
  const bar = indicators[index];
  const prev = indicators[index - 1];
  if (bar.close <= bar.sma20) return null;
  if (!passesCommon(bar, rule)) return null;

  const pivots = pivotHighs(candles, index, 24 * 150, 6).filter((pivot) => pivot.index < index - 3);
  if (pivots.length < 2) return null;

  let best: { a: typeof pivots[number]; b: typeof pivots[number]; lineNow: number; linePrev: number; breakPct: number } | null = null;
  for (let left = Math.max(0, pivots.length - 9); left < pivots.length - 1; left += 1) {
    for (let right = left + 1; right < pivots.length; right += 1) {
      const a = pivots[left];
      const b = pivots[right];
      if (b.index - a.index < 24) continue;
      if (b.price >= a.price * 0.997) continue;
      const slope = (b.price - a.price) / (b.index - a.index);
      const lineNow = a.price + slope * (index - a.index);
      const linePrev = a.price + slope * (index - 1 - a.index);
      const breakPct = bar.close / lineNow - 1;
      const prevBreakPct = prev.close / linePrev - 1;
      if (breakPct >= rule.minLineBreakPct && prevBreakPct < rule.minLineBreakPct) {
        if (!best || breakPct > best.breakPct) best = { a, b, lineNow, linePrev, breakPct };
      }
    }
  }
  if (!best) return null;
  const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
  const score = best.breakPct * 260 + bar.mom20 * 140 + Math.min(5, volumeRatio) * 5;
  if (score < rule.minScore) return null;
  return {
    symbol,
    mode: "pivot_downtrend_break",
    ts: bar.ts,
    price: bar.close,
    index,
    score,
    priority: rule.priority,
    reason: `pivot break ${round(best.breakPct * 100, 2)}%, ${iso(best.a.ts).slice(0, 10)}->${iso(best.b.ts).slice(0, 10)}, vol ${round(volumeRatio, 2)}x`,
  };
}

function halfback(symbol: SymbolKey, candles: Candle1h[], indicators: IndicatorBar[], index: number, rule: SymbolRule): Signal | null {
  if (index < 180) return null;
  const bar = indicators[index];
  if (bar.close <= bar.sma20 || bar.sma20 <= bar.sma40) return null;
  if (bar.close <= Math.max(bar.priorHigh12, bar.priorHigh24 * 0.995)) return null;
  if (!passesCommon(bar, rule)) return null;

  const start = index - 180;
  const recent = candles.slice(start, index + 1);
  const lows = recent.map((_, offset) => start + offset)
    .filter((i) => i >= 6 && i < index - 6 && isPivotLow(candles, i, 6));
  const highs = recent.map((_, offset) => start + offset)
    .filter((i) => i >= 6 && i < index - 6 && isPivotHigh(candles, i, 6));

  let best: { impulsePct: number; retrace: number; breakoutPct: number } | null = null;
  for (const lowIndex of lows.slice(-8)) {
    for (const highIndex of highs.filter((candidate) => candidate > lowIndex + 8 && candidate < index - 6).slice(-6)) {
      const impulseLow = candles[lowIndex].low;
      const impulseHigh = candles[highIndex].high;
      const impulsePct = impulseHigh / impulseLow - 1;
      if (impulsePct < rule.minImpulsePct) continue;
      const pullbackLow = Math.min(...candles.slice(highIndex + 1, index + 1).map((item) => item.low));
      const retrace = (impulseHigh - pullbackLow) / Math.max(0.0000001, impulseHigh - impulseLow);
      if (retrace < (rule.minHalfbackRetrace ?? 0.3) || retrace > (rule.maxHalfbackRetrace ?? 0.74)) continue;
      const breakoutPct = bar.close / impulseHigh - 1;
      if (breakoutPct < -0.02) continue;
      if (!best || impulsePct + Math.max(0, breakoutPct) > best.impulsePct + Math.max(0, best.breakoutPct)) {
        best = { impulsePct, retrace, breakoutPct };
      }
    }
  }
  if (!best) return null;
  const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
  const score = best.impulsePct * 90 + (1 - Math.abs(best.retrace - 0.5)) * 25 + Math.max(0, best.breakoutPct) * 200 + volumeRatio * 4 + bar.mom20 * 100;
  if (score < rule.minScore) return null;
  return {
    symbol,
    mode: "halfback_rebreak",
    ts: bar.ts,
    price: bar.close,
    index,
    score,
    priority: rule.priority,
    reason: `halfback impulse ${round(best.impulsePct * 100, 1)}%, retrace ${round(best.retrace * 100, 1)}%, vol ${round(volumeRatio, 2)}x`,
  };
}

function rangeHighReclaim(symbol: SymbolKey, indicators: IndicatorBar[], index: number, rule: SymbolRule): Signal | null {
  if (index < 90) return null;
  const bar = indicators[index];
  const prev = indicators[index - 1];
  if (!passesCommon(bar, rule)) return null;
  if (bar.priorHigh72 <= 0) return null;
  const reclaimed = bar.close > bar.priorHigh72 * 1.006 && prev.close <= prev.priorHigh72 * 1.006;
  if (!reclaimed) return null;
  if (bar.low48 > 0 && bar.close / bar.low48 - 1 < rule.minImpulsePct * 0.55) return null;
  const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
  const score = (bar.close / bar.priorHigh72 - 1) * 180 + bar.mom20 * 120 + volumeRatio * 5;
  if (score < rule.minScore) return null;
  return {
    symbol,
    mode: "range_high_reclaim",
    ts: bar.ts,
    price: bar.close,
    index,
    score,
    priority: rule.priority,
    reason: `72h high reclaim ${round((bar.close / bar.priorHigh72 - 1) * 100, 2)}%, vol ${round(volumeRatio, 2)}x`,
  };
}

function detectSignals(
  symbol: SymbolKey,
  candles: Candle1h[],
  variant: Variant,
  btcCandles: Candle1h[],
  btcIndicators: IndicatorBar[],
  indicatorMap: Record<SymbolKey, IndicatorBar[]>,
  candleMap: Record<SymbolKey, Candle1h[]>,
) {
  const rules = variant.rules.filter((item) => item.symbol === symbol);
  if (!rules.length) return [];
  const indicators = buildIndicators(candles);
  const signals: Signal[] = [];
  for (const rule of rules) {
    let lastSignalTs = 0;
    const cooldown = (variant.cooldownHoursBySymbol[symbol] ?? 96) * HOUR_MS;
    for (let i = 0; i < candles.length - 2; i += 1) {
      const ts = candles[i].ts;
      if (ts < START_TS || ts > END_TS) continue;
      if (!btcRegimeOk(variant, btcCandles, btcIndicators, ts)) continue;
      if (!altRegimeOk(variant, indicatorMap, candleMap, ts)) continue;
      if (rule.startAfterTs !== undefined && ts < rule.startAfterTs) continue;
      if (rule.endBeforeTs !== undefined && ts >= rule.endBeforeTs) continue;
      const month = monthUtc(ts);
      if (month < rule.startMonth || month > rule.endMonth) continue;
      if (ts - lastSignalTs < cooldown) continue;
      const candidates = [
        rule.modes.includes("pivot_downtrend_break") ? pivotBreak(symbol, candles, indicators, i, rule) : null,
        rule.modes.includes("halfback_rebreak") ? halfback(symbol, candles, indicators, i, rule) : null,
        rule.modes.includes("range_high_reclaim") ? rangeHighReclaim(symbol, indicators, i, rule) : null,
      ].filter(Boolean) as Signal[];
      if (!candidates.length) continue;
      const chosen = candidates.sort((left, right) => right.priority - left.priority || right.score - left.score)[0];
      signals.push(chosen);
      lastSignalTs = chosen.ts;
    }
  }
  return signals.sort((left, right) => left.ts - right.ts || right.priority - left.priority || right.score - left.score);
}

function pointAtOrBefore(points: EquityPoint[], ts: number) {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? points[best] : null;
}

function simulateTrade(signal: Signal, candles: Candle1h[], variant: Variant, notionalUsd: number, basePosition: string): Trade | null {
  const entryIndex = signal.index + 1;
  if (entryIndex >= candles.length - 2) return null;
  const entry = candles[entryIndex];
  const entryPrice = entry.open;
  let peak = entryPrice;
  let exit = candles[Math.min(candles.length - 1, entryIndex + variant.maxHoldHours)];
  let exitPrice = exit.close;
  let exitReason = "max-hold";

  for (let i = entryIndex + 1; i < candles.length && i <= entryIndex + variant.maxHoldHours; i += 1) {
    const bar = candles[i];
    peak = Math.max(peak, bar.high);
    if (bar.low <= entryPrice * (1 - variant.hardStopPct)) {
      exit = bar;
      exitPrice = entryPrice * (1 - variant.hardStopPct);
      exitReason = "hard-stop";
      break;
    }
    if (peak >= entryPrice * (1 + variant.trailActivationPct) && bar.close <= peak * (1 - variant.trailRetracePct)) {
      exit = bar;
      exitPrice = bar.close;
      exitReason = "profit-trail";
      break;
    }
  }

  const netReturn = (exitPrice / entryPrice - 1) - FEE_RATE * 2 - (variant.quoteCostPct || 0);
  return {
    ...signal,
    entryTs: entry.ts,
    exitTs: exit.ts,
    entryPrice,
    exitPrice,
    notionalUsd,
    netReturnPct: netReturn * 100,
    netPnl: notionalUsd * netReturn,
    exitReason,
    basePosition,
  };
}

function simulate(
  variant: Variant,
  equityPoints: EquityPoint[],
  candlesBySymbol: Record<SymbolKey, Candle1h[]>,
  btcCandles: Candle1h[],
  btcIndicators: IndicatorBar[],
) {
  const indicatorMap = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, buildIndicators(candlesBySymbol[symbol])])) as Record<SymbolKey, IndicatorBar[]>;
  const allSignals = SYMBOLS
    .flatMap((symbol) => detectSignals(symbol, candlesBySymbol[symbol], variant, btcCandles, btcIndicators, indicatorMap, candlesBySymbol))
    .sort((left, right) => left.ts - right.ts || right.priority - left.priority || right.score - left.score);
  const trades: Trade[] = [];
  let busyUntil = 0;

  for (const groupStart of allSignals) {
    if (groupStart.ts < busyUntil) continue;
    const sameHour = allSignals
      .filter((signal) => signal.ts === groupStart.ts)
      .sort((left, right) => right.priority - left.priority || right.score - left.score);
    const signal = sameHour[0];
    if (signal.ts < busyUntil) continue;
    const point = pointAtOrBefore(equityPoints, signal.ts);
    if (!point) continue;
    if (variant.requireCashPosition && point.position_side !== "cash") continue;
    if (variant.capitalMode === "cash_only" && (point.cash < 25 || point.cash / Math.max(1, point.equity) < variant.minCashRatio)) continue;
    const baseCapital = variant.capitalMode === "cash_only" ? point.cash : point.equity;
    const notionalUsd = Math.min(baseCapital * variant.fraction, variant.maxNotionalUsd || Number.POSITIVE_INFINITY);
    if (notionalUsd < 10) continue;
    const trade = simulateTrade(signal, candlesBySymbol[signal.symbol], variant, notionalUsd, point.position_symbol);
    if (!trade) continue;
    trades.push(trade);
    busyUntil = trade.exitTs;
  }

  const addedPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const wins = trades.filter((trade) => trade.netPnl > 0).length;
  const grossProfit = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netPnl <= 0).reduce((sum, trade) => sum + trade.netPnl, 0));
  const symbolPnl = trades.reduce<Record<string, { trades: number; wins: number; pnl: number }>>((acc, trade) => {
    acc[trade.symbol] ??= { trades: 0, wins: 0, pnl: 0 };
    acc[trade.symbol].trades += 1;
    acc[trade.symbol].wins += trade.netPnl > 0 ? 1 : 0;
    acc[trade.symbol].pnl += trade.netPnl;
    return acc;
  }, {});
  return {
    variant,
    signals: allSignals.length,
    trades,
    addedPnl,
    winPct: trades.length ? wins / trades.length * 100 : 0,
    pf: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    symbolPnl,
  };
}

async function loadCandles() {
  const [pairs, btcCandles] = await Promise.all([
    Promise.all(SYMBOLS.map(async (symbol) => {
      const candles = await loadHistoricalCandles({
        symbol: `${symbol}USDT`,
        interval: "1h",
        startMs: LOAD_START_TS,
        endMs: END_TS,
        cacheRoot: CACHE_ROOT,
      });
      return [symbol, candles] as const;
    })),
    loadHistoricalCandles({
      symbol: "BTCUSDT",
      interval: "1h",
      startMs: LOAD_START_TS,
      endMs: END_TS,
      cacheRoot: CACHE_ROOT,
    }),
  ]);
  return {
    candlesBySymbol: Object.fromEntries(pairs) as Record<SymbolKey, Candle1h[]>,
    btcCandles,
    btcIndicators: buildIndicators(btcCandles),
  };
}

function summaryLine(baseEnd: number, row: ReturnType<typeof simulate>) {
  return `| ${row.variant.key} | ${row.signals} | ${row.trades.length} | ${round(row.winPct, 1)}% | ${round(row.pf, 3)} | ${round(row.addedPnl, 2).toLocaleString()} | ${round(baseEnd + row.addedPnl, 2).toLocaleString()} | ${JSON.stringify(Object.fromEntries(Object.entries(row.symbolPnl).map(([k, v]) => [k, { trades: v.trades, wins: v.wins, pnl: round(v.pnl, 2) }]))) } |`;
}

function tradesMarkdown(row: ReturnType<typeof simulate>) {
  return row.trades.map((trade, index) =>
    `| ${index + 1} | ${trade.symbol} | ${trade.mode} | ${iso(trade.entryTs)} | ${iso(trade.exitTs)} | ${round(trade.entryPrice, 6)} | ${round(trade.exitPrice, 6)} | ${round(trade.netReturnPct, 2)}% | ${round(trade.netPnl, 2).toLocaleString()} | ${trade.exitReason} | ${trade.basePosition} | ${trade.reason} |`,
  ).join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const options: HybridVariantOptions = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_2023_dedicated_base",
  };
  const [base, candleSet] = await Promise.all([
    runHybridBacktest("RETQ22", options),
    loadCandles(),
  ]);
  const equityPoints = [...base.equity_curve].sort((left, right) => left.ts - right.ts);
  const variants = process.env.ONLY_UNI_SAFE === "1"
    ? VARIANTS.filter((variant) => variant.key.startsWith("uni_safe_cash_only"))
    : process.env.ONLY_ALT_BIGWAVE === "1"
      ? VARIANTS.filter((variant) => variant.key.startsWith("alt_breadth_bigwave"))
    : process.env.ONLY_WAVE_FILTERS === "1"
      ? VARIANTS.filter((variant) => variant.key.startsWith("wave_filter_"))
    : process.env.ONLY_NON_SOL === "1"
      ? VARIANTS.filter((variant) => variant.key.startsWith("non_sol_"))
    : process.env.EXACT_VARIANT
      ? VARIANTS.filter((variant) => variant.key === process.env.EXACT_VARIANT)
    : VARIANTS;
  const rows = variants.map((variant) => simulate(
    variant,
    equityPoints,
    candleSet.candlesBySymbol,
    candleSet.btcCandles,
    candleSet.btcIndicators,
  ))
    .sort((left, right) => right.addedPnl - left.addedPnl);
  const best = rows[0];

  const lines = [
    `# V7 ${IS_ALL_PERIOD ? "2022-2026" : TARGET_YEAR} Dedicated Pattern`,
    "",
    `- Scope: ${IS_ALL_PERIOD ? "2022-01-01 to 2026-04-29" : TARGET_YEAR}`,
    "- Purpose: convert the 2023 trendline breakout / halfback continuation lessons into research variants.",
    "- Entry: next 1H open after signal close.",
    "- Signal conflict priority: SOL > AVAX > INJ > DOGE > UNI > TWT > ETH.",
    "- This is research logic, not deployed.",
    "",
    `Baseline End Equity: ${round(base.summary.end_equity, 2).toLocaleString()}`,
    "",
    "## Logic Summary",
    "",
    "| symbol | role | months | main patterns | priority |",
    "| --- | --- | --- | --- | ---: |",
    "| SOL | main long runner | Jun-Dec | trendline break / halfback / 72h reclaim | 100 |",
    "| AVAX | late bull accelerator | Oct-Dec | trendline break / halfback / 72h reclaim | 90 |",
    "| INJ | momentum helper | Mar-Dec | stricter trendline / halfback | 80 |",
    "| DOGE | selective continuation | Mar-Dec | stricter halfback / breakout / reclaim | 70 |",
    "| UNI | summer helper only | Jun-Aug | stricter breakout / reclaim | 55 |",
    "| TWT, ETH | low priority backup | Oct-Dec | reclaim only | 35 / 20 |",
    "",
    "## Results",
    "",
    "| variant | signals | trades | win | PF | added PnL | end equity | symbol pnl |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => summaryLine(base.summary.end_equity, row)),
    "",
    `## Best Trades: ${best.variant.key}`,
    "",
    "| # | symbol | mode | entry | exit | entry price | exit price | net return | net pnl | exit | base position | reason |",
    "| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
    tradesMarkdown(best) || "| - | - | - | - | - | - | - | - | - | - | - | - |",
  ];

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: base.summary,
    rows: rows.map((row) => ({
      key: row.variant.key,
      signals: row.signals,
      trades: row.trades.length,
      winPct: round(row.winPct, 1),
      pf: round(row.pf, 3),
      addedPnl: round(row.addedPnl, 2),
      endEquity: round(base.summary.end_equity + row.addedPnl, 2),
      symbolPnl: Object.fromEntries(Object.entries(row.symbolPnl).map(([k, v]) => [k, { trades: v.trades, wins: v.wins, pnl: round(v.pnl, 2) }])),
    })),
  }, null, 2), "utf8");
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
