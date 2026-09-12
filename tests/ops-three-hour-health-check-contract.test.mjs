import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../scripts/ops/root/disdex-v12-three-hour-health-check", import.meta.url);
const source = readFileSync(path, "utf8");

assert.match(source, /PENGU_UNIT="disdex-pengu-dual-ls-v2@\$RELEASE_SHA\.service"/);
assert.match(source, /V52_UNIT="disdex-v52-aster-only@\$RELEASE_SHA\.service"/);
assert.doesNotMatch(source, /active_unit_from_list/);
assert.doesNotMatch(source, /unit_from_list/);
assert.match(source, /DISDEX_SHARED_KILL_SWITCH_FILE="\$KILL_FILE" DISDEX_V12_STATE_FILE="\$STATE_FILE" "\$AUTO_REPAIR"/);
assert.match(source, /kill_active="\$\(read_kill_active "\$KILL_FILE"\)"/);
assert.match(source, /V12_3H_INSPECTION_REPAIR_REMAINS_FAIL_CLOSED/);
console.log("THREE_HOUR_HEALTH_EXACT_LINEAGE_CONTRACT_PASS");