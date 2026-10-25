import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    FileDynamicEntryIntentRegistry,
    type DynamicEntryCrashPoint,
} from "../lib/disdex-dynamic-entry-intent-registry";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";
import { archiveExpiredAccountOrderLock } from "../lib/disdex-expired-account-lock-recovery";
import { createStrictEntryApproval } from "../lib/disdex-strict-entry-approval";

const POINTS: DynamicEntryCrashPoint[] = [
    "RESERVATION_BEFORE_JOURNAL",
    "RESERVE_PROCESSING",
    "RESERVE_SUCCESS",
    "JOURNAL_UPDATE_BEFORE",
    "DECISION_PUBLISH_BEFORE",
    "ATOMIC_WRITE_BEFORE_RENAME",
];
const CYCLE_ID = "crash-matrix-cycle";
const INTENT_ID = "crash-matrix-entry";
const NOW = 100_000;

const intent = {
    cycleId: CYCLE_ID,
    id: INTENT_ID,
    idempotencyKey: INTENT_ID,
    signalTs: NOW,
    strategy: "V12",
    symbol: "ETHUSDT",
    side: "LONG" as const,
    assetClass: "CRYPTO" as const,
    marketFitScore: 5,
    targetGross: 0.3,
    minGross: 0.1,
    maxGross: 0.3,
};

function approvalFor() {
    const accepted = {
        idempotencyKey: intent.idempotencyKey,
        strategy: intent.strategy,
        symbol: intent.symbol,
        side: intent.side,
        signalTs: intent.signalTs,
        gross: intent.targetGross,
        notionalUsd: intent.targetGross * 1_000,
        minGross: intent.minGross,
        maxGross: intent.maxGross,
    } as any;
    return createStrictEntryApproval({
        cycleId: CYCLE_ID,
        candidate: intent,
        plan: {
            status: "planned",
            accepted: [accepted],
            rejected: [],
            reductions: [],
            activePositions: [],
            equityAfterReductions: 1_000,
            totals: { totalGross: intent.targetGross, cryptoGross: intent.targetGross, stockGross: 0 },
        },
        now: NOW,
        maxAgeMs: 30_000,
        snapshot: {
            capturedAt: NOW,
            account: { equityUsd: 1_000, availableBalanceUsd: 1_000, updatedAt: NOW },
            positions: [],
            openOrders: [],
            pendingReservationIds: [],
            entryCeiling: { cryptoGrossCap: 3, totalGrossCap: 4.25 },
            sharedDailyRisk: { schema: "disdex-shared-crypto-daily-risk/v1", accountScope: "ASTER_FUTURES", updatedAt: NOW, tripped: false, sourceComplete: true },
            portfolioDdGovernor: { schema: "disdex-portfolio-dd-governor/v1", updatedAt: NOW, currentDrawdownPct: 0, twrIndex: 1, twrPeak: 1 },
            unmanagedOpenOrders: { checkedAt: NOW, count: 0 },
            marginGuard: { checkedAt: NOW, healthy: true },
            protectiveStops: { checkedAt: NOW, requiredPositionIds: [], verifiedPositionIds: [] },
        },
    });
}

async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(path: string): Promise<any | undefined> {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ENOENT") return undefined;
        throw error;
    }
}

async function waitForStage(child: ChildProcess, stagePath: string, point: string, stderr: () => string) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        const stage = await readJson(stagePath);
        if (stage?.point === point) return stage;
        if (child.exitCode !== null) throw new Error(`crash worker exited before ${point}: ${stderr()}`);
        await sleep(25);
    }
    throw new Error(`crash worker did not reach ${point}: ${stderr()}`);
}

async function forceKill(child: ChildProcess) {
    if (child.exitCode !== null) return;
    if (process.platform === "win32") {
        const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        assert.equal(result.status, 0, "taskkill must force-terminate the isolated worker tree");
    } else {
        assert.equal(child.kill("SIGKILL"), true, "the isolated worker must be force-terminated");
    }
    if (child.exitCode === null) await Promise.race([once(child, "exit"), sleep(5_000)]);
    assert.notEqual(child.exitCode, null, "the isolated worker must exit after force termination");
}

