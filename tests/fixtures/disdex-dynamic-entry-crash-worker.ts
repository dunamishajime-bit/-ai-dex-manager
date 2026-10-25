import { open } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
    FileDynamicEntryIntentRegistry,
    setDynamicEntryCrashProbe,
    type DynamicEntryCrashPoint,
} from "../../lib/disdex-dynamic-entry-intent-registry";
import { FileAccountOrderLock } from "../../lib/disdex-account-order-lock";
import { createStrictEntryApproval } from "../../lib/disdex-strict-entry-approval";

const point = process.argv[2] as DynamicEntryCrashPoint;
const root = resolve(process.argv[3] || ".");
const registryPath = join(root, "intents.json");
const lockPath = join(root, "account.lock");
const pendingPath = join(root, "pending.json");
const stagePath = join(root, "stage.json");
const errorPath = join(root, "error.json");
const NOW = 100_000;

const intent = {
    cycleId: "crash-matrix-cycle",
    id: "crash-matrix-entry",
    idempotencyKey: "crash-matrix-entry",
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
        cycleId: intent.cycleId,
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

async function durableJson(path: string, value: unknown) {
    const fd = await open(path, "w", 0o600);
    try {
        await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await fd.sync();
    } finally {
        await fd.close();
    }
}

async function waitUntilKilled(): Promise<never> {
    await new Promise<void>(() => {
        setInterval(() => undefined, 1_000);
    });
    throw new Error("CRASH_WORKER_UNEXPECTEDLY_RELEASED");
}

async function main() {
    if (!point) throw new Error("CRASH_WORKER_POINT_REQUIRED");
    const registry = new FileDynamicEntryIntentRegistry(registryPath, 30_000, 50);
    await registry.submit(intent, NOW);

    setDynamicEntryCrashProbe(async (observed) => {
        if (observed !== point) return;
        await durableJson(stagePath, { point: observed, pid: process.pid, capturedAt: Date.now() });
        await waitUntilKilled();
    });

    const lock = await new FileAccountOrderLock(lockPath, 300, pendingPath).acquire(`CRASH_MATRIX:${process.pid}`);
    if (!lock) throw new Error("CRASH_WORKER_ACCOUNT_LOCK_UNAVAILABLE");

    await registry.allocateCycle({
        cycleId: intent.cycleId,
        now: NOW,
        cryptoGrossAvailable: 0.3,
        stockGrossAvailable: 0,
        totalGrossAvailable: 0.3,
        equityUsd: 1_000,
        lock,
        quality102CausalV1Ready: true,
        strategyGrossAvailable: { V12: 1 },
        positionGrossAvailable: { "V12|ETHUSDT|LONG": 1 },
        strictPlannerApprovals: [approvalFor()],
    });
}

main().catch(async (error) => {
    await durableJson(errorPath, { message: error instanceof Error ? error.message : String(error), pid: process.pid });
    process.exitCode = 1;
});
