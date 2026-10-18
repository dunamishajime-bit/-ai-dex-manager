import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ExpiredAccountLockRecoveryResult = {
  status: "EXPIRED_ACCOUNT_LOCK_ARCHIVED";
  originalPath: string;
  archivePath: string;
  ownerId: string;
  expiresAt: number;
  reservationCount: number;
  bytes: number;
  sha256: string;
  ownerPidMissing?: boolean;
};

type RecoveryInspectionOptions = {
  now: number;
  expectedOwnerId: string;
  ownerAlive: boolean;
  /** Missing PID is allowed only with an independent process-absence proof. */
  allowMissingOwnerPid?: boolean;
  ownerProcessAbsent?: boolean;
};

type RecoveryInput = RecoveryInspectionOptions & {
  lockPath: string;
  archiveDir: string;
  requestId: string;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ACCOUNT_LOCK_MALFORMED");
  return value as Record<string, unknown>;
}

function finite(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`ACCOUNT_LOCK_${field}_INVALID`);
  return parsed;
}

function lockReservations(value: Record<string, unknown>): unknown[] {
  if (!Array.isArray(value.reservations)) throw new Error("ACCOUNT_LOCK_RESERVATIONS_INVALID");
  return value.reservations;
}

export function inspectExpiredAccountOrderLock(
  raw: unknown,
  options: RecoveryInspectionOptions,
) {
  const value = object(raw);
  if (value.schema !== "disdex-account-lock/v1") throw new Error("ACCOUNT_LOCK_MALFORMED");
  const ownerId = String(value.ownerId || "");
  if (!ownerId) throw new Error("ACCOUNT_LOCK_OWNER_INVALID");
  if (ownerId !== options.expectedOwnerId) throw new Error("ACCOUNT_LOCK_OWNER_MISMATCH");
  const ownerPidMissing = !/:[0-9]+$/.test(ownerId);
  if (ownerPidMissing && (!options.allowMissingOwnerPid || options.ownerProcessAbsent !== true)) {
    throw new Error(options.allowMissingOwnerPid ? "ACCOUNT_LOCK_OWNER_ABSENCE_PROOF_REQUIRED" : "ACCOUNT_LOCK_OWNER_PID_MISSING");
  }
  const expiresAt = finite(value.expiresAt, "EXPIRES_AT");
  if (!Number.isFinite(options.now) || options.now < 0) throw new Error("ACCOUNT_LOCK_RECOVERY_NOW_INVALID");
  if (expiresAt > options.now) throw new Error("ACCOUNT_LOCK_NOT_EXPIRED");
  if (options.ownerAlive) throw new Error("ACCOUNT_LOCK_OWNER_STILL_ALIVE");

  const reservations = lockReservations(value);
  if (reservations.length > 0) throw new Error("ACCOUNT_LOCK_RESERVATIONS_PRESENT");

  return {
    status: "EXPIRED_ACCOUNT_LOCK_RECOVERY_ELIGIBLE" as const,
    ownerId,
    expiresAt,
    reservationCount: reservations.length,
    ...(ownerPidMissing ? { ownerPidMissing: true } : {}),
  };
}

function safeRequestId(value: string) {
  const normalized = String(value || "recovery").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96);
  return normalized || "recovery";
}

export async function archiveExpiredAccountOrderLock(input: RecoveryInput): Promise<ExpiredAccountLockRecoveryResult> {
  const lockPath = resolve(input.lockPath);
  const archiveDir = resolve(input.archiveDir);
  const metadata = await lstat(lockPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("ACCOUNT_LOCK_NOT_REGULAR_FILE");
  const bytes = await readFile(lockPath);
  const raw = JSON.parse(bytes.toString("utf8")) as unknown;
  const inspection = inspectExpiredAccountOrderLock(raw, input);
  await mkdir(archiveDir, { recursive: true, mode: 0o700 });

  const archivePath = resolve(
    archiveDir,
    `${new Date(input.now).toISOString().replace(/[:.]/g, "-")}-${safeRequestId(input.requestId)}-${randomUUID()}.json`,
  );
  await rename(lockPath, archivePath);
  await chmod(archivePath, 0o600);
  const archived = await readFile(archivePath);
  if (!archived.equals(bytes)) throw new Error("ACCOUNT_LOCK_ARCHIVE_BYTES_MISMATCH");
  const digest = createHash("sha256").update(archived).digest("hex");

  return {
    status: "EXPIRED_ACCOUNT_LOCK_ARCHIVED",
    originalPath: lockPath,
    archivePath,
    ownerId: inspection.ownerId,
    expiresAt: inspection.expiresAt,
    reservationCount: inspection.reservationCount,
    bytes: archived.length,
    sha256: digest,
  };
}

export function accountLockOwnerPid(ownerId: string): number {
  const match = /:([0-9]+)$/.exec(ownerId);
  if (!match) throw new Error("ACCOUNT_LOCK_OWNER_PID_MISSING");
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("ACCOUNT_LOCK_OWNER_PID_INVALID");
  return pid;
}

export function accountLockRecoveryDefaultArchive(lockPath: string) {
  return resolve(dirname(resolve(lockPath)), "account-order-lock-recovery-archive");
}
