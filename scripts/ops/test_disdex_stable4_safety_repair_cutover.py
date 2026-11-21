import importlib.util
import hashlib
import json
import stat
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

    def test_margin_guard_workflow_never_changes_active_writers_state(self):
        workflow = (Path(__file__).parents[2] / ".github" / "workflows" /
                    "disdex-stable4-safety-repair-cutover.yml").read_text(encoding="utf-8")
        self.assertIn("Verify private shared Margin Guard writer contract (read-only)", workflow)
        self.assertIn("MARGIN_GUARD_PRIVATE_WRITER_CONTRACT_PASS=TRUE", workflow)
        self.assertIn("systemctl is-active --quiet \"$guard\"", workflow)
        margin_step = workflow.split(
            "Verify private shared Margin Guard writer contract (read-only)", 1
        )[1].split("Root read-only preflight", 1)[0]
        self.assertNotIn('chown root:root "$state"', margin_step)
        self.assertNotIn('chmod 600 "$state"', margin_step)

    def test_margin_guard_private_atomic_writer_security_boundary(self):
        private_dir = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=1000, st_gid=1000)
        writer = SimpleNamespace(st_mode=stat.S_IFREG | 0o660, st_uid=1000,
                                 st_gid=1000, st_size=1822)
        verifier = module.trusted_margin_guard_snapshot_metadata
        # Existing deploy-owned Margin Guard writes 0660 under a private 0700
        # directory. This does not grant effective access to other group users.
        self.assertTrue(verifier(private_dir, writer, 1000, 1000))
        root_staged = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0,
                                      st_gid=0, st_size=1822)
        self.assertTrue(verifier(private_dir, root_staged, 1000, 1000))
        # No broader permission acceptance: any group-accessible directory,
        # public file, untrusted owner or oversized state is rejected.
        for parent in (
            SimpleNamespace(st_mode=stat.S_IFDIR | 0o770, st_uid=1000, st_gid=1000),
            SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=1001, st_gid=1000),
            SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=1000, st_gid=1001),
        ):
            self.assertFalse(verifier(parent, writer, 1000, 1000))
        for candidate in (
            SimpleNamespace(st_mode=stat.S_IFREG | 0o666, st_uid=1000, st_gid=1000, st_size=1822),
            SimpleNamespace(st_mode=stat.S_IFREG | 0o660, st_uid=1001, st_gid=1000, st_size=1822),
            SimpleNamespace(st_mode=stat.S_IFREG | 0o660, st_uid=1000, st_gid=1001, st_size=1822),
            SimpleNamespace(st_mode=stat.S_IFLNK | 0o660, st_uid=1000, st_gid=1000, st_size=1822),
            SimpleNamespace(st_mode=stat.S_IFREG | 0o660, st_uid=1000, st_gid=1000, st_size=1_000_001),
        ):
            self.assertFalse(verifier(private_dir, candidate, 1000, 1000))

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

    def test_cutover_blocked_reason_does_not_reorder_existing_status_first_context(self):
        detail = "COMMAND_FAILED:systemctl start unit.service:status=ExecStartPre code=exited status=2/FAILURE cmd=node|show=Result=exit-code"
        blocked = module.cutover_blocked_reason(module.ContractError(detail))
        self.assertIn("status=ExecStartPre code=exited status=2/FAILURE cmd=node", blocked)
        self.assertNotIn("CUTOVER_BLOCKED:ContractError:show=", blocked)

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

    def test_systemd_failure_context_prioritizes_safe_journal_cause(self):
        failed_start = SimpleNamespace(returncode=1, stdout="", stderr="Job failed")
        show = SimpleNamespace(returncode=0, stdout="ActiveState=activating\n", stderr="")
        status = SimpleNamespace(
            returncode=3,
            stdout="Process: 124 ExecStart=/usr/bin/python (code=exited, status=1/FAILURE)\n",
            stderr="",
        )
        journal = SimpleNamespace(
            returncode=0,
            stdout=(
                'File "engine.py", line 1, in run\n'
                '    raise RuntimeError(f"STRICT_PORTFOLIO_CONFIG_MISMATCH")\n'
                "RuntimeError: STRICT_PORTFOLIO_CONFIG_MISMATCH:V12_GROSS_CAP:2.5:EXPECTED_2.0\n"
            ),
            stderr="",
        )
        with patch.object(module.subprocess, "run", side_effect=[failed_start, show, status, journal]):
            with self.assertRaises(module.ContractError) as ctx:
                module.run("/usr/bin/systemctl", "start", "unit.service")
        message = str(ctx.exception)
        self.assertIn("journal=RuntimeError: STRICT_PORTFOLIO_CONFIG_MISMATCH:V12_GROSS_CAP:2.5:EXPECTED_2.0", message)
        self.assertNotIn("journal=raise RuntimeError", message)
        self.assertLess(message.index("journal="), message.index("status=Process pid="))

    def test_wait_stable_preserves_bounded_systemd_context(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('TARGET_RUNNER_NOT_STABLE:" + unit + suffix', source)
        self.assertIn('context[:640]', source)

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

    def test_v52_monitor_instance_clones_exact_template_and_rebinds_only_guard(self):
        source = (
            "[Unit]\\n"
            "After=network-online.target disdex-stock-reference-free.service disdex-v12-v52-margin-guard@%i.service\\n"
            "Requires=disdex-stock-reference-free.service disdex-v12-v52-margin-guard@%i.service\\n"
            "[Service]\\n"
            "NoNewPrivileges=true\\n"
            "ProtectSystem=strict\\n"
            "PrivateTmp=true\\n"
        ).encode()
        digest = hashlib.sha256(source).hexdigest()
        with patch.object(module, "V52_MONITOR_TEMPLATE_SHA256", digest):
            effective = module.v52_monitor_instance_unit_text(source).decode()
            self.assertIn("Requires=disdex-stock-reference-free.service " + module.MARGIN_GUARD_UNIT, effective)
            self.assertIn("After=network-online.target disdex-stock-reference-free.service " + module.MARGIN_GUARD_UNIT, effective)
            self.assertNotIn("disdex-v12-v52-margin-guard@%i.service", effective)
            self.assertIn("NoNewPrivileges=true", effective)
            self.assertIn("ProtectSystem=strict", effective)
            with self.assertRaises(module.ContractError):
                module.v52_monitor_instance_unit_text(source + b"# unexpected template mutation\\n")

    def test_v52_monitor_dependency_replacement_is_exact_and_rollback_protected(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("V52_MONITOR_INSTANCE_UNIT", source)
        self.assertIn("TARGET_V52_MONITOR_INACTIVE_CANDIDATE_GUARD_DEPENDENCY", source)
        self.assertIn("TARGET_V52_MONITOR_SHARED_GUARD_NOT_BOUND", source)
        self.assertIn("snapshot[V52_MONITOR_INSTANCE_UNIT]", source)
        self.assertIn("write_atomic(V52_MONITOR_INSTANCE_UNIT, instance_data, (0, 0, 0o644))", source)
        self.assertIn("for path, (existed, previous, meta) in snapshot.items():", source)

    def test_q102_tick_timestamp_string_keeps_freshness_gate_exact(self):
        # poll_cycles records str(tick.updatedAt), even when the tick is
        # numeric epoch-ms. This must never be mistaken for stale/zero.
        stamp_ms = 1795237304000
        self.assertEqual(module.timestamp_ms(stamp_ms), stamp_ms)
        self.assertEqual(module.timestamp_ms(str(stamp_ms)), stamp_ms)
        self.assertEqual(module.timestamp_ms("1795237304"), stamp_ms)
        self.assertEqual(module.timestamp_ms(" 1795237304000 "), stamp_ms)
        self.assertEqual(module.timestamp_ms(True), 0)
        for bad in ("", "not-a-date", "17952373040", "-1795237304000", "17952373040000", None):
            self.assertEqual(module.timestamp_ms(bad), 0)
        from datetime import datetime, timezone
        iso = datetime.fromtimestamp(stamp_ms / 1000, timezone.utc).isoformat()
        self.assertEqual(module.timestamp_ms(iso), stamp_ms)

    def test_monitor_dropins_remove_order_capable_exec_paths(self):
        v52 = module.monitor_dropin_text("V52")
        q102 = module.monitor_dropin_text("Q102")
        for text in (v52, q102):
            self.assertIn("[Unit]", text)
            self.assertIn("Requires=\n", text)
            self.assertIn("Wants=\n", text)
            self.assertIn("After=\n", text)
            self.assertIn("WorkingDirectory=/home/deploy/disdex-trading/releases/%i", text)
            if text is v52:
                self.assertIn(
                    "DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT=I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY",
                    text,
                )
                self.assertIn("DISDEX_V52_STOCK_GROSS_CAP=4.0", text)
                self.assertIn("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json", text)
                self.assertIn("DISDEX_V52_MONITOR_BUDGET_BROKER_SHA=25d4a86f541a33564c8060bc71633fd810ac9370", text)
                self.assertIn("DISDEX_V52_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/v52-monitor.json", text)
                self.assertIn("STRICT_PORTFOLIO_PLANNER_ACTIVE=true", text)
            self.assertIn("ExecStartPre=", text)
            self.assertIn("ExecStart=", text)
            self.assertIn("DISDEX_RUNTIME_COMMIT_SHA=%i", text)
            self.assertIn("new_orders_allowed=false", text.lower())
            self.assertNotIn("operator-activation-gate", text)
            self.assertNotIn("pending-order-recovery", text)
        self.assertIn("--monitor-only-daemon", v52)
        self.assertIn("scripts/disdex_v52_aster_only_live_engine.py", v52)
        self.assertIn("STRICT_PORTFOLIO_PLANNER_ACTIVE=true", v52)
        self.assertIn("DISDEX_V52_PORTFOLIO_GROSS_CAP=4.25", v52)
        self.assertIn("QUALITY102_LIVE_ENABLED=false", v52)
        self.assertIn("QUALITY102_LIVE_SELECTOR_PARITY=false", v52)
        self.assertNotIn("vendor-stock-site-packages", v52)
        self.assertIn("disdex-quality102-causal-v1-monitor.ts --daemon", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_MONITOR_ONLY=true", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false", q102)
        self.assertIn("ExecStart=/bin/sh -ec 'export DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_ENABLED=false", q102)
        self.assertIn(
            "QUALITY102_CAUSAL_V1_SYMBOLS=SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT",
            q102,
        )
        self.assertIn("QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7.5", q102)
        # Legacy EnvironmentFile still contains MAX_GROSS=0.50. Both the
        # drop-in's static environment and ExecStart export must select the
        # immutable Q102 policy contract (3.0) in *monitor-only* mode.
        self.assertEqual(q102.count("QUALITY102_CAUSAL_V1_MAX_GROSS=3.0"), 2)
        # The old EnvironmentFile sets DERIVED_HIGH_VOL_ONLY, but the current
        # immutable Q102 causal-v4 code requires the CAUSAL_V4 selector.
        self.assertEqual(q102.count("QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4"), 2)
        self.assertIn("DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false", q102)

    def test_v52_launcher_is_manifested_by_formal_workflow(self):
        workflow = (
            Path(__file__).parents[2]
            / ".github"
            / "workflows"
            / "disdex-stable4-safety-repair-cutover.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("'scripts/disdex_v52_aster_only_live_engine.py'", workflow)

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
        tick_only = dict(v52_value, schema="disdex-runner-tick/v1", updatedAt=None, tickCompletedAt=1_763_688_000_000)
        self.assertTrue(module.validate_monitor_heartbeat(tick_only, sha, v52_unit, "V52"))

    def test_poll_cycles_identifies_blocked_runner_and_reason(self):
        sha = module.TARGET
        q102_unit = f"disdex-quality102-causal-v1@{sha}.service"
        q102 = {
            "schema": "disdex-runner-tick/v1",
            "runnerId": "QUALITY102_CAUSAL_V1",
            "runtimeSha": sha,
            "expectedSha": sha,
            "serviceUnit": q102_unit,
            "status": "blocked",
            "reason": "QUALITY102_MONITOR_READ_FAILED:state stale",
            "mode": "MONITOR_ONLY",
            "newOrdersAllowed": False,
            "permissionEvaluation": "MONITOR_ONLY_NO_ORDER_PATH",
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
            "stateChanged": False,
            "updatedAt": "2026-11-21T00:00:00Z",
        }
        v52 = dict(q102,
            schema="disdex-v52-monitor-heartbeat/v1",
            runnerId="V52_MONITOR",
            serviceUnit=f"disdex-v52-aster-only@{sha}.service",
            status="observing",
            reason="ok",
        )

        class FakePath:
            def __init__(self, value):
                self.value = value

            def is_file(self):
                return True

            def is_symlink(self):
                return False

            def read_bytes(self):
                return json.dumps(self.value).encode("utf-8")

            def stat(self):
                return SimpleNamespace(st_mtime_ns=1)

        with patch.object(module, "HEARTBEAT_TICKS", {"Q102": FakePath(q102), "V52": FakePath(v52)}):
            with self.assertRaisesRegex(
                module.ContractError,
                r"MONITOR_HEARTBEAT_STATUS_INVALID:runner=Q102:status=blocked:reason=QUALITY102_MONITOR_READ_FAILED:state stale",
            ):
                module.poll_cycles({"Q102": (0, ""), "V52": (0, "")}, timeout=1)

    def test_poll_cycles_uses_monitor_ticks_not_supervisor_heartbeats(self):
        sha = module.TARGET

        def tick(runner: str, unit: str) -> dict:
            return {
                "schema": "disdex-runner-tick/v1",
                "runnerId": runner,
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

        class AdvancingPath:
            def __init__(self, value):
                self.value = value
                self.reads = 0

            def is_file(self):
                return True

            def is_symlink(self):
                return False

            def read_bytes(self):
                return json.dumps(self.value).encode("utf-8")

            def stat(self):
                self.reads += 1
                return SimpleNamespace(st_mtime_ns=self.reads)

        ticks = {
            "Q102": AdvancingPath(tick(
                "QUALITY102_CAUSAL_V1",
                f"disdex-quality102-causal-v1@{sha}.service",
            )),
            "V52": AdvancingPath(tick(
                "V52_MONITOR",
                f"disdex-v52-aster-only@{sha}.service",
            )),
        }
        supervisor_heartbeats = {
            name: AdvancingPath({"schema": "disdex-runner-heartbeat/v1"})
            for name in ticks
        }
        with patch.object(module, "HEARTBEAT_TICKS", ticks), \
             patch.object(module, "HEARTBEATS", supervisor_heartbeats), \
             patch.object(module.time, "sleep", lambda _seconds: None):
            result = module.poll_cycles({"Q102": (0, ""), "V52": (0, "")}, timeout=1)
        self.assertGreaterEqual(result["Q102"][0], 3)
        self.assertGreaterEqual(result["V52"][0], 3)


if __name__ == "__main__":
    unittest.main()

