import { mkdtemp, readFile, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveExpiredAccountOrderLock,
  inspectExpiredAccountOrderLock,
} from "../lib/disdex-expired-account-lock-recovery";

const OWNER = "Q102_PENDING_RECOVERY:12345";
const BASE = {
  schema: "disdex-account-lock/v1",
  accountScope: "ASTER_FUTURES",
  ownerId: OWNER,
  leaseId: "lease-1",
  acquiredAt: 1_000,
  expiresAt: 2_000,
  reservations: [],
};

test("expired lock with a dead owner and no reservations is eligible", () => {
  assert.deepEqual(
    inspectExpiredAccountOrderLock(BASE, {
      now: 3_000,
      expectedOwnerId: OWNER,
      ownerAlive: false,
    }),
    {
      status: "EXPIRED_ACCOUNT_LOCK_RECOVERY_ELIGIBLE",
      ownerId: OWNER,
      expiresAt: 2_000,
      reservationCount: 0,
    },
  );
});

test("live owner, wrong owner, and reservations fail closed", () => {
  assert.throws(
    () => inspectExpiredAccountOrderLock(BASE, { now: 3_000, expectedOwnerId: OWNER, ownerAlive: true }),
    /ACCOUNT_LOCK_OWNER_STILL_ALIVE/,
  );
  assert.throws(
    () => inspectExpiredAccountOrderLock(BASE, { now: 3_000, expectedOwnerId: "OTHER:12345", ownerAlive: false }),
    /ACCOUNT_LOCK_OWNER_MISMATCH/,
  );
  assert.throws(
    () => inspectExpiredAccountOrderLock({ ...BASE, reservations: [{ reservationId: "r", status: "RESERVED" }] }, { now: 3_000, expectedOwnerId: OWNER, ownerAlive: false }),
    /ACCOUNT_LOCK_RESERVATIONS_PRESENT/,
  );
});

test("unexpired, malformed, and missing owner pid fail closed", () => {
  assert.throws(
    () => inspectExpiredAccountOrderLock({ ...BASE, expiresAt: 4_000 }, { now: 3_000, expectedOwnerId: OWNER, ownerAlive: false }),
    /ACCOUNT_LOCK_NOT_EXPIRED/,
  );
  assert.throws(
    () => inspectExpiredAccountOrderLock({ ...BASE, ownerId: "Q102_PENDING_RECOVERY" }, { now: 3_000, expectedOwnerId: "Q102_PENDING_RECOVERY", ownerAlive: false }),
    /ACCOUNT_LOCK_OWNER_PID_MISSING/,
  );
  assert.throws(
    () => inspectExpiredAccountOrderLock({ ...BASE, schema: "wrong" }, { now: 3_000, expectedOwnerId: OWNER, ownerAlive: false }),
    /ACCOUNT_LOCK_MALFORMED/,
  );
});

test("archive is atomic, preserves exact bytes, and rejects symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "disdex-expired-lock-"));
  const lockPath = join(root, "account-order.lock");
  const archiveDir = join(root, "recovery-archive");
  const bytes = Buffer.from(`${JSON.stringify(BASE)}\n`, "utf8");
  await writeFile(lockPath, bytes, { mode: 0o600 });

  const result = await archiveExpiredAccountOrderLock({
    lockPath,
    archiveDir,
    expectedOwnerId: OWNER,
    now: 3_000,
    ownerAlive: false,
    requestId: "test-request",
  });
  assert.equal(result.status, "EXPIRED_ACCOUNT_LOCK_ARCHIVED");
  assert.equal(result.originalPath, lockPath);
  assert.equal((await readFile(result.archivePath)).equals(bytes), true);
  await assert.rejects(() => lstat(lockPath), /ENOENT/);

  const symlinkPath = join(root, "symlink.lock");
  const targetPath = join(root, "target.lock");
  await writeFile(targetPath, bytes);
  const fs = await import("node:fs/promises");
  try {
    await fs.symlink(targetPath, symlinkPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "EPERM") {
      t.skip("Windows test host does not permit symlink creation");
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => archiveExpiredAccountOrderLock({
      lockPath: symlinkPath,
      archiveDir,
      expectedOwnerId: OWNER,
      now: 3_000,
      ownerAlive: false,
      requestId: "symlink-request",
    }),
    /ACCOUNT_LOCK_NOT_REGULAR_FILE/,
  );
});
