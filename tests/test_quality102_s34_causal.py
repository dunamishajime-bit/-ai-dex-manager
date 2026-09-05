import importlib.util
import statistics
import unittest
from pathlib import Path

MODULE = Path(__file__).parents[1] / "scripts" / "quality102_s34_causal.py"
spec = importlib.util.spec_from_file_location("quality102_s34_causal", MODULE)
s34 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s34)


def bar(ts, close, high=None, low=None, open_=None, volume=100.0):
    return {
        "timestamp": ts,
        "open": close if open_ is None else open_,
        "high": close + 1 if high is None else high,
        "low": close - 1 if low is None else low,
        "close": close,
        "volume": volume,
    }


class S34CausalSignalTests(unittest.TestCase):
    def test_pb_long_uses_prior_completed_bar_returns(self):
        rows = [bar(f"2026-01-{1+i//24:02d} {i%24:02d}:00:00+00:00", 100.0) for i in range(170)]
        rows[1]["close"] = 90.0
        rows[145]["close"] = 120.0
        rows[169]["close"] = 108.0
        sig = s34.detect_signal(rows, 169, "PB168_0.1_P24_0.04_H24")
        self.assertEqual((sig.family, sig.side, sig.hold_hours), ("PB", 1, 24))
        self.assertTrue(sig.strength_proven)
        self.assertAlmostEqual(sig.strength, abs(108/90-1) + abs(108/120-1))

    def test_mr_uses_sample_standard_deviation(self):
        rows = [bar(f"2026-02-{1+i//24:02d} {i%24:02d}:00:00+00:00", 100.0) for i in range(24)]
        rows[-1]["close"] = 110.0
        sig = s34.detect_signal(rows, 23, "MR24_Z2.0_H24")
        closes = [r["close"] for r in rows]
        z = (closes[-1] - statistics.mean(closes)) / statistics.stdev(closes)
        self.assertEqual((sig.family, sig.side), ("MR", -1))
        self.assertAlmostEqual(sig.strength, abs(z))
        self.assertTrue(sig.strength_proven)

    def test_rev_fades_threshold_move(self):
        rows = [bar(f"2026-03-{1+i//24:02d} {i%24:02d}:00:00+00:00", 100.0) for i in range(25)]
        rows[24]["close"] = 108.0
        sig = s34.detect_signal(rows, 24, "REV12_T0.05_H12")
        self.assertEqual((sig.family, sig.side, sig.hold_hours), ("REV", -1, 12))
        self.assertAlmostEqual(sig.strength, 0.08)
        self.assertTrue(sig.strength_proven)

    def test_brk_trigger_is_causal_but_original_strength_is_unproven(self):
        rows = [bar(f"2026-04-{1+i//24:02d} {i%24:02d}:00:00+00:00", 100.0, 101.0, 99.0) for i in range(26)]
        rows[24] = bar("2026-04-02 00:00:00+00:00", 103.0, 104.0, 100.0)
        sig = s34.detect_signal(rows, 24, "BRK24_H48_V1.2")
        self.assertEqual((sig.family, sig.side, sig.hold_hours), ("BRK", 1, 48))
        self.assertFalse(sig.strength_proven)
        self.assertFalse(sig.volume_gate_proven)

    def test_v4_improvement_gate_requires_24pct_ret14_for_rev_long(self):
        self.assertFalse(s34.passes_v4_improvement_gate("REV", 1, 0.239999))
        self.assertTrue(s34.passes_v4_improvement_gate("REV", 1, 0.24))
        self.assertTrue(s34.passes_v4_improvement_gate("REV", -1, -0.9))
        self.assertTrue(s34.passes_v4_improvement_gate("MR", 1, -0.9))

    def test_generator_uses_signal_bar_before_entry_on_four_hour_grid(self):
        rows = [bar(f"2026-05-{1+i//24:02d} {i%24:02d}:00:00+00:00", 100.0, 101.0, 99.0) for i in range(30)]
        rows[24] = bar("2026-05-02 00:00:00+00:00", 103.0, 104.0, 100.0)
        rows[25] = bar("2026-05-02 01:00:00+00:00", 100.0, 120.0, 99.0)
        out = s34.generate_signals(rows, "BRK24_H12_V1.0")
        self.assertEqual([x.entry_index for x in out], [25])


if __name__ == "__main__":
    unittest.main()
