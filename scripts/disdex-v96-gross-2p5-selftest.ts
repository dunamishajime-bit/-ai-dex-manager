import assert from "node:assert/strict";

import { DISDEX_V13D_V11EQ_V96_ALLOCATION } from "../config/disdexStockRouterV13DV11EqRuntime";
import { DISDEX_V96_ALLOCATION, DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import type { DirectAccountSnapshot, DirectPosition } from "../lib/direct-trade-executor";
import type { DisDexV35RebalanceAction } from "../lib/disdex-v35-portfolio-runner";
import { allocateDisDexV96ReservedPengu } from "../lib/disdex-v96-allocation";
import { planDisDexV96ExecutionCapacity } from "../lib/disdex-v96-execution-capacity";

const NOW = Date.UTC(2026, 6, 31, 14, 30, 0);

function account(walletBalance: number, availableBalance = walletBalance): DirectAccountSnapshot {
    return { walletBalance, availableBalance, asset: "USDT", updatedAt: NOW };
}

function position(symbol: string, notionalUsd: number, leverage: number): DirectPosition {
    return {
        symbol,
        quantity: notionalUsd / 100,
        entryPrice: 100,
        markPrice: 100,
        unrealizedPnl: 0,
        pnlPct: 0,
        notionalUsd,
        positionSide: "BOTH",
        leverage,
        updatedAt: NOW,
    };
}

function action(targetNotionalUsd: number, targetWeight: number): DisDexV35RebalanceAction {
    return {
        symbol: "PENGUUSDT",
        side: "BUY",
        quantity: targetNotionalUsd / 100,
        reduceOnly: false,
        currentNotionalUsd: 0,
        targetNotionalUsd,
        targetWeight,
        expectedPrice: 100,
        deltaNotionalUsd: targetNotionalUsd,
        reason: "V96 Gross 2.5 contract self-test",
    };
}

const config = {
    cashReservePct: 0,
    maxGross: 2.5,
    maxSlippageBps: 0,
    minOrderNotionalUsd: 5,
    roundTripFeeBps: 0,
    minimumExecutionHeadroomUsd: 0,
};

assert.equal(DISDEX_V96_ALLOCATION.penguTargetGross, 1.15);
assert.equal(DISDEX_V96_ALLOCATION.totalGrossCap, 2.5);
assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross, 1.15);
assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumPortfolioGross, 2.5);
assert.equal(DISDEX_V96_RUNTIME.minimumExecutionLeverage, 3);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap, 2.5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap, 2.5);

const reservedAllocation = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 0.9, ETHUSDT: 0.9 },
    penguSide: 1,
});
assert.equal(reservedAllocation.penguFinalGross, 1.15);
assert.equal(reservedAllocation.penguClip, 1);
assert.ok(Math.abs(reservedAllocation.scaledCoreGross - 1.35) <= 1e-12);
assert.ok(Math.abs(reservedAllocation.finalGross - 2.5) <= 1e-12);

const pengu115 = planDisDexV96ExecutionCapacity({
    account: account(100),
    positions: [],
    managedPositions: [],
    action: action(115, 1.15),
    config,
});
assert.equal(pengu115.wasScaled, false);
assert.equal(pengu115.executableIncreaseUsd, 115);
assert.equal(pengu115.executionTargetWeight, 1.15);
assert.equal(pengu115.projectedPortfolioGross, 1.15);

const stockPosition = position("NVDAUSDT", 150, 3);
const sharedCap = planDisDexV96ExecutionCapacity({
    account: account(100),
    positions: [stockPosition],
    managedPositions: [],
    action: action(200, 2),
    config,
});
assert.equal(sharedCap.externalGrossNotionalUsd, 150);
assert.equal(sharedCap.grossIncreaseCapacityUsd, 100);
assert.equal(sharedCap.executableIncreaseUsd, 100);
assert.equal(sharedCap.projectedManagedGross, 1);
assert.equal(sharedCap.projectedPortfolioGross, 2.5);
assert.equal(sharedCap.wasScaled, true);

console.log(JSON.stringify({
    status: "DISDEX_V96_GROSS_2P5_PENGU_1P15_SELFTEST_PASS",
    penguTargetGross: DISDEX_V96_ALLOCATION.penguTargetGross,
    operatorOverridePenguCap: DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross,
    portfolioGrossCap: DISDEX_V96_ALLOCATION.totalGrossCap,
    requiredExecutionLeverage: DISDEX_V96_RUNTIME.minimumExecutionLeverage,
    pengu115ReservedBeforeCore: true,
    coreResidualGross: reservedAllocation.scaledCoreGross,
    stockGross: 1.5,
    residualCryptoGross: sharedCap.projectedManagedGross,
    finalPortfolioGross: sharedCap.projectedPortfolioGross,
    ordersSent: false,
}));
