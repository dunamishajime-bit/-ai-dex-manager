import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";

test("account lock renewal extends the lease without changing ownership", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disdex-lock-renew-"));
    const path = join(directory, "account.lock");
    const lock = new FileAccountOrderLock(path, 200);
    const handle = await lock.acquire("V12_V4_RUNNER");
    assert.ok(handle);

    const before = JSON.parse(await readFile(path, "utf8"));
    const renewed = await handle.renew();
    assert.equal(renewed.ownerId, "V12_V4_RUNNER");
    assert.equal(renewed.leaseId, before.leaseId);
    assert.ok(renewed.expiresAt > before.expiresAt);
    assert.equal((await handle.document()).leaseId, before.leaseId);

    await handle.release();
});
