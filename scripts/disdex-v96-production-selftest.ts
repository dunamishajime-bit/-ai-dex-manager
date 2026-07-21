import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    DISDEX_V96_ALLOCATION,
    DISDEX_V96_EXECUTION_PARITY,
    DISDEX_V96_LIVE_PROMOTION,
    DISDEX_V96_RUNTIME,
    DISDEX_V96_STRATEGY_ID,
} from "../config/disdexV96Runtime";
import { allocateDisDexV96ReservedPengu } from "../lib/disdex-v96-allocation";
import {
    disDexV96ConfigFingerprint,
    evaluateDisDexV96LiveGates,
    type DisDexV96ExecutionParityApproval,
} from "../lib/disdex-v96-live-gates";
import {
    disDexV96OperatorOverrideArtifactSha256,
    evaluateDisDexV96OperatorOverride,
    readDisDexV96KillSwitch,
    updateDisDexV96DailyRisk,
    type DisDexV96OperatorOverrideApproval,
} from "../lib/disdex-v96-live-risk-controls";
import { normalizeDisDexV96OrderQuantity } from "../lib/disdex-v96-order-quantity";
import {
    createDisDexV96RunnerState,
    FileDisDexV96RunnerStateStore,
} from "../lib/disdex-v96-runner-state";
import { buildDisDexV95CoreSignal } from "../lib/disdex-v95-core-signal";
import type { DirectTradeExecutor } from "../lib/direct-trade-executor";
import type { DisDexV35Candle, DisDexV35CoreSymbol } from "../lib/disdex-v35-signal-engine";
import type { DisDexPenguV46History } from "../lib/pengu-dual-engine-v46";

const BAR_12H = 12 * 60 * 60_000;
const CORE_SYMBOLS: DisDexV35CoreSymbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
const FIXED_NOW = Date.UTC(2026, 6, 21, 5, 0, 0);
const RUNTIME_COMMIT_SHA = "0a5414cf907b2a0159ff0541de1ccd7b8332a535";

function close(actual: number, expected: number, epsilon = 1e-12) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function candle(openTime: number, open: number, closePrice: number): DisDexV35Candle {
    return {
        openTime,
        closeTime: openTime + BAR_12H - 1,
        open,
        high: Math.max(open, closePrice) * 1.003,
        low: Math.min(open, closePrice) * 0.997,
        close: closePrice,
        volume: 1_000_000,
    };
}

function chronologyHistory(): { history: DisDexPenguV46History; now: number; expectedReferenceTs: number } {
    const start = Date.UTC(2023, 0, 1);
    const completedCount = 150;
    const core12h = Object.fromEntries(CORE_SYMBOLS.map((symbol, symbolIndex) => {
        const growth = 0.004 + symbolIndex * 0.0005;
        const rows: DisDexV35Candle[] = [];
        let previousClose = 100 + symbolIndex * 20;
        for (let index = 0; index < completedCount; index += 1) {
            const openTime = start + index * BAR_12H;
            const open = previousClose;
            const closePrice = open * (1 + growth + (index % 11 === 0 ? -0.001 : 0));
            rows.push(candle(openTime, open, closePrice));
            previousClose = closePrice;
        }
        const incompleteOpenTime = start + completedCount * BAR_12H;
        rows.push(candle(incompleteOpenTime, previousClose, previousClose * 3));
        return [symbol, rows];
    })) as Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
    return {
        history: {
            core12h,
            btc1h: [],
            pengu1h: [],
            penguFunding: [],
        },
        now: start + completedCount * BAR_12H + BAR_12H / 2,
        expectedReferenceTs: start + (completedCount - 1) * BAR_12H,
    };
}

function parityApproval(): DisDexV96ExecutionParityApproval {
    return {
        status: "APPROVED",
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        researchCommitSha: "70ac1dcf5e8f6fcad43159653a76de0ca42f18a2",
        productionCommitSha: RUNTIME_COMMIT_SHA,
        goldenVectorArtifactSha256: "a".repeat(64),
        allocationParityPassed: true,
        signalChronologyParityPassed: true,
        orderQuantityParityPassed: true,
        restartRecoveryPassed: true,
        reviewer: "v96-selftest",
        reviewedAt: new Date(FIXED_NOW).toISOString(),
    };
}

