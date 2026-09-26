import {
  HYPE_ZEC_LONG_POLICY,
  type HypeZecStrategy,
} from "../config/hypeZecLongPolicy";

const FIFTEEN_MINUTES_MS = 15 * 60_000;
const MAX_DATA_AGE_MS = 20 * 60_000;

export type HypeZecCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HypeZecSignalInput = {
  now: number;
  btc15m: readonly HypeZecCandle[];
  symbol15m: readonly HypeZecCandle[];
  symbol1m: readonly HypeZecCandle[];
};

export type HypeZecSignalResult = {
  accepted: boolean;
  strategy: HypeZecStrategy;
  symbol: "HYPEUSDT" | "ZECUSDT";
  side: "LONG" | "FLAT";
  signalTs: number | null;
  entryPrice: number | null;
  stopPrice: number | null;
  takeProfitPrice: number | null;
  reason: string;
};

export type HypeZecQuantityInput = {
  strategy: HypeZecStrategy;
  equityUsd: number;
  entryPrice: number;
  stopPrice: number;
  feeBpsPerSide: number;
  slippageBps: number;
  fundingBps: number;
  stepSize: number;
};

export type HypeZecQuantityResult = {
  strategy: HypeZecStrategy;
  quantity: number;
  riskQuantity: number;
  grossQuantity: number;
  riskBudgetUsd: number;
  worstCaseLossUsd: number;
  gross: number;
  leverage: 5;
  marginType: "cross";
  reason: string;
};

export type HypeZecProtectionInput = {
  strategy: HypeZecStrategy;
  entryPrice: number;
  tickSize: number;
  quantity: number;
  stepSize: number;
};

export type HypeZecProtectionResult = {
  strategy: HypeZecStrategy;
  symbol: "HYPEUSDT" | "ZECUSDT";
  quantity: number;
  stopPrice: number;
  takeProfitPrice: number;
  reduceOnly: true;
};

