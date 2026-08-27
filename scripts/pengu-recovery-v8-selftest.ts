import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    PENGU_RECOVERY_V8,
    RECOVERY_V8_FREEZE_SHA,
    RECOVERY_V8_SOURCE_PRODUCTION_SHA,
} from "@/config/penguRecoveryV8";
import {
    evaluateRecoveryV8Entry,
    evaluateRecoveryV8PositionBar,
    type RecoveryV8FeatureRow,
    type RecoveryV8Position,
} from "@/lib/pengu-recovery-v8";
import { FilePenguDualLsV2RunnerStateStore } from "@/lib/pengu-dual-ls-v2-runner-state";

const HOUR = 3_600_000;

function row(overrides: Partial<RecoveryV8FeatureRow> = {}): RecoveryV8FeatureRow {
    return {
        index: 100,
        referenceTs: 1_000_000,
        close: 103,
        low: 102,
        high: 104,
        previousClose: 101,
        troughIndex: 80,
        troughClose: 100,
        troughAgeHours: 20,
        rsiDelta6: 8,
        ema168DistancePct: -5,
        btcReturn6hPct: 1,
        ordinaryLongEligible: false,
        ordinaryShortEligible: false,
        ...overrides,
    };
}

function position(overrides: Partial<RecoveryV8Position> = {}): RecoveryV8Position {
    return {
        side: 1,
        entryTs: 1_000_000,
        entryPrice: 100,
        quantity: 1,
        originalGross: 0.5,
        remainingGross: 0.5,
        partialDefenseTriggered: false,
        highWaterMark: 100,
        ...overrides,
    };
}

assert.equal(RECOVERY_V8_FREEZE_SHA, "15c0b7586710c9db1c46b376bb5041203fc7d826");
assert.equal(RECOVERY_V8_SOURCE_PRODUCTION_SHA, "a76fd7aaa0788209532a5a2c6489135dd8e4a27e");
assert.equal(PENGU_RECOVERY_V8.rule, "R_BTC3");
assert.equal(PENGU_RECOVERY_V8.priority, "SHORT_FIRST");
assert.equal(PENGU_RECOVERY_V8.initialGross, 0.5);
assert.equal(PENGU_RECOVERY_V8.partial.afterHours, 24);
assert.equal(PENGU_RECOVERY_V8.partial.stopPct, 0.04);
assert.equal(PENGU_RECOVERY_V8.partial.gross, 0.25);
assert.equal(PENGU_RECOVERY_V8.exit.hardStopPct, 0.06);
assert.equal(PENGU_RECOVERY_V8.exit.trailActivationPct, 0.06);
assert.equal(PENGU_RECOVERY_V8.exit.trailRetracePct, 0.03);
assert.equal(PENGU_RECOVERY_V8.exit.maxHoldHours, 72);
assert.equal(PENGU_RECOVERY_V8.exit.structuralBufferPct, null);
assert.equal(PENGU_RECOVERY_V8.breakevenProtector, false);
assert.equal(PENGU_RECOVERY_V8.staticGuard, false);
assert.equal(PENGU_RECOVERY_V8.stagedEntry, false);

const eligible = evaluateRecoveryV8Entry(row());
assert.equal(eligible.kind, "RECOVERY_V8");
assert.equal(eligible.gross, 0.5);
assert.equal(evaluateRecoveryV8Entry(row({ rsiDelta6: 7.392354615445917 - 1e-9 })).kind, "NONE");
assert.equal(evaluateRecoveryV8Entry(row({ ema168DistancePct: -5.864583483302943 - 1e-9 })).kind, "NONE");
assert.equal(evaluateRecoveryV8Entry(row({ btcReturn6hPct: 0.20571786048402818 - 1e-9 })).kind, "NONE");
assert.equal(evaluateRecoveryV8Entry(row({ ordinaryShortEligible: true })).kind, "NONE");
assert.equal(evaluateRecoveryV8Entry(row({ ordinaryLongEligible: true })).kind, "NONE");
assert.equal(evaluateRecoveryV8Entry(row({ rsiDelta6: Number.NaN })).kind, "NONE");

