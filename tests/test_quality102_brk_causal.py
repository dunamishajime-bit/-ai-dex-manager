import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).parents[1] / "scripts" / "quality102_brk_causal.py"
spec = importlib.util.spec_from_file_location("quality102_brk_causal", MODULE)
brk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brk)


def bar(ts, o, h, l, c, v=100.0):
    return {"timestamp": ts, "open": o, "high": h, "low": l, "close": c, "volume": v}


class BrkCausalTests(unittest.TestCase):
    def test_parse_variant(self):
        self.assertEqual(brk.parse_variant("BRK24_H48_V1.2"), (24, 48, 1.2))

    def test_long_requires_close_break_of_prior_window(self):
        rows = [bar(f"2026-01-01 {i:02d}:00:00+00:00", 100, 101, 99, 100) for i in range(24)]
        rows += [bar("2026-01-02 00:00:00+00:00", 100, 103, 100, 102)]
        rows += [bar("2026-01-02 01:00:00+00:00", 102, 103, 101, 102)]
        sig = brk.detect_signal(rows, 24, "BRK24_H48_V1.2")
        self.assertEqual(sig.side, 1)
        self.assertGreater(sig.strength, 0)

    def test_no_signal_without_close_break(self):
        rows = [bar(f"2026-01-01 {i:02d}:00:00+00:00", 100, 101, 99, 100) for i in range(24)]
        rows += [bar("2026-01-02 00:00:00+00:00", 100, 102, 100, 100.5)]
        rows += [bar("2026-01-02 01:00:00+00:00", 100.5, 101, 100, 100.5)]
        self.assertIsNone(brk.detect_signal(rows, 24, "BRK24_H12_V0.8"))

    def test_exit_uses_last_completed_close_when_stop_not_hit(self):
        rows = [bar(f"2026-01-{1 + i // 24:02d} {i % 24:02d}:00:00+00:00", 100 + i, 101 + i, 99 + i, 100 + i) for i in range(60)]
        out = brk.simulate_exit(rows, 1, 1, 12)
        self.assertEqual(out.exit_index, 13)
        self.assertAlmostEqual(out.gross, rows[12]["close"] / rows[1]["open"] - 1.0)


class BrkExitRiskTests(unittest.TestCase):
    def test_h24_uses_five_percent_stop(self):
        rows = [bar(f"2026-02-{1 + i // 24:02d} {i % 24:02d}:00:00+00:00", 100, 101, 99, 100) for i in range(30)]
        rows[2] = bar("2026-02-01 02:00:00+00:00", 100, 104, 94, 96)
        out = brk.simulate_exit(rows, 1, 1, 24)
        self.assertEqual(out.reason, "stop")
        self.assertAlmostEqual(out.gross, -0.05)

    def test_h48_uses_eight_percent_stop(self):
        rows = [bar(f"2026-03-{1 + i // 24:02d} {i % 24:02d}:00:00+00:00", 100, 101, 99, 100) for i in range(55)]
        rows[2] = bar("2026-03-01 02:00:00+00:00", 100, 107, 91, 93)
        out = brk.simulate_exit(rows, 1, 1, 48)
        self.assertEqual(out.reason, "stop")
        self.assertAlmostEqual(out.gross, -0.08)


class BrkHistoricalTimestampTests(unittest.TestCase):
    def test_stop_exit_is_recorded_at_next_bar_boundary(self):
        rows = [bar(f"2026-04-{1 + i // 24:02d} {i % 24:02d}:00:00+00:00", 100, 101, 99, 100) for i in range(30)]
        rows[2] = bar("2026-04-01 02:00:00+00:00", 100, 104, 94, 96)
        out = brk.simulate_exit(rows, 1, 1, 24)
        self.assertEqual(out.exit_index, 3)
        self.assertAlmostEqual(out.gross, -0.05)

    def test_time_exit_uses_last_completed_close_and_next_boundary_timestamp(self):
        rows = [bar(f"2026-05-{1 + i // 24:02d} {i % 24:02d}:00:00+00:00", 100, 101, 99, 100) for i in range(55)]
        rows[1] = bar("2026-05-01 01:00:00+00:00", 100, 101, 99, 100)
        rows[48] = bar("2026-05-03 00:00:00+00:00", 110, 112, 109, 111)
        out = brk.simulate_exit(rows, 1, 1, 48)
        self.assertEqual(out.exit_index, 49)
        self.assertAlmostEqual(out.gross, 0.11)


class BrkGeneratorTests(unittest.TestCase):
    def test_generator_only_evaluates_four_hour_entry_grid(self):
        rows = []
        for i in range(30):
            day = 1 + i // 24
            hour = i % 24
            close = 100.0
            high = 101.0
            if i == 24:
                close, high = 103.0, 104.0
            rows.append(bar(f"2026-06-{day:02d} {hour:02d}:00:00+00:00", close, high, 99.0, close))
        signals = brk.generate_signals(rows, "BRK24_H12_V1.0")
        self.assertEqual([x.entry_index for x in signals], [25])

    def test_generator_never_uses_current_entry_bar_to_trigger(self):
        rows = [bar(f"2026-07-{1 + i // 24:02d} {i % 24:02d}:00:00+00:00", 100, 101, 99, 100) for i in range(30)]
        rows[25] = bar("2026-07-02 01:00:00+00:00", 100, 110, 99, 109)
        signals = brk.generate_signals(rows, "BRK24_H12_V1.0")
        self.assertEqual(signals, [])

if __name__ == "__main__":
    unittest.main()
