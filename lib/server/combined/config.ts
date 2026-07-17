import type { CombinedStrategyMode } from "@/lib/server/combined/types";

export const COMBINED_STRATEGY_ID = "combined" as const;
export const COMBINED_EXECUTION_SYMBOL = "PENGU/USDT";
export const COMBINED_MARKET_SYMBOL = process.env.ASTER_MARKET_SYMBOL_PENGU?.trim() || "PENGUUSDT";
export const COMBINED_HYPE_EXECUTION_SYMBOL = "HYPE/USDT";
export const COMBINED_HYPE_MARKET_SYMBOL = process.env.ASTER_MARKET_SYMBOL_HYPE?.trim() || "HYPEUSDT";
export const COMBINED_ETH_EXECUTION_SYMBOL = "ETH/USDT";
export const COMBINED_ETH_MARKET_SYMBOL = process.env.ASTER_MARKET_SYMBOL_ETH?.trim() || "ETHUSDT";
export const COMBINED_REFERENCE_SIGNAL = "BTC 15m GoldCat";

export const COMBINED_ENTRY_CONFIG = {
  minMoveBps: 5,
  minBidSupportRatio: 0.8,
  maxEntrySpreadBps: 180,
  minElapsedSec: 90,
  maxElapsedSec: 240,
  maxEntryPrice: 0.6,
  breakoutBps: 8,
  breakoutConfirmMinutes: 4,
} as const;

export const COMBINED_EXIT_CONFIG = {
  holdMinutes: 25,
  minStopLossHoldMinutes: Number(process.env.COMBINED_MIN_STOP_LOSS_HOLD_MINUTES || 10),
  stopLossPct: Number(process.env.COMBINED_STOP_LOSS_PCT || 0.0045),
  takeProfitPct: 0.025,
  trailActivationPct: 0.01,
  trailRetracePct: 0.005,
} as const;

export const COMBINED_SIZING_CONFIG = {
  weakAlignedSize: 1.25,
  strongAlignedSize: 2.0,
  unalignedSize: 0.75,
  strongMoveBps: 8,
  strongAccelBps: 2,
} as const;

export const COMBINED_PENGU_GUARD_CONFIG = {
  allowShortEntries: ["1", "true", "yes", "on"].includes((process.env.COMBINED_PENGU_ALLOW_SHORT_ENTRIES || "false").trim().toLowerCase()),
  requireAlignmentForEntry: ["1", "true", "yes", "on"].includes((process.env.COMBINED_PENGU_REQUIRE_ALIGNMENT_FOR_ENTRY || "false").trim().toLowerCase()),
  maxSameSideEntries: Number(process.env.COMBINED_PENGU_MAX_SAME_SIDE_ENTRIES || 1),
  addEntryCooldownMinutes: Number(process.env.COMBINED_PENGU_ADD_ENTRY_COOLDOWN_MINUTES || 10),
  minAddEntryPnlPct: Number(process.env.COMBINED_PENGU_MIN_ADD_ENTRY_PNL_PCT || 0.003),
  cooldownAfterStopMinutes: Number(process.env.COMBINED_PENGU_COOLDOWN_AFTER_STOP_MINUTES || 15),
  cooldownAfterReverseMinutes: Number(process.env.COMBINED_PENGU_COOLDOWN_AFTER_REVERSE_MINUTES || 15),
} as const;

export const COMBINED_HYPE_FREQ_CONFIG = {
  enabled: ["1", "true", "yes", "on"].includes((process.env.COMBINED_HYPE_FREQ_ENABLED || "true").trim().toLowerCase()),
  btcMinMoveBps: Number(process.env.COMBINED_HYPE_FREQ_BTC_MIN_MOVE_BPS || 3),
  btcMinAccelBps: Number(process.env.COMBINED_HYPE_FREQ_BTC_MIN_ACCEL_BPS || -1),
  btcMaxMoveBps: Number(process.env.COMBINED_HYPE_FREQ_BTC_MAX_MOVE_BPS || 45),
  symbolMinMoveBps: Number(process.env.COMBINED_HYPE_FREQ_MIN_MOVE_BPS || 8),
  symbolMinAccelBps: Number(process.env.COMBINED_HYPE_FREQ_MIN_ACCEL_BPS || -1),
  symbolMaxDistanceBps: Number(process.env.COMBINED_HYPE_FREQ_MAX_DISTANCE_BPS || 65),
  breakoutBps: Number(process.env.COMBINED_HYPE_FREQ_BREAKOUT_BPS || 8),
  breakoutConfirmMinutes: Number(process.env.COMBINED_HYPE_FREQ_CONFIRM_MINUTES || 5),
  holdMinutes: Number(process.env.COMBINED_HYPE_FREQ_HOLD_MINUTES || 25),
  minStopLossHoldMinutes: Number(process.env.COMBINED_HYPE_FREQ_MIN_STOP_LOSS_HOLD_MINUTES || 10),
  stopLossPct: Number(process.env.COMBINED_HYPE_FREQ_STOP_LOSS_PCT || 0.0045),
  takeProfitPct: Number(process.env.COMBINED_HYPE_FREQ_TAKE_PROFIT_PCT || 0.018),
  trailActivationPct: Number(process.env.COMBINED_HYPE_FREQ_TRAIL_ACTIVATION_PCT || 0.008),
  trailRetracePct: Number(process.env.COMBINED_HYPE_FREQ_TRAIL_RETRACE_PCT || 0.004),
  sizeMultiplier: Number(process.env.COMBINED_HYPE_FREQ_SIZE_MULTIPLIER || 1),
} as const;

