import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DirectAccountSnapshot, DirectPosition } from "../lib/direct-trade-executor";
import type { DisDexV35RebalanceAction } from "../lib/disdex-v35-portfolio-runner";
import { buildDisDexV35RebalanceActions } from "../lib/disdex-v35-portfolio-runner";
import {
    planDisDexV96ExecutionCapacity,
    shouldSkipDisDexV96Signal,
} from "../lib/disdex-v96-execution-capacity";
import {
    expectedManagedPositionsForMigration,
    managedPositionSnapshotsMatch,
    type CombinedV96MigrationManifest,
    type CombinedV96PositionReconciliation,
} from "../lib/disdex-v96-combined-state-migration";
import { buildDefaultDisDexV96RunnerConfig } from "../lib/disdex-v96-portfolio-runner";
import {
    createDisDexV96RunnerState,
    MemoryDisDexV96RunnerStateStore,
} from "../lib/disdex-v96-runner-state";
import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";

const NOW = Date.UTC(2026, 6, 27, 5, 0, 0);
const STALE_ETH_REFERENCE_TS = 1785024000000;

function close(actual: number, expected: number, epsilon = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function account(walletBalance: number, availableBalance = walletBalance): DirectAccountSnapshot {
    return { walletBalance, availableBalance, asset: "USDT", updatedAt: NOW };
}

function position(input: Partial<DirectPosition> & Pick<DirectPosition, "symbol" | "quantity" | "notionalUsd">): DirectPosition {
    return {
        symbol: input.symbol,
        quantity: input.quantity,
        entryPrice: input.entryPrice ?? 100,
        markPrice: input.markPrice ?? 100,
        unrealizedPnl: input.unrealizedPnl ?? 0,
        pnlPct: input.pnlPct ?? 0,
        notionalUsd: input.notionalUsd,
        positionSide: input.positionSide ?? "BOTH",
        leverage: input.leverage ?? 1,
        updatedAt: input.updatedAt ?? NOW,
    };
}

function action(input: Partial<DisDexV35RebalanceAction> = {}): DisDexV35RebalanceAction {
    const currentNotionalUsd = input.currentNotionalUsd ?? 0;
    const targetNotionalUsd = input.targetNotionalUsd ?? 57.526;
    const deltaNotionalUsd = input.deltaNotionalUsd ?? targetNotionalUsd - currentNotionalUsd;
    return {
        symbol: input.symbol ?? "ETHUSDT",
        side: input.side ?? (deltaNotionalUsd >= 0 ? "BUY" : "SELL"),
        quantity: input.quantity ?? Math.abs(deltaNotionalUsd) / 100,
        reduceOnly: input.reduceOnly ?? false,
        currentNotionalUsd,
        targetNotionalUsd,
        targetWeight: input.targetWeight ?? 1,
        expectedPrice: input.expectedPrice ?? 100,
        deltaNotionalUsd,
        reason: input.reason ?? "V96 execution safety self-test",
    };
}

const capacityConfig = {
    cashReservePct: 2,
    maxGross: 1,
    maxSlippageBps: 35,
    minOrderNotionalUsd: 5,
    roundTripFeeBps: 8,
    minimumExecutionHeadroomUsd: 4,
};

async function main() {
    const staleSignal = {
        configuredReferenceTs: STALE_ETH_REFERENCE_TS,
        signalReferenceTs: STALE_ETH_REFERENCE_TS,
        symbol: "ETHUSDT",
        side: "BUY",
        reduceOnly: false,
    };
    assert.equal(shouldSkipDisDexV96Signal(staleSignal), true);
    assert.equal(shouldSkipDisDexV96Signal(staleSignal), true, "The same referenceTs must remain skipped on the next tick.");
    assert.equal(shouldSkipDisDexV96Signal({ ...staleSignal, signalReferenceTs: STALE_ETH_REFERENCE_TS + 12 * 60 * 60_000 }), false);
    assert.equal(shouldSkipDisDexV96Signal({ ...staleSignal, reduceOnly: true }), false, "A safety reduction must never be blocked by the stale-entry skip.");
    assert.equal(shouldSkipDisDexV96Signal({ ...staleSignal, side: "SELL" }), false);

    const skippedState = createDisDexV96RunnerState("live");
    skippedState.bootstrapRequired = false;
    skippedState.skippedSignalReferenceTs = STALE_ETH_REFERENCE_TS;
    const memoryStore = new MemoryDisDexV96RunnerStateStore(skippedState);
    await memoryStore.save(skippedState);
    assert.equal((await memoryStore.load()).skippedSignalReferenceTs, STALE_ETH_REFERENCE_TS);

    const smallAccountPlan = planDisDexV96ExecutionCapacity({
        account: account(58.70),
        positions: [],
        managedPositions: [],
        action: action({ targetNotionalUsd: 58.70 * 0.98, deltaNotionalUsd: 58.70 * 0.98 }),
        config: capacityConfig,
    });
    assert.equal(smallAccountPlan.wasScaled, true);
    assert.ok(smallAccountPlan.executionTargetWeight >= 0.94 && smallAccountPlan.executionTargetWeight <= 0.97);
    assert.ok(smallAccountPlan.executionScale < 1);
    assert.ok(smallAccountPlan.projectedManagedGross <= 1 + 1e-12);
    assert.ok(smallAccountPlan.executableIncreaseUsd <= smallAccountPlan.availableIncreaseCapacityUsd + 1e-12);

    const fundedPlan = planDisDexV96ExecutionCapacity({
        account: account(250),
        positions: [],
        managedPositions: [],
        action: action({ targetNotionalUsd: 245, deltaNotionalUsd: 245 }),
        config: capacityConfig,
    });
    assert.equal(fundedPlan.wasScaled, false);
    close(fundedPlan.executionScale, 1);
    close(fundedPlan.executionTargetWeight, 1);

    const insufficientAfterCosts = planDisDexV96ExecutionCapacity({
        account: account(3),
        positions: [],
        managedPositions: [],
        action: action({ targetNotionalUsd: 2.94, deltaNotionalUsd: 2.94 }),
        config: capacityConfig,
    });
    assert.match(insufficientAfterCosts.blockedReason || "", /below the minimum order notional/);
    close(insufficientAfterCosts.executableIncreaseUsd, 0);

    const existingBtc = position({ symbol: "BTCUSDT", quantity: 0.4, notionalUsd: 40, leverage: 2 });
    const marginAwarePlan = planDisDexV96ExecutionCapacity({
        account: account(100, 80),
        positions: [existingBtc],
        managedPositions: [existingBtc],
        action: action({ targetNotionalUsd: 98, deltaNotionalUsd: 98 }),
        config: capacityConfig,
    });
    close(marginAwarePlan.requiredInitialMarginUsd, 20);
    close(marginAwarePlan.reconstructedAvailableBalanceUsd, 80);
    close(marginAwarePlan.executableIncreaseUsd, 60);
    assert.ok(marginAwarePlan.projectedManagedGross <= 1 + 1e-12);

    assert.throws(() => planDisDexV96ExecutionCapacity({
        account: account(100, 1000),
        positions: [],
        managedPositions: [],
        action: action({ targetNotionalUsd: 98, deltaNotionalUsd: 98 }),
        config: capacityConfig,
    }), /inconsistent with account equity/);

    const signFlip = buildDisDexV35RebalanceActions({
        account: account(100),
        positions: [position({ symbol: "ETHUSDT", quantity: -0.5, notionalUsd: 50, positionSide: "BOTH" })],
        quotes: {
            ETHUSDT: {
                symbol: "ETHUSDT",
                bidPrice: 99.9,
                askPrice: 100.1,
                bidQuantity: 100,
                askQuantity: 100,
                midPrice: 100,
                spreadBps: 20,
                updatedAt: NOW,
            },
        },
        targetWeights: { ETHUSDT: 1 },
        config: {
            cashReservePct: 2,
            maxGross: 1,
            minOrderNotionalUsd: 5,
            rebalanceTolerancePct: 1,
            closeUnmanagedPositions: false,
        },
    });
    assert.equal(signFlip.actions[0]?.reduceOnly, true);
    assert.equal(signFlip.actions[0]?.side, "BUY");
    assert.equal(buildDefaultDisDexV96RunnerConfig().closeUnmanagedPositions, false);

    const manifest: CombinedV96MigrationManifest = {
        version: 1,
        strategyId: DISDEX_V96_STRATEGY_ID,
        status: "READY",
        migrationId: "migration-selftest",
        createdAt: new Date(NOW).toISOString(),
        sourceStatePath: "/tmp/source.json",
        sourceStateSha256: "a".repeat(64),
        sourceStateUpdatedAt: NOW,
        destinationStatePath: "/tmp/destination.json",
        destinationStateSha256: "b".repeat(64),
        backupPath: "/tmp/backup.json",
        pendingResolution: "NONE",
        asterAccountAddress: "0xselftest",
        managedPositions: [{ symbol: "PENGUUSDT", positionAmt: "-3.000000000000", positionSide: "BOTH" }],
        openOrderCount: 0,
        ordersSent: false,
    };
    const legacyExpected = expectedManagedPositionsForMigration(manifest);
    assert.equal(managedPositionSnapshotsMatch([], legacyExpected), false, "PENGU -3 versus authenticated flat must stop without formal reconciliation.");
    const flatReconciliation: CombinedV96PositionReconciliation = {
        version: 1,
        strategyId: DISDEX_V96_STRATEGY_ID,
        status: "RESOLVED_FLAT",
        reconciliationId: "reconciliation-selftest",
        migrationId: manifest.migrationId,
        createdAt: new Date(NOW).toISOString(),
        reason: "self-test",
        asterAccountAddress: manifest.asterAccountAddress,
        statePath: manifest.destinationStatePath,
        stateShaBefore: "b".repeat(64),
        stateShaAfter: "c".repeat(64),
        stateBackupPath: "/tmp/reconciliation-backup.json",
        legacyRecordedPositions: manifest.managedPositions,
        actualPositionsBefore: [],
        actualPositionsAfter: [],
        openOrderCountBefore: 0,
        openOrderCountAfter: 0,
        managedGrossBefore: 0,
        managedGrossAfter: 0,
        closeUnmanagedPositions: false,
        ordersSent: false,
    };
    assert.equal(managedPositionSnapshotsMatch([], expectedManagedPositionsForMigration(manifest, flatReconciliation)), true);

    const runnerSource = await readFile(resolve("lib/disdex-v96-portfolio-runner.ts"), "utf8");
    assert.match(runnerSource, /skippedSignalReferenceTs/);
    assert.match(runnerSource, /shouldSkipDisDexV96Signal/);
    assert.match(runnerSource, /if \(openOrders\.length\)/);
    assert.match(runnerSource, /UNKNOWN/);
    assert.match(runnerSource, /direction changes must close reduce-only/);
    assert.match(runnerSource, /closeUnmanagedPositions/);
    assert.match(runnerSource, /planDisDexV96ExecutionCapacity/);
    const reconciliationSource = await readFile(resolve("scripts/disdex-v96-position-reconcile.ts"), "utf8");
    assert.match(reconciliationSource, /ASTER_API_PRIVATE_KEY/);
    assert.match(reconciliationSource, /ordersSent: false/);
    assert.match(reconciliationSource, /closeUnmanagedPositions: false/);
    assert.doesNotMatch(reconciliationSource, /executeMarket\(/);

    console.log(JSON.stringify({
        status: "DISDEX_V96_EXECUTION_SAFETY_SELFTEST_PASS",
        staleEthReferenceTs: STALE_ETH_REFERENCE_TS,
        smallAccountExecutionTargetWeight: smallAccountPlan.executionTargetWeight,
        fundedExecutionTargetWeight: fundedPlan.executionTargetWeight,
        marginAwareRequiredInitialMarginUsd: marginAwarePlan.requiredInitialMarginUsd,
        marginAwareProjectedGross: marginAwarePlan.projectedManagedGross,
        penguFlatMismatchRequiresFormalReconciliation: true,
        closeUnmanagedPositions: false,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