function operatorOverride(overrides: Partial<Omit<DisDexV96OperatorOverrideApproval, "artifactSha256">> = {}) {
    const base: Omit<DisDexV96OperatorOverrideApproval, "artifactSha256"> = {
        status: "APPROVED",
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        approvedCommitSha: RUNTIME_COMMIT_SHA,
        operator: "selftest-operator",
        reason: "Validate the guarded Operator Override route.",
        approvedAt: new Date(FIXED_NOW - 60_000).toISOString(),
        expiresAt: new Date(FIXED_NOW + 24 * 60 * 60_000).toISOString(),
        forwardEvidenceBypassAccepted: true,
        initialPenguGrossCap: 0.15,
        maximumPortfolioGross: 2,
        maximumDailyLossPct: 2,
        maximumDailyLossUsd: 50,
        acknowledgement: "I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE",
        ...overrides,
    };
    return {
        ...base,
        artifactSha256: disDexV96OperatorOverrideArtifactSha256(base),
    } satisfies DisDexV96OperatorOverrideApproval;
}

assert.equal(DISDEX_V96_STRATEGY_ID, "DISDEX_V35_STRONG_RESERVED_PENGU_V96");
assert.equal(DISDEX_V96_RUNTIME.mode, "LIVE_READY");
assert.equal(DISDEX_V96_RUNTIME.liveTradingEnabled, true);
assert.equal(DISDEX_V96_RUNTIME.executionParityStatus, "APPROVED");
assert.equal(DISDEX_V96_RUNTIME.forwardEvidenceStatus, "NOT_APPROVED");
assert.equal(DISDEX_V96_EXECUTION_PARITY.corePort, "V95_WEIGHT_BAND_STRONG_BOOST_TYPESCRIPT_GOLDEN_VECTOR_PASS");
assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross, 0.15);
assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct, 2);
assert.equal(DISDEX_V96_ALLOCATION.penguTargetGross, 1.15);
assert.equal(DISDEX_V96_ALLOCATION.totalGrossCap, 2);
assert.equal(DISDEX_V96_ALLOCATION.minimumActivePenguClip, 0.5);

const reserved = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 0.9, ETHUSDT: 0.9 },
    penguSide: 1,
});
close(reserved.coreScale, 1.425 / 1.8);
close(reserved.penguClip, 0.5);
assert.ok(reserved.finalGross <= 2 + 1e-12);

const capacityClip = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 1 },
    penguSide: -1,
});
close(capacityClip.penguClip, 1 / 1.15);
close(capacityClip.targetWeights.PENGUUSDT, -1);
assert.ok(capacityClip.finalGross <= 2 + 1e-12);

const coreOnly = allocateDisDexV96ReservedPengu({
    coreWeights: { BTCUSDT: 1.2, ETHUSDT: 1.2 },
    penguSide: 0,
});
close(coreOnly.finalGross, 2);
assert.equal(coreOnly.penguFinalGross, 0);

const blocked = evaluateDisDexV96LiveGates({
    runnerMode: "live",
    environmentLiveExecutionEnabled: true,
    activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
    executionParity: parityApproval(),
    runtimeCommitSha: RUNTIME_COMMIT_SHA,
    now: FIXED_NOW,
});
assert.equal(blocked.allowed, false);
assert.ok(blocked.reasons.some((reason) => reason.includes("Operator Override")));

const override = operatorOverride();
const overrideEvaluation = evaluateDisDexV96OperatorOverride({
    approval: override,
    configFingerprint: disDexV96ConfigFingerprint(),
    now: FIXED_NOW,
});
assert.equal(overrideEvaluation.allowed, true);

const allowed = evaluateDisDexV96LiveGates({
    runnerMode: "live",
    environmentLiveExecutionEnabled: true,
    activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
    executionParity: parityApproval(),
    operatorOverride: override,
    runtimeCommitSha: RUNTIME_COMMIT_SHA,
    now: FIXED_NOW,
});
assert.equal(allowed.allowed, true);
assert.equal(allowed.forwardEvidenceApproved, false);
assert.equal(allowed.operatorOverrideApproved, true);
assert.equal(allowed.operatorOverride?.initialPenguGrossCap, 0.15);

