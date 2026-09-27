import hashlib
import json
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse
import unittest

from research.formal_five_bt.yahoo_acquire import yahoo_hourly_page

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

    def test_wrong_currency_fails(self):
        raw = b'{"chart":{"error":null,"result":[{"meta":{"currency":"JPY","exchangeTimezoneName":"America/New_York"},"timestamp":[],"indicators":{"quote":[{"open":[],"high":[],"low":[],"close":[],"volume":[]}]}}]}}'
        with self.assertRaisesRegex(ValueError, "CURRENCY"):
            yahoo_hourly_page("NVDA",
                datetime(2026, 6, 15, tzinfo=timezone.utc),
                datetime(2026, 6, 16, tzinfo=timezone.utc), lambda _url: raw)

if __name__ == "__main__":
    unittest.main()
