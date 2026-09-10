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

test("Aster upstream recovery blocks conflicting old release lineages before Kill clear", async () => {
    const source = await readFile("scripts/disdex-aster-upstream-live-recovery.ts", "utf8");
    assert.match(source, /assertNoConflictingReleaseUnits/);
    for (const family of [
        "disdex-v12-x1-all@*.service",
        "disdex-pengu-dual-ls-v2@*.service",
        "disdex-quality102-causal-v1@*.service",
        "disdex-v52-aster-only@*.service",
        "disdex-shared-crypto-risk@*.service",
        "disdex-v12-v52-margin-guard@*.service",
    ]) {
        assert.ok(source.includes(family), `missing lineage guard for ${family}`);
    }
    assert.match(source, /ASTER_UPSTREAM_RECOVERY_CONFLICTING_RELEASE_UNIT/);
});

test("Aster upstream recovery rechecks lineage while account lock is held before publishing recovery", async () => {
    const source = await readFile("scripts/disdex-aster-upstream-live-recovery.ts", "utf8");
    const checks = source.match(/assertNoConflictingReleaseUnits\(candidateSha\)/g) || [];
    assert.ok(checks.length >= 3, `expected at least three lineage checks, got ${checks.length}`);
    const gateIndex = source.indexOf("const gate = await runAsterReadOnlyRecoveryGate");
    const applyWriteIndex = source.indexOf("await atomicWrite(sharedKill.sourcePath");
    const checksAfterGate = source.indexOf("assertNoConflictingReleaseUnits(candidateSha)", gateIndex);
    const checksAfterApply = source.indexOf("assertNoConflictingReleaseUnits(candidateSha)", applyWriteIndex);
    assert.ok(checksAfterGate > gateIndex);
    assert.ok(checksAfterApply > applyWriteIndex);
});

test("Aster upstream recovery refuses Kill clear while legacy V96/V52 live supervisor is active", async () => {
  const source = await readFile("scripts/disdex-aster-upstream-live-recovery.ts", "utf8");
  assert.match(source, /disdex-v96-v52-live\.service/);
  assert.match(source, /ASTER_UPSTREAM_RECOVERY_LEGACY_LIVE_CONFLICT/);
});
