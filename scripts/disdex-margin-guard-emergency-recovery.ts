import "dotenv/config";

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, chown, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";

const APPLY_ACK = "I_ACK_MARGIN_GUARD_EMERGENCY_RECOVERY_AFTER_STATE_RECONCILE_AND_3X_FLAT";
const DATA_UNAVAILABLE_REASON = "Margin Guard lost authenticated risk data while managed positions were active";
const PRELIQ_REASON_PREFIX = "Margin Guard triggered pre-liquidation managed stop-loss:";

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
function exactSha(value: string) {
  return /^[0-9a-f]{40}$/.test(value);
}
function isMarginGuardKillReason(reason: string) {
  return reason === DATA_UNAVAILABLE_REASON || reason.startsWith(PRELIQ_REASON_PREFIX);
}
function parseLastJson(output: string) {
  for (const line of output.split(/\r?\n/).map((v) => v.trim()).filter(Boolean).reverse()) {
    try { return JSON.parse(line) as Record<string, unknown>; } catch { /* continue */ }
  }
  throw new Error("MARGIN_GUARD_RECOVERY_MARGIN_JSON_MISSING");
}
function assertCompositionStopped(candidateSha: string) {
  const units = [
    "disdex-v12-x1-all",
    "disdex-pengu-dual-ls-v2",
    "disdex-quality102-causal-v1",
    "disdex-v52-aster-only",
    "disdex-shared-crypto-risk",
    "disdex-v12-v52-margin-guard",
  ];
  for (const prefix of units) {
    const unit = `${prefix}@${candidateSha}.service`;
    const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "LoadState", "-p", "ActiveState", "--no-pager"], { encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error(`MARGIN_GUARD_RECOVERY_SYSTEMD_CHECK_FAILED:${unit}`);
    const props = Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
    if (props.LoadState !== "loaded") throw new Error(`MARGIN_GUARD_RECOVERY_UNIT_NOT_LOADED:${unit}`);
    if (!new Set(["inactive", "failed"]).has(props.ActiveState)) {
      throw new Error(`MARGIN_GUARD_RECOVERY_COMPOSITION_NOT_STOPPED:${unit}:${props.ActiveState || "UNKNOWN"}`);
    }
  }
}
async function archive(path: string, bytes: Buffer, requestId: string) {
  const directory = resolve(dirname(path), "recovery-archive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = resolve(directory, `${stamp}-${requestId}-kill-switch.json`);
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  return target;
}
async function atomicWritePreserveOwner(path: string, payload: unknown) {
  const before = await stat(path);
  const originalBytes = await readFile(path);
  const temporary = `${path}.margin-recovery.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      await chown(temporary, before.uid, before.gid);
    }
    await rename(temporary, path);
    await chmod(path, 0o600);
    const after = await stat(path);
    if (after.uid !== before.uid || after.gid !== before.gid) {
      throw new Error(`MARGIN_GUARD_RECOVERY_KILL_OWNER_CHANGED:${before.uid}:${before.gid}->${after.uid}:${after.gid}`);
    }
  } catch (error) {
    await writeFile(path, originalBytes, { mode: 0o600 }).catch(() => undefined);
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      await chown(path, before.uid, before.gid).catch(() => undefined);
    }
    await chmod(path, 0o600).catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function main() {
  if (process.argv.includes("--self-test")) {
    if (!exactSha("a".repeat(40)) || exactSha("abc")) throw new Error("MARGIN_GUARD_RECOVERY_SELFTEST_SHA_FAILED");
    if (!isMarginGuardKillReason(DATA_UNAVAILABLE_REASON)) throw new Error("MARGIN_GUARD_RECOVERY_SELFTEST_DATA_REASON_FAILED");
    if (!isMarginGuardKillReason(PRELIQ_REASON_PREFIX + "stage=CRITICAL")) throw new Error("MARGIN_GUARD_RECOVERY_SELFTEST_PRELIQ_REASON_FAILED");
    if (isMarginGuardKillReason("unrelated")) throw new Error("MARGIN_GUARD_RECOVERY_SELFTEST_ALLOWLIST_FAILED");
    console.log("MARGIN_GUARD_EMERGENCY_RECOVERY_SELFTEST_PASS");
    return;
  }
  const verifyOnly = process.argv.includes("--verify-only");
  const apply = process.argv.includes("--apply");
  if (verifyOnly === apply) throw new Error("MARGIN_GUARD_RECOVERY_REQUIRES_EXACTLY_ONE_MODE");

  const candidateSha = String(argValue("--sha") || "").trim().toLowerCase();
  if (!exactSha(candidateSha)) throw new Error("MARGIN_GUARD_RECOVERY_EXACT_SHA_REQUIRED");
  const configuredSha = String(process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || "").trim().toLowerCase();
  if (configuredSha && configuredSha !== candidateSha) throw new Error("MARGIN_GUARD_RECOVERY_RELEASE_SHA_MISMATCH");
  if (apply && String(argValue("--ack") || "") !== APPLY_ACK) throw new Error("MARGIN_GUARD_RECOVERY_APPLY_ACK_REQUIRED");

  assertCompositionStopped(candidateSha);

  const runtime = resolveV12X1AllRuntime();
  if (runtime.mode !== "LIVE") throw new Error("MARGIN_GUARD_RECOVERY_V12_MODE_NOT_LIVE");
  const kill = await readSharedKillSwitch();
  if (!kill.active || !kill.sourcePath) throw new Error("MARGIN_GUARD_RECOVERY_KILL_SWITCH_NOT_ACTIVE");
  const reason = String(kill.reason || "");
  if (!isMarginGuardKillReason(reason)) throw new Error(`MARGIN_GUARD_RECOVERY_REASON_NOT_ALLOWLISTED:${reason || "UNKNOWN"}`);

  const killBytes = await readFile(kill.sourcePath);
  const rawKill = JSON.parse(killBytes.toString("utf8")) as Record<string, unknown>;
  const activatedAt = String(rawKill.activatedAt || "");
  if (!activatedAt) throw new Error("MARGIN_GUARD_RECOVERY_KILL_ACTIVATION_MISSING");

  const marginRoot = resolve(process.env.DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR || "/var/lib/disdex/shared/margin-risk");
  const evidencePath = resolve(marginRoot, "emergency-flatten-evidence.json");
  let evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
  if (String(evidence.killActivatedAt || "") !== activatedAt || String(evidence.killReason || "") !== reason) {
    throw new Error("MARGIN_GUARD_RECOVERY_EVIDENCE_KILL_IDENTITY_MISMATCH");
  }
  if (evidence.status !== "FLATTEN_COMPLETE_PENDING_STATE_RECONCILIATION" && evidence.status !== "RECONCILED") {
    throw new Error(`MARGIN_GUARD_RECOVERY_EVIDENCE_STATUS_INVALID:${String(evidence.status || "UNKNOWN")}`);
  }
  const fills = Array.isArray(evidence.fillResults) ? evidence.fillResults : [];
  if (!fills.length) throw new Error("MARGIN_GUARD_RECOVERY_FILL_EVIDENCE_MISSING");
  const remaining = Array.isArray(evidence.remainingManagedPositions) ? evidence.remainingManagedPositions : [];
  if (remaining.length) throw new Error("MARGIN_GUARD_RECOVERY_EVIDENCE_REMAINING_POSITIONS");
  let reconciliation = evidence.stateReconciliation as Record<string, unknown> | undefined;
  if (evidence.status === "RECONCILED" && (!reconciliation || reconciliation.status !== "PASS")) {
    throw new Error("MARGIN_GUARD_RECOVERY_STATE_RECONCILIATION_NOT_PASS");
  }

  const risk = await readSharedCryptoDailyRisk(runtime.riskPath);
  if (!risk.ok) throw new Error(`MARGIN_GUARD_RECOVERY_SHARED_RISK_NOT_READY:${risk.reason}`);

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-Margin-Guard-Recovery/${candidateSha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("MARGIN_GUARD_RECOVERY_ASTER_CREDENTIALS_MISSING");

  const lock = new FileAccountOrderLock(runtime.lockPath || "/var/lib/disdex/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
  const requestId = `margin-guard-recovery-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${process.pid}`;
  const handle = await lock.acquire(`MARGIN_GUARD_RECOVERY:${requestId}`);
  if (!handle) throw new Error("MARGIN_GUARD_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
  try {
    const killBefore = await readFile(kill.sourcePath);
    if (!killBefore.equals(killBytes)) throw new Error("MARGIN_GUARD_RECOVERY_KILL_CHANGED_BEFORE_GATE");

    const gate = await runAsterReadOnlyRecoveryGate(client, {
      requiredConsecutiveSuccesses: numberEnv("DISDEX_ASTER_RECOVERY_CONSECUTIVE_SUCCESSES", 3),
      requestSpacingMs: numberEnv("DISDEX_ASTER_RECOVERY_REQUEST_SPACING_MS", 750),
      roundSpacingMs: numberEnv("DISDEX_ASTER_RECOVERY_ROUND_SPACING_MS", 5_000),
      requireFlat: true,
    });

    const marginPythonPath = process.env.DISDEX_MARGIN_GUARD_PYTHONPATH || "/home/deploy/dis-dex-manager/.venv-stock/lib/python3.12/site-packages";
    const margin = spawnSync("/usr/bin/python3", ["scripts/disdex_v96_v52_margin_guard_runtime.py", "--mode", "live", "--preflight-readonly"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${resolve(process.cwd(), "scripts")}:${marginPythonPath}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    if (margin.status !== 0) throw new Error(`MARGIN_GUARD_RECOVERY_PREFLIGHT_FAILED:${String(margin.stderr || margin.stdout || "").slice(-700)}`);
    const marginState = parseLastJson(String(margin.stdout || ""));
    if (marginState.stage !== "HEALTHY" || marginState.ordersAllowed !== true) {
      throw new Error(`MARGIN_GUARD_RECOVERY_MARGIN_NOT_HEALTHY:${String(marginState.stage || "UNKNOWN")}`);
    }

    const afterGateKill = await readFile(kill.sourcePath);
    if (!afterGateKill.equals(killBytes)) throw new Error("MARGIN_GUARD_RECOVERY_KILL_CHANGED_DURING_GATE");

    if (verifyOnly) {
      console.log(JSON.stringify({
        status: "MARGIN_GUARD_EMERGENCY_RECOVERY_VERIFY_PASS",
        candidateSha,
        killSwitchActive: true,
        reason,
        evidenceStatus: evidence.status,
        reconciliationStatus: reconciliation?.status || "PENDING_STATE_RECONCILIATION",
        reconciliationRequired: evidence.status !== "RECONCILED",
        marginStage: marginState.stage,
        sharedRiskReady: true,
        ...gate,
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
      }));
      return;
    }

    if (evidence.status !== "RECONCILED") {
      const stateReconcile = spawnSync(
        "/usr/bin/python3",
        [
          "scripts/disdex_margin_guard_state_reconcile.py",
          "--evidence-path", evidencePath,
          "--apply",
          "--ack", "I_ACK_MARGIN_GUARD_STATE_RECONCILIATION",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PYTHONPATH: `${resolve(process.cwd(), "scripts")}:${marginPythonPath}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
          },
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      if (stateReconcile.status !== 0) {
        throw new Error(`MARGIN_GUARD_RECOVERY_STATE_RECONCILIATION_FAILED:${String(stateReconcile.stderr || stateReconcile.stdout || "").slice(-900)}`);
      }
      const envelope = parseLastJson(String(stateReconcile.stdout || ""));
      reconciliation = envelope.stateReconciliation as Record<string, unknown> | undefined;
      if (!reconciliation || reconciliation.status !== "PASS") {
        throw new Error("MARGIN_GUARD_RECOVERY_STATE_RECONCILIATION_NOT_PASS");
      }
      evidence = {
        ...evidence,
        status: "RECONCILED",
        reconciledAt: new Date().toISOString(),
        lastError: null,
        stateReconciliation: reconciliation,
      };
      await atomicWritePreserveOwner(evidencePath, evidence);
      const evidenceReadback = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
      const readbackReconciliation = evidenceReadback.stateReconciliation as Record<string, unknown> | undefined;
      if (
        evidenceReadback.status !== "RECONCILED"
        || String(evidenceReadback.killActivatedAt || "") !== activatedAt
        || String(evidenceReadback.killReason || "") !== reason
        || !readbackReconciliation
        || readbackReconciliation.status !== "PASS"
      ) {
        throw new Error("MARGIN_GUARD_RECOVERY_EVIDENCE_RECONCILIATION_READBACK_FAILED");
      }
      evidence = evidenceReadback;
      reconciliation = readbackReconciliation;
    }

    if (!reconciliation || reconciliation.status !== "PASS") {
      throw new Error("MARGIN_GUARD_RECOVERY_STATE_RECONCILIATION_NOT_PASS");
    }

    const killArchive = await archive(kill.sourcePath, killBytes, requestId);
    await atomicWritePreserveOwner(kill.sourcePath, {
      active: false,
      action: "FLATTEN_MANAGED",
      strategyId: "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
      reason: "Margin Guard emergency recovery completed after state reconciliation, three authenticated flat-account checks, healthy Margin Guard, and healthy Shared Risk.",
      operator: "MARGIN_GUARD_EMERGENCY_RECOVERY_V2",
      recoveredAt: new Date().toISOString(),
      previousReason: reason,
      candidateSha,
      requestId,
      evidencePath,
    });
    const afterKill = await readSharedKillSwitch();
    if (afterKill.active) throw new Error("MARGIN_GUARD_RECOVERY_KILL_CLEAR_VERIFY_FAILED");
    console.log(JSON.stringify({
      status: "MARGIN_GUARD_EMERGENCY_RECOVERY_APPLY_PASS",
      candidateSha,
      sharedKillSwitchCleared: true,
      killArchive,
      evidencePath,
      reconciliationStatus: reconciliation.status,
      marginStage: marginState.stage,
      ...gate,
      ordersSent: false,
      cancelSent: false,
      positionChangesSent: false,
    }));
  } finally {
    await handle.release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "MARGIN_GUARD_EMERGENCY_RECOVERY_FAIL_CLOSED",
    message: error instanceof Error ? error.message : String(error),
    ordersSent: false,
    cancelSent: false,
    positionChangesSent: false,
  }));
  process.exitCode = 1;
});
