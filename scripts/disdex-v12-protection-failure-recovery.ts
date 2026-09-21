import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { FileQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";
import { normalizeLiveStateOwnership } from "../lib/disdex-live-state-ownership";

const SHA = /^[0-9a-f]{40}$/i;
const PROTECTION_FAILURE_PREFIX = "PROTECTION_FAILED_FLATTENED:";
const EXPECTED_KILL_REASON = "V12_BASE_AGGREGATE_GROSS_OVER_CAP";
const ACK = "I_ACK_V12_PROTECTION_FAILURE_RECOVERY_AFTER_READONLY_FLAT";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactSha(value: unknown) {
  const sha = String(value || "").trim().toLowerCase();
  if (!SHA.test(sha)) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_EXACT_SHA_REQUIRED");
  return sha;
}

function activePositions(state: V12X1AllRunnerState) {
  return state.activePositions ?? (state.active ? [state.active] : []);
}

export function assertRecoverableV12ProtectionFailureState(value: unknown, targetSha: string): asserts value is V12X1AllRunnerState {
  const state = value as Partial<V12X1AllRunnerState>;
  if (!["v12-x1-all-runner-state/v1", "v12-x1-all-runner-state/v2"].includes(String(state.schema)) || state.strategyId !== "V12_X1.00_ALL" || state.mode !== "LIVE") {
    throw new Error("V12_PROTECTION_FAILURE_RECOVERY_STATE_SCHEMA");
  }
  if (!state.pending || state.pending.action !== "ENTRY" || !state.pending.idempotencyKey || !state.pending.clientOrderId || !state.pending.symbol) {
    throw new Error("V12_PROTECTION_FAILURE_RECOVERY_PENDING_REQUIRED");
  }
  if (!String(state.manualReview || "").startsWith(PROTECTION_FAILURE_PREFIX) || state.killSwitch?.active !== true || state.killSwitch.reason !== EXPECTED_KILL_REASON) {
    throw new Error("V12_PROTECTION_FAILURE_RECOVERY_REASON_NOT_EXACT");
  }
  if (!SHA.test(String(targetSha || ""))) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_TARGET_SHA_INVALID");
}

export function buildRecoveredV12ProtectionFailureState(state: V12X1AllRunnerState, targetSha: string, updatedAt = Date.now()): V12X1AllRunnerState {
  assertRecoverableV12ProtectionFailureState(state, targetSha);
  return {
    ...state,
    runtimeCommitSha: targetSha,
    active: undefined,
    activePositions: [],
    pending: undefined,
    manualReview: undefined,
    killSwitch: undefined,
    lastCompletedIdempotencyKey: state.pending!.idempotencyKey,
    reconciliationStatus: "PASS",
    updatedAt,
  };
}

function systemdProps(unit: string) {
  const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "-p", "MainPID", "--no-pager"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`V12_PROTECTION_FAILURE_RECOVERY_SYSTEMD_CHECK_FAILED:${unit}`);
  return Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
}

