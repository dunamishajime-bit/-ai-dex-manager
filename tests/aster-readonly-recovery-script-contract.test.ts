import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("recovery CLI is read-only, requires the canonical shared Kill Switch, and disables hidden 429 retries", async () => {
    const source = await readFile("scripts/disdex-aster-readonly-recovery-gate.ts", "utf8");
    assert.match(source, /runAsterReadOnlyRecoveryGate/);
    assert.match(source, /readSharedKillSwitch/);
    assert.equal(source.includes("resolveDisDexV96V52SharedRuntimePaths"), false);
    assert.match(source, /ASTER_READONLY_RECOVERY_REQUIRES_ACTIVE_KILL_SWITCH/);
    assert.match(source, /readOnlyRateLimitMaxRetries:\s*0/);
    for (const forbidden of ["placeMarketOrder", "placeConditionalOrder", "placeStopMarketOrder", "cancelOrder", "cancelAll", "writeFile", "rename", "unlink"]) {
        assert.equal(source.includes(forbidden), false, `recovery gate must not contain mutation primitive: ${forbidden}`);
    }
});
