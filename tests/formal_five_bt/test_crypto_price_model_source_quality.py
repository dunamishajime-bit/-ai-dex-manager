"""Malformed-source regression checks: no forward fill or profitable reclassification."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.crypto_price_model import (
    HOUR, OHLC_QUARANTINE_MS, _bars, _source_quarantine_reason, _pengu_contiguous_segments,
)


class MalformedAsterSourceTests(unittest.TestCase):
    def test_corrupt_source_bar_is_removed_and_quarantined(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "normalized/aster/klines/BTCUSDT.jsonl"
            path.parent.mkdir(parents=True)
            records = [
                {"event_time_ms": 100 * HOUR, "open": 100., "high": 101., "low": 99., "close": 100.},
                {"event_time_ms": 101 * HOUR, "open": 110., "high": 109., "low": 108., "close": 110.},
                {"event_time_ms": 102 * HOUR, "open": 111., "high": 112., "low": 110., "close": 111.},
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in records))
            rows, by_ts, invalid = _bars(Path(temporary), "BTCUSDT")
            self.assertEqual(len(rows), 2)
            self.assertNotIn(101 * HOUR, by_ts)
            self.assertEqual(invalid, [101 * HOUR])
            candidate = {
                "strategy_id": "V12", "symbol": "ETHUSDT",
                "signal_ts_ms": 102 * HOUR, "entry_ts_ms": 102 * HOUR,
                "exit_ts_ms": 105 * HOUR,
            }
            self.assertEqual(
                _source_quarantine_reason(candidate, {"BTCUSDT": invalid}),
                "CORRUPT_H1_DEPENDENCY:BTCUSDT",
            )

    def test_prior_corrupt_bar_outside_lookback_is_not_in_scope(self) -> None:
        bad = [100 * HOUR]
        candidate = {
            "strategy_id": "Q102", "symbol": "ETHUSDT",
            "signal_ts_ms": bad[0] + OHLC_QUARANTINE_MS + HOUR,
            "entry_ts_ms": bad[0] + OHLC_QUARANTINE_MS + HOUR,
        }
        self.assertIsNone(_source_quarantine_reason(candidate, {"BTCUSDT": bad}))

    def test_fet_does_not_depend_on_btc_but_uses_own_source(self) -> None:
        candidate = {
            "strategy_id": "FET", "symbol": "FETUSDT",
            "signal_ts_ms": 102 * HOUR, "entry_ts_ms": 102 * HOUR,
        }
        self.assertIsNone(_source_quarantine_reason(candidate, {"BTCUSDT": [101 * HOUR]}))
        self.assertEqual(
            _source_quarantine_reason(candidate, {"FETUSDT": [101 * HOUR]}),
            "CORRUPT_H1_DEPENDENCY:FETUSDT",
        )

    def test_pengu_btc_segments_split_at_corrupt_or_missing_hour(self) -> None:
        pengu = [{"event_time_ms": ts} for ts in (100, 101, 102, 103, 104, 105)]
        btc = [{"event_time_ms": ts} for ts in (100, 101, 103, 104, 105)]
        segments = _pengu_contiguous_segments(pengu, btc)
        self.assertEqual(
            [[left["event_time_ms"] for left, _ in rows] for rows in segments],
            [[100, 101], [103, 104, 105]],
        )
        # A gap in PENGU itself must also cut history; no synthetic H1 is made.
        pengu_missing = [row for row in pengu if row["event_time_ms"] != 104]
        segments = _pengu_contiguous_segments(pengu_missing, btc)
        self.assertEqual(
            [[left["event_time_ms"] for left, _ in rows] for rows in segments],
            [[100, 101], [103], [105]],
        )

    def test_invalid_ohlc_never_enters_execution_bar_map(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "normalized/aster/klines/ETHUSDT.jsonl"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({
                "event_time_ms": HOUR, "open": 100., "high": 98., "low": 97., "close": 99.,
            }) + "\n")
            rows, by_ts, invalid = _bars(Path(temporary), "ETHUSDT")
            self.assertEqual((rows, by_ts, invalid), ([], {}, [HOUR]))


if __name__ == "__main__":
    unittest.main()
