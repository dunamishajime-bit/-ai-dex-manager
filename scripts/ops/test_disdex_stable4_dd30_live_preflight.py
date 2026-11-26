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
OLD_PLAN = ROOT / "config" / "disdex-stable4-dd30-allrunner-live-order-enable-plan.json"
PLAN = ROOT / "docs" / "production" / "stable4-dd30-live-plan-candidate-20261125.json"
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
            {"crypto": 3.0, "stock": 4.0, "total": 4.25, "hype": 1.5},
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
        self.assertEqual(module.EXPECTED_CAPS["STOCK_GROSS_CAP"], 4.0)
        self.assertEqual(module.EXPECTED_CAPS["TOTAL_GROSS_CAP"], 4.25)
        self.assertNotEqual(module.EXPECTED_CAPS["STOCK_GROSS_CAP"], 1.5)
        self.assertNotEqual(module.EXPECTED_CAPS["TOTAL_GROSS_CAP"], 3.5)

    def test_dd30_source_baseline_blocks_current_inconsistent_live_plan(self) -> None:
        baseline = json.loads((ROOT / "docs" / "production" /
            "STABLE4_DD30_MONITOR_ONLY_ROOT_PLAN_20261123.json").read_text(encoding="utf-8"))
        expected = baseline["economics"]
        self.assertEqual(
            (expected["cryptoGrossCap"], expected["stockGrossCap"], expected["totalGrossCap"]),
            (3.0, 4.0, 4.25),
        )
        plan = module.load_plan(PLAN, hashlib.sha256(PLAN.read_bytes()).hexdigest())
        self.assertEqual(plan["reviewStatus"], "DRAFT_NOT_AUTHORIZED")
        module.require_stable4_dd30_gross_source_consistency(plan)
        with self.assertRaisesRegex(module.GateError, "PLAN_GROSS_INVALID"):
            module.load_plan(OLD_PLAN, hashlib.sha256(OLD_PLAN.read_bytes()).hexdigest())
        plan["economics"]["grossCaps"]["total"] = 3.5
        with self.assertRaisesRegex(module.GateError, "STABLE4_DD30_GROSS_LINEAGE_MISMATCH"):
            module.require_stable4_dd30_gross_source_consistency(plan)

    def test_actual_environment_cap_parser_is_strict(self) -> None:
        payload = b"\0".join(f"{key}={value}".encode() for key, value in module.EXPECTED_CAPS.items()) + b"\0"
        self.assertEqual(module.caps_from_process_environment(payload), module.EXPECTED_CAPS)
        with self.assertRaisesRegex(module.GateError, "GROSS_CAP_DUPLICATE"):
            module.caps_from_process_environment(payload + b"TOTAL_GROSS_CAP=3.5\0")
        with self.assertRaisesRegex(module.GateError, "GROSS_CAP_INVALID"):
            module.caps_from_process_environment(payload.replace(b"4.25", b"NaN"))
        with self.assertRaisesRegex(module.GateError, "GROSS_CAP_MISSING"):
            module.caps_from_process_environment(b"")

    def test_gate_has_no_execute_flag(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("--preflight-readonly", source)
        self.assertNotIn("--execute", source)
        self.assertIn("H48_CERTIFICATE_MISSING", source)
        self.assertIn("GLOBAL_HOLD_NOT_PROTECTED", source)


if __name__ == "__main__":
    unittest.main()
