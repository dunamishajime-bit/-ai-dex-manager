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
    def test_default_operator_paths_use_disdex_unified_deploy_root(self):
        self.assertEqual(
            module.DEFAULT_PUBLIC_KEY,
            Path("/var/lib/disdex/unified-deploy/owner-approval-public.pem"),
        )
        self.assertEqual(
            module.DEFAULT_NONCE_DIR,
            Path("/var/lib/disdex/unified-deploy/nonces"),
        )

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

    def test_old_runner_runtime_mode_allows_controlled_quiesce(self):
        self.assertEqual(
            module.old_runner_runtime_mode(("active", "running"), ("active", "running")),
            "active",
        )
        self.assertEqual(
            module.old_runner_runtime_mode(("inactive", "dead"), ("failed", "failed")),
            "inactive",
        )
        self.assertEqual(
            module.old_runner_runtime_mode(("active", "running"), ("activating", "auto-restart")),
            "quiesce",
        )
        self.assertEqual(
            module.old_runner_runtime_mode(("activating", "auto-restart"), ("active", "running")),
            "quiesce",
        )

    def test_old_runner_runtime_mode_rejects_unsafe_mixed_states(self):
        for states in (
            (("active", "running"), ("inactive", "dead")),
            (("activating", "auto-restart"), ("inactive", "dead")),
            (("activating", "auto-restart"), ("activating", "auto-restart")),
            (("unknown", "unknown"), ("inactive", "dead")),
        ):
            with self.assertRaises(module.ContractError):
                module.old_runner_runtime_mode(*states)

    def test_global_hold_metadata_matches_runtime_owner_contract(self):
        self.assertIsNone(module.validate_hold_metadata(0, 0o600))
        self.assertIsNone(module.validate_hold_metadata(1000, 0o600))
        for uid, mode in ((1001, 0o600), (1000, 0o640), (0, 0o644)):
            with self.assertRaises(module.ContractError):
                module.validate_hold_metadata(uid, mode)

    def test_cutover_blocked_reason_preserves_the_fail_closed_detail(self):
        error = module.ContractError("TARGET_RESTART_COUNT_CHANGED")
        self.assertEqual(
            module.cutover_blocked_reason(error),
            "CUTOVER_BLOCKED:ContractError:TARGET_RESTART_COUNT_CHANGED",
        )

    def test_margin_guard_diagnostic_is_sanitized_and_reports_freshness(self):
        value = {
            "stage": "DATA_UNAVAILABLE",
            "ordersAllowed": False,
            "checkedAt": 1_000,
            "reason": "MARGIN_DATA_UNAVAILABLE",
            "consecutiveFailures": 4,
            "pollIntervalMs": 60_000,
            "lastError": "Margin Guard ownership state identity mismatch: /var/lib/disdex/quality102-causal-v1/state.json: expected=QUALITY102_CAUSAL_V1, got=WRONG_STATE",
            "balance": "must not appear",
        }
        diagnostic = json.loads(module.margin_guard_diagnostic(value, now_ms=2_000))
        self.assertEqual(diagnostic["stage"], "DATA_UNAVAILABLE")
        self.assertFalse(diagnostic["ordersAllowed"])
        self.assertEqual(diagnostic["checkedAtAgeMs"], 1_000)
        self.assertEqual(diagnostic["reason"], "MARGIN_DATA_UNAVAILABLE")
        self.assertEqual(diagnostic["consecutiveFailures"], 4)
        self.assertEqual(diagnostic["pollIntervalMs"], 60_000)
        self.assertEqual(diagnostic["lastErrorClass"], "OWNERSHIP_STATE")
        self.assertEqual(
            diagnostic["ownership"],
            {
                "file": "state.json",
                "kind": "IDENTITY_MISMATCH",
                "expected": "QUALITY102_CAUSAL_V1",
                "got": "WRONG_STATE",
            },
        )
        self.assertNotIn("balance", diagnostic)

    def test_margin_guard_ownership_diagnostic_handles_unavailable_state(self):
        value = {
            "stage": "DATA_UNAVAILABLE",
            "lastError": "Margin Guard ownership state unavailable: /var/lib/disdex/fet-brk48-residual/state.json: permission denied",
        }
        diagnostic = json.loads(module.margin_guard_diagnostic(value, now_ms=2_000))
        self.assertEqual(diagnostic["lastErrorClass"], "OWNERSHIP_STATE")
        self.assertEqual(
            diagnostic["ownership"],
            {"file": "state.json", "kind": "UNAVAILABLE"},
        )

    def test_source_has_no_hold_clear_or_order_enable_path(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('"clearGlobalHold": False', source)
        self.assertIn('"enableNewOrders": False', source)
        self.assertNotIn("order.create", source)
        self.assertNotIn("cancelOrder", source)
        self.assertNotIn("createOrder", source)


if __name__ == "__main__":
    unittest.main()

