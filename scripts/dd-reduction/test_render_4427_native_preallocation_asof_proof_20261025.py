#!/usr/bin/env python3
"""Synthetic-only tests for the RENDER #4427 immutable preallocation adapter."""
from __future__ import annotations
import copy
import importlib.util
from pathlib import Path
import unittest

p = Path(__file__).resolve().parent / "render_4427_native_preallocation_asof_proof_20261025.py"
spec = importlib.util.spec_from_file_location("prealloc_4427", p)
m = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = m
spec.loader.exec_module(m)


class PreallocationSafetyTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "strategy_id": "IDLE", "route": m.ROUTE, "symbol": "RENDERUSDT",
            "side": "SHORT", "entry_ts_ms": 1782176400000,
            "signal_ts_ms": 1782176400000, "requested_gross": 0.25,
            "entry_price": 1.608, "exit_ts_ms": 1782195600000,
            "exit_price": 1.58388, "unit_price_return": 0.015,
            "exit_reason": "RESEARCH_MODELED",
            "source_runtime_sha": "RESEARCH_ONLY_RENDER_4427_INDEPENDENT",
        }

    def test_research_registry_never_native_registered(self):
        self.assertFalse(m.RESEARCH_ROUTE["native_registered"])

    def test_no_mutation_and_no_authorization(self):
        before = copy.deepcopy(self.row)
        record = m.preallocation_record(self.row)
        self.assertEqual(self.row, before)
        self.assertFalse(record["order_authorized"])
        self.assertEqual(record["preallocation_verdict"], "REJECT_FAIL_CLOSED")

    def test_all_13_missing_proofs_reject(self):
        r = m.preallocation_record(self.row)
        self.assertEqual(sum("NATIVE_PROOF_MISSING_OR_FAIL:" in s for s in r["reasons"]), 13)

    def test_future_outcomes_not_in_preentry_projection(self):
        r = m.preallocation_record(self.row)
        self.assertEqual(len(r["future_outcome_fields_in_manifest"]), 4)
        self.assertFalse(set(m.FUTURE_OUTCOME_FIELDS) & set(r["preentry_projection"]))

    def test_runtime_label_not_hash(self):
        self.assertFalse(m.preallocation_record(self.row)["runtime_label_is_sha256"])

    def test_route_mismatch_rejected(self):
        x = dict(self.row, route="IDLE_RENDER_CORE")
        with self.assertRaises(ValueError):
            m.preallocation_record(x)

    def test_gross_above_cap_rejected(self):
        x = dict(self.row, requested_gross=0.26)
        self.assertIn("INVALID_REQUESTED_GROSS", m.preallocation_record(x)["reasons"])

    def test_candidate_key_excludes_future_result(self):
        x = dict(self.row, exit_price=0.1, unit_price_return=-0.95, exit_reason="DIFFERENT")
        self.assertEqual(m.preallocation_record(x)["candidate_key"],
                         m.preallocation_record(self.row)["candidate_key"])

    def test_candidate_key_changes_with_timestamp(self):
        x = dict(self.row, entry_ts_ms=self.row["entry_ts_ms"] + 3600000)
        self.assertNotEqual(m.preallocation_record(x)["candidate_key"],
                            m.preallocation_record(self.row)["candidate_key"])

    def test_invalid_future_proof_does_not_pass(self):
        c = m.candidate_from_preallocation(self.row)
        f = m.contract.GateProof(True, "a"*64, c.entry_ts_ms + 1, c.key())
        self.assertFalse(f.valid(c.entry_ts_ms, c.key()))

    def test_same_symbol_position_rejected_even_with_synthetic_pass(self):
        c = m.candidate_from_preallocation(self.row)
        f = m.contract.GateProof(True, "a"*64, c.entry_ts_ms, c.key())
        ctx = m.contract.Context(**{name:f for name in m.contract.REQUIRED_PROOFS},
                                 open_symbols=("RENDERUSDT",), pending_symbols=(),
                                 cooldown_until_ms=0)
        d = m.contract.assess(c,ctx)
        self.assertEqual(d.verdict, m.contract.Verdict.REJECT)
        self.assertIn("SAME_SYMBOL_POSITION_OPEN", d.reasons)

    def test_synthetic_pass_never_authorizes_order(self):
        c = m.candidate_from_preallocation(self.row)
        f = m.contract.GateProof(True, "a"*64, c.entry_ts_ms, c.key())
        ctx = m.contract.Context(**{name:f for name in m.contract.REQUIRED_PROOFS},
                                 open_symbols=(), pending_symbols=(), cooldown_until_ms=0)
        d = m.contract.assess(c,ctx)
        self.assertEqual(d.verdict, m.contract.Verdict.NEED_NATIVE_ALLOCATOR)
        self.assertFalse(d.native_order_authorized)

    def test_integrated_converged_manifest_audit(self):
        r = m.run_audit()
        self.assertEqual(set(r["costs"]), {"10","30"})
        for c in r["costs"].values():
            self.assertEqual(c["native_owner_admissions"],0)
            self.assertEqual(c["native_gate_proofs_authenticated"],0)
            self.assertEqual(len(c["candidates"]),3)


if __name__ == "__main__":
    unittest.main()
