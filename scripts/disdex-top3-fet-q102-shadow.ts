import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { selectV12Top3ShadowCandidates } from "../lib/v12-top3-candidate-policy";
import { evaluateFetBrk48Long, type FetH1Bar } from "../lib/fet-brk48-long";
import {
  applyClosedEventReturn,
  decideQ102PortfolioDdGross,
  initialQ102PortfolioDdGovernorState,
  q102PortfolioDrawdownPct,
  type Q102PortfolioDdGovernorState,
} from "../lib/q102-portfolio-dd-governor";
import { TOP3_FET_Q102_CANDIDATE } from "../config/top3FetQ102Candidate";
import type { V12DecisionObservation } from "../lib/v12-x1-all";

interface ShadowState {
  schema: "top3-fet-q102-shadow-state/v2";
  seededAt: number;
  seedClosedEquityUsd: number;
  closedEquityUsd: number;
  governor: Q102PortfolioDdGovernorState;
  seenTradeKeys: string[];
  fundingDay: string;
  fundingTotalUsd: number;
}

interface TradeHistoryEntry {
  id?: string;
  orderId?: string;
  symbol?: string;
  realizedPnl?: number;
  commission?: number;
  commissionAsset?: string;
  time?: number;
}

interface TradeHistorySnapshot {
  generatedAt?: string;
  entries?: TradeHistoryEntry[];
}

interface SharedRiskSnapshot {
  utcDay: string;
  updatedAt: number;
  realizedPnl: number;
  fees: number;
  funding: number;
  referenceEquity: number;
}

interface Q102MarketHistory {
  savedAt: number;
  candlesBySymbol: Record<string, Array<{
    timestampMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    baseVolume: number;
  }>>;
}

const statePath = process.env.TOP3_FET_Q102_SHADOW_STATE_PATH || "/var/lib/disdex/top3-fet-q102-shadow/state.json";
const snapshotPath = process.env.TOP3_FET_Q102_SHADOW_SNAPSHOT_PATH || "/var/lib/disdex/top3-fet-q102-shadow/snapshot.json";
const v12DecisionPath = process.env.V12_DECISION_SNAPSHOT_PATH || "/var/lib/disdex/v12-x1-all/decision-snapshot.json";
const q102HistoryPath = process.env.Q102_MARKET_HISTORY_PATH || "/var/lib/disdex/quality102-causal-v1/market-history.json";
const tradeHistoryPath = process.env.DISDEX_GIT_HISTORY_SNAPSHOT_PATH || "/home/deploy/ai-dex-manager/data/trade-history-git.json";
const sharedRiskPath = process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json";

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function tradeKey(row: TradeHistoryEntry): string {
  return [
    row.time ?? 0,
    row.id ?? "",
    row.orderId ?? "",
    row.symbol ?? "",
    row.realizedPnl ?? 0,
    row.commission ?? 0,
  ].join("|");
}

function seedState(now: number, risk: SharedRiskSnapshot): ShadowState {
  const seedClosedEquityUsd = finite(risk.referenceEquity)
    + finite(risk.realizedPnl)
    + finite(risk.fees)
    + finite(risk.funding);
  if (!(seedClosedEquityUsd > 0)) throw new Error("TOP3_FET_Q102_SHADOW_SEED_EQUITY_INVALID");
  return {
    schema: "top3-fet-q102-shadow-state/v2",
    seededAt: now,
    seedClosedEquityUsd,
    closedEquityUsd: seedClosedEquityUsd,
    governor: initialQ102PortfolioDdGovernorState(),
    seenTradeKeys: [],
    fundingDay: String(risk.utcDay || ""),
    fundingTotalUsd: finite(risk.funding),
  };
}

