import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  RECLAIM_HYBRID_STRATEGY_ID,
  RECLAIM_HYBRID_SLIPPAGE_BPS,
  type ReclaimHybridExecutionProfile,
} from "./reclaimHybridStrategy";

export type StrategyMode = "A_ATTACK" | "A_BALANCE";
export const STRATEGY_MODE_STORAGE_KEY = "disdex_strategy_mode";

export interface BnbRotationPreset {
  mode: StrategyMode;
  btcSma: number;
  candidateSma: number;
  rebalanceBars: number;
  avaxMomThreshold: number;
  solOverheatLimit: number;
  targetAlloc: number;
  feeRate: number;
}

export interface StrategyPreset extends BnbRotationPreset {
  mode: StrategyMode;
  displayLabel: string;
  strategyId: typeof RECLAIM_HYBRID_STRATEGY_ID;
  engine: "RECLAIM_HYBRID_V1";
  feeRate: number;
  targetAlloc: number;
  maxConcurrentPositions: number;
  maxTradeSizePct: number;
  stableReservePct: number;
  hardStopLossPct: number;
  maxSlippageBps: number;
  quoteProviders: readonly string[];
  priceProviders: readonly string[];
  symbols: {
    btc: string;
    core: string[];
    avax: string;
    aux: string[];
    reserve: string;
    tracked: string[];
  };
  profile: ReclaimHybridExecutionProfile;
}

function buildPreset(mode: StrategyMode, displayLabel: string): StrategyPreset {
  return {
    mode,
    displayLabel,
    strategyId: RECLAIM_HYBRID_STRATEGY_ID,
    engine: "RECLAIM_HYBRID_V1",
    feeRate: RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate,
    targetAlloc: RECLAIM_HYBRID_EXECUTION_PROFILE.targetAlloc,
    maxConcurrentPositions: RECLAIM_HYBRID_EXECUTION_PROFILE.maxConcurrentPositions,
    maxTradeSizePct: RECLAIM_HYBRID_EXECUTION_PROFILE.maxTradeSizePct,
    stableReservePct: RECLAIM_HYBRID_EXECUTION_PROFILE.stableReservePct,
    hardStopLossPct: RECLAIM_HYBRID_EXECUTION_PROFILE.hardStopLossPct,
    maxSlippageBps: Math.max(45, ...Object.values(RECLAIM_HYBRID_SLIPPAGE_BPS)),
    quoteProviders: [...RECLAIM_HYBRID_EXECUTION_PROFILE.quoteProviders],
    priceProviders: [...RECLAIM_HYBRID_EXECUTION_PROFILE.priceProviders],
    symbols: {
      btc: RECLAIM_HYBRID_EXECUTION_PROFILE.referenceSymbol,
      core: [...RECLAIM_HYBRID_EXECUTION_PROFILE.primaryRange.symbols],
      avax: "AVAX",
      aux: [...RECLAIM_HYBRID_EXECUTION_PROFILE.auxRange.symbols],
      reserve: RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol,
      tracked: [...RECLAIM_HYBRID_EXECUTION_PROFILE.trackedSymbols],
    },
    profile: RECLAIM_HYBRID_EXECUTION_PROFILE,
    btcSma: 90,
    candidateSma: 40,
    rebalanceBars: 11,
    avaxMomThreshold: 0.25,
    solOverheatLimit: 0.35,
  };
}

export const STRATEGY_PRESETS: Record<StrategyMode, StrategyPreset> = {
  A_ATTACK: buildPreset("A_ATTACK", "Attack"),
  A_BALANCE: buildPreset("A_BALANCE", "Balance"),
} as const;

export const BNB_ROTATION_SYMBOLS = {
  btc: RECLAIM_HYBRID_EXECUTION_PROFILE.referenceSymbol,
  core: RECLAIM_HYBRID_EXECUTION_PROFILE.primaryRange.symbols,
  avax: "AVAX",
} as const;

export interface StrategyRuntimeConfig {
  strategy_mode: StrategyMode;
  fee_rate?: number;
  target_alloc?: number;
  engine?: StrategyPreset["engine"];
  strategy_id?: typeof RECLAIM_HYBRID_STRATEGY_ID;
  max_concurrent_positions?: number;
  max_trade_size_pct?: number;
  stable_reserve_pct?: number;
  hard_stop_loss_pct?: number;
  max_slippage_bps?: number;
  quote_providers?: string[];
  price_providers?: string[];
  symbols?: {
    btc: string;
    core: string[];
    avax: string;
    aux: string[];
    reserve: string;
    tracked: string[];
  };
}

export function isStrategyMode(value: string): value is StrategyMode {
  return value === "A_ATTACK" || value === "A_BALANCE";
}

export function normalizeStrategyMode(value?: string | null): StrategyMode {
  const normalized = String(value || "").trim().toUpperCase();
  return isStrategyMode(normalized) ? normalized : "A_BALANCE";
}

export function selectStrategyPreset(strategyMode?: string | null) {
  return STRATEGY_PRESETS[normalizeStrategyMode(strategyMode)];
}

export function getStoredStrategyMode(): StrategyMode | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STRATEGY_MODE_STORAGE_KEY);
  return raw ? normalizeStrategyMode(raw) : null;
}

export function setStoredStrategyMode(mode: StrategyMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STRATEGY_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new Event("storage"));
}

export function getStrategyModeFromEnv(): StrategyMode {
  const stored = getStoredStrategyMode();
  if (stored) return stored;
  const raw = String(process.env.STRATEGY_MODE || "A_BALANCE").trim().toUpperCase();
  return raw === "A_ATTACK" ? "A_ATTACK" : "A_BALANCE";
}

export function resolveStrategyRuntimeConfig(input?: Partial<StrategyRuntimeConfig>): StrategyRuntimeConfig {
  const preset = selectStrategyPreset(input?.strategy_mode ?? getStrategyModeFromEnv());
  return {
    strategy_mode: preset.mode,
    fee_rate: input?.fee_rate ?? preset.feeRate,
    target_alloc: input?.target_alloc ?? preset.targetAlloc,
    engine: input?.engine ?? preset.engine,
    strategy_id: input?.strategy_id ?? preset.strategyId,
    max_concurrent_positions: input?.max_concurrent_positions ?? preset.maxConcurrentPositions,
    max_trade_size_pct: input?.max_trade_size_pct ?? preset.maxTradeSizePct,
    stable_reserve_pct: input?.stable_reserve_pct ?? preset.stableReservePct,
    hard_stop_loss_pct: input?.hard_stop_loss_pct ?? preset.hardStopLossPct,
    max_slippage_bps: input?.max_slippage_bps ?? preset.maxSlippageBps,
    quote_providers: input?.quote_providers ?? [...preset.quoteProviders],
    price_providers: input?.price_providers ?? [...preset.priceProviders],
    symbols: input?.symbols ?? {
      btc: preset.symbols.btc,
      core: [...preset.symbols.core],
      avax: preset.symbols.avax,
      aux: [...preset.symbols.aux],
      reserve: preset.symbols.reserve,
      tracked: [...preset.symbols.tracked],
    },
  };
}
