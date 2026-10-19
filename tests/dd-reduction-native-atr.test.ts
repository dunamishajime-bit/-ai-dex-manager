import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";

import {
    applyProtectionPolicy,
    type ProtectionPolicyInput,
    type PositionLifecycleWithProtection,
} from "../lib/backtest/dd-reduction/protection";
import { replayIntegrated, type ReplayConfigWithRuntime } from "../lib/backtest/dd-reduction/emulator";
import type { CandidateDecision, CanonicalSource, ExecutionBar, ExecutionFill, PositionLifecycle } from "../lib/backtest/dd-reduction/types";
import { canonicalDirectorySha, loadCanonicalSource } from "../lib/backtest/dd-reduction/source";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

const HOUR = 3_600_000;
const HASH = FIXTURE_HASH;

assertFixtureIdentity({ sourceHash: HASH }, ["sourceHash"], "native-atr-fixture");

function fill(price: number, ts = 1_700_000_000_000): ExecutionFill {
    return {
        sourceHash: HASH,
        ts,
        price,
        quantity: 1,
        gross: price,
        fee: 0,
        funding: 0,
        slippage: 0,
        reason: "native-atr-entry",
    };
}

function position(direction: "LONG" | "SHORT" = "LONG", overrides: Partial<PositionLifecycleWithProtection> = {}): PositionLifecycleWithProtection {
    const base: PositionLifecycle = {
        sourceHash: HASH,
        positionId: "native-atr-position",
        strategy: "V12_V4",
        direction,
        symbol: "BTCUSDT",
        requestedGross: 100,
        acceptedGross: 100,
        reservation: null,
        entryFill: fill(100),
        exit: null,
        reason: "native-atr-fixture",
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
        remainingQuantity: 1,
        protectedQuantity: 1,
        protection: null,
        ...overrides,
    };
}

function policy(direction: "LONG" | "SHORT" = "LONG", overrides: Partial<ProtectionPolicyInput> = {}): ProtectionPolicyInput {
    return {
        policyHash: HASH,
        configHash: HASH,
        strategy: "V12_V4",
        direction,
        mode: "NATIVE_ATR",
        atrContract: {
            mode: "NATIVE_ATR",
            atrLookbackBars: 31,
            atrSourceTimeframe: "1h",
            inputTimeframe: "1h",
            strategyTimeframe: "2h",
            stopAtr: 2.477,
            takeProfitAtr: 3.1995,
            trailingAtr: 0.2,
            maxHoldBars: 23,
            holdClock: "STRATEGY_BARS",
            sameBarPolicy: "STOP_FIRST_FAIL_CLOSED",
        },
        ...overrides,
    };
}

function bar(
    inputIndex: number,
    overrides: Partial<ExecutionBar> = {},
): ExecutionBar {
    const ts = 1_700_000_000_000 + inputIndex * HOUR;
    const strategyBarIndex = Math.floor(inputIndex / 2);
    return {
        sourceHash: HASH,
        ts,
        symbol: "BTCUSDT",
        timeframe: "1h",
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
        inputTimeframe: "1h",
        strategyTimeframe: "2h",
        strategyBarKey: `BTCUSDT:2h:${strategyBarIndex}`,
        strategyBarIndex,
        inputBarIndex: inputIndex,
        atr: 5,
        atrLookbackBars: 31,
        atrSourceTimeframe: "1h",
        atrComputedThroughTs: ts - HOUR,
        atrHistoryComplete: true,
        sameBarOrderKnown: true,
        ...overrides,
    };
}

test("native ATR protection snapshots the entry ATR and keeps ATR distances in price units", () => {
    const initial = applyProtectionPolicy(position(), policy(), bar(0));
    assert.equal(initial.stopPrice, 87.61);
    assert.equal(initial.protection.entryAtr, 5);
    assert.equal(initial.protection.takeProfitPrice, 116);

    const favorable = applyProtectionPolicy(
        position("LONG", { protection: initial.protection }),
        policy(),
        bar(1, { high: 110, low: 109.5, close: 110, atr: 50 }),
    );
    assert.equal(favorable.protection.entryAtr, 5);
    assert.equal(favorable.protection.mfeDistance, 10);
    assert.equal(favorable.protection.mfeAtr, 2);
    assert.equal(favorable.stopPrice, 109);
    assert.equal(favorable.trigger, "NONE");

    const retrace = applyProtectionPolicy(
        position("LONG", { protection: favorable.protection }),
        policy(),
        bar(2, { high: 110, low: 108.5, close: 109, atr: 500 }),
    );
    assert.equal(retrace.stopPrice, 109);
    assert.equal(retrace.trigger, "TRAIL");
});

test("native ATR implements LONG and SHORT price-direction symmetry without converting ATR to bps", () => {
    const long = applyProtectionPolicy(position("LONG"), policy("LONG"), bar(0));
    const short = applyProtectionPolicy(position("SHORT"), policy("SHORT"), bar(0));

    assert.equal(long.stopPrice, 87.61);
    assert.equal(short.stopPrice, 112.39);
    assert.equal(long.protection.takeProfitPrice, 116);
    assert.equal(short.protection.takeProfitPrice, 84);
});

