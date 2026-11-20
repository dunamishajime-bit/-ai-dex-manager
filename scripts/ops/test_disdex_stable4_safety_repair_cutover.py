import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


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

    def test_cutover_blocked_reason_keeps_systemd_context_before_truncation(self):
        detail = "COMMAND_FAILED:systemctl start unit.service:" + ("generic " * 80) + "|show=ActiveState=failed"
        blocked = module.cutover_blocked_reason(module.ContractError(detail))
        self.assertIn("show=ActiveState=failed", blocked)

    def test_run_failure_identifies_the_systemd_operation(self):
        result = SimpleNamespace(returncode=1, stdout="", stderr="systemd failure")
        with patch.object(module.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(module.ContractError, r"COMMAND_FAILED:systemctl stop unit\.service"):
                module.run("/usr/bin/systemctl", "stop", "unit.service")

    def test_run_failure_includes_sanitized_systemd_start_context(self):
        result = SimpleNamespace(returncode=1, stdout="", stderr="Job failed: /secret/token? not emitted")
        with patch.object(module.subprocess, "run", return_value=result):
            with self.assertRaises(module.ContractError) as ctx:
                module.run("/usr/bin/systemctl", "start", "unit.service")
        message = str(ctx.exception)
        self.assertIn("COMMAND_FAILED:systemctl start unit.service", message)
        self.assertIn("Job failed", message)
        self.assertNotIn("/secret/token", message)

    def test_systemd_failure_context_includes_safe_status_summary(self):
        failed_start = SimpleNamespace(returncode=1, stdout="", stderr="Job failed")
        show = SimpleNamespace(
            returncode=0,
            stdout="ActiveState=failed\nSubState=failed\nResult=exit-code\nExecMainStatus=1\n",
            stderr="",
        )
        status = SimpleNamespace(
            returncode=3,
            stdout=(
                "Loaded: loaded (/etc/systemd/system/unit.service)\n"
                "Process: 122 ExecStartPre=/usr/bin/install -d /safe (code=exited, status=0/SUCCESS)\n"
                "Process: 124 ExecStartPre=/usr/bin/node " + ("x" * 500) + " (code=exited, status=2/FAILURE)\n"
                "Process: 123 ExecStartPre=/usr/bin/test -f /safe (code=exited, status=1/FAILURE)\n"
            ),
            stderr="",
        )
        journal = SimpleNamespace(returncode=0, stdout="", stderr="")
        with patch.object(module.subprocess, "run", side_effect=[failed_start, show, status, journal]):
            with self.assertRaises(module.ContractError) as ctx:
                module.run("/usr/bin/systemctl", "start", "unit.service")
        message = str(ctx.exception)
        self.assertIn("show=ActiveState=failed", message)
        self.assertIn("status=ExecStartPre code=exited status=1/FAILURE cmd=test", message)
        self.assertIn("status=ExecStartPre code=exited status=2/FAILURE cmd=node", message)
        self.assertNotIn("status=Loaded:", message)
        self.assertIn("status=1/FAILURE", message)
        self.assertLess(
            message.index("status=ExecStartPre code=exited status=1/FAILURE cmd=test"),
            message.index("status=ExecStartPre code=exited status=0/SUCCESS cmd=install"),
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
                "directory": "quality102-causal-v1",
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
            {"directory": "fet-brk48-residual", "file": "state.json", "kind": "UNAVAILABLE"},
        )

    def test_source_has_no_hold_clear_or_order_enable_path(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('"clearGlobalHold": False', source)
        self.assertIn('"enableNewOrders": False', source)
        self.assertNotIn("order.create", source)
        self.assertNotIn("cancelOrder", source)
        self.assertNotIn("createOrder", source)

    def test_monitor_dropins_remove_order_capable_exec_paths(self):
        v52 = module.monitor_dropin_text("V52")
        q102 = module.monitor_dropin_text("Q102")
        for text in (v52, q102):
            self.assertIn("ExecStartPre=", text)
            self.assertIn("ExecStart=", text)
            self.assertIn("DISDEX_RUNTIME_COMMIT_SHA=%i", text)
            self.assertIn("new_orders_allowed=false", text.lower())
            self.assertNotIn("operator-activation-gate", text)
            self.assertNotIn("pending-order-recovery", text)
        self.assertIn("--monitor-only-daemon", v52)
        self.assertIn("disdex-quality102-causal-v1-monitor.ts --daemon", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_MONITOR_ONLY=true", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false", q102)

    def test_monitor_heartbeat_requires_fresh_observing_non_authority(self):
        sha = "a" * 40
        unit = f"disdex-quality102-causal-v1@{sha}.service"
        value = {
            "schema": "disdex-runner-tick/v1",
            "runnerId": "QUALITY102_CAUSAL_V1",
            "runtimeSha": sha,
            "expectedSha": sha,
            "serviceUnit": unit,
            "status": "observing",
            "mode": "MONITOR_ONLY",
            "newOrdersAllowed": False,
            "permissionEvaluation": "MONITOR_ONLY_NO_ORDER_PATH",
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
            "stateChanged": False,
            "updatedAt": "2026-11-21T00:00:00Z",
        }
        self.assertTrue(module.validate_monitor_heartbeat(value, sha, unit, "Q102"))
        blocked = dict(value, status="blocked")
        with self.assertRaises(module.ContractError):
            module.validate_monitor_heartbeat(blocked, sha, unit, "Q102")
        wrong = dict(value, newOrdersAllowed=True)
        with self.assertRaises(module.ContractError):
            module.validate_monitor_heartbeat(wrong, sha, unit, "Q102")

        v52_unit = f"disdex-v52-aster-only@{sha}.service"
        v52_value = dict(value,
            schema="disdex-v52-monitor-heartbeat/v1",
            runnerId="V52_MONITOR",
            serviceUnit=v52_unit,
        )
        self.assertTrue(module.validate_monitor_heartbeat(v52_value, sha, v52_unit, "V52"))


if __name__ == "__main__":
    unittest.main()

