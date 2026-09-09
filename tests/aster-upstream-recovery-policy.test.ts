import { strict as assert } from "node:assert";
import test from "node:test";
import { isAsterUpstreamKillReason, isRecoverableV12AsterManualReview } from "../lib/aster-upstream-recovery-policy";

test("only Aster transport/rate-limit Kill Switch reasons are allow-listed", () => {
    assert.equal(isAsterUpstreamKillReason("V52 fatal tick error: <urlopen error [Errno 104] Connection reset by peer>"), true);
    assert.equal(isAsterUpstreamKillReason("V52 upstream state unavailable: HTTP 429 /fapi/v3/positionRisk"), true);
    assert.equal(isAsterUpstreamKillReason("V52 fatal tick error: device time must match the actual time"), true);
    assert.equal(isAsterUpstreamKillReason("daily loss latch"), false);
    assert.equal(isAsterUpstreamKillReason("V52 managed Stock quantity reconciliation mismatch"), false);
});

test("V12 operator review is clearable only for the same Aster communication incident", () => {
    assert.equal(isRecoverableV12AsterManualReview(""), true);
    assert.equal(isRecoverableV12AsterManualReview("Aster HTTP 429 [ASTER_READ path=/fapi/v3/ping status=429 code=none]"), true);
    assert.equal(isRecoverableV12AsterManualReview("Aster request connection reset by peer"), true);
    assert.equal(isRecoverableV12AsterManualReview("V12_POSITION_COUNT_MISMATCH"), false);
});
