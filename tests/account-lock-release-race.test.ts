import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";

test("account lock retries once when the owner disappears during contention inspection", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-lock-release-race-"));
  const path = join(root, "account.lock");
  try {
    const blocker = new FileAccountOrderLock(path, 10_000);
    const blockerHandle = await blocker.acquire("blocker");
    assert.ok(blockerHandle);

    const contender = new FileAccountOrderLock(path, 10_000);
    let reads = 0;
    (contender as unknown as { read: () => Promise<unknown> }).read = async () => {
      reads += 1;
      await blockerHandle.release();
      const error = new Error("synthetic vanished lock") as Error & { code?: string };
      error.code = "ENOENT";
      throw error;
    };

    const handle = await contender.acquire("contender");
    assert.ok(handle);
    assert.equal(reads, 1);
    await handle.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
