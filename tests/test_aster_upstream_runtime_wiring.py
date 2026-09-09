import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"


class AsterUpstreamRuntimeWiringTests(unittest.TestCase):
    def test_release_requires_recovery_artifacts_and_installs_auto_repair_coordinator(self):
        source = SOURCE.read_text(encoding="utf-8")
        for artifact in (
            '"$CURRENT_RELEASE/lib/aster-readonly-recovery-gate.ts"',
            '"$CURRENT_RELEASE/lib/aster-upstream-recovery-policy.ts"',
            '"$CURRENT_RELEASE/scripts/disdex-aster-readonly-recovery-gate.ts"',
            '"$CURRENT_RELEASE/scripts/disdex-aster-upstream-live-recovery.ts"',
            '"$CURRENT_RELEASE/scripts/ops/root/disdex-v12-kill-switch-auto-repair"',
        ):
            self.assertIn(artifact, source)
        self.assertIn('install -m 0755 "$CURRENT_RELEASE/scripts/ops/root/disdex-v12-kill-switch-auto-repair" /usr/local/libexec/disdex-v12-kill-switch-auto-repair', source)
        self.assertIn('EnvironmentFile=${CONTRACT_ENV_FILE}', source)
        self.assertIn('DISDEX_V52_SERVICE_UNIT=${V52_UNIT}', source)
        self.assertIn('disdex-v12-kill-switch-auto-repair.service.d', source)
        self.assertIn('systemctl reset-failed disdex-v12-kill-switch-auto-repair.service', source)


if __name__ == "__main__":
    unittest.main()
