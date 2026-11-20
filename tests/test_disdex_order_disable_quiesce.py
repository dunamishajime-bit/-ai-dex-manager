import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "ops" / "deploy" / "disdex_order_disable_quiesce.py"
spec = importlib.util.spec_from_file_location("disdex_order_disable_quiesce", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def plan_bytes(orders_enabled=True):
    return (json.dumps(
        {
            "schema": "disdex-unified-deployment-plan/v2",
            "deploymentTarget": "professional-dismanager.net",
            "scope": "V12_V4",
            "sourceSha": "7688ed7c93a1918d8b44837339b7da5584a868f5",
            "ordersEnabled": orders_enabled,
            "runners": {"V12_V4": "e788abc82e80f9fc7ab0e1ba83fdb8be267eb513"},
            "operatorTarget": "DD1296_FINAL_ALLIN_10BPS",
        },
        sort_keys=True,
        separators=(",", ":"),
    ) + "\n").encode()


class OrderDisableQuiesceTests(unittest.TestCase):
    def test_build_quiesced_plan_changes_only_orders_flag(self):
        original = json.loads(plan_bytes())
        changed = json.loads(module.build_quiesced_plan(plan_bytes()))
        self.assertIs(changed["ordersEnabled"], False)
        changed_without_flag = dict(changed)
        changed_without_flag.pop("ordersEnabled")
        original_without_flag = dict(original)
        original_without_flag.pop("ordersEnabled")
        self.assertEqual(changed_without_flag, original_without_flag)

    def test_build_quiesced_plan_rejects_already_disabled(self):
        with self.assertRaisesRegex(module.ContractError, "CURRENT_PLAN_ALREADY_DISABLED"):
            module.build_quiesced_plan(plan_bytes(False))

    def test_quiesce_evidence_binds_unified_plan_identity(self):
        raw = json.loads(plan_bytes())
        raw["schema"] = "other-plan/v1"
        hold_raw = (b'{"active":true,"action":"HOLD_PROTECTED","scope":"GLOBAL",'
                    b'"operator":"disdex-stable4-formal-owner-hold","recoverable":false}\n')
        with self.assertRaisesRegex(module.ContractError, "CURRENT_PLAN_SCHEMA_INVALID"):
            module.validate_quiesce_evidence(
                (json.dumps(raw) + "\n").encode(), hold_raw,
                hashlib.sha256(hold_raw).hexdigest(),
                [{"positions": [], "openOrders": []}] * 3,
            )

    def test_atomic_quiesce_requires_cas_and_preserves_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "current-plan.json"
            original = plan_bytes()
            path.write_bytes(original)
            with self.assertRaisesRegex(module.ContractError, "CURRENT_PLAN_CAS_MISMATCH"):
                module.quiesce_plan_file(path, "0" * 64)
            self.assertEqual(path.read_bytes(), original)

    def test_postcondition_failure_restores_exact_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "current-plan.json"
            original = plan_bytes()
            path.write_bytes(original)
            expected = hashlib.sha256(original).hexdigest()

            def reject(_raw):
                raise module.ContractError("POSTCONDITION_REJECTED")

            with self.assertRaisesRegex(module.ContractError, "POSTCONDITION_REJECTED"):
                module.quiesce_plan_file(path, expected, postcondition=reject)
            self.assertEqual(path.read_bytes(), original)

    def test_quiesce_requires_flat_signed_get_and_unchanged_hold(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = root / "current-plan.json"
            hold = root / "kill-switch.json"
            plan.write_bytes(plan_bytes())
            hold_raw = (b'{"active":true,"action":"HOLD_PROTECTED","scope":"GLOBAL",'
                        b'"operator":"disdex-stable4-formal-owner-hold","recoverable":false}\n')
            hold.write_bytes(hold_raw)
            result = module.validate_quiesce_evidence(
                plan.read_bytes(), hold.read_bytes(), hashlib.sha256(hold_raw).hexdigest(),
                [
                    {"positions": [], "openOrders": []},
                    {"positions": [], "openOrders": []},
                    {"positions": [], "openOrders": []},
                ],
            )
            self.assertEqual(result["ordersSent"], 0)
            with self.assertRaisesRegex(module.ContractError, "VENUE_NOT_FLAT"):
                module.validate_quiesce_evidence(
                    plan.read_bytes(), hold.read_bytes(), hashlib.sha256(hold_raw).hexdigest(),
                    [{"positions": [{"symbol": "DOGEUSDT"}], "openOrders": []}] * 3,
                )


if __name__ == "__main__":
    unittest.main()
