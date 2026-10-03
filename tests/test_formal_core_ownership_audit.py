"""Certification must not hide simultaneous ownership behind anchor parity."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import zipfile
import json
import shutil
import sys
from unittest.mock import patch


MODULE = Path(__file__).resolve().parents[1] / "scripts/research/formal_core_ownership_audit.py"


def trade(cid, strategy, symbol, start, end, side="LONG"):
    return dict(candidate_id=cid, strategy_id=strategy, symbol=symbol,
                entry_ts_ms=start, exit_ts_ms=end, side=side)


class OwnershipAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit = None
        if MODULE.is_file():
            spec = importlib.util.spec_from_file_location("formal_core_audit", MODULE)
            cls.audit = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.audit)

    def test_certification_audit_exists(self):
        self.assertIsNotNone(self.audit, "missing fail-closed ownership certification audit")

    def module(self):
        self.assertIsNotNone(self.audit, "missing fail-closed ownership certification audit")
        return self.audit

    def test_opposite_side_does_not_net_away_ownership_conflict(self):
        rows = [trade("a", "Q102", "DOGEUSDT", 10, 40, "SHORT"),
                trade("b", "V12", "DOGEUSDT", 20, 30)]
        pairs = self.module().find_ownership_conflicts(rows)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["overlap_start_ts_ms"], 20)
        self.assertTrue(pairs[0]["opposite_sides"])

    def test_same_side_still_has_two_strategy_owners(self):
        pairs = self.module().find_ownership_conflicts([
            trade("a", "Q102", "FETUSDT", 10, 40),
            trade("b", "FET", "FETUSDT", 10, 20)])
        self.assertEqual(len(pairs), 1)
        self.assertFalse(pairs[0]["opposite_sides"])

    def test_exit_then_entry_at_same_timestamp_is_not_overlap(self):
        self.assertEqual(self.module().find_ownership_conflicts([
            trade("a", "V12", "DOGEUSDT", 10, 20),
            trade("b", "Q102", "DOGEUSDT", 20, 40)]), [])

    def test_different_symbols_do_not_conflict(self):
        self.assertEqual(self.module().find_ownership_conflicts([
            trade("a", "V12", "DOGEUSDT", 10, 40),
            trade("b", "Q102", "LINKUSDT", 20, 30)]), [])

    def test_duplicate_intent_is_not_silently_deduplicated(self):
        a = trade("a", "V12", "DOGEUSDT", 10, 20)
        with self.assertRaises(ValueError):
            self.module().find_ownership_conflicts([a, a.copy()])

    def test_invalid_lifecycle_is_fail_closed(self):
        with self.assertRaises(ValueError):
            self.module().find_ownership_conflicts([trade("a", "V12", "DOGEUSDT", 20, 10)])

    def test_same_timestamp_preemption_has_no_positive_occupancy(self):
        self.assertEqual(self.module().find_ownership_conflicts([
            trade("a", "FET", "FETUSDT", 20, 20),
            trade("b", "Q102", "FETUSDT", 10, 30)]), [])

    def test_json_format_difference_is_not_financial_divergence(self):
        self.assertTrue(self.module().semantic_parity([{"a": 1, "b": 2}], [{"b": 2, "a": 1}])["pass"])

    def test_changed_reject_reason_fails_exact_semantic_parity(self):
        result = self.module().semantic_parity([{"reason": "COOLDOWN"}], [{"reason": "CAP"}])
        self.assertFalse(result["pass"])
        self.assertEqual(result["first_divergence_index"], 0)

    def test_boolean_number_type_change_is_not_exact_parity(self):
        self.assertFalse(self.module().semantic_parity([{"enabled": False}], [{"enabled": 0}])["pass"])

    def test_numerical_anchor_pass_cannot_certify_conflicting_owners(self):
        self.assertEqual(self.module().certification_status(True, True, 1),
                         "BLOCKED_FORMAL_CORE_SYMBOL_OWNERSHIP_PARITY_CONFLICT")

    def test_missing_parity_blocks_even_if_flat(self):
        self.assertEqual(self.module().certification_status(False, True, 0), "BLOCKED_CORE_EXACT_PARITY")

    def test_invalid_source_blocks_even_with_parity(self):
        self.assertEqual(self.module().certification_status(True, False, 0), "BLOCKED_CANONICAL_SOURCE_IDENTITY")

    def test_no_claim_of_live_verification_from_offline_checks(self):
        self.assertEqual(self.module().certification_status(True, True, 0), "CORE_OFFLINE_AUDIT_PASS_NOT_LIVE_CERTIFIED")

    def test_untrusted_archive_path_cannot_escape_output(self):
        with tempfile.TemporaryDirectory(dir=MODULE.parent) as directory:
            root = Path(directory)
            with zipfile.ZipFile(root / "input.zip", "w") as archive:
                archive.writestr("../escape.py", "raise Exception('must never execute')")
            with self.assertRaises(ValueError):
                self.module().extract_verified_zip(root / "input.zip", root / "output", None)
            self.assertFalse((root / "escape.py").exists())

    def test_source_archive_hash_mismatch_blocks_extraction(self):
        with tempfile.TemporaryDirectory(dir=MODULE.parent) as directory:
            root = Path(directory)
            with zipfile.ZipFile(root / "input.zip", "w") as archive:
                archive.writestr("safe.txt", "content")
            with self.assertRaises(ValueError):
                self.module().extract_verified_zip(root / "input.zip", root / "output", "0" * 64)
            self.assertFalse((root / "output/safe.txt").exists())

    def test_valid_archive_extracts_original_bytes(self):
        with tempfile.TemporaryDirectory(dir=MODULE.parent) as directory:
            root = Path(directory)
            with zipfile.ZipFile(root / "input.zip", "w") as archive:
                archive.writestr("safe.txt", b"original\r\nbytes\r\n")
            self.module().extract_verified_zip(root / "input.zip", root / "output", None)
            self.assertEqual((root / "output/safe.txt").read_bytes(), b"original\r\nbytes\r\n")

    def test_cli_rejects_wrong_engine_even_when_every_ledger_matches(self):
        repo = MODULE.parents[2]
        frozen = repo / "docs/research/results/formal-core-ownership-audit-20261003"
        canonical = repo / "docs/research/results/formal-priority-cooldown-20261003/PRICE_MODEL_10BPS"
        with tempfile.TemporaryDirectory(dir=MODULE.parent) as directory:
            root = Path(directory)
            self.module().extract_verified_zip(frozen / "candidate-inputs.zip", root / "input", None)
            fresh = root / "fresh"
            fresh.mkdir()
            for name in ("portfolio-trades.jsonl", "candidate-decisions.jsonl"):
                shutil.copyfile(canonical / name, fresh / name)
            (fresh / "metrics.json").write_text(json.dumps({
                "final_equity_jpy": 1229065462.0472791,
                "profit_factor": 2.4887028036012624,
                "maximum_mtm_drawdown": -0.21296368751349548,
                "closed_trades": 1275}))
            engine = root / "wrong-engine.py"
            engine.write_text("# Different engine is not the pinned source\n")
            output = root / "report.json"
            argv = ["audit", "--canonical", str(canonical), "--fresh", str(fresh),
                    "--raw-candidates", str(root / "input/v12_trail02_candidates/crypto-price-model-candidates.jsonl"),
                    "--gated-candidates", str(root / "input/gated-candidates/crypto-price-model-candidates.jsonl"),
                    "--engine-source", str(engine), "--output", str(output)]
            with patch.object(sys, "argv", argv):
                self.assertEqual(self.module().main(), 2)
            result = json.loads(output.read_text())
            self.assertFalse(result["source_identity_pass"])
            self.assertEqual(result["status"], "BLOCKED_CANONICAL_SOURCE_IDENTITY")

    def test_git_lf_blob_is_verified_without_weakening_original_crlf_identity(self):
        repo = MODULE.parents[2]
        frozen = repo / "docs/research/results/formal-core-ownership-audit-20261003"
        original = repo / "docs/research/results/formal-priority-cooldown-20261003/PRICE_MODEL_10BPS"
        with tempfile.TemporaryDirectory(dir=MODULE.parent) as directory:
            root = Path(directory)
            self.module().extract_verified_zip(frozen / "candidate-inputs.zip", root / "input", None)
            self.module().extract_verified_zip(frozen / "engine-source.zip", root / "engine", None)
            canonical, fresh = root / "canonical", root / "fresh"
            canonical.mkdir()
            fresh.mkdir()
            for name in ("portfolio-trades.jsonl", "candidate-decisions.jsonl"):
                payload = (original / name).read_bytes().replace(b"\r\n", b"\n")
                (canonical / name).write_bytes(payload)
                (fresh / name).write_bytes(payload)
            (fresh / "metrics.json").write_text(json.dumps({
                "final_equity_jpy": 1229065462.0472791, "profit_factor": 2.4887028036012624,
                "maximum_mtm_drawdown": -0.21296368751349548, "closed_trades": 1275}))
            output = root / "report.json"
            argv = ["audit", "--canonical", str(canonical), "--fresh", str(fresh),
                    "--raw-candidates", str(root / "input/v12_trail02_candidates/crypto-price-model-candidates.jsonl"),
                    "--gated-candidates", str(root / "input/gated-candidates/crypto-price-model-candidates.jsonl"),
                    "--engine-source", str(root / "engine/portfolio_price_model.py"), "--output", str(output)]
            with patch.object(sys, "argv", argv):
                self.assertEqual(self.module().main(), 2)
            result = json.loads(output.read_text())
            self.assertTrue(result["source_identity_pass"])
            self.assertEqual(result["status"], "BLOCKED_FORMAL_CORE_SYMBOL_OWNERSHIP_PARITY_CONFLICT")


if __name__ == "__main__":
    unittest.main()
