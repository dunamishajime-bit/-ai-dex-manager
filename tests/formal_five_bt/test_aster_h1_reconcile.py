"""Strict primary Aster 1m reconstruction of a malformed 1h candle."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from research.formal_five_bt.aster_h1_reconcile import (
    BAD_BTC_HOUR_TS, MINUTE_MS, aggregate_exact_aster_minute_hour,
    reconcile_one_primary_hour,
)
from research.formal_five_bt.crypto_price_model import _bars


def minute_rows(hour: int = BAD_BTC_HOUR_TS):
    records = []
    for i in range(60):
        start = hour + i * MINUTE_MS
        open_ = 100.0 if i == 0 else 101.0
        close = 105.0 if i == 59 else 101.0
        records.append([
            start, str(open_), str(max(open_, close) + 1.0),
            str(min(open_, close) - 1.0), str(close), "123.0",
            start + MINUTE_MS - 1, "15500.0",
        ])
    return records


def fixtures(root: Path) -> tuple[Path, Path, bytes]:
    candle = root / "normalized/aster/klines/BTCUSDT.jsonl"
    candle.parent.mkdir(parents=True)
    original = {"source": "aster", "exchange": "ASTER",
                "instrument": "BTCUSDT", "interval": "1h",
                "event_time_ms": BAD_BTC_HOUR_TS,
                "close_time_ms": BAD_BTC_HOUR_TS + 3_600_000 - 1,
                "open": 100.0, "high": 102.0, "low": 99.0, "close": 105.0,
                "base_volume": 5, "quote_volume": 500}
    raw = (json.dumps(original) + "\n").encode()
    candle.write_bytes(raw)
    manifest = root / "acquisition-manifest.json"
    manifest.write_text(json.dumps({"venues": {"aster": {"klines": {
        "BTCUSDT": {"status": "ACQUIRED",
                    "normalized_path": "normalized/aster/klines/BTCUSDT.jsonl",
                    "normalized_sha256": hashlib.sha256(raw).hexdigest()}
    }}}}))
    return candle, manifest, raw


def fetch_one_minute(rows=None, *, corrupt_hash=False):
    records = minute_rows() if rows is None else rows
    response = json.dumps(records).encode()
    sha = hashlib.sha256(response).hexdigest()
    def fetch(venue, symbol, start, end, **kwargs):
        assert (venue, symbol, start, end, kwargs["interval"]) == (
            "aster", "BTCUSDT", BAD_BTC_HOUR_TS,
            BAD_BTC_HOUR_TS + 3_600_000 - 1, "1m")
        return SimpleNamespace(
            source="aster", native_instrument="BTCUSDT", interval="1m",
            rows=records, raw_responses=[response],
            page_hashes=["0" * 64 if corrupt_hash else sha],
        )
    return fetch


class AsterOneMinuteRecoveryTests(unittest.TestCase):
    def test_complete_primary_minute_recovers_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candle, manifest, original = fixtures(root)
            result = reconcile_one_primary_hour(root, fetch=fetch_one_minute())
            self.assertEqual(result["validated_contiguous_bars"], 60)
            self.assertEqual(result["original_normalized_sha256"], hashlib.sha256(original).hexdigest())
            backup = root / result["original_normalized_path"]
            self.assertEqual(backup.read_bytes(), original)
            self.assertTrue(result["reconstructed_h1_ohlc_valid"])
            updated = json.loads(candle.read_text())
            self.assertEqual(updated["high"], 106.0)
            self.assertEqual(updated["low"], 99.0)
            self.assertEqual(updated["close"], 105.0)
            self.assertEqual(json.loads(manifest.read_text())["aster_h1_reconstruction"], result)
            self.assertEqual(hashlib.sha256(candle.read_bytes()).hexdigest(),
                             result["derived_normalized_sha256"])
            clean, timeline, invalid = _bars(root, "BTCUSDT")
            self.assertEqual(len(clean), 1)
            self.assertEqual(invalid, [])
            self.assertIn(BAD_BTC_HOUR_TS, timeline)

    def test_missing_minute_fails_closed_no_source_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candle, manifest, original = fixtures(root)
            before = manifest.read_bytes()
            missing = [row for index, row in enumerate(minute_rows()) if index != 50]
            with self.assertRaisesRegex(ValueError, "60_CONTIGUOUS"):
                reconcile_one_primary_hour(root, fetch=fetch_one_minute(missing))
            self.assertEqual(candle.read_bytes(), original)
            self.assertEqual(manifest.read_bytes(), before)

    def test_minute_raw_page_digest_rejects_tamper(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candle, manifest, original = fixtures(root)
            with self.assertRaisesRegex(ValueError, "MINUTE_PAGE_HASH_MISMATCH"):
                reconcile_one_primary_hour(root, fetch=fetch_one_minute(corrupt_hash=True))
            self.assertEqual(candle.read_bytes(), original)

    def test_source_open_close_divergence_rejects_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candle, manifest, original = fixtures(root)
            minute = minute_rows()
            minute[-1][4] = "106"
            with self.assertRaisesRegex(ValueError, "CLOSE_DIVERGENCE"):
                reconcile_one_primary_hour(root, fetch=fetch_one_minute(minute))
            self.assertEqual(candle.read_bytes(), original)

    def test_duplicate_minute_and_invalid_price_rejected(self):
        minute = minute_rows()
        minute[25] = minute[24][:]
        with self.assertRaisesRegex(ValueError, "60_CONTIGUOUS"):
            aggregate_exact_aster_minute_hour(minute, BAD_BTC_HOUR_TS)
        minute = minute_rows()
        minute[15][2] = "99"
        with self.assertRaisesRegex(ValueError, "INVALID_NATIVE_MINUTE_OHLC"):
            aggregate_exact_aster_minute_hour(minute, BAD_BTC_HOUR_TS)

    def test_only_known_invalid_aster_hour_can_be_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candle, manifest, original = fixtures(root)
            data = json.loads(candle.read_text())
            data["high"] = 107
            valid = (json.dumps(data) + "\n").encode()
            candle.write_bytes(valid)
            m = json.loads(manifest.read_text())
            m["venues"]["aster"]["klines"]["BTCUSDT"]["normalized_sha256"] = hashlib.sha256(valid).hexdigest()
            manifest.write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError, "ORIGINAL_IS_ALREADY_VALID"):
                reconcile_one_primary_hour(root, fetch=fetch_one_minute())


if __name__ == "__main__":
    unittest.main()
