import assert from "node:assert/strict";
import test from "node:test";
import {
    markToMarketReducePosition,
    planStrictPortfolio,
    type StrictPortfolioIntent,
    type StrictPortfolioPosition,
} from "../lib/disdex-strict-portfolio-planner";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

type TestStrategy = StrictPortfolioPosition["strategy"] | "QUALITY102_CAUSAL_V1";

function position(input: {
    id: string;
    strategy: TestStrategy;
    symbol: string;
    quantity: number;
    entryPrice: number;
    markPrice: number;
    side?: "LONG" | "SHORT";
    entryTs?: number;
    updatedAt?: number;
    feeBpsPerSide?: number;
    fundingPerDay?: number;
    markSource?: "BINANCE_VISION_USDM_1M_OPEN" | "LIVE_MARKET_QUOTE";
    markSourceEvidence?: unknown;
}): StrictPortfolioPosition {
    const markSource = input.markSource ?? (input.strategy === "QUALITY102" ? "BINANCE_VISION_USDM_1M_OPEN" : input.strategy === "QUALITY102_CAUSAL_V1" ? "LIVE_MARKET_QUOTE" : undefined);
    return {
        side: input.side ?? "LONG",
        entryTs: input.entryTs ?? NOW - HOUR,
        updatedAt: input.updatedAt ?? NOW,
        feeBpsPerSide: input.feeBpsPerSide ?? 0,
        fundingPerDay: input.fundingPerDay ?? 0,
        markSource,
        markSourceEvidence: input.markSourceEvidence ?? (markSource === "LIVE_MARKET_QUOTE"
            ? { source: "LIVE_MARKET_QUOTE", timestamp: NOW, price: input.markPrice, crossChecked: true }
            : markSource === "BINANCE_VISION_USDM_1M_OPEN"
                ? { source: "BINANCE_VISION_USDM_1M_OPEN", timestamp: NOW, crossChecked: true }
                : undefined),
        ...input,
    } as unknown as StrictPortfolioPosition;
}

function intent(strategy: TestStrategy, gross: number, symbol = strategy === "V52" ? "NVDAUSDT" : strategy === "PENGU_DUAL_LS_V2" ? "PENGUUSDT" : "ETHUSDT"): StrictPortfolioIntent {
    return {
        idempotencyKey: `${strategy}-${symbol}-${gross}`,
        strategy,
        symbol,
        side: "LONG",
        gross,
        notionalUsd: gross * 1_000,
        signalTs: NOW,
    } as unknown as StrictPortfolioIntent;
}

function plan(active: StrictPortfolioPosition[], intents: StrictPortfolioIntent[], ready = true, maxDataAgeMs?: number) {
    return planStrictPortfolio({
        equity: 1_000,
        now: NOW,
        active,
        intents,
        maxDataAgeMs,
        quality102CausalV1Ready: ready,
    } as Parameters<typeof planStrictPortfolio>[0]);
}

function cryptoPosition(strategy: "V12" | "PENGU_DUAL_LS_V2", gross: number) {
    return position({
        id: `${strategy}-${gross}`,
        strategy,
        symbol: strategy === "V12" ? "ETHUSDT" : "PENGUUSDT",
        quantity: gross * 100,
        entryPrice: 10,
        markPrice: 10,
    });
}

test("causal-v1 requires readiness, is capped at 0.50x, and historical Quality102 stays blocked", () => {
    const notReady = plan([], [intent("QUALITY102_CAUSAL_V1", 0.5)], false);
    assert.equal(notReady.accepted.length, 0);
    assert.equal(notReady.rejected[0]?.reason, "QUALITY102_CAUSAL_V1_NOT_READY");

    const capped = plan([], [intent("QUALITY102_CAUSAL_V1", 0.51)]);
    assert.equal(capped.accepted[0]?.gross, 0.5);
    assert.equal(capped.accepted[0]?.notionalUsd, 500);

    const historical = plan([], [intent("QUALITY102", 0.5)]);
    assert.equal(historical.accepted.length, 0);
    assert.equal(historical.rejected[0]?.reason, "QUALITY102_LIVE_BLOCKED_FAIL_CLOSED");
});

