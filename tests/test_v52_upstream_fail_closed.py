import sys
import unittest
import tempfile
import json
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


    def test_invalid_shared_kill_switch_does_not_restart_v52_or_mutate_orders(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        events = []
        def bad_switch():
            raise RuntimeError("Shared Kill Switch is active but invalid")
        engine.kill_switch = bad_switch
        engine.activate_kill_switch = lambda *_args, **_kwargs: self.fail("must not rewrite invalid shared switch")
        engine.flatten_all = lambda *_args, **_kwargs: self.fail("must not flatten on invalid shared switch")
        engine.log = lambda event, **kwargs: events.append((event, kwargs))

        # The originally observed fault: stale Q102 plus invalid shared switch.
        engine._hold_upstream_fail_closed(RuntimeError("QUALITY102_STATE_STALE"), "TICK")

        self.assertTrue(engine._upstream_fail_closed_hold)
        self.assertEqual(events[-1][0], "v52-shared-kill-switch-invalid-held")
        self.assertFalse(events[-1][1]["newOrdersAllowed"])
        self.assertFalse(events[-1][1]["positionChangesAllowed"])
        self.assertTrue(events[-1][1]["operatorReviewRequired"])

    def test_only_known_integrity_errors_are_handled_as_local_hold(self):
        classify = v52.V52AsterOnlyEngine._shared_kill_switch_integrity_error
        self.assertTrue(classify("Shared Kill Switch is active but invalid"))
        self.assertTrue(classify("Shared Kill Switch action is invalid"))
        self.assertFalse(classify("Unrelated programming failure"))


    def test_known_stable4_global_hold_is_preserved_without_reinterpreting_as_clear(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "shared-switch.json"
            payload = {
                "active": True,
                "strategyId": "STABLE4_H48_CUTOVER",
                "action": "HOLD_PROTECTED",
                "scope": "GLOBAL",
                "operator": "disdex-stable4-formal-owner-hold",
                "reason": "STABLE4_RESEARCH_ROLLOUT:" + "e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
                "activatedAt": "2026-11-17T10:48:29.132+00:00",
                "recoverable": False,
            }
            engine = object.__new__(v52.V52AsterOnlyEngine)
            engine.kill_switch_path = path
            path.write_text(json.dumps(payload))
            self.assertEqual(engine.kill_switch(), payload)
            self.assertFalse(engine._own_recoverable_hold())
            for key, unsafe_value in [
                ("action", "FLATTEN_MANAGED"),
                ("scope", "V52_REFERENCE_ONLY"),
                ("operator", "unrecognized-operator"),
                ("strategyId", "UNRECOGNIZED"),
                ("reason", "unknown"),
            ]:
                invalid = {**payload, key: unsafe_value}
                path.write_text(json.dumps(invalid))
                with self.assertRaisesRegex(RuntimeError, "Shared Kill Switch is active but invalid"):
                    engine.kill_switch()
            path.write_text("{malformed")
            with self.assertRaisesRegex(RuntimeError, "unreadable or malformed"):
                engine.kill_switch()
            self.assertTrue(engine._shared_kill_switch_integrity_error("Shared Kill Switch state unreadable or malformed"))


if __name__ == "__main__":
    unittest.main()
