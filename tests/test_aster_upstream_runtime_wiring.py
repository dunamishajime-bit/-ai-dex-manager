import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"


class AsterUpstreamRuntimeWiringTests(unittest.TestCase):
    def test_release_requires_recovery_artifacts_and_installs_auto_repair_coordinator(self):
        source = SOURCE.read_text(encoding="utf-8")
        for artifact in (
            '"$CURRENT_RELEASE/lib/aster-readonly-recovery-gate.ts"',
            '"$CURRENT_RELEASE/lib/aster-upstream-recovery-policy.ts"',
            '"$CURRENT_RELEASE/lib/disdex-aster-global-rate-budget.ts"',
            '"$CURRENT_RELEASE/scripts/disdex-aster-readonly-recovery-gate.ts"',
            '"$CURRENT_RELEASE/scripts/disdex-aster-upstream-live-recovery.ts"',
            '"$CURRENT_RELEASE/scripts/ops/root/disdex-v12-kill-switch-auto-repair"',
        ):
            self.assertIn(artifact, source)
        self.assertIn('install -m 0755 "$CURRENT_RELEASE/scripts/ops/root/disdex-v12-kill-switch-auto-repair" /usr/local/libexec/disdex-v12-kill-switch-auto-repair', source)
        self.assertIn('EnvironmentFile=${CONTRACT_ENV_FILE}', source)
        contract = source.split('write_atomic "$CONTRACT_ENV_FILE"', 1)[1].split('write_atomic "$HEALTH_SNAPSHOT_ENV_FILE"', 1)[0]
        self.assertIn('DISDEX_SHARED_KILL_SWITCH_FILE=${SHARED_ROOT}/kill-switch.json', contract)
        self.assertIn('DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=${SHARED_ROOT}/aster-rate-budget.json', contract)
        self.assertIn('DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS=50', contract)
        self.assertIn('DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS=5000', contract)
        self.assertIn('SHARED_RISK_UNIT="disdex-shared-crypto-risk@${DEPLOYED_SHA}.service"', source)
        self.assertIn('write_atomic "${SHARED_RISK_DROPIN_DIR}/zzzzzzzzzzzz-current-release-contract.conf"', source)
        self.assertIn('DISDEX_V52_SERVICE_UNIT=${V52_UNIT}', source)
        self.assertIn('disdex-v12-kill-switch-auto-repair.service.d', source)
        self.assertIn('systemctl reset-failed disdex-v12-kill-switch-auto-repair.service', source)
        watchdog = source.split('write_atomic "${WATCHDOG_DROPIN_DIR}/zzzzzzzzzzzz-current-release.conf"', 1)[1].split('write_atomic "${SNAPSHOT_DROPIN_DIR}/zzzzzzzzzzzz-current-release.conf"', 1)[0]
        self.assertIn('WorkingDirectory=${CURRENT_RELEASE}', watchdog)
        self.assertIn('ExecStart=/usr/bin/node ${CURRENT_RELEASE}/scripts/ops/root/disdex-runner-watchdog-current.mjs', watchdog)

    def test_apply_removes_only_stale_auto_repair_v52_sha_pin_dropins(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("remove_stale_auto_repair_unit_pin_dropins", source)
        self.assertIn('DISDEX_V52_SERVICE_UNIT=disdex-v52-aster-only@', source)
        self.assertIn('[[ "$dropin" == "$current_dropin" ]] && continue', source)
        self.assertIn('rm -f -- "$dropin"', source)
        self.assertIn('remove_stale_auto_repair_unit_pin_dropins', source[source.index('apply_wiring()'):])


if __name__ == "__main__":
    unittest.main()
