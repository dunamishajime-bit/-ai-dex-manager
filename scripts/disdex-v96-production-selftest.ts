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
import { DISDEX_V13D_V11EQ_V96_ALLOCATION } from "../config/disdexStockRouterV13DV11EqRuntime";
import { allocateDisDexV96ReservedPengu } from "../lib/disdex-v96-allocation";
import {
    disDexV96ConfigFingerprint,
    evaluateDisDexV96LiveGates,
    type DisDexV96ExecutionParityApproval,
} from "../lib/disdex-v96-live-gates";
import {
    disDexV96OperatorOverrideArtifactSha256,
    readDisDexV96KillSwitch,
    updateDisDexV96DailyRisk,
    type DisDexV96OperatorOverrideApproval,
} from "../lib/disdex-v96-live-risk-controls";
import { normalizeDisDexV96OrderQuantity } from "../lib/disdex-v96-order-quantity";
import { createDisDexV96RunnerState, FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";
import { buildDisDexV95CoreSignal } from "../lib/disdex-v95-core-signal";
import { buildDefaultDisDexV96RunnerConfig } from "../lib/disdex-v96-portfolio-runner";
import type { DirectTradeExecutor } from "../lib/direct-trade-executor";
import type { DisDexV35Candle, DisDexV35CoreSymbol } from "../lib/disdex-v35-signal-engine";
import type { DisDexPenguV46History } from "../lib/pengu-dual-engine-v46";

const HOUR = 3_600_000;
const BAR_12H = 12 * HOUR;
const NOW = Date.UTC(2026, 6, 21, 5);
const RUNTIME_COMMIT = "0a5414cf907b2a0159ff0541de1ccd7b8332a535";
const CORE_SYMBOLS: DisDexV35CoreSymbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];

function close(actual: number, expected: number, epsilon = 1e-12) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function parity(): DisDexV96ExecutionParityApproval {
    return {
        status: "APPROVED",
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        researchCommitSha: "70ac1dcf5e8f6fcad43159653a76de0ca42f18a2",
        productionCommitSha: RUNTIME_COMMIT,
        goldenVectorArtifactSha256: "a".repeat(64),
        allocationParityPassed: true,
        signalChronologyParityPassed: true,
        orderQuantityParityPassed: true,
        restartRecoveryPassed: true,
        reviewer: "v96-selftest",
        reviewedAt: new Date(NOW).toISOString(),
    };
}

function override(input: Partial<Omit<DisDexV96OperatorOverrideApproval, "artifactSha256">> = {}) {
    const base: Omit<DisDexV96OperatorOverrideApproval, "artifactSha256"> = {
        status: "APPROVED",
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        approvedCommitSha: RUNTIME_COMMIT,
        operator: "v96-selftest",
        reason: "Exercise guarded initial LIVE.",
        approvedAt: new Date(NOW - HOUR).toISOString(),
        forwardEvidenceBypassAccepted: true,
        initialPenguGrossCap: 0.15,
        maximumPortfolioGross: 2,
        maximumDailyLossPct: 5,
        maximumDailyLossUsd: 50,
        acknowledgement: "I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE",
        ...input,
    };
    return { ...base, artifactSha256: disDexV96OperatorOverrideArtifactSha256(base) };
}

function candle(openTime: number, price: number, growth: number): DisDexV35Candle {
    const closePrice = price * (1 + growth);
    return {
        openTime,
        closeTime: openTime + BAR_12H - 1,
        open: price,
        high: Math.max(price, closePrice) * 1.002,
        low: Math.min(price, closePrice) * 0.998,
        close: closePrice,
        volume: 1_000_000,
    };
}

