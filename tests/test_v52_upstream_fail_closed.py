import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class V52UpstreamFailClosedTests(unittest.TestCase):
    def test_classifies_observed_aster_transport_failures_as_upstream_fail_closed(self):
        self.assertTrue(v52.upstream_fail_closed_error("HTTP 429 /fapi/v3/positionRisk"))
        self.assertTrue(v52.upstream_fail_closed_error("HTTP Error 429: Too Many Requests"))
        self.assertTrue(v52.upstream_fail_closed_error("<urlopen error [Errno 104] Connection reset by peer>"))
        self.assertTrue(v52.upstream_fail_closed_error("device time must match the actual time"))
        self.assertTrue(v52.upstream_fail_closed_error("QUALITY102_STATE_STALE"))
        self.assertFalse(v52.upstream_fail_closed_error("Managed Stock position reconciliation mismatch"))
        self.assertFalse(v52.upstream_fail_closed_error("HTTP 500 /fapi/v3/positionRisk"))

    def test_existing_upstream_kill_reason_holds_without_flatten_mutations(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        engine.reset_days = lambda: None
        engine.kill_switch = lambda: {
            "active": True,
            "reason": "V52 fatal tick error: <urlopen error [Errno 104] Connection reset by peer>",
        }
        engine.flatten_all = lambda reason: self.fail(f"flatten_all must not run for upstream outage: {reason}")
        logs = []
        engine.log = lambda event, **kwargs: logs.append((event, kwargs))

        engine.tick({})

        self.assertTrue(engine._upstream_fail_closed_hold)
        self.assertTrue(any(event == "v52-upstream-state-fail-closed" for event, _ in logs))

    def test_new_upstream_failure_activates_kill_but_never_flattens_while_state_is_unverified(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        activations = []
        logs = []
        engine.kill_switch = lambda: None
        engine.activate_kill_switch = lambda reason: activations.append(reason)
        engine.flatten_all = lambda reason: self.fail(f"flatten_all must not run for upstream outage: {reason}")
        engine.log = lambda event, **kwargs: logs.append((event, kwargs))

        engine._hold_upstream_fail_closed(ConnectionResetError(104, "Connection reset by peer"), "TICK")

        self.assertTrue(engine._upstream_fail_closed_hold)
        self.assertEqual(len(activations), 1)
        self.assertIn("V52 upstream state unavailable", activations[0])
        self.assertTrue(any(event == "v52-upstream-state-fail-closed" for event, _ in logs))


if __name__ == "__main__":
    unittest.main()
