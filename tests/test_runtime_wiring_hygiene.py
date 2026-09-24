import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WIRING = ROOT / "scripts" / "ops" / "root" / "disdex-current-runtime-wiring"
WATCHDOG = ROOT / "scripts" / "ops" / "root" / "disdex-runner-watchdog-current.mjs"


class RuntimeWiringHygieneTest(unittest.TestCase):
    def test_watchdog_ignores_inactive_and_failed_historical_instances(self):
        source = WATCHDOG.read_text(encoding="utf-8")
        self.assertIn('if (match && !new Set(["inactive", "failed"]).has(match[2])) units.push(match[1]);', source)

    def test_wiring_resets_stale_failed_instances_before_monitor_reactivation(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn("reset_stale_release_failed_units", source)
        reset_call = source.index("  reset_stale_release_failed_units", source.index("systemctl daemon-reload"))
        monitor_call = source.index('systemctl enable --now disdex-v12-kill-switch-auto-repair.path')
        self.assertLess(reset_call, monitor_call)

    def test_wiring_pins_trade_history_sync_to_current_release(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn('HISTORY_SYNC_DROPIN_DIR=', source)
        self.assertIn('scripts/disdex-aster-trade-history-git-sync.ts', source)
        self.assertIn('EnvironmentFile=/etc/disdex/disdex-quality102-causal-v1.env', source)
        self.assertIn('ExecStart=${CURRENT_RELEASE}/node_modules/.bin/tsx scripts/disdex-aster-trade-history-git-sync.ts', source)

    def test_stale_support_cleanup_includes_history_sync_dropins(self):
        source = WIRING.read_text(encoding="utf-8")
        start = source.index("remove_stale_support_release_pin_dropins()")
        end = source.index("reset_stale_release_failed_units()", start)
        self.assertIn('"$HISTORY_SYNC_DROPIN_DIR"', source[start:end])

    def test_history_sync_writes_the_common_current_support_override(self):
        source = WIRING.read_text(encoding="utf-8")
        self.assertIn(
            'write_atomic "${HISTORY_SYNC_DROPIN_DIR}/${CURRENT_SUPPORT_OVERRIDE}"',
            source,
        )
        self.assertNotIn(
            'write_atomic "${HISTORY_SYNC_DROPIN_DIR}/zzzzzzzzzzzz-current-release.conf"',
            source,
        )


if __name__ == "__main__":
    unittest.main()
