import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class V52UpstreamFailClosedTests(unittest.TestCase):
    def test_local_rate_budget_saturation_is_deferred_not_upstream_kill(self):
        self.assertTrue(v52.rate_budget_deferred_error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"))
        self.assertFalse(v52.upstream_fail_closed_error("ASTER_GLOBAL_RATE_BUDGET_SATURATED:5005"))

    def test_classifies_observed_aster_transport_failures_as_upstream_fail_closed(self):
        self.assertTrue(v52.upstream_fail_closed_error("HTTP 429 /fapi/v3/positionRisk"))
        self.assertTrue(v52.upstream_fail_closed_error("HTTP Error 429: Too Many Requests"))
        self.assertTrue(v52.upstream_fail_closed_error("HTTP 418 /fapi/v3/positionRisk: IP banned"))
        self.assertTrue(v52.upstream_fail_closed_error("<urlopen error [Errno 104] Connection reset by peer>"))
        self.assertTrue(v52.upstream_fail_closed_error("device time must match the actual time"))
        self.assertTrue(v52.upstream_fail_closed_error("QUALITY102_STATE_STALE"))
        self.assertFalse(v52.upstream_fail_closed_error("Managed Stock position reconciliation mismatch"))
        self.assertFalse(v52.upstream_fail_closed_error("HTTP 500 /fapi/v3/positionRisk"))

    def test_existing_upstream_kill_reason_holds_without_flatten_mutations(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        hold = {
            "active": True,
            "strategyId": v52.base.V96_KILL_SWITCH_STRATEGY_ID,
            "action": "HOLD_PROTECTED",
            "reason": "V52 upstream state unavailable: Connection reset by peer",
            "operator": "disdex-v52-aster-only",
            "recoverable": True,
        }
        engine.kill_switch = lambda: hold
        engine._recoverable_hold_expired = lambda _hold=None: False
        engine.activate_kill_switch = lambda *_args, **_kwargs: self.fail("existing recoverable hold must not be replaced")
        engine.flatten_all = lambda reason: self.fail(f"flatten_all must not run for upstream outage: {reason}")
        logs = []
        engine.log = lambda event, **kwargs: logs.append((event, kwargs))

        engine._hold_upstream_fail_closed(ConnectionResetError(104, "Connection reset by peer"), "TICK")

        self.assertTrue(engine._upstream_fail_closed_hold)
        self.assertTrue(any(event == "v52-upstream-state-fail-closed" for event, _ in logs))

    def test_new_upstream_failure_activates_kill_but_never_flattens_while_state_is_unverified(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        activations = []
        logs = []
        engine.kill_switch = lambda: None
        engine.activate_kill_switch = lambda reason, **kwargs: activations.append((reason, kwargs))
        engine.flatten_all = lambda reason: self.fail(f"flatten_all must not run for upstream outage: {reason}")
        engine.log = lambda event, **kwargs: logs.append((event, kwargs))

        engine._hold_upstream_fail_closed(ConnectionResetError(104, "Connection reset by peer"), "TICK")

        self.assertTrue(engine._upstream_fail_closed_hold)
        self.assertEqual(len(activations), 1)
        self.assertIn("V52 upstream state unavailable", activations[0][0])
        self.assertEqual(activations[0][1].get("action"), "HOLD_PROTECTED")
        self.assertTrue(activations[0][1].get("recoverable"))
        self.assertTrue(any(event == "v52-upstream-state-fail-closed" for event, _ in logs))


if __name__ == "__main__":
    unittest.main()
