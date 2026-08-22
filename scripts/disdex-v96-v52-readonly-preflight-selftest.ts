import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import { assertReadOnlyKillSwitchInactive, readStateSummary, resolveReadOnlyStatePaths } from "./disdex-v96-v52-readonly-preflight";

async function main() {
    const source = await readFile(resolve("scripts/disdex-v96-v52-readonly-preflight.ts"), "utf8");
    for (const forbidden of ["mkdir(", "writeFile(", "appendFile(", "rename(", "unlink(", "save(", "placeMarketOrder", "placeLimitOrder", "cancelAll"]) {
        assert.equal(source.includes(forbidden), false, `read-only preflight contains forbidden operation: ${forbidden}`);
    }
    assert.match(source, /readOptionalApproval/);
    assert.match(source, /forwardEvidenceApplicable/);
    await assert.rejects(() => readStateSummary(resolve(".runtime-state/does-not-exist/runner-live.json"), "missing"), /READ_ONLY_PREFLIGHT_STATE_MISSING/);
    const directory = await mkdtemp(join(tmpdir(), "disdex-readonly-kill-switch-"));
    try {
        const killSwitch = resolve(directory, "kill-switch.json");
        const aligned = resolveReadOnlyStatePaths({
            DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT: directory,
            DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE: killSwitch,
            DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE: killSwitch,
            DISDEX_V96_KILL_SWITCH_FILE: killSwitch,
            PENGU_DUAL_LS_V2_KILL_SWITCH_FILE: killSwitch,
        });
        assert.equal(aligned.killSwitch, killSwitch);
        assert.throws(() => resolveReadOnlyStatePaths({
            DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT: directory,
            DISDEX_V96_KILL_SWITCH_FILE: resolve(directory, "stale", "kill-switch.json"),
        }), /DISDEX_V96_V52_KILL_SWITCH_PATH_MISMATCH/);
        await writeFile(killSwitch, `${JSON.stringify({
            active: true,
            strategyId: DISDEX_V96_STRATEGY_ID,
            action: "FLATTEN_MANAGED",
            reason: "self-test active shared Kill Switch",
            operator: "self-test",
            activatedAt: new Date().toISOString(),
        })}\n`);
        await assert.rejects(() => assertReadOnlyKillSwitchInactive(killSwitch), /READ_ONLY_PREFLIGHT_KILL_SWITCH_ACTIVE/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ status: "DISDEX_V96_V52_READONLY_PREFLIGHT_SELFTEST_OK", mkdir: false, stateWrite: false, rolloverSave: false, missingState: "FAIL_CLOSED", activeSharedKillSwitch: "FAIL_CLOSED", mismatchedKillSwitchPath: "FAIL_CLOSED", ordersSent: 0, forwardEvidenceBypass: "OPERATOR_OVERRIDE_ONLY" }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