test("native ATR gives same-bar STOP priority when STOP and take-profit are both touched", () => {
    const decision = applyProtectionPolicy(
        position(),
        policy(),
        bar(1, { high: 120, low: 80, close: 100 }),
    );

    assert.equal(decision.trigger, "INITIAL_STOP");
    assert.equal(decision.stopPrice, 87.61);
});

test("native ATR fails closed when same-bar ordering is unknown or ATR history is not causal", () => {
    assert.throws(
        () => applyProtectionPolicy(position(), policy(), bar(0, { sameBarOrderKnown: false })),
        /ATR_SAME_BAR_ORDER_UNKNOWN/,
    );
    assert.throws(
        () => applyProtectionPolicy(position(), policy(), bar(0, { atrHistoryComplete: false })),
        /ATR_HISTORY_INCOMPLETE/,
    );
    assert.throws(
        () => applyProtectionPolicy(position(), policy(), bar(0, { atrComputedThroughTs: 1_700_000_000_000 })),
        /ATR_NOT_CAUSAL/,
    );
});

test("native ATR maxHoldBars counts 2h strategy bars, not 1h input bars", () => {
    let current = position();
    let timeStopInputIndex: number | null = null;
    for (let inputIndex = 0; inputIndex < 46; inputIndex += 1) {
        const decision = applyProtectionPolicy(current, policy(), bar(inputIndex));
        current = { ...current, protection: decision.protection };
        if (decision.trigger === "TIME_STOP") {
            timeStopInputIndex = inputIndex;
            break;
        }
    }

    assert.equal(timeStopInputIndex, 44);
    assert.equal(current.protection?.strategyBarsHeld, 23);
    assert.equal(current.protection?.barsHeld, 45);
});

test("canonical source preserves causal ATR and strategy timeframe metadata in its manifest", async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? ".", "dd-reduction-native-atr-source-"));
    const sourceRoot = join(root, "source");
    const dataRoot = join(root, "data");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    const productionContent = JSON.stringify({ strategy: "V12_V4", config: { risk: "sanitized" } });
    const rows = [0, 1].map((inputIndex) => ({
        ...bar(inputIndex),
    }));
    try {
        await writeFile(join(sourceRoot, "production.json"), productionContent, "utf8");
        await writeFile(join(dataRoot, "BTCUSDT-1h.json"), JSON.stringify({ symbol: "BTCUSDT", timeframe: "1h", bars: rows }), "utf8");
        const source = await loadCanonicalSource({
            sourceRoot,
            dataRoot,
            productionSha: canonicalDirectorySha([{ path: "production.json", content: productionContent }]),
            startTs: 1_700_000_000_000,
            endTs: 1_700_000_000_000 + HOUR,
            initialEquity: 1_000,
            deposits: [],
            feeBps: 0,
            slippageBps: 0,
            fundingSource: "fixture",
        });
        const manifestSeries = source.manifest?.series[0] as unknown as Record<string, unknown>;
        assert.equal(source.candleSeries[0]?.bars[0]?.atr, 5);
        assert.equal(source.candleSeries[0]?.bars[0]?.strategyTimeframe, "2h");
        assert.equal(manifestSeries.atrLookbackBars, 31);
        assert.equal(manifestSeries.strategyTimeframe, "2h");
        assert.equal(manifestSeries.inputTimeframe, "1h");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("emulator routes native ATR take-profit through the resident protection lifecycle", () => {
    const firstBar = bar(0);
    const secondBar = bar(1, { high: 120, close: 118 });
    const candidate: CandidateDecision = {
        sourceHash: HASH,
        ts: firstBar.ts,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 100,
        acceptedGross: 100,
        reservation: null,
        fill: fill(100, firstBar.ts),
        exit: null,
        reason: "native-atr-candidate",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        candidateId: "native-atr-candidate",
        accepted: true,
        rejectionReason: null,
    };
    const source: CanonicalSource = {
        input: {
            sourceRoot: "native-atr-source",
            dataRoot: "native-atr-data",
            productionSha: HASH,
            startTs: firstBar.ts,
            endTs: secondBar.ts,
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
        candleSeries: [{ sourceHash: HASH, symbol: "BTCUSDT", timeframe: "1h", bars: [firstBar, secondBar] }],
        funding: [],
        baselineLedger: [],
        candidateEvents: [candidate],
        sourceHashes: [],
    };
    const nativePolicy = policy();
    const config: ReplayConfigWithRuntime = {
        sourceHash: HASH,
        configHash: HASH,
        startTs: firstBar.ts,
        endTs: secondBar.ts,
        initialEquity: 1_000,
        feeBps: 0,
        slippageBps: 0,
        fundingSource: "fixture",
        policyHash: HASH,
        caps: { totalGross: 1_000, cryptoGross: 1_000, strategyGross: 1_000 },
        protectionReadback: true,
        strategyPolicies: [nativePolicy],
    };
    const replay = replayIntegrated(source, config);
    const positionResult = replay.positions.find((entry) => entry.positionId === candidate.candidateId);
    assert.equal(positionResult?.exit?.reason, "TAKE_PROFIT");
    const protectionEvent = replay.events.find((event) => event.eventId.startsWith("protection-exit:")) as { readonly executionKind?: string } | undefined;
    assert.equal(protectionEvent?.executionKind, "TAKE_PROFIT");
});