function chronologyFixture() {
    const start = Date.UTC(2023, 0, 1);
    const count = 150;
    const core12h = Object.fromEntries(CORE_SYMBOLS.map((symbol, symbolIndex) => {
        const rows: DisDexV35Candle[] = [];
        let price = 100 + symbolIndex * 20;
        for (let index = 0; index < count; index += 1) {
            const row = candle(start + index * BAR_12H, price, 0.003 + symbolIndex * 0.0004);
            rows.push(row);
            price = row.close;
        }
        rows.push(candle(start + count * BAR_12H, price, 2));
        return [symbol, rows];
    })) as Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
    const now = start + count * BAR_12H + BAR_12H / 2;
    const expectedReferenceTs = start + (count - 1) * BAR_12H;
    const history: DisDexPenguV46History = { core12h, btc1h: [], pengu1h: [], penguFunding: [] };
    return { history, now, expectedReferenceTs };
}

async function main() {
    assert.equal(DISDEX_V96_RUNTIME.mode, "LIVE_READY");
    assert.equal(DISDEX_V96_RUNTIME.liveTradingEnabled, true);
    assert.equal(DISDEX_V96_RUNTIME.forwardEvidenceStatus, "NOT_APPROVED");
    assert.equal(DISDEX_V96_RUNTIME.executionParityStatus, "APPROVED");
    assert.equal(DISDEX_V96_EXECUTION_PARITY.corePort, "V95_WEIGHT_BAND_STRONG_BOOST_TYPESCRIPT_GOLDEN_VECTOR_PASS");
    assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross, 0.15);
    assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct, 5);
    assert.equal(DISDEX_V96_LIVE_PROMOTION.killSwitchAction, "FLATTEN_MANAGED");

    const allocation = allocateDisDexV96ReservedPengu({
        coreWeights: { BTCUSDT: 0.9, ETHUSDT: 0.9 },
        penguSide: 1,
    });
    close(allocation.coreScale, 1.425 / 1.8);
    close(allocation.penguClip, 0.5);
    assert.ok(allocation.finalGross <= DISDEX_V96_ALLOCATION.totalGrossCap);

    const combinedEthTarget = allocateDisDexV96ReservedPengu({
        coreWeights: { ETHUSDT: 1.32 },
        penguSide: 0,
        totalGrossCap: 1,
    });
    close(combinedEthTarget.targetWeights.ETHUSDT, 1);
    close(combinedEthTarget.finalGross, 1);
    assert.equal(combinedEthTarget.finalGross > 1 + 1e-9, false);

    const standaloneEthTarget = allocateDisDexV96ReservedPengu({
        coreWeights: { ETHUSDT: 1.32 },
        penguSide: 0,
        totalGrossCap: 2,
    });
    close(standaloneEthTarget.targetWeights.ETHUSDT, 1.32);
    close(standaloneEthTarget.finalGross, 1.32);

    const combinedWithPengu = allocateDisDexV96ReservedPengu({
        coreWeights: { ETHUSDT: 1.32 },
        penguSide: 1,
        penguTargetGross: 1.15,
        totalGrossCap: 1,
        minimumActivePenguClip: 0.5,
    });
    assert.ok(combinedWithPengu.finalGross <= 1 + 1e-12);
    assert.ok(combinedWithPengu.penguClip >= 0.5);
    close(combinedWithPengu.reservedPenguGross, 0.575);

    assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap, 1);
    assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap, 1.5);
    assert.equal(DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap, 2.5);

    const effectiveOneGross = buildDefaultDisDexV96RunnerConfig({ maxGross: 1 });
    assert.equal(effectiveOneGross.maxGross, 1);

    const approvedOverride = override();
    const live = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: approvedOverride,
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW,
    });
    assert.equal(live.allowed, true);
    assert.equal(live.forwardEvidenceApproved, false);
    assert.equal(live.operatorOverrideApproved, true);

    const noOverride = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW,
    });
    assert.equal(noOverride.allowed, false);

    const wrongCommit = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: approvedOverride,
        runtimeCommitSha: "f".repeat(40),
        now: NOW,
    });
    assert.equal(wrongCommit.allowed, false);
    assert.ok(wrongCommit.reasons.some((reason) => reason.includes("runtime commit")));

    const legacy = override({ expiresAt: new Date(NOW + 24 * HOUR).toISOString() });
    const legacyGate = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: legacy,
        maximumGross: 2,
        maximumDailyLossPct: 5,
        initialPenguGrossCap: 0.15,
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW,
    });
    assert.equal(legacyGate.allowed, false);
    assert.ok(legacyGate.reasons.some((reason) => reason.includes("time-bounded")));

    const permanent = override();
    const permanentGate = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: permanent,
        maximumGross: 2,
        maximumDailyLossPct: 5,
        initialPenguGrossCap: 0.15,
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW + 365 * 24 * HOUR,
    });
    assert.equal(permanentGate.allowed, true);

    const changedRisk = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: permanent,
        maximumGross: 1,
        maximumDailyLossPct: 5,
        initialPenguGrossCap: 0.15,
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW,
    });
    assert.equal(changedRisk.allowed, false);
    assert.ok(changedRisk.reasons.some((reason) => reason.includes("maximum Gross")));

    const changedDailyLoss = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: permanent,
        maximumGross: 2,
        maximumDailyLossPct: 3.5,
        initialPenguGrossCap: 0.15,
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW,
    });
    assert.equal(changedDailyLoss.allowed, false);
    assert.ok(changedDailyLoss.reasons.some((reason) => reason.includes("daily loss limit")));

    const changedPengu = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: permanent,
        maximumGross: 2,
        maximumDailyLossPct: 5,
        initialPenguGrossCap: 0.10,
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW,
    });
    assert.equal(changedPengu.allowed, false);
    assert.ok(changedPengu.reasons.some((reason) => reason.includes("initial PENGU Gross")));
    const revoked = override({ revokedAt: new Date(NOW).toISOString(), revokedBy: "operator", revokeReason: "test" });
    const revokedGate = evaluateDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: true,
        activationAcknowledgement: "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK",
        executionParity: parity(),
        operatorOverride: revoked,
        maximumGross: 2,
        maximumDailyLossPct: 5,
        initialPenguGrossCap: 0.15,
        runtimeCommitSha: RUNTIME_COMMIT,
        now: NOW,
    });
    assert.equal(revokedGate.allowed, false);
    assert.ok(revokedGate.reasons.some((reason) => reason.includes("revoked")));
    const startRisk = updateDisDexV96DailyRisk({
        equity: 1000,
        maximumDailyLossPct: 5,
        maximumDailyLossUsd: 50,
        now: NOW,
    });
    close(startRisk.lossLimitUsd, 50);
    assert.equal(startRisk.tripped, false);
    const trip = updateDisDexV96DailyRisk({
        previous: startRisk,
        equity: 950,
        maximumDailyLossPct: 5,
        maximumDailyLossUsd: 50,
        now: NOW + HOUR,
    });
    assert.equal(trip.tripped, true);
    close(trip.lossPct, 5);
    const nextDay = updateDisDexV96DailyRisk({
        previous: trip,
        equity: 990,
        maximumDailyLossPct: 5,
        maximumDailyLossUsd: 50,
        now: NOW + 24 * HOUR,
    });
    assert.equal(nextDay.tripped, false);
    assert.equal(nextDay.resetReason, "UTC_DAY_ROLLOVER");

    const fakeExecutor: DirectTradeExecutor = {
        getAccountSnapshot: async () => { throw new Error("unused"); },
        getPositions: async () => { throw new Error("unused"); },
        getOpenOrders: async () => { throw new Error("unused"); },
        getMarketQuote: async () => { throw new Error("unused"); },
        normalizeMarketQuantity: async (symbol, requestedQuantity, referencePrice) => ({
            symbol,
            quantity: Math.floor(requestedQuantity * 10 + 1e-9) / 10,
            quantityText: (Math.floor(requestedQuantity * 10 + 1e-9) / 10).toFixed(1),
            minQuantity: 0.1,
            maxQuantity: 100000,
            stepSize: 0.1,
            minNotional: 5,
            notional: Math.floor(requestedQuantity * 10 + 1e-9) / 10 * referencePrice,
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
            updatedAt: NOW,
        },
        deltaNotionalUsd: 101,
        minimumOrderNotionalUsd: 5,
        reduceOnly: false,
    });
    close(quantity.requestedQuantity, 10.1);
    close(quantity.normalized.quantity, 10.1);
    assert.equal(quantity.referencePrice, 10);

    const chronology = chronologyFixture();
    const core = buildDisDexV95CoreSignal(chronology.history, chronology.now);
    assert.equal(core.referenceTs, chronology.expectedReferenceTs);
    assert.equal(core.chronology.latestCompletedOpenTime, chronology.expectedReferenceTs);
    assert.equal(core.chronology.usesCompleted12hBarsOnly, true);
    assert.equal(core.chronology.nextUnobservedReturnForcedToZero, true);
    assert.ok(core.finalGross <= 2 + 1e-12);

    const directory = await mkdtemp(join(tmpdir(), "disdex-v96-live-promotion-"));
    try {
        const killSwitchPath = join(directory, "kill-switch.json");
        await writeFile(killSwitchPath, JSON.stringify({
            active: true,
            strategyId: DISDEX_V96_STRATEGY_ID,
            action: "FLATTEN_MANAGED",
            reason: "selftest emergency",
            operator: "v96-selftest",
            activatedAt: new Date(NOW).toISOString(),
        }));
        const killSwitch = await readDisDexV96KillSwitch(killSwitchPath);
        assert.equal(killSwitch?.active, true);
        assert.equal(killSwitch?.action, "FLATTEN_MANAGED");

        const statePath = join(directory, "runner-live.json");
        const store = new FileDisDexV96RunnerStateStore(statePath, "live");
        const state = createDisDexV96RunnerState("live");
        assert.equal(state.version, 2);
        state.bootstrapRequired = false;
        state.dailyRisk = trip;
        state.operatorOverride = {
            artifactSha256: approvedOverride.artifactSha256,
            operator: approvedOverride.operator,
            approvedAt: approvedOverride.approvedAt,
            expiresAt: approvedOverride.expiresAt,
            approvedCommitSha: approvedOverride.approvedCommitSha,
            initialPenguGrossCap: approvedOverride.initialPenguGrossCap,
            maximumPortfolioGross: approvedOverride.maximumPortfolioGross,
            maximumDailyLossPct: approvedOverride.maximumDailyLossPct,
            maximumDailyLossUsd: approvedOverride.maximumDailyLossUsd,
        };
        await store.save(state);
        const recovered = await store.load();
        assert.equal(recovered.version, 2);
        assert.equal(recovered.dailyRisk?.tripped, true);
        assert.equal(recovered.operatorOverride?.artifactSha256, approvedOverride.artifactSha256);
        assert.equal(recovered.bootstrapRequired, false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }

    console.log(JSON.stringify({
        status: "DISDEX_V96_LIVE_PROMOTION_SELFTEST_PASS",
        strategyId: DISDEX_V96_STRATEGY_ID,
        liveTradingEnabled: DISDEX_V96_RUNTIME.liveTradingEnabled,
        forwardEvidenceStatus: DISDEX_V96_RUNTIME.forwardEvidenceStatus,
        operatorOverrideRoute: "APPROVED",
        runtimeCommitBinding: "APPROVED",
        initialPenguGrossCap: approvedOverride.initialPenguGrossCap,
        maximumDailyLossPct: approvedOverride.maximumDailyLossPct,
        dailyLossLatch: "MANUAL_RESET_REQUIRED",
        killSwitchAction: DISDEX_V96_LIVE_PROMOTION.killSwitchAction,
        noOrdersSent: true,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
