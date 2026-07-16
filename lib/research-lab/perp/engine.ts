import type { Candle1h } from "@/lib/backtest/types";
import { researchMetricsFromSeries } from "../metrics";
import type { TemporalWindow } from "../types";
import type {
  PerpBacktestResult,
  PerpBar,
  PerpEquityPoint,
  PerpExecutionAssumptions,
  PerpFundingPoint,
  PerpMarketData,
  PerpSide,
  PerpStrategyGenome,
  PerpTrade,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;
const STARTING_EQUITY = 10_000;

interface PreparedMarketData {
  timeframeHours: number;
  bySymbol: Record<string, PerpBar[]>;
  indexBySymbolAndTs: Record<string, Map<number, number>>;
  timeline: number[];
}

interface SignalCandidate {
  symbol: string;
  side: PerpSide;
  score: number;
  atr: number;
  signalTs: number;
}

interface OpenPosition {
  tradeId: string;
  symbol: string;
  side: PerpSide;
  entryTs: number;
  entryPrice: number;
  quantity: number;
  notional: number;
  effectiveLeverage: number;
  entryFee: number;
  fundingCost: number;
  lastFundingTs: number;
  initialStopPrice: number;
  trailingStopPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number;
  peakPrice: number;
  troughPrice: number;
  atrAtEntry: number;
  holdingBars: number;
}

const preparedCache = new WeakMap<PerpMarketData, Map<number, PreparedMarketData>>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const center = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function resampleToHours(candles: Candle1h[], hours: number): PerpBar[] {
  const bucketMs = hours * HOUR_MS;
  const buckets = new Map<number, PerpBar>();
  for (const candle of candles) {
    const bucketTs = Math.floor(candle.ts / bucketMs) * bucketMs;
    const existing = buckets.get(bucketTs);
    if (!existing) {
      buckets.set(bucketTs, { ...candle, ts: bucketTs });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }
  return [...buckets.values()].sort((left, right) => left.ts - right.ts);
}

function prepareMarketData(data: PerpMarketData, timeframeHours: number): PreparedMarketData {
  let byTimeframe = preparedCache.get(data);
  if (!byTimeframe) {
    byTimeframe = new Map<number, PreparedMarketData>();
    preparedCache.set(data, byTimeframe);
  }
  const cached = byTimeframe.get(timeframeHours);
  if (cached) return cached;

  const bySymbol: Record<string, PerpBar[]> = {};
  const indexBySymbolAndTs: Record<string, Map<number, number>> = {};
  for (const [symbol, candles] of Object.entries(data.bySymbol)) {
    const bars = resampleToHours(candles, timeframeHours);
    bySymbol[symbol] = bars;
    indexBySymbolAndTs[symbol] = new Map(bars.map((bar, index) => [bar.ts, index]));
  }
  const timeline = (bySymbol.BTC ?? []).map((bar) => bar.ts);
  const prepared = { timeframeHours, bySymbol, indexBySymbolAndTs, timeline };
  byTimeframe.set(timeframeHours, prepared);
  return prepared;
}

function closeSma(bars: PerpBar[], index: number, lookback: number) {
  if (index - lookback + 1 < 0) return null;
  return mean(bars.slice(index - lookback + 1, index + 1).map((bar) => bar.close));
}

function momentum(bars: PerpBar[], index: number, lookback: number) {
  const prior = bars[index - lookback];
  const current = bars[index];
  if (!prior || !current || prior.close <= 0) return null;
  return current.close / prior.close - 1;
}

function averageTrueRange(bars: PerpBar[], index: number, lookback: number) {
  if (index - lookback < 0) return null;
  const ranges: number[] = [];
  for (let cursor = index - lookback + 1; cursor <= index; cursor += 1) {
    const bar = bars[cursor];
    const prior = bars[cursor - 1];
    if (!bar || !prior) return null;
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prior.close), Math.abs(bar.low - prior.close)));
  }
  return mean(ranges);
}

function realizedVolatility(bars: PerpBar[], index: number, lookback: number) {
  if (index - lookback < 0) return null;
  const returns: number[] = [];
  for (let cursor = index - lookback + 1; cursor <= index; cursor += 1) {
    const bar = bars[cursor];
    const prior = bars[cursor - 1];
    if (!bar || !prior || bar.close <= 0 || prior.close <= 0) return null;
    returns.push(Math.log(bar.close / prior.close));
  }
  return standardDeviation(returns);
}

