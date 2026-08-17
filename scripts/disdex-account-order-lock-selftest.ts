import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCOUNT_LOCK_SCHEMA, FileAccountOrderLock, accountOrderPriority, activeReservedGross } from "@/lib/disdex-account-order-lock";

async function main() {
    assert.equal(accountOrderPriority("V12_X1.00_ALL:P1:1"), 1);
    assert.equal(accountOrderPriority("V52:P2:live:1"), 2);
    assert.equal(accountOrderPriority("PENGU_DUAL_LS_V2:P3:1"), 3);
    assert.equal(accountOrderPriority("V12_X1.00_ALL:P4:1"), 4);

    const directory = await mkdtemp(join(tmpdir(), "disdex-lock-"));
    const path = join(directory, "account.lock");
    const first = new FileAccountOrderLock(path, 10_000);
    const second = new FileAccountOrderLock(path, 10_000);
    const firstHandle = await first.acquire("first");
    assert.ok(firstHandle);
    assert.equal(await second.acquire("second"), null);
    const handle = await first.acquire("duplicate");
    assert.equal(handle, null);
    const owner = await first.acquire("first");
    assert.equal(owner, null);
    const doc = JSON.parse(await readFile(path, "utf8"));
    assert.equal(activeReservedGross(doc), 0);
    const reservation = await firstHandle.reserve({ strategyId: "V12_X1.00_ALL", symbol: "ETHUSDT", side: "LONG", gross: 0.25, notionalUsd: 250 });
    assert.equal(reservation.status, "RESERVED");
    assert.equal(activeReservedGross(await firstHandle.document()), 0.25);
    await firstHandle.releaseReservation(reservation.reservationId);
    assert.equal(activeReservedGross(await firstHandle.document()), 0);
    await firstHandle.release();

    // Concurrent waiters inside one arbitration window must follow the fixed
    // account priority regardless of the JavaScript call order.
    process.env.DISDEX_ACCOUNT_LOCK_ARBITRATION_MS = "300";
    const priorityPath = join(directory, "priority.lock");
    const p4Lock = new FileAccountOrderLock(priorityPath, 10_000);
    const p2Lock = new FileAccountOrderLock(priorityPath, 10_000);
    const p1Lock = new FileAccountOrderLock(priorityPath, 10_000);
    const p3Lock = new FileAccountOrderLock(priorityPath, 10_000);
    const [p4, p2, p1, p3] = await Promise.all([
        p4Lock.acquire("V12_X1.00_ALL:P4:100:v12-entry"),
        p2Lock.acquire("V52:P2:live:200:stock-entry"),
        p1Lock.acquire("V12_X1.00_ALL:P1:300:reduce-only"),
        p3Lock.acquire("PENGU_DUAL_LS_V2:P3:400:pengu-entry"),
    ]);
    assert.ok(p1, "P1 risk-reducing waiter must win a simultaneous arbitration window");
    assert.equal(p2, null);
    assert.equal(p3, null);
    assert.equal(p4, null);
    await p1.release();

    // Without P1, stock P2 must precede PENGU P3 and V12 P4.
    const priorityPath2 = join(directory, "priority2.lock");
    const [v12Entry, penguEntry, stockEntry] = await Promise.all([
        new FileAccountOrderLock(priorityPath2, 10_000).acquire("V12_X1.00_ALL:P4:101:v12-entry"),
        new FileAccountOrderLock(priorityPath2, 10_000).acquire("PENGU_DUAL_LS_V2:P3:102:pengu-entry"),
        new FileAccountOrderLock(priorityPath2, 10_000).acquire("V52:P2:live:103:stock-entry"),
    ]);
    assert.ok(stockEntry, "V52 P2 must win over PENGU P3 and V12 P4");
    assert.equal(penguEntry, null);
    assert.equal(v12Entry, null);
    await stockEntry.release();

    // Hard-crash recovery: an expired lock owned by a definitely-dead V12 PID
    // can be atomically taken over only when its active reservation matches the
    // durable pending transaction that was saved before the exchange send.
    const statePath = join(directory, "v12-state.json");
    await writeFile(statePath, JSON.stringify({
        schema: "v12-x1-all-runner-state/v1",
        strategyId: "V12_X1.00_ALL",
        mode: "LIVE",
        updatedAt: Date.now(),
        pending: { symbol: "ETHUSDT", side: "LONG" },
    }));
    await writeFile(path, JSON.stringify({
        schema: ACCOUNT_LOCK_SCHEMA,
        accountScope: "ASTER_FUTURES",
        ownerId: "V12_X1.00_ALL:P4:99999999:dead",
        leaseId: "dead-lease",
        acquiredAt: Date.now() - 20_000,
        expiresAt: Date.now() - 10_000,
        reservations: [{
            reservationId: "dead-reservation",
            strategyId: "V12_X1.00_ALL",
            symbol: "ETHUSDT",
            side: "LONG",
            gross: 0.25,
            notionalUsd: 250,
            createdAt: Date.now() - 20_000,
            status: "RESERVED",
        }],
    }));
    const recovering = new FileAccountOrderLock(path, 10_000, {
        ownerPrefix: "V12_X1.00_ALL:",
        strategyId: "V12_X1.00_ALL",
        pendingStatePath: statePath,
    });
    const recovered = await recovering.acquire(`V12_X1.00_ALL:P4:${process.pid}:replacement`);
    assert.ok(recovered, "dead V12 lock with matching durable pending must be recoverable");
    assert.equal((await recovered.document()).ownerId, `V12_X1.00_ALL:P4:${process.pid}:replacement`);
    assert.equal(activeReservedGross(await recovered.document()), 0.25, "reservation must remain visible until pending reconciliation finishes");
    await recovered.release();

    // Mismatched pending metadata is not enough evidence to take ownership.
    await writeFile(statePath, JSON.stringify({
        schema: "v12-x1-all-runner-state/v1",
        strategyId: "V12_X1.00_ALL",
        mode: "LIVE",
        updatedAt: Date.now(),
        pending: { symbol: "BTCUSDT", side: "LONG" },
    }));
    await writeFile(path, JSON.stringify({
        schema: ACCOUNT_LOCK_SCHEMA,
        accountScope: "ASTER_FUTURES",
        ownerId: "V12_X1.00_ALL:P4:99999999:dead",
        leaseId: "mismatch-lease",
        acquiredAt: Date.now() - 20_000,
        expiresAt: Date.now() - 10_000,
        reservations: [{
            reservationId: "mismatch-reservation",
            strategyId: "V12_X1.00_ALL",
            symbol: "ETHUSDT",
            side: "LONG",
            gross: 0.25,
            notionalUsd: 250,
            createdAt: Date.now() - 20_000,
            status: "RESERVED",
        }],
    }));
    assert.equal(await recovering.acquire(`V12_X1.00_ALL:P4:${process.pid}:must-not-takeover`), null);

    console.log("ACCOUNT_ORDER_LOCK_TS_SELFTEST_PASS");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
