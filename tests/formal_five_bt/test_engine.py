from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
import hashlib
import json

from research.formal_five_bt.engine import (
    PERIOD_START,
    SCENARIOS,
    _scenario_candidate,
    _inventory_l2,
    _load_signal_scan_manifests,
    _v52_decisions,
    _write_jsonl_gz,
    render_report,
)


class IntegratedEngineTests(unittest.TestCase):
    def test_no_l2_turns_a_signal_into_skipped_or_not_verifiable_never_a_fill(self):
        row = {"status": "SIGNAL", "symbol": "ADAUSDT", "decision_ts_ms": 1_754_798_400_000,
               "signal": {"entryTs": 1_754_798_400_000, "side": 1}}
        proxy = _scenario_candidate("V12", row, scenario="NORMAL", coverage_path="PROXY_APPLIED", archive_lookup={})
        aster = _scenario_candidate("V12", row, scenario="SEVERE", coverage_path="ASTER_DATA_ONLY", archive_lookup={})
        self.assertEqual(proxy["scenario_execution_status"], "NOT_VERIFIABLE")
        self.assertEqual(aster["scenario_execution_status"], "SKIPPED")
        self.assertIsNone(proxy["realized_pnl_usdt"])
        self.assertEqual(proxy["fill_status"], "NOT_FILLED_OR_SKIPPED")

    def test_v52_entries_follow_nyse_early_close(self):
        start = datetime(2025, 11, 28, tzinfo=timezone.utc)
        end = datetime(2025, 11, 29, tzinfo=timezone.utc)
        rows = [row for row in _v52_decisions(start, end, scenario="NORMAL", coverage_path="ASTER_DATA_ONLY")
                if row["phase"] == "ENTRY_GATE" and row["route"] == "V50_POST_OPEN_BASIS" and row["decision_ts_ms"]]
        early = [row for row in rows if row["symbol"] == "AMZNUSDT" and row["gates"]["NYSE_SESSION"] == "FAIL"]
        self.assertEqual(len(early), 1)
        self.assertEqual(early[0]["reason"], "NYSE_OFFICIAL_SESSION_OR_EARLY_CLOSE_BLOCK")
        self.assertTrue(early[0]["early_close_block"])
        self.assertIsNone(early[0]["realized_pnl_usdt"])

    def test_scenario_report_keeps_unverified_metrics_null(self):
        scenarios = [{
            "scenario_id": f"{scenario}_{coverage_path}", "scenario": scenario,
            "coverage_path": coverage_path, "status": "NOT_VERIFIABLE",
            "candidate_signals": {"V12": 2, "PENGU": 1, "Q102": 0, "FET": 0},
            "verified_fills": 0, "initial_gap_candidate_signals": {"V12": 1},
        } for scenario, coverage_path in SCENARIOS]
        manifest = {"run_id": "test", "status": "NOT_VERIFIABLE", "runtime_sha": "a" * 40,
                    "audited_release_id": "b" * 40, "period_start_utc": PERIOD_START.isoformat(),
                    "starting_capital_jpy": 10_000, "monthly_contribution_jpy": 10_000,
                    "monthly_contribution_count": 12, "total_contributions_jpy": 130_000,
                    "scenarios": scenarios, "limitations": ["NO_VERIFIED_FILLS"]}
        report = render_report(manifest, {"symbols": [], "fx": {"observations": 0, "status": "NOT_VERIFIABLE"}, "l2_archives": []})
        self.assertTrue(all(row["scenario_id"] in report for row in scenarios))
        self.assertIn("**null / NOT_VERIFIABLE**", report)
        self.assertIn("—", report)

    def test_jsonl_gzip_output_is_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = _write_jsonl_gz(root / "one" / "rows.jsonl.gz", [{"a": 1}, {"b": "日本語"}])
            second = _write_jsonl_gz(root / "two" / "rows.jsonl.gz", [{"a": 1}, {"b": "日本語"}])
            self.assertEqual(first["sha256"], second["sha256"])
            self.assertEqual(first["rows"], 2)

    def test_signal_scan_manifest_hash_uses_exact_saved_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "baseline-signal-scan" / "signal-scan-manifest.json"
            path.parent.mkdir(parents=True)
            raw = b'{"runtime_sha":"audited"}\n'
            path.write_bytes(raw)
            manifests, hashes = _load_signal_scan_manifests(root)
            self.assertEqual(manifests["baseline-signal-scan"]["runtime_sha"], "audited")
            self.assertEqual(hashes["baseline-signal-scan"], hashlib.sha256(raw).hexdigest())

    def test_l2_inventory_uses_portable_relative_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "l2"
            archive = root / "bybit" / "2025-08-10" / "03" / "ADAUSDT_orderbook.parquet.zst"
            archive.parent.mkdir(parents=True)
            archive.write_bytes(b"not a parquet archive")
            inventory, _ = _inventory_l2(root)
            self.assertEqual(len(inventory), 1)
            self.assertEqual(inventory[0]["path"], "bybit/2025-08-10/03/ADAUSDT_orderbook.parquet.zst")
            self.assertEqual(inventory[0]["status"], "NOT_VERIFIABLE")


if __name__ == "__main__":
    unittest.main()
