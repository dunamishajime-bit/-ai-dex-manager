"""Source-safe V52 Yahoo modeled-fill integration test.

Only fixtures are generated: this test never contacts exchanges or VPS, and
never claims modeled Yahoo prices are verified Aster fills.
"""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import unittest

from research.formal_five_bt import engine


class YahooEngineIntegrationTests(unittest.TestCase):
    def test_audited_signal_produces_modeled_yahoo_order_without_fabricated_pnl(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data_root = root / "data"
            scan_root = root / "scans"
            output_root = root / "outputs"
            (data_root / "normalized" / "yahoo" / "60m").mkdir(parents=True)
            scan_file = scan_root / "baseline-signal-scan-v52" / "decisions" / "V52.jsonl"
            scan_file.parent.mkdir(parents=True)
            runtime = engine.load_manifest(Path(engine.__file__).with_name("runtime_source_manifest.json"))
            (data_root / "acquisition-manifest.json").write_text(
                json.dumps({"runtime_sha": runtime["runtime_sha"]}) + "\n", encoding="utf-8")
            (scan_file.parent.parent / "signal-scan-manifest.json").write_text(
                json.dumps({"runtime_sha": runtime["runtime_sha"]}) + "\n", encoding="utf-8")
            trigger = int(datetime(2026, 6, 15, 14, 30, tzinfo=timezone.utc).timestamp() * 1000)
            scan_file.write_text(json.dumps({
                "strategy_id": "V52", "route": "V11_EQ", "symbol": "NVDAUSDT",
                "decision_ts_ms": trigger, "status": "SIGNAL", "gates": {"LIVE_DECISION": "PASS"}
            }) + "\n", encoding="utf-8")
            (data_root / "normalized" / "yahoo" / "60m" / "NVDA.jsonl").write_text(
                json.dumps({
                    "source": "YAHOO_FINANCE", "symbol": "NVDA", "interval": "60m",
                    "event_time_ms": trigger - 3600000, "bar_end_time_ms": trigger,
                    "open": 100, "high": 103, "low": 99, "close": 102, "volume": 2000,
                    "source_sha256": "b" * 64
                }) + "\n", encoding="utf-8")
            empty_scans = ({key: [] for key in ("V12", "PENGU", "Q102", "FET")}, {})
            with (patch.object(engine, "_load_signal_rows", return_value=empty_scans),
                  patch.object(engine, "_dataset_coverage", return_value=([], {})),
                  patch.object(engine, "load_fred_fx", return_value=([], [SimpleNamespace(code="TEST_NO_FX")]))):
                manifest = engine.run_integrated_bt(
                    data_root, scan_root, root / "no-l2", output_root)
            self.assertEqual(manifest["status"], "NOT_VERIFIABLE")
            self.assertEqual(manifest["scenarios"][0]["v52_yahoo_price_model"]["audited_signal_candidates"], 1)
            self.assertEqual(manifest["scenarios"][0]["v52_yahoo_price_model"]["modeled_entries"], 1)
            self.assertEqual(manifest["scenarios"][0]["verified_fills"], 0)
            self.assertIsNone(manifest["scenarios"][0]["final_equity_usdt"])
            order_path = output_root / "NORMAL_PROXY_APPLIED" / "order-ledger.jsonl.gz"
            with gzip.open(order_path, "rt", encoding="utf-8") as reader:
                rows = [json.loads(line) for line in reader]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["fill_status"], "MODELED_PRICE_FILL")
            self.assertEqual(rows[0]["modeled_price_usd"], 102)
            self.assertIsNone(rows[0]["realized_pnl_usdt"])

if __name__ == "__main__":
    unittest.main()