const commitMismatch = evaluateDisDexV96LiveGates({
    runnerMode: "live",
    environmentLiveExecutionEnabled: true,
    activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
    executionParity: parityApproval(),
    operatorOverride: override,
    runtimeCommitSha: "f".repeat(40),
    now: FIXED_NOW,
});
assert.equal(commitMismatch.allowed, false);
assert.ok(commitMismatch.reasons.some((reason) => reason.includes("runtime commit")));

const expired = operatorOverride({
    approvedAt: new Date(FIXED_NOW - 48 * 60 * 60_000).toISOString(),
    expiresAt: new Date(FIXED_NOW - 24 * 60 * 60_000).toISOString(),
});
const expiredGate = evaluateDisDexV96LiveGates({
    runnerMode: "live",
    environmentLiveExecutionEnabled: true,
    activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
    executionParity: parityApproval(),
    operatorOverride: expired,
    runtimeCommitSha: RUNTIME_COMMIT_SHA,
    now: FIXED_NOW,
});
assert.equal(expiredGate.allowed, false);
assert.ok(expiredGate.reasons.some((reason) => reason.includes("expired")));

const riskStart = updateDisDexV96DailyRisk({
    equity: 1000,
    maximumDailyLossPct: 2,
    maximumDailyLossUsd: 50,
    now: FIXED_NOW,
});
assert.equal(riskStart.tripped, false);
close(riskStart.lossLimitUsd, 20);
const riskSafe = updateDisDexV96DailyRisk({
    previous: riskStart,
    equity: 981,
    maximumDailyLossPct: 2,
    maximumDailyLossUsd: 50,
    now: FIXED_NOW + 60_000,
});
assert.equal(riskSafe.tripped, false);
const riskTripped = updateDisDexV96DailyRisk({
    previous: riskSafe,
    equity: 980,
    maximumDailyLossPct: 2,
    maximumDailyLossUsd: 50,
    now: FIXED_NOW + 120_000,
});
assert.equal(riskTripped.tripped, true);
close(riskTripped.lossPct, 2);
const nextDay = updateDisDexV96DailyRisk({
    previous: riskTripped,
    equity: 975,
    maximumDailyLossPct: 2,
    maximumDailyLossUsd: 50,
    now: FIXED_NOW + 24 * 60 * 60_000,
});
assert.equal(nextDay.tripped, false);
close(nextDay.dayStartEquity, 975);

