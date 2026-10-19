import assert from "node:assert/strict";
import { test } from "node:test";

import {
    reconcileLifecycle,
    replayIntegrated,
    reserveCandidate,
    type CandidateReservationState,
    type CandidateDecisionWithExecution,
    type ExecutionLifecycleEvent,
    type PortfolioRuntimeState,
    type ReplayConfigWithRuntime,
} from "../lib/backtest/dd-reduction/emulator";
import {
    applyProtectionPolicy,
    type PositionLifecycleWithProtection,
    type ProtectionPolicyInput,
} from "../lib/backtest/dd-reduction/protection";
import type {
    CandidateDecision,
    BaselineLedgerEntry,
    CanonicalSource,
    ExecutionBar,
    ExecutionFill,
    PositionLifecycle,
} from "../lib/backtest/dd-reduction/types";

const HASH = "a".repeat(64);

function fill(price: number, quantity: number, ts = 1_700_000_000_000): ExecutionFill {
    return {
        sourceHash: HASH,
        ts,
        price,
        quantity,
        gross: price * quantity,
        fee: 0,
        funding: 0,
        slippage: 0,
        reason: "fixture-entry",
    };
}

function bar(overrides: Partial<ExecutionBar> = {}): ExecutionBar {
    return {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        symbol: "BTCUSDT",
        timeframe: "1h",
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
        ...overrides,
    };
}

function candidate(overrides: Partial<CandidateDecisionWithExecution> = {}): CandidateDecision {
    return {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 100,
        acceptedGross: 100,
        reservation: null,
        fill: null,
        exit: null,
        reason: "fixture-candidate",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        candidateId: "candidate-1",
        accepted: true,
        rejectionReason: null,
        ...overrides,
    };
}

function state(overrides: Partial<PortfolioRuntimeState> = {}): PortfolioRuntimeState {
    return {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        cash: 1_000,
        equity: 1_000,
        reservedGross: 100,
        acceptedGross: 700,
        pendingGross: 100,
        positions: [],
        events: [],
        reason: "fixture-state",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        caps: { totalGross: 1_000, cryptoGross: 1_000, strategyGross: 1_000 },
        grossBySymbol: { BTCUSDT: 700 },
        grossByStrategy: { V12_V4: 700 },
        reservedCandidateIds: [],
        intentLedger: {},
        eventOrdering: ["STOP", "NORMAL_EXIT"],
        manualReview: [],
        protectionReadback: true,
        ...overrides,
    };
}

function policy(direction: "LONG" | "SHORT"): ProtectionPolicyInput {
    return {
        policyHash: HASH,
        configHash: HASH,
        strategy: "V12_V4",
        direction,
        initialStopBps: 500,
        profitActivationBps: 100,
        profitFloorBps: 20,
        trailActivationBps: 200,
        trailRetraceBps: 50,
        timeStopBars: null,
        tickSize: 0.1,
    };
}

function position(overrides: Partial<PositionLifecycleWithProtection> = {}): PositionLifecycleWithProtection {
    const base: PositionLifecycle = {
        sourceHash: HASH,
        positionId: "leg-1",
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        entryFill: fill(100, 10),
        exit: null,
        reason: "fixture-position",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        events: [],
    };
    return {
        ...base,
        remainingQuantity: 10,
        protectedQuantity: 10,
        protection: null,
        ...overrides,
    };
}

function replaySource(
    bars: readonly ExecutionBar[],
    candidates: readonly CandidateDecision[] = [],
    baselineLedger: readonly BaselineLedgerEntry[] = [],
): CanonicalSource {
    const seriesBySymbol = new Map<string, ExecutionBar[]>();
    for (const marketBar of bars) {
        const symbolBars = seriesBySymbol.get(marketBar.symbol) ?? [];
        symbolBars.push(marketBar);
        seriesBySymbol.set(marketBar.symbol, symbolBars);
    }
    const firstTs = Math.min(...bars.map((marketBar) => marketBar.ts));
    const lastTs = Math.max(...bars.map((marketBar) => marketBar.ts));
    return {
        input: {
            sourceRoot: "fixture-source",
            dataRoot: "fixture-data",
            productionSha: HASH,
            startTs: firstTs,
            endTs: lastTs,
            initialEquity: 1_000,
            deposits: [],
            feeBps: 0,
            slippageBps: 0,
            fundingSource: "fixture",
        },
        productionSha: HASH,
        productionFiles: [],
        sourceFiles: [],
        productionSources: [],
        strategyConfigs: [],
        candleSeries: [...seriesBySymbol.entries()].map(([symbol, symbolBars]) => ({ sourceHash: HASH, symbol, timeframe: "1h", bars: symbolBars })),
        funding: [],
        baselineLedger,
        candidateEvents: candidates,
        sourceHashes: [],
    };
}

