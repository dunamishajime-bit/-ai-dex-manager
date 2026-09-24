import { strict as assert } from "node:assert";
import test from "node:test";
import {
    isAsterUpstreamKillReason,
    isRecoverableV12AsterManualReview,
    isRecoverableV12RuntimeLineageKillReason,
    isRecoverableV12RuntimeLineageManualReview,
    isRecoverableV52ReferenceKillReason,
    isRecoverableAsterRateBudgetKillReason,
} from "../lib/aster-upstream-recovery-policy";

test("only Aster transport/rate-limit Kill Switch reasons are allow-listed", () => {
    assert.equal(isAsterUpstreamKillReason("V52 fatal tick error: <urlopen error [Errno 104] Connection reset by peer>"), true);
    assert.equal(isAsterUpstreamKillReason("V52 upstream state unavailable: HTTP 429 /fapi/v3/positionRisk"), true);
    assert.equal(isAsterUpstreamKillReason("V52 fatal tick error: device time must match the actual time"), true);
    assert.equal(isAsterUpstreamKillReason("daily loss latch"), false);
    assert.equal(isAsterUpstreamKillReason("V52 managed Stock quantity reconciliation mismatch"), false);
});

test("off-hours local reference stale kill is a separate narrow recovery reason", () => {
    assert.equal(isRecoverableV52ReferenceKillReason('V52 fatal tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=META: {"error":"stale_quote","symbol":"META","ageMs":31704,"maximumAgeMs":30000}'), true);
    assert.equal(isRecoverableV52ReferenceKillReason('V52 fatal tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=META: {"error":"cross_source_divergence"}'), false);
    assert.equal(isRecoverableV52ReferenceKillReason("V52 fatal tick error: HTTP 503 https://example.com/quote?symbol=META: stale_quote"), false);
});

test("V12 operator review is clearable only for the same Aster communication incident", () => {
    assert.equal(isRecoverableV12AsterManualReview(""), true);
    assert.equal(isRecoverableV12AsterManualReview("Aster HTTP 429 [ASTER_READ path=/fapi/v3/ping status=429 code=none]"), true);
    assert.equal(isRecoverableV12AsterManualReview("Aster request connection reset by peer"), true);
    assert.equal(isRecoverableV12AsterManualReview("V12_POSITION_COUNT_MISMATCH"), false);
});

test("only the exact stale pre-cutover Q102 lineage mismatch is recoverable", () => {
    assert.equal(isRecoverableV12RuntimeLineageKillReason("V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha"), true);
    assert.equal(isRecoverableV12RuntimeLineageKillReason("V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:position"), false);
    assert.equal(isRecoverableV12RuntimeLineageKillReason("V52 fatal tick error: QUALITY102_STATE_MISMATCH:runtimeCommitSha"), false);
    assert.equal(isRecoverableV12RuntimeLineageManualReview("QUALITY102_OWNERSHIP_RUNTIME_SHA_MISMATCH"), true);
    assert.equal(isRecoverableV12RuntimeLineageManualReview("QUALITY102_STATE_MISMATCH:runtimeCommitSha"), false);
});

test("only the exact local V52 rate-budget saturation reason is recoverable", () => {
    assert.equal(isRecoverableAsterRateBudgetKillReason("V52 recoverable tick error: ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"), true);
    assert.equal(isAsterUpstreamKillReason("V52 recoverable tick error: ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"), true);
    assert.equal(isRecoverableAsterRateBudgetKillReason("V52 upstream state unavailable: ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"), false);
    assert.equal(isRecoverableAsterRateBudgetKillReason("V52 recoverable tick error: ASTER_GLOBAL_RATE_BUDGET_MALFORMED"), false);
    assert.equal(isRecoverableAsterRateBudgetKillReason("V52 recoverable tick error: HTTP 429"), false);
});
