import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { AsterIncomeRow } from "@/lib/aster-v3-client";

export const PORTFOLIO_DD_GOVERNOR_SCHEMA = "disdex-portfolio-dd-governor/v1" as const;
export const PORTFOLIO_DD_GOVERNOR_ENTRY_THRESHOLD_PCT = 0.30;
export const PORTFOLIO_DD_GOVERNOR_MAX_Q102_GROSS = 3.0;
export const PORTFOLIO_DD_GOVERNOR_MAX_AGE_MS = 120_000;

export interface PortfolioDdGovernorState {
  schema: typeof PORTFOLIO_DD_GOVERNOR_SCHEMA;
  initializedAt: number;
  updatedAt: number;
  baselineMode: "DEPLOYMENT_RESET";
  virtualEquityUsd: number;
  twrIndex: number;
  twrPeak: number;
  currentDrawdownPct: number;
  maximumDrawdownPct: number;
  lastProcessedTime: number;
  recentEventKeys: string[];
  pendingCostsBySymbol: Record<string, number>;
  closedEvents: number;
}

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function key(row: AsterIncomeRow) {
  return [row.time, row.tranId ?? "", row.tradeId ?? "", row.symbol ?? "", row.incomeType, row.income].join("|");
}
export function initialPortfolioDdGovernor(now: number, equityUsd: number, rows: AsterIncomeRow[] = []): PortfolioDdGovernorState {
  if (!(now > 0) || !(equityUsd > 0)) throw new Error("PORTFOLIO_DD_GOVERNOR_INITIALIZATION_INVALID");
  const last = rows.reduce((m, r) => Math.max(m, finite(r.time)), now);
  return {
    schema: PORTFOLIO_DD_GOVERNOR_SCHEMA,
    initializedAt: now,
    updatedAt: now,
    baselineMode: "DEPLOYMENT_RESET",
    virtualEquityUsd: equityUsd,
    twrIndex: 1,
    twrPeak: 1,
    currentDrawdownPct: 0,
    maximumDrawdownPct: 0,
    lastProcessedTime: last,
    recentEventKeys: rows.slice(-256).map(key),
    pendingCostsBySymbol: {},
    closedEvents: 0,
  };
}

export function updatePortfolioDdGovernor(
  prior: PortfolioDdGovernorState,
  rows: AsterIncomeRow[],
  now: number,
): PortfolioDdGovernorState {
  if (prior.schema !== PORTFOLIO_DD_GOVERNOR_SCHEMA || !(prior.virtualEquityUsd > 0) || !(prior.twrIndex > 0) || !(prior.twrPeak > 0)) {
    throw new Error("PORTFOLIO_DD_GOVERNOR_STATE_INVALID");
  }
  const seen = new Set(prior.recentEventKeys || []);
  const fresh = rows
    .filter((r) => finite(r.time) >= Math.max(prior.initializedAt, prior.lastProcessedTime - 60_000))
    .filter((r) => !seen.has(key(r)))
    .sort((a,b) => finite(a.time)-finite(b.time) || String(a.symbol||"").localeCompare(String(b.symbol||"")) || String(a.incomeType).localeCompare(String(b.incomeType)));
  let virtualEquityUsd = prior.virtualEquityUsd;
  let twrIndex = prior.twrIndex;
  let twrPeak = prior.twrPeak;
  let maximumDrawdownPct = prior.maximumDrawdownPct;
  let closedEvents = prior.closedEvents;
  const pendingCostsBySymbol = { ...(prior.pendingCostsBySymbol || {}) };
  const groups = new Map<string, AsterIncomeRow[]>();
  for (const row of fresh) {
    const symbol = String(row.symbol || "ACCOUNT").toUpperCase();
    const groupKey = `${finite(row.time)}|${symbol}`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), row]);
  }
  for (const [groupKey, group] of [...groups.entries()].sort((a,b)=>Number(a[0].split("|")[0])-Number(b[0].split("|")[0]))) {
    const symbol = groupKey.split("|")[1];
    let costs = 0;
    let realized = 0;
    let hasRealized = false;
    for (const row of group) {
      const amount = finite(row.income);
      if (row.incomeType === "COMMISSION" || row.incomeType === "FUNDING_FEE") costs += amount;
      if (row.incomeType === "REALIZED_PNL") { realized += amount; hasRealized = true; }
    }
    if (!hasRealized) {
      pendingCostsBySymbol[symbol] = finite(pendingCostsBySymbol[symbol]) + costs;
      continue;
    }
    const eventPnl = realized + costs + finite(pendingCostsBySymbol[symbol]);
    pendingCostsBySymbol[symbol] = 0;
    const before = Math.max(0.001, virtualEquityUsd);
    const eventReturn = eventPnl / before;
    virtualEquityUsd = Math.max(0.001, virtualEquityUsd + eventPnl);
    twrIndex *= Math.max(0.000001, 1 + eventReturn);
    twrPeak = Math.max(twrPeak, twrIndex);
    const dd = Math.max(0, (1 - twrIndex / Math.max(1e-12, twrPeak)) * 100);
    maximumDrawdownPct = Math.max(maximumDrawdownPct, dd);
    closedEvents += 1;
  }
  const freshKeys = fresh.map(key);
  const recentEventKeys = [...prior.recentEventKeys, ...freshKeys].slice(-512);
  const lastProcessedTime = fresh.reduce((m,r)=>Math.max(m,finite(r.time)), prior.lastProcessedTime);
  const currentDrawdownPct = Math.max(0, (1 - twrIndex / Math.max(1e-12, twrPeak)) * 100);
  return { ...prior, updatedAt: now, virtualEquityUsd, twrIndex, twrPeak, currentDrawdownPct, maximumDrawdownPct, lastProcessedTime, recentEventKeys, pendingCostsBySymbol, closedEvents };
}