function replayConfig(overrides: Partial<ReplayConfigWithRuntime> = {}): ReplayConfigWithRuntime {
    return {
        sourceHash: HASH,
        configHash: HASH,
        startTs: 1_700_000_000_000,
        endTs: 1_700_010_000_000,
        initialEquity: 1_000,
        feeBps: 0,
        slippageBps: 0,
        fundingSource: "fixture",
        policyHash: HASH,
        caps: { totalGross: 10_000, cryptoGross: 10_000, strategyGross: 10_000 },
        protectionReadback: true,
        ...overrides,
    };
}

test("rejects a candidate whose worst-case fill breaches the total Gross cap", () => {
    const result = reserveCandidate(state(), candidate({ requestedGross: 150, acceptedGross: 150 }));

    assert.equal(result.accepted, false);
    assert.match(result.reason, /GROSS_CAP/);
    assert.equal(result.state.reservedGross, 100);
    assert.equal(result.state.pendingGross, 100);
});

test("does not double-use pending or reserved Gross and is idempotent by candidate intent", () => {
    const initial = state({ acceptedGross: 400, reservedGross: 100, pendingGross: 50, grossBySymbol: { BTCUSDT: 400 }, grossByStrategy: { V12_V4: 400 } });
    const first = reserveCandidate(initial, candidate({ requestedGross: 100, acceptedGross: 100 }));
    const duplicate = reserveCandidate(first.state, candidate({ requestedGross: 100, acceptedGross: 100 }));

    assert.equal(first.accepted, true);
    assert.equal(first.state.reservedGross, 200);
    assert.equal(duplicate.accepted, false);
    assert.match(duplicate.reason, /IDEMPOTENT/);
    assert.equal(duplicate.state.reservedGross, 200);
});

test("computes conservative initial stops and profit floors in opposite LONG and SHORT directions", () => {
    const longInitial = applyProtectionPolicy(position(), policy("LONG"), bar());
    const shortInitial = applyProtectionPolicy(position({ direction: "SHORT" }), policy("SHORT"), bar());
    const longProfit = applyProtectionPolicy(position({ protection: longInitial.protection }), policy("LONG"), bar({ high: 103, low: 99, close: 102 }));
    const shortProfit = applyProtectionPolicy(position({ direction: "SHORT", protection: shortInitial.protection }), policy("SHORT"), bar({ high: 101, low: 97, close: 98 }));

    assert.equal(longInitial.stopPrice, 95);
    assert.equal(shortInitial.stopPrice, 105);
    assert.equal(longProfit.protection?.profitFloorPrice, 100.2);
    assert.equal(shortProfit.protection?.profitFloorPrice, 99.8);
    assert.ok(longProfit.stopPrice > 100);
    assert.ok(shortProfit.stopPrice < 100);
});

test("persists MFE activation and records profit-floor/trail giveback", () => {
    const initial = applyProtectionPolicy(position(), policy("LONG"), bar());
    const activated = applyProtectionPolicy(
        position({ protection: initial.protection }),
        policy("LONG"),
        bar({ ts: 1_700_003_600_000, high: 103, low: 99, close: 102 }),
    );
    const giveback = applyProtectionPolicy(
        position({ protection: activated.protection }),
        policy("LONG"),
        bar({ ts: 1_700_007_200_000, high: 103, low: 100, close: 100.5 }),
    );

    assert.equal(activated.protection?.activated, true);
    assert.equal(activated.protection?.mfeBps, 300);
    assert.equal(activated.protection?.profitFloorPrice, 100.2);
    assert.equal(giveback.trigger, "TRAIL");
    assert.ok(giveback.protection?.givebackBps > 0);
    assert.ok(giveback.protection?.trailPrice !== null);
    assert.match(giveback.events.map((event) => event.kind).join(","), /GIVEBACK/);
});

