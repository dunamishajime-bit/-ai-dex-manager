import json
import os
import pathlib
import stat
import tempfile
import unittest
from unittest.mock import patch

import scripts.ops.deploy.disdex_stable4_dd30_monitor_cutover as cutover

from scripts.ops.deploy.disdex_stable4_dd30_monitor_cutover import (
    HASH_RE,
    HOLD_DIGEST,
    RUNNER_IDS,
    dropin_text,
    harden_immutable_tree,
    hold_metadata_valid,
    q102_metadata_valid,
    materialize_v4_staged_overlay,
    parse_unit_health_snapshot,
    target_plan,
    target_units,
    validate_plan,
    validate_evidence,
)


ROOT = pathlib.Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/production/STABLE4_DD30_MONITOR_ONLY_ROOT_PLAN_20261123.json"
GOAL = ROOT / "docs/implementation/goal-campaigns/8b007d5a-f46c-4752-9f71-70d3967712c0.json"
WORKFLOW = ROOT / ".github/workflows/disdex-stable4-dd30-monitor-cutover.yml"
PLAN_SHA = "15dc92d58dbced738cf57dd7a91396f73bd3875a3e6bd2cd100a3ee649ce4f5b"


class Stable4Dd30MonitorCutoverTest(unittest.TestCase):
    def test_root_plan_is_bound_to_monitor_only_goal(self):
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        validate_plan(plan, PLAN_SHA)
        self.assertFalse(plan["ordersEnabled"])
        self.assertEqual(plan["globalHold"]["digestSha256"], HOLD_DIGEST)
        self.assertEqual(set(row["id"] for row in plan["runnerTargets"]), set(RUNNER_IDS))

    def test_each_runner_dropin_has_explicit_no_order_entrypoint(self):
        target = "a" * 40
        units = target_units(target)
        expected = {
            "V12_V4": ("--monitor-only --daemon", "V12_V4_ORDERS_ENABLED=false"),
            "PENGU_V8": ("PENGU_DUAL_LS_V2_MODE=SHADOW", "PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false"),
            "QUALITY102_CAUSAL_V1": ("disdex-quality102-causal-v1-monitor.ts --daemon", "QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false"),
            "V52": ("--monitor-only-daemon", "DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false"),
            "FET_BRK48_RESIDUAL": ("disdex-fet-brk48-shadow-runner.ts --daemon", "FET_BRK48_SHADOW_STATE_PATH="),
            "IDLE_PRIORITY_SHORT": ("DISDEX_IDLE_PRIORITY_MODE=SHADOW", "DISDEX_IDLE_PRIORITY_ENABLED=true"),
            "HYPE_TREND_LONG": ("DISDEX_HYPE_ZEC_MODE=SHADOW", "DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED=false"),
        }
        for runner in RUNNER_IDS:
            text = dropin_text(runner, target, units[runner])
            self.assertIn(expected[runner][0], text, runner)
            self.assertIn(expected[runner][1], text, runner)
            self.assertNotIn("--mode live --daemon'", text)
        v52 = dropin_text("V52", target, units["V52"])
        self.assertIn("export DISDEX_V52_MONITOR_ONLY=true DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false", v52)
        v4 = dropin_text("V12_V4", target, units["V12_V4"])
        self.assertIn("export V12_V4_OPERATION_MODE=MONITOR_ONLY V12_V4_ORDERS_ENABLED=false DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json", v4)
        self.assertNotIn("25d4a86f541a33564c8060bc71633fd810ac9370", v4)
        self.assertIn(f"Requires=disdex-v4-rate-budget-broker@{target}.service", v4)
        self.assertIn(f"After=disdex-v4-rate-budget-broker@{target}.service", v4)
        self.assertIn(f"DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=/run/disdex-v4-budget-{target}/budget.sock", v4)
        pengu = dropin_text("PENGU_V8", target, units["PENGU_V8"])
        self.assertIn("export PENGU_DUAL_LS_V2_MODE=SHADOW PENGU_DUAL_LS_V2_ENABLED=true PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED=false PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7.5 DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5", pengu)
        q102 = dropin_text("QUALITY102_CAUSAL_V1", target, units["QUALITY102_CAUSAL_V1"])
        self.assertIn("export QUALITY102_CAUSAL_V1_MODE=LIVE QUALITY102_CAUSAL_V1_MONITOR_ONLY=true QUALITY102_CAUSAL_V1_ENABLED=false QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=false QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false QUALITY102_CAUSAL_V1_OPERATOR_ARMED=false DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5 QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7.5", q102)
        self.assertIn(f"DISDEX_RUNTIME_COMMIT_SHA={target} DISDEX_RELEASE_SHA={target}", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_LIVE_ACK=" + target, q102)
        self.assertIn("QUALITY102_CAUSAL_V1_SYMBOLS=SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT", q102)
        self.assertIn("QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4", q102)
        self.assertIn("exec " + f"/home/deploy/disdex-trading/releases/{target}/node_modules/.bin/tsx scripts/disdex-quality102-causal-v1-monitor.ts --daemon", q102)
        self.assertIn("EnvironmentFile=\n", v4)
        self.assertNotIn("/etc/disdex/current-runtime/%i.env", v4)
        self.assertEqual(v4.count("EnvironmentFile=/etc/disdex/"), 3)
        hype = dropin_text("HYPE_TREND_LONG", target, units["HYPE_TREND_LONG"])
        self.assertIn("EnvironmentFile=\n", hype)
        self.assertIn("EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env", hype)
        self.assertIn("EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env", hype)
        self.assertIn("EnvironmentFile=-/etc/disdex/disdex-quality102-causal-v1.env", hype)
        self.assertNotIn("/etc/disdex/current-runtime/%i.env", hype)
        self.assertNotIn("/etc/disdex/current-runtime/%i.hype-operator.env", hype)

    def test_adopted_dd30_gross_is_bound_per_runner_after_environment_files(self):
        target = "a" * 40
        units = target_units(target)
        for runner in RUNNER_IDS:
            expected = cutover.adopted_gross_env(runner)
            self.assertEqual(expected["CRYPTO_GROSS_CAP"], "3.0")
            self.assertEqual(expected["STOCK_GROSS_CAP"], "4.0")
            self.assertEqual(expected["TOTAL_GROSS_CAP"], "4.25")
            self.assertEqual(expected["HYPE_LONG_MAX_GROSS"], "1.5")
            self.assertEqual(expected["HYPE_ZEC_MAX_GROSS"], "1.0")
            self.assertEqual(expected["V12_BASE_GROSS_CAP"], "2.0")
            self.assertEqual(expected["PENGU_DUAL_LS_V2_MAX_GROSS"], "1.0")
            self.assertEqual(expected["QUALITY102_CAUSAL_V1_MAX_GROSS"], "3.0")
            # The existing resolver checks the entire shared numeric contract,
            # so an unrelated inherited HYPE=1.0 must not break a V4 process.
            policy_source = (ROOT / "config/integratedProductionRiskPolicy.ts").read_text(encoding="utf-8")
            import re
            declared = set(re.findall(r"^    ([A-Z0-9_]+): INTEGRATED_PRODUCTION_RISK_POLICY\.", policy_source, re.M))
            self.assertEqual(declared, set(cutover.DD30_COMMON_GROSS_ENV))
            text = dropin_text(runner, target, units[runner])
            launch = next(line for line in text.splitlines() if line.startswith("ExecStart=/usr/bin/env "))
            for key, value in expected.items():
                self.assertIn(f"Environment={key}={value}", text)
                self.assertIn(f"{key}={value}", launch)
            payload = b"\0".join(f"{k}={v}".encode() for k,v in expected.items()) + b"\0"
            cutover.check_running_gross_env(payload, runner)
            wrong = payload.replace(b"TOTAL_GROSS_CAP=4.25", b"TOTAL_GROSS_CAP=3.5")
            with self.assertRaisesRegex(cutover.ContractError, "DD30_EFFECTIVE_GROSS_MISMATCH"):
                cutover.check_running_gross_env(wrong, runner)
        self.assertEqual(cutover.adopted_gross_env("V52")["DISDEX_V52_V11_GROSS_CAP"], "2.0")
        self.assertEqual(cutover.adopted_gross_env("V52")["DISDEX_V52_V50_GROSS_CAP"], "2.0")
        self.assertEqual(cutover.adopted_gross_env("HYPE_TREND_LONG")["DISDEX_HYPE_ZEC_MAX_GROSS"], "1.5")
        self.assertEqual(cutover.adopted_gross_env("HYPE_TREND_LONG")["HYPE_ZEC_MAX_GROSS"], "1.0")
        self.assertNotIn("DISDEX_HYPE_ZEC_MAX_GROSS", cutover.adopted_gross_env("V52"))

    def test_adopted_v52_stock_and_slot_source(self):
        config = json.loads((ROOT / "config/v52V50Runtime.json").read_text(encoding="utf-8"))
        self.assertEqual((config["stockAggregateGross"], config["slotGross"]), (4.0, 2.0))
        # The candidate cannot authorize orders, and the original monitor plan
        # retains precisely the same economics.
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        self.assertIs(plan["ordersEnabled"], False)
        self.assertEqual(plan["economics"]["stockGrossCap"], config["stockAggregateGross"])
        self.assertEqual(plan["economics"]["totalGrossCap"], 4.25)

    def test_plan_digest_shape(self):
        self.assertTrue(HASH_RE.fullmatch(PLAN_SHA))

    def test_goal_campaign_covers_all_monitor_runners(self):
        goal = json.loads(GOAL.read_text(encoding="utf-8"))
        self.assertEqual(set(goal["monitorOnlyContract"]["runnerScopes"]), set(RUNNER_IDS))

    def test_hold_metadata_accepts_only_root_or_deploy_private_file(self):
        self.assertTrue(hold_metadata_valid(0, 0o600))
        self.assertTrue(hold_metadata_valid(1000, 0o600))
        self.assertFalse(hold_metadata_valid(1001, 0o600))
        self.assertFalse(hold_metadata_valid(1000, 0o640))

    def test_workflow_preserves_all_remote_mode_arguments(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("printf -v remote_command '%q '", workflow)
        self.assertIn('"exec $remote_command"', workflow)

    def test_target_plan_canonicalizes_legacy_release_roots(self):
        old = {
            "schema": "disdex-unified-deployment-plan/v2",
            "scope": "FULL_PROJECT",
            "sourceSha": "b" * 40,
            "monitorSha": "b" * 40,
            "uiSha": "c" * 40,
            "ordersEnabled": False,
            "runners": {runner: "b" * 40 for runner in cutover.RUNNER_IDS},
            "releaseRoots": {
                **{runner: "/home/deploy/disdex-trading/releases/" + "b" * 40 for runner in cutover.RUNNER_IDS},
                "runners": "/home/deploy/disdex-trading/releases",
                "ui": "/home/deploy/disdex-trading/ui-releases/ui-test",
                "monitor": "/home/deploy/disdex-trading/releases/monitor-test",
            },
        }
        result = json.loads(target_plan(json.dumps(old).encode("utf-8"), "a" * 40))
        self.assertEqual(set(result["releaseRoots"]), {"runners", "ui", "monitor"})
        self.assertEqual(result["releaseRoots"]["runners"], str(cutover.BASE))
        self.assertEqual(result["uiSha"], "c" * 40)
        self.assertEqual(result["monitorSha"], "b" * 40)
        self.assertEqual(result["sourceSha"], "a" * 40)
        self.assertEqual(result["monitorSha"], old["monitorSha"])

    def test_shared_risk_repair_is_bounded_and_no_order(self):
        source = (ROOT / "scripts/ops/deploy/disdex_stable4_dd30_monitor_cutover.py").read_text(encoding="utf-8")
        self.assertIn("def repair_shared_risk_writer", source)
        self.assertIn("DISDEX_SHARED_RISK_ORDERS_ENABLED=false", source)
        self.assertIn("SHARED_RISK_REPAIR_REAL_REFRESH_TIMEOUT", source)
        self.assertIn('run("/usr/bin/systemctl", "restart", unit', source)
        self.assertIn("validate_shared_files(margin_unit)", source)

    def test_q102_metadata_accepts_audited_deploy_private_state(self):
        self.assertTrue(q102_metadata_valid(1000, 1000, 0o700, 0, 1000, 0o640, 1000, 1000))
        self.assertTrue(q102_metadata_valid(0, 0, 0o710, 0, 0, 0o600, 1000, 1000))
        self.assertFalse(q102_metadata_valid(1001, 1000, 0o700, 0, 1000, 0o640, 1000, 1000))
        self.assertFalse(q102_metadata_valid(1000, 1000, 0o755, 0, 1000, 0o640, 1000, 1000))

    def test_poll_cycles_waits_for_new_shared_v4_tick_before_sha_validation(self):
        source = (ROOT / "scripts/ops/deploy/disdex_stable4_dd30_monitor_cutover.py").read_text(encoding="utf-8")
        stale_guard = "if current == previous[runner]:\n                continue\n            validate_evidence(path, target, runner)"
        self.assertIn(stale_guard, source)

    def test_systemd_health_snapshot_is_batched_and_requires_every_target_unit(self):
        units = {
            "V12_V4": "disdex-v12-v4@sha.service",
            "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short@sha.service",
        }
        parsed = parse_unit_health_snapshot(
            "Id=disdex-v12-v4@sha.service\nActiveState=active\nNRestarts=0\n\n"
            "Id=disdex-idle-priority-short@sha.service\nActiveState=active\nNRestarts=0\n",
            set(units.values()),
        )
        self.assertEqual(parsed[units["V12_V4"]]["ActiveState"], "active")
        self.assertEqual(parsed[units["IDLE_PRIORITY_SHORT"]]["NRestarts"], "0")
        source = (ROOT / "scripts/ops/deploy/disdex_stable4_dd30_monitor_cutover.py").read_text(encoding="utf-8")
        self.assertIn("def unit_health_snapshot", source)
        self.assertIn("health = unit_health_snapshot(units)", source)
        self.assertNotIn('unit_property(unit, "NRestarts") == restart_before[runner]', source)

    def test_systemd_health_snapshot_recovers_one_transitioning_unit(self):
        unit = "disdex-hype-long@sha.service"
        with patch.object(cutover, "run", side_effect=[
            "Id=" + unit + "\nActiveState=active\n",
            "Id=" + unit + "\nActiveState=active\nNRestarts=0\n",
        ]):
            parsed = cutover.unit_health_snapshot({"HYPE_TREND_LONG": unit})
        self.assertEqual(parsed[unit], {"ActiveState": "active", "NRestarts": "0"})

    def test_systemd_health_snapshot_recovers_nrestarts_with_property_only_query(self):
        unit = "disdex-hype-long@sha.service"
        with patch.object(cutover, "run", side_effect=[
            "Id=" + unit + "\nActiveState=active\n",
            "Id=" + unit + "\nActiveState=active\n",
            "Id=" + unit + "\nActiveState=active\n",
            "0",
        ]) as mocked:
            parsed = cutover.unit_health_snapshot({"HYPE_TREND_LONG": unit})
        self.assertEqual(parsed[unit], {"ActiveState": "active", "NRestarts": "0"})
        self.assertEqual(mocked.call_count, 4)

    def test_systemd_health_snapshot_recovers_after_batched_timeout(self):
        unit = "disdex-hype-long@sha.service"
        with patch.object(cutover, "run", side_effect=[
            cutover.subprocess.TimeoutExpired(["/usr/bin/systemctl"], 30),
            "Id=" + unit + "\nActiveState=active\nNRestarts=0\n",
        ]):
            parsed = cutover.unit_health_snapshot({"HYPE_TREND_LONG": unit})
        self.assertEqual(parsed[unit], {"ActiveState": "active", "NRestarts": "0"})

    def test_known_missing_release_pengu_restart_loop_is_quiesced_formally(self):
        source = (ROOT / "scripts/ops/deploy/disdex_stable4_dd30_monitor_cutover.py").read_text(encoding="utf-8")
        self.assertIn('STALE_PENGU = "2e3014778341107fd3929a6dd6a329b96c76779e"', source)
        self.assertIn('f"disdex-pengu-dual-ls-v2@{STALE_PENGU}.service"', source)

    def test_materialize_v4_staged_overlay_is_deterministic(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            stage = pathlib.Path(directory)
            manifest_dir = stage / "deploy" / "v4-staged-overlay"
            source = manifest_dir / "files" / "scripts" / "ops" / "root" / "disdex-v4-rate-budget-broker.ts.src"
            source.parent.mkdir(parents=True)
            source.write_text("export const broker = true;\n", encoding="utf-8")
            (manifest_dir / "manifest.json").write_text(json.dumps({
                "schema": "disdex-v4-staged-overlay/v1",
                "baseSha": "53a0be396719f0284af4e11b35c66a4ac7d58f79",
                "files": [{
                    "source": "files/scripts/ops/root/disdex-v4-rate-budget-broker.ts.src",
                    "target": "scripts/ops/root/disdex-v4-rate-budget-broker.ts",
                }],
            }), encoding="utf-8")
            materialize_v4_staged_overlay(stage)
            target = stage / "scripts" / "ops" / "root" / "disdex-v4-rate-budget-broker.ts"
            self.assertEqual(target.read_text(encoding="utf-8"), "export const broker = true;\n")

    def test_v4_kill_switch_block_is_accepted_as_safe_monitor_evidence(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            path = pathlib.Path(directory) / "v4.json"
            target = "a" * 40
            path.write_text(json.dumps({
                "mode": "MONITOR_ONLY",
                "status": "blocked",
                "reason": "V4_MONITOR_ENTRY_SAFETY_BLOCKED:V4_KILL_SWITCH_ACTIVE",
                "runtimeSha": target,
                "orderEnabled": False,
                "newOrdersAllowed": False,
                "ordersSent": 0,
                "cancelsSent": 0,
                "positionChangesSent": 0,
            }), encoding="utf-8")
            validate_evidence(path, target, "V12_V4")

    def test_v4_canonical_runner_tick_without_mode_is_accepted(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            path = pathlib.Path(directory) / "v4.json"
            target = "b" * 40
            path.write_text(json.dumps({
                "schema": "disdex-runner-tick/v1",
                "runnerId": "V12_V4",
                "status": "blocked",
                "reason": "V4_MONITOR_ENTRY_SAFETY_BLOCKED:V4_KILL_SWITCH_ACTIVE",
                "runtimeSha": target,
                "expectedSha": target,
                "newOrdersAllowed": False,
                "ordersSent": 0,
                "cancelsSent": 0,
                "positionChangesSent": 0,
            }), encoding="utf-8")
            validate_evidence(path, target, "V12_V4")

    def test_release_tree_hardening_removes_directory_and_file_write_bits(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            root = pathlib.Path(directory) / "release"
            nested = root / "nested"
            nested.mkdir(parents=True)
            file_path = nested / "marker"
            file_path.write_text("sha\n", encoding="utf-8")
            os.chmod(root, 0o755)
            os.chmod(nested, 0o755)
            os.chmod(file_path, 0o644)
            try:
                harden_immutable_tree(root)
                for path in (root, nested, file_path):
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode) & 0o222, 0)
            finally:
                # Windows cleanup needs the temporary directory writable.
                os.chmod(file_path, 0o644)
                os.chmod(nested, 0o755)
                os.chmod(root, 0o755)


if __name__ == "__main__":
    unittest.main()
