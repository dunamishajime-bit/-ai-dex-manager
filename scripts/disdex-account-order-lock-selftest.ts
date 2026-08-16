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
console.log("ACCOUNT_ORDER_LOCK_TS_SELFTEST_PASS");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