test("applies deterministic STOP-before-normal-EXIT ordering on one bar", () => {
    const first = reconcileLifecycle(
        state({ eventOrdering: ["STOP", "NORMAL_EXIT"], positions: [position()] }),
        {
            sourceHash: HASH,
            ts: 1_700_000_000_000,
            strategy: "V12_V4",
            direction: "LONG",
            symbol: "BTCUSDT",
            requestedGross: 1_000,
            acceptedGross: 1_000,
            reservation: null,
            fill: null,
            exit: null,
            reason: "same-bar-stop",
            fee: 0,
            funding: 0,
            slippage: 0,
            policyHash: HASH,
            configHash: HASH,
            resultHash: HASH,
            eventId: "stop-1",
            eventType: "EXIT",
            positionId: "leg-1",
            executionKind: "STOP",
            clientOrderId: "stop-intent-1",
            quantity: 10,
            price: 95,
            executionStatus: "FILLED",
        },
    );
    const second = reconcileLifecycle(first, {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "same-bar-normal-exit",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "exit-1",
        eventType: "EXIT",
        positionId: "leg-1",
        executionKind: "NORMAL_EXIT",
        clientOrderId: "exit-intent-1",
        quantity: 10,
        price: 101,
        executionStatus: "FILLED",
    });

    assert.equal(second.events[0]?.eventId, "stop-1");
    assert.equal(second.events[1]?.eventId, "exit-1");
    assert.equal(second.positions.find((entry) => entry.positionId === "leg-1")?.exit?.reason, "same-bar-stop");
});

test("reprotects only the residual quantity after a partial protective fill", () => {
    const initial = state({ positions: [position(), position({ positionId: "leg-2", direction: "SHORT" })] });
    const next = reconcileLifecycle(initial, {
        sourceHash: HASH,
        ts: 1_700_003_600_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "protective-partial-fill",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "stop-partial-1",
        eventType: "PARTIAL_FILL",
        positionId: "leg-1",
        executionKind: "STOP",
        clientOrderId: "stop-intent-1",
        quantity: 4,
        price: 95,
        executionStatus: "PARTIAL_FILLED",
    });
    assert.equal(next.positions.find((entry) => entry.positionId === "leg-1")?.remainingQuantity, 6);
    assert.equal(next.positions.find((entry) => entry.positionId === "leg-1")?.protection?.reprotectQuantity, 6);
    assert.equal(next.positions.find((entry) => entry.positionId === "leg-2")?.remainingQuantity, 10);
    assert.equal(next.positions.find((entry) => entry.positionId === "leg-2")?.exit, null);
});

test("reconciles restart execution, deduplicates the same event id, and fails closed on unknown status", () => {
    const existing = state({ intentLedger: { "stop-intent-1": "FILLED" }, positions: [position()] });
    const recoveredEvent: ExecutionLifecycleEvent = {
        sourceHash: HASH,
        ts: 1_700_003_600_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "restart-recovery",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "recovered-stop-1",
        eventType: "PROTECTION",
        positionId: "leg-1",
        executionKind: "STOP",
        clientOrderId: "stop-intent-1",
        quantity: 10,
        price: 95,
        executionStatus: "FILLED",
    };
    const duplicate = reconcileLifecycle(existing, recoveredEvent);
    const replayed = reconcileLifecycle(duplicate, recoveredEvent);
    const unknown = reconcileLifecycle(replayed, {
        sourceHash: HASH,
        ts: 1_700_007_200_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "venue-ambiguous",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "unknown-1",
        eventType: "PROTECTION",
        positionId: "leg-1",
        executionKind: "STOP",
        clientOrderId: "stop-intent-2",
        quantity: 10,
        executionStatus: "UNKNOWN",
    });

    assert.equal(duplicate.events.length, existing.events.length + 1);
    assert.equal(replayed.events.length, duplicate.events.length);
    assert.equal(unknown.manualReview.length, 1);
    assert.match(unknown.manualReview[0] ?? "", /UNKNOWN_EXECUTION/);
    assert.equal(unknown.positions[0]?.exit?.reason, "restart-recovery");
});

