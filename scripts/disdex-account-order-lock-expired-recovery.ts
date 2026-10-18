import { existsSync } from "node:fs";
import { accountLockOwnerPid, accountLockRecoveryDefaultArchive, archiveExpiredAccountOrderLock } from "../lib/disdex-expired-account-lock-recovery";

const ACK = "I_ACK_EXPIRED_ACCOUNT_LOCK_RECOVERY_AFTER_3X_READONLY_RECONCILIATION";

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

async function main() {
  const apply = process.argv.includes("--apply");
  const verifyOnly = process.argv.includes("--verify-only");
  if (apply === verifyOnly) throw new Error("EXPIRED_ACCOUNT_LOCK_RECOVERY_REQUIRES_EXACTLY_ONE_MODE");
  if (apply && arg("--ack") !== ACK) throw new Error("EXPIRED_ACCOUNT_LOCK_RECOVERY_ACK_REQUIRED");

  const lockPath = arg("--path") || process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock";
  const expectedOwnerId = arg("--expected-owner-id");
  const archiveDir = arg("--archive-dir") || accountLockRecoveryDefaultArchive(lockPath);
  const requestId = arg("--request-id") || `expired-lock-${process.pid}`;
  if (!expectedOwnerId) throw new Error("EXPIRED_ACCOUNT_LOCK_RECOVERY_EXPECTED_OWNER_REQUIRED");
  const pid = accountLockOwnerPid(expectedOwnerId);
  const alive = ownerAlive(expectedOwnerId);

  if (verifyOnly) {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    const { inspectExpiredAccountOrderLock } = await import("../lib/disdex-expired-account-lock-recovery");
    console.log(JSON.stringify({ ...inspectExpiredAccountOrderLock(raw, { now: Date.now(), expectedOwnerId, ownerAlive: alive }), ownerPid: pid, archiveDir, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    return;
  }

  const result = await archiveExpiredAccountOrderLock({
    lockPath,
    archiveDir,
    expectedOwnerId,
    now: Date.now(),
    ownerAlive: alive,
    requestId,
  });
  console.log(JSON.stringify({ ...result, ownerPid: pid, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
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
