import crypto from "crypto";

import type { LiveHybridRunSummary, LiveHybridWalletRunResult } from "@/lib/server/live-hybrid-autotrade";
import { appendAutoTradeHistory } from "@/lib/server/auto-trade-history-db";
import { loadAutoTradeRuntimeControl } from "@/lib/server/auto-trade-runtime-control";
import { loadAsterDexClientConfig, AsterDexClient } from "@/lib/server/asterdex/client";
import { maybeAutoConvertUsdtToUsdf } from "@/lib/server/asterdex/usdf-auto-convert";
import {
  COMBINED_ETH_EXECUTION_SYMBOL,
  COMBINED_ETH_MARKET_SYMBOL,
  COMBINED_ETH_RECLAIM_CONFIG,
  COMBINED_ENTRY_CONFIG,
  COMBINED_ENTRY_FRACTIONS,
  COMBINED_EXECUTION_SYMBOL,
  COMBINED_EXIT_CONFIG,
  COMBINED_HYPE_EXECUTION_SYMBOL,
  COMBINED_HYPE_FREQ_CONFIG,
  COMBINED_HYPE_MARKET_SYMBOL,
  COMBINED_MARKET_SYMBOL,
  COMBINED_PENGU_GUARD_CONFIG,
  COMBINED_REFERENCE_SIGNAL,
  COMBINED_RISK_CONFIG,
  COMBINED_SIZING_CONFIG,
  COMBINED_STRATEGY_ID,
  strategyModeFromActiveStrategy,
} from "@/lib/server/combined/config";
import { loadLatestCombinedSignal } from "@/lib/server/combined/goldcat-signal-source";
import { build15mFeatures, latestCandleBefore, loadCombinedMarketWindow } from "@/lib/server/combined/market";
import { loadCombinedState, saveCombinedState } from "@/lib/server/combined/state";
import type {
  CombinedDecisionPayload,
  CombinedLaneCooldownState,
  CombinedLaneId,
  CombinedPositionState,
  CombinedRunWalletResult,
  CombinedSignalSide,
  CombinedSizingSnapshot,
  CombinedStrategyMode,
} from "@/lib/server/combined/types";
import { writeLiveDecisionCache } from "@/lib/server/live-decision-cache-db";
import { appendVenueTradeHistory } from "@/lib/server/trade-history-db";

const DRY_RUN_NOTIONAL_USD = Number(process.env.COMBINED_DRY_RUN_NOTIONAL_USD || 100);
const ASTER_WALLET_ID = "asterdex-primary";
const ASTER_WALLET_ADDRESS = "ASTERDEX";
const ASTER_CHAIN_ID = 999999;

type Trigger = "scheduled" | "manual";

type RunOptions = {
  trigger?: Trigger;
  modeOverride?: CombinedStrategyMode;
};

type CombinedStateSnapshot = Awaited<ReturnType<typeof loadCombinedState>>;
type CombinedMarketWindow = Awaited<ReturnType<typeof loadCombinedMarketWindow>>;

type LaneRuntimeConfig = {
  laneId: CombinedLaneId;
  executionSymbol: string;
  marketSymbol: string;
  entryBreakoutBps: number;
  holdMinutes: number;
  minStopLossHoldMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  fixedMultiplier?: number;
};

type CombinedLaneCandidate = {
  laneId: CombinedLaneId;
  side: Extract<CombinedSignalSide, "long" | "short">;
  signalTs: string;
  reason: string;
  currentPrice: number;
};

type CombinedExecutionContext = {
  laneId: CombinedLaneId;
  executionSymbol: string;
  marketSymbol: string;
  currentPrice: number;
  latestPengu15m: ReturnType<typeof build15mFeatures>[number] | null;
  latestHype15m: ReturnType<typeof build15mFeatures>[number] | null;
  latestEth15m: ReturnType<typeof build15mFeatures>[number] | null;
};

const LANE_CONFIGS: Record<CombinedLaneId, LaneRuntimeConfig> = {
  pengu_goldcat: {
    laneId: "pengu_goldcat",
    executionSymbol: COMBINED_EXECUTION_SYMBOL,
    marketSymbol: COMBINED_MARKET_SYMBOL,
    entryBreakoutBps: COMBINED_ENTRY_CONFIG.breakoutBps,
    holdMinutes: COMBINED_EXIT_CONFIG.holdMinutes,
    minStopLossHoldMinutes: COMBINED_EXIT_CONFIG.minStopLossHoldMinutes,
    stopLossPct: COMBINED_EXIT_CONFIG.stopLossPct,
    takeProfitPct: COMBINED_EXIT_CONFIG.takeProfitPct,
    trailActivationPct: COMBINED_EXIT_CONFIG.trailActivationPct,
    trailRetracePct: COMBINED_EXIT_CONFIG.trailRetracePct,
  },
  hype_freq: {
    laneId: "hype_freq",
    executionSymbol: COMBINED_HYPE_EXECUTION_SYMBOL,
    marketSymbol: COMBINED_HYPE_MARKET_SYMBOL,
    entryBreakoutBps: COMBINED_HYPE_FREQ_CONFIG.breakoutBps,
    holdMinutes: COMBINED_HYPE_FREQ_CONFIG.holdMinutes,
    minStopLossHoldMinutes: COMBINED_HYPE_FREQ_CONFIG.minStopLossHoldMinutes,
    stopLossPct: COMBINED_HYPE_FREQ_CONFIG.stopLossPct,
    takeProfitPct: COMBINED_HYPE_FREQ_CONFIG.takeProfitPct,
    trailActivationPct: COMBINED_HYPE_FREQ_CONFIG.trailActivationPct,
    trailRetracePct: COMBINED_HYPE_FREQ_CONFIG.trailRetracePct,
    fixedMultiplier: COMBINED_HYPE_FREQ_CONFIG.sizeMultiplier,
  },
  eth_reclaim: {
    laneId: "eth_reclaim",
    executionSymbol: COMBINED_ETH_EXECUTION_SYMBOL,
    marketSymbol: COMBINED_ETH_MARKET_SYMBOL,
    entryBreakoutBps: COMBINED_ETH_RECLAIM_CONFIG.breakoutBps,
    holdMinutes: COMBINED_ETH_RECLAIM_CONFIG.holdMinutes,
    minStopLossHoldMinutes: COMBINED_ETH_RECLAIM_CONFIG.minStopLossHoldMinutes,
    stopLossPct: COMBINED_ETH_RECLAIM_CONFIG.stopLossPct,
    takeProfitPct: COMBINED_ETH_RECLAIM_CONFIG.takeProfitPct,
    trailActivationPct: COMBINED_ETH_RECLAIM_CONFIG.trailActivationPct,
    trailRetracePct: COMBINED_ETH_RECLAIM_CONFIG.trailRetracePct,
    fixedMultiplier: COMBINED_ETH_RECLAIM_CONFIG.sizeMultiplier,
  },
};

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function syntheticTxHash(seed: string) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

function normalizeDesiredSide(side: CombinedSignalSide): "trend" | "cash" {
  return side === "flat" ? "cash" : "trend";
}

function laneConfig(laneId: CombinedLaneId) {
  return LANE_CONFIGS[laneId];
}

