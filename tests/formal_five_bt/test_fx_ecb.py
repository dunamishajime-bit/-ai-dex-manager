from datetime import date, datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.fx_ecb import (
    acquire_ecb_cross, asof_jpy_per_usd, load_ecb_cross, parse_ecb_cross,
)


class EcbCrossTests(unittest.TestCase):
    def test_same_day_reference_never_available_before_next_utc_day(self):
        data = ("TIME_PERIOD,CURRENCY,OBS_VALUE\n"
                "2025-08-08,USD,1.1\n"
                "2025-08-08,JPY,165\n"
                "2025-08-11,USD,1.2\n"
                "2025-08-11,JPY,180\n").encode()
        rows = parse_ecb_cross(data)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["rate_jpy_per_usd"], 150.0)
        when = lambda day, hour: int(datetime(2025, 8, day, hour, tzinfo=timezone.utc).timestamp() * 1000)
        series = [(int(r["event_time_ms"]), float(r["rate_jpy_per_usd"])) for r in rows]
        self.assertRaisesRegex(ValueError, "UNAVAILABLE", asof_jpy_per_usd, series, when(8, 23))
        self.assertEqual(asof_jpy_per_usd(series, when(9, 0)), 150.0)
        self.assertEqual(asof_jpy_per_usd(series, when(11, 23)), 150.0)
        self.assertEqual(asof_jpy_per_usd(series, when(12, 0)), 150.0)

    def test_duplicate_malformed_and_tamper_fail_closed(self):
        duplicate = ("TIME_PERIOD,CURRENCY,OBS_VALUE\n"
                     "2025-08-08,USD,1.1\n2025-08-08,USD,1.2\n"
                     "2025-08-08,JPY,165\n").encode()
        with self.assertRaisesRegex(ValueError, "DUPLICATE"):
            parse_ecb_cross(duplicate)
        with self.assertRaisesRegex(ValueError, "REQUIRED_COLUMNS"):
            parse_ecb_cross(b"date,rate\n2025-08-08,155\n")
        with tempfile.TemporaryDirectory() as tmp:
            payload = ("TIME_PERIOD,CURRENCY,OBS_VALUE\n"
                       "2025-08-08,USD,1.1\n2025-08-08,JPY,165\n").encode()
            manifest = acquire_ecb_cross(
                Path(tmp), start=date(2025, 8, 8), end=date(2025, 8, 9),
                fetch=lambda _: payload)
            self.assertEqual(manifest["observation_count"], 1)
            self.assertEqual(load_ecb_cross(tmp)[0][1], 150.0)
            path = Path(tmp) / str(manifest["normalized_path"])
            path.write_bytes(path.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "HASH_MISMATCH"):
                load_ecb_cross(tmp)

    def test_stale_reference_is_rejected(self):
        series = [(1000, 150.0)]
        with self.assertRaisesRegex(ValueError, "UNAVAILABLE"):
            asof_jpy_per_usd(series, 1000 + 10 * 86_400_000)


if __name__ == "__main__":
    unittest.main()