function volumeRatio(bars: PerpBar[], index: number, lookback = 20) {
  if (index - lookback < 0) return null;
  const current = bars[index];
  const baseline = mean(bars.slice(index - lookback, index).map((bar) => bar.volume));
  if (!current || baseline <= 0) return null;
  return current.volume / baseline;
}

function priorHighLow(bars: PerpBar[], index: number, lookback: number) {
  if (index - lookback < 0) return null;
  const prior = bars.slice(index - lookback, index);
  return {
    high: Math.max(...prior.map((bar) => bar.high)),
    low: Math.min(...prior.map((bar) => bar.low)),
  };
}

function estimatedRoundTripCostPct(
  execution: PerpExecutionAssumptions,
  genome: PerpStrategyGenome,
) {
  const fixedCostPct = ((execution.feeBpsPerSide + execution.slippageBpsPerSide) * 2) / 10_000;
  const expectedHoldBars = Math.max(1, Math.min(genome.parameters.maxHoldBars, 24));
  const expectedHoldHours = expectedHoldBars * genome.parameters.timeframeHours;
  const fundingBufferPct = (execution.adverseFundingBpsPer8h / 10_000) * (expectedHoldHours / 8);
  return fixedCostPct + fundingBufferPct;
}

function signalForTimestamp(
  prepared: PreparedMarketData,
  genome: PerpStrategyGenome,
  ts: number,
  execution: PerpExecutionAssumptions,
): SignalCandidate | null {
  const parameters = genome.parameters;
  const btcBars = prepared.bySymbol.BTC;
  const btcIndex = prepared.indexBySymbolAndTs.BTC?.get(ts);
  if (!btcBars || btcIndex == null) return null;

  const btcSma = closeSma(btcBars, btcIndex, parameters.btcRegimeSmaBars);
  const btcMomentum = momentum(btcBars, btcIndex, parameters.btcRegimeMomentumBars);
  const btcBar = btcBars[btcIndex];
  if (!btcBar || btcSma == null || btcMomentum == null || btcSma <= 0) return null;

  const btcDistance = btcBar.close / btcSma - 1;
  const longRegime = btcDistance >= parameters.regimeThresholdPct && btcMomentum > 0;
  const shortRegime = btcDistance <= -parameters.regimeThresholdPct && btcMomentum < 0;
  const neutralRegime = !longRegime && !shortRegime;
  const candidates: SignalCandidate[] = [];
  const minimumExpectedMove = estimatedRoundTripCostPct(execution, genome) * parameters.minimumEdgeToCostRatio;

  for (const symbol of genome.symbols) {
    const bars = prepared.bySymbol[symbol];
    const index = prepared.indexBySymbolAndTs[symbol]?.get(ts);
    if (!bars || index == null) continue;

    const bar = bars[index];
    const assetMomentum = momentum(bars, index, parameters.momentumBars);
    const volatility = realizedVolatility(bars, index, parameters.volatilityLookbackBars);
    const atr = averageTrueRange(bars, index, parameters.atrBars);
    const volume = volumeRatio(bars, index);
    const levels = priorHighLow(bars, index, parameters.breakoutBars);
    if (!bar || assetMomentum == null || volatility == null || atr == null || volume == null || !levels || bar.close <= 0) continue;
    if (volume < parameters.minimumVolumeRatio) continue;
    if (Math.abs(assetMomentum) < minimumExpectedMove) continue;

    const longBreakout = bar.close >= levels.high * (1 + parameters.breakoutBufferPct);
    const shortBreakout = bar.close <= levels.low * (1 - parameters.breakoutBufferPct);
    const requireBreakout = genome.family === "breakout" || genome.family === "dual_direction";
    const volatilityScale = Math.max(0.0001, volatility * Math.sqrt(parameters.momentumBars));
    const normalizedMomentum = assetMomentum / volatilityScale;
    const score = normalizedMomentum / (1 + parameters.volatilityPenalty * volatility * 100);

    const longEligible =
      parameters.allowLong &&
      assetMomentum >= parameters.minimumMomentumPct &&
      (!requireBreakout || longBreakout);
    const shortEligible =
      parameters.allowShort &&
      assetMomentum <= -parameters.minimumMomentumPct &&
      (!requireBreakout || shortBreakout);

    if (longEligible && (longRegime || (neutralRegime && parameters.allowNeutralRegime && score >= parameters.neutralScoreThreshold))) {
      candidates.push({ symbol, side: "long", score, atr, signalTs: ts });
    }
    if (shortEligible && (shortRegime || (neutralRegime && parameters.allowNeutralRegime && -score >= parameters.neutralScoreThreshold))) {
      candidates.push({ symbol, side: "short", score: -score, atr, signalTs: ts });
    }
  }

  return candidates.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0] ?? null;
}

