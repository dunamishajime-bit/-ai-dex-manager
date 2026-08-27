import assert from "node:assert/strict";
import { evaluateRecoveryV8PositionBar } from "@/lib/pengu-recovery-v8";

const entry = {
    side: 1 as const,
    entryTs: 0,
    entryPrice: 100,
    quantity: 1,
    originalGross: 0.5,
    remainingGross: 0.5,
    partialDefenseTriggered: false,
    highWaterMark: 100,
};
const base = {
    index: 0,
    referenceTs: 24 * 3_600_000,
    close: 95,
    low: 93,
    high: 100,
    previousClose: 100,
    troughIndex: 0,
    troughClose: 100,
    troughAgeHours: 1,
    rsiDelta6: 8,
    ema168DistancePct: -5,
    btcReturn6hPct: 1,
    ordinaryLongEligible: false,
    ordinaryShortEligible: false,
};
const collision = evaluateRecoveryV8PositionBar(entry, base);
assert.deepEqual(collision.events, ["PARTIAL_DEFENSE", "HARD_STOP"]);
assert.equal(collision.triggerPrice, 96);
assert.equal(collision.stopPrice, 94);
assert.equal(collision.updatedPosition.remainingGross, 0.25);
assert.equal(collision.updatedPosition.quantity, 0.5);
const resumed = evaluateRecoveryV8PositionBar(collision.updatedPosition, { ...base, referenceTs: 25 * 3_600_000, low: 93 });
assert.equal(resumed.kind, "HARD_STOP");
assert.equal(resumed.events.includes("PARTIAL_DEFENSE"), false);
console.log("PENGU_RECOVERY_V8_PARITY_SELFTEST_PASS");