test("does not confirm new exposure when protective-order read-back is unavailable", () => {
    const stateWithoutReadback = {
        ...state({ acceptedGross: 400, reservedGross: 100, pendingGross: 50 }),
        protectionReadback: false,
    } as CandidateReservationState & { readonly protectionReadback: boolean };
    const result = reserveCandidate(stateWithoutReadback, candidate({ requestedGross: 100, acceptedGross: 100 }));

    assert.equal(result.accepted, false);
    assert.match(result.reason, /PROTECTION_READBACK_REQUIRED/);
    assert.equal(result.state.reservedGross, 100);
});

test("integrated replay converts a reserved candidate fill into a resident position", () => {
    const source: CanonicalSource = {
        input: {
            sourceRoot: "fixture-source",
            dataRoot: "fixture-data",
            productionSha: HASH,
            startTs: 1_700_000_000_000,
            endTs: 1_700_003_600_000,
            initialEquity: 1_000,
            deposits: [],
            feeBps: 0,
            slippageBps: 0,
            fundingSource: "fixture",
        },
        productionSha: HASH,
        productionFiles: [],
        sourceFiles: [],
        productionSources: [],
        strategyConfigs: [],
        candleSeries: [{ sourceHash: HASH, symbol: "BTCUSDT", timeframe: "1h", bars: [bar()] }],
        funding: [],
        baselineLedger: [],
        candidateEvents: [candidate({ acceptedGross: 200, requestedGross: 200, fill: fill(100, 2) })],
        sourceHashes: [],
    };
    const config: ReplayConfigWithRuntime = {
        sourceHash: HASH,
        configHash: HASH,
        startTs: 1_700_000_000_000,
        endTs: 1_700_003_600_000,
        initialEquity: 1_000,
        feeBps: 0,
        slippageBps: 0,
        fundingSource: "fixture",
        policyHash: HASH,
        caps: { totalGross: 1_000, cryptoGross: 1_000, strategyGross: 1_000 },
        protectionReadback: true,
    };
    const replay = replayIntegrated(source, config);

    assert.equal(replay.decisionLedger.length, 1);
    assert.equal(replay.reservationLedger.length, 1);
    assert.equal(replay.positions[0]?.entryFill?.quantity, 2);
    assert.equal(replay.portfolio.at(-1)?.reservedGross, 0);
    assert.equal(replay.portfolio.at(-1)?.acceptedGross, 200);
});

test("normalizes worst-case Gross upward to requested and accepted amounts", () => {
    const result = reserveCandidate(
        state({
            acceptedGross: 50,
            reservedGross: 0,
            pendingGross: 0,
            caps: { totalGross: 120, cryptoGross: 1_000, strategyGross: 1_000 },
            grossBySymbol: { BTCUSDT: 50 },
            grossByStrategy: { V12_V4: 50 },
        }),
        candidate({ requestedGross: 100, acceptedGross: 100, worstCaseGross: 1 }),
    );

    assert.equal(result.accepted, false);
    assert.match(result.reason, /GROSS_CAP_TOTAL/);
});

test("does not charge aggregate pending or reserved Gross to unrelated symbol and strategy buckets", () => {
    const result = reserveCandidate(
        state({
            acceptedGross: 0,
            reservedGross: 100,
            pendingGross: 100,
            caps: { totalGross: 1_000, cryptoGross: 100, strategyGross: 100 },
            grossBySymbol: {},
            grossByStrategy: {},
        }),
        candidate({ symbol: "ETHUSDT", strategy: "PENGU", requestedGross: 100, acceptedGross: 100 }),
    );

    assert.equal(result.accepted, true);
});

