import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PENGU_DUAL_LS_V2, resolvePenguDualLsV2Runtime } from "@/config/penguDualLsV2Runtime";
import { QUALITY102_CAUSAL_V1, resolveQuality102CausalV1Runtime } from "@/config/disdexQuality102CausalV1Runtime";
import { DISDEX_V13D_V11EQ_V96_ALLOCATION } from "@/config/disdexStockRouterV13DV11EqRuntime";
import { STRICT_BT33404708902 } from "@/config/disdexStrictBt33404708902Runtime";
import { resolveV12X1AllRuntime } from "@/config/v12X1AllRuntime";
import { resolveDisDexV96V52SharedRuntimePaths } from "@/lib/disdex-v96-v52-shared-runtime-paths";

export const DIS_TERMINAL_LIVE_REFRESH_MS = 180_000;

export type LiveDecision = "LONG" | "SHORT" | "WAIT" | "HOLD" | "EXIT" | "UNKNOWN";
export type LiveStateStatus = "AVAILABLE" | "MISSING" | "INVALID";

export interface DisTerminalStrategyStatus {
  id: "V12" | "PENGU" | "V52" | "Q102";
  strategyId: string;
  mode: string;
  enabled: boolean;
  decision: LiveDecision;
  symbol?: string;
  stateStatus: LiveStateStatus;
  stateUpdatedAt?: number;
  pending: boolean;
  positionCount: number;
  grossCap: number;
  selectorMode?: string;
  reason?: string;
}

export interface DisTerminalLiveStatus {
  schema: "disterminal-live-status/v1";
  source: "DAEMON_STATE_READ_ONLY";
  generatedAt: number;
  refreshIntervalMs: number;
  deployedSha?: string;
  strategies: DisTerminalStrategyStatus[];
  risk: {
    killSwitchActive: boolean | null;
    killSwitchReason?: string;
    dailyRiskTripped: boolean | null;
    dailyLossPct?: number;
    accountLockStatus: "CLEAR" | "BUSY" | "STALE_REVIEW" | "UNKNOWN";
    cryptoGrossCap: number;
    totalGrossCap: number;
    penguGrossCap: number;
    stockGrossCap: number;
    q102GrossCap: number;
  };
}

type JsonRead = { state?: Record<string, any>; status: LiveStateStatus };

async function readJson(path: string): Promise<JsonRead> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? { state: value as Record<string, any>, status: "AVAILABLE" }
      : { status: "INVALID" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    return { status: code === "ENOENT" ? "MISSING" : "INVALID" };
  }
}

function sideDecision(value: unknown): LiveDecision {
  if (value === 1 || value === "LONG" || value === "BUY") return "LONG";
  if (value === -1 || value === "SHORT" || value === "SELL") return "SHORT";
  return "WAIT";
}

function stateTime(state?: Record<string, any>) {
  const value = Number(state?.updatedAt ?? state?.lastRunAt ?? state?.lastReconciledAt);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function firstV52Position(state?: Record<string, any>): Record<string, any> | undefined {
  const raw = state?.positions;
  if (Array.isArray(raw)) return raw.find((row) => row && typeof row === "object");
  if (raw && typeof raw === "object") return Object.values(raw).find((row) => row && typeof row === "object") as Record<string, any> | undefined;
  return undefined;
}

function positionCount(state?: Record<string, any>) {
  const raw = state?.positions;
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === "object") return Object.keys(raw).length;
  return 0;
}

function latestFailure(state?: Record<string, any>) {
  const failures = Array.isArray(state?.failures) ? state?.failures : [];
  const last = failures[failures.length - 1];
  return typeof last?.message === "string" ? last.message : undefined;
}