function laneDisplayName(laneId: CombinedLaneId) {
  if (laneId === "hype_freq") return "HYPE freq";
  if (laneId === "eth_reclaim") return "ETH reclaim";
  return "PENGU GoldCat";
}

function positionLane(position: CombinedPositionState | null): CombinedLaneId {
  return position?.laneId
    || (position?.symbol === COMBINED_HYPE_EXECUTION_SYMBOL
      ? "hype_freq"
      : position?.symbol === COMBINED_ETH_EXECUTION_SYMBOL
        ? "eth_reclaim"
        : "pengu_goldcat");
}

function lanePriority(laneId: CombinedLaneId) {
  if (laneId === "pengu_goldcat") return 0;
  if (laneId === "hype_freq") return 1;
  return 2;
}

function sortPositions(positions: CombinedPositionState[]) {
  return [...positions].sort((left, right) => {
    const priorityDiff = lanePriority(left.laneId) - lanePriority(right.laneId);
    if (priorityDiff !== 0) return priorityDiff;
    return Date.parse(left.entryTs) - Date.parse(right.entryTs);
  });
}

function getLanePosition(positions: CombinedPositionState[], laneId: CombinedLaneId) {
  return positions.find((position) => positionLane(position) === laneId) || null;
}

function currentSymbol(position: CombinedPositionState | null) {
  return position ? position.symbol : "USDT";
}

function positionDiffers(left: CombinedPositionState | null, right: CombinedPositionState | null) {
  if (!left && !right) return false;
  if (!left || !right) return true;
  return left.laneId !== right.laneId
    || left.symbol !== right.symbol
    || left.marketSymbol !== right.marketSymbol
    || left.side !== right.side
    || Math.abs(left.quantity - right.quantity) > 0.000001
    || Math.abs(left.entryPrice - right.entryPrice) > 0.00000001
    || left.sourceSignalTs !== right.sourceSignalTs;
}

function latestLanePrice(marketWindow: CombinedMarketWindow, laneId: CombinedLaneId, now: number, fallback = 0) {
  if (laneId === "hype_freq") {
    return Number(latestCandleBefore(marketWindow.hype1m, now)?.close || latestCandleBefore(marketWindow.hype15m, now)?.close || fallback || 0);
  }
  if (laneId === "eth_reclaim") {
    return Number(latestCandleBefore(marketWindow.eth1m, now)?.close || latestCandleBefore(marketWindow.eth15m, now)?.close || fallback || 0);
  }
  return Number(latestCandleBefore(marketWindow.pengu1m, now)?.close || latestCandleBefore(marketWindow.pengu15m, now)?.close || fallback || 0);
}

async function syncStateWithVenue(
  mode: CombinedStrategyMode,
  state: CombinedStateSnapshot,
  liveClient: AsterDexClient | null,
  nowIso: string,
) {
  if (mode !== "live" || !liveClient) return state;

  const risks = await liveClient.getPositionRisk();
  const supported = new Set([
    COMBINED_MARKET_SYMBOL.toUpperCase(),
    COMBINED_HYPE_MARKET_SYMBOL.toUpperCase(),
    COMBINED_ETH_MARKET_SYMBOL.toUpperCase(),
  ]);
  const venuePositions = Array.isArray(risks)
    ? risks
        .filter((item: any) => supported.has(String(item?.symbol || "").toUpperCase()))
        .filter((item: any) => Math.abs(Number(item?.positionAmt || 0)) >= 0.0000001)
    : [];

  const nextPositions = sortPositions(venuePositions.map((venuePosition: any) => {
    const positionAmt = Number(venuePosition?.positionAmt || 0);
    const venueSymbol = String(venuePosition?.symbol || "").toUpperCase();
    const nextLaneId: CombinedLaneId = venueSymbol === COMBINED_HYPE_MARKET_SYMBOL.toUpperCase()
      ? "hype_freq"
      : venueSymbol === COMBINED_ETH_MARKET_SYMBOL.toUpperCase()
        ? "eth_reclaim"
        : "pengu_goldcat";
    const config = laneConfig(nextLaneId);
    const venueSide: CombinedPositionState["side"] = positionAmt > 0 ? "long" : "short";
    const venueQuantity = round(Math.abs(positionAmt), 6);
    const venueEntryPrice = round(Number(venuePosition?.entryPrice || 0), 8);
    const seedPosition = getLanePosition(state.currentPositions || [], nextLaneId);
    return {
      laneId: nextLaneId,
      symbol: config.executionSymbol,
      marketSymbol: config.marketSymbol,
      side: venueSide,
      quantity: venueQuantity,
      entryPrice: venueEntryPrice,
      entryTs: seedPosition?.entryTs || nowIso,
      entryCount: seedPosition?.entryCount || 1,
      sizeMultiplier: seedPosition?.sizeMultiplier || (config.fixedMultiplier || 1),
      highWatermark: seedPosition?.highWatermark || venueEntryPrice,
      lowWatermark: seedPosition?.lowWatermark || venueEntryPrice,
      sourceSignalTs: seedPosition?.sourceSignalTs || nowIso,
      lastAddedAt: seedPosition?.lastAddedAt || seedPosition?.entryTs || nowIso,
      externalOrderId: seedPosition?.externalOrderId || null,
    } satisfies CombinedPositionState;
  }));

  const previousPositions = sortPositions(state.currentPositions || []);
  const unchanged = previousPositions.length === nextPositions.length
    && previousPositions.every((position, index) => !positionDiffers(position, nextPositions[index] || null));
  if (unchanged) return state;

  return saveCombinedState({
    updatedAt: nowIso,
    currentPositions: nextPositions,
    currentPosition: nextPositions[0] || null,
    laneCooldowns: state.laneCooldowns,
  });
}

