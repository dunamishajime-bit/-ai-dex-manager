import { chmod, chown, copyFile, lstat, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { normalizeIdleState } from "../lib/idle-priority-short-state";

const SHA = /^[0-9a-f]{40}$/i;
const ACTIVE_POSITION_EPSILON = 1e-12;
export const UNKNOWN_ACTIVE_POSITION_REVIEW_PREFIX = "IDLE_RUNNER_FAIL_CLOSED:IDLE_UNKNOWN_ACTIVE_POSITION:";
export const UNKNOWN_POSITION_RECOVERY_REASON = "IDLE_TRANSIENT_UNKNOWN_POSITION_RECONCILED_READONLY";

function exactSha(value: unknown, field: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`IDLE_UNKNOWN_POSITION_RECOVERY_${field}_INVALID`);
  return normalized;
}

function assertFlatState(raw: unknown, expectedSha?: string) {
  if (!raw || typeof raw !== "object") throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_STATE_INVALID");
  const x = raw as Record<string, unknown>;
  if (x.schema !== "disdex-idle-priority-state/v2") throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_SCHEMA");
  const stateSha = exactSha(x.runtimeSha, "STATE_SHA");
  if (expectedSha && stateSha !== expectedSha) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_SHA_MISMATCH");
  const normalized = normalizeIdleState(raw, stateSha);
  if (normalized.positions.length > 0) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_POSITIONS_PRESENT");
  if (normalized.pending) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_PENDING_PRESENT");
  return { x, stateSha };
}

function knownVenueSymbol(symbol: unknown, field: string) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) throw new Error(`IDLE_UNKNOWN_POSITION_RECOVERY_${field}_SYMBOL_INVALID`);
  const classification = classifyAsterSymbol(normalized);
  if (!classification.tradable || classification.assetClass === "UNKNOWN") {
    throw new Error(`IDLE_UNKNOWN_POSITION_RECOVERY_UNKNOWN_${field}_SYMBOL:${normalized}`);
  }
  return normalized;
}

function assertReadOnlyEvidence(raw: unknown, review: string) {
  if (!raw || typeof raw !== "object") throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_INVALID");
  const evidence = raw as Record<string, unknown>;
  if (evidence.status !== "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS") throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_STATUS");
  for (const key of ["ordersSent", "cancelsSent", "positionChangesSent"]) {
    if (Number(evidence[key]) !== 0) throw new Error(`IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_MUTATION:${key}`);
  }
  const positions = evidence.positions;
  if (!Array.isArray(positions)) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_POSITIONS_INVALID");
  const reviewSymbol = review.slice(UNKNOWN_ACTIVE_POSITION_REVIEW_PREFIX.length).toUpperCase();
  if (!reviewSymbol) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_REVIEW_SYMBOL_INVALID");
  for (const row of positions) {
    if (!row || typeof row !== "object") throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_POSITION_INVALID");
    const value = row as Record<string, unknown>;
    const quantity = Number(value.positionAmt);
    if (!Number.isFinite(quantity) || Math.abs(quantity) <= ACTIVE_POSITION_EPSILON) continue;
    const symbol = knownVenueSymbol(value.symbol, "POSITION");
    if (symbol === reviewSymbol) throw new Error(`IDLE_UNKNOWN_POSITION_RECOVERY_REVIEW_SYMBOL_REMAINS:${symbol}`);
  }
  const openOrders = evidence.openOrders;
  if (!Array.isArray(openOrders)) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_ORDERS_INVALID");
  for (const row of openOrders) {
    if (!row || typeof row !== "object") throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_ORDER_INVALID");
    const value = row as Record<string, unknown>;
    knownVenueSymbol(value.symbol, "ORDER");
    if (value.reduceOnly !== true) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_UNPROTECTED_ORDER");
  }
  const pendingOrder = evidence.pendingOrder;
  if (pendingOrder && typeof pendingOrder === "object" && (pendingOrder as Record<string, unknown>).notFoundOrUnavailable !== true) {
    throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_PENDING_ORDER_PRESENT");
  }
}

