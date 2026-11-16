import csv
import json
from pathlib import Path
import tempfile
import unittest

import stable4_research_dd_independent_audit as dd


class IndependentDDTests(unittest.TestCase):
    def fixture(self, values=(100, 120, 90)):
        tmp = tempfile.TemporaryDirectory()
        folder = Path(tmp.name)
        with (folder / "SAMPLE_10BPS_EQUITY_30MIN.csv").open("w", newline="", encoding="utf-8") as f:
            wr = csv.DictWriter(f, fieldnames=["utc", "compounded_mtm_equity_jpy"])
            wr.writeheader()
            for t, v in zip(["2025-10-01T00:00:00Z",
                             "2025-10-01T00:05:00Z",
                             "2025-10-01T00:10:00Z"], values):
                wr.writerow(dict(utc=t, compounded_mtm_equity_jpy=v))
        return tmp, folder

    def test_recomputes_peak_to_trough_in_actual_five_minute_samples(self):
        tmp, folder = self.fixture()
        with tmp:
            r = dd.compute_equity_dd(folder / "SAMPLE_10BPS_EQUITY_30MIN.csv",
                                     start="2025-10-01T00:00:00Z",
                                     end="2025-10-01T00:10:00Z")
            self.assertEqual(r["rows"], 3)
            self.assertAlmostEqual(r["maxDrawdownPct"], -25.0)
            self.assertEqual(r["drawdownTroughUtc"], "2025-10-01T00:10:00Z")
            self.assertEqual(r["actualSamplingSeconds"], 300)

    def test_gap_and_duplicate_fail_closed(self):
        tmp, folder = self.fixture()
        with tmp:
            p = folder / "SAMPLE_10BPS_EQUITY_30MIN.csv"
            p.write_text(p.read_text().replace("00:05:00Z", "00:06:00Z"))
            with self.assertRaisesRegex(ValueError, "GRID_GAP"):
                dd.compute_equity_dd(p, start="2025-10-01T00:00:00Z",
                                     end="2025-10-01T00:10:00Z")

    def test_invalid_or_nonpositive_equity_fails_closed(self):
        for value in ("nan", "inf", "0", "-1"):
            tmp, folder = self.fixture()
            with tmp:
                p = folder / "SAMPLE_10BPS_EQUITY_30MIN.csv"
                p.write_text(p.read_text().replace("00:05:00Z,120", "00:05:00Z," + value))
                with self.assertRaisesRegex(ValueError, "EQUITY_INVALID"):
                    dd.compute_equity_dd(p, start="2025-10-01T00:00:00Z",
                                         end="2025-10-01T00:10:00Z")

    def test_manifest_mismatch_fails_closed(self):
        tmp, folder = self.fixture()
        with tmp:
            (folder / "RUN_MANIFEST.json").write_text(json.dumps({
                "period": [dd.START, dd.END],
                "results": [{"cost_bps_roundtrip": 10}, {"cost_bps_roundtrip": 30}],
                "status": "CLAIMED_LIVE_PARITY"}))
            with self.assertRaisesRegex(ValueError, "RESEARCH_ONLY"):
                dd.audit_case(folder)

    def test_no_live_authority_even_if_dd_is_under_limit(self):
        tmp, folder = self.fixture((100, 105, 103))
        with tmp:
            r = dd.compute_equity_dd(folder / "SAMPLE_10BPS_EQUITY_30MIN.csv",
                                     start="2025-10-01T00:00:00Z",
                                     end="2025-10-01T00:10:00Z")
            self.assertLess(abs(r["maxDrawdownPct"]), 20)


if __name__ == "__main__":
    unittest.main()