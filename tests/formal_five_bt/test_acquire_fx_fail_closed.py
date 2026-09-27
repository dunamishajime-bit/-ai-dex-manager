"""A FRED outage must not discard valid Aster signal history or invent FX."""
from datetime import date, datetime, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import unittest

from research.formal_five_bt import acquire as acq
from research.formal_five_bt.datasets import load_fred_fx


START = int(datetime(2025, 8, 10, tzinfo=timezone.utc).timestamp() * 1000)
LISTED = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)


class AcquisitionFxOutageTests(unittest.TestCase):
    def test_aster_is_persisted_while_fred_remains_unverified(self):
        catalog = SimpleNamespace(
            rows=[{"symbol": "TESTUSDT", "contractType": "PERPETUAL",
                   "quoteAsset": "USDT", "onboardDate": LISTED,
                   "status": "TRADING"}],
            raw_responses=[b"{}"],
            page_hashes=["e" * 64])
        candles = SimpleNamespace(
            source="aster", native_instrument="TESTUSDT", interval="1h",
            rows=[[START, "100", "101", "99", "100", "20",
                   START + 3_600_000 - 1, "2000"]],
            raw_responses=[b'[]'],
            actual_start_ms=START,
            actual_end_ms=START)
        funding = SimpleNamespace(
            rows=[{"fundingTime": START + 10_000, "fundingRate": "0.0002"}],
            raw_responses=[b'[]'])
        universes = {"V12": ["TESTUSDT"], "PENGU": [],
                     "Q102": [], "FET": [],
                     "crypto_union": ["TESTUSDT"]}
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            with (
                patch.object(acq, "extract_universes", return_value=universes),
                patch.object(acq.sources, "fetch_instrument_catalog",
                             return_value=catalog),
                patch.object(acq.sources, "fetch_historical_klines",
                             return_value=candles),
                patch.object(acq.sources, "fetch_historical_funding",
                             return_value=funding),
                patch.object(acq.sources, "fetch_fred_dexjpus",
                             side_effect=RuntimeError("mock remote outage")),
            ):
                result = acq.acquire(
                    root, warmup_start=date(2025, 8, 10),
                    start_date=date(2025, 8, 10),
                    end_date_exclusive=date(2025, 8, 12),
                    venues=("aster",), sleep_seconds=0)
            self.assertEqual(result["status"], "ACQUISITION_PARTIAL_FX_NOT_VERIFIABLE")
            self.assertEqual(result["fred"]["observations"], 0)
            self.assertFalse(result["fred"]["portfolio_accounting_permitted"])
            self.assertEqual(
                result["venues"]["aster"]["klines"]["TESTUSDT"]["status"],
                "ACQUIRED")
            self.assertTrue((root / "normalized/aster/klines/TESTUSDT.jsonl").is_file())
            self.assertTrue((root / "normalized/aster/funding/TESTUSDT.jsonl").is_file())
            self.assertTrue((root / "acquisition-manifest.json").is_file())
            rates, issues = load_fred_fx(root)
            self.assertFalse(rates)
            self.assertTrue(any(item.code == "FX_UNAVAILABLE" for item in issues))
            self.assertNotIn("mock remote outage", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
