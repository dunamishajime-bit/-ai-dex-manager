"""Research-only contract tests; synthetic fixtures are NOT venue evidence."""
from dataclasses import replace
import unittest
from render_4427_independent_owner_route_contract_20261025 import (
    Context, GateProof, Verdict, REQUIRED_PROOFS, assess, example_candidate,
)

TS = 1780000000000
SHA = "a" * 64
KEY = example_candidate(TS).key()


def passing_context(ts=TS):
    kw = {key: GateProof(True, SHA, ts - 300000, KEY) for key in REQUIRED_PROOFS}
    return Context(**kw, open_symbols=(), pending_symbols=(), cooldown_until_ms=ts - 1)


class ContractTests(unittest.TestCase):
    def test_all_synthetic_pass_still_not_order_authorization(self):
        d = assess(example_candidate(TS), passing_context())
        self.assertEqual(d.verdict, Verdict.NEED_NATIVE_ALLOCATOR)
        self.assertFalse(d.native_order_authorized)

    def test_may27_position_collision_rejected_even_if_all_proofs_pass(self):
        d = assess(example_candidate(TS), replace(passing_context(), open_symbols=("RENDERUSDT",)))
        self.assertEqual(d.verdict, Verdict.REJECT)
        self.assertIn("SAME_SYMBOL_POSITION_OPEN", d.reasons)

    def test_june23_june25_unknown_native_proofs_fail_closed(self):
        for _ in ("2026-06-23", "2026-06-25"):
            c = passing_context()
            c = replace(c, margin=GateProof(None, None, None, KEY), account_lock=GateProof(None, None, None, KEY))
            d = assess(example_candidate(TS), c)
            self.assertEqual(d.verdict, Verdict.REJECT)
            self.assertIn("NATIVE_PROOF_MISSING_OR_FAIL:MARGIN", d.reasons)

    def test_all_native_gates_are_mandatory(self):
        for name in REQUIRED_PROOFS:
            with self.subTest(gate=name):
                c = replace(passing_context(), **{name: GateProof(False, SHA, TS - 1, KEY)})
                self.assertEqual(assess(example_candidate(TS), c).verdict, Verdict.REJECT)

    def test_future_dated_proof_rejected(self):
        c = replace(passing_context(), shared_risk=GateProof(True, SHA, TS + 1, KEY))
        self.assertEqual(assess(example_candidate(TS), c).verdict, Verdict.REJECT)

    def test_invalid_provenance_sha_rejected(self):
        c = replace(passing_context(), registration=GateProof(True, "not-a-sha", TS - 1, KEY))
        self.assertEqual(assess(example_candidate(TS), c).verdict, Verdict.REJECT)

    def test_proof_for_other_candidate_is_not_reusable(self):
        c = replace(passing_context(), shared_risk=GateProof(True, SHA, TS - 1, "b" * 64))
        self.assertIn("NATIVE_PROOF_MISSING_OR_FAIL:SHARED_RISK", assess(example_candidate(TS), c).reasons)

    def test_missing_position_and_pending_are_not_empty(self):
        c = replace(passing_context(), open_symbols=None, pending_symbols=None)
        d = assess(example_candidate(TS), c)
        self.assertIn("POSITION_INVENTORY_MISSING", d.reasons)
        self.assertIn("PENDING_INVENTORY_MISSING", d.reasons)

    def test_pending_same_symbol_blocks(self):
        c = replace(passing_context(), pending_symbols=("RENDERUSDT",))
        self.assertIn("SAME_SYMBOL_PENDING_ORDER", assess(example_candidate(TS), c).reasons)

    def test_cooldown_blocks(self):
        c = replace(passing_context(), cooldown_until_ms=TS + 1)
        self.assertIn("COOLDOWN_ACTIVE", assess(example_candidate(TS), c).reasons)

    def test_missing_cooldown_blocks(self):
        c = replace(passing_context(), cooldown_until_ms=None)
        self.assertIn("COOLDOWN_UNVERIFIED", assess(example_candidate(TS), c).reasons)

    def test_wrong_owner_or_capital_bucket_rejected(self):
        for kw in ({"owner_id": "IDLE"}, {"capital_owner": "INDEPENDENT"}, {"route": "IDLE_RENDER_CORE"}):
            c = replace(example_candidate(TS), **kw)
            self.assertIn("ROUTE_OWNER_BINDING_MISMATCH", assess(c, passing_context()).reasons)

    def test_malformed_entry_timestamp_rejected_without_exception(self):
        c = replace(example_candidate(TS), entry_ts_ms="invalid")
        self.assertEqual(assess(c, passing_context()).verdict, Verdict.REJECT)

    def test_gross_over_nominal_rejected(self):
        c = replace(example_candidate(TS), requested_gross=0.26)
        self.assertIn("INVALID_REQUESTED_GROSS", assess(c, passing_context()).reasons)


if __name__ == "__main__":
    unittest.main(verbosity=2)