function adverseEntryPrice(rawPrice: number, side: PerpSide, slippageRate: number) {
  return side === "long" ? rawPrice * (1 + slippageRate) : rawPrice * (1 - slippageRate);
}

function adverseExitPrice(rawPrice: number, side: PerpSide, slippageRate: number) {
  return side === "long" ? rawPrice * (1 - slippageRate) : rawPrice * (1 + slippageRate);
}

function unrealizedPnl(position: OpenPosition, markPrice: number) {
  const direction = position.side === "long" ? 1 : -1;
  return direction * position.quantity * (markPrice - position.entryPrice);
}

function currentEquity(balance: number, position: OpenPosition | null, markPrice: number, feeRate: number) {
  if (!position) return Math.max(0, balance);
  const exitFee = position.quantity * markPrice * feeRate;
  return Math.max(0, balance + unrealizedPnl(position, markPrice) - exitFee);
}

function firstFundingIndexAfter(points: PerpFundingPoint[], ts: number) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((points[middle]?.ts ?? Number.POSITIVE_INFINITY) <= ts) low = middle + 1;
    else high = middle;
  }
  return low;
}

function fundingRateBetween(points: PerpFundingPoint[], fromExclusive: number, toInclusive: number) {
  let index = firstFundingIndexAfter(points, fromExclusive);
  let total = 0;
  while (index < points.length) {
    const point = points[index];
    if (!point || point.ts > toInclusive) break;
    total += point.rate;
    index += 1;
  }
  return total;
}

function fundingCharge(input: {
  position: OpenPosition;
  fundingPoints: PerpFundingPoint[];
  toTs: number;
  execution: PerpExecutionAssumptions;
  timeframeHours: number;
}) {
  const { position, fundingPoints, toTs, execution, timeframeHours } = input;
  const actualRate = fundingRateBetween(fundingPoints, position.lastFundingTs, toTs);
  const sideMultiplier = position.side === "long" ? 1 : -1;
  const actualFundingCost = position.notional * actualRate * sideMultiplier;
  const adverseBufferCost =
    position.notional *
    (execution.adverseFundingBpsPer8h / 10_000) *
    (timeframeHours / 8);
  return actualFundingCost + adverseBufferCost;
}

function monthlyAndAnnualReturns(points: PerpEquityPoint[]) {
  const build = (key: (point: PerpEquityPoint) => string) => {
    const buckets = new Map<string, PerpEquityPoint[]>();
    for (const point of points) {
      const bucketKey = key(point);
      const bucket = buckets.get(bucketKey) ?? [];
      bucket.push(point);
      buckets.set(bucketKey, bucket);
    }
    return [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, bucket]) => {
        const first = bucket[0]?.equity ?? STARTING_EQUITY;
        const last = bucket.at(-1)?.equity ?? first;
        return first > 0 ? (last / first - 1) * 100 : -100;
      });
  };

  return {
    monthly: build((point) => new Date(point.ts).toISOString().slice(0, 7)),
    annual: build((point) => new Date(point.ts).toISOString().slice(0, 4)),
  };
}

function maxDrawdownPct(points: PerpEquityPoint[]) {
  let peak = points[0]?.equity ?? STARTING_EQUITY;
  let worst = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.max(worst, (peak - point.equity) / peak);
  }
  return worst * 100;
}

