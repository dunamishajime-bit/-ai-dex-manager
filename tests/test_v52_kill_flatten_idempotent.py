import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class V52KillFlattenIdempotencyTests(unittest.TestCase):
    def make_engine(self, kill_ref, calls):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        engine._last_kill_flatten_key = None
        engine.reset_days = lambda: None
        engine.kill_switch = lambda: kill_ref[0]
        engine.flatten_all = lambda reason: calls.append(reason)
        engine.log = lambda *_args, **_kwargs: None
        engine.positions = lambda: {}
        engine.current_local_time = lambda: v52.dt.datetime(2026, 9, 10, 17, 0, tzinfo=v52.base.NY)
        return engine

    def test_same_active_kill_flattens_only_once(self):
        calls = []
        kill = [{"active": True, "reason": "RISK_LIMIT", "updatedAt": 1}]
        engine = self.make_engine(kill, calls)
        engine.tick({})
        engine.tick({})
        self.assertEqual(calls, ["RISK_LIMIT"])

    def test_cleared_kill_allows_same_reason_to_flatten_again(self):
        calls = []
        kill_row = {"active": True, "reason": "RISK_LIMIT", "updatedAt": 1}
        kill = [kill_row]
        engine = self.make_engine(kill, calls)
        engine.tick({})
        kill[0] = None
        engine.prepare_tick_inputs()
        kill[0] = kill_row
        engine.tick({})
        self.assertEqual(calls, ["RISK_LIMIT", "RISK_LIMIT"])

    def test_completed_kill_hold_skips_shared_account_lock(self):
        calls = []
        kill = [{"active": True, "reason": "RISK_LIMIT", "updatedAt": 1}]
        engine = self.make_engine(kill, calls)
        engine.tick({})
        prepared = engine.prepare_tick_inputs()
        self.assertTrue(prepared["skipWithoutLock"])
        self.assertTrue(prepared["killHold"])


if __name__ == "__main__":
    unittest.main()

class V52KillHoldCadenceTests(unittest.TestCase):
    def test_completed_kill_hold_uses_idle_cadence(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine._upstream_fail_closed_hold = False
        engine.positions = lambda: {}
        original = v52.os.environ.get("DISDEX_STOCK_IDLE_INTERVAL_MS")
        try:
            v52.os.environ["DISDEX_STOCK_IDLE_INTERVAL_MS"] = "5000"
            self.assertEqual(engine._loop_interval_ms({"killHold": True}), 5000)
        finally:
            if original is None:
                v52.os.environ.pop("DISDEX_STOCK_IDLE_INTERVAL_MS", None)
            else:
                v52.os.environ["DISDEX_STOCK_IDLE_INTERVAL_MS"] = original
