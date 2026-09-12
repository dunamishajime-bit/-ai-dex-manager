import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../scripts/ops/root/disdex-current-runtime-wiring", import.meta.url);
const source = readFileSync(path, "utf8");

assert.match(source, /ensure_safety_daemon_active/);
assert.match(source, /ensure_safety_daemon_active "\$SHARED_RISK_UNIT"/);
assert.match(source, /THREE_HOUR_DROPIN_DIR="\/etc\/systemd\/system\/disdex-v12-three-hour-health-check\.service\.d"/);
assert.match(source, /EnvironmentFile=\r?\nEnvironmentFile=\/etc\/disdex\/disdex-v13d-v11eq-v96\.env\r?\nEnvironmentFile=\/etc\/disdex\/disdex-v12-pengu-v2-v52\.env\r?\nEnvironmentFile=\/etc\/disdex\/disdex-v12-x1-all\.env\r?\nEnvironmentFile=\$\{CONTRACT_ENV_FILE\}/);
assert.match(source, /Environment=DISDEX_SHARED_KILL_SWITCH_FILE=\$\{SHARED_ROOT\}\/kill-switch\.json/);
assert.match(source, /ordersSent=0/);
assert.match(source, /cancelSent=0/);
assert.match(source, /positionChangesSent=0/);
console.log("CURRENT_RUNTIME_SAFETY_DAEMON_CONTRACT_PASS");