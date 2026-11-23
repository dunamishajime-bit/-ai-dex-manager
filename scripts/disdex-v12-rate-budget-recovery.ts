import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { normalizeLiveStateOwnership } from "../lib/disdex-live-state-ownership";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";

const ACK = "I_ACK_V12_RATE_BUDGET_STALE_STATE_RECOVERY_AFTER_READONLY_RECONCILIATION";
const SHA = /^[0-9a-f]{40}$/i;
const RATE_REVIEW = /^ASTER_GLOBAL_RATE_BUDGET_SATURATED:\d+$/;
const BENIGN_KILL = /^EROFS: read-only file system, open '\/var\/lib\/disdex\/fet-brk48-residual\/state\.json\.\d+\.\d+\.tmp'$/;
const V12_SYMBOLS = new Set(V12_X1_ALL.universe.map((symbol) => `${symbol}USDT`));

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactSha(value: unknown) {
  const sha = String(value || "").trim().toLowerCase();
  if (!SHA.test(sha)) throw new Error("V12_RATE_BUDGET_RECOVERY_EXACT_SHA_REQUIRED");
  return sha;
}

function activePositions(state: V12X1AllRunnerState) {
  return state.activePositions ?? (state.active ? [state.active] : []);
}

export function assertRecoverableV12RateBudgetState(value: unknown, targetSha: string): NonNullable<V12X1AllRunnerState["pending"]> {
  const state = value as V12X1AllRunnerState;
  if (!state || !["v12-x1-all-runner-state/v1", "v12-x1-all-runner-state/v2"].includes(String(state.schema))
    || state.strategyId !== "V12_X1.00_ALL" || state.mode !== "LIVE") {
    throw new Error("V12_RATE_BUDGET_RECOVERY_STATE_SCHEMA");
  }
  if (!SHA.test(targetSha)) throw new Error("V12_RATE_BUDGET_RECOVERY_TARGET_SHA_INVALID");
  if (activePositions(state).length > 0) throw new Error("V12_RATE_BUDGET_RECOVERY_LOCAL_POSITION_PRESENT");
  if (!state.pending || state.pending.action !== "ENTRY" || !state.pending.clientOrderId || !state.pending.symbol) {
    throw new Error("V12_RATE_BUDGET_RECOVERY_ENTRY_PENDING_REQUIRED");
  }
  if (!RATE_REVIEW.test(String(state.manualReview || ""))) {
    throw new Error("V12_RATE_BUDGET_RECOVERY_REVIEW_REASON_NOT_EXACT");
  }
  if (state.killSwitch?.active !== true || !BENIGN_KILL.test(String(state.killSwitch.reason || ""))) {
    throw new Error("V12_RATE_BUDGET_RECOVERY_KILL_REASON_NOT_EXACT");
  }
  return state.pending;
}

export function buildRecoveredV12RateBudgetState(
  state: V12X1AllRunnerState,
  targetSha: string,
  updatedAt = Date.now(),
): V12X1AllRunnerState {
  const pending = assertRecoverableV12RateBudgetState(state, targetSha);
  return {
    ...state,
    schema: "v12-x1-all-runner-state/v2",
    runtimeCommitSha: targetSha,
    pending: undefined,
    manualReview: undefined,
    killSwitch: undefined,
    lastCompletedIdempotencyKey: pending.idempotencyKey,
    reconciliationStatus: "PASS",
    updatedAt,
  };
}

function assertStopped(unit: string) {
  const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "-p", "MainPID", "--no-pager"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`V12_RATE_BUDGET_RECOVERY_SYSTEMD_CHECK_FAILED:${unit}`);
  const props = Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
  if (!(props.ActiveState === "inactive" || props.ActiveState === "failed") || props.MainPID !== "0") {
    throw new Error(`V12_RATE_BUDGET_RECOVERY_UNIT_NOT_STOPPED:${unit}:${props.ActiveState || "unknown"}`);
  }
}

