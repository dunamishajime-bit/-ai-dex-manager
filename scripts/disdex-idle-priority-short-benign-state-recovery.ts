import { chmod, chown, copyFile, lstat, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeIdleState } from "../lib/idle-priority-short-state";

const SHA = /^[0-9a-f]{40}$/i;
export const BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES =
  "IDLE_RUNNER_FAIL_CLOSED:EACCES: permission denied, open '/var/lib/disdex/shared/operator-activation/current.json'";
export const BENIGN_IDLE_RATE_BUDGET_REVIEW = /^IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:\d+$/;

function exactSha(value: unknown, field: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`IDLE_BENIGN_STATE_RECOVERY_${field}_INVALID`);
  return normalized;
}

function assertFlatState(raw: unknown, expectedSha?: string) {
  if (!raw || typeof raw !== "object") throw new Error("IDLE_BENIGN_STATE_RECOVERY_STATE_INVALID");
  const x = raw as Record<string, unknown>;
  if (x.schema !== "disdex-idle-priority-state/v2") throw new Error("IDLE_BENIGN_STATE_RECOVERY_SCHEMA");
  const stateSha = exactSha(x.runtimeSha, "STATE_SHA");
  if (expectedSha && stateSha !== expectedSha) throw new Error("IDLE_BENIGN_STATE_RECOVERY_SHA_MISMATCH");
  const normalized = normalizeIdleState(raw, stateSha);
  if (normalized.positions.length > 0) throw new Error("IDLE_BENIGN_STATE_RECOVERY_POSITIONS_PRESENT");
  if (normalized.pending) throw new Error("IDLE_BENIGN_STATE_RECOVERY_PENDING_PRESENT");
  return { x, stateSha };
}

export async function recoverIdlePriorityShortBenignState(input: {
  statePath: string;
  expectedSha?: string;
  backupPath?: string;
}) {
  const expectedSha = input.expectedSha ? exactSha(input.expectedSha, "EXPECTED_SHA") : undefined;
  const statePath = resolve(input.statePath);
  let metadata;
  try {
    metadata = await lstat(statePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { status: "IDLE_BENIGN_STATE_RECOVERY_SKIPPED_MISSING" as const, statePath, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error("IDLE_BENIGN_STATE_RECOVERY_SYMLINK_FORBIDDEN");
  if (!metadata.isFile()) throw new Error("IDLE_BENIGN_STATE_RECOVERY_NOT_REGULAR_FILE");

  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8"));
  const checked = assertFlatState(before, expectedSha);
  if (!checked.x.manualReview) {
    return { status: "IDLE_BENIGN_STATE_RECOVERY_NOOP" as const, statePath, runtimeSha: checked.stateSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
  }
  const review = String(checked.x.manualReview);
  const recoveryReason = checked.x.manualReview === BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES
    ? "IDLE_BENIGN_OPERATOR_ACTIVATION_RECOVERY"
    : BENIGN_IDLE_RATE_BUDGET_REVIEW.test(review)
      ? "IDLE_BENIGN_RATE_BUDGET_RECOVERY"
      : undefined;
  if (!recoveryReason) throw new Error("IDLE_BENIGN_STATE_RECOVERY_UNKNOWN_REVIEW");

  const now = Date.now();
  const backupSuffix = recoveryReason === "IDLE_BENIGN_RATE_BUDGET_RECOVERY" ? "rate-budget" : "operator-activation";
  const backupPath = resolve(input.backupPath || `${statePath}.before-benign-${backupSuffix}-recovery-${checked.stateSha}`);
  try {
    await stat(backupPath);
    throw new Error("IDLE_BENIGN_STATE_RECOVERY_BACKUP_EXISTS");
  } catch (error: any) {
    if (error?.message === "IDLE_BENIGN_STATE_RECOVERY_BACKUP_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(statePath, backupPath);
  if (!(await readFile(backupPath)).equals(beforeBytes)) throw new Error("IDLE_BENIGN_STATE_RECOVERY_BACKUP_NOT_EXACT");
  if (process.platform !== "win32") {
    await chown(backupPath, metadata.uid, metadata.gid);
    await chmod(backupPath, metadata.mode & 0o777);
  }

  const after = {
    ...before,
    updatedAt: now,
    manualReview: null,
    lastDecision: { decisionTs: now, accepted: false, reason: recoveryReason },
    failures: [...(Array.isArray(before.failures) ? before.failures : []), { message: recoveryReason, occurredAt: now }].slice(-100),
  };
  const temporary = `${statePath}.${process.pid}.${now}.benign-recovery.tmp`;
  const handle = await open(temporary, "wx", metadata.mode & 0o777);
  try {
    await handle.writeFile(`${JSON.stringify(after, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform !== "win32") {
    await chown(temporary, metadata.uid, metadata.gid);
    await chmod(temporary, metadata.mode & 0o777);
  }
  await rename(temporary, statePath);
  const readback = JSON.parse(await readFile(statePath, "utf8"));
  const checkedReadback = assertFlatState(readback, expectedSha);
  if (checkedReadback.x.manualReview !== null || (readback.lastDecision as Record<string, unknown> | undefined)?.reason !== recoveryReason) {
    throw new Error("IDLE_BENIGN_STATE_RECOVERY_READBACK_MISMATCH");
  }
  return { status: "IDLE_BENIGN_STATE_RECOVERY_PASS" as const, recoveryReason, statePath, backupPath, runtimeSha: checkedReadback.stateSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    console.log("IDLE_BENIGN_STATE_RECOVERY_SELFTEST_PASS");
    return;
  }
  if (!process.argv.includes("--apply")) throw new Error("IDLE_BENIGN_STATE_RECOVERY_APPLY_REQUIRED");
  const statePath = arg("--state-path");
  if (!statePath) throw new Error("Usage: --apply --state-path PATH [--expected-sha SHA] [--backup-path PATH]");
  console.log(JSON.stringify(await recoverIdlePriorityShortBenignState({ statePath, expectedSha: arg("--expected-sha"), backupPath: arg("--backup-path") })));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "IDLE_BENIGN_STATE_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