test("fails closed when protective-order read-back is missing or undefined", () => {
    const { protectionReadback: _readback, ...stateWithoutReadback } = state();
    const result = reserveCandidate(stateWithoutReadback, candidate());

    assert.equal(result.accepted, false);
    assert.match(result.reason, /PROTECTION_READBACK_REQUIRED/);
});

test("reorders same-timestamp events so STOP wins even when normal EXIT arrives first", () => {
    const normalFirst = reconcileLifecycle(state({ positions: [position()] }), {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "same-bar-normal-first",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "normal-first",
        eventType: "EXIT",
        positionId: "leg-1",
        executionKind: "NORMAL_EXIT",
        clientOrderId: "normal-first-intent",
        quantity: 10,
        price: 101,
        executionStatus: "FILLED",
    });
    const stopSecond = reconcileLifecycle(normalFirst, {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "same-bar-stop-second",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "stop-second",
        eventType: "EXIT",
        positionId: "leg-1",
        executionKind: "STOP",
        clientOrderId: "stop-second-intent",
        quantity: 10,
        price: 95,
        executionStatus: "FILLED",
    });

    assert.deepEqual(stopSecond.events.slice(0, 2).map((event) => event.eventId), ["stop-second", "normal-first"]);
    assert.equal(stopSecond.positions[0]?.exit?.reason, "same-bar-stop-second");
});

test("fails closed for FILLED execution with invalid quantity or price without completing intent", () => {
    const result = reconcileLifecycle(state({ positions: [position()] }), {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "invalid-fill",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "invalid-fill-1",
        eventType: "EXIT",
        positionId: "leg-1",
        executionKind: "STOP",
        clientOrderId: "invalid-fill-intent",
        quantity: 0,
        price: Number.NaN,
        executionStatus: "FILLED",
    });

    assert.equal(result.events.length, 0);
    assert.equal(result.intentLedger["invalid-fill-intent"], undefined);
    assert.equal(result.manualReview.length, 1);
    assert.equal(result.positions[0]?.exit, null);
});

test("accumulates partial fills with the same client order intent when event ids differ", () => {
    const first = reconcileLifecycle(state({ positions: [position()] }), {
        sourceHash: HASH,
        ts: 1_700_000_000_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "partial-one",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "partial-one",
        eventType: "PARTIAL_FILL",
        positionId: "leg-1",
        executionKind: "STOP",
        clientOrderId: "shared-stop-intent",
        quantity: 4,
        price: 95,
        executionStatus: "PARTIAL_FILLED",
    });
    const second = reconcileLifecycle(first, {
        sourceHash: HASH,
        ts: 1_700_003_600_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "partial-two",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "partial-two",
        eventType: "PARTIAL_FILL",
        positionId: "leg-1",
        executionKind: "STOP",
        clientOrderId: "shared-stop-intent",
        quantity: 3,
        price: 95,
        executionStatus: "PARTIAL_FILLED",
    });

    assert.equal(second.events.length, 2);
    assert.equal(second.positions[0]?.remainingQuantity, 3);
});

test("does not trigger a profit floor merely because MFE activation occurred", () => {
    const floorOnlyPolicy = { ...policy("LONG"), trailActivationBps: 1_000 };
    const initial = applyProtectionPolicy(position(), floorOnlyPolicy, bar());
    const activated = applyProtectionPolicy(
        position({ protection: initial.protection }),
        floorOnlyPolicy,
        bar({ ts: 1_700_003_600_000, high: 103, low: 100.5, close: 102 }),
    );

    assert.equal(activated.protection?.activated, true);
    assert.equal(activated.trigger, "NONE");
});

test("uses Task 1 trailingGivebackBps when the Task 2 trail alias is absent", () => {
    const trailingPolicy = {
        ...policy("LONG"),
        trailRetraceBps: undefined,
        trailingGivebackBps: 50,
    } as ProtectionPolicyInput & { readonly trailingGivebackBps: number };
    const initial = applyProtectionPolicy(position(), trailingPolicy, bar());
    const activated = applyProtectionPolicy(
        position({ protection: initial.protection }),
        trailingPolicy,
        bar({ ts: 1_700_003_600_000, high: 103, low: 99, close: 102 }),
    );
    const trailed = applyProtectionPolicy(
        position({ protection: activated.protection }),
        trailingPolicy,
        bar({ ts: 1_700_007_200_000, high: 103, low: 100, close: 100.5 }),
    );

    assert.equal(trailed.protection?.trailPrice, 102.5);
});

