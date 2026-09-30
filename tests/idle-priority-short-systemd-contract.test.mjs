import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Idle LIVE unit loads the same Aster credential env sources as existing LIVE runners", async () => {
  const unit = await readFile("ops/systemd/disdex-idle-priority-short@.service", "utf8");
  const required = [
    "EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env",
    "EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env",
    "EnvironmentFile=-/etc/disdex/disdex-quality102-causal-v1.env",
  ];
  for (const entry of required) assert.ok(unit.includes(entry), `missing credential source: ${entry}`);
  assert.match(unit, /EnvironmentFile=-\/etc\/disdex\/current-runtime\/%i\.env/);
  assert.match(unit, /Environment=DISDEX_OPERATOR_ACTIVATION_PATH=\/var\/lib\/disdex\/shared\/operator-activation\/runtime\.json/);
  assert.match(unit, /ExecStartPre=\+\/usr\/bin\/install -o root -g deploy -m 0640 \/var\/lib\/disdex\/shared\/operator-activation\/current\.json \/var\/lib\/disdex\/shared\/operator-activation\/runtime\.json/);
  assert.match(unit, /ExecStart=.*disdex-idle-priority-short-live-runner\.ts/);
});

test("runtime wiring performs formal HYPE state lineage migration before activation", async () => {
  const wiring = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(wiring, /disdex-hype-zec-benign-market-data-recovery\.ts/);
  assert.match(wiring, /recover_hype_benign_state\s+migrate_hype_state_lineage/);
  assert.match(wiring, /disdex-hype-zec-long-state-migrate\.ts/);
  assert.match(wiring, /--state-path \"\$HYPE_ZEC_STATE_ROOT\/runner\.json\"/);
  assert.match(wiring, /--to-sha \"\$DEPLOYED_SHA\"/);
  assert.match(wiring, /migrate_hype_state_lineage\s+migrate_idle_state_lineage\s+systemctl daemon-reload/);
  assert.match(wiring, /scripts\/disdex-idle-priority-short-state-migrate\.ts/);
  assert.match(wiring, /migrate_idle_state_lineage\s+systemctl daemon-reload/);
});