function evidence(now: number, live: boolean) {
    return {
        capturedAt: now,
        accountSnapshotFresh: true,
        openOrdersSnapshotFresh: true,
        pendingExposureSnapshotFresh: true,
        protectionSnapshotFresh: true,
        liveOrder: live,
        livePosition: false,
        pendingExposure: live,
        unmanagedOpenOrders: live ? 1 : 0,
        protectiveStopsVerified: true,
    };
}

test("real isolated process kill/restart preserves three-way reservation truth across every crash window", async () => {
    const worker = join(process.cwd(), "tests", "fixtures", "disdex-dynamic-entry-crash-worker.ts");
    const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    for (const point of POINTS) {
        const root = await mkdtemp(join(tmpdir(), `disdex-process-crash-${point.toLowerCase()}-`));
        const registryPath = join(root, "intents.json");
        const lockPath = join(root, "account.lock");
        const pendingPath = join(root, "pending.json");
        const stagePath = join(root, "stage.json");
        let stderr = "";
        const child = spawn(process.execPath, [tsx, worker, point, root], {
            cwd: process.cwd(),
            env: { ...process.env, NODE_NO_WARNINGS: "1" },
            stdio: ["ignore", "ignore", "pipe"],
        });
        child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
        try {
            const stage = await waitForStage(child, stagePath, point, () => stderr);
            await forceKill(child);
            await sleep(500);

            const registryBefore = await readJson(registryPath);
            const lockBefore = await readJson(lockPath);
            const pendingBefore = await readJson(pendingPath);
            assert.equal(registryBefore?.schema, "disdex-dynamic-entry-intents/v1");
            assert.ok(lockBefore, `${point}: account lock must remain durable after process death`);
            const journalPending = (registryBefore.reservations || []).filter((row: any) => row.status === "RESERVATION_PENDING");
            const lockReserved = (lockBefore.reservations || []).filter((row: any) => row.status === "RESERVED");
            const pendingActive = (pendingBefore?.entries || []).filter((row: any) => row.status !== "RELEASED");

            if (point === "RESERVATION_BEFORE_JOURNAL" || point === "ATOMIC_WRITE_BEFORE_RENAME") {
                assert.equal(journalPending.length, 0, `${point}: no journal row may exist before the durable journal rename`);
                assert.equal(lockReserved.length, 0, `${point}: no account reservation may exist before reserve`);
                assert.equal(pendingActive.length, 0, `${point}: pending exposure must remain empty before reserve`);
                if (point === "ATOMIC_WRITE_BEFORE_RENAME") {
                    const files = await readdir(root);
                    assert.equal(files.some((name) => name.startsWith(`intents.json.${stage.pid}.`) && name.endsWith(".tmp")), true,
                        `${point}: atomic interruption must leave a temp candidate while preserving the previous target`);
                }
            } else if (point === "RESERVE_PROCESSING") {
                assert.equal(journalPending.length, 1, `${point}: journal must identify the reservation before reserve`);
                assert.equal(lockReserved.length, 0, `${point}: reserve has not completed`);
                assert.equal(pendingActive.length, 0, `${point}: pending exposure must not overstate reserve progress`);
            } else {
                assert.equal(journalPending.length, 1, `${point}: journal must remain pending until final publish`);
                assert.equal(lockReserved.length, 1, `${point}: account lock must retain the successful reserve`);
                assert.equal(pendingActive.length, 1, `${point}: pending exposure must retain the successful reserve`);
                assert.equal(journalPending[0].reservationId, lockReserved[0].reservationId, `${point}: journal/lock ID mismatch`);
                assert.equal(lockReserved[0].reservationId, pendingActive[0].reservationId, `${point}: lock/pending ID mismatch`);
                assert.equal(journalPending[0].gross, lockReserved[0].gross, `${point}: journal/lock gross mismatch`);
                assert.equal(lockReserved[0].gross, pendingActive[0].gross, `${point}: lock/pending gross mismatch`);
            }

            const oldOwnerId = String(lockBefore.ownerId);
            const oldReservationId = lockReserved[0]?.reservationId;
            const registry = new FileDynamicEntryIntentRegistry(registryPath, 30_000, 50);

            if (lockReserved.length === 0) {
                await sleep(400);
                await archiveExpiredAccountOrderLock({
                    lockPath,
                    archiveDir: join(root, "recovery-archive"),
                    expectedOwnerId: oldOwnerId,
                    now: Date.now(),
                    ownerAlive: false,
                    requestId: `crash-${point}`,
                });
                const restartLock = await new FileAccountOrderLock(lockPath, 300, pendingPath).acquire("CRASH_MATRIX_RESTART");
                assert.ok(restartLock, `${point}: restart must recover ownership only after the expired empty lock is archived`);
                const recoveryNow = Date.now();
                const reconciled = await registry.reconcileReservations({
                    now: recoveryNow,
                    lock: restartLock,
                    evidenceFor: () => evidence(recoveryNow, false),
                });
                assert.equal(reconciled.every((row) => row.status === "RELEASED"), true, `${point}: confirmed no-live rows may be released, never guessed healthy`);
                assert.equal(existsSync(`${registryPath}.mutex`), false, `${point}: stale registry mutex must be reclaimed and released`);

                if (point === "RESERVE_PROCESSING") {
                    const decision = await registry.allocateCycle({
                        cycleId: CYCLE_ID,
                        now: NOW,
                        cryptoGrossAvailable: 0.3,
                        stockGrossAvailable: 0,
                        totalGrossAvailable: 0.3,
                        equityUsd: 1_000,
                        lock: restartLock,
                        quality102CausalV1Ready: true,
                        strategyGrossAvailable: { V12: 1 },
                        positionGrossAvailable: { "V12|ETHUSDT|LONG": 1 },
                        strictPlannerApprovals: [approvalFor()],
                    });
                    assert.equal(decision.allocations.length, 1, `${point}: one recovered cycle may be retried`);
                    const retryLock = (await restartLock.document()).reservations.filter((row) => row.status === "RESERVED");
                    const retryPending = (await readPendingExposureRegistry(pendingPath)).entries.filter((row) => row.status !== "RELEASED");
                    assert.equal(retryLock.length, 1);
                    assert.equal(retryPending.length, 1);
                    assert.notEqual(retryLock[0].reservationId, oldReservationId, `${point}: a new lease must not replay an old reservation ID`);
                    assert.equal(retryLock[0].reservationId, retryPending[0].reservationId);
                    await restartLock.releaseReservation(retryLock[0].reservationId);
                }
                await restartLock.release();
            } else {
                await assert.rejects(
                    () => archiveExpiredAccountOrderLock({
                        lockPath,
                        archiveDir: join(root, "recovery-archive"),
                        expectedOwnerId: oldOwnerId,
                        now: Date.now(),
                        ownerAlive: false,
                        requestId: `unsafe-${point}`,
                    }),
                    /ACCOUNT_LOCK_RESERVATIONS_PRESENT/,
                    `${point}: active reservations must prevent stale-lock archival`,
                );
                const restartLock = await new FileAccountOrderLock(lockPath, 300, pendingPath).acquire("CRASH_MATRIX_RESTART");
                assert.equal(restartLock, null, `${point}: restart must not take ownership of a lock with unresolved exposure`);
                const reviewLock = {
                    document: async () => lockBefore,
                    releaseReservation: async () => { throw new Error("REVIEW_MUST_NOT_RELEASE"); },
                } as any;
                const reviewNow = Date.now();
                const review = await registry.reconcileReservations({
                    now: reviewNow,
                    lock: reviewLock,
                    evidenceFor: () => evidence(reviewNow, true),
                });
                assert.equal(review.length, 1);
                assert.equal(review[0].status, "REQUIRES_REVIEW", `${point}: potential live exposure must remain review, not auto-normal`);
                assert.equal((await readJson(registryPath)).reservations[0].status, "REQUIRES_REVIEW");
                const lockAfterReview = await readJson(lockPath);
                const pendingAfterReview = await readPendingExposureRegistry(pendingPath);
                assert.equal(lockAfterReview.reservations.filter((row: any) => row.status === "RESERVED").length, 1);
                assert.equal(pendingAfterReview.entries.filter((row) => row.status !== "RELEASED").length, 1);
                assert.equal(existsSync(`${registryPath}.mutex`), false, `${point}: stale registry mutex must not block review reconciliation`);
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});
