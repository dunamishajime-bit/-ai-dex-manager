from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.v52_price_only_scan import (
    MODEL_ID, PerpBar, asof_price, model_v50_at_window,
    read_stock_perp_bars, run_price_only_scan,
    verified_policy,
)
from research.formal_five_bt.yahoo_v52 import YahooBar

def ts(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)

def yahoo(start, end, close, symbol="NVDA"):
    return YahooBar(symbol, ts(start), ts(end), close, close + 0.2,
                    close - 0.2, close, 1_000, "a" * 64)

def policy():
    return {
        "strategy": "V50_POST_OPEN_BASIS", "windowPolicy": "POST_EARLY3",
        "minimumEntryBasisBps": 60, "convergenceBps": 20,
        "maximumRoundTripCostBps": 60, "minimumNetEdgeBps": 7.5,
    }

class V52HourlyResearchTests(unittest.TestCase):
    def _data(self):
        yahoo_bars = [
            yahoo("2026-06-15T13:30:00Z", "2026-06-15T14:30:00Z", 100),
            yahoo("2026-06-15T14:30:00Z", "2026-06-15T15:30:00Z", 100.5),
            yahoo("2026-06-15T15:30:00Z", "2026-06-15T16:30:00Z", 100.75),
        ]
        aster = [
            PerpBar("NVDA", ts("2026-06-15T14:00:00Z"), 102.0, "b" * 64),
            PerpBar("NVDA", ts("2026-06-15T15:00:00Z"), 102.0, "b" * 64),
            PerpBar("NVDA", ts("2026-06-15T16:00:00Z"), 102.0, "b" * 64),
        ]
        return {"NVDA": yahoo_bars}, {"NVDA": aster}

    def test_pre_window_only_sees_prior_completed_yahoo_hour(self):
        y, p = self._data()
        pre = ts("2026-06-15T15:29:50Z")
        ref, status, end, _ = asof_price(y["NVDA"], "NVDA", pre)
        self.assertEqual(status, "ASOF_HOURLY_PRICE")
        self.assertEqual(ref, 100)
        self.assertEqual(end, ts("2026-06-15T14:30:00Z"))
        # Changing the uncompleted 10:30-11:30 close must not alter pre-entry price.
        updated = list(y["NVDA"])
        updated[1] = yahoo("2026-06-15T14:30:00Z", "2026-06-15T15:30:00Z", 200)
        self.assertEqual(asof_price(updated, "NVDA", pre)[0], 100)
        rows = model_v50_at_window(date(2026, 6, 15), datetime.strptime("11:30", "%H:%M").time(),
                                   y, p, policy())
        chosen = [row for row in rows if row["status"] == "PRICE_ONLY_MODEL_SELECTED_UNALLOCATED"]
        self.assertEqual(len(chosen), 1)
        self.assertEqual(chosen[0]["equity_reference_symbol"], "NVDA")
        self.assertGreater(chosen[0]["capture_basis_bps"], 0)
        self.assertGreater(chosen[0]["entry_basis_bps"], 0)
        self.assertEqual(chosen[0]["historical_aster_fill_verified"], False)
        self.assertIsNone(chosen[0]["realized_pnl_usdt"])
        self.assertEqual(chosen[0]["asof"]["capture"]["yahoo_end_ms"], ts("2026-06-15T14:30:00Z"))

    def test_missing_entry_hour_blocks_price_model_instead_of_reusing_old_close(self):
        y, p = self._data()
        y["NVDA"] = y["NVDA"][:1]
        rows = model_v50_at_window(date(2026, 6, 15), datetime.strptime("11:30", "%H:%M").time(),
                                   y, p, policy())
        row = next(row for row in rows if row["equity_reference_symbol"] == "NVDA")
        self.assertEqual(row["status"], "MODEL_REJECTED")
        self.assertIn("MISSING_CAUSAL_PRICE_INPUT", row["reasons"])

    def test_cost_stress_can_remove_the_optimistic_model_candidate(self):
        y, p = self._data()
        rows = model_v50_at_window(date(2026, 6, 15), datetime.strptime("11:30", "%H:%M").time(),
                                   y, p, policy(), assumed_round_trip_cost_bps=75)
        self.assertFalse(any(row["status"] == "PRICE_ONLY_MODEL_SELECTED_UNALLOCATED" for row in rows))
        row = next(row for row in rows if row["equity_reference_symbol"] == "NVDA")
        self.assertIn("COST_EXCEEDS_MAXIMUM", row["reasons"])

    def test_after_early_close_no_v50_window(self):
        y, p = self._data()
        rows = model_v50_at_window(date(2025, 11, 28),
                                   datetime.strptime("13:30", "%H:%M").time(), y, p, policy())
        self.assertEqual(rows, [])

    def test_aster_perp_series_needs_completed_contiguous_hour_and_matching_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "NVDAUSDT.jsonl"
            row = {"source": "aster", "instrument": "NVDAUSDT", "interval": "1h",
                   "event_time_ms": ts("2026-06-15T14:00:00Z"),
                   "close_time_ms": ts("2026-06-15T15:00:00Z") - 1,
                   "open": 101, "high": 103, "low": 100, "close": 102}
            path.write_text(json.dumps(row) + "\n")
            self.assertEqual(read_stock_perp_bars(path, "NVDA")[0].close, 102)
            path.write_text(json.dumps(row) + "\n" + json.dumps(row) + "\n")
            with self.assertRaisesRegex(ValueError, "NONCAUSAL"):
                read_stock_perp_bars(path, "NVDA")

    def test_research_scan_requires_sha_validated_production_policy(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "runtime_source_snapshot" / "config" / "v52V50Runtime.json"
            config.parent.mkdir(parents=True)
            raw = json.dumps(policy()).encode()
            config.write_bytes(raw)
            manifest = {"files": [{"path": "config/v52V50Runtime.json",
                                   "sha256": hashlib.sha256(raw).hexdigest()}]}
            self.assertEqual(verified_policy(manifest, config.parents[1])[1], hashlib.sha256(raw).hexdigest())
            manifest["files"][0]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "SHA256_MISMATCH"):
                verified_policy(manifest, config.parents[1])

if __name__ == "__main__":
    unittest.main()