function finitePositive(value: unknown, name: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name}_INVALID`);
  return parsed;
}

function latestCompleted(candles: readonly HypeZecCandle[], now: number) {
  return candles
    .filter((row) => Number.isFinite(row.ts) && row.ts > 0 && row.ts + FIFTEEN_MINUTES_MS <= now)
    .sort((left, right) => left.ts - right.ts)
    .at(-1) || null;
}

function ema(candles: readonly HypeZecCandle[], period: number) {
  const alpha = 2 / (period + 1);
  let value: number | null = null;
  for (const row of candles) value = value == null ? row.close : row.close * alpha + value * (1 - alpha);
  return value || 0;
}

function moveBps(current: HypeZecCandle, previous: HypeZecCandle) {
  return ((current.close / previous.close) - 1) * 10_000;
}

function rejected(strategy: HypeZecStrategy, reason: string): HypeZecSignalResult {
  const policy = HYPE_ZEC_LONG_POLICY[strategy];
  return {
    accepted: false,
    strategy,
    symbol: policy.symbol,
    side: "FLAT",
    signalTs: null,
    entryPrice: null,
    stopPrice: null,
    takeProfitPrice: null,
    reason,
  };
}

function evaluateLong(strategy: HypeZecStrategy, input: HypeZecSignalInput): HypeZecSignalResult {
  const policy = HYPE_ZEC_LONG_POLICY[strategy];
  if (!Number.isFinite(input.now) || input.now <= 0) return rejected(strategy, "DATA_INVALID_NOW");
  const btc = [...input.btc15m].sort((left, right) => left.ts - right.ts);
  const symbol = [...input.symbol15m].sort((left, right) => left.ts - right.ts);
  const btcLatest = latestCompleted(btc, input.now);
  const symbolLatest = latestCompleted(symbol, input.now);
  if (!btcLatest || !symbolLatest || btc.length < 3 || symbol.length < 3) return rejected(strategy, "INSUFFICIENT_COMPLETED_15M_DATA");
  if (input.now - btcLatest.ts > MAX_DATA_AGE_MS || input.now - symbolLatest.ts > MAX_DATA_AGE_MS) return rejected(strategy, "STALE_15M_DATA");
  if (!(btcLatest.close > 0 && symbolLatest.close > 0)) return rejected(strategy, "DATA_INVALID_PRICE");

  const btcPrevious = btc.filter((row) => row.ts < btcLatest.ts).at(-1);
  const symbolPrevious = symbol.filter((row) => row.ts < symbolLatest.ts).at(-1);
  const btcBeforePrevious = btc.filter((row) => row.ts < (btcPrevious?.ts || 0)).at(-1);
  const symbolBeforePrevious = symbol.filter((row) => row.ts < (symbolPrevious?.ts || 0)).at(-1);
  if (!btcPrevious || !symbolPrevious || !btcBeforePrevious || !symbolBeforePrevious) return rejected(strategy, "INSUFFICIENT_COMPLETED_15M_HISTORY");
  const btcMove = moveBps(btcLatest, btcPrevious);
  const btcPreviousMove = moveBps(btcPrevious, btcBeforePrevious);
  const btcAccel = btcMove - btcPreviousMove;
  const symbolMove = moveBps(symbolLatest, symbolPrevious);
  const symbolPreviousMove = moveBps(symbolPrevious, symbolBeforePrevious);
  const symbolAccel = symbolMove - symbolPreviousMove;
  const symbolEma20 = ema(symbol.slice(0, symbol.indexOf(symbolLatest) + 1), 20);
  const distanceFromEmaBps = Math.abs((symbolLatest.close / Math.max(symbolEma20, 0.0000001) - 1) * 10_000);
  const signal = policy.signal;
  if (btcMove < signal.btcMinMoveBps || btcAccel < signal.btcMinAccelBps || btcMove > signal.btcMaxMoveBps) return rejected(strategy, "BTC_GATE_NOT_MET");
  if (symbolMove < signal.symbolMinMoveBps || symbolAccel < signal.symbolMinAccelBps) return rejected(strategy, "SYMBOL_MOMENTUM_NOT_MET");
  if (distanceFromEmaBps > signal.symbolMaxDistanceBps) return rejected(strategy, "SYMBOL_TOO_FAR_FROM_EMA");

  const confirmUntil = symbolLatest.ts + FIFTEEN_MINUTES_MS + signal.breakoutConfirmMinutes * 60_000;
  const breakout = input.symbol1m
    .filter((row) => row.ts >= symbolLatest.ts + FIFTEEN_MINUTES_MS && row.ts <= confirmUntil && row.ts <= input.now)
    .sort((left, right) => left.ts - right.ts)
    .find((row) => row.high >= symbolLatest.close * (1 + signal.breakoutBps / 10_000));
  if (!breakout) return rejected(strategy, "BREAKOUT_CONFIRMATION_NOT_MET");
  const entryPrice = Number(breakout.close);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return rejected(strategy, "ENTRY_PRICE_INVALID");
  const protection = buildHypeZecProtection({
    strategy,
    entryPrice,
    tickSize: 0.00000001,
    quantity: 1,
    stepSize: 0.00000001,
  });
  return {
    accepted: true,
    strategy,
    symbol: policy.symbol,
    side: "LONG",
    signalTs: symbolLatest.ts,
    entryPrice,
    stopPrice: protection.stopPrice,
    takeProfitPrice: protection.takeProfitPrice,
    reason: `${strategy}_COMPLETED_15M_MOMENTUM_BREAKOUT_CONFIRMED`,
  };
}

export function evaluateHypeLongSignal(input: HypeZecSignalInput) {
  return evaluateLong("HYPE_LONG", input);
}

export function evaluateZecLongSignal(input: HypeZecSignalInput) {
  return evaluateLong("ZEC_LONG", input);
}

function floorToStep(value: number, step: number) {
  return Math.floor((value + step * 1e-9) / step) * step;
}

function ceilToStep(value: number, step: number) {
  return Math.ceil((value - step * 1e-9) / step) * step;
}

function roundStable(value: number, step: number) {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 6);
  return Number(value.toFixed(decimals));
}

export function calculateHypeZecQuantity(input: HypeZecQuantityInput): HypeZecQuantityResult {
  const policy = HYPE_ZEC_LONG_POLICY[input.strategy];
  const equity = finitePositive(input.equityUsd, "equity");
  const entry = finitePositive(input.entryPrice, "entry_price");
  const stop = finitePositive(input.stopPrice, "stop_price");
  const step = finitePositive(input.stepSize, "step_size");
  if (stop >= entry) throw new Error("LONG_STOP_MUST_BE_BELOW_ENTRY");
  for (const [value, name] of [[input.feeBpsPerSide, "fee_bps"], [input.slippageBps, "slippage_bps"], [input.fundingBps, "funding_bps"]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name}_INVALID`);
  }
  const riskBudgetUsd = equity * policy.riskPct / 100;
  const bufferPerUnit = entry * (2 * input.feeBpsPerSide + input.slippageBps + input.fundingBps) / 10_000;
  const lossPerUnit = (entry - stop) + bufferPerUnit;
  const riskQuantity = riskBudgetUsd / lossPerUnit;
  const grossQuantity = equity * policy.maximumGross / entry;
  const quantity = roundStable(floorToStep(Math.min(riskQuantity, grossQuantity), step), step);
  const worstCaseLossUsd = quantity * lossPerUnit;
  const gross = quantity * entry / equity;
  return {
    strategy: input.strategy,
    quantity,
    riskQuantity,
    grossQuantity,
    riskBudgetUsd,
    worstCaseLossUsd,
    gross,
    leverage: policy.leverage,
    marginType: policy.marginType,
    reason: quantity > 0 ? "RISK_AND_GROSS_CAPPED" : "CAPACITY_BLOCKED_BY_MINIMUM_QUANTITY",
  };
}

export function buildHypeZecProtection(input: HypeZecProtectionInput): HypeZecProtectionResult {
  const policy = HYPE_ZEC_LONG_POLICY[input.strategy];
  const entry = finitePositive(input.entryPrice, "entry_price");
  const tick = finitePositive(input.tickSize, "tick_size");
  const step = finitePositive(input.stepSize, "step_size");
  const quantity = roundStable(floorToStep(finitePositive(input.quantity, "quantity"), step), step);
  const stopPrice = roundStable(floorToStep(entry * (1 - policy.signal.stopLossPct), tick), tick);
  const takeProfitPrice = roundStable(ceilToStep(entry * (1 + policy.signal.takeProfitPct), tick), tick);
  if (!(quantity > 0 && stopPrice > 0 && stopPrice < entry && takeProfitPrice > entry)) throw new Error("PROTECTION_LEVELS_INVALID");
  return { strategy: input.strategy, symbol: policy.symbol, quantity, stopPrice, takeProfitPrice, reduceOnly: true };
}
