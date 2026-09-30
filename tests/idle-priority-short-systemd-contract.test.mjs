import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("Idle LIVE unit loads the same Aster credential env sources as existing LIVE runners", async () => {
  const unit = await readFile("ops/systemd/disdex-idle-priority-short@.service", "utf8");
  const required = [
    "EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env",
    "EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env",
    "EnvironmentFile=-/etc/disdex/disdex-quality102-causal-v1.env",
  ];
  for (const entry of required) assert.ok(unit.includes(entry), `missing credential source: ${entry}`);
  assert.match(unit, /EnvironmentFile=-\/etc\/disdex\/current-runtime\/%i\.env/);
  assert.match(unit, /EnvironmentFile=-\/etc\/disdex\/current-runtime\/%i\.idle-operator\.env/);
  assert.match(unit, /Environment=DISDEX_OPERATOR_ACTIVATION_PATH=\/var\/lib\/disdex\/shared\/operator-activation\/runtime\.json/);
  assert.match(unit, /ExecStartPre=\+\/usr\/bin\/install -o root -g root -m 0644 \/var\/lib\/disdex\/shared\/operator-activation\/current\.json \/var\/lib\/disdex\/shared\/operator-activation\/runtime\.json/);
  assert.doesNotMatch(unit, /ExecStartPre=\+\/usr\/bin\/install -o root -g deploy -m 0640 \/var\/lib\/disdex\/shared\/operator-activation\/current\.json \/var\/lib\/disdex\/shared\/operator-activation\/runtime\.json/);
  assert.match(unit, /ExecStart=.*disdex-idle-priority-short-live-runner\.ts/);
});

test("runtime wiring performs formal HYPE state lineage migration before activation", async () => {
  const wiring = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(wiring, /disdex-hype-zec-benign-market-data-recovery\.ts/);
  assert.match(wiring, /recover_hype_benign_state\s+migrate_hype_state_lineage/);
  assert.match(wiring, /disdex-hype-zec-long-state-migrate\.ts/);
  assert.match(wiring, /--state-path \"\$HYPE_ZEC_STATE_ROOT\/runner\.json\"/);
  assert.match(wiring, /--to-sha \"\$DEPLOYED_SHA\"/);
  assert.match(wiring, /migrate_hype_state_lineage\s+recover_idle_benign_state\s+migrate_idle_state_lineage\s+systemctl daemon-reload/);
  assert.match(wiring, /disdex-idle-priority-short-benign-state-recovery\.ts/);
  assert.match(wiring, /disdex-quality102-causal-v1-state-migrate\.ts/);
  assert.match(wiring, /disdex-flat-state-sha-migrate\.ts/);
  assert.match(wiring, /disdex-v12-runtime-lineage-recovery\.ts/);
  assert.match(wiring, /migrate_quality102_state_lineage\s+migrate_v12_state_lineage\s+migrate_fet_state_lineage\s+recover_hype_benign_state/);
  assert.match(wiring, /scripts\/disdex-idle-priority-short-state-migrate\.ts/);
  assert.match(wiring, /IDLE_OPERATOR_ENV_FILE=.*\.idle-operator\.env/);
  assert.match(wiring, /write_atomic "\$IDLE_OPERATOR_ENV_FILE" "DISDEX_OPERATOR_ACTIVATION_PATH=\$\{OPERATOR_ACTIVATION_RUNTIME_PATH\}"/);
  assert.match(wiring, /EnvironmentFile=\$\{IDLE_OPERATOR_ENV_FILE\}/);
  assert.match(wiring, /EnvironmentFile=\$\{CONTRACT_ENV_FILE\}[\s\S]*EnvironmentFile=\$\{IDLE_OPERATOR_ENV_FILE\}/);
  assert.match(wiring, /migrate_idle_state_lineage\s+systemctl daemon-reload/);
});



test("legacy unpinned Idle service unit is not shipped", async () => {
  await assert.rejects(
    access("systemd/disdex-idle-priority-short.service"),
    /ENOENT/,
    "legacy non-SHA-pinned Idle unit must not exist; only ops/systemd/disdex-idle-priority-short@.service is allowed",
  );
});


test("Idle is wired into release-pinned health snapshot and watchdog", async () => {
  const [snapshot, watchdog, wiring] = await Promise.all([
    readFile("scripts/ops/root/disdex-runner-health-snapshot-current.mjs", "utf8"),
    readFile("scripts/ops/root/disdex-runner-watchdog-current.mjs", "utf8"),
    readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8"),
  ]);

  assert.match(snapshot, /key: "IDLE_PRIORITY_SHORT"/);
  assert.match(snapshot, /disdex-idle-priority-short@\$\{IDLE_PIN\.expectedSha\}\.service/);
  assert.match(snapshot, /DISDEX_HEALTH_SNAPSHOT_IDLE_STATE_PATH/);
  assert.match(snapshot, /idle-priority-short\.json/);
  assert.match(snapshot, /disdex-idle-priority-state\/v2/);

  assert.match(watchdog, /key: "IDLE_PRIORITY_SHORT"/);
  assert.match(watchdog, /DISDEX_WATCHDOG_IDLE_EXPECTED_SHA/);
  assert.match(watchdog, /DISDEX_WATCHDOG_IDLE_SERVICE_UNIT/);
  assert.match(watchdog, /disdex-idle-priority-short@\*\.service/);
  assert.match(watchdog, /disdex-idle-priority-short\.service/);

  assert.match(wiring, /DISDEX_HEALTH_SNAPSHOT_IDLE_EXPECTED_SHA=\$\{DEPLOYED_SHA\}/);
  assert.match(wiring, /DISDEX_HEALTH_SNAPSHOT_IDLE_STATE_PATH=\$\{IDLE_PRIORITY_STATE_ROOT\}\/state\.json/);
  assert.match(wiring, /DISDEX_WATCHDOG_IDLE_EXPECTED_SHA=\$\{DEPLOYED_SHA\}/);
  assert.match(wiring, /DISDEX_WATCHDOG_IDLE_SERVICE_UNIT=\$\{IDLE_UNIT\}/);
});