test("integrated replay applies policy protection, baseline state, exits, and meaningful MTM", () => {
    const source: CanonicalSource = {
        input: {
            sourceRoot: "fixture-source",
            dataRoot: "fixture-data",
            productionSha: HASH,
            startTs: 1_700_000_000_000,
            endTs: 1_700_007_200_000,
            initialEquity: 1_000,
            deposits: [],
            feeBps: 0,
            slippageBps: 0,
            fundingSource: "fixture",
        },
        productionSha: HASH,
        productionFiles: [],
        sourceFiles: [],
        productionSources: [],
        strategyConfigs: [],
        candleSeries: [{
            sourceHash: HASH,
            symbol: "BTCUSDT",
            timeframe: "1h",
            bars: [
                bar({ ts: 1_700_000_000_000 }),
                bar({ ts: 1_700_003_600_000, high: 103, low: 102.8, close: 102.9 }),
                bar({ ts: 1_700_007_200_000, high: 103, low: 100, close: 100.5 }),
            ],
        }],
        funding: [],
        baselineLedger: [],
        candidateEvents: [candidate({ candidateId: "replay-leg", acceptedGross: 1_000, requestedGross: 1_000, fill: fill(100, 10) })],
        sourceHashes: [],
    };
    const config = {
        sourceHash: HASH,
        configHash: HASH,
        startTs: 1_700_000_000_000,
        endTs: 1_700_007_200_000,
        initialEquity: 1_000,
        feeBps: 0,
        slippageBps: 0,
        fundingSource: "fixture",
        policyHash: HASH,
        caps: { totalGross: 5_000, cryptoGross: 5_000, strategyGross: 5_000 },
        protectionReadback: true,
        directionPolicies: { LONG: policy("LONG") },
        baselinePositions: [position({ positionId: "baseline-leg", entryFill: fill(100, 1) })],
    } as ReplayConfigWithRuntime & { readonly baselinePositions: readonly PositionLifecycle[] };
    const replay = replayIntegrated(source, config);

    assert.ok(replay.positions.some((entry) => entry.positionId === "baseline-leg"));
    assert.match(JSON.stringify(replay.protectionLedger), /GIVEBACK/);
    assert.ok(replay.positions.find((entry) => entry.positionId === "replay-leg")?.exit !== null);
    const replayLeg = replay.positions.find((entry) => entry.positionId === "replay-leg") as PositionLifecycleWithProtection | undefined;
    assert.equal(replayLeg?.protection?.barsHeld, 3);
    assert.ok(new Set(replay.equityMtmTimeline.map((entry) => entry.equity)).size > 1);
});

test("integrated replay merges candidates, executions, deposits, and bars causally by timestamp", () => {
    const startTs = 1_700_000_000_000;
    const entryTs = startTs + 3_600_000;
    const source = replaySource(
        [bar({ ts: startTs }), bar({ ts: entryTs })],
        [candidate({ candidateId: "causal-entry", ts: entryTs, fill: fill(100, 1, entryTs) })],
    );
    const replay = replayIntegrated(source, replayConfig({ startTs, endTs: entryTs, deposits: [{ ts: entryTs, amount: 100 }] }));

    assert.equal(replay.equityMtmTimeline[1]?.positions.length, 0);
    assert.equal(replay.equityMtmTimeline.at(-1)?.positions.length, 1);
    assert.equal(replay.equityMtmTimeline.at(-1)?.cash, 1_100);
});

