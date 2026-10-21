#!/usr/bin/env python3
"""Unit tests for source-backed Task 9 historical model evidence inventory."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("audit-task9-existing-evidence.py")
spec = importlib.util.spec_from_file_location("task9_source_audit", MODULE_PATH)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExistingModelEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.case = self.base / "baseline" / "10bps" / "cases" / "V2_M150_D05_CORE_NATIVE" / "runs" / "PRICE_MODEL_10BPS"
        self.case.mkdir(parents=True)
        self.h1 = self.base / "h1"
        self.h1.mkdir()
        self.candidates = []
        self.entries = []
        self.trades = []
        for index, strategy in enumerate(module.STRATEGIES):
            cid = f"C{index:04d}"
            sym = f"ASSET{index}USDT"
            self.candidates.append({
                "candidate_id": cid, "decision": "ACCEPTED_MODELED_ENTRY",
                "strategy_id": strategy, "symbol": sym, "decision_ts_ms": 1000,
            })
            self.entries.append({"candidate_id": cid, "event_type": "MODELED_ENTRY", "historical_fill_verified": False})
            self.trades.append({"candidate_id": cid, "historical_fill_verified": False})
            (self.h1 / f"{sym}-1h.json").write_text(json.dumps([
                {"ts": 1000, "close": 100}, {"ts": 3601000, "close": 101},
            ]), encoding="utf8")
        self.write_fixture()

    def write_fixture(self):
        for name, values in (
            ("candidate-decisions.jsonl", self.candidates),
            ("portfolio-events.jsonl", self.entries),
            ("portfolio-trades.jsonl", self.trades),
        ):
            (self.case / name).write_text(
                "".join(json.dumps(x, sort_keys=True) + "\n" for x in values), encoding="utf8"
            )

    def test_join_coverage_and_modeled_fill_evidence_are_explicit(self):
        report = module.audit(self.base / "baseline", self.h1, 10)
        self.assertEqual(report["observedCandidates"], 8)
        self.assertEqual(report["acceptedCandidates"], 8)
        self.assertEqual(report["savedH1Symbols"], 8)
        self.assertTrue(report["checks"]["acceptedToModeledEntryIdsExact"])
        self.assertTrue(report["checks"]["acceptedToTradeIdsExact"])
        self.assertFalse(report["checks"]["allModeledEntriesHistoricalFillVerified"])
        self.assertEqual(report["classification"], "BLOCKED_INCOMPLETE_SOURCE_COVERAGE")
        self.assertEqual(report["productionChanges"], 0)

    def test_preallocation_exclusion_does_not_require_synthetic_order(self):
        self.candidates.append({
            "candidate_id": "EXCLUDE1", "decision": "EXCLUDED_PREALLOCATION",
            "strategy_id": "V52", "symbol": "ASSET7USDT",
            "decision_ts_ms": 3601000, "reason": "SINGLE_V50_SLOT_ALREADY_OPEN",
            "side": None, "candidate_entry_price_usd": None,
        })
        self.write_fixture()
        report = module.audit(self.base / "baseline", self.h1, 10)
        self.assertEqual(report["preallocationExclusions"], 1)
        self.assertEqual(report["verifiedPreallocationExclusionRows"], 1)
        self.assertTrue(report["checks"]["acceptedToModeledEntryIdsExact"])

    def test_mismatched_model_entry_is_source_integrity_blocker(self):
        self.entries.pop()
        self.write_fixture()
        report = module.audit(self.base / "baseline", self.h1, 10)
        self.assertEqual(report["classification"], "BLOCKED_SOURCE_INTEGRITY")
        self.assertFalse(report["checks"]["acceptedToModeledEntryIdsExact"])

    def test_duplicate_ids_are_rejected(self):
        self.candidates.append(dict(self.candidates[0]))
        self.write_fixture()
        with self.assertRaisesRegex(module.EvidenceAuditError, "duplicate candidate_id"):
            module.audit(self.base / "baseline", self.h1, 10)

    def test_broken_market_timestamps_do_not_get_continuity_pass(self):
        p = self.h1 / "ASSET1USDT-1h.json"
        p.write_text(json.dumps([{"ts": 1000}, {"ts": 5000000}]), encoding="utf8")
        report = module.audit(self.base / "baseline", self.h1, 10)
        self.assertFalse(report["checks"]["savedH1Continuity"])


if __name__ == "__main__":
    unittest.main()
