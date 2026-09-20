import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { AsterV3Client, type AsterIncomeRow } from "../lib/aster-v3-client";
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
  schema: "top3-fet-q102-shadow-state/v1";
  seededAt: number;
  seedClosedEquityUsd: number;
  closedEquityUsd: number;
  governor: Q102PortfolioDdGovernorState;
  lastIncomeTime: number;
  seenIncomeKeys: string[];
}

const statePath = process.env.TOP3_FET_Q102_SHADOW_STATE_PATH || "/var/lib/disdex/top3-fet-q102-shadow/state.json";
const snapshotPath = process.env.TOP3_FET_Q102_SHADOW_SNAPSHOT_PATH || "/var/lib/disdex/top3-fet-q102-shadow/snapshot.json";
const v12DecisionPath = process.env.V12_DECISION_SNAPSHOT_PATH || "/var/lib/disdex/v12-x1-all/decision-snapshot.json";

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

function incomeKey(row: AsterIncomeRow): string {
  return [
    row.time,
    row.tranId ?? "",
    row.tradeId ?? "",
    row.incomeType,
    row.symbol ?? "",
    row.income,
    row.asset,
  ].join("|");
}

function normalizedIncome(rows: readonly AsterIncomeRow[]) {
  return [...rows]
    .filter((row) => ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(String(row.incomeType)))
    .filter((row) => Number.isFinite(Number(row.time)) && Number.isFinite(Number(row.income)))
    .sort((a, b) => Number(a.time) - Number(b.time) || incomeKey(a).localeCompare(incomeKey(b)));
}

function toFetBars(rows: Awaited<ReturnType<AsterV3Client["getKlines"]>>): FetH1Bar[] {
  return rows.map((row) => ({
    ts: Number(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: finite(row[5]),
  }));
}

async function seedState(client: AsterV3Client, now: number): Promise<ShadowState> {
  const balances = await client.getBalances();
  const usdt = balances.find((row) => String(row.asset).toUpperCase() === "USDT");
  const closedEquityUsd = finite(usdt?.balance ?? usdt?.crossWalletBalance);
  if (!(closedEquityUsd > 0)) throw new Error("TOP3_FET_Q102_SHADOW_USDT_BALANCE_INVALID");
  return {
    schema: "top3-fet-q102-shadow-state/v1",
    seededAt: now,
    seedClosedEquityUsd: closedEquityUsd,
    closedEquityUsd,
    governor: initialQ102PortfolioDdGovernorState(),
    lastIncomeTime: now,
    seenIncomeKeys: [],
  };
}

async function updateGovernor(client: AsterV3Client, state: ShadowState, now: number): Promise<{ state: ShadowState; applied: number; settledIncomeUsd: number }> {
  const startTime = Math.max(state.seededAt, state.lastIncomeTime - 1_000);
  const rows = normalizedIncome(await client.getIncomeHistory({ startTime, endTime: now, limit: 1000 }));
  const seen = new Set(state.seenIncomeKeys);
  let governor = state.governor;
  let closedEquityUsd = state.closedEquityUsd;
  let applied = 0;
  let settledIncomeUsd = 0;
  let lastIncomeTime = state.lastIncomeTime;

  for (const row of rows) {
    const key = incomeKey(row);
    if (seen.has(key) || Number(row.time) < state.seededAt) continue;
    const amount = finite(row.income);
    const before = Math.max(0.01, closedEquityUsd);
    governor = applyClosedEventReturn(governor, amount / before);
    closedEquityUsd = Math.max(0.01, closedEquityUsd + amount);
    settledIncomeUsd += amount;
    applied += 1;
    lastIncomeTime = Math.max(lastIncomeTime, Number(row.time));
    seen.add(key);
  }

  return {
    state: {
      ...state,
      closedEquityUsd,
      governor,
      lastIncomeTime,
      seenIncomeKeys: [...seen].slice(-4_000),
    },
    applied,
    settledIncomeUsd,
  };
}

async function main() {
  if (TOP3_FET_Q102_CANDIDATE.ordersEnabled) throw new Error("SHADOW_CONTRACT_MUST_NOT_ENABLE_ORDERS");
  const now = Date.now();
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: 10_000,
    recvWindowMs: 5_000,
    readOnlyRateLimitMaxRetries: 1,
    userAgent: "DisDex-Top3-FET-Q102-Shadow/1.0",
  });

  let state: ShadowState;
  try {
    state = await loadJson<ShadowState>(statePath);
    if (state.schema !== "top3-fet-q102-shadow-state/v1") throw new Error("SHADOW_STATE_SCHEMA_MISMATCH");
  } catch {
    state = await seedState(client, now);
  }

  const [v12Observation, fetKlines, governorUpdate] = await Promise.all([
    loadJson<V12DecisionObservation>(v12DecisionPath),
    client.getKlines("FETUSDT", "1h", 120),
    updateGovernor(client, state, now),
  ]);

  state = governorUpdate.state;
  const top3 = selectV12Top3ShadowCandidates(v12Observation.candidates || []);
  const fetBars = toFetBars(fetKlines);
  const fet = evaluateFetBrk48Long(fetBars, fetBars.length - 1);
  const currentDdPct = q102PortfolioDrawdownPct(state.governor);

  const q102ByFamily = Object.fromEntries(
    Object.keys(TOP3_FET_Q102_CANDIDATE.q102Governor.baseFamilyGross)
      .map((family) => [family, decideQ102PortfolioDdGross(family, state.governor)]),
  );

  const snapshot = {
    schema: "top3-fet-q102-shadow-snapshot/v1",
    generatedAt: new Date(now).toISOString(),
    mode: "SHADOW",
    tradingMutation: 0,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    contract: TOP3_FET_Q102_CANDIDATE,
    v12: {
      referenceTs: v12Observation.referenceTs,
      regime: v12Observation.regime,
      base: top3.base.map((row) => ({ symbol: row.symbol, side: row.side, rank: row.rank, score: row.score })),
      rank3: top3.rank3 ? {
        symbol: top3.rank3.symbol,
        side: top3.rank3.side,
        rank: top3.rank3.rank,
        score: top3.rank3.score,
        requestedGross: top3.rank3RequestedGross,
      } : null,
      rank3Reason: top3.rank3 ? "TOP3_RANK3_SCORE_070_ELIGIBLE" : top3.blockedReason,
    },
    fet: {
      ...fet,
      maximumGross: TOP3_FET_Q102_CANDIDATE.fet.maximumGross,
    },
    q102Governor: {
      seededAt: new Date(state.seededAt).toISOString(),
      seedClosedEquityUsd: state.seedClosedEquityUsd,
      closedEquityUsd: state.closedEquityUsd,
      twrIndex: state.governor.twrIndex,
      twrPeak: state.governor.twrPeak,
      currentDrawdownPct: currentDdPct,
      closedIncomeEventCount: state.governor.closedEventCount,
      incomeRowsAppliedThisTick: governorUpdate.applied,
      settledIncomeUsdThisTick: governorUpdate.settledIncomeUsd,
      boostArmed: currentDdPct <= TOP3_FET_Q102_CANDIDATE.q102Governor.maximumEntryDrawdownPct,
      byFamily: q102ByFamily,
      accounting: "FORWARD_SETTLED_INCOME_TWR_SHADOW",
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
