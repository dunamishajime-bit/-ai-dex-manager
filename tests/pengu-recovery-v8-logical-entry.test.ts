import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRecoveryV8PositionBar } from "../lib/pengu-recovery-v8";

test("Recovery V8 uses logical entry after a manual re-entry", () => {
    const result = evaluateRecoveryV8PositionBar({
        side: 1,
        entryTs: 1_000,
        entryPrice: 105,
        logicalEntryPrice: 100,
        recoveryExecutionPrice: 105,
        quantity: 1,
        originalGross: 0.5,
        remainingGross: 0.5,
        partialDefenseTriggered: false,
        highWaterMark: 106,
    }, {
        index: 0,
        referenceTs: 1_000 + 3_600_000,
        close: 104,
        low: 102,
        high: 108,
        previousClose: 104,
        troughIndex: -1,
        troughClose: Number.NaN,
        troughAgeHours: Number.NaN,
        rsiDelta6: Number.NaN,
        ema168DistancePct: Number.NaN,
        btcReturn6hPct: Number.NaN,
        ordinaryLongEligible: false,
        ordinaryShortEligible: false,
    });
    assert.equal(result.kind, "TRAILING_STOP");
    assert.ok((result.stopPrice || 0) > 102);
});
