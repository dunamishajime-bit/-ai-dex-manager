import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { AsterV3Client } from "../lib/aster-v3-client";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FileQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";

const SHA = /^[0-9a-f]{40}$/i;
const RECOVERABLE_REASON = "QUALITY102_OWNERSHIP_RUNTIME_SHA_MISMATCH";
const ACK = "I_ACK_V12_RUNTIME_LINEAGE_RECOVERY_AFTER_READONLY_FLAT";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactSha(value: unknown) {
  const sha = String(value || "").trim().toLowerCase();
  if (!SHA.test(sha)) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_EXACT_SHA_REQUIRED");
  return sha;
}

function activePositions(state: V12X1AllRunnerState) {
  return state.activePositions ?? (state.active ? [state.active] : []);
}

export function assertRecoverableV12RuntimeLineageState(value: unknown, targetSha: string): asserts value is V12X1AllRunnerState {
  const state = value as Partial<V12X1AllRunnerState>;
  if (state.schema !== "v12-x1-all-runner-state/v1" || state.strategyId !== "V12_X1.00_ALL" || state.mode !== "LIVE") {
    throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_STATE_SCHEMA");
  }
  if (activePositions(state as V12X1AllRunnerState).length > 0) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_POSITION_PRESENT");
  if (state.pending) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_PENDING_PRESENT");
  if (state.manualReview !== RECOVERABLE_REASON || state.killSwitch?.active !== true || state.killSwitch.reason !== RECOVERABLE_REASON) {
    throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_REASON_NOT_EXACT");
  }
  if (!SHA.test(targetSha)) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_TARGET_SHA_INVALID");
}

export function buildRecoveredV12RuntimeLineageState(state: V12X1AllRunnerState, updatedAt = Date.now()): V12X1AllRunnerState {
  return {
    ...state,
    active: undefined,
    activePositions: [],
    pending: undefined,
    manualReview: undefined,
    killSwitch: undefined,
    updatedAt,
  };
}

function systemdProps(unit: string) {
  const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "-p", "MainPID", "--no-pager"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`V12_RUNTIME_LINEAGE_RECOVERY_SYSTEMD_CHECK_FAILED:${unit}`);
  return Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
}

async function archiveState(path: string, bytes: Buffer, sha: string) {
  const directory = resolve(dirname(path), "recovery-archive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha.slice(0, 12)}-runtime-lineage-v12-state.json`);
  await copyFile(path, target);
  return target;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const sample = {
      schema: "v12-x1-all-runner-state/v1" as const,
      strategyId: "V12_X1.00_ALL" as const,
      mode: "LIVE" as const,
      updatedAt: 1,
      activePositions: [],
      manualReview: RECOVERABLE_REASON,
      killSwitch: { active: true, reason: RECOVERABLE_REASON, trippedAt: 1 },
    };
    assertRecoverableV12RuntimeLineageState(sample, "0123456789abcdef0123456789abcdef01234567");
    const recovered = buildRecoveredV12RuntimeLineageState(sample, 2);
    if (recovered.manualReview || recovered.killSwitch?.active) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_SELFTEST_FAILED");
    console.log("V12_RUNTIME_LINEAGE_RECOVERY_SELFTEST_PASS");
    return;
  }

  const sha = exactSha(arg("--sha"));
  if (arg("--ack") !== ACK) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_ACK_REQUIRED");
  const currentSha = (await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8")).trim().toLowerCase();
  if (currentSha !== sha) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_CURRENT_SHA_MISMATCH");
  const unit = `disdex-v12-x1-all@${sha}.service`;
  const props = systemdProps(unit);
  if (!(props.ActiveState === "inactive" || props.ActiveState === "failed") || props.MainPID !== "0") throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_RUNNER_NOT_STOPPED");

  const statePath = resolve(process.env.V12_X1_ALL_STATE_PATH || "/var/lib/disdex/v12-x1-all/runner.json");
  const q102Path = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json");
  const v12Store = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
  const before = await v12Store.load();
  assertRecoverableV12RuntimeLineageState(before, sha);
  const q102 = await new FileQuality102CausalV1StateStore(q102Path, "LIVE", sha).load();
  if (q102.runtimeCommitSha.toLowerCase() !== sha || q102.pending || q102.position) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_Q102_NOT_FLAT_CURRENT");
  const kill = await readSharedKillSwitch();
  if (kill.active) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_SHARED_KILL_ACTIVE");
  const riskPath = resolve(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json");
  const risk = await readSharedCryptoDailyRisk(riskPath);
  if (!risk.ok) throw new Error(`V12_RUNTIME_LINEAGE_RECOVERY_RISK_NOT_READY:${risk.reason}`);
  const marginPath = resolve(process.env.DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE || "/var/lib/disdex/shared/margin-risk/guard-live.json");
  const margin = JSON.parse(await readFile(marginPath, "utf8")) as { stage?: unknown; ordersAllowed?: unknown };
  if (margin.stage !== "HEALTHY" || margin.ordersAllowed !== true) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_MARGIN_NOT_HEALTHY");

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-V12-Lineage-Recovery/${sha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_ASTER_CREDENTIALS_MISSING");
  const [positions, openOrders] = await Promise.all([client.getPositions(), client.getOpenOrders()]);
  if (!Array.isArray(positions) || positions.some((row) => Math.abs(Number(row.positionAmt) || 0) > 1e-12)) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_EXCHANGE_POSITION_NOT_FLAT");
  if (!Array.isArray(openOrders) || openOrders.length > 0) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_EXCHANGE_ORDERS_PRESENT");

  const beforeBytes = await readFile(statePath);
  const backupPath = await archiveState(statePath, beforeBytes, sha);
  const recovered = buildRecoveredV12RuntimeLineageState(before, Date.now());
  await v12Store.save(recovered);
  const after = await v12Store.load();
  if (after.manualReview || after.killSwitch?.active || after.pending || activePositions(after).length > 0) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_POSTCHECK_FAILED");
  if (after.lastReferenceTs !== before.lastReferenceTs || after.lastCompletedIdempotencyKey !== before.lastCompletedIdempotencyKey) throw new Error("V12_RUNTIME_LINEAGE_RECOVERY_HISTORY_CHANGED");
  console.log(JSON.stringify({ status: "V12_RUNTIME_LINEAGE_RECOVERY_PASS", sha, statePath, backupPath, positions: positions.length, openOrders: openOrders.length, ordersSent: 0, cancelSent: 0, positionChangesSent: 0 }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_RUNTIME_LINEAGE_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