test("causal-v1 participates in exact crypto and total Gross boundaries", () => {
    const crypto199 = plan([
        cryptoPosition("V12", 1.5),
        cryptoPosition("PENGU_DUAL_LS_V2", 0.49),
    ], [intent("QUALITY102_CAUSAL_V1", 0.01)]);
    assert.equal(crypto199.totals.cryptoGross, 2);

    const crypto200 = plan([
        cryptoPosition("V12", 1.5),
        cryptoPosition("PENGU_DUAL_LS_V2", 0.5),
    ], [intent("QUALITY102_CAUSAL_V1", 0.01)]);
    assert.equal(crypto200.rejected[0]?.reason, "CRYPTO_GROSS_CAP");

    const crypto201 = plan([
        cryptoPosition("V12", 1.5),
        cryptoPosition("PENGU_DUAL_LS_V2", 0.51),
    ], [intent("QUALITY102_CAUSAL_V1", 0.01)]);
    assert.equal(crypto201.status, "blocked");

    const total249 = plan([
        cryptoPosition("V12", 1),
        position({ id: "stock-149", strategy: "V52", symbol: "NVDAUSDT", quantity: 149, entryPrice: 10, markPrice: 10 }),
    ], [intent("QUALITY102_CAUSAL_V1", 0.01)]);
    assert.equal(total249.totals.totalGross, 2.5);

    const total250 = plan([
        cryptoPosition("V12", 1),
        position({ id: "stock-150", strategy: "V52", symbol: "NVDAUSDT", quantity: 150, entryPrice: 10, markPrice: 10 }),
    ], [intent("QUALITY102_CAUSAL_V1", 0.01)]);
    assert.equal(total250.rejected[0]?.reason, "TOTAL_GROSS_CAP");

    const total251 = plan([
        cryptoPosition("V12", 1.1),
        position({ id: "stock-141", strategy: "V52", symbol: "NVDAUSDT", quantity: 141, entryPrice: 10, markPrice: 10 }),
    ], [intent("QUALITY102_CAUSAL_V1", 0.01)]);
    assert.equal(total251.status, "blocked");
});

test("base strategies retain priority when causal-v1 is simultaneous", () => {
    const baseIntents = [
        intent("V12", 1.5),
        intent("PENGU_DUAL_LS_V2", 0.75),
        intent("V52", 1.5),
    ];
    const baseOnly = plan([], baseIntents);
    const simultaneous = plan([], [intent("QUALITY102_CAUSAL_V1", 0.5), ...baseIntents]);

    assert.deepEqual(
        simultaneous.accepted.map(({ strategy, gross }) => [strategy, gross]),
        baseOnly.accepted.map(({ strategy, gross }) => [strategy, gross]),
    );
    assert.equal(simultaneous.rejected.find(({ intent: row }) => row.strategy === "QUALITY102_CAUSAL_V1")?.reason, "TOTAL_GROSS_CAP");
});

test("causal-v1 owns one planner slot", () => {
    const occupied = plan([
        position({ id: "q102v1", strategy: "QUALITY102_CAUSAL_V1", symbol: "SOLUSDT", quantity: 1, entryPrice: 100, markPrice: 100 }),
    ], [intent("QUALITY102_CAUSAL_V1", 0.5, "BTCUSDT")]);

    assert.equal(occupied.status, "planned");
    assert.equal(occupied.accepted.length, 0);
    assert.equal(occupied.rejected[0]?.reason, "QUALITY102_CAUSAL_V1_SLOT_OCCUPIED");
});

test("causal-v1 live-quote MTM realizes Long and Short PnL exactly once", () => {
    const cases = [
        { side: "LONG" as const, markPrice: 110, realizedPnl: 39.2 },
        { side: "LONG" as const, markPrice: 90, realizedPnl: -40.8 },
        { side: "SHORT" as const, markPrice: 90, realizedPnl: 39.2 },
        { side: "SHORT" as const, markPrice: 110, realizedPnl: -40.8 },
    ];

    for (const fixture of cases) {
        const reduction = markToMarketReducePosition({
            position: position({
                id: `q102v1-${fixture.side}-${fixture.markPrice}`,
                strategy: "QUALITY102_CAUSAL_V1",
                symbol: "SOLUSDT",
                side: fixture.side,
                quantity: 10,
                entryPrice: 100,
                markPrice: fixture.markPrice,
                feeBpsPerSide: 10,
            }),
            reduceQuantity: 4,
            markPrice: fixture.markPrice,
            markTs: NOW,
            feeBpsPerSide: 10,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: NOW, price: fixture.markPrice, crossChecked: true },
        });

        assert.ok(Math.abs(reduction.realizedPnl - fixture.realizedPnl) < 1e-9);
        assert.equal(reduction.transactionCost, 0.8);
        assert.equal(reduction.remainingQuantity, 6);
        assert.equal(reduction.remainingEntryPrice, 100);
        assert.equal(reduction.markPrice, fixture.markPrice);
        assert.equal(reduction.remainingNotionalUsd, 6 * fixture.markPrice);
        assert.equal(reduction.remainingPosition?.entryPrice, 100);
        assert.equal(reduction.remainingPosition?.markPrice, fixture.markPrice);
    }
});