test("rejected candidates with attached fills never create exposure or accepted Gross", () => {
    const startTs = 1_700_000_000_000;
    const denied = candidate({
        candidateId: "denied-with-fill",
        ts: startTs,
        accepted: false,
        rejectionReason: "GROSS_CAP_TOTAL",
        fill: fill(100, 1, startTs),
    });
    const replay = replayIntegrated(
        replaySource([bar({ ts: startTs })], [denied]),
        replayConfig({ startTs, endTs: startTs }),
    );

    assert.deepEqual(replay.positions, []);
    assert.equal(replay.portfolio.at(-1)?.acceptedGross, 0);
    assert.equal(replay.reservationLedger.length, 0);
    assert.match(replay.reason, /MANUAL_REVIEW/);
});

test("candidate fills outside the replay window never create exposure", () => {
    const startTs = 1_700_000_000_000;
    const endTs = startTs + 3_600_000;
    const replay = replayIntegrated(
        replaySource([bar({ ts: startTs })], [candidate({ candidateId: "fill-after-end", ts: startTs, fill: fill(100, 1, endTs + 1) })]),
        replayConfig({ startTs, endTs }),
    );

    assert.deepEqual(replay.positions, []);
    assert.equal(replay.portfolio.at(-1)?.acceptedGross, 0);
    assert.match(replay.reason, /MANUAL_REVIEW/);
});

test("candidate fills before their decision timestamp fail closed", () => {
    const startTs = 1_700_000_000_000;
    const decisionTs = startTs + 3_600_000;
    const replay = replayIntegrated(
        replaySource(
            [bar({ ts: startTs }), bar({ ts: decisionTs })],
            [candidate({ candidateId: "fill-before-decision", ts: decisionTs, fill: fill(100, 1, startTs) })],
        ),
        replayConfig({ startTs, endTs: decisionTs }),
    );

    assert.deepEqual(replay.positions, []);
    assert.equal(replay.portfolio.at(-1)?.acceptedGross, 0);
    assert.match(replay.reason, /MANUAL_REVIEW/);
});

test("combines generated protective triggers and supplied same-bar executions under one STOP-first priority pass", () => {
    const startTs = 1_700_000_000_000;
    const source = replaySource(
        [bar({ ts: startTs, low: 94, close: 95 })],
        [candidate({ candidateId: "same-bar-origin", ts: startTs, fill: fill(100, 10, startTs) })],
    );
    const normalExit: ExecutionLifecycleEvent = {
        sourceHash: HASH,
        ts: startTs,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "SUPPLIED_NORMAL_EXIT",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "supplied-normal-exit",
        eventType: "EXIT",
        positionId: "same-bar-origin",
        executionKind: "NORMAL_EXIT",
        clientOrderId: "supplied-normal-intent",
        quantity: 10,
        price: 101,
        executionStatus: "FILLED",
    };
    const replay = replayIntegrated(source, replayConfig({
        startTs,
        endTs: startTs,
        directionPolicies: { LONG: policy("LONG") },
        executionEvents: [normalExit],
    }));

    assert.equal(replay.positions.find((entry) => entry.positionId === "same-bar-origin")?.exit?.reason, "INITIAL_STOP");
    assert.ok(replay.events.some((event) => event.eventId === "supplied-normal-exit"));
});

test("full and partial exits release accepted Gross by symbol and strategy and record realized PnL", () => {
    const initial = state({
        acceptedGross: 1_000,
        reservedGross: 0,
        pendingGross: 0,
        grossBySymbol: { BTCUSDT: 1_000 },
        grossByStrategy: { V12_V4: 1_000 },
        positions: [position({ acceptedGross: 1_000, requestedGross: 1_000 })],
    });
    const exited = reconcileLifecycle(initial, {
        sourceHash: HASH,
        ts: 1_700_003_600_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "realized-exit",
        fee: 1,
        funding: 2,
        slippage: 3,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "realized-exit-1",
        eventType: "EXIT",
        positionId: "leg-1",
        executionKind: "NORMAL_EXIT",
        clientOrderId: "realized-exit-intent",
        quantity: 10,
        price: 110,
        executionStatus: "FILLED",
    });

    assert.equal(exited.acceptedGross, 0);
    assert.equal(exited.grossBySymbol.BTCUSDT, 0);
    assert.equal(exited.grossByStrategy.V12_V4, 0);
    assert.equal(exited.positions[0]?.exit?.realizedPnl, 100);
    assert.equal(exited.fee, 1);
    assert.equal(exited.funding, 2);
    assert.equal(exited.slippage, 3);
});