assert.equal(evaluateRecoveryV8PositionBar(position(), row({ referenceTs: 1_000_000 + 23 * HOUR, low: 95 })).kind, "NONE");
assert.equal(evaluateRecoveryV8PositionBar(position(), row({ referenceTs: 1_000_000 + 24 * HOUR, low: 97 })).kind, "NONE");
const partial = evaluateRecoveryV8PositionBar(position(), row({ referenceTs: 1_000_000 + 24 * HOUR, low: 96 }));
assert.equal(partial.kind, "PARTIAL_DEFENSE");
assert.equal(partial.triggerPrice, 96);
assert.equal(partial.updatedPosition.partialDefenseTriggered, true);
assert.equal(partial.updatedPosition.remainingGross, 0.25);
const collision = evaluateRecoveryV8PositionBar(position(), row({ referenceTs: 1_000_000 + 24 * HOUR, low: 93 }));
assert.deepEqual(collision.events, ["PARTIAL_DEFENSE", "HARD_STOP"]);
assert.equal(collision.kind, "HARD_STOP");
assert.equal(collision.updatedPosition.remainingGross, 0.25);
assert.equal(evaluateRecoveryV8PositionBar(partial.updatedPosition, row({ referenceTs: 1_000_000 + 25 * HOUR, low: 93 })).kind, "HARD_STOP");
assert.equal(evaluateRecoveryV8PositionBar(position(), row({ referenceTs: 1_000_000 + 24 * HOUR, high: 107, low: 100 })).kind, "NONE");

async function stateRoundTrip() {
    const directory = await mkdtemp(join(tmpdir(), "disdex-recovery-v8-"));
    const store = new FilePenguDualLsV2RunnerStateStore(join(directory, "runner.json"), "PAPER");
    const state = {
        version: 2 as const,
        strategyId: "PENGU_DUAL_LS_V2_FINAL" as const,
        mode: "PAPER" as const,
        updatedAt: Date.now(),
        failures: [],
        position: {
            side: 1 as const,
            entryTs: 1_000_000,
            entryPrice: 100,
            quantity: 0.5,
            gross: 0.25,
            highWaterMark: 101,
            entryVersion: "RECOVERY_V8" as const,
            recoveryV8: {
                version: "RECOVERY_V8" as const,
                side: 1 as const,
                entryTs: 1_000_000,
                entryPrice: 100,
                quantity: 0.5,
                originalQuantity: 1,
                originalGross: 0.5,
                remainingGross: 0.25,
                partialDefenseTriggered: true,
                highWaterMark: 101,
                protectionLifecycle: "SPLIT_PROTECTION" as const,
                fullHardStopClientOrderId: "recv8-full-hard",
                partialStopClientOrderId: "recv8-partial",
                remainingHardStopClientOrderId: "recv8-remaining-hard",
                actualPartialFill: {
                    filledAtTs: 2_000_000,
                    executedQuantity: 0.5,
                    averagePrice: 95.9,
                    triggerPrice: 96,
                    slippageBps: -10.4166666667,
                    clientOrderId: "recv8-partial",
                },
            },
        },
    };
    await store.save(state);
    const loaded = await store.load();
    assert.equal(loaded.position?.entryVersion, "RECOVERY_V8");
    assert.equal(loaded.position?.recoveryV8?.partialDefenseTriggered, true);
    assert.equal(loaded.position?.recoveryV8?.remainingGross, 0.25);
    assert.equal(loaded.position?.recoveryV8?.partialStopClientOrderId, "recv8-partial");

    const invalidPath = join(directory, "invalid.json");
    await writeFile(invalidPath, `${JSON.stringify({ ...state, position: { ...state.position, recoveryV8: { ...state.position.recoveryV8, partialDefenseTriggered: true, remainingGross: 0.5, actualPartialFill: undefined } } })}\n`, "utf8");
    await assert.rejects(() => new FilePenguDualLsV2RunnerStateStore(invalidPath, "PAPER").load(), /Recovery V8 state is missing or invalid/);
}

void stateRoundTrip().then(() => console.log("PENGU_RECOVERY_V8_SELFTEST_PASS"));
