#!/usr/bin/env python3
"""Pure regression checks for the STABLE4 DD30 all-runner preflight gate.

These tests never invoke systemd, SSH, exchange APIs, or production files.  They
only prove that the checked-in plan is exact, orders-enabled is scoped to all
seven runners, and the gate remains fail-closed when a plan is tampered with.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / "config" / "disdex-stable4-dd30-allrunner-live-order-enable-plan.json"
MODULE_PATH = ROOT / "scripts" / "ops" / "deploy" / "disdex_stable4_dd30_live_preflight.py"

spec = importlib.util.spec_from_file_location("stable4_dd30_preflight", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Stable4Dd30PreflightContractTests(unittest.TestCase):
    def test_plan_is_exact_and_all_runner_order_enabled(self) -> None:
        raw = PLAN.read_bytes()
        plan_sha = hashlib.sha256(raw).hexdigest()
        value = module.load_plan(PLAN, plan_sha)
        self.assertEqual(value["operation"], "STABLE4_DD30_ALLRUNNERS_LIVE_ORDER_ENABLE")
        self.assertEqual(value["scope"], "STABLE4_DD30_ALLRUNNERS")
        self.assertIs(value["ordersEnabled"], True)
        self.assertEqual(tuple(value["runnerSet"]), module.RUNNERS)
        self.assertEqual(value["economics"]["v4NewEntryDrawdownHoldPct"], 30)
        self.assertEqual(value["economics"]["sharedCryptoDailyLossPct"], 7.5)
        self.assertEqual(
            value["economics"]["grossCaps"],
            {"crypto": 3.0, "stock": 1.5, "total": 3.5, "hype": 1.0},
        )

    def test_tampered_plan_hash_fails_closed(self) -> None:
        raw = PLAN.read_bytes()
        value = json.loads(raw)
        value["ordersEnabled"] = False
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
            with self.assertRaises(module.GateError):
                module.load_plan(path, hashlib.sha256(raw).hexdigest())

    def test_expected_runtime_caps_are_not_legacy_caps(self) -> None:
        self.assertEqual(module.EXPECTED_CAPS["CRYPTO_GROSS_CAP"], 3.0)
        self.assertEqual(module.EXPECTED_CAPS["STOCK_GROSS_CAP"], 1.5)
        self.assertEqual(module.EXPECTED_CAPS["TOTAL_GROSS_CAP"], 3.5)
        self.assertNotEqual(module.EXPECTED_CAPS["STOCK_GROSS_CAP"], 4.0)
        self.assertNotEqual(module.EXPECTED_CAPS["TOTAL_GROSS_CAP"], 4.25)

    def test_gate_has_no_execute_flag(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("--preflight-readonly", source)
        self.assertNotIn("--execute", source)
        self.assertIn("H48_CERTIFICATE_MISSING", source)
        self.assertIn("GLOBAL_HOLD_NOT_PROTECTED", source)


if __name__ == "__main__":
    unittest.main()
