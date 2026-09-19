import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-coherence-guard"
WIRING = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"
SERVICE = ROOT / "ops" / "systemd" / "disdex-current-runtime-coherence-guard.service"
TIMER = ROOT / "ops" / "systemd" / "disdex-current-runtime-coherence-guard.timer"


class RuntimeCoherenceGuardTest(unittest.TestCase):
    def test_guard_covers_all_current_runtime_families(self):
        source = GUARD.read_text(encoding="utf-8")
        for family in (
            "disdex-v12-x1-all",
            "disdex-pengu-dual-ls-v2",
            "disdex-quality102-causal-v1",
            "disdex-v52-aster-only",
            "disdex-shared-crypto-risk",
            "disdex-v12-v52-margin-guard",
        ):
            self.assertIn(f'"{family}"', source)
        self.assertIn("verify_current_units_active", source)
        self.assertIn("retire_stale_units", source)
        self.assertIn("monitor_pins_current", source)
        self.assertIn("heartbeat_identity_current", source)

    def test_guard_only_repairs_after_current_units_are_active(self):
        source = GUARD.read_text(encoding="utf-8")
        auto_block = source.split("--auto)", 1)[1]
        self.assertIn("if ! verify_current_units_active; then", auto_block)
        self.assertIn("DISDEX_CURRENT_RUNTIME_COHERENCE_DEFERRED", auto_block)
        self.assertIn("repair_coherence", auto_block)

    def test_guard_repins_monitors_before_retiring_stale_units(self):
        source = GUARD.read_text(encoding="utf-8")
        repair = source.split("repair_coherence()", 1)[1].split("main()", 1)[0]
        self.assertLess(
            repair.index('disdex-current-runtime-wiring" --apply'),
            repair.index("retire_stale_units"),
        )
        self.assertIn("systemctl start disdex-runner-health-snapshot.service", repair)
        self.assertIn("systemctl start disdex-runner-watchdog.service", repair)

    def test_wiring_installs_and_enables_guard_timer(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("disdex-current-runtime-coherence-guard", source)
        self.assertIn('ensure_monitor_timer_active "disdex-current-runtime-coherence-guard.timer"', source)

    def test_systemd_timer_runs_auto_guard(self):
        service = SERVICE.read_text(encoding="utf-8")
        timer = TIMER.read_text(encoding="utf-8")
        self.assertIn("ExecStart=/usr/local/sbin/disdex-current-runtime-coherence-guard --auto", service)
        self.assertIn("OnUnitInactiveSec=1min", timer)
        self.assertIn("WantedBy=timers.target", timer)


if __name__ == "__main__":
    unittest.main()
