import datetime as dt
import unittest

import disdex_v52_aster_only_legacy_engine as v52


class V52PrelockRuntimeTest(unittest.TestCase):
    def test_prepare_tick_inputs_runs_without_shared_lock_state(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine.current_local_time = lambda: dt.datetime(2026, 9, 6, 12, 0, tzinfo=v52.base.NY)
        engine.positions = lambda: {}
        engine.kill_switch = lambda: None
        prepared = engine.prepare_tick_inputs()
        self.assertTrue(prepared["skipWithoutLock"])
        self.assertIsNone(prepared["rows"])


if __name__ == "__main__":
    unittest.main()

