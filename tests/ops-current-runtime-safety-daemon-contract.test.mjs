import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../scripts/ops/root/disdex-current-runtime-wiring", import.meta.url);
const source = readFileSync(path, "utf8");

assert.match(source, /ensure_safety_daemon_active/);
assert.match(source, /ensure_safety_daemon_active "\$SHARED_RISK_UNIT"/);
assert.match(source, /ordersSent=0/);
assert.match(source, /cancelSent=0/);
assert.match(source, /positionChangesSent=0/);
console.log("CURRENT_RUNTIME_SAFETY_DAEMON_CONTRACT_PASS");