export async function readDisTerminalLiveStatus(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<DisTerminalLiveStatus> {
  const shared = resolveDisDexV96V52SharedRuntimePaths(env);
  const v12Runtime = resolveV12X1AllRuntime(env);
  const penguRuntime = resolvePenguDualLsV2Runtime(env);
  const q102Runtime = resolveQuality102CausalV1Runtime(env);
  const v12Path = resolve(env.DISDEX_HP_V12_STATE_PATH || env.V12_X1_ALL_STATE_PATH || v12Runtime.statePath);
  const penguPath = resolve(env.DISDEX_HP_PENGU_STATE_PATH || resolve(env.PENGU_DUAL_LS_V2_STATE_DIR || shared.penguStateRoot, "runner-live.json"));
  const v52Path = resolve(env.DISDEX_HP_V52_STATE_PATH || resolve(shared.stockStateRoot, "runner-live.json"));
  const q102Path = resolve(env.DISDEX_HP_Q102_STATE_PATH || env.QUALITY102_CAUSAL_V1_STATE_PATH || env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH || resolve(shared.combinedRoot, "quality102-causal-v1", "state.json"));
  const killPath = resolve(env.DISDEX_HP_KILL_SWITCH_PATH || shared.killSwitchPath);
  const riskPath = resolve(env.DISDEX_HP_DAILY_RISK_PATH || env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || resolve(shared.combinedRoot, "shared", "crypto-daily-risk.json"));
  const lockPath = resolve(env.DISDEX_HP_ACCOUNT_LOCK_PATH || shared.accountLockPath);

  const [v12, pengu, v52, q102, kill, risk, lock] = await Promise.all([
    readJson(v12Path), readJson(penguPath), readJson(v52Path), readJson(q102Path),
    readJson(killPath), readJson(riskPath), readJson(lockPath),
  ]);

  const v12Active = v12.state?.active;
  const v12Pending = v12.state?.pending;
  const penguPosition = pengu.state?.position;
  const penguPending = pengu.state?.pending;
  const q102Position = q102.state?.position;
  const q102Pending = q102.state?.pending;
  const v52Position = firstV52Position(v52.state);
  const v52Pending = v52.state?.pendingOrder;

  const strategies: DisTerminalStrategyStatus[] = [
    {
      id: "V12", strategyId: "V12_X1.00_ALL", mode: String(v12.state?.mode || v12Runtime.mode),
      enabled: v12Runtime.enabled, stateStatus: v12.status, stateUpdatedAt: stateTime(v12.state),
      decision: v12Pending?.action === "EXIT" || v12Pending?.action === "FAILSAFE_CLOSE" ? "EXIT" : sideDecision(v12Active?.side ?? v12Pending?.side),
      symbol: String(v12Active?.symbol || v12Pending?.symbol || "") || undefined,
      pending: Boolean(v12Pending), positionCount: v12Active ? 1 : 0, grossCap: 1,
      reason: v12.state?.manualReview || v12Pending?.reason,
    },
    {
      id: "PENGU", strategyId: PENGU_DUAL_LS_V2.id, mode: String(pengu.state?.mode || penguRuntime.mode),
      enabled: penguRuntime.enabled, stateStatus: pengu.status, stateUpdatedAt: stateTime(pengu.state),
      decision: penguPending?.reduceOnly ? "EXIT" : sideDecision(penguPosition?.side ?? penguPending?.side ?? pengu.state?.latestSignal?.side),
      symbol: PENGU_DUAL_LS_V2.symbol, pending: Boolean(penguPending), positionCount: penguPosition ? 1 : 0,
      grossCap: penguRuntime.maximumGross,
      reason: penguPending?.reason || pengu.state?.latestSignal?.reason || latestFailure(pengu.state),
    },
    {
      id: "V52", strategyId: "V52", mode: String(env.DISDEX_V52_ASTER_ONLY_RUNNER_MODE || env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE || "UNKNOWN").toUpperCase(),
      enabled: /^(1|true|yes|on)$/i.test(String(env.DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED || "")),
      stateStatus: v52.status, stateUpdatedAt: stateTime(v52.state),
      decision: v52Pending ? "WAIT" : v52Position ? sideDecision(v52Position.side ?? v52Position.positionSide) : "WAIT",
      symbol: String(v52Position?.symbol || v52Pending?.symbol || "") || undefined,
      pending: Boolean(v52Pending), positionCount: positionCount(v52.state), grossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap,
      reason: v52.state?.manualReviewReason || v52Pending?.reason,
    },
    {
      id: "Q102", strategyId: QUALITY102_CAUSAL_V1.strategyId, mode: String(q102.state?.mode || q102Runtime.mode),
      enabled: q102Runtime.enabled, stateStatus: q102.status, stateUpdatedAt: stateTime(q102.state),
      decision: q102Pending?.reduceOnly ? "EXIT" : sideDecision(q102Position?.side ?? q102Pending?.side),
      symbol: String(q102Position?.symbol || q102Pending?.symbol || "") || undefined,
      pending: Boolean(q102Pending), positionCount: q102Position ? 1 : 0, grossCap: q102Runtime.maximumGross,
      selectorMode: String(env.QUALITY102_CAUSAL_V1_SELECTOR_MODE || "UNKNOWN").toUpperCase(),
      reason: q102Pending?.reason || latestFailure(q102.state),
    },
  ];

  const lockStatus = lock.status === "MISSING"
    ? "CLEAR"
    : lock.status !== "AVAILABLE"
      ? "UNKNOWN"
      : Number(lock.state?.expiresAt) > now ? "BUSY" : "STALE_REVIEW";
  const killSwitchActive = kill.status === "MISSING"
    ? false
    : kill.status === "AVAILABLE" && typeof kill.state?.active === "boolean" ? kill.state.active : null;

  return {
    schema: "disterminal-live-status/v1",
    source: "DAEMON_STATE_READ_ONLY",
    generatedAt: now,
    refreshIntervalMs: DIS_TERMINAL_LIVE_REFRESH_MS,
    deployedSha: String(env.DISDEX_RELEASE_SHA || env.DISDEX_RUNTIME_COMMIT_SHA || env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim() || undefined,
    strategies,
    risk: {
      killSwitchActive,
      killSwitchReason: typeof kill.state?.reason === "string" ? kill.state.reason : undefined,
      dailyRiskTripped: risk.status === "AVAILABLE" && typeof risk.state?.tripped === "boolean" ? risk.state.tripped : null,
      dailyLossPct: Number.isFinite(Number(risk.state?.lossPct)) ? Number(risk.state?.lossPct) : undefined,
      accountLockStatus: lockStatus,
      cryptoGrossCap: STRICT_BT33404708902.cryptoGrossCap,
      totalGrossCap: STRICT_BT33404708902.totalGrossCap,
      penguGrossCap: PENGU_DUAL_LS_V2.maximumGross,
      stockGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap,
      q102GrossCap: QUALITY102_CAUSAL_V1.maximumGross,
    },
  };
}
