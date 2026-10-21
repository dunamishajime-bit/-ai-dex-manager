import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "task9_initial_adverse_stop_20261020.py"
SPEC = importlib.util.spec_from_file_location("task9_initial_adverse_stop", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class Task9PureLogicTests(unittest.TestCase):
    def test_directional_return_mirrors_long_and_short(self):
        self.assertAlmostEqual(MODULE.directional_return(100.0, 102.0, "LONG"), 0.02)
        self.assertAlmostEqual(MODULE.directional_return(100.0, 98.0, "SHORT"), 0.02)
        self.assertAlmostEqual(MODULE.directional_return(100.0, 98.0, "LONG"), -0.02)
        self.assertAlmostEqual(MODULE.directional_return(100.0, 102.0, "SHORT"), -0.02)


    def test_directional_excursion_uses_high_low_by_side(self):
        self.assertEqual({
            key: round(value, 10)
            for key, value in MODULE.directional_excursion(100.0, 105.0, 97.0, "LONG").items()
        }, {
        "favorable": 0.05,
        "adverse": -0.03,
        })
        self.assertEqual({
            key: round(value, 10)
            for key, value in MODULE.directional_excursion(100.0, 105.0, 97.0, "SHORT").items()
        }, {
            "favorable": round(100.0 / 97.0 - 1.0, 10),
            "adverse": round(100.0 / 105.0 - 1.0, 10),
        })


    def test_initial_stop_is_mfe_gated_and_directional(self):
        self.assertTrue(MODULE.should_trigger_initial_stop(0.004, 0.01))
        self.assertFalse(MODULE.should_trigger_initial_stop(0.01, 0.01))
        self.assertEqual(MODULE.stop_price_for_adverse_pct(100.0, -0.02, "LONG"), 98.0)
        self.assertEqual(MODULE.stop_price_for_adverse_pct(100.0, -0.02, "SHORT"), 102.0)
        self.assertTrue(MODULE.stop_touched(100.0, 99.0, 98.0, "LONG", 98.0))
        self.assertTrue(MODULE.stop_touched(100.0, 102.0, 99.0, "SHORT", 102.0))
        self.assertFalse(MODULE.stop_touched(100.0, 101.0, 99.0, "LONG", 98.0))


    def test_reentry_holdoff_blocks_same_direction_only(self):
        stop_ts = 1_000_000
        self.assertFalse(MODULE.reentry_allowed(stop_ts, stop_ts + 6 * 3_600_000, 12, "LONG", "LONG"))
        self.assertTrue(MODULE.reentry_allowed(stop_ts, stop_ts + 12 * 3_600_000, 12, "LONG", "LONG"))
        self.assertTrue(MODULE.reentry_allowed(stop_ts, stop_ts + 1_000, 12, "LONG", "SHORT"))


    def test_structure_gate_is_causal_and_direction_symmetric(self):
        bars = [
            (index, 100.0, high, low, close, 1.0)
            for index, high, low, close in (
                (0, 100.0, 99.0, 99.5),
                (1, 99.5, 98.5, 99.0),
                (2, 99.0, 97.5, 98.0),
                (3, 98.0, 96.0, 97.0),
            )
        ]
        self.assertTrue(MODULE.structure_confirmed(bars, 3, 100.0, "LONG", 3, 3))
        self.assertFalse(MODULE.structure_confirmed(bars, 2, 100.0, "LONG", 3, 3))
        short_bars = [
            (index, 100.0, high, low, close, 1.0)
            for index, high, low, close in (
                (0, 100.5, 99.0, 100.5),
                (1, 101.5, 100.5, 101.0),
                (2, 102.5, 101.0, 102.0),
                (3, 103.5, 102.0, 103.0),
            )
        ]
        self.assertTrue(MODULE.structure_confirmed(short_bars, 3, 100.0, "SHORT", 3, 3))


if __name__ == "__main__":
    unittest.main(verbosity=2)
