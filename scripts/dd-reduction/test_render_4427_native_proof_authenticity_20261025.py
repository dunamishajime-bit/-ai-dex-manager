#!/usr/bin/env python3
"""Research-only synthetic trust boundary tests. No live credentials or orders."""
import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("render4427_auth_test", HERE / "render_4427_native_proof_authenticity_20261025.py")
auth = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = auth
spec.loader.exec_module(auth)
contract = auth.contract


def encoded(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def fixture():
    candidate = contract.example_candidate(1782176400000)
    artifacts = {}
    records = {}
    for gate in contract.REQUIRED_PROOFS:
        body = dict(gate=gate, candidate_key=candidate.key(), passed=True,
                    asof_ts_ms=candidate.entry_ts_ms - 300000, source="SYNTHETIC_TEST_ONLY",
                    requested_gross=candidate.requested_gross)
        raw = encoded(body)
        artifacts[gate] = raw
        records[gate] = dict(sha256=auth.digest(raw), asof_ts_ms=body["asof_ts_ms"])
    manifest = dict(version=1, candidate_key=candidate.key(), owner_id=contract.OWNER,
                    route=contract.ROUTE, capital_owner=contract.CAPITAL_OWNER,
                    requested_gross=candidate.requested_gross, proofs=records)
    root = encoded(manifest)
    return candidate, artifacts, manifest, root, auth.digest(root)


class ProofAuthenticityTests(unittest.TestCase):
    def test_format_only_contract_can_be_satisfied_with_fabricated_digest(self):
        c, _, _, _, _ = fixture()
        fake = contract.GateProof(True, "a" * 64, c.entry_ts_ms, c.key())
        ctx = contract.Context(**{g: fake for g in contract.REQUIRED_PROOFS},
                               open_symbols=(), pending_symbols=(), cooldown_until_ms=0)
        decision = contract.assess(c, ctx)
        self.assertEqual(decision.verdict, contract.Verdict.NEED_NATIVE_ALLOCATOR)
        self.assertFalse(decision.native_order_authorized)

    def test_old_candidate_key_omits_gross_and_strict_manifest_binds_it(self):
        c, artifacts, _, raw, root = fixture()
        different = contract.Candidate(c.strategy_id, c.route, c.symbol, c.side,
                                       c.entry_ts_ms, 0.05, c.owner_id, c.capital_owner)
        self.assertEqual(c.key(), different.key())  # legacy contract weakness
        self.assertEqual(auth.check(different, raw, root, artifacts)[1],
                         ("TRUST_MANIFEST_BINDING_MISMATCH",))

    def test_no_trust_root_rejects_all(self):
        c, artifacts, _, raw, _ = fixture()
        decision = auth.assess_with_trust(c, raw, None, artifacts, (), (), 0)
        self.assertEqual(decision.verdict, contract.Verdict.REJECT)
        self.assertIn("TRUSTED_MANIFEST_DIGEST_ABSENT", decision.reasons)

    def test_independent_fixture_root_allows_preflight_not_order(self):
        c, artifacts, _, raw, root = fixture()
        decision = auth.assess_with_trust(c, raw, root, artifacts, (), (), 0)
        self.assertEqual(decision.verdict, contract.Verdict.NEED_NATIVE_ALLOCATOR)
        self.assertFalse(decision.native_order_authorized)

    def test_self_asserted_root_hash_not_a_trust_anchor(self):
        c, artifacts, _, raw, _ = fixture()
        self.assertFalse(auth.check(c, raw, None, artifacts)[0])

    def test_wrong_root_hash_rejects(self):
        c, artifacts, _, raw, _ = fixture()
        self.assertEqual(auth.check(c, raw, "0" * 64, artifacts)[1], ("TRUST_ROOT_DIGEST_MISMATCH",))

    def test_modified_gate_bytes_rejects(self):
        c, artifacts, _, raw, root = fixture()
        artifacts["gross"] = artifacts["gross"].replace(b"SYNTHETIC", b"ALTERED")
        self.assertEqual(auth.check(c, raw, root, artifacts)[1], ("ARTIFACT_DIGEST_MISMATCH:gross",))

    def test_missing_gate_rejects(self):
        c, artifacts, _, raw, root = fixture()
        artifacts.pop("margin")
        self.assertEqual(auth.check(c, raw, root, artifacts)[1], ("MISSING_OR_EXTRA_GATE_ARTIFACT",))

    def test_future_gate_artifact_rejects_even_when_digest_matches(self):
        c, artifacts, manifest, _, _ = fixture()
        body = json.loads(artifacts["gross"])
        body["exit_price"] = 100
        artifacts["gross"] = encoded(body)
        manifest["proofs"]["gross"]["sha256"] = auth.digest(artifacts["gross"])
        raw = encoded(manifest)
        self.assertEqual(auth.check(c, raw, auth.digest(raw), artifacts)[1],
                         ("FUTURE_FIELD_IN_GATE_ARTIFACT:gross",))

    def test_future_timestamp_rejects(self):
        c, artifacts, manifest, _, _ = fixture()
        body = json.loads(artifacts["cooldown"])
        body["asof_ts_ms"] = c.entry_ts_ms + 300000
        artifacts["cooldown"] = encoded(body)
        manifest["proofs"]["cooldown"] = dict(sha256=auth.digest(artifacts["cooldown"]),
                                                asof_ts_ms=body["asof_ts_ms"])
        raw = encoded(manifest)
        self.assertEqual(auth.check(c, raw, auth.digest(raw), artifacts)[1],
                         ("GATE_ASOF_OR_BINDING_MISMATCH:cooldown",))

    def test_other_candidate_key_rejects(self):
        c, artifacts, manifest, _, _ = fixture()
        manifest["candidate_key"] = "0" * 64
        raw = encoded(manifest)
        self.assertEqual(auth.check(c, raw, auth.digest(raw), artifacts)[1],
                         ("TRUST_MANIFEST_BINDING_MISMATCH",))

    def test_duplicate_json_key_rejects(self):
        c, artifacts, _, raw, _ = fixture()
        duplicate = raw[:-1] + b',"version":1}'
        self.assertIn("DUPLICATE_JSON_KEY", auth.check(c, duplicate, auth.digest(duplicate), artifacts)[1][0])

    def test_noncanonical_bytes_rejects(self):
        c, artifacts, _, raw, _ = fixture()
        noncanonical = raw + b"\n"
        self.assertIn("NONCANONICAL_JSON", auth.check(c, noncanonical, auth.digest(noncanonical), artifacts)[1][0])

    def test_symbol_position_still_blocks_with_synthetic_verified_fixture(self):
        c, artifacts, _, raw, root = fixture()
        decision = auth.assess_with_trust(c, raw, root, artifacts, (contract.SYMBOL,), (), 0)
        self.assertEqual(decision.verdict, contract.Verdict.REJECT)
        self.assertIn("SAME_SYMBOL_POSITION_OPEN", decision.reasons)

    def test_pending_and_cooldown_still_block(self):
        c, artifacts, _, raw, root = fixture()
        decision = auth.assess_with_trust(c, raw, root, artifacts, (), (contract.SYMBOL,), c.entry_ts_ms + 1)
        self.assertEqual(decision.verdict, contract.Verdict.REJECT)
        self.assertIn("SAME_SYMBOL_PENDING_ORDER", decision.reasons)
        self.assertIn("COOLDOWN_ACTIVE", decision.reasons)


if __name__ == "__main__":
    unittest.main()
