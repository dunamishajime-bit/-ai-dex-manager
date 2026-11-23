import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { accountLockOwnerPid, accountLockRecoveryDefaultArchive, archiveExpiredAccountOrderLock } from "../lib/disdex-expired-account-lock-recovery";

const ACK = "I_ACK_EXPIRED_ACCOUNT_LOCK_RECOVERY_AFTER_3X_READONLY_RECONCILIATION";
const MISSING_PID_ACK = "I_ACK_EXPIRED_ACCOUNT_LOCK_RECOVERY_AFTER_3X_READONLY_RECONCILIATION_AND_OWNER_PID_ABSENT";
const OWNER_ABSENCE_PROOF = "CONFIRMED_READ_ONLY_OWNER_PROCESS_AND_UNIT_ABSENT";
const execFile = promisify(execFileCallback);

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function ownerAlive(ownerId: string) {
  const pid = accountLockOwnerPid(ownerId);
  if (existsSync(`/proc/${pid}`)) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function ownerFamily(ownerId: string) {
  if (ownerId === "V12_V4_RUNNER") {
    return { unitPrefix: "disdex-v12-v4@", processToken: "scripts/v12-v4-production-runner.ts" };
  }
  if (ownerId === "Q102_PENDING_RECOVERY") {
    return { unitPrefix: "disdex-quality102-causal-v1@", processToken: "scripts/disdex-quality102-causal-v1-live-runner.ts" };
  }
  if (ownerId === "PENGU_PENDING_RECOVERY") {
    return { unitPrefix: "disdex-pengu-dual-ls-v2@", processToken: "scripts/disdex-pengu-dual-ls-v2-live-runner.ts" };
  }
  throw new Error("ACCOUNT_LOCK_MISSING_PID_OWNER_FAMILY_UNSUPPORTED");
}

async function proveOwnerProcessAbsent(ownerId: string) {
  const family = ownerFamily(ownerId);
  const units = String((await execFile("/usr/bin/systemctl", ["list-units", "--all", "--type=service", "--no-legend"], { maxBuffer: 2 * 1024 * 1024 })).stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[0]?.startsWith(family.unitPrefix))
    .filter((fields) => !new Set(["inactive", "failed", "deactivating"]).has(fields[2] || ""));
  const processes = String((await execFile("/bin/ps", ["-eo", "pid=,args="], { maxBuffer: 2 * 1024 * 1024 })).stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.includes(family.processToken));
  if (units.length > 0 || processes.length > 0) throw new Error("ACCOUNT_LOCK_OWNER_STILL_ALIVE");
  return { serviceMatches: units.length, processMatches: processes.length };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const verifyOnly = process.argv.includes("--verify-only");
  if (apply === verifyOnly) throw new Error("EXPIRED_ACCOUNT_LOCK_RECOVERY_REQUIRES_EXACTLY_ONE_MODE");
  const allowMissingOwnerPid = process.argv.includes("--allow-missing-owner-pid");
  if (apply && arg("--ack") !== ACK && arg("--ack") !== MISSING_PID_ACK) throw new Error("EXPIRED_ACCOUNT_LOCK_RECOVERY_ACK_REQUIRED");

  const lockPath = arg("--path") || process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock";
  const expectedOwnerId = arg("--expected-owner-id");
  const archiveDir = arg("--archive-dir") || accountLockRecoveryDefaultArchive(lockPath);
  const requestId = arg("--request-id") || `expired-lock-${process.pid}`;
  if (!expectedOwnerId) throw new Error("EXPIRED_ACCOUNT_LOCK_RECOVERY_EXPECTED_OWNER_REQUIRED");
  let pid: number | null = null;
  let alive = false;
  let absenceProof: { serviceMatches: number; processMatches: number } | undefined;
  if (/:([0-9]+)$/.test(expectedOwnerId)) {
    pid = accountLockOwnerPid(expectedOwnerId);
    alive = ownerAlive(expectedOwnerId);
  } else {
    if (!allowMissingOwnerPid) throw new Error("ACCOUNT_LOCK_OWNER_PID_MISSING");
    if (arg("--owner-process-absent-proof") !== OWNER_ABSENCE_PROOF) throw new Error("ACCOUNT_LOCK_OWNER_ABSENCE_PROOF_REQUIRED");
    if (apply && arg("--ack") !== MISSING_PID_ACK) throw new Error("ACCOUNT_LOCK_MISSING_PID_ACK_REQUIRED");
    absenceProof = await proveOwnerProcessAbsent(expectedOwnerId);
  }
  const inspectionOptions = {
    now: Date.now(),
    expectedOwnerId,
    ownerAlive: alive,
    allowMissingOwnerPid,
    ownerProcessAbsent: absenceProof !== undefined,
  };

  if (verifyOnly) {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    const { inspectExpiredAccountOrderLock } = await import("../lib/disdex-expired-account-lock-recovery");
    console.log(JSON.stringify({ ...inspectExpiredAccountOrderLock(raw, inspectionOptions), ownerPid: pid, ownerAbsenceProof: absenceProof, archiveDir, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    return;
  }

  const result = await archiveExpiredAccountOrderLock({
    lockPath,
    archiveDir,
    expectedOwnerId,
    now: Date.now(),
    ownerAlive: alive,
    allowMissingOwnerPid,
    ownerProcessAbsent: absenceProof !== undefined,
    requestId,
  });
  console.log(JSON.stringify({ ...result, ownerPid: pid, ownerAbsenceProof: absenceProof, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "EXPIRED_ACCOUNT_LOCK_RECOVERY_FAIL_CLOSED",
    message: error instanceof Error ? error.message : String(error),
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  process.exitCode = 1;
});