export async function recoverIdlePriorityShortUnknownPositionState(input: {
  statePath: string;
  evidencePath: string;
  expectedSha?: string;
  backupPath?: string;
}) {
  const expectedSha = input.expectedSha ? exactSha(input.expectedSha, "EXPECTED_SHA") : undefined;
  const statePath = resolve(input.statePath);
  const evidencePath = resolve(input.evidencePath);
  const metadata = await lstat(statePath);
  if (metadata.isSymbolicLink()) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_SYMLINK_FORBIDDEN");
  if (!metadata.isFile()) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_NOT_REGULAR_FILE");
  const evidenceMetadata = await lstat(evidencePath);
  if (evidenceMetadata.isSymbolicLink()) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_SYMLINK_FORBIDDEN");
  if (!evidenceMetadata.isFile()) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_EVIDENCE_NOT_REGULAR_FILE");

  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8"));
  const checked = assertFlatState(before, expectedSha);
  const review = String(checked.x.manualReview || "");
  if (!review.startsWith(UNKNOWN_ACTIVE_POSITION_REVIEW_PREFIX)) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_REVIEW_MISMATCH");
  assertReadOnlyEvidence(JSON.parse(await readFile(evidencePath, "utf8")), review);
  const now = Date.now();
  const backupPath = resolve(input.backupPath || `${statePath}.before-unknown-position-recovery-${checked.stateSha}`);
  try {
    await stat(backupPath);
    throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_BACKUP_EXISTS");
  } catch (error: any) {
    if (error?.message === "IDLE_UNKNOWN_POSITION_RECOVERY_BACKUP_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(statePath, backupPath);
  if (!(await readFile(backupPath)).equals(beforeBytes)) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_BACKUP_NOT_EXACT");
  if (process.platform !== "win32") {
    await chown(backupPath, metadata.uid, metadata.gid);
    await chmod(backupPath, metadata.mode & 0o777);
  }

  const after = {
    ...before,
    updatedAt: now,
    manualReview: null,
    lastDecision: { decisionTs: now, accepted: false, reason: UNKNOWN_POSITION_RECOVERY_REASON },
    failures: [...(Array.isArray(before.failures) ? before.failures : []), { message: UNKNOWN_POSITION_RECOVERY_REASON, occurredAt: now }].slice(-100),
  };
  const temporary = `${statePath}.${process.pid}.${now}.unknown-position-recovery.tmp`;
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
  if (checkedReadback.x.manualReview !== null || (readback.lastDecision as Record<string, unknown> | undefined)?.reason !== UNKNOWN_POSITION_RECOVERY_REASON) {
    throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_READBACK_MISMATCH");
  }
  return {
    status: "IDLE_UNKNOWN_POSITION_RECOVERY_PASS" as const,
    recoveryReason: UNKNOWN_POSITION_RECOVERY_REASON,
    statePath,
    evidencePath,
    backupPath,
    runtimeSha: checkedReadback.stateSha,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  };
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    console.log("IDLE_UNKNOWN_POSITION_RECOVERY_SELFTEST_PASS");
    return;
  }
  if (!process.argv.includes("--apply")) throw new Error("IDLE_UNKNOWN_POSITION_RECOVERY_APPLY_REQUIRED");
  const statePath = arg("--state-path");
  const evidencePath = arg("--evidence-path");
  if (!statePath || !evidencePath) throw new Error("Usage: --apply --state-path PATH --evidence-path PATH [--expected-sha SHA] [--backup-path PATH]");
  console.log(JSON.stringify(await recoverIdlePriorityShortUnknownPositionState({
    statePath,
    evidencePath,
    expectedSha: arg("--expected-sha"),
    backupPath: arg("--backup-path"),
  })));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "IDLE_UNKNOWN_POSITION_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