test("base planning reduces causal-v1 before reserving stock capacity and recalculates Gross", () => {
    for (const [side, markPrice] of [
        ["LONG", 110],
        ["SHORT", 90],
        ["LONG", 90],
        ["SHORT", 110],
    ] as const) {
        const result = plan([
            cryptoPosition("V12", 1),
            position({
                id: `q102v1-${side}-${markPrice}`,
                strategy: "QUALITY102_CAUSAL_V1",
                symbol: "SOLUSDT",
                side,
                quantity: 4,
                entryPrice: 100,
                markPrice,
                feeBpsPerSide: 10,
            }),
        ], [intent("V52", 1.5)]);

        assert.equal(result.status, "planned");
        assert.equal(result.accepted[0]?.strategy, "V52");
        assert.equal(result.reductions.length, 1);
        assert.equal(result.reductions[0]?.strategy, "QUALITY102_CAUSAL_V1");
        assert.ok(result.reductions[0]!.reducedQuantity > 0);
        assert.ok(result.reductions[0]!.reducedQuantity <= 4 + 1e-9);
        assert.equal(result.reductions[0]?.markTs, NOW);
        assert.equal(result.reductions[0]?.markPrice, markPrice);
        assert.equal(result.reductions[0]?.remainingEntryPrice, 100);
        const remaining = result.activePositions.find((row) => row.strategy === "QUALITY102_CAUSAL_V1");
        if (result.reductions[0]!.remainingQuantity > 0) {
            assert.equal(remaining?.quantity, result.reductions[0]!.remainingQuantity);
        } else {
            assert.equal(remaining, undefined);
        }
        assert.ok(result.totals.cryptoGross <= 2 + 1e-9);
        assert.ok(result.totals.totalGross <= 2.5 + 1e-9);
        assert.ok(Math.abs(result.equityAfterReductions - (1_000 + result.reductions[0]!.realizedPnl)) < 1e-9);
    }
});

test("causal-v1 MTM rejects an unverified mark source", () => {
    assert.throws(() => markToMarketReducePosition({
        position: position({
            id: "q102v1-unverified",
            strategy: "QUALITY102_CAUSAL_V1",
            symbol: "SOLUSDT",
            quantity: 10,
            entryPrice: 100,
            markPrice: 100,
            markSource: undefined,
            markSourceEvidence: undefined,
        }),
        reduceQuantity: 1,
        markPrice: 100,
        markTs: NOW,
    }), /QUALITY102_CAUSAL_V1_MTM_SOURCE_UNVERIFIED/);
});

test("causal-v1 MTM requires cross-checked live evidence and one validation/reduction timestamp", () => {
    assert.throws(() => markToMarketReducePosition({
        position: position({
            id: "q102v1-missing-live-evidence",
            strategy: "QUALITY102_CAUSAL_V1",
            symbol: "SOLUSDT",
            quantity: 10,
            entryPrice: 100,
            markPrice: 100,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: undefined,
        }),
        reduceQuantity: 1,
        markPrice: 100,
        markTs: NOW,
        markSource: "LIVE_MARKET_QUOTE",
    }), /QUALITY102_CAUSAL_V1_MTM_SOURCE_UNVERIFIED/);

    assert.throws(() => markToMarketReducePosition({
        position: position({
            id: "q102v1-unchecked-live-evidence",
            strategy: "QUALITY102_CAUSAL_V1",
            symbol: "SOLUSDT",
            quantity: 10,
            entryPrice: 100,
            markPrice: 100,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: NOW, crossChecked: false },
        }),
        reduceQuantity: 1,
        markPrice: 100,
        markTs: NOW,
        markSource: "LIVE_MARKET_QUOTE",
    }), /QUALITY102_CAUSAL_V1_MTM_SOURCE_UNVERIFIED/);

    const timestampMismatch = plan([
        position({
            id: "q102v1-live-timestamp-mismatch",
            strategy: "QUALITY102_CAUSAL_V1",
            symbol: "SOLUSDT",
            quantity: 4,
            entryPrice: 100,
            markPrice: 100,
            updatedAt: NOW,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: NOW - 60_000, price: 100, crossChecked: true },
        }),
    ], [intent("V52", 1.5)]);
    assert.equal(timestampMismatch.status, "blocked");
    assert.equal(timestampMismatch.reason, "QUALITY102_CAUSAL_V1_MTM_SOURCE_UNVERIFIED");
});