export const COMBINED_ETH_RECLAIM_CONFIG = {
  enabled: ["1", "true", "yes", "on"].includes((process.env.COMBINED_ETH_RECLAIM_ENABLED || "true").trim().toLowerCase()),
  regimeMaxDistanceBps: Number(process.env.COMBINED_ETH_RECLAIM_REGIME_MAX_DISTANCE_BPS || 95),
  regimeMinMoveBps: Number(process.env.COMBINED_ETH_RECLAIM_REGIME_MIN_MOVE_BPS || 0),
  regimeMinAccelBps: Number(process.env.COMBINED_ETH_RECLAIM_REGIME_MIN_ACCEL_BPS || -10),
  recentTouchBars: Number(process.env.COMBINED_ETH_RECLAIM_RECENT_TOUCH_BARS || 5),
  touchToleranceBps: Number(process.env.COMBINED_ETH_RECLAIM_TOUCH_TOLERANCE_BPS || 36),
  reclaimMinMoveBps: Number(process.env.COMBINED_ETH_RECLAIM_MIN_MOVE_BPS || 2),
  reclaimMinBodyBps: Number(process.env.COMBINED_ETH_RECLAIM_MIN_BODY_BPS || 1),
  breakoutBps: Number(process.env.COMBINED_ETH_RECLAIM_BREAKOUT_BPS || 2),
  breakoutConfirmMinutes: Number(process.env.COMBINED_ETH_RECLAIM_CONFIRM_MINUTES || 7),
  holdMinutes: Number(process.env.COMBINED_ETH_RECLAIM_HOLD_MINUTES || 38),
  minStopLossHoldMinutes: Number(process.env.COMBINED_ETH_RECLAIM_MIN_STOP_LOSS_HOLD_MINUTES || 10),
  stopLossPct: Number(process.env.COMBINED_ETH_RECLAIM_STOP_LOSS_PCT || 0.0045),
  takeProfitPct: Number(process.env.COMBINED_ETH_RECLAIM_TAKE_PROFIT_PCT || 0.0105),
  trailActivationPct: Number(process.env.COMBINED_ETH_RECLAIM_TRAIL_ACTIVATION_PCT || 0.0045),
  trailRetracePct: Number(process.env.COMBINED_ETH_RECLAIM_TRAIL_RETRACE_PCT || 0.0025),
  btcCrashFilterBps: Number(process.env.COMBINED_ETH_RECLAIM_BTC_CRASH_FILTER_BPS || -35),
  btcTrendMinBps: Number(process.env.COMBINED_ETH_RECLAIM_BTC_TREND_MIN_BPS || -20),
  sizeMultiplier: Number(process.env.COMBINED_ETH_RECLAIM_SIZE_MULTIPLIER || 1),
} as const;

export const COMBINED_RISK_CONFIG = {
  staleSignalMinutes: 20,
  maxConcurrentPositions: 2,
  minNotionalUsd: 10,
  minTradeBalanceUsd: 10,
  usdtMinimumBufferUsd: Number(process.env.COMBINED_USDT_MINIMUM_BUFFER_USD || 50),
  smallBalanceThresholdUsd: 20,
  smallBalanceEntryFraction: 0.95,
  reserveFraction: 0.4,
  minReserveUsd: 20,
  maxRetries: 2,
} as const;

export const COMBINED_ENTRY_FRACTIONS = {
  pengu_goldcat: {
    baseEntryFraction: Number(process.env.COMBINED_PENGU_BASE_ENTRY_FRACTION || 0.6),
    maxEntryFraction: Number(process.env.COMBINED_PENGU_MAX_ENTRY_FRACTION || 0.9),
  },
  hype_freq: {
    baseEntryFraction: Number(process.env.COMBINED_HYPE_BASE_ENTRY_FRACTION || 0.5),
    maxEntryFraction: Number(process.env.COMBINED_HYPE_MAX_ENTRY_FRACTION || 0.8),
  },
  eth_reclaim: {
    baseEntryFraction: Number(process.env.COMBINED_ETH_BASE_ENTRY_FRACTION || 0.5),
    maxEntryFraction: Number(process.env.COMBINED_ETH_MAX_ENTRY_FRACTION || 0.8),
  },
} as const;

export const COMBINED_USDF_AUTO_CONVERT_CONFIG = {
  enabled: ["1", "true", "yes", "on"].includes((process.env.COMBINED_USDF_AUTO_CONVERT_ENABLED || "").trim().toLowerCase()),
  chunkUsd: Number(process.env.COMBINED_USDF_AUTO_CONVERT_CHUNK_USD || 50),
  minRemainingUsdtUsd: Number(process.env.COMBINED_USDF_AUTO_CONVERT_MIN_REMAINING_USDT_USD || 50),
  minWalletUsdfDepositUsd: Number(process.env.COMBINED_USDF_AUTO_CONVERT_MIN_WALLET_USDF_DEPOSIT_USD || 45),
  brokerId: Number(process.env.COMBINED_USDF_AUTO_CONVERT_BROKER_ID || 1),
  settleTimeoutMs: Number(process.env.COMBINED_USDF_AUTO_CONVERT_SETTLE_TIMEOUT_MS || 300000),
  settlePollMs: Number(process.env.COMBINED_USDF_AUTO_CONVERT_SETTLE_POLL_MS || 10000),
  cooldownMinutes: Number(process.env.COMBINED_USDF_AUTO_CONVERT_COOLDOWN_MINUTES || 20),
} as const;

export function strategyModeFromActiveStrategy(activeStrategy: string): CombinedStrategyMode {
  return activeStrategy === "combined_live" ? "live" : "dry_run";
}
