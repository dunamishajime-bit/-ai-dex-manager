import hashlib
import json
import tempfile
from pathlib import Path
from datetime import date, datetime, timezone
from urllib.parse import parse_qs, urlparse
import unittest

from research.formal_five_bt.yahoo_acquire import yahoo_hourly_page, acquire_yahoo_v52

class YahooAcquisitionTests(unittest.TestCase):
    def test_frozen_historical_hourly_rows_and_raw_hash(self):
        raw = json.dumps({"chart": {"error": None, "result": [{
            "meta": {"currency": "USD", "exchangeTimezoneName": "America/New_York"},
            "timestamp": [int(datetime(2026, 6, 15, 13, 30, tzinfo=timezone.utc).timestamp())],
            "indicators": {"quote": [{"open": [100.0], "high": [101.0], "low": [99.0],
                                       "close": [100.5], "volume": [1000]}]},
        }]}}).encode()
        urls = []
        def fetch(url):
            urls.append(url)
            return raw
        rows, page = yahoo_hourly_page("NVDA",
            datetime(2026, 6, 15, tzinfo=timezone.utc),
            datetime(2026, 6, 16, tzinfo=timezone.utc), fetch)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["close"], 100.5)
        self.assertEqual(rows[0]["bar_end_time_ms"] - rows[0]["event_time_ms"], 3_600_000)
        self.assertEqual(page["response_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(parse_qs(urlparse(urls[0]).query)["interval"], ["60m"])

    def test_missing_broad_page_hours_are_retried_by_same_yahoo_day_query(self):
        calls = []
        def fetch(url):
            calls.append(url)
            q = parse_qs(urlparse(url).query)
            start = int(q["period1"][0])
            end = int(q["period2"][0])
            if end - start > 86_400:
                timestamps = []
            else:
                requested = datetime.fromtimestamp(start, timezone.utc)
                local_day = requested.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).date()
                base = datetime(local_day.year, local_day.month, local_day.day, 13, 30, tzinfo=timezone.utc)
                timestamps = [int((base.replace()).timestamp()) + i * 3600 for i in range(7)]
            n = len(timestamps)
            payload = {"chart": {"error": None, "result": [{
                "meta": {"currency": "USD", "exchangeTimezoneName": "America/New_York"},
                "timestamp": timestamps,
                "indicators": {"quote": [{
                    "open": [100.0] * n, "high": [101.0] * n, "low": [99.0] * n,
                    "close": [100.5] * n, "volume": [1000] * n,
                }]},
            }]}}
            return json.dumps(payload).encode()

        with tempfile.TemporaryDirectory() as temp:
            result = acquire_yahoo_v52(
                Path(temp), date(2026, 6, 15), date(2026, 6, 17), fetch=fetch)
            for symbol, row in result["symbols"].items():
                self.assertEqual(row["status"], "COVERAGE_COMPLETE", symbol)
                self.assertEqual(row["missing_session_hours"], 0)
                self.assertEqual(row["rows"], 14)
                recovered = [p for p in row["pages"]
                             if p.get("recovery") == "MISSING_NYSE_SESSION_DAY_RETRY"]
                self.assertEqual(len(recovered), 2)
            self.assertGreater(len(calls), 5)

    def test_wrong_currency_fails(self):
        raw = b'{"chart":{"error":null,"result":[{"meta":{"currency":"JPY","exchangeTimezoneName":"America/New_York"},"timestamp":[],"indicators":{"quote":[{"open":[],"high":[],"low":[],"close":[],"volume":[]}]}}]}}'
        with self.assertRaisesRegex(ValueError, "CURRENCY"):
            yahoo_hourly_page("NVDA",
                datetime(2026, 6, 15, tzinfo=timezone.utc),
                datetime(2026, 6, 16, tzinfo=timezone.utc), lambda _url: raw)

if __name__ == "__main__":
    unittest.main()