function applySettlement(
  state: ShadowState,
  amountUsd: number,
): ShadowState {
  if (!Number.isFinite(amountUsd) || Math.abs(amountUsd) <= 1e-15) return state;
  const before = Math.max(0.01, state.closedEquityUsd);
  return {
    ...state,
    closedEquityUsd: Math.max(0.01, state.closedEquityUsd + amountUsd),
    governor: applyClosedEventReturn(state.governor, amountUsd / before),
  };
}

function updateGovernor(
  state: ShadowState,
  history: TradeHistorySnapshot,
  risk: SharedRiskSnapshot,
): { state: ShadowState; tradeRowsApplied: number; settlementUsd: number; fundingDeltaUsd: number } {
  const seen = new Set(state.seenTradeKeys);
  let next = state;
  let tradeRowsApplied = 0;
  let settlementUsd = 0;

  const rows = [...(history.entries || [])]
    .filter((row) => finite(row.time) >= state.seededAt)
    .sort((a, b) => finite(a.time) - finite(b.time) || tradeKey(a).localeCompare(tradeKey(b)));

  for (const row of rows) {
    const key = tradeKey(row);
    if (seen.has(key)) continue;
    const commission = String(row.commissionAsset || "USDT").toUpperCase() === "USDT" ? Math.abs(finite(row.commission)) : 0;
    const amount = finite(row.realizedPnl) - commission;
    next = applySettlement(next, amount);
    settlementUsd += amount;
    tradeRowsApplied += 1;
    seen.add(key);
  }

  let fundingDeltaUsd = 0;
  const currentDay = String(risk.utcDay || "");
  const currentFunding = finite(risk.funding);
  if (currentDay === state.fundingDay) {
    fundingDeltaUsd = currentFunding - state.fundingTotalUsd;
  } else {
    fundingDeltaUsd = currentFunding;
  }
  next = applySettlement(next, fundingDeltaUsd);

  return {
    state: {
      ...next,
      seenTradeKeys: [...seen].slice(-4_000),
      fundingDay: currentDay,
      fundingTotalUsd: currentFunding,
    },
    tradeRowsApplied,
    settlementUsd,
    fundingDeltaUsd,
  };
}

function fetBarsFromHistory(history: Q102MarketHistory, now: number): FetH1Bar[] {
  const rows = (history.candlesBySymbol?.FETUSDT || []).map((row) => ({
    ts: finite(row.timestampMs),
    open: finite(row.open),
    high: finite(row.high),
    low: finite(row.low),
    close: finite(row.close),
    volume: finite(row.baseVolume),
  })).filter((row) => row.ts > 0).sort((a, b) => a.ts - b.ts);

  const currentHour = Math.floor(now / 3_600_000) * 3_600_000;
  const completed = rows.filter((row) => row.ts < currentHour);
  if (!completed.length) return rows;
  const last = completed[completed.length - 1];
  if (last.ts === currentHour) return completed;
  return [...completed, {
    ts: currentHour,
    open: last.close,
    high: last.close,
    low: last.close,
    close: last.close,
    volume: 0,
  }];
}