async function archiveState(path: string, bytes: Buffer, sha: string) {
  const directory = resolve(dirname(path), "recovery-archive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha.slice(0, 12)}-protection-failure-v12-state.json`);
  await copyFile(path, target);
  return target;
}

function isInactiveOrder(status: unknown) {
  return new Set(["FILLED", "CANCELED", "CANCELLED", "EXPIRED", "REJECTED"]).has(String(status || "").toUpperCase());
}

async function assertPendingOrderNotActive(client: AsterV3Client, symbol: string, clientOrderId: string) {
  try {
    const order = await client.getOrder(symbol, clientOrderId);
    if (!isInactiveOrder(order.status)) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_PENDING_ORDER_ACTIVE");
  } catch (error) {
    if (error instanceof Error && error.message === "V12_PROTECTION_FAILURE_RECOVERY_PENDING_ORDER_ACTIVE") throw error;
    if (!(error instanceof AsterApiError) || error.code !== -2013) throw error;
  }
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const sample = {
      schema: "v12-x1-all-runner-state/v2" as const,
      strategyId: "V12_X1.00_ALL" as const,
      mode: "LIVE" as const,
      updatedAt: 1,
      activePositions: [],
      pending: { idempotencyKey: "id", action: "ENTRY" as const, clientOrderId: "id", symbol: "DOGEUSDT", side: "LONG" as const, quantity: 1, signalTs: 1, createdAt: 1 },
      manualReview: `${PROTECTION_FAILURE_PREFIX}Order would immediately trigger.`,
      killSwitch: { active: true, reason: EXPECTED_KILL_REASON, trippedAt: 1 },
    };
    assertRecoverableV12ProtectionFailureState(sample, "0123456789abcdef0123456789abcdef01234567");
    const recovered = buildRecoveredV12ProtectionFailureState(sample, "0123456789abcdef0123456789abcdef01234567", 2);
    if (recovered.pending || recovered.manualReview || recovered.killSwitch?.active) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_SELFTEST_FAILED");
    console.log("V12_PROTECTION_FAILURE_RECOVERY_SELFTEST_PASS");
    return;
  }

  const sha = exactSha(arg("--sha"));
  if (arg("--ack") !== ACK) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_ACK_REQUIRED");
  const currentSha = (await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8")).trim().toLowerCase();
  if (currentSha !== sha) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_CURRENT_SHA_MISMATCH");
  const unit = `disdex-v12-x1-all@${sha}.service`;
  const props = systemdProps(unit);
  if (!(props.ActiveState === "inactive" || props.ActiveState === "failed") || props.MainPID !== "0") throw new Error("V12_PROTECTION_FAILURE_RECOVERY_RUNNER_NOT_STOPPED");

  const statePath = resolve(process.env.V12_X1_ALL_STATE_PATH || "/var/lib/disdex/v12-x1-all/runner.json");
  const q102Path = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json");
  const marginPath = resolve(process.env.DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE || "/var/lib/disdex/shared/margin-risk/guard-live.json");
  const lockPath = resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock");
  const v12Store = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
  const before = await v12Store.load();
  assertRecoverableV12ProtectionFailureState(before, sha);
  const q102 = await new FileQuality102CausalV1StateStore(q102Path, "LIVE", sha).load();
  if (q102.runtimeCommitSha.toLowerCase() !== sha || q102.pending || q102.position) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_Q102_NOT_FLAT_CURRENT");
  const risk = await readSharedCryptoDailyRisk(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json");
  if (!risk.ok) throw new Error(`V12_PROTECTION_FAILURE_RECOVERY_RISK_NOT_READY:${risk.reason}`);
  const margin = JSON.parse(await readFile(marginPath, "utf8")) as { stage?: unknown; ordersAllowed?: unknown };
  if (margin.stage !== "HEALTHY" || margin.ordersAllowed !== true) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_MARGIN_NOT_HEALTHY");

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-V12-Protection-Failure-Recovery/${sha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_ASTER_CREDENTIALS_MISSING");
  const lock = new FileAccountOrderLock(lockPath, 120_000);
  const handle = await lock.acquire(`V12_PROTECTION_FAILURE_RECOVERY:${process.pid}`);
  if (!handle) throw new Error("V12_PROTECTION_FAILURE_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
  try {
    const gate = await runAsterReadOnlyRecoveryGate(client, { requiredConsecutiveSuccesses: 3, requestSpacingMs: 750, roundSpacingMs: 5_000, requireFlat: true });
    await assertPendingOrderNotActive(client, before.pending!.symbol, before.pending!.clientOrderId);
    const beforeBytes = await readFile(statePath);
    const backupPath = await archiveState(statePath, beforeBytes, sha);
    const recovered = buildRecoveredV12ProtectionFailureState(before, sha, Date.now());
    await v12Store.save(recovered);
    await normalizeLiveStateOwnership(statePath, { label: "V12_PROTECTION_FAILURE_RECOVERY_STATE" });
    const after = await v12Store.load();
    if (after.pending || after.manualReview || after.killSwitch?.active || activePositions(after).length > 0 || String(after.runtimeCommitSha || "").toLowerCase() !== sha) {
      throw new Error("V12_PROTECTION_FAILURE_RECOVERY_POSTCHECK_FAILED");
    }
    console.log(JSON.stringify({ recoveryStatus: "V12_PROTECTION_FAILURE_RECOVERY_PASS", sha, statePath, backupPath, pendingClientOrderId: before.pending!.clientOrderId, staleLocalActiveCount: activePositions(before).length, exchangeFlat: true, openOrders: 0, ...gate, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
  } finally {
    await handle.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_PROTECTION_FAILURE_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
