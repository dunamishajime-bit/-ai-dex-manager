import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class V52ReferenceTransientTests(unittest.TestCase):
    def test_local_reference_stale_and_unavailable_are_transient_for_every_v52_symbol(self):
        for symbol in ("META", "AMZN", "MSFT", "NVDA", "TSLA"):
            stale = f'HTTP 503 http://127.0.0.1:8797/quote?symbol={symbol}: {{"error":"stale_quote","symbol":"{symbol}","ageMs":31595,"maximumAgeMs":30000}}'
            unavailable = f'HTTP 503 http://127.0.0.1:8797/quote?symbol={symbol}: {{"error":"quote_unavailable","symbol":"{symbol}"}}'
            self.assertTrue(v52.transient_reference_error(stale), symbol)
            self.assertTrue(v52.transient_reference_error(unavailable), symbol)

        self.assertFalse(v52.transient_reference_error('HTTP 503 https://example.com/quote?symbol=META: {"error":"stale_quote"}'))
        self.assertFalse(v52.transient_reference_error('HTTP 503 http://127.0.0.1:8797/quote?symbol=META: {"error":"cross_source_failure"}'))


if __name__ == "__main__":
    unittest.main()
