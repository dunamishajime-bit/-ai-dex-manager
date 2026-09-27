from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import tempfile
import unittest

from research.formal_five_bt.yahoo_v52 import (
    YahooBar, INITIAL_GAP_END_MS, load_v52_signal_scan,
    load_yahoo_bars, model_v52_signal,
)

def stamp(text):
    return int(datetime.fromisoformat(text).astimezone(timezone.utc).timestamp() * 1000)

def bar(start, end, close=100.0):
    return YahooBar("NVDA", stamp(start), stamp(end), close, close + 1, close - 1,
                    close, 1_000, "a" * 64)

def signal(ts, status="SIGNAL"):
    return {"status": status, "route": "V11_EQ", "symbol": "NVDAUSDT",
            "decision_ts_ms": stamp(ts)}

class YahooV52Tests(unittest.TestCase):
    def test_completed_candle_not_future_current_candle(self):
        rows = [bar("2026-06-15T13:30:00+00:00", "2026-06-15T14:30:00+00:00", 100),
                bar("2026-06-15T14:30:00+00:00", "2026-06-15T15:30:00+00:00", 130)]
        first = model_v52_signal(signal("2026-06-15T14:30:00+00:00"), rows)
        self.assertEqual(first["status"], "MODELED_PRICE_FILL")
        self.assertEqual(first["price_usd"], 100)
        self.assertEqual(first["price_age_ms"], 0)
        mid = model_v52_signal(signal("2026-06-15T14:31:00+00:00"), rows)
        self.assertEqual(mid["price_usd"], 100)
        self.assertFalse(mid["fill_verified"])

    def test_no_signal_cannot_become_trade(self):
        result = model_v52_signal(signal("2026-06-15T14:30:00+00:00", "NO_SIGNAL"), [])
        self.assertEqual(result["status"], "NOT_A_LIVE_SIGNAL")

    def test_stale_price_and_first_gap_fail_closed(self):
        past = bar("2026-06-12T13:30:00+00:00", "2026-06-12T14:30:00+00:00")
        self.assertEqual(model_v52_signal(signal("2026-06-15T14:30:00+00:00"), [past])["status"],
                         "NOT_VERIFIABLE_STALE_YAHOO_PRICE")
        start = datetime.fromtimestamp((INITIAL_GAP_END_MS - 3_600_000) / 1000, timezone.utc)
        self.assertEqual(model_v52_signal(signal(start.isoformat()), [])["status"],
                         "SKIPPED_INITIAL_50_DAY_GAP")

    def test_off_session_rejected(self):
        self.assertEqual(model_v52_signal(signal("2026-06-14T14:30:00+00:00"), [])["status"],
                         "SKIPPED_NYSE_CLOSED")

    def test_hourly_file_validates_identity_order_hash_and_ohlc(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "NVDA.jsonl"
            good = {"source": "YAHOO_FINANCE", "interval": "60m", "symbol": "NVDA",
                    "event_time_ms": stamp("2026-06-15T13:30:00+00:00"),
                    "bar_end_time_ms": stamp("2026-06-15T14:30:00+00:00"),
                    "open": 100, "high": 110, "low": 90, "close": 103,
                    "volume": 1000, "source_sha256": "b" * 64}
            path.write_text(json.dumps(good) + "\n", encoding="utf-8")
            self.assertEqual(load_yahoo_bars(path, "NVDA")[0].close, 103)
            path.write_text(json.dumps(good) + "\n" + json.dumps(good) + "\n")
            with self.assertRaisesRegex(ValueError, "DUPLICATE"):
                load_yahoo_bars(path, "NVDA")

    def test_scan_must_have_source_sha(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            file = root / "baseline-signal-scan-v52" / "decisions" / "V52.jsonl"
            file.parent.mkdir(parents=True)
            file.write_text(json.dumps(signal("2026-06-15T14:30:00+00:00")) + "\n")
            with self.assertRaisesRegex(ValueError, "MANIFEST_MISSING"):
                load_v52_signal_scan(file, "audited")
            (file.parent.parent / "signal-scan-manifest.json").write_text(json.dumps({"runtime_sha": "audited"}))
            self.assertEqual(len(load_v52_signal_scan(file, "audited")[0]), 1)
            with self.assertRaisesRegex(ValueError, "SHA_MISMATCH"):
                load_v52_signal_scan(file, "other")

if __name__ == "__main__":
    unittest.main()
