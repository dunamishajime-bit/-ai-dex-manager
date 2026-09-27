from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import hashlib
import tempfile
import unittest

from research.formal_five_bt.aster_stock_acquire import acquire_aster_stock

def ms(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp() * 1000)

class StockAcquisitionTests(unittest.TestCase):
    def _catalog(self):
        return SimpleNamespace(
            rows=[{"symbol": "NVDAUSDT", "contractType": "PERPETUAL",
                   "quoteAsset": "USDT", "status": "TRADING",
                   "onboardDate": str(ms("2026-06-15T00:00:00")),
                   "deliveryDate": None}],
            page_hashes=["d" * 64],
        )

    def test_only_listed_verified_stock_price_history_is_written(self):
        calls = []
        def klines(symbol, start, end):
            calls.append((symbol, start, end))
            row = [ms("2026-06-15T13:00:00"), "100", "101", "99", "100",
                   "10", ms("2026-06-15T13:59:59"), "1000"]
            raw = b'raw-aster-public-page'
            return SimpleNamespace(source="aster", native_instrument=symbol, interval="1h",
                                   rows=[row], raw_responses=[raw],
                                   page_hashes=[hashlib.sha256(raw).hexdigest()])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = acquire_aster_stock(
                root, start=date(2025, 8, 10), end_exclusive=date(2026, 8, 11),
                get_catalog=self._catalog, get_klines=klines)
            nvda = result["symbols"]["NVDA"]
            self.assertEqual(nvda["status"], "AVAILABLE_REQUIRES_SIGNAL_ALIGNMENT")
            self.assertEqual(nvda["bars"], 1)
            self.assertEqual(calls[0][1], ms("2026-06-15T00:00:00"))
            self.assertFalse(any(x[0] == "AMZNUSDT" for x in calls))
            self.assertEqual(result["symbols"]["AMZN"]["status"], "INSTRUMENT_NOT_IN_CURRENT_CATALOG")
            self.assertTrue((root / "normalized/aster_stock/klines/NVDAUSDT.jsonl").is_file())

    def test_invalid_or_unverified_price_chain_is_never_accepted(self):
        def invalid(symbol, start, end):
            raw = b"wrong"
            return SimpleNamespace(
                source="aster", native_instrument=symbol, interval="1h",
                rows=[[ms("2026-06-15T13:00:00"), "100", "95", "99", "100", "10",
                       ms("2026-06-15T13:59:59")]],
                raw_responses=[raw], page_hashes=["b" * 64])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = acquire_aster_stock(root, get_catalog=self._catalog, get_klines=invalid)
            self.assertEqual(result["symbols"]["NVDA"]["status"], "ACQUISITION_OR_VALIDATION_FAILED")
            self.assertFalse((root / "normalized/aster_stock/klines/NVDAUSDT.jsonl").exists())

    def test_not_yet_listed_in_period_never_queried(self):
        def catalog():
            value = self._catalog()
            value.rows[0]["onboardDate"] = str(ms("2026-09-01T00:00:00"))
            return value
        def nope(*_args):
            raise AssertionError("must never query a future-listed instrument")
        with tempfile.TemporaryDirectory() as tmp:
            report = acquire_aster_stock(Path(tmp), get_catalog=catalog, get_klines=nope)
        self.assertEqual(report["symbols"]["NVDA"]["status"], "NOT_LISTED_DURING_BACKTEST_PERIOD")

if __name__ == "__main__":
    unittest.main()
