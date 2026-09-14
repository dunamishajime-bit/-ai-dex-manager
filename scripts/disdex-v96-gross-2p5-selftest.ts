import assert from "node:assert/strict";

import { DISDEX_V13D_V11EQ_V96_ALLOCATION } from "../config/disdexStockRouterV13DV11EqRuntime";
import { DISDEX_V96_ALLOCATION, DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import type { DirectAccountSnapshot, DirectPosition } from "../lib/direct-trade-executor";
import type { DisDexV35RebalanceAction } from "../lib/disdex-v35-portfolio-runner";
import { allocateDisDexV96ReservedPengu } from "../lib/disdex-v96-allocation";
import { planDisDexV96ExecutionCapacity } from "../lib/disdex-v96-execution-capacity";

const NOW = Date.UTC(2026, 7, 4, 9, 0, 0);

function account(walletBalance: number, availableBalance = walletBalance): DirectAccountSnapshot {
    return { walletBalance, availableBalance, asset: "USDT", updatedAt: NOW };
}

function position(symbol: string, notionalUsd: number, leverage = 5): DirectPosition {
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
        reason: "V96 Crypto sleeve 1.5 within combined Gross 2.5 contract self-test",
    };
}

const config = {
    cashReservePct: 0,
    maxGross: 1.5,
    portfolioGrossCap: 2.5,
    targetInitialLeverage: 5,
    maximumInitialMarginFraction: 0.70,
    minimumAvailableBalanceFractionAfterOrder: 0.20,
    maxSlippageBps: 0,
    minOrderNotionalUsd: 5,
    roundTripFeeBps: 0,
    minimumExecutionHeadroomUsd: 0,
};

assert.equal(DISDEX_V96_ALLOCATION.penguTargetGross, 1.15);
assert.equal(DISDEX_V96_ALLOCATION.totalGrossCap, 1.5);
assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross, 1.15);
assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumPortfolioGross, 1.5);
assert.equal(DISDEX_V96_RUNTIME.minimumExecutionLeverage, 5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap, 1.5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap, 1.5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap, 2.5);
assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.reservedFirstStockGross, 1.0);

const reservedAllocation = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 0.9, ETHUSDT: 0.9 },
    penguSide: 1,
});
assert.equal(reservedAllocation.penguFinalGross, 1.15);
assert.equal(reservedAllocation.penguClip, 1);
assert.ok(Math.abs(reservedAllocation.scaledCoreGross - 0.35) <= 1e-12);
assert.ok(Math.abs(reservedAllocation.finalGross - 1.5) <= 1e-12);

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
assert.equal(pengu115.projectedManagedGross, 1.15);
assert.equal(pengu115.projectedPortfolioGross, 1.15);
assert.equal(pengu115.projectedInitialMarginFraction, 0.23);
assert.equal(pengu115.projectedAvailableBalanceUsd, 77);

const firstStockPosition = position("NVDAUSDT", 100);
const crypto150WithStock100 = planDisDexV96ExecutionCapacity({
    account: account(100, 80),
    positions: [firstStockPosition],
    managedPositions: [],
    action: action(200, 2),
    config,
});
assert.equal(crypto150WithStock100.externalGrossNotionalUsd, 100);
assert.equal(crypto150WithStock100.grossIncreaseCapacityUsd, 150);
assert.equal(crypto150WithStock100.executableIncreaseUsd, 150);
assert.equal(crypto150WithStock100.projectedManagedGross, 1.5);
assert.equal(crypto150WithStock100.projectedPortfolioGross, 2.5);
assert.equal(crypto150WithStock100.projectedInitialMarginFraction, 0.5);
assert.equal(crypto150WithStock100.wasScaled, true);

const pengu115WithFirstStock = planDisDexV96ExecutionCapacity({
    account: account(100, 80),
    positions: [firstStockPosition],
    managedPositions: [],
    action: action(115, 1.15),
    config,
});
assert.equal(pengu115WithFirstStock.executableIncreaseUsd, 115);
assert.equal(pengu115WithFirstStock.projectedManagedGross, 1.15);
assert.equal(pengu115WithFirstStock.projectedPortfolioGross, 2.15);
assert.equal(2.5 - pengu115WithFirstStock.projectedPortfolioGross, 0.3500000000000001);

console.log(JSON.stringify({
    status: "DISDEX_V96_CRYPTO_1P5_COMBINED_2P5_PENGU_1P15_SELFTEST_PASS",
    penguTargetGross: DISDEX_V96_ALLOCATION.penguTargetGross,
    v96CryptoSleeveGrossCap: DISDEX_V96_ALLOCATION.totalGrossCap,
    stockSleeveGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap,
    combinedPortfolioGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap,
    requiredExecutionLeverage: DISDEX_V96_RUNTIME.minimumExecutionLeverage,
    coreResidualGross: reservedAllocation.scaledCoreGross,
    pengu115PlusFirstStockGross: pengu115WithFirstStock.projectedPortfolioGross,
    availableSecondStockGross: 2.5 - pengu115WithFirstStock.projectedPortfolioGross,
    maximumCombinedGross: crypto150WithStock100.projectedPortfolioGross,
    ordersSent: false,
}));
