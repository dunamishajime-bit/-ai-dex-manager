#!/usr/bin/env python3
"""Proof that Task9 first-divergence gate refuses incomplete financial claims."""
import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

S = Path(__file__).with_name("verify-task9-first-divergence.py")
spec = importlib.util.spec_from_file_location("task9_first_divergence", S)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class TestFirstDivergence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        d = Path(self.temp.name)
        self.decisions = d / "candidates.jsonl"
        self.trades = d / "trades.jsonl"
        self.new = d / "task9.json"
        self.accepted = {
            "candidate_id": "C001", "decision_ts_ms": 1000,
            "decision": "ACCEPTED_MODELED_ENTRY", "strategy_id": "V12",
            "modeled_entry_quantity": 12,
        }
        self.rejected = {
            "candidate_id": "C002", "decision_ts_ms": 2000,
            "decision": "REJECTED_PORTFOLIO", "strategy_id": "Q102",
        }
        self.save([self.accepted, self.rejected])

    def save(self, decisions):
        self.decisions.write_text(
            "".join(json.dumps(item) + "\n" for item in decisions), "utf-8")
        self.trades.write_text('{"candidate_id":"C001"}\n', "utf-8")
        sha = hashlib.sha256(self.decisions.read_bytes()).hexdigest()
        self.new.write_text(json.dumps({
            "productionChanges": 0, "liveClaim": False,
            "cases": [{"caseName": "BASELINE", "costBps": 10,
                       "sourceCoverage": {
                           "observedRows": len(decisions), "status": "INCOMPLETE",
                           "replayableRows": 0, "sourceHashes": [{"sha256": sha}]
                       }}]
        }), "utf-8")

    def test_first_missing_field_is_exact(self):
        result = mod.verify(self.decisions, self.trades, self.new, 10)
        self.assertEqual(result["status"], "BLOCKED_FIRST_DIVERGENCE")
        self.assertEqual(result["firstDivergence"]["candidateId"], "C001")
        self.assertIn("priority", result["firstDivergence"]["missing"])
        self.assertFalse(result["economicParityProven"])

    def test_rejected_missing_quantity_cannot_be_inferred(self):
        complete = {
            "event_seq": 1, "priority": 1, "entry_valid_until_ms": 3000,
            "worst_case_gross": 0.5, "asset_class": "CRYPTO", "quantity": 12,
        }
        self.save([dict(self.accepted, **complete), self.rejected])
        result = mod.verify(self.decisions, self.trades, self.new, 10)
        self.assertEqual(result["firstDivergence"]["candidateId"], "C002")
        self.assertTrue(result["firstDivergence"]["rejectedOrderSizeMustNotBeInferred"])

    def test_source_hash_mismatch_fails_closed(self):
        data = json.loads(self.new.read_text("utf-8"))
        data["cases"][0]["sourceCoverage"]["sourceHashes"][0]["sha256"] = "f"*64
        self.new.write_text(json.dumps(data), "utf-8")
        with self.assertRaisesRegex(ValueError, "exact original candidate bytes"):
            mod.verify(self.decisions, self.trades, self.new, 10)

    def test_no_economic_claim_without_independent_mark_traces(self):
        common = {
            "event_seq": 1, "priority": 1, "entry_valid_until_ms": 3000,
            "worst_case_gross": 0.5, "asset_class": "CRYPTO", "quantity": 12,
        }
        self.save([dict(self.accepted, **common), dict(self.rejected, **common)])
        data = json.loads(self.new.read_text("utf-8"))
        data["cases"][0]["sourceCoverage"]["status"] = "COMPLETE"
        self.new.write_text(json.dumps(data), "utf-8")
        result = mod.verify(self.decisions, self.trades, self.new, 10)
        self.assertEqual(result["firstDivergence"]["stage"], "INDEPENDENT_TRACES_MISSING")
        self.assertFalse(result["economicParityProven"])

    def test_fake_matching_excerpt_cannot_certify_one_year(self):
        common = {
            "event_seq": 1, "priority": 1, "entry_valid_until_ms": 3000,
            "worst_case_gross": 0.5, "asset_class": "CRYPTO", "quantity": 12,
        }
        self.save([dict(self.accepted, **common), dict(self.rejected, **common)])
        report = json.loads(self.new.read_text("utf-8"))
        report["cases"][0]["sourceCoverage"]["status"] = "COMPLETE"
        self.new.write_text(json.dumps(report), "utf-8")
        root = Path(self.temp.name)
        old, new = root / "old-ledgers", root / "new-ledgers"
        old.mkdir(); new.mkdir()
        for name in mod.SEGMENTS:
            for target in (old, new):
                (target/f"{name}.jsonl").write_text('{"ts_ms":123,"price":4.2}\n', "utf-8")
        # A 1-row matching excerpt must never replace 3,185 candidates and
        # 8,760 hourly MTM marks as a verified annual integrated portfolio.
        item = mod.verify(self.decisions, self.trades, self.new, 10, old, new)
        self.assertEqual(item["firstDivergence"]["stage"], "INCOMPLETE_CANONICAL_TRACE_COVERAGE")
        self.assertFalse(item["economicParityProven"])

    def test_trade_ledger_duplicate_fails_closed(self):
        self.trades.write_text('{"candidate_id":"C001"}\n{"candidate_id":"C001"}\n', "utf-8")
        with self.assertRaisesRegex(ValueError, "candidate/fill/trade IDs"):
            mod.verify(self.decisions, self.trades, self.new, 10)

    def test_canonical_price_drift_reports_first_row(self):
        with tempfile.TemporaryDirectory() as folder:
            d = Path(folder)
            old, new = d/"old", d/"new"
            old.mkdir(); new.mkdir()
            for name in mod.SEGMENTS:
                (old/f"{name}.jsonl").write_text('{"ts_ms":123,"price":4.2}\n', "utf-8")
                (new/f"{name}.jsonl").write_text('{"ts_ms":123,"price":4.2}\n', "utf-8")
            (new/"execution_ledger.jsonl").write_text('{"ts_ms":123,"price":4.4}\n', "utf-8")
            issue = mod.canonical_compare(old, new)
            self.assertEqual(issue["stage"], "FIRST_TRANSACTION_DIVERGENCE")
            self.assertEqual(issue["segment"], "execution_ledger")
            self.assertEqual(issue["field"], "$.price")

    def test_identical_seven_canonical_ledgers_compare_equal(self):
        with tempfile.TemporaryDirectory() as folder:
            d = Path(folder); old, new = d/"old", d/"new"
            old.mkdir(); new.mkdir()
            for name in mod.SEGMENTS:
                for target in (old, new):
                    (target/f"{name}.jsonl").write_text('{"ts_ms":123,"price":4.2}\n', "utf-8")
            self.assertIsNone(mod.canonical_compare(old, new))


if __name__ == "__main__":
    unittest.main()
