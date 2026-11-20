import importlib.util
import json
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("deploy") / "disdex_stable4_safety_repair_cutover.py"
spec = importlib.util.spec_from_file_location("stable4_safety_repair", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def valid_plan():
    return {
        "schema": "disdex-stable4-safety-repair-plan/v1",
        "target": "professional-dismanager.net",
        "operatorTarget": "DD1296_FINAL_ALLIN_10BPS",
        "candidateType": "combined-v52-q102-safety-repair",
        "components": {
            "v52": {"baseRuntimeSha": module.V52_OLD, "ordersEnabled": False},
            "q102": {"baseRuntimeSha": module.Q102_OLD, "ordersEnabled": False},
        },
        "globalHold": {
            "active": True, "strategyId": "STABLE4_H48_CUTOVER", "action": "HOLD_PROTECTED",
            "scope": "GLOBAL", "operator": "disdex-stable4-formal-owner-hold",
            "mustRemainByteIdentical": True, "digestSha256": module.HOLD_DIGEST,
        },
        "venuePreflight": {
            "signedAsterGets": 3, "requireFlatPositions": True, "requireNoOpenOrders": True,
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
        },
        "cutover": {
            "v52TargetMustDifferFrom": module.V52_OLD,
            "q102TargetMustDifferFrom": module.Q102_OLD,
            "dualRunnerForbidden": True, "clearGlobalHold": False, "enableNewOrders": False,
            "rootOwnedImmutableRelease": True, "formalGithubActionsOnly": True,
        },
        "rollback": {
            "automaticOnFailure": True, "restoreV52": module.V52_OLD,
            "restoreQ102": module.Q102_OLD,
            "requireFreshVenueReconciliationBeforeRestart": True,
        },
        "verification": {
            "postCutoverCycles": 3, "requireV52RestartCountStable": True,
            "requireQ102Freshness": True, "requireGlobalHoldDigestUnchanged": True,
            "requireTradingMutationZero": True,
        },
    }


class Stable4SafetyRepairTests(unittest.TestCase):
    def test_plan_is_monitor_only_and_fail_closed(self):
        self.assertTrue(module.validate_plan(valid_plan()))
        bad = valid_plan()
        bad["cutover"]["enableNewOrders"] = True
        with self.assertRaises(module.ContractError):
            module.validate_plan(bad)
        bad = valid_plan()
        bad["globalHold"]["digestSha256"] = "0" * 64
        with self.assertRaises(module.ContractError):
            module.validate_plan(bad)

    def test_inventory_digest_is_canonical(self):
        value = {"positions": [], "openOrders": []}
        digest = module.inventory_digest(value)
        self.assertEqual(len(digest), 64)
        value["openOrders"].append({"symbol": "DOGEUSDT", "orderId": "1"})
        self.assertNotEqual(digest, module.inventory_digest(value))

    def test_old_runner_mode_allows_symmetric_stopped_repair_baseline(self):
        self.assertEqual(module.old_runner_mode(True, True), "active")
        self.assertEqual(module.old_runner_mode(False, False), "inactive")
        with self.assertRaises(module.ContractError) as ctx:
            module.old_runner_mode(True, False)
        self.assertIn("OLD_RUNNERS_PARTIAL_ACTIVE", str(ctx.exception))

    def test_source_has_no_hold_clear_or_order_enable_path(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('"clearGlobalHold": False', source)
        self.assertIn('"enableNewOrders": False', source)
        self.assertNotIn("order.create", source)
        self.assertNotIn("cancelOrder", source)
        self.assertNotIn("createOrder", source)


if __name__ == "__main__":
    unittest.main()

