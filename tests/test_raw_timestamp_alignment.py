import gzip
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.research.raw_data.models import Bar
from scripts.research.raw_data.q102_rebuild import generate_q102_candidates
from scripts.research.raw_data.v12_rebuild import generate_v12_candidates
from scripts.research.raw_data.run_alternate_replay import START_MS, END_MS, _load_bundle

H = 3_600_000
T = 1_700_000_000_000


class TimestampAlignmentRegressionTests(unittest.TestCase):
    def test_v12_does_not_rank_unaligned_list_indices(self):
        early = [
            Bar("AAA", T, 100, 100, 100, 100, 1),
            Bar("AAA", T + H, 100, 102, 100, 102, 1),
            Bar("AAA", T + 2 * H, 102, 104, 102, 104, 1),
            Bar("AAA", T + 3 * H, 104, 105, 104, 105, 1),
        ]
        late = [
            Bar("BBB", T + H, 100, 100, 100, 100, 1),
            Bar("BBB", T + 2 * H, 100, 120, 100, 120, 1),
            Bar("BBB", T + 3 * H, 120, 121, 120, 121, 1),
        ]
        candidates = generate_v12_candidates(
            {"AAA": early, "BBB": late},
            {"top_n": 3, "aggregate_gross_cap": 3.0}, "NORMAL",
        )
        earlier = [c for c in candidates if c["signalTs"] == T + H]
        later = [c for c in candidates if c["signalTs"] == T + 2 * H]
        self.assertEqual([c["symbol"] for c in earlier], ["AAA"])
        self.assertEqual(later[0]["symbol"], "BBB")
        self.assertEqual(later[0]["entryTs"], T + 3 * H)

    def test_q102_proxy_excludes_symbols_without_same_utc_previous_bar(self):
        rows = {
            "AAA": [
                Bar("AAA", T, 100, 100, 100, 100, 1),
                Bar("AAA", T + H, 100, 102, 100, 102, 1),
                Bar("AAA", T + 2 * H, 102, 104, 102, 104, 1),
                Bar("AAA", T + 3 * H, 104, 105, 104, 105, 1),
            ],
            "BBB": [
                Bar("BBB", T + H, 100, 100, 100, 100, 1),
                Bar("BBB", T + 2 * H, 100, 120, 100, 120, 1),
                Bar("BBB", T + 3 * H, 120, 121, 120, 121, 1),
            ],
        }
        candidates = generate_q102_candidates({"bars": rows}, "NORMAL")
        self.assertEqual([c["symbol"] for c in candidates], ["AAA", "BBB"])
        self.assertEqual([c["signalTs"] for c in candidates], [T + H, T + 2 * H])
        self.assertTrue(all(c["productionParity"] is False for c in candidates))

    def test_full_year_utc_boundary_and_fet_venue_inception(self):
        self.assertEqual(datetime.fromtimestamp(START_MS / 1000, timezone.utc).isoformat(), "2025-08-10T00:00:00+00:00")
        self.assertEqual(datetime.fromtimestamp(END_MS / 1000, timezone.utc).isoformat(), "2026-08-10T00:00:00+00:00")
        inception = int(datetime(2026, 1, 9, 18, tzinfo=timezone.utc).timestamp() * 1000)
        rows = [
            {"symbol": "FETUSDT", "ts_ms": inception - H, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
            {"symbol": "FETUSDT", "ts_ms": inception, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
        ]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bundle.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as file:
                json.dump({"bars": {"FETUSDT": rows}, "funding": {}}, file)
            bundle = _load_bundle(path)
        self.assertEqual(len(bundle["bars"]["FETUSDT"]), 1)
        self.assertEqual(bundle["bars"]["FETUSDT"][0]["ts_ms"], inception)


if __name__ == "__main__":
    unittest.main()