function buildSizingSnapshot(
  laneId: CombinedLaneId,
  side: CombinedSignalSide,
  latestPengu15m: ReturnType<typeof build15mFeatures>[number] | null,
  checkedAt: string,
): CombinedSizingSnapshot {
  if (laneId === "hype_freq") {
    return {
      checkedAt,
      laneId,
      side,
      pengu15mAligned: false,
      strongAligned: false,
      moveBps: 0,
      accelBps: 0,
      multiplier: COMBINED_HYPE_FREQ_CONFIG.sizeMultiplier,
      reason: "HYPE freq lane uses fixed 1.0x sizing.",
    };
  }
  if (laneId === "eth_reclaim") {
    return {
      checkedAt,
      laneId,
      side,
      pengu15mAligned: false,
      strongAligned: false,
      moveBps: 0,
      accelBps: 0,
      multiplier: COMBINED_ETH_RECLAIM_CONFIG.sizeMultiplier,
      reason: "ETH reclaim lane uses fixed 1.0x sizing.",
    };
  }

  if (!latestPengu15m || side === "flat") {
    return {
      checkedAt,
      laneId,
      side,
      pengu15mAligned: false,
      strongAligned: false,
      moveBps: 0,
      accelBps: 0,
      multiplier: COMBINED_SIZING_CONFIG.unalignedSize,
      reason: "PENGU 15m sizing state unavailable.",
    };
  }

  const bullish = latestPengu15m.close > latestPengu15m.ema20
    && latestPengu15m.ema20 > latestPengu15m.ema48
    && latestPengu15m.close >= latestPengu15m.high3;
  const bearish = latestPengu15m.close < latestPengu15m.ema20
    && latestPengu15m.ema20 < latestPengu15m.ema48
    && latestPengu15m.close <= latestPengu15m.low3;
  const aligned = (side === "long" && bullish) || (side === "short" && bearish);
  const strongAligned = aligned && (
    (side === "long" && latestPengu15m.moveBps >= COMBINED_SIZING_CONFIG.strongMoveBps && latestPengu15m.accelBps >= COMBINED_SIZING_CONFIG.strongAccelBps)
    || (side === "short" && -latestPengu15m.moveBps >= COMBINED_SIZING_CONFIG.strongMoveBps && -latestPengu15m.accelBps >= COMBINED_SIZING_CONFIG.strongAccelBps)
  );
  const multiplier = strongAligned
    ? COMBINED_SIZING_CONFIG.strongAlignedSize
    : aligned
      ? COMBINED_SIZING_CONFIG.weakAlignedSize
      : COMBINED_SIZING_CONFIG.unalignedSize;

  return {
    checkedAt,
    laneId,
    side,
    pengu15mAligned: aligned,
    strongAligned,
    moveBps: round(latestPengu15m.moveBps, 3),
    accelBps: round(latestPengu15m.accelBps, 3),
    multiplier,
    reason: strongAligned
      ? "PENGU 15m strong alignment -> 2.0x"
      : aligned
        ? "PENGU 15m aligned -> 1.25x"
        : "PENGU 15m unaligned -> 1.0x",
  };
}

function isPengu15mAligned(
  latestPengu15m: ReturnType<typeof build15mFeatures>[number] | null,
  side: Extract<CombinedSignalSide, "long" | "short">,
) {
  if (!latestPengu15m) return false;
  if (side === "long") {
    return latestPengu15m.close > latestPengu15m.ema20
      && latestPengu15m.ema20 > latestPengu15m.ema48
      && latestPengu15m.close >= latestPengu15m.high3;
  }
  return latestPengu15m.close < latestPengu15m.ema20
    && latestPengu15m.ema20 < latestPengu15m.ema48
    && latestPengu15m.close <= latestPengu15m.low3;
}

function getLaneCooldown(
  laneCooldowns: Partial<Record<CombinedLaneId, CombinedLaneCooldownState | null>> | undefined,
  laneId: CombinedLaneId,
  nowIso: string,
) {
  const cooldown = laneCooldowns?.[laneId] || null;
  if (!cooldown) return null;
  if (Date.parse(cooldown.until) <= Date.parse(nowIso)) return null;
  return cooldown;
}

function buildPenguCandidate(
  signal: Awaited<ReturnType<typeof loadLatestCombinedSignal>>,
  marketWindow: CombinedMarketWindow,
  now: number,
): CombinedLaneCandidate | null {
  if (!signal.accepted || signal.side === "flat") return null;
  if (signal.side === "short" && !COMBINED_PENGU_GUARD_CONFIG.allowShortEntries) return null;
  const currentPrice = latestLanePrice(marketWindow, "pengu_goldcat", now, 0);
  return {
    laneId: "pengu_goldcat",
    side: signal.side,
    signalTs: signal.signalTs || new Date(now).toISOString(),
    reason: signal.reason,
    currentPrice,
  };
}

function buildHypeFreqCandidate(
  marketWindow: CombinedMarketWindow,
  now: number,
): CombinedLaneCandidate | null {
  if (!COMBINED_HYPE_FREQ_CONFIG.enabled) return null;

  const latestBtc15m = latestCandleBefore(marketWindow.btc15m, now);
  const latestHype15m = latestCandleBefore(marketWindow.hype15m, now);
  if (!latestBtc15m || !latestHype15m) return null;

  const btcAligned = latestBtc15m.close > latestBtc15m.ema20
    && latestBtc15m.ema20 > latestBtc15m.ema48
    && latestBtc15m.close >= latestBtc15m.high3
    && latestBtc15m.moveBps >= COMBINED_HYPE_FREQ_CONFIG.btcMinMoveBps
    && latestBtc15m.moveBps <= COMBINED_HYPE_FREQ_CONFIG.btcMaxMoveBps
    && latestBtc15m.accelBps >= COMBINED_HYPE_FREQ_CONFIG.btcMinAccelBps;
  if (!btcAligned) return null;

  const distanceFromEma20Bps = ((latestHype15m.close / Math.max(latestHype15m.ema20, 0.0000001)) - 1) * 10_000;
  const hypeAligned = latestHype15m.close > latestHype15m.ema20
    && latestHype15m.ema20 > latestHype15m.ema48
    && latestHype15m.close >= latestHype15m.high3
    && latestHype15m.moveBps >= COMBINED_HYPE_FREQ_CONFIG.symbolMinMoveBps
    && latestHype15m.accelBps >= COMBINED_HYPE_FREQ_CONFIG.symbolMinAccelBps
    && distanceFromEma20Bps <= COMBINED_HYPE_FREQ_CONFIG.symbolMaxDistanceBps;
  if (!hypeAligned) return null;

  const signalPriceRow = latestCandleBefore(marketWindow.hype1m, latestHype15m.ts);
  if (!signalPriceRow) return null;
  const confirmUntil = latestHype15m.ts + (COMBINED_HYPE_FREQ_CONFIG.breakoutConfirmMinutes * 60_000);
  const breakoutPct = COMBINED_HYPE_FREQ_CONFIG.breakoutBps / 10_000;
  const confirmed = marketWindow.hype1m.find((row) =>
    row.ts >= latestHype15m.ts
    && row.ts <= confirmUntil
    && row.high >= signalPriceRow.open * (1 + breakoutPct));
  if (!confirmed) return null;

  return {
    laneId: "hype_freq",
    side: "long",
    signalTs: new Date(latestHype15m.ts).toISOString(),
    reason: `BTC momentum aligned + HYPE breakout confirmed (${COMBINED_HYPE_FREQ_CONFIG.breakoutBps}bps/${COMBINED_HYPE_FREQ_CONFIG.breakoutConfirmMinutes}m).`,
    currentPrice: Number(confirmed.close || latestHype15m.close || 0),
  };
}

function inEthSession(ts: number) {
  const hour = new Date(ts).getUTCHours();
  const start = 0;
  const end = 24;
  return hour >= start && hour < end;
}