function cagrPct(points: PerpEquityPoint[]) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || first.equity <= 0 || last.equity <= 0 || last.ts <= first.ts) return -100;
  const years = (last.ts - first.ts) / (365.25 * 24 * HOUR_MS);
  return (Math.pow(last.equity / first.equity, 1 / Math.max(1 / 365, years)) - 1) * 100;
}

function maxConsecutiveLosses(trades: PerpTrade[]) {
  let current = 0;
  let worst = 0;
  for (const trade of trades) {
    current = trade.netPnl < 0 ? current + 1 : 0;
    worst = Math.max(worst, current);
  }
  return worst;
}

export function runPerpBacktest(input: {
  genome: PerpStrategyGenome;
  data: PerpMarketData;
  window: TemporalWindow;
  execution: PerpExecutionAssumptions;
  targetMonthlyReturnPct: number;
}): PerpBacktestResult {
  const { genome, data, window, execution, targetMonthlyReturnPct } = input;
  const parameters = genome.parameters;
  const prepared = prepareMarketData(data, parameters.timeframeHours);
  const feeRate = execution.feeBpsPerSide / 10_000;
  const slippageRate = execution.slippageBpsPerSide / 10_000;
  const timeline = prepared.timeline.filter((ts) => ts >= window.startTs && ts < window.endTs);
  const trades: PerpTrade[] = [];
  const equityCurve: PerpEquityPoint[] = [];
  let balance = STARTING_EQUITY;
  let position: OpenPosition | null = null;
  let pendingEntry: SignalCandidate | null = null;
  let pendingExitReason: string | null = null;
  let cooldownUntilTs = 0;
  let tradeSequence = 0;
  let exposureBars = 0;
  let stopped = false;

  const closePosition = (rawPrice: number, exitTs: number, exitReason: string, liquidated: boolean) => {
    if (!position) return;
    const closing = position;
    const exitPrice = adverseExitPrice(rawPrice, closing.side, slippageRate);
    const direction = closing.side === "long" ? 1 : -1;
    const grossPnl = direction * closing.quantity * (exitPrice - closing.entryPrice);
    const exitFee = closing.quantity * exitPrice * feeRate;
    balance = Math.max(0, balance + grossPnl - exitFee);
    const netPnl = grossPnl - closing.entryFee - exitFee - closing.fundingCost;
    trades.push({
      tradeId: closing.tradeId,
      symbol: closing.symbol,
      side: closing.side,
      entryTs: closing.entryTs,
      exitTs,
      entryPrice: closing.entryPrice,
      exitPrice,
      quantity: closing.quantity,
      notional: closing.notional,
      effectiveLeverage: closing.effectiveLeverage,
      stopPrice: closing.initialStopPrice,
      takeProfitPrice: closing.takeProfitPrice,
      grossPnl,
      entryFee: closing.entryFee,
      exitFee,
      fundingCost: closing.fundingCost,
      netPnl,
      holdingBars: closing.holdingBars,
      exitReason,
      liquidated,
    });
    position = null;
  };

  for (const ts of timeline) {
    if (stopped) break;

    if (pendingExitReason && position) {
      const exitBarIndex = prepared.indexBySymbolAndTs[position.symbol]?.get(ts);
      const exitBar = exitBarIndex == null ? null : prepared.bySymbol[position.symbol]?.[exitBarIndex];
      if (exitBar) closePosition(exitBar.open, ts, pendingExitReason, false);
      pendingExitReason = null;
    }

    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0) {
      const entryBarIndex = prepared.indexBySymbolAndTs[pendingEntry.symbol]?.get(ts);
      const entryBar = entryBarIndex == null ? null : prepared.bySymbol[pendingEntry.symbol]?.[entryBarIndex];
      if (entryBar) {
        const entryPrice = adverseEntryPrice(entryBar.open, pendingEntry.side, slippageRate);
        const stopDistance = Math.max(pendingEntry.atr * parameters.stopAtr, entryPrice * 0.005);
        const stopDistancePct = stopDistance / entryPrice;
        const riskCapital = balance * (parameters.riskPerTradePct / 100);
        const riskSizedNotional = riskCapital / Math.max(0.001, stopDistancePct);
        const maximumNotional = balance * parameters.leverage * (parameters.maxMarginUsagePct / 100);
        const notional = Math.min(riskSizedNotional, maximumNotional);
        const effectiveLeverage = notional / Math.max(1, balance);
        const quantity = notional / entryPrice;
        const entryFee = notional * feeRate;

        if (Number.isFinite(quantity) && quantity > 0 && effectiveLeverage >= 0.1 && entryFee < balance * 0.1) {
          balance -= entryFee;
          const liquidationDistance = Math.max(0.005, 1 / Math.max(0.1, effectiveLeverage) - execution.maintenanceMarginRate);
          const rawStop = pendingEntry.side === "long" ? entryPrice - stopDistance : entryPrice + stopDistance;
          const liquidationPrice = pendingEntry.side === "long"
            ? entryPrice * (1 - liquidationDistance)
            : entryPrice * (1 + liquidationDistance);
          const initialStopPrice = pendingEntry.side === "long"
            ? Math.max(rawStop, liquidationPrice * 1.01)
            : Math.min(rawStop, liquidationPrice * 0.99);
          const takeProfitPrice = pendingEntry.side === "long"
            ? entryPrice + pendingEntry.atr * parameters.takeProfitAtr
            : entryPrice - pendingEntry.atr * parameters.takeProfitAtr;

          tradeSequence += 1;
          position = {
            tradeId: `perp-${genome.id}-${String(tradeSequence).padStart(4, "0")}`,
            symbol: pendingEntry.symbol,
            side: pendingEntry.side,
            entryTs: ts,
            entryPrice,
            quantity,
            notional,
            effectiveLeverage,
            entryFee,
            fundingCost: 0,
            lastFundingTs: ts,
            initialStopPrice,
            trailingStopPrice: initialStopPrice,
            takeProfitPrice,
            liquidationPrice,
            peakPrice: entryPrice,
            troughPrice: entryPrice,
            atrAtEntry: pendingEntry.atr,
            holdingBars: 0,
          };
        }
      }
      pendingEntry = null;
    }

    if (position) {
      const positionBarIndex = prepared.indexBySymbolAndTs[position.symbol]?.get(ts);
      const bar = positionBarIndex == null ? null : prepared.bySymbol[position.symbol]?.[positionBarIndex];
      if (bar) {
        exposureBars += 1;
        position.holdingBars += 1;
        const charge = fundingCharge({
          position,
          fundingPoints: data.fundingBySymbol[position.symbol] ?? [],
          toTs: ts,
          execution,
          timeframeHours: parameters.timeframeHours,
        });
        position.fundingCost += charge;
        position.lastFundingTs = ts;
        balance = Math.max(0, balance - charge);

        const stopPrice = position.trailingStopPrice;
        if (position.side === "long") {
          if (bar.low <= position.liquidationPrice) {
            closePosition(position.liquidationPrice, ts, "liquidation", true);
          } else if (bar.low <= stopPrice) {
            closePosition(stopPrice, ts, stopPrice > position.initialStopPrice ? "trailing-stop" : "stop-loss", false);
          } else if (bar.high >= position.takeProfitPrice) {
            closePosition(position.takeProfitPrice, ts, "take-profit", false);
          }
        } else if (bar.high >= position.liquidationPrice) {
          closePosition(position.liquidationPrice, ts, "liquidation", true);
        } else if (bar.high >= stopPrice) {
          closePosition(stopPrice, ts, stopPrice < position.initialStopPrice ? "trailing-stop" : "stop-loss", false);
        } else if (bar.low <= position.takeProfitPrice) {
          closePosition(position.takeProfitPrice, ts, "take-profit", false);
        }

        if (position) {
          position.peakPrice = Math.max(position.peakPrice, bar.high);
          position.troughPrice = Math.min(position.troughPrice, bar.low);
          if (position.side === "long") {
            position.trailingStopPrice = Math.max(
              position.initialStopPrice,
              position.peakPrice - position.atrAtEntry * parameters.trailingAtr,
            );
          } else {
            position.trailingStopPrice = Math.min(
              position.initialStopPrice,
              position.troughPrice + position.atrAtEntry * parameters.trailingAtr,
            );
          }
        } else {
          cooldownUntilTs = ts + parameters.cooldownBars * parameters.timeframeHours * HOUR_MS;
        }
      }
    }

    const btcBarIndex = prepared.indexBySymbolAndTs.BTC?.get(ts);
    const btcBar = btcBarIndex == null ? null : prepared.bySymbol.BTC?.[btcBarIndex];
    if (!btcBar) continue;

    const markBarIndex = position ? prepared.indexBySymbolAndTs[position.symbol]?.get(ts) : null;
    const markBar = position && markBarIndex != null ? prepared.bySymbol[position.symbol]?.[markBarIndex] : null;
    const markPrice = markBar?.close ?? btcBar.close;
    const unrealized = position ? unrealizedPnl(position, markPrice) : 0;
    equityCurve.push({
      ts,
      equity: currentEquity(balance, position, markPrice, feeRate),
      balance,
      unrealizedPnl: unrealized,
      symbol: position?.symbol ?? "",
      side: position?.side ?? "cash",
      effectiveLeverage: position?.effectiveLeverage ?? 0,
    });

    if (balance <= 0) {
      stopped = true;
      break;
    }

    const nextSignal = signalForTimestamp(prepared, genome, ts, execution);
    if (position) {
      const maxHoldReached = position.holdingBars >= parameters.maxHoldBars;
      const rebalanceReached = position.holdingBars >= parameters.rebalanceBars;
      const signalChanged = nextSignal && (nextSignal.symbol !== position.symbol || nextSignal.side !== position.side);
      if (maxHoldReached) {
        pendingExitReason = "max-hold";
      } else if (rebalanceReached && signalChanged) {
        pendingExitReason = "signal-rotation";
        pendingEntry = nextSignal;
      }
    } else if (ts >= cooldownUntilTs && nextSignal) {
      pendingEntry = nextSignal;
    }
  }

  if (position) {
    const lastTs = Math.min(window.endTs - 1, prepared.timeline.filter((ts) => ts < window.endTs).at(-1) ?? window.endTs - 1);
    const lastIndex = prepared.indexBySymbolAndTs[position.symbol]?.get(lastTs);
    const lastBar = lastIndex == null ? prepared.bySymbol[position.symbol]?.at(-1) : prepared.bySymbol[position.symbol]?.[lastIndex];
    if (lastBar) closePosition(lastBar.close, lastBar.ts, "window-end", false);
  }

  if (!equityCurve.length) {
    equityCurve.push({
      ts: window.startTs,
      equity: balance,
      balance,
      unrealizedPnl: 0,
      symbol: "",
      side: "cash",
      effectiveLeverage: 0,
    });
  }

  const returns = monthlyAndAnnualReturns(equityCurve);
  const grossProfit = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + trade.netPnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const winningTrades = trades.filter((trade) => trade.netPnl > 0).length;
  const exposurePct = timeline.length ? (exposureBars / timeline.length) * 100 : 0;
  const endingEquity = equityCurve.at(-1)?.equity ?? balance;
  const metrics = researchMetricsFromSeries({
    monthlyReturnsPct: returns.monthly,
    annualReturnsPct: returns.annual,
    targetMonthlyReturnPct,
    profitFactor,
    winRatePct: trades.length ? (winningTrades / trades.length) * 100 : 0,
    tradeCount: trades.length,
    exposurePct,
    cagrPct: cagrPct(equityCurve),
    maxDrawdownPct: maxDrawdownPct(equityCurve),
  });

  return {
    genomeId: genome.id,
    window,
    execution,
    metrics,
    risk: {
      liquidationCount: trades.filter((trade) => trade.liquidated).length,
      longTrades: trades.filter((trade) => trade.side === "long").length,
      shortTrades: trades.filter((trade) => trade.side === "short").length,
      maxConsecutiveLosses: maxConsecutiveLosses(trades),
      averageHoldingBars: mean(trades.map((trade) => trade.holdingBars)),
      averageEffectiveLeverage: mean(trades.map((trade) => trade.effectiveLeverage)),
      maximumEffectiveLeverage: trades.length ? Math.max(...trades.map((trade) => trade.effectiveLeverage)) : 0,
      totalFundingCost: trades.reduce((sum, trade) => sum + trade.fundingCost, 0),
      exposurePct,
      endingEquity,
    },
    trades,
    equityCurve,
    monthlyReturnsPct: returns.monthly,
    annualReturnsPct: returns.annual,
  };
}
