import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Aster upstream recovery is two-phase, read-only before apply, and archives safety state", async () => {
    const source = await readFile("scripts/disdex-aster-upstream-live-recovery.ts", "utf8");
    assert.match(source, /--verify-only/);
    assert.match(source, /--apply/);
    assert.match(source, /isAsterUpstreamKillReason/);
    assert.match(source, /isRecoverableV12AsterManualReview/);
    assert.match(source, /runAsterReadOnlyRecoveryGate/);
    assert.match(source, /assertRecoveryRunnersStopped/);
    assert.match(source, /disdex-v12-x1-all@/);
    assert.match(source, /disdex-v52-aster-only@/);
    assert.match(source, /ASTER_UPSTREAM_RECOVERY_RUNNER_NOT_STOPPED/);
    assert.match(source, /ASTER_UPSTREAM_RECOVERY_VERIFY_PASS/);
    assert.match(source, /ASTER_UPSTREAM_RECOVERY_APPLY_PASS/);
    assert.match(source, /recovery-archive/);
    assert.match(source, /readOnlyRateLimitMaxRetries:\s*0/);
    for (const forbidden of ["placeMarketOrder", "placeConditionalOrder", "placeStopMarketOrder", "cancelOrder", "cancelAllOrders", "cancelAll"]) {
        assert.equal(source.includes(forbidden), false, `recovery coordinator must not contain Aster mutation primitive: ${forbidden}`);
    }
});
