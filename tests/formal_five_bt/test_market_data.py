from __future__ import annotations

import dataclasses
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone

from research.formal_five_bt.market_data import (
    Bar,
    BookObservation,
    FxRate,
    deposit_usdt,
    validate_series,
)
from research.formal_five_bt.datasets import load_aster_dataset


HOUR = 60 * 60 * 1000


def bar(ts: int, *, instrument: str = "BTCUSDT", close: float = 10.0) -> Bar:
    return Bar(
        exchange="aster",
        instrument_id=instrument,
        contract_type="linear_perpetual",
        event_time_ms=ts,
        source_time_ms=ts + HOUR - 1,
        received_time_ms=ts + HOUR,
        content_sha256="a" * 64,
        interval_ms=HOUR,
        open=close,
        high=close + 1,
        low=close - 1,
        close=close,
        volume=1.0,
    )


class MarketDataValidationTests(unittest.TestCase):
    def test_dataset_gap_scan_starts_at_first_acquired_bar_not_exchange_listing_date(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            normalized = root / "normalized" / "aster" / "klines" / "BTCUSDT.jsonl"
            normalized.parent.mkdir(parents=True)
            rows = [
                {"source": "aster", "exchange": "ASTER", "instrument": "BTCUSDT", "interval": "1h",
                 "event_time_ms": ts, "close_time_ms": ts + HOUR - 1,
                 "open": 10, "high": 11, "low": 9, "close": 10, "base_volume": 1}
                for ts in (100 * HOUR, 101 * HOUR, 102 * HOUR)
            ]
            body = "".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n" for row in rows).encode()
            normalized.write_bytes(body)
            (root / "acquisition-manifest.json").write_text(json.dumps({
                "venues": {
                    "aster": {
                        "klines": {"BTCUSDT": {
                            "status": "ACQUIRED", "normalized_path": "normalized/aster/klines/BTCUSDT.jsonl",
                            "normalized_sha256": hashlib.sha256(body).hexdigest(),
                        }},
                        "instruments": {"BTCUSDT": {"listed_from_ms": 0}},
                        "funding": {"BTCUSDT": {"status": "MISSING"}},
                    }
                }
            }))

            result = load_aster_dataset(root, "BTCUSDT")

            self.assertEqual(len(result.bars), 3)
            self.assertNotIn("MISSING_INTERVAL", {issue.code for issue in result.issues})

    def test_prelisting_funding_rows_are_excluded_from_current_contract_and_logged(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bars_path = root / "normalized" / "aster" / "klines" / "BTCUSDT.jsonl"
            funding_path = root / "normalized" / "aster" / "funding" / "BTCUSDT.jsonl"
            bars_path.parent.mkdir(parents=True)
            funding_path.parent.mkdir(parents=True)
            bar_rows = [{
                "source": "aster", "exchange": "ASTER", "instrument": "BTCUSDT", "interval": "1h",
                "event_time_ms": 100 * HOUR, "close_time_ms": 101 * HOUR - 1,
                "open": 10, "high": 11, "low": 9, "close": 10, "base_volume": 1,
            }]
            funding_rows = [
                {"source": "aster", "exchange": "ASTER", "instrument": "BTCUSDT", "event_time_ms": 99 * HOUR, "funding_rate": 0.001},
                {"source": "aster", "exchange": "ASTER", "instrument": "BTCUSDT", "event_time_ms": 100 * HOUR, "funding_rate": -0.001},
            ]
            def write_rows(path: Path, rows: list[dict[str, object]]) -> str:
                body = "".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n" for row in rows).encode()
                path.write_bytes(body)
                return hashlib.sha256(body).hexdigest()
            bars_hash = write_rows(bars_path, bar_rows)
            funding_hash = write_rows(funding_path, funding_rows)
            (root / "acquisition-manifest.json").write_text(json.dumps({
                "venues": {"aster": {
                    "klines": {"BTCUSDT": {"status": "ACQUIRED", "normalized_path": "normalized/aster/klines/BTCUSDT.jsonl", "normalized_sha256": bars_hash}},
                    "instruments": {"BTCUSDT": {"listed_from_ms": 100 * HOUR}},
                    "funding": {"BTCUSDT": {"status": "ACQUIRED", "normalized_path": "normalized/aster/funding/BTCUSDT.jsonl", "normalized_sha256": funding_hash}},
                }}
            }))

            result = load_aster_dataset(root, "BTCUSDT")

            self.assertEqual([row.event_time_ms for row in result.funding], [100 * HOUR])
            prelisting = [issue for issue in result.issues if issue.code == "PRE_LISTING_FUNDING_EXCLUDED"]
            self.assertEqual(len(prelisting), 1)
            self.assertFalse(prelisting[0].blocking)

    def test_records_are_immutable_and_hash_is_validated(self) -> None:
        record = bar(0)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            record.close = 99.0
        invalid = dataclasses.replace(record, content_sha256="bad")
        issues = validate_series([invalid], expected_interval_ms=HOUR)
        self.assertIn("INVALID_CONTENT_HASH", {issue.code for issue in issues})

    def test_duplicate_out_of_order_missing_and_stale_bars_are_reported(self) -> None:
        records = [bar(2 * HOUR), bar(0), bar(2 * HOUR)]
        issues = validate_series(
            records,
            expected_interval_ms=HOUR,
            listed_from_ms=0,
            listed_until_ms=3 * HOUR,
            asof_ms=5 * HOUR,
            max_age_ms=HOUR,
        )
        codes = {issue.code for issue in issues}
        self.assertTrue({"DUPLICATE_TIMESTAMP", "OUT_OF_ORDER", "MISSING_INTERVAL", "STALE"}.issubset(codes))

    def test_misaligned_malformed_and_instrument_mismatch_are_blocking(self) -> None:
        record = dataclasses.replace(bar(1), high=8.0)
        issues = validate_series(
            [record],
            expected_interval_ms=HOUR,
            expected_native_instrument="BTC-USDT-SWAP",
            expected_contract_type="linear_perpetual",
        )
        codes = {issue.code for issue in issues}
        self.assertTrue({"MISALIGNED_TIMESTAMP", "INVALID_OHLC", "INSTRUMENT_MISMATCH"}.issubset(codes))

    def test_book_sequence_gap_and_update_without_snapshot_are_reported(self) -> None:
        book = BookObservation(
            exchange="okx",
            instrument_id="BTC-USDT-SWAP",
            contract_type="linear_perpetual",
            event_time_ms=1000,
            source_time_ms=1000,
            received_time_ms=1001,
            content_sha256="b" * 64,
            event_type="update",
            first_update_id=12,
            final_update_id=12,
            prev_final_update_id=10,
            bids=((100.0, 1.0),),
            asks=((101.0, 1.0),),
        )
        issues = validate_series([book], expected_interval_ms=None)
        self.assertTrue({"BOOK_UPDATE_WITHOUT_SNAPSHOT", "BOOK_SEQUENCE_GAP"}.issubset({issue.code for issue in issues}))

    def test_future_fx_is_never_used_for_jpy_deposit_conversion(self) -> None:
        rates = [
            FxRate("FRED", "DEXJPUS", "reference", 10_000, 10_000, 10_001, "c" * 64, 150.0),
            FxRate("FRED", "DEXJPUS", "reference", 20_000, 20_000, 20_001, "d" * 64, 100.0),
        ]
        converted = deposit_usdt(10_000, datetime.fromtimestamp(15, tz=timezone.utc), rates)
        self.assertAlmostEqual(converted.amount_usdt, 10_000 / 150.0)
        self.assertEqual(converted.rate_time_ms, 10_000)
        with self.assertRaisesRegex(ValueError, "no FX observation available as of event"):
            deposit_usdt(10_000, datetime.fromtimestamp(9, tz=timezone.utc), rates)

    def test_source_timestamp_after_decision_is_rejected(self) -> None:
        record = dataclasses.replace(bar(0), source_time_ms=HOUR + 1)
        issues = validate_series([record], expected_interval_ms=HOUR, asof_ms=HOUR)
        self.assertIn("SOURCE_TIME_AFTER_ASOF", {issue.code for issue in issues})

    def test_event_at_or_after_decision_is_rejected(self) -> None:
        record = bar(HOUR)
        issues = validate_series([record], expected_interval_ms=HOUR, asof_ms=HOUR)
        self.assertIn("FUTURE_OR_ASOF_LEAK", {issue.code for issue in issues})


if __name__ == "__main__":
    unittest.main()