function buildEthReclaimCandidate(
  marketWindow: CombinedMarketWindow,
  now: number,
): CombinedLaneCandidate | null {
  if (!COMBINED_ETH_RECLAIM_CONFIG.enabled) return null;

  const signalRow = latestCandleBefore(marketWindow.eth15m, now - (15 * 60_000));
  if (!signalRow) return null;

  const signalIndex = marketWindow.eth15m.findIndex((row) => row.ts === signalRow.ts);
  if (signalIndex < 5) return null;

  const signalCloseTs = signalRow.ts + (15 * 60_000);
  if (!inEthSession(signalCloseTs)) return null;

  const regimeRow = latestCandleBefore(marketWindow.eth1h, signalCloseTs);
  const btcRow = latestCandleBefore(marketWindow.btc15m, signalCloseTs);
  if (!regimeRow || !btcRow) return null;

  const distanceFrom1hEma20Bps = ((signalRow.close / Math.max(regimeRow.ema20, 0.0000001)) - 1) * 10_000;
  const regimeOk = regimeRow.close > regimeRow.ema20
    && regimeRow.ema20 > regimeRow.ema48
    && regimeRow.moveBps >= COMBINED_ETH_RECLAIM_CONFIG.regimeMinMoveBps
    && regimeRow.accelBps >= COMBINED_ETH_RECLAIM_CONFIG.regimeMinAccelBps
    && distanceFrom1hEma20Bps >= -COMBINED_ETH_RECLAIM_CONFIG.regimeMaxDistanceBps;
  if (!regimeOk) return null;

  const btcOk = btcRow.moveBps > COMBINED_ETH_RECLAIM_CONFIG.btcCrashFilterBps
    && btcRow.moveBps >= COMBINED_ETH_RECLAIM_CONFIG.btcTrendMinBps;
  if (!btcOk) return null;

  const touchStartIndex = Math.max(0, signalIndex - COMBINED_ETH_RECLAIM_CONFIG.recentTouchBars);
  const touchedRecently = marketWindow.eth15m.slice(touchStartIndex, signalIndex).some((row) => {
    const touchLimit = row.ema20 * (1 + COMBINED_ETH_RECLAIM_CONFIG.touchToleranceBps / 10_000);
    return row.low <= touchLimit;
  });
  if (!touchedRecently) return null;

  const previousRow = marketWindow.eth15m[signalIndex - 1];
  const bodyBps = ((signalRow.close / Math.max(signalRow.open, 0.0000001)) - 1) * 10_000;
  const distanceFromEma20Bps = ((signalRow.close / Math.max(signalRow.ema20, 0.0000001)) - 1) * 10_000;
  if (signalRow.close <= signalRow.ema20) return null;
  if (signalRow.ema20 <= signalRow.ema48) return null;
  if (signalRow.moveBps < COMBINED_ETH_RECLAIM_CONFIG.reclaimMinMoveBps) return null;
  if (bodyBps < COMBINED_ETH_RECLAIM_CONFIG.reclaimMinBodyBps) return null;
  if (distanceFromEma20Bps < 0 || distanceFromEma20Bps > COMBINED_ETH_RECLAIM_CONFIG.regimeMaxDistanceBps) return null;
  if (signalRow.close < signalRow.high3 && signalRow.close < previousRow.high) return null;

  const confirmUntil = signalCloseTs + (COMBINED_ETH_RECLAIM_CONFIG.breakoutConfirmMinutes * 60_000);
  const breakoutPct = COMBINED_ETH_RECLAIM_CONFIG.breakoutBps / 10_000;
  const confirmed = marketWindow.eth1m.find((row) =>
    row.ts >= signalCloseTs
    && row.ts <= confirmUntil
    && row.high >= signalRow.high * (1 + breakoutPct));
  if (!confirmed) return null;

  return {
    laneId: "eth_reclaim",
    side: "long",
    signalTs: new Date(signalCloseTs).toISOString(),
    reason: `ETH reclaim confirmed (${COMBINED_ETH_RECLAIM_CONFIG.breakoutBps}bps/${COMBINED_ETH_RECLAIM_CONFIG.breakoutConfirmMinutes}m).`,
    currentPrice: Number(confirmed.close || signalRow.close || 0),
  };
}

function evaluatePositionExit(
  position: CombinedPositionState,
  signalSide: CombinedSignalSide,
  currentPrice: number,
  nowIso: string,
) {
  const config = laneConfig(positionLane(position));
  const holdMinutes = (Date.parse(nowIso) - Date.parse(position.entryTs)) / 60_000;
  const highWatermark = position.side === "long"
    ? Math.max(position.highWatermark, currentPrice)
    : position.highWatermark;
  const lowWatermark = position.side === "short"
    ? Math.min(position.lowWatermark, currentPrice)
    : position.lowWatermark;
  const pnlPct = position.side === "long"
    ? ((currentPrice / position.entryPrice) - 1)
    : ((position.entryPrice / currentPrice) - 1);
  const peakPnlPct = position.side === "long"
    ? ((highWatermark / position.entryPrice) - 1)
    : ((position.entryPrice / lowWatermark) - 1);
  const retracePct = peakPnlPct - pnlPct;
  const stopLossEligible = holdMinutes >= config.minStopLossHoldMinutes;

  let exitReason: string | null = null;
  if (stopLossEligible && pnlPct <= -config.stopLossPct) {
    exitReason = `stop loss reached (${(pnlPct * 100).toFixed(2)}%)`;
  } else if (pnlPct >= config.takeProfitPct) {
    exitReason = `take profit reached (${(pnlPct * 100).toFixed(2)}%)`;
  } else if (
    peakPnlPct >= config.trailActivationPct
    && retracePct >= config.trailRetracePct
  ) {
    exitReason = `trailing exit (${(peakPnlPct * 100).toFixed(2)}% -> ${(pnlPct * 100).toFixed(2)}%)`;
  } else if (holdMinutes >= config.holdMinutes) {
    exitReason = `max hold ${config.holdMinutes}m reached`;
  } else if (positionLane(position) === "pengu_goldcat" && signalSide !== "flat" && signalSide !== position.side) {
    exitReason = "GoldCat side reversed.";
  }

  return {
    shouldExit: Boolean(exitReason),
    exitReason,
    pnlPct,
    highWatermark,
    lowWatermark,
  };
}

function buildDecisionPayload(
  mode: CombinedStrategyMode,
  signal: Awaited<ReturnType<typeof loadLatestCombinedSignal>>,
  sizing: CombinedSizingSnapshot,
  currentPosition: CombinedPositionState | null,
  context: CombinedExecutionContext,
  nowIso: string,
  selectedCandidate: CombinedLaneCandidate | null,
): CombinedDecisionPayload {
  const positionExit = currentPosition
    ? evaluatePositionExit(currentPosition, signal.side, context.currentPrice, nowIso)
    : null;

  let desiredAction: CombinedDecisionPayload["desiredAction"] = "skip";
  let desiredSide: CombinedSignalSide = "flat";
  let desiredSymbol = "USDT";
  let reason = selectedCandidate?.reason || signal.reason;

  if (currentPosition && positionExit) {
    const currentLane = positionLane(currentPosition);
    const currentCandidate = selectedCandidate && selectedCandidate.laneId === currentLane ? selectedCandidate : null;
    const canAddSameSide = currentCandidate
      && currentCandidate.side === currentPosition.side
      && currentCandidate.signalTs !== currentPosition.sourceSignalTs;

    if (positionExit.shouldExit) {
      desiredAction = "exit";
      desiredSide = "flat";
      desiredSymbol = "USDT";
      reason = positionExit.exitReason || "Close current position.";
    } else if (canAddSameSide) {
      desiredAction = "enter";
      desiredSide = currentPosition.side;
      desiredSymbol = currentPosition.symbol;
      reason = `${currentCandidate.reason} / ${sizing.reason} / Add same-side entry.`;
    } else {
      desiredAction = "hold";
      desiredSide = currentPosition.side;
      desiredSymbol = currentPosition.symbol;
      reason = `Hold ${laneDisplayName(currentLane)} (${(positionExit.pnlPct * 100).toFixed(2)}%).`;
    }
  } else if (selectedCandidate) {
    desiredAction = "enter";
    desiredSide = selectedCandidate.side;
    desiredSymbol = laneConfig(selectedCandidate.laneId).executionSymbol;
    reason = `${selectedCandidate.reason} / ${sizing.reason}`;
  }

  const execution = laneConfig(context.laneId);

  return {
    ok: true,
    strategyType: "combined",
    strategyId: "combined",
    checkedAt: nowIso,
    activeLaneId: context.laneId,
    activeSignalTs: currentPosition ? currentPosition.sourceSignalTs : (selectedCandidate?.signalTs || signal.signalTs || null),
    runtimeMode: mode,
    signal,
    sizing,
    execution: {
      checkedAt: nowIso,
      mode,
      laneId: context.laneId,
      marketSymbol: execution.marketSymbol,
      executionSymbol: execution.executionSymbol,
      entryBreakoutBps: execution.entryBreakoutBps,
      holdMinutes: execution.holdMinutes,
      minStopLossHoldMinutes: execution.minStopLossHoldMinutes,
      stopLossPct: execution.stopLossPct,
      takeProfitPct: execution.takeProfitPct,
      trailActivationPct: execution.trailActivationPct,
      trailRetracePct: execution.trailRetracePct,
    },
    desiredAction,
    desiredSide,
    desiredSymbol,
    currentPosition,
    reason,
    venue: "AsterDex",
    cachedAt: Date.now(),
  };
}

