import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "disdex-vps-ops-ci.yml"


class VpsOpsCiContractTest(unittest.TestCase):
    def test_current_gate_does_not_block_on_legacy_v52_margin_engine(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        current, legacy = source.split("  legacy-v96-compatibility:", 1)
        self.assertNotIn("scripts/disdex_v52_margin_aware_live_engine.py --self-test", current)
        self.assertNotIn("DISDEX_V96_MAX_GROSS=1.5", current)
        self.assertNotIn("DISDEX_V52_STOCK_GROSS_CAP=1.5", current)
        self.assertNotIn("DISDEX_V52_PORTFOLIO_GROSS_CAP=2.5", current)
        self.assertIn("scripts/disdex_v52_margin_aware_live_engine.py --self-test", legacy)
        self.assertIn("DISDEX_V96_MAX_GROSS=1.5", legacy)
        self.assertIn("DISDEX_V52_STOCK_GROSS_CAP=1.5", legacy)
        self.assertIn("DISDEX_V52_PORTFOLIO_GROSS_CAP=2.5", legacy)
        self.assertIn("continue-on-error: true", legacy)

    def test_current_gate_keeps_current_runtime_safety_checks(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        current, _legacy = source.split("  legacy-v96-compatibility:", 1)
        for required in (
            "scripts/ops/root/disdex-vps-control trading-promote-selftest all",
            "scripts/ops/root/disdex-vps-retention-cleanup --self-test",
            "scripts/ops/root/disdex-current-runtime-wiring",
            "tests/test_runtime_wiring_script.py",
            "tests/watchdog-release-lineage.test.ts",
        ):
            self.assertIn(required, current)


if __name__ == "__main__":
    unittest.main()
