import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAccountOrderLock, activeReservedGross } from "@/lib/disdex-account-order-lock";

async function main() {
    const directory = await mkdtemp(join(tmpdir(), "disdex-lock-"));
    const path = join(directory, "account.lock");

    const first = new FileAccountOrderLock(path, 10_000);
    const second = new FileAccountOrderLock(path, 10_000);
    const firstHandle = await first.acquire("first");
    assert.ok(firstHandle);
    assert.equal(await second.acquire("second"), null);
    assert.equal(await first.acquire("duplicate"), null);
    assert.equal(await first.acquire("first"), null);

    const doc = JSON.parse(await readFile(path, "utf8"));
    assert.equal(activeReservedGross(doc), 0);

    const reservation = await firstHandle.reserve({
        strategyId: "V12_X1.00_ALL",
        symbol: "ETHUSDT",
        side: "LONG",
        gross: 0.25,
        notionalUsd: 250,
    });
    assert.equal(reservation.status, "RESERVED");
    assert.equal(activeReservedGross(await firstHandle.document()), 0.25);
    await firstHandle.releaseReservation(reservation.reservationId);
    assert.equal(activeReservedGross(await firstHandle.document()), 0);
    await firstHandle.release();

    // Same-handle operations are serialized. A reserve invocation that enters
    // the queue before release must finish before the lock file is removed.
    const concurrent = new FileAccountOrderLock(path, 10_000);
    const concurrentHandle = await concurrent.acquire("concurrent");
    assert.ok(concurrentHandle);
    const reservePromise = concurrentHandle.reserve({
        strategyId: "QUALITY102_CAUSAL_V1",
        symbol: "LINKUSDT",
        side: "LONG",
        gross: 0.5,
        notionalUsd: 500,
    });
    const releasePromise = concurrentHandle.release();
    const [concurrentReservation] = await Promise.all([reservePromise, releasePromise]);
    assert.equal(concurrentReservation.status, "RESERVED");
    await assert.rejects(
        () => concurrentHandle.document(),
        /ACCOUNT_LOCK_RELEASED/,
    );

    // Once release completed, another process/strategy can acquire normally.
    const afterRelease = await second.acquire("after-release");
    assert.ok(afterRelease);
    await afterRelease.release();

    // Exercise the EEXIST -> ENOENT release race deterministically. The first
    // read after exclusive-open failure simulates the previous owner removing
    // the lock before inspection; acquire must retry once and succeed.
    const blocker = new FileAccountOrderLock(path, 10_000);
    const blockerHandle = await blocker.acquire("blocker");
    assert.ok(blockerHandle);
    const releaseRace = new FileAccountOrderLock(path, 10_000);
    let injected = false;
    (releaseRace as unknown as { read: () => Promise<unknown> }).read = async () => {
        if (!injected) {
            injected = true;
            await blockerHandle.release();
            const error = new Error("synthetic vanished lock") as Error & { code?: string };
            error.code = "ENOENT";
            throw error;
        }
        return {};
    };
    const recovered = await releaseRace.acquire("after-vanish");
    assert.ok(recovered);
    await recovered.release();

    console.log("ACCOUNT_ORDER_LOCK_TS_SELFTEST_PASS");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
