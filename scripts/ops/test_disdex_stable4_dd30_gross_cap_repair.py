#!/usr/bin/env python3
"""Pure contract tests for the DD30 gross-cap repair helper."""
from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "ops" / "deploy" / "disdex_stable4_dd30_gross_cap_repair.py"

# The production helper imports the staged read-only preflight.  These tests
# exercise only pure rendering/guard helpers, so a tiny import stub avoids any
# systemd or production-file dependency on a developer workstation.
stub = types.ModuleType("preflight")
stub.GateError = RuntimeError
sys.modules.setdefault("preflight", stub)
spec = importlib.util.spec_from_file_location("stable4_cap_repair", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Stable4GrossCapRepairTests(unittest.TestCase):
    def test_expected_caps_include_dd30_runtime_overrides(self) -> None:
        self.assertEqual(module.CAP_OVERRIDES["CRYPTO_GROSS_CAP"], "3.0")
        self.assertEqual(module.CAP_OVERRIDES["STOCK_GROSS_CAP"], "1.5")
        self.assertEqual(module.CAP_OVERRIDES["TOTAL_GROSS_CAP"], "3.5")
        self.assertEqual(module.CAP_OVERRIDES["DISDEX_HYPE_ZEC_MAX_GROSS"], "1.0")
        self.assertEqual(module.CAP_OVERRIDES["DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT"], "7.5")

    def test_dropin_is_deterministic_and_has_no_order_enable_flags(self) -> None:
        rendered = module.render_dropin()
        self.assertEqual(rendered, module.render_dropin())
        self.assertIn('[Service]\n', rendered)
        self.assertIn('Environment="STOCK_GROSS_CAP=1.5"', rendered)
        self.assertEqual(module.monitor_order_flags(rendered), [])

    def test_monitor_guard_detects_shell_and_environment_true_values(self) -> None:
        self.assertIn("V12_V4_ORDERS_ENABLED", module.monitor_order_flags("Environment=V12_V4_ORDERS_ENABLED=true"))
        self.assertIn("PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED", module.monitor_order_flags("export PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=1"))
        self.assertIn("QUALITY102_CAUSAL_V1_OPERATOR_ARMED", module.monitor_order_flags("Environment=QUALITY102_CAUSAL_V1_OPERATOR_ARMED=yes"))
        self.assertEqual(module.monitor_order_flags("Environment=V12_V4_ORDERS_ENABLED=false"), [])

    def test_source_and_plan_are_pinned(self) -> None:
        self.assertEqual(len(module.SOURCE_SHA), 40)
        self.assertEqual(len(module.PLAN_SHA256), 64)
        self.assertEqual(module.DROPIN_NAME, "zzzz-stable4-dd30-gross-cap.conf")


if __name__ == "__main__":
    unittest.main()

