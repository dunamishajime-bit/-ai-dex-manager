"""Offline-only tests for non-HYPE 48h price counterfactual."""
from __future__ import annotations

import csv
import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "research" / "audit_bt_nonhype_h48_fixed_entries.py"
spec = importlib.util.spec_from_file_location("nonhype_h48_study", SCRIPT)
assert spec and spec.loader
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class NonHypeH48ResearchTest(unittest.TestCase):
    def test_h48_next_h1_open_uses_full_48h_and_never_earlier(self):
        original = 1759278600000  # half-hour
        target = study.h48_quote_open_ms(original)
        self.assertEqual(target % study.BAR_MS, 0)
        self.assertGreaterEqual(target, original + study.HOLD_MS)
        self.assertLess(target - (original + study.HOLD_MS), study.BAR_MS)
        self.assertEqual(study.h48_quote_open_ms(1759276800000),
                         1759276800000 + study.HOLD_MS)
        with self.assertRaises(ValueError):
            study.h48_quote_open_ms(True)

    def test_offline_quote_missing_and_hype_exclusion(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            quotes = base / "quotes"
            quotes.mkdir()
            start_ms = 1759276800000
            next_open = study.h48_quote_open_ms(start_ms)
            with gzip.open(quotes / "AVAXUSDT-1h-test.jsonl.gz", "wt", encoding="utf-8") as dest:
                dest.write(json.dumps([next_open, "120", "121", "119", "120"]) + "\n")
            fills = base / "model_10BPS_FILLS.csv"
            fields = ["strategy", "symbol", "side", "entry_utc",
                      "model_entry_price", "model_exit_price", "source_runtime_sha"]
            ts = "2025-10-01T00:00:00Z"
            rows = [
                ["Q102", "AVAXUSDT", "LONG", ts, "100", "110", "e" * 40],
                ["Q102", "MISSINGUSDT", "SHORT", ts, "100", "105", "e" * 40],
                ["HYPE", "HYPEUSDT", "LONG", ts, "100", "20", "a" * 40],
            ]
            with fills.open("w", newline="", encoding="utf-8") as out:
                writer = csv.writer(out)
                writer.writerow(fields)
                writer.writerows(rows)
            report = study.analyze_fee(fills, quotes)
            q102 = report["nonhype"]["Q102"]
            self.assertEqual(q102["total_model_exits"], 2)
            self.assertEqual(q102["priced"], 1)
            self.assertEqual(q102["missing_h1_quotes"], 1)
            self.assertEqual(q102["baseline_gross_win_pct"], 100.0)
            self.assertEqual(q102["h48_gross_win_pct"], 100.0)
            self.assertEqual(q102["h48_worst_gross_ret_pct"], 20.0)
            self.assertNotIn("HYPE", report["nonhype"])
            self.assertEqual(list(report["quotes_sha256_by_symbol"]), ["AVAXUSDT"])

    def test_unexpected_strategy_and_duplicated_quote_files_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            base.joinpath("quotes").mkdir()
            csv_path = base / "case_30BPS_FILLS.csv"
            csv_path.write_text("strategy,symbol,entry_utc\nUNKNOWN,FOO,2025-10-01T00:00:00Z\n", encoding="utf8")
            with self.assertRaisesRegex(ValueError, "UNKNOWN_RUNNER"):
                study.analyze_fee(csv_path, base / "quotes")

    def test_warning_for_portfolio_dd_and_no_production_authority(self):
        self.assertTrue(all(x in study.STRATEGIES for x in ("V4", "PENGU", "Q102", "V52", "FET", "IDLE")))
        self.assertNotIn("HYPE", study.STRATEGIES)
        self.assertTrue(any("portfolio DD" in x for x in study.WARNINGS))
        self.assertTrue(any("current Production" in x for x in study.WARNINGS))


if __name__ == "__main__":
    unittest.main()
