"""Check that price-only V52 research enters four traces, not the audited ledger."""
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import unittest

from research.formal_five_bt import engine
from research.formal_five_bt.v52_price_only_scan import MODEL_ID


class V52ResearchEngineIntegration(unittest.TestCase):
    def test_research_feed_in_all_four_traces_without_fabricating_fills(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data, scans, research, output = (
                root / "data", root / "scans", root / "research", root / "output")
            data.mkdir()
            runtime = engine.load_manifest(
                Path(engine.__file__).with_name("runtime_source_manifest.json"))
            (data / "acquisition-manifest.json").write_text(
                json.dumps({"runtime_sha": runtime["runtime_sha"]}))
            decisions = research / "decisions"
            decisions.mkdir(parents=True)
            when = int(datetime(2026, 6, 15, 15, 30, tzinfo=timezone.utc).timestamp() * 1000)
            row = {
                "strategy_id": "V52", "decision_model": MODEL_ID,
                "source_runtime_sha": runtime["runtime_sha"],
                "route": "V50_POST_OPEN_BASIS",
                "decision_ts_ms": when, "equity_reference_symbol": "NVDA",
                "symbol": "NVDAUSDT", "side": "SHORT", "window_ny": "11:30",
                "entry_basis_bps": 80, "aster_entry_reference_price_usd": 100.8,
                "yahoo_entry_reference_price_usd": 100,
                "assumed_round_trip_cost_bps": 11,
                "shared_allocation_status": "NOT_EVALUATED",
                "historical_aster_fill_verified": False,
                "realized_pnl_usdt": None,
                "status": "PRICE_ONLY_MODEL_SELECTED_UNALLOCATED",
            }
            raw = (json.dumps(row) + "\n").encode()
            (decisions / "V52-hourly-price-model.jsonl").write_bytes(raw)
            (research / "price-only-scan-manifest.json").write_text(json.dumps({
                "model": MODEL_ID, "status": "RESEARCH_PRICE_ONLY_NOT_LIVE_PARITY",
                "runtime_sha": runtime["runtime_sha"],
                "counts": {"PRICE_ONLY_MODEL_SELECTED_UNALLOCATED": 1},
                "decision_output": {
                    "relative_path": "decisions/V52-hourly-price-model.jsonl",
                    "rows": 1, "sha256": hashlib.sha256(raw).hexdigest(),
                },
            }))
            with (patch.object(engine, "_load_signal_rows",
                               return_value=({strategy: [] for strategy in
                                              ("V12", "PENGU", "Q102", "FET")}, {})),
                  patch.object(engine, "_dataset_coverage", return_value=([], {})),
                  patch.object(engine, "load_fred_fx",
                               return_value=([], [SimpleNamespace(code="NO_FX")]))):
                run = engine.run_integrated_bt(
                    data, scans, root / "no-l2", output,
                    v52_research_scan_root=research)
            self.assertEqual(run["status"], "NOT_VERIFIABLE")
            self.assertEqual(len(run["scenarios"]), 4)
            for scenario in run["scenarios"]:
                self.assertEqual(scenario["v52_hourly_price_research"]["selection_count"], 1)
                self.assertEqual(scenario["v52_hourly_price_research"]["status"],
                                 "VERIFIED_RESEARCH_INPUT_NOT_LIVE_SIGNAL")
                self.assertIsNone(scenario["candidate_signals"]["V52"])
                self.assertEqual(scenario["verified_fills"], 0)
                self.assertIsNone(scenario["final_equity_usdt"])
                with gzip.open(output / scenario["scenario_id"] /
                               "decision-gates.jsonl.gz", "rt") as file:
                    research_rows = [json.loads(line) for line in file
                                     if '"RESEARCH_CANDIDATE_UNALLOCATED"' in line]
                self.assertEqual(len(research_rows), 1)
                self.assertFalse(research_rows[0]["candidate_signal"])
                self.assertTrue(research_rows[0]["research_candidate"])
                with gzip.open(output / scenario["scenario_id"] /
                               "order-ledger.jsonl.gz", "rt") as file:
                    self.assertEqual(list(file), [])


if __name__ == "__main__":
    unittest.main()