test("causal-v1 MTM rejects a live quote whose evidence price differs from the reduction mark", () => {
    assert.throws(() => markToMarketReducePosition({
        position: position({
            id: "q102v1-price-mismatch",
            strategy: "QUALITY102_CAUSAL_V1",
            symbol: "SOLUSDT",
            quantity: 10,
            entryPrice: 100,
            markPrice: 100,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: NOW, price: 90, crossChecked: true },
        }),
        reduceQuantity: 1,
        markPrice: 100,
        markTs: NOW,
        markSource: "LIVE_MARKET_QUOTE",
    }), /QUALITY102_CAUSAL_V1_MTM_SOURCE_UNVERIFIED/);
});

test("causal-v1 loss rechecks V12 and PENGU strategy caps after equity changes", () => {
    for (const fixture of [
        { strategy: "V12" as const, notional: 1_490, expectedReason: "V12_GROSS_OVER_CAP_AFTER_MTM" },
        { strategy: "PENGU_DUAL_LS_V2" as const, notional: 749, expectedReason: "PENGU_GROSS_OVER_CAP_AFTER_MTM" },
    ]) {
        const result = plan([
            position({
                id: `base-${fixture.strategy}`,
                strategy: fixture.strategy,
                symbol: fixture.strategy === "V12" ? "ETHUSDT" : "PENGUUSDT",
                quantity: fixture.notional / 10,
                entryPrice: 10,
                markPrice: 10,
            }),
            position({
                id: `q102v1-loss-${fixture.strategy}`,
                strategy: "QUALITY102_CAUSAL_V1",
                symbol: "SOLUSDT",
                quantity: 5,
                entryPrice: 100,
                markPrice: 90,
                feeBpsPerSide: 10,
            }),
        ], [intent("V52", 1.5)]);

        assert.equal(result.status, "blocked");
        assert.equal(result.reason, fixture.expectedReason);
        assert.equal(result.accepted.length, 0);
        assert.equal(result.reductions.length, 0);
    }
});

test("historical QUALITY102 is never selected for causal conflict reduction", () => {
    const result = plan([
        position({
            id: "historical-q102",
            strategy: "QUALITY102",
            symbol: "SOLUSDT",
            quantity: 50,
            entryPrice: 10,
            markPrice: 10,
        }),
    ], [
        intent("V12", 1.5),
        intent("PENGU_DUAL_LS_V2", 0.75),
        intent("V52", 1.5),
    ]);

    assert.equal(result.status, "planned");
    assert.equal(result.reductions.length, 0);
    assert.equal(result.reductions.some(({ strategy }) => strategy === "QUALITY102"), false);
    assert.equal(result.activePositions.find((row) => row.strategy === "QUALITY102")?.quantity, 50);
    assert.deepEqual(
        result.accepted.map(({ strategy, gross }) => [strategy, gross]),
        [["V52", 1.5], ["PENGU_DUAL_LS_V2", 0.5]],
    );
    assert.equal(result.rejected.find(({ intent: row }) => row.strategy === "V12")?.reason, "CAPACITY_BLOCKED");
});

test("V12 slot rejection happens before causal-v1 MTM reduction", () => {
    const result = plan([
        cryptoPosition("V12", 1.5),
        position({
            id: "q102v1-slot-conflict",
            strategy: "QUALITY102_CAUSAL_V1",
            symbol: "SOLUSDT",
            quantity: 500 / 90,
            entryPrice: 100,
            markPrice: 90,
            feeBpsPerSide: 10,
        }),
    ], [intent("V12", 0.5)]);

    assert.equal(result.status, "planned");
    assert.equal(result.accepted.length, 0);
    assert.equal(result.rejected[0]?.reason, "V12_SLOT_OCCUPIED_NO_PREEMPTION");
    assert.equal(result.reductions.length, 0);
    assert.equal(result.activePositions.find((row) => row.strategy === "QUALITY102_CAUSAL_V1")?.quantity, 500 / 90);
});