async function archiveState(path: string, targetSha: string) {
  const directory = resolve(dirname(path), "recovery-archive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${targetSha.slice(0, 12)}-rate-budget-v12-state.json`);
  await copyFile(path, target);
  return target;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const sample = {
      schema: "v12-x1-all-runner-state/v2" as const,
      strategyId: "V12_X1.00_ALL" as const,
      mode: "LIVE" as const,
      updatedAt: 1,
      activePositions: [],
      pending: { idempotencyKey: "id", action: "ENTRY" as const, clientOrderId: "id", symbol: "LINKUSDT", side: "LONG" as const, quantity: 1, signalTs: 1, createdAt: 1 },
      manualReview: "ASTER_GLOBAL_RATE_BUDGET_SATURATED:7987",
      killSwitch: { active: true, reason: "EROFS: read-only file system, open '/var/lib/disdex/fet-brk48-residual/state.json.1.2.tmp'", trippedAt: 1 },
    };
    const pending = assertRecoverableV12RateBudgetState(sample, "0".repeat(40));
    const recovered = buildRecoveredV12RateBudgetState(sample, "0".repeat(40), 2);
    if (pending.clientOrderId !== "id" || recovered.pending || recovered.manualReview || recovered.killSwitch?.active) {
      throw new Error("V12_RATE_BUDGET_RECOVERY_SELFTEST_FAILED");
    }
    console.log("V12_RATE_BUDGET_RECOVERY_SELFTEST_PASS");
    return;
  }

  const targetSha = exactSha(arg("--sha"));
  if (arg("--ack") !== ACK) throw new Error("V12_RATE_BUDGET_RECOVERY_ACK_REQUIRED");
  const currentSha = (await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8")).trim().toLowerCase();
  if (currentSha !== targetSha) throw new Error("V12_RATE_BUDGET_RECOVERY_CURRENT_SHA_MISMATCH");
  const unit = `disdex-v12-x1-all@${targetSha}.service`;
  assertStopped(unit);

  const statePath = resolve(process.env.V12_X1_ALL_STATE_PATH || "/var/lib/disdex/v12-x1-all/runner.json");
  const stateStore = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
  const before = await stateStore.load();
  const pending = assertRecoverableV12RateBudgetState(before, targetSha);
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-V12-RateBudget-Recovery/${targetSha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("V12_RATE_BUDGET_RECOVERY_ASTER_CREDENTIALS_MISSING");

  const lock = new FileAccountOrderLock(resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock"), 120_000);
  const handle = await lock.acquire(`V12_RATE_BUDGET_RECOVERY:${process.pid}`);
  if (!handle) throw new Error("V12_RATE_BUDGET_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
  try {
    const [positions, openOrders] = await Promise.all([client.getPositions(), client.getOpenOrders()]);
    const nonFlatV12 = positions.filter((row) => V12_SYMBOLS.has(String(row.symbol || "").toUpperCase()) && Math.abs(Number(row.positionAmt) || 0) > 1e-12);
    if (nonFlatV12.length) throw new Error(`V12_RATE_BUDGET_RECOVERY_V12_POSITION_PRESENT:${nonFlatV12.map((row) => row.symbol).join(",")}`);
    const v12Orders = openOrders.filter((row) => V12_SYMBOLS.has(String(row.symbol || "").toUpperCase()) || String(row.clientOrderId || "").startsWith("v12-"));
    if (v12Orders.length) throw new Error(`V12_RATE_BUDGET_RECOVERY_V12_OPEN_ORDER_PRESENT:${v12Orders.map((row) => row.clientOrderId).join(",")}`);
    try {
      await client.getOrder(pending.symbol, pending.clientOrderId);
      throw new Error("V12_RATE_BUDGET_RECOVERY_PENDING_ORDER_EXISTS");
    } catch (error) {
      if (!(error instanceof AsterApiError) || error.code !== -2013) throw error;
    }
    const backupPath = await archiveState(statePath, targetSha);
    await stateStore.save(buildRecoveredV12RateBudgetState(before, targetSha));
    await normalizeLiveStateOwnership(statePath, { label: "V12_RATE_BUDGET_RECOVERY_STATE" });
    const after = await stateStore.load();
    if (after.pending || after.manualReview || after.killSwitch?.active || activePositions(after).length > 0) {
      throw new Error("V12_RATE_BUDGET_RECOVERY_POSTCHECK_FAILED");
    }
    console.log(JSON.stringify({
      status: "V12_RATE_BUDGET_RECOVERY_PASS",
      targetSha,
      statePath,
      backupPath,
      pendingClientOrderId: pending.clientOrderId,
      pendingOrderConfirmedAbsent: true,
      v12Positions: nonFlatV12.length,
      v12OpenOrders: v12Orders.length,
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    }));
  } finally {
    await handle.release();
  }
}

if (process.argv[1]?.endsWith("disdex-v12-rate-budget-recovery.ts")) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "V12_RATE_BUDGET_RECOVERY_FAIL_CLOSED",
      message: error instanceof Error ? error.message : String(error),
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    }));
    process.exitCode = 1;
  });
}