async function main() {
    const fakeExecutor: DirectTradeExecutor = {
        getAccountSnapshot: async () => { throw new Error("unused"); },
        getPositions: async () => { throw new Error("unused"); },
        getOpenOrders: async () => { throw new Error("unused"); },
        getMarketQuote: async () => { throw new Error("unused"); },
        normalizeMarketQuantity: async (symbol, requestedQuantity, referencePrice) => ({
            symbol,
            quantity: Math.floor((requestedQuantity * 10) + 1e-9) / 10,
            quantityText: (Math.floor((requestedQuantity * 10) + 1e-9) / 10).toFixed(1),
            minQuantity: 0.1,
            maxQuantity: 100000,
            stepSize: 0.1,
            minNotional: 5,
            notional: (Math.floor((requestedQuantity * 10) + 1e-9) / 10) * referencePrice,
        }),
        executeMarket: async () => { throw new Error("unused"); },
        reconcileOrder: async () => { throw new Error("unused"); },
    };
    const quantity = await normalizeDisDexV96OrderQuantity({
        executor: fakeExecutor,
        symbol: "PENGUUSDT",
        side: "BUY",
        quote: {
            symbol: "PENGUUSDT",
            bidPrice: 9.9,
            askPrice: 10,
            bidQuantity: 100,
            askQuantity: 100,
            midPrice: 9.95,
            spreadBps: 100.5,
            updatedAt: Date.now(),
        },
        deltaNotionalUsd: 101,
        minimumOrderNotionalUsd: 5,
        reduceOnly: false,
    });
    assert.equal(quantity.referencePrice, 10);
    close(quantity.requestedQuantity, 10.1);
    close(quantity.normalized.quantity, 10.1);
    assert.equal(quantity.roundingPolicy, "FLOOR_TO_ASTER_MARKET_STEP");

    const chronology = chronologyHistory();
    const core = buildDisDexV95CoreSignal(chronology.history, chronology.now);
    assert.equal(core.referenceTs, chronology.expectedReferenceTs);
    assert.equal(core.chronology.latestCompletedOpenTime, chronology.expectedReferenceTs);
    assert.ok(core.chronology.latestCompletedCloseTime < chronology.now);
    assert.equal(core.chronology.usesCompleted12hBarsOnly, true);
    assert.equal(core.chronology.nextUnobservedReturnForcedToZero, true);
    assert.ok(core.replayedBars >= 10);
    assert.ok(core.finalGross <= 2 + 1e-12);

    const directory = await mkdtemp(join(tmpdir(), "disdex-v96-recovery-"));
    try {
        const path = join(directory, "runner-live.json");
        const switchPath = join(directory, "kill-switch.json");
        await writeFile(switchPath, JSON.stringify({
            active: true,
            strategyId: DISDEX_V96_STRATEGY_ID,
            action: "FLATTEN_MANAGED",
            reason: "selftest emergency",
            operator: "selftest-operator",
            activatedAt: new Date(FIXED_NOW).toISOString(),
        }));
        const killSwitch = await readDisDexV96KillSwitch(switchPath);
        assert.equal(killSwitch?.active, true);
        assert.equal(killSwitch?.action, "FLATTEN_MANAGED");

        const store = new FileDisDexV96RunnerStateStore(path, "live");
        const state = createDisDexV96RunnerState("live");
        assert.equal(state.version, 2);
        state.bootstrapRequired = false;
        state.dailyRisk = riskTripped;
        state.operatorOverride = {
            artifactSha256: override.artifactSha256,
            operator: override.operator,
            approvedAt: override.approvedAt,
            expiresAt: override.expiresAt,
            approvedCommitSha: override.approvedCommitSha,
            initialPenguGrossCap: override.initialPenguGrossCap,
            maximumPortfolioGross: override.maximumPortfolioGross,
            maximumDailyLossPct: override.maximumDailyLossPct,
            maximumDailyLossUsd: override.maximumDailyLossUsd,
        };
        state.pending = {
            idempotencyKey: "recovery-key",
            clientOrderId: "v96-recovery-key",
            phase: "submitted",
            symbol: "PENGUUSDT",
            side: "BUY",
            requestedQuantity: 12.3,
            normalizedQuantity: 12.3,
            reduceOnly: false,
            expectedPrice: 0.05,
            targetWeight: 0.15,
            targetNotionalUsd: 15,
            deltaNotionalUsd: 15,
            referenceTs: chronology.expectedReferenceTs,
            createdAt: chronology.now,
            updatedAt: chronology.now,
            retryCount: 0,
            reason: "recovery parity fixture",
        };
        await store.save(state);
        const recovered = await store.load();
        assert.equal(recovered.version, 2);
        assert.equal(recovered.strategyId, DISDEX_V96_STRATEGY_ID);
        assert.equal(recovered.configFingerprint, state.configFingerprint);
        assert.deepEqual(recovered.pending, state.pending);
        assert.equal(recovered.dailyRisk?.tripped, true);
        assert.equal(recovered.operatorOverride?.artifactSha256, override.artifactSha256);
        assert.equal(recovered.bootstrapRequired, false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }

    console.log(JSON.stringify({
        status: "DISDEX_V96_LIVE_PROMOTION_SELFTEST_PASS",
        strategyId: DISDEX_V96_STRATEGY_ID,
        weightBandStrongBoostParity: DISDEX_V96_EXECUTION_PARITY.corePort,
        signalChronologyParity: "APPROVED",
        allocationParity: "APPROVED",
        quantityParity: "APPROVED",
        recoveryParity: "APPROVED",
        operatorOverrideRoute: "APPROVED",
        runtimeCommitBinding: "APPROVED",
        initialPenguGrossCap: override.initialPenguGrossCap,
        maximumDailyLossPct: override.maximumDailyLossPct,
        killSwitchAction: "FLATTEN_MANAGED",
        liveTradingEnabled: DISDEX_V96_RUNTIME.liveTradingEnabled,
        forwardEvidenceStatus: DISDEX_V96_RUNTIME.forwardEvidenceStatus,
        liveGateAllowedWithOverride: allowed.allowed,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