test("partial exit realized PnL remains in the trade event ledger before the final exit", () => {
    const initial = state({
        acceptedGross: 1_000,
        grossBySymbol: { BTCUSDT: 1_000 },
        grossByStrategy: { V12_V4: 1_000 },
        positions: [position({ acceptedGross: 1_000, requestedGross: 1_000 })],
    });
    const partial = reconcileLifecycle(initial, {
        sourceHash: HASH,
        ts: 1_700_003_600_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: null,
        reason: "partial-realized-exit",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "partial-realized-exit-1",
        eventType: "PARTIAL_FILL",
        positionId: "leg-1",
        executionKind: "NORMAL_EXIT",
        clientOrderId: "partial-realized-exit-intent",
        quantity: 5,
        price: 110,
        executionStatus: "PARTIAL_FILLED",
    });

    assert.equal(partial.positions[0]?.exit, null);
    assert.equal(partial.positions[0]?.events.at(-1)?.exit?.realizedPnl, 50);
});

test("does not seed resident exposure or Gross from closed baseline ledger entries", () => {
    const startTs = 1_700_000_000_000;
    const closedExit = {
        sourceHash: HASH,
        ts: startTs - 1,
        price: 105,
        quantity: 1,
        gross: 105,
        fee: 0,
        funding: 0,
        slippage: 0,
        realizedPnl: 5,
        reason: "closed-before-replay",
    };
    const makeBaseline = (tradeId: string, finalExit: BaselineLedgerEntry["finalExit"]): BaselineLedgerEntry => ({
        sourceHash: HASH,
        ts: startTs,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 100,
        acceptedGross: 100,
        reservation: null,
        fill: null,
        exit: null,
        reason: "baseline",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        tradeId,
        entry: fill(100, 1, startTs),
        finalExit,
    });
    const source = replaySource([bar({ ts: startTs })], [], [makeBaseline("closed", closedExit), makeBaseline("open", null)]);
    const replay = replayIntegrated(source, replayConfig({ startTs, endTs: startTs }));

    assert.deepEqual(replay.positions.map((entry) => entry.positionId), ["baseline:open"]);
    assert.equal(replay.portfolio.at(-1)?.acceptedGross, 100);
});

test("marks all open symbols from the same timestamp snapshot", () => {
    const startTs = 1_700_000_000_000;
    const source = replaySource([
        bar({ ts: startTs, symbol: "BTCUSDT", open: 110, high: 110, low: 110, close: 110 }),
        bar({ ts: startTs, symbol: "ETHUSDT", open: 220, high: 220, low: 220, close: 220 }),
    ]);
    const config = replayConfig({
        startTs,
        endTs: startTs,
        baselinePositions: [
            position({ positionId: "btc-open", symbol: "BTCUSDT", acceptedGross: 100, requestedGross: 100, entryFill: fill(100, 1, startTs), remainingQuantity: 1 }),
            position({ positionId: "eth-open", symbol: "ETHUSDT", acceptedGross: 200, requestedGross: 200, entryFill: fill(200, 1, startTs), remainingQuantity: 1 }),
        ],
    });
    const replay = replayIntegrated(source, config);

    assert.equal(replay.equityMtmTimeline.at(-1)?.equity, 1_030);
});

test("marks preemption as explicitly unsupported instead of claiming a zero count", () => {
    const startTs = 1_700_000_000_000;
    const replay = replayIntegrated(replaySource([bar({ ts: startTs })]), replayConfig({ startTs, endTs: startTs }));

    assert.match(JSON.stringify(replay), /PREEMPTION_UNSUPPORTED/);
    assert.doesNotMatch(JSON.stringify(replay), /"preemptionCount":0/);
});

const _candidateReservationState: CandidateReservationState | null = null;
const _executionLifecycleEvent: ExecutionLifecycleEvent | null = null;
void _candidateReservationState;
void _executionLifecycleEvent;
