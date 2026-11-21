"""Isolated H48 holding-cap scenarios; no GitHub/VPS access or trading."""
import csv
import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

FILE = Path(__file__).parents[1] / "scripts" / "research" / "audit_bt_nonhype_h48_cap48.py"
spec = importlib.util.spec_from_file_location("h48_cap", FILE)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class H48Cap48Test(unittest.TestCase):
    def test_earlier_stops_preserved_only_later_exits_shortened_hype_excluded(self):
        with tempfile.TemporaryDirectory() as dirname:
            d = Path(dirname)
            quotes = d / "quotes"
            quotes.mkdir()
            target = mod.milliseconds("2025-10-03T00:00:00Z")
            with gzip.open(quotes / "BTCUSDT-1h-sample.jsonl.gz", "wt") as f:
                f.write(json.dumps([target, "90", "95", "80", "91"]) + "\n")
            fills = d / "sample_10BPS_FILLS.csv"
            fields = ["strategy", "symbol", "side", "entry_utc", "exit_utc",
                      "model_entry_price", "model_exit_price", "notional_jpy",
                      "pnl_before_cost_jpy", "source_runtime_sha"]
            base = "2025-10-01T00:00:00Z"
            rows = [
                # FET STOP must not be deferred to 48h
                ["FET", "BTCUSDT", "LONG", base, "2025-10-01T05:00:00Z",
                 "100", "95", "1000", "-50", "f" * 40],
                # A genuine 72h V4 exit is shortened to 48h; gross PnL goes from +100 to -100
                ["V4", "BTCUSDT", "LONG", base, "2025-10-04T00:00:00Z",
                 "100", "110", "1000", "100", "a" * 40],
                # Exact 48h is unchanged
                ["PENGU", "BTCUSDT", "SHORT", base, "2025-10-03T00:00:00Z",
                 "100", "90", "1000", "100", "b" * 40],
                # This item must not influence any calculation
                ["HYPE", "BTCUSDT", "LONG", base, "2025-10-04T00:00:00Z",
                 "100", "120", "1000", "200", "h" * 40],
                # No H1 quote for an affected missing symbol -> fail closed, not omit silently
                ["Q102", "MISSINGUSDT", "LONG", base, "2025-10-04T00:00:00Z",
                 "100", "80", "1000", "-200", "c" * 40],
            ]
            with fills.open("w", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(fields)
                writer.writerows(rows)
            result = mod.audit(fills, quotes)["runners"]
            self.assertEqual(result["FET"]["original_within_48h"], 1)
            self.assertEqual(result["FET"]["shortened_at_48h"], 0)
            self.assertEqual(result["FET"]["sum_fixed_notional_gross_delta_jpy"], 0)
            self.assertEqual(result["V4"]["shortened_at_48h"], 1)
            self.assertEqual(result["V4"]["sum_fixed_notional_gross_delta_jpy"], -200)
            self.assertEqual(result["V4"]["cap48_gross_win_pct"], 0)
            self.assertEqual(result["PENGU"]["original_within_48h"], 1)
            self.assertEqual(result["Q102"]["missing_price"], 1)
            self.assertEqual(result["Q102"]["priced"], 0)
            self.assertNotIn("HYPE", result)

    def test_missing_timezone_and_unexpected_runner_fail(self):
        with tempfile.TemporaryDirectory() as dirname:
            d = Path(dirname)
            quotes = d / "quotes"
            quotes.mkdir()
            fills = d / "empty.csv"
            fills.write_text(
                "strategy,symbol,side,entry_utc,exit_utc,model_entry_price,model_exit_price,notional_jpy,pnl_before_cost_jpy,source_runtime_sha\n"
                "OTHER,BTCUSDT,LONG,2025-10-01T00:00:00Z,2025-10-04T00:00:00Z,100,110,1000,100,a\n",
                encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "UNEXPECTED_STRATEGY"):
                mod.audit(fills, quotes)
            with self.assertRaisesRegex(ValueError, "TIMEZONE_REQUIRED"):
                mod.milliseconds("2025-10-01T00:00:00")

    def test_report_guards_no_hype_production_or_dd_claims(self):
        source = FILE.read_text("utf-8")
        self.assertIn('"hype_modified": False', source)
        self.assertIn('"production_changes": False', source)
        self.assertIn('"orders_sent": 0', source)
        self.assertIn('"portfolio_dd_recomputed": False', source)
        self.assertIn('"final_compounded_equity_recomputed": False', source)


if __name__ == "__main__":
    unittest.main()