async function roundQuantityForAster(client: AsterDexClient, marketSymbol: string, quantity: number) {
  const exchangeInfo = await client.getExchangeInfo();
  const symbolInfo = Array.isArray(exchangeInfo?.symbols)
    ? exchangeInfo.symbols.find((item: any) => item?.symbol === marketSymbol)
    : null;
  const lotSizeFilter = Array.isArray(symbolInfo?.filters)
    ? symbolInfo.filters.find((item: any) => item?.filterType === "LOT_SIZE")
    : null;
  const stepSize = Number(lotSizeFilter?.stepSize || 0);
  const minQty = Number(lotSizeFilter?.minQty || 0);
  const precision = Number.isFinite(Number(symbolInfo?.quantityPrecision)) ? Number(symbolInfo.quantityPrecision) : 0;

  let next = quantity;
  if (stepSize > 0) next = Math.floor(next / stepSize) * stepSize;
  if (precision >= 0) next = Number(next.toFixed(Math.min(precision, 8)));
  if (minQty > 0 && next < minQty) return 0;
  return next;
}

function parseVenueBalance(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function computeTradableBalanceUsd(balances: any[]) {
  const usdtBalance = Array.isArray(balances)
    ? balances.find((item: any) => String(item?.asset || "").toUpperCase() === "USDT")
    : null;
  const usdfBalance = Array.isArray(balances)
    ? balances.find((item: any) => String(item?.asset || "").toUpperCase() === "USDF")
    : null;

  const totalAvailableUsd = parseVenueBalance(usdtBalance?.availableBalance || usdtBalance?.balance);
  const usdtBalanceUsd = parseVenueBalance(usdtBalance?.balance || usdtBalance?.crossWalletBalance);
  const usdfBalanceUsd = parseVenueBalance(usdfBalance?.balance || usdfBalance?.crossWalletBalance);
  const bufferedUsdtUsd = Math.max(0, usdtBalanceUsd - COMBINED_RISK_CONFIG.usdtMinimumBufferUsd);
  const grossTradableUsd = bufferedUsdtUsd + usdfBalanceUsd;

  return {
    totalAvailableUsd,
    tradableBalanceUsd: Math.min(totalAvailableUsd, grossTradableUsd),
  };
}

function computeEntryNotionalUsd(laneId: CombinedLaneId, availableBalance: number, multiplier: number) {
  if (!Number.isFinite(availableBalance) || availableBalance <= 0) {
    throw new Error("AsterDex available balance is not readable.");
  }
  if (availableBalance < COMBINED_RISK_CONFIG.minTradeBalanceUsd) {
    throw new Error(`AsterDex available balance is too small (${availableBalance.toFixed(2)} USDT).`);
  }
  if (availableBalance <= COMBINED_RISK_CONFIG.smallBalanceThresholdUsd) {
    return availableBalance * COMBINED_RISK_CONFIG.smallBalanceEntryFraction;
  }

  const reserveUsd = Math.max(
    COMBINED_RISK_CONFIG.minReserveUsd,
    availableBalance * COMBINED_RISK_CONFIG.reserveFraction,
  );
  const maxTradableUsd = Math.max(0, availableBalance - reserveUsd);
  const safeMultiplier = Math.max(0, multiplier);
  const entryFractions = COMBINED_ENTRY_FRACTIONS[laneId];
  const targetUsd = availableBalance * entryFractions.baseEntryFraction * safeMultiplier;
  const cappedUsd = availableBalance * entryFractions.maxEntryFraction;
  const notionalUsd = Math.min(maxTradableUsd, targetUsd, cappedUsd);

  if (notionalUsd < COMBINED_RISK_CONFIG.minNotionalUsd) {
    throw new Error(`Safe tradable notional is below minimum (${notionalUsd.toFixed(2)} USDT).`);
  }

  return notionalUsd;
}

async function buildLiveEntry(
  client: AsterDexClient,
  laneId: CombinedLaneId,
  side: Extract<CombinedSignalSide, "long" | "short">,
  multiplier: number,
  nowIso: string,
) {
  const config = laneConfig(laneId);
  const [priceRow, balances] = await Promise.all([
    client.getPrice(config.marketSymbol),
    client.getBalance(),
  ]);
  const markPrice = Number(priceRow.price || 0);
  const collateralSnapshot = computeTradableBalanceUsd(balances);
  const notionalUsd = computeEntryNotionalUsd(laneId, collateralSnapshot.tradableBalanceUsd, multiplier);
  const rawQuantity = notionalUsd > 0 && markPrice > 0 ? (notionalUsd / markPrice) : 0;
  const quantity = await roundQuantityForAster(client, config.marketSymbol, rawQuantity);
  if (quantity <= 0 || !Number.isFinite(quantity)) {
    throw new Error("AsterDex quantity calculation failed.");
  }

  const order = await client.placeOrder({
    symbol: config.marketSymbol,
    side: side === "long" ? "BUY" : "SELL",
    type: "MARKET",
    quantity: String(quantity),
    newOrderRespType: "RESULT",
  });

  const fillPrice = Number(order?.avgPrice || order?.price || markPrice || 0);
  return {
    quantity,
    fillPrice,
    orderId: String(order?.orderId || ""),
    txHash: syntheticTxHash(`aster-entry-${config.marketSymbol}-${order?.orderId || nowIso}`),
    notionalUsd: round(quantity * fillPrice, 6),
  };
}

async function buildLiveExit(client: AsterDexClient, position: CombinedPositionState, nowIso: string) {
  const quantity = await roundQuantityForAster(client, position.marketSymbol, position.quantity);
  if (quantity <= 0) {
    throw new Error("AsterDex close quantity rounded down to zero.");
  }
  const order = await client.placeOrder({
    symbol: position.marketSymbol,
    side: position.side === "long" ? "SELL" : "BUY",
    type: "MARKET",
    quantity: String(quantity),
    reduceOnly: true,
    newOrderRespType: "RESULT",
  });
  const fillPrice = Number(order?.avgPrice || order?.price || 0);
  return {
    quantity,
    fillPrice,
    orderId: String(order?.orderId || ""),
    txHash: syntheticTxHash(`aster-exit-${position.marketSymbol}-${order?.orderId || nowIso}`),
    notionalUsd: round(quantity * fillPrice, 6),
  };
}

function buildSummary(
  trigger: Trigger,
  decision: CombinedDecisionPayload,
  walletResults: LiveHybridWalletRunResult[],
): LiveHybridRunSummary {
  return {
    strategyId: COMBINED_STRATEGY_ID,
    trigger,
    triggerLabel: trigger === "manual" ? "combined manual run" : "combined scheduled run",
    executedAt: decision.checkedAt,
    decisionTime: decision.activeSignalTs || decision.checkedAt,
    desiredSymbol: decision.desiredSymbol,
    desiredSide: normalizeDesiredSide(decision.desiredSide),
    reason: decision.reason,
    walletResults,
  };
}

async function persistTradeHistory(
  action: "BUY" | "SELL",
  executionSymbol: string,
  qty: number,
  price: number,
  txHash: string,
  reason: string,
  executedAt: string,
) {
  const asset = executionSymbol.split("/")[0] || executionSymbol;
  const sourceSymbol = action === "BUY" ? "USDT" : asset;
  const destSymbol = action === "BUY" ? asset : "USDT";
  const usdValue = round(qty * price, 6);
  await appendVenueTradeHistory({
    walletId: ASTER_WALLET_ID,
    walletAddress: ASTER_WALLET_ADDRESS,
    chainId: ASTER_CHAIN_ID,
    provider: "AsterDex",
    txHash,
    action,
    sourceSymbol,
    destSymbol,
    sourceAmount: action === "BUY" ? usdValue : qty,
    destAmount: action === "BUY" ? qty : usdValue,
    sourceUsdValue: usdValue,
    destUsdValue: usdValue,
    reason,
    executedAt,
  });
}

export async function refreshCombinedDecisionCache(modeOverride?: CombinedStrategyMode) {
  const runtimeControl = loadAutoTradeRuntimeControl();
  const mode = modeOverride || strategyModeFromActiveStrategy(runtimeControl.activeStrategy);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const clientConfig = loadAsterDexClientConfig();
  const liveClient = mode === "live" && clientConfig ? new AsterDexClient(clientConfig) : null;
  const state = await syncStateWithVenue(mode, await loadCombinedState(), liveClient, nowIso);
  const marketWindow = await loadCombinedMarketWindow(now - (72 * 60 * 60 * 1000), now + (5 * 60 * 1000));
  const signal = await loadLatestCombinedSignal(now);
  const latestPengu15m = latestCandleBefore(marketWindow.pengu15m, now);
  const latestHype15m = latestCandleBefore(marketWindow.hype15m, now);
  const latestEth15m = latestCandleBefore(marketWindow.eth15m, now);
  const penguCooldown = getLaneCooldown(state.laneCooldowns, "pengu_goldcat", nowIso);
  let penguCandidate = buildPenguCandidate(signal, marketWindow, now);
  if (penguCandidate && COMBINED_PENGU_GUARD_CONFIG.requireAlignmentForEntry && !isPengu15mAligned(latestPengu15m, penguCandidate.side)) {
    penguCandidate = null;
  }
  if (penguCandidate && penguCooldown) {
    penguCandidate = null;
  }
  const hypeCandidate = buildHypeFreqCandidate(marketWindow, now);
  const ethCandidate = buildEthReclaimCandidate(marketWindow, now);
  const currentPositions = sortPositions(state.currentPositions || []);
  const selectedCandidate = penguCandidate || hypeCandidate || ethCandidate;
  const primaryPosition = currentPositions[0] || null;
  const activeLaneId = primaryPosition
    ? positionLane(primaryPosition)
    : selectedCandidate?.laneId || "pengu_goldcat";
  const sizingSide = primaryPosition?.side || selectedCandidate?.side || signal.side;
  const sizing = buildSizingSnapshot(activeLaneId, sizingSide, latestPengu15m, nowIso);
  const currentPrice = primaryPosition
    ? latestLanePrice(marketWindow, positionLane(primaryPosition), now, primaryPosition.entryPrice)
    : selectedCandidate?.currentPrice || latestLanePrice(marketWindow, activeLaneId, now, 0);
  const activeConfig = laneConfig(activeLaneId);

  const decision = buildDecisionPayload(
    mode,
    signal,
    sizing,
    primaryPosition,
    {
      laneId: activeLaneId,
      executionSymbol: activeConfig.executionSymbol,
      marketSymbol: activeConfig.marketSymbol,
      currentPrice,
      latestPengu15m,
      latestHype15m,
      latestEth15m,
    },
    nowIso,
    selectedCandidate,
  );
  decision.currentPositions = currentPositions;
  await writeLiveDecisionCache(decision);
  return decision;
}

export async function runCombinedAutotrade(options: RunOptions = {}): Promise<LiveHybridRunSummary> {
  const runtimeControl = loadAutoTradeRuntimeControl();
  const trigger = options.trigger || "scheduled";
  const mode = options.modeOverride || strategyModeFromActiveStrategy(runtimeControl.activeStrategy);
  const initialNowIso = new Date().toISOString();
  const initialClientConfig = loadAsterDexClientConfig();
  const initialLiveClient = mode === "live" && initialClientConfig ? new AsterDexClient(initialClientConfig) : null;
  const initialState = await syncStateWithVenue(mode, await loadCombinedState(), initialLiveClient, initialNowIso);
  if (mode === "live" && initialLiveClient) {
    try {
      await maybeAutoConvertUsdtToUsdf({ skipBecausePositionOpen: (initialState.currentPositions || []).length > 0 });
    } catch (error) {
      console.warn("[combined] USDF auto-convert failed before trade run:", error);
    }
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const marketWindow = await loadCombinedMarketWindow(now - (72 * 60 * 60 * 1000), now + (5 * 60 * 1000));
  const signal = await loadLatestCombinedSignal(now);
  const latestPengu15m = latestCandleBefore(marketWindow.pengu15m, now);
  const latestHype15m = latestCandleBefore(marketWindow.hype15m, now);
  const latestEth15m = latestCandleBefore(marketWindow.eth15m, now);
  const penguCandidate = buildPenguCandidate(signal, marketWindow, now);
  const hypeCandidate = buildHypeFreqCandidate(marketWindow, now);
  const ethCandidate = buildEthReclaimCandidate(marketWindow, now);

  const clientConfig = loadAsterDexClientConfig();
  const liveClient = mode === "live" && clientConfig ? new AsterDexClient(clientConfig) : null;
  let state = await syncStateWithVenue(mode, await loadCombinedState(), liveClient, nowIso);
  let currentPositions = sortPositions(state.currentPositions || []);
  const laneCooldowns = { ...(state.laneCooldowns || {}) };
  const nextPositions = [...currentPositions];
  const walletResults: LiveHybridWalletRunResult[] = [];
  const laneOrder: CombinedLaneId[] = ["pengu_goldcat", "hype_freq", "eth_reclaim"];
  const penguCooldown = getLaneCooldown(laneCooldowns, "pengu_goldcat", nowIso);
  const penguAligned = penguCandidate ? isPengu15mAligned(latestPengu15m, penguCandidate.side) : false;
  const candidateMap: Record<CombinedLaneId, CombinedLaneCandidate | null> = {
    pengu_goldcat: penguCandidate && !penguCooldown && (!COMBINED_PENGU_GUARD_CONFIG.requireAlignmentForEntry || penguAligned)
      ? penguCandidate
      : null,
    hype_freq: hypeCandidate,
    eth_reclaim: ethCandidate,
  };

  for (const laneId of laneOrder) {
    const config = laneConfig(laneId);
    const currentPosition = getLanePosition(nextPositions, laneId);
    const candidate = candidateMap[laneId];
    const sizingSide = currentPosition?.side || candidate?.side || (laneId === "pengu_goldcat" ? signal.side : "long");
    const sizing = buildSizingSnapshot(laneId, sizingSide, latestPengu15m, nowIso);
    const lanePrice = currentPosition
      ? latestLanePrice(marketWindow, laneId, now, currentPosition.entryPrice)
      : candidate?.currentPrice || latestLanePrice(marketWindow, laneId, now, 0);

    if (currentPosition) {
      const exitEval = evaluatePositionExit(currentPosition, laneId === "pengu_goldcat" ? signal.side : "flat", lanePrice, nowIso);
      const addEntryCooldownElapsed = !currentPosition.lastAddedAt
        || ((Date.parse(nowIso) - Date.parse(currentPosition.lastAddedAt)) / 60_000) >= COMBINED_PENGU_GUARD_CONFIG.addEntryCooldownMinutes;
      const canAddSameSide = candidate
        && candidate.side === currentPosition.side
        && candidate.signalTs !== currentPosition.sourceSignalTs
        && (laneId !== "pengu_goldcat"
          || (
            (currentPosition.entryCount || 1) <= COMBINED_PENGU_GUARD_CONFIG.maxSameSideEntries
            && addEntryCooldownElapsed
            && exitEval.pnlPct >= COMBINED_PENGU_GUARD_CONFIG.minAddEntryPnlPct
          ));

      if (exitEval.shouldExit) {
        let txHash = syntheticTxHash(`combined-dry-exit-${currentPosition.marketSymbol}-${nowIso}`);
        let providerLabel = "combined-dry-run";
        let exitPrice = lanePrice;
        let notionalUsd = round(currentPosition.quantity * exitPrice, 6);
        try {
          if (liveClient) {
            const liveExit = await buildLiveExit(liveClient, currentPosition, nowIso);
            txHash = liveExit.txHash;
            providerLabel = "AsterDex";
            exitPrice = liveExit.fillPrice;
            notionalUsd = liveExit.notionalUsd;
            await persistTradeHistory(currentPosition.side === "long" ? "SELL" : "BUY", currentPosition.symbol, currentPosition.quantity, exitPrice, txHash, exitEval.exitReason || "Exit", nowIso);
          }
          const index = nextPositions.findIndex((position) => position.laneId === laneId);
          if (index >= 0) nextPositions.splice(index, 1);
          if (laneId === "pengu_goldcat") {
            if (exitEval.exitReason?.startsWith("stop loss reached")) {
              laneCooldowns.pengu_goldcat = {
                until: new Date(Date.parse(nowIso) + (COMBINED_PENGU_GUARD_CONFIG.cooldownAfterStopMinutes * 60_000)).toISOString(),
                reason: exitEval.exitReason,
              };
            } else if (exitEval.exitReason === "GoldCat side reversed.") {
              laneCooldowns.pengu_goldcat = {
                until: new Date(Date.parse(nowIso) + (COMBINED_PENGU_GUARD_CONFIG.cooldownAfterReverseMinutes * 60_000)).toISOString(),
                reason: exitEval.exitReason,
              };
            }
          }
          walletResults.push({
            walletId: ASTER_WALLET_ID,
            address: ASTER_WALLET_ADDRESS,
            status: "traded",
            step: "sell",
            stepLabel: `close ${config.executionSymbol}`,
            reason: exitEval.exitReason || `Close ${laneDisplayName(laneId)}`,
            desiredSymbol: "USDT",
            desiredSide: "cash",
            currentSymbol: currentPosition.symbol,
            trade: {
              ok: true,
              txHash,
              quotedSourceAmount: currentPosition.quantity,
              quotedDestAmount: notionalUsd,
              quotedSourceUsdValue: round(currentPosition.quantity * currentPosition.entryPrice, 6),
              quotedDestUsdValue: notionalUsd,
              details: `${providerLabel} lane=${laneDisplayName(laneId)}`,
            },
          });
        } catch (error) {
          walletResults.push({
            walletId: ASTER_WALLET_ID,
            address: ASTER_WALLET_ADDRESS,
            status: "error",
            step: "sell",
            stepLabel: "close failed",
            reason: error instanceof Error ? error.message : `${laneDisplayName(laneId)} exit failed`,
            desiredSymbol: "USDT",
            desiredSide: "cash",
            currentSymbol: currentPosition.symbol,
          });
        }
        continue;
      }

      if (canAddSameSide) {
        let notionalUsd = round(DRY_RUN_NOTIONAL_USD * sizing.multiplier, 6);
        let quantity = round(notionalUsd / Math.max(lanePrice, 0.000001), 6);
        let entryPrice = lanePrice;
        let txHash = syntheticTxHash(`combined-dry-entry-${config.marketSymbol}-${nowIso}`);
        let providerLabel = "combined-dry-run";
        let externalOrderId: string | null = null;
        try {
          if (liveClient) {
            const liveEntry = await buildLiveEntry(liveClient, laneId, currentPosition.side, sizing.multiplier, nowIso);
            quantity = liveEntry.quantity;
            entryPrice = liveEntry.fillPrice;
            txHash = liveEntry.txHash;
            providerLabel = "AsterDex";
            externalOrderId = liveEntry.orderId;
            notionalUsd = liveEntry.notionalUsd;
            await persistTradeHistory(currentPosition.side === "long" ? "BUY" : "SELL", config.executionSymbol, quantity, entryPrice, txHash, `${candidate.reason} / add same-side entry`, nowIso);
          }
          const index = nextPositions.findIndex((position) => position.laneId === laneId);
          if (index >= 0) {
            nextPositions[index] = {
              ...currentPosition,
              quantity: round(currentPosition.quantity + quantity, 6),
              entryPrice: round(((currentPosition.quantity * currentPosition.entryPrice) + (quantity * entryPrice)) / Math.max(currentPosition.quantity + quantity, 0.000001), 8),
              entryCount: (currentPosition.entryCount || 1) + 1,
              sizeMultiplier: sizing.multiplier,
              highWatermark: currentPosition.side === "long" ? Math.max(currentPosition.highWatermark, entryPrice) : currentPosition.highWatermark,
              lowWatermark: currentPosition.side === "short" ? Math.min(currentPosition.lowWatermark, entryPrice) : currentPosition.lowWatermark,
              sourceSignalTs: candidate.signalTs,
              lastAddedAt: nowIso,
              externalOrderId,
            };
          }
          walletResults.push({
            walletId: ASTER_WALLET_ID,
            address: ASTER_WALLET_ADDRESS,
            status: "traded",
            step: currentPosition.side === "long" ? "buy" : "sell",
            stepLabel: `add ${config.executionSymbol}`,
            reason: `${candidate.reason} / ${sizing.reason} / Add same-side entry.`,
            desiredSymbol: config.executionSymbol,
            desiredSide: "trend",
            currentSymbol: config.executionSymbol,
            trade: {
              ok: true,
              txHash,
              quotedSourceAmount: notionalUsd,
              quotedDestAmount: quantity,
              quotedSourceUsdValue: notionalUsd,
              quotedDestUsdValue: notionalUsd,
              details: `${providerLabel} lane=${laneDisplayName(laneId)} size=${sizing.multiplier}x add-entry`,
            },
          });
        } catch (error) {
          walletResults.push({
            walletId: ASTER_WALLET_ID,
            address: ASTER_WALLET_ADDRESS,
            status: "error",
            step: currentPosition.side === "long" ? "buy" : "sell",
            stepLabel: "add-entry failed",
            reason: error instanceof Error ? error.message : `${laneDisplayName(laneId)} add-entry failed`,
            desiredSymbol: config.executionSymbol,
            desiredSide: "trend",
            currentSymbol: config.executionSymbol,
          });
        }
        continue;
      }

      const index = nextPositions.findIndex((position) => position.laneId === laneId);
      if (index >= 0) {
        nextPositions[index] = {
          ...currentPosition,
          highWatermark: exitEval.highWatermark,
          lowWatermark: exitEval.lowWatermark,
        };
      }
      walletResults.push({
        walletId: ASTER_WALLET_ID,
        address: ASTER_WALLET_ADDRESS,
        status: "noop",
        step: "hold",
        stepLabel: "hold",
        reason: `Holding ${laneDisplayName(laneId)}. Unrealized PnL ${(exitEval.pnlPct * 100).toFixed(2)}%.`,
        desiredSymbol: currentPosition.symbol,
        desiredSide: "trend",
        currentSymbol: currentPosition.symbol,
      });
      continue;
    }

      if (candidate) {
      let notionalUsd = round(DRY_RUN_NOTIONAL_USD * sizing.multiplier, 6);
      let quantity = round(notionalUsd / Math.max(lanePrice, 0.000001), 6);
      let entryPrice = lanePrice;
      let txHash = syntheticTxHash(`combined-dry-entry-${config.marketSymbol}-${nowIso}`);
      let providerLabel = "combined-dry-run";
      let externalOrderId: string | null = null;
      try {
        if (liveClient) {
          const liveEntry = await buildLiveEntry(liveClient, laneId, candidate.side, sizing.multiplier, nowIso);
          quantity = liveEntry.quantity;
          entryPrice = liveEntry.fillPrice;
          txHash = liveEntry.txHash;
          providerLabel = "AsterDex";
          externalOrderId = liveEntry.orderId;
          notionalUsd = liveEntry.notionalUsd;
          await persistTradeHistory(candidate.side === "long" ? "BUY" : "SELL", config.executionSymbol, quantity, entryPrice, txHash, `${candidate.reason} / ${sizing.reason}`, nowIso);
        }
        nextPositions.push({
          laneId,
          symbol: config.executionSymbol,
          marketSymbol: config.marketSymbol,
          side: candidate.side,
          quantity,
          entryPrice,
          entryTs: nowIso,
          entryCount: 1,
          sizeMultiplier: sizing.multiplier,
          highWatermark: entryPrice,
          lowWatermark: entryPrice,
          sourceSignalTs: candidate.signalTs,
          lastAddedAt: nowIso,
          externalOrderId,
        });
        if (laneId === "pengu_goldcat") {
          laneCooldowns.pengu_goldcat = null;
        }
        walletResults.push({
          walletId: ASTER_WALLET_ID,
          address: ASTER_WALLET_ADDRESS,
          status: "traded",
          step: candidate.side === "long" ? "buy" : "sell",
          stepLabel: `open ${config.executionSymbol}`,
          reason: `${candidate.reason} / ${sizing.reason}`,
          desiredSymbol: config.executionSymbol,
          desiredSide: "trend",
          currentSymbol: "USDT",
          trade: {
            ok: true,
            txHash,
            quotedSourceAmount: notionalUsd,
            quotedDestAmount: quantity,
            quotedSourceUsdValue: notionalUsd,
            quotedDestUsdValue: notionalUsd,
            details: `${providerLabel} lane=${laneDisplayName(laneId)} size=${sizing.multiplier}x`,
          },
        });
      } catch (error) {
        walletResults.push({
          walletId: ASTER_WALLET_ID,
          address: ASTER_WALLET_ADDRESS,
          status: "error",
          step: candidate.side === "long" ? "buy" : "sell",
          stepLabel: "entry failed",
          reason: error instanceof Error ? error.message : `${laneDisplayName(laneId)} entry failed`,
          desiredSymbol: config.executionSymbol,
          desiredSide: "trend",
          currentSymbol: "USDT",
        });
      }
      continue;
    }

    if (laneId === "pengu_goldcat" && penguCooldown) {
      walletResults.push({
        walletId: ASTER_WALLET_ID,
        address: ASTER_WALLET_ADDRESS,
        status: "skipped",
        step: "wait",
        stepLabel: "cooldown",
        reason: `PENGU cooldown active until ${penguCooldown.until} (${penguCooldown.reason})`,
        desiredSymbol: config.executionSymbol,
        desiredSide: "cash",
        currentSymbol: "USDT",
      });
      continue;
    }

    if (laneId === "pengu_goldcat" && penguCandidate && COMBINED_PENGU_GUARD_CONFIG.requireAlignmentForEntry && !penguAligned) {
      walletResults.push({
        walletId: ASTER_WALLET_ID,
        address: ASTER_WALLET_ADDRESS,
        status: "skipped",
        step: "wait",
        stepLabel: "alignment filter",
        reason: "PENGU 15m is unaligned, so new PENGU entries are skipped.",
        desiredSymbol: config.executionSymbol,
        desiredSide: "cash",
        currentSymbol: "USDT",
      });
      continue;
    }

    walletResults.push({
      walletId: ASTER_WALLET_ID,
      address: ASTER_WALLET_ADDRESS,
      status: "skipped",
      step: "wait",
      stepLabel: "wait",
      reason: `No ${laneDisplayName(laneId)} entry.`,
      desiredSymbol: config.executionSymbol,
      desiredSide: "cash",
      currentSymbol: "USDT",
    });
  }

  const finalPositions = sortPositions(nextPositions);
  await saveCombinedState({
    updatedAt: nowIso,
    currentPositions: finalPositions,
    currentPosition: finalPositions[0] || null,
    laneCooldowns,
  });
  const refreshedDecision = await refreshCombinedDecisionCache(mode);
  const summary = buildSummary(trigger, refreshedDecision, walletResults);
  await appendAutoTradeHistory(summary);
  return summary;
}
