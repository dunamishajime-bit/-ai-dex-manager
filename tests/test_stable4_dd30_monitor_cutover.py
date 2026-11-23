import json
import pathlib
import unittest

from scripts.ops.deploy.disdex_stable4_dd30_monitor_cutover import (
    HASH_RE,
    HOLD_DIGEST,
    RUNNER_IDS,
    dropin_text,
    hold_metadata_valid,
    q102_metadata_valid,
    target_units,
    validate_plan,
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
        v4 = dropin_text("V12_V4", target, units["V12_V4"])
        self.assertIn("EnvironmentFile=\n", v4)
        self.assertNotIn("/etc/disdex/current-runtime/%i.env", v4)
        self.assertEqual(v4.count("EnvironmentFile=/etc/disdex/"), 3)

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

    def test_q102_metadata_accepts_audited_deploy_private_state(self):
        self.assertTrue(q102_metadata_valid(1000, 1000, 0o700, 0, 1000, 0o640, 1000, 1000))
        self.assertTrue(q102_metadata_valid(0, 0, 0o710, 0, 0, 0o600, 1000, 1000))
        self.assertFalse(q102_metadata_valid(1001, 1000, 0o700, 0, 1000, 0o640, 1000, 1000))
        self.assertFalse(q102_metadata_valid(1000, 1000, 0o755, 0, 1000, 0o640, 1000, 1000))


if __name__ == "__main__":
    unittest.main()