async function main() {
  if (TOP3_FET_Q102_CANDIDATE.ordersEnabled) throw new Error("SHADOW_CONTRACT_MUST_NOT_ENABLE_ORDERS");
  const now = Date.now();
  const [v12Observation, q102History, tradeHistory, sharedRisk] = await Promise.all([
    loadJson<V12DecisionObservation>(v12DecisionPath),
    loadJson<Q102MarketHistory>(q102HistoryPath),
    loadJson<TradeHistorySnapshot>(tradeHistoryPath),
    loadJson<SharedRiskSnapshot>(sharedRiskPath),
  ]);

  let state: ShadowState;
  let seededThisTick = false;
  try {
    state = await loadJson<ShadowState>(statePath);
    if (state.schema !== "top3-fet-q102-shadow-state/v2") throw new Error("SHADOW_STATE_SCHEMA_MISMATCH");
  } catch {
    state = seedState(now, sharedRisk);
    seededThisTick = true;
  }

  const governorUpdate = seededThisTick
    ? { state, tradeRowsApplied: 0, settlementUsd: 0, fundingDeltaUsd: 0 }
    : updateGovernor(state, tradeHistory, sharedRisk);
  state = governorUpdate.state;

  const top3 = selectV12Top3ShadowCandidates(v12Observation.candidates || []);
  const fetBars = fetBarsFromHistory(q102History, now);
  const rawFet = evaluateFetBrk48Long(fetBars, fetBars.length - 1);
  const marketHistoryAgeMs = Math.max(0, now - finite(q102History.savedAt));
  const fet = marketHistoryAgeMs > 2 * 3_600_000
    ? { ...rawFet, eligible: false, reason: "Q102_MARKET_HISTORY_STALE" }
    : rawFet;
  const currentDdPct = q102PortfolioDrawdownPct(state.governor);

  const q102ByFamily = Object.fromEntries(
    Object.keys(TOP3_FET_Q102_CANDIDATE.q102Governor.baseFamilyGross)
      .map((family) => [family, decideQ102PortfolioDdGross(family, state.governor)]),
  );

  const snapshot = {
    schema: "top3-fet-q102-shadow-snapshot/v2",
    generatedAt: new Date(now).toISOString(),
    mode: "SHADOW",
    tradingMutation: 0,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    dataSources: {
      v12DecisionPath,
      q102HistoryPath,
      tradeHistoryPath,
      sharedRiskPath,
      networkRequests: 0,
    },
    contract: TOP3_FET_Q102_CANDIDATE,
    v12: {
      referenceTs: v12Observation.referenceTs,
      regime: v12Observation.regime,
      base: top3.base.map((row) => ({ symbol: row.symbol, side: row.side, rawRank: row.rank, score: row.score })),
      rank3: top3.rank3 ? {
        symbol: top3.rank3.symbol,
        side: top3.rank3.side,
        rawRank: top3.rank3.rank,
        eligibleRank: 3,
        score: top3.rank3.score,
        requestedGross: top3.rank3RequestedGross,
      } : null,
      rank3Reason: top3.rank3 ? "TOP3_RANK3_SCORE_070_ELIGIBLE" : top3.blockedReason,
    },
    fet: {
      ...fet,
      maximumGross: TOP3_FET_Q102_CANDIDATE.fet.maximumGross,
      marketHistorySavedAt: new Date(finite(q102History.savedAt)).toISOString(),
      marketHistoryAgeMs,
    },
    q102Governor: {
      seededThisTick,
      seededAt: new Date(state.seededAt).toISOString(),
      seedClosedEquityUsd: state.seedClosedEquityUsd,
      closedEquityUsd: state.closedEquityUsd,
      twrIndex: state.governor.twrIndex,
      twrPeak: state.governor.twrPeak,
      currentDrawdownPct: currentDdPct,
      closedSettlementEventCount: state.governor.closedEventCount,
      tradeRowsAppliedThisTick: governorUpdate.tradeRowsApplied,
      tradeSettlementUsdThisTick: governorUpdate.settlementUsd,
      fundingDeltaUsdThisTick: governorUpdate.fundingDeltaUsd,
      boostArmed: currentDdPct <= TOP3_FET_Q102_CANDIDATE.q102Governor.maximumEntryDrawdownPct,
      byFamily: q102ByFamily,
      accounting: "FORWARD_SETTLED_TRADE_PLUS_FUNDING_TWR_SHADOW",
      historicalBtAccounting: "POSITION_LEVEL_CLOSED_EVENT_TWR",
      parityNote: "Forward shadow uses settled trade rows plus funding deltas; no real-order mutation.",
    },
  };

  await atomicJson(statePath, state);
  await atomicJson(snapshotPath, snapshot);
  console.log(JSON.stringify(snapshot));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "TOP3_FET_Q102_SHADOW_FAILED",
    error: error instanceof Error ? error.message : String(error),
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    tradingMutation: 0,
  }));
  process.exitCode = 1;
});
