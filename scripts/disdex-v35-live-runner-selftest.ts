import assert from "node:assert/strict";
import { buildDisDexV35Signal, type DisDexPenguRule, type DisDexV35Candle, type DisDexV35MarketHistory } from "../lib/disdex-v35-signal-engine";
import { buildDisDexV35RebalanceActions } from "../lib/disdex-v35-portfolio-runner";
import type { DirectAccountSnapshot, DirectMarketQuote, DirectPosition } from "../lib/direct-trade-executor";

const HOUR = 3_600_000;
const BAR12 = 12 * HOUR;
const START = 1_704_067_200_000;

function series(input: { count: number; interval: number; startPrice: number; growth: number; volumeGrowth?: number }): DisDexV35Candle[] {
    return Array.from({ length: input.count }, (_, index) => {
        const open = input.startPrice * Math.exp(input.growth * index);
        const close = input.startPrice * Math.exp(input.growth * (index + 1));
        return {
            openTime: START + index * input.interval,
            closeTime: START + (index + 1) * input.interval - 1,
            open,
            high: Math.max(open, close) * 1.003,
            low: Math.min(open, close) * 0.997,
            close,
            volume: 1_000_000 * (1 + (input.volumeGrowth || 0) * index),
        };
    });
}

function history(direction: 1 | -1): DisDexV35MarketHistory {
    const sign = direction;
    return {
        core12h: {
            BTCUSDT: series({ count: 400, interval: BAR12, startPrice: 30_000, growth: sign * 0.004 }),
            ETHUSDT: series({ count: 400, interval: BAR12, startPrice: 2_000, growth: sign * 0.0055, volumeGrowth: 0.001 }),
            BNBUSDT: series({ count: 400, interval: BAR12, startPrice: 300, growth: sign * 0.0048, volumeGrowth: 0.0008 }),
            SOLUSDT: series({ count: 400, interval: BAR12, startPrice: 50, growth: sign * 0.0065, volumeGrowth: 0.0012 }),
        },
        btc1h: series({ count: 1000, interval: HOUR, startPrice: 30_000, growth: sign * 0.0003 }),
        pengu1h: series({ count: 1000, interval: HOUR, startPrice: 0.01, growth: sign * 0.0006, volumeGrowth: 0.0005 }),
    };
}

const disabledRule: DisDexPenguRule = {
    id: "DISABLED",
    family: "TREND",
    fast: 24,
    slow: 168,
    threshold: 1,
    volumeFloor: 0,
    btcFilter: "NONE",
    decisionHours: 6,
    holdHours: 72,
    enabled: false,
};

const bullHistory = history(1);
const bull = buildDisDexV35Signal(bullHistory, disabledRule, bullHistory.core12h.BTCUSDT.at(-1)!.closeTime + 1);
assert.equal(bull.regime, "BULL");
assert.ok(Object.values(bull.targetWeights).some((weight) => Number(weight) > 0));
assert.ok(bull.allocation.finalGross <= 2 + 1e-12);
assert.ok(["STRONG_BULL", "NORMAL_BULL"].includes(bull.allocation.state));

const bearHistory = history(-1);
const bear = buildDisDexV35Signal(bearHistory, disabledRule, bearHistory.core12h.BTCUSDT.at(-1)!.closeTime + 1);
assert.equal(bear.regime, "BEAR");
assert.ok(Number(bear.targetWeights.BTCUSDT) < 0);
assert.equal(bear.allocation.coreMultiplier, 1);

const penguRule: DisDexPenguRule = {
    id: "TEST_TREND",
    family: "TREND",
    fast: 24,
    slow: 168,
    threshold: 0,
    volumeFloor: 0,
    btcFilter: "NONE",
    decisionHours: 6,
    holdHours: 72,
    enabled: true,
};
const penguNow = bullHistory.pengu1h.at(-25)!.openTime;
const penguSignal = buildDisDexV35Signal(bullHistory, penguRule, penguNow);
assert.ok([0, 1].includes(penguSignal.penguSide));
if (penguSignal.penguSide) {
    assert.ok((penguSignal.penguExitTs || 0) > penguNow);
    assert.ok(Number(penguSignal.targetWeights.PENGUUSDT) > 0);
}

const account: DirectAccountSnapshot = { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: Date.now() };
function quote(symbol: string, price: number): DirectMarketQuote {
    return { symbol, bidPrice: price * 0.9999, askPrice: price * 1.0001, bidQuantity: 1000, askQuantity: 1000, midPrice: price, spreadBps: 2, updatedAt: Date.now() };
}
const quotes = {
    BTCUSDT: quote("BTCUSDT", 50_000),
    ETHUSDT: quote("ETHUSDT", 2_000),
    BNBUSDT: quote("BNBUSDT", 500),
    SOLUSDT: quote("SOLUSDT", 100),
    PENGUUSDT: quote("PENGUUSDT", 0.02),
    DOGEUSDT: quote("DOGEUSDT", 0.2),
};
const config = { cashReservePct: 0, maxGross: 2, minOrderNotionalUsd: 5, rebalanceTolerancePct: 0.1, closeUnmanagedPositions: true };

const open = buildDisDexV35RebalanceActions({ account, positions: [], quotes, targetWeights: { ETHUSDT: 0.8 }, config });
assert.equal(open.actions[0].symbol, "ETHUSDT");
assert.equal(open.actions[0].side, "BUY");
assert.equal(open.actions[0].reduceOnly, false);

const longPosition: DirectPosition = {
    symbol: "BTCUSDT", quantity: 0.02, entryPrice: 50_000, markPrice: 50_000, unrealizedPnl: 0,
    pnlPct: 0, notionalUsd: 1000, positionSide: "BOTH", leverage: 2, updatedAt: Date.now(),
};
const flip = buildDisDexV35RebalanceActions({ account, positions: [longPosition], quotes, targetWeights: { BTCUSDT: -0.4 }, config });
assert.equal(flip.actions[0].symbol, "BTCUSDT");
assert.equal(flip.actions[0].side, "SELL");
assert.equal(flip.actions[0].reduceOnly, true);
assert.ok(Math.abs(flip.actions[0].quantity - 0.02) < 1e-12);

const shortPosition: DirectPosition = { ...longPosition, quantity: -0.02, positionSide: "BOTH" };
const reduceShort = buildDisDexV35RebalanceActions({ account, positions: [shortPosition], quotes, targetWeights: { BTCUSDT: -0.4 }, config });
assert.equal(reduceShort.actions[0].side, "BUY");
assert.equal(reduceShort.actions[0].reduceOnly, true);

const oldPosition: DirectPosition = {
    ...longPosition,
    symbol: "DOGEUSDT",
    quantity: 1000,
    markPrice: 0.2,
    entryPrice: 0.2,
    notionalUsd: 200,
};
const cleanOld = buildDisDexV35RebalanceActions({ account, positions: [oldPosition], quotes, targetWeights: {}, config });
assert.equal(cleanOld.actions[0].symbol, "DOGEUSDT");
assert.equal(cleanOld.actions[0].side, "SELL");
assert.equal(cleanOld.actions[0].reduceOnly, true);

console.log("DISDEX_V35_LIVE_RUNNER_SELFTEST_OK");
