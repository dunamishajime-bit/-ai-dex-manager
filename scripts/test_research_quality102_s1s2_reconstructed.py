from pathlib import Path
import csv
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from research_quality102_s1s2_reconstructed import (  # noqa: E402
    RESEARCH_ONLY,
    ORIGINAL_RAW_GENERATOR_PROVEN,
    SignalRule,
    Bar,
    feature_snapshot,
    matching_rules,
)


class ReconstructedS1S2Test(unittest.TestCase):
    def fixture_rows(self):
        with (ROOT / 'research' / 'quality102_s1s2_known_fixture.csv').open(newline='', encoding='utf-8') as fh:
            return list(csv.DictReader(fh))

    def test_research_only_contract(self):
        self.assertIs(RESEARCH_ONLY, True)
        self.assertIs(ORIGINAL_RAW_GENERATOR_PROVEN, False)
        rows = self.fixture_rows()
        self.assertEqual(len(rows), 18)
        self.assertEqual(sum(r['layer'] == 'S1' for r in rows), 8)
        self.assertEqual(sum(r['layer'] == 'S2' for r in rows), 10)
        self.assertTrue(all(int(r['entry_timestamp_ms']) - int(r['signal_timestamp_ms']) == 3_600_000 for r in rows))

    def _short_bars(self):
        bars = []
        for i in range(337):
            if i == 0:
                close = 120.0
            elif i < 312:
                close = 92.0
            elif i == 312:
                close = 90.0
            elif i < 336:
                close = 90.0 + (i - 312) * 0.30
            else:
                close = 96.0
            op = close if i != 336 else 97.0
            bars.append(Bar(i * 3_600_000, op, max(op, close) + 1.5, min(op, close) - 1.5, close, 100.0))
        return bars

    def test_short_raw_grid_match(self):
        bars = self._short_bars()
        snap = feature_snapshot(bars, 336)
        rules = matching_rules(snap)
        self.assertTrue(rules, snap)
        self.assertTrue(all(r.side == -1 for r in rules))
        self.assertGreaterEqual(snap.ret24, 0.05)
        self.assertLess(snap.ret14d, 0)
        self.assertTrue(snap.bar_down)

    def test_signal_snapshot_does_not_use_next_open(self):
        bars = self._short_bars()
        before = feature_snapshot(bars, 336)
        bars.append(Bar(337 * 3_600_000, 1_000_000, 1_000_001, 999_999, 1_000_000, 1e12))
        after = feature_snapshot(bars, 336)
        self.assertEqual(before, after)
        self.assertEqual(before.signal_ts_ms + 3_600_000, bars[337].ts_ms)

    def test_gap_fails_closed(self):
        bars = self._short_bars()
        bars[200] = Bar(bars[199].ts_ms + 7_200_000, bars[200].open, bars[200].high, bars[200].low, bars[200].close, bars[200].quote_volume)
        with self.assertRaisesRegex(ValueError, 'non-contiguous'):
            feature_snapshot(bars, 336)

    def test_signal_rule_has_no_layer_field(self):
        rule = SignalRule(side=-1, move=0.05, rsi=55.0, hard_stop=0.10)
        self.assertFalse(hasattr(rule, 'layer'))


if __name__ == '__main__':
    unittest.main()
