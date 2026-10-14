import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/research/run_e8cc_exact_no_dca_bt.py"
SPEC = importlib.util.spec_from_file_location("e8cc_bt", PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class E8ccCurrentBtPolicyTest(unittest.TestCase):
    def test_fet_current_gate_uses_vol10_ret15(self):
        h = MODULE.HOUR
        entry = 100 * h
        bars = {}
        for hour in range(27, 100):
            bars[hour * h] = {
                "event_time_ms": hour * h, "open": 100, "high": 101,
                "low": 99, "close": 100, "base_volume": 100,
            }
        bars[99 * h].update(close=103, high=103, base_volume=500)
        bars[27 * h]["close"] = 95
        accepted = MODULE.evaluate_current_fet_gate(entry, bars)
        self.assertTrue(accepted.accepted)
        bars[99 * h]["base_volume"] = 1_100
        rejected = MODULE.evaluate_current_fet_gate(entry, bars)
        self.assertFalse(rejected.accepted)
        self.assertIn("VOLUME_ABOVE_10", rejected.reasons)

    def test_time37_fixed8_stop_is_side_correct_and_causal(self):
        h = MODULE.HOUR
        route = {"TIME_ROUTE": "TIME"}
        long = {"strategy_id": "V12", "route": "TIME_ROUTE", "symbol": "BTCUSDT", "side": "LONG",
                "entry_price": 100.0, "entry_ts_ms": 0, "exit_ts_ms": 3*h, "exit_price": 105.0}
        bars = {0: {"open": 100, "high": 103, "low": 95, "close": 100},
                h: {"open": 91, "high": 94, "low": 90, "close": 93},
                2*h: {"open": 93, "high": 95, "low": 92, "close": 94}}
        updated, changed = MODULE.apply_time37_fixed_stop(long, bars, route)
        self.assertTrue(changed)
        self.assertEqual(updated["exit_ts_ms"], 2*h)
        self.assertEqual(updated["exit_price"], 91)
        short = dict(long, side="SHORT")
        short_bars = {0: {"open": 100, "high": 105, "low": 97, "close": 101},
                      h: {"open": 110, "high": 111, "low": 107, "close": 109},
                      2*h: {"open": 109, "high": 109, "low": 106, "close": 107}}
        updated, changed = MODULE.apply_time37_fixed_stop(short, short_bars, route)
        self.assertTrue(changed)
        self.assertEqual(updated["exit_price"], 110)

    def test_admission_patch_preserves_peer_caps_and_grants_only_v4_caps(self):
        source = '''CRYPTO_CAP = 3.5\nTOTAL_CAP = 4.75\n    candidate_i = deposit_i = 0\n        next_scheduled = scheduled[0][0] if scheduled else math.inf\n        ts = min(next_candidate, next_deposit, next_scheduled)\n                research_cap = _research_risk_cap(candidate, risk_caps)\n                requested = min(float(candidate["requested_gross"]), research_cap)\n                sleeve_room = max(0.0, CRYPTO_CAP - crypto_gross)\n                total_room = max(0.0, TOTAL_CAP - total_gross)\n                sleeve_room = max(0.0, CRYPTO_CAP - crypto_gross)\n                total_room = max(0.0, TOTAL_CAP - total_gross)\n        if candidate_i < len(candidate_times) and candidate_times[candidate_i] == ts:\n'''
        patched = MODULE.patch_current_admission_source(source)
        self.assertIn("CRYPTO_CAP = 3.0", patched)
        self.assertIn("TOTAL_CAP = 4.25", patched)
        self.assertIn('3.5 if strategy == "V12"', patched)
        self.assertIn('4.75 if strategy == "V12"', patched)
        self.assertIn("Q102:BRK_DISABLED_CURRENT_RUNTIME", patched)
        self.assertNotIn("V12:DD21_OPERATOR_LIMIT", patched)
        self.assertNotIn("next_v4_risk", patched)
        self.assertNotIn("CRYPTO_CAP - crypto_gross", patched)


if __name__ == "__main__":
    unittest.main()
