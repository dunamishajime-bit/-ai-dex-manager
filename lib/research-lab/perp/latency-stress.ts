import { runPerpBacktest } from "./engine";
import type {
  PerpBacktestResult,
  PerpExecutionAssumptions,
  PerpFundingPoint,
  PerpMarketData,
  PerpStrategyGenome,
} from "./types";

const HOUR = 60 * 60 * 1000;
const STARTING_EQUITY = 10_000;

export type LatencyReplayMode = "none" | "entry" | "exit" | "both";
export type LatencyStressConfig = {
  delayHours: number;
  feeBpsPerSide: number;
  slippageBpsPerSide: number;
};

function pf(pnls: number[]) {
  const gp = pnls.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const gl = Math.abs(pnls.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
}

function pfWithoutBest(pnls: number[]) {
  const copy = [...pnls];
  if (copy.length) copy.splice(copy.indexOf(Math.max(...copy)), 1);
  return pf(copy);
}

function firstFundingIndexAfter(points: PerpFundingPoint[], ts: number) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if ((points[m]?.ts ?? Number.POSITIVE_INFINITY) <= ts) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function fundingRateBetween(points: PerpFundingPoint[], fromExclusive: number, toInclusive: number) {
  let i = firstFundingIndexAfter(points, fromExclusive);
  let total = 0;
  while (i < points.length) {
    const point = points[i];
    if (!point || point.ts > toInclusive) break;
    total += point.rate;
    i += 1;
  }
  return total;
}

function adverseEntry(raw: number, side: "long" | "short", slipRate: number) {
  return side === "long" ? raw * (1 + slipRate) : raw * (1 - slipRate);
}
function adverseExit(raw: number, side: "long" | "short", slipRate: number) {
  return side === "long" ? raw * (1 - slipRate) : raw * (1 + slipRate);
}

export function replayWithLatencyStress(input: {
  original: PerpBacktestResult;
  data: PerpMarketData;
  startTs: number;
  endTs: number;
  mode: LatencyReplayMode;
  stress: LatencyStressConfig;
}) {
  const feeRate = input.stress.feeBpsPerSide / 10_000;
  const slipRate = input.stress.slippageBpsPerSide / 10_000;
  const delayMs = input.stress.delayHours * HOUR;
  const indexes = Object.fromEntries(
    Object.entries(input.data.bySymbol).map(([symbol, rows]) => [symbol, new Map(rows.map((row, i) => [row.ts, i]))]),
  );

  let balance = STARTING_EQUITY;
  let peak = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let skippedInfeasibleTrades = 0;
  const pnls: number[] = [];

  for (const trade of input.original.trades) {
    const delayEntry = input.mode === "entry" || input.mode === "both";
    const delayExit = input.mode === "exit" || input.mode === "both";
    const entryTs = trade.entryTs + (delayEntry ? delayMs : 0);
    const exitTs = trade.exitTs + (delayExit ? delayMs : 0);
    if (exitTs < entryTs) {
      skippedInfeasibleTrades += 1;
      continue;
    }

    const rows = input.data.bySymbol[trade.symbol] ?? [];
    const index = indexes[trade.symbol] as Map<number, number> | undefined;
    const ei = index?.get(entryTs);
    const xi = index?.get(exitTs);
    if (ei == null || xi == null) throw new Error(`LATENCY_FILL_MISSING:${input.mode}:${trade.symbol}:${entryTs}:${exitTs}`);

    const rawEntry = delayEntry ? rows[ei]?.open : trade.entryPrice;
    const rawExit = delayExit ? rows[xi]?.open : trade.exitPrice;
    if (!(rawEntry > 0) || !(rawExit > 0)) throw new Error(`LATENCY_BAD_PRICE:${input.mode}:${trade.symbol}`);

    const side = trade.side;
    const dir = side === "long" ? 1 : -1;
    const entryPrice = adverseEntry(rawEntry, side, slipRate);
    const exitPrice = adverseExit(rawExit, side, slipRate);
    const effectiveLeverage = Math.min(1, trade.effectiveLeverage);
    const notional = balance * effectiveLeverage;
    const quantity = notional / entryPrice;
    const entryFee = notional * feeRate;
    const fundingRate = fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, exitTs);
    const fundingCost = notional * fundingRate * dir;
    const grossPnl = dir * quantity * (exitPrice - entryPrice);
    const exitFee = quantity * exitPrice * feeRate;
    const netPnl = grossPnl - entryFee - exitFee - fundingCost;
    const before = balance;

    for (let i = ei; i <= xi; i += 1) {
      const row = rows[i];
      if (!row || row.ts > exitTs) break;
      const accruedFunding = notional * fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, row.ts) * dir;
      const unrealized = dir * quantity * (row.close - entryPrice);
      const exitReserve = quantity * row.close * feeRate;
      const equity = Math.max(0, before - entryFee - accruedFunding + unrealized - exitReserve);
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 100);
    }

    balance = Math.max(0, before + netPnl);
    peak = Math.max(peak, balance);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - balance) / peak) * 100 : 100);
    pnls.push(netPnl);
  }

  const years = (input.endTs - input.startTs) / (365.25 * 24 * HOUR);
  return {
    mode: input.mode,
    tradeCount: pnls.length,
    skippedInfeasibleTrades,
    endingEquity: balance,
    returnPct: (balance / STARTING_EQUITY - 1) * 100,
    cagrPct: (Math.pow(balance / STARTING_EQUITY, 1 / years) - 1) * 100,
    maxDrawdownPct,
    profitFactor: pf(pnls),
    profitFactorWithoutBest: pfWithoutBest(pnls),
    winRatePct: pnls.length ? (pnls.filter((x) => x > 0).length / pnls.length) * 100 : 0,
  };
}

export function normalBacktestSummary(result: PerpBacktestResult) {
  return {
    cagrPct: result.metrics.cagrPct,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
    profitFactor: result.metrics.profitFactor,
    tradeCount: result.metrics.tradeCount,
    winRatePct: result.metrics.winRatePct,
    endingEquity: result.risk.endingEquity,
    maximumEffectiveLeverage: result.risk.maximumEffectiveLeverage,
    liquidationCount: result.risk.liquidationCount,
  };
}

export function evaluateLatencyWindow(input: {
  genome: PerpStrategyGenome;
  data: PerpMarketData;
  label: string;
  startTs: number;
  endTs: number;
  execution: PerpExecutionAssumptions;
  stress: LatencyStressConfig;
  targetMonthlyReturnPct: number;
}) {
  const original = runPerpBacktest({
    genome: input.genome,
    data: input.data,
    window: { label: input.label, startTs: input.startTs, endTs: input.endTs },
    execution: input.execution,
    targetMonthlyReturnPct: input.targetMonthlyReturnPct,
  });
  return {
    normal: normalBacktestSummary(original),
    stressedNoDelay: replayWithLatencyStress({ original, data: input.data, startTs: input.startTs, endTs: input.endTs, mode: "none", stress: input.stress }),
    entryDelay: replayWithLatencyStress({ original, data: input.data, startTs: input.startTs, endTs: input.endTs, mode: "entry", stress: input.stress }),
    exitDelay: replayWithLatencyStress({ original, data: input.data, startTs: input.startTs, endTs: input.endTs, mode: "exit", stress: input.stress }),
    bothDelay: replayWithLatencyStress({ original, data: input.data, startTs: input.startTs, endTs: input.endTs, mode: "both", stress: input.stress }),
  };
}
