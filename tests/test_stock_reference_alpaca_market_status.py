import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import disdex_stock_reference_alpaca_proxy as proxy
from scripts.disdex_us_equity_calendar import regular_us_equity_session


class AlpacaReferenceMarketStatusTest(unittest.TestCase):
    def test_health_exposes_canonical_market_open_flag(self):
        store = proxy.QuoteStore()
        payload = store.health()

        self.assertIn("marketOpen", payload)
        self.assertIsInstance(payload["marketOpen"], bool)
        self.assertEqual(payload["marketOpen"], regular_us_equity_session())


if __name__ == "__main__":
    unittest.main()
