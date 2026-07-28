import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { readStateSummary } from "./disdex-v96-v52-readonly-preflight";

async function main() {
    const source = await readFile(resolve("scripts/disdex-v96-v52-readonly-preflight.ts"), "utf8");
    for (const forbidden of ["mkdir(", "writeFile(", "appendFile(", "rename(", "unlink(", "save(", "placeMarketOrder", "placeLimitOrder", "cancelAll"]) {
        assert.equal(source.includes(forbidden), false, `read-only preflight contains forbidden operation: ${forbidden}`);
    }
    await assert.rejects(() => readStateSummary(resolve(".runtime-state/does-not-exist/runner-live.json"), "missing"), /READ_ONLY_PREFLIGHT_STATE_MISSING/);
    console.log(JSON.stringify({
        status: "DISDEX_V96_V52_READONLY_PREFLIGHT_SELFTEST_OK",
        mkdir: false,
        stateWrite: false,
        rolloverSave: false,
        missingState: "FAIL_CLOSED",
        ordersSent: 0,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