async function atomicJson(path: string, value: unknown) {
  const target=resolve(path); await mkdir(dirname(target),{recursive:true});
  const tmp=`${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp,`${JSON.stringify(value,null,2)}\n`,{encoding:"utf8",mode:0o600});
  await rename(tmp,target);
}
export async function readPortfolioDdGovernor(path: string): Promise<PortfolioDdGovernorState | undefined> {
  try { return JSON.parse(await readFile(resolve(path),"utf8")) as PortfolioDdGovernorState; }
  catch (e) { if (e && typeof e === "object" && "code" in e && String((e as any).code)==="ENOENT") return undefined; throw e; }
}
export async function refreshPortfolioDdGovernor(input: { path: string; now: number; walletBalanceUsd: number; income: AsterIncomeRow[] }) {
  const prior=await readPortfolioDdGovernor(input.path);
  const next=prior ? updatePortfolioDdGovernor(prior,input.income,input.now) : initialPortfolioDdGovernor(input.now,input.walletBalanceUsd,input.income);
  await atomicJson(input.path,next); return next;
}
export async function governorIncomeStartTime(path: string, now: number, utcStartMs: number) {
  const state=await readPortfolioDdGovernor(path).catch(()=>undefined);
  return state ? Math.max(utcStartMs, state.lastProcessedTime - 60_000) : utcStartMs;
}
export function quality102GovernorGross(baseGross: number, state: PortfolioDdGovernorState | undefined, now: number): { gross: number; boosted: boolean; reason: string } {
  const base=Math.max(0,finite(baseGross));
  if (!state || state.schema !== PORTFOLIO_DD_GOVERNOR_SCHEMA) return {gross:base,boosted:false,reason:"GOVERNOR_UNAVAILABLE"};
  if (now-state.updatedAt > PORTFOLIO_DD_GOVERNOR_MAX_AGE_MS || state.updatedAt > now+5_000) return {gross:base,boosted:false,reason:"GOVERNOR_STALE"};
  if (state.currentDrawdownPct <= PORTFOLIO_DD_GOVERNOR_ENTRY_THRESHOLD_PCT + 1e-12) return {gross:Math.max(base,PORTFOLIO_DD_GOVERNOR_MAX_Q102_GROSS),boosted:true,reason:"DD_WITHIN_0P30"};
  return {gross:base,boosted:false,reason:"DD_OVER_0P30"};
}
