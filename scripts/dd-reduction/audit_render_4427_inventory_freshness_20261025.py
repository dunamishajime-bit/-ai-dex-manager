#!/usr/bin/env python3
"""RESEARCH ONLY: stale but hash-pinned inventory can pass old synthetic preflight.

This is NOT an Aster/native authoritative inventory or an order authorization.
"""
from __future__ import annotations
import hashlib, importlib.util, json, sys, unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("render4427_inventory_binding_prior",HERE/"audit_render_4427_inventory_context_binding_20261025.py")
prior=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=prior
spec.loader.exec_module(prior)
MAX_AGE_MS=300_000  # research-only conservative bound, not a LIVE policy

def shift_inventory_asof(fixture, asof_ts_ms):
    parts=list(fixture)
    obj=prior.a.canonical(parts[-2])
    obj["asof_ts_ms"]=asof_ts_ms
    parts[-2]=prior.enc(obj)
    parts[-1]=prior.sha(parts[-2])
    return tuple(parts)

def assess_fresh(f,positions=(),pending=(),cooldown=0):
    baseline=prior.assess(f,positions,pending,cooldown)
    if baseline!="NEED_NATIVE_ALLOCATOR":
        return baseline
    x,entry,manifest,pin,artifacts,inventory,inventory_pin=f
    obj=prior.a.canonical(inventory)
    ts=obj["asof_ts_ms"]
    if ts<entry["signal_ts_ms"] or x.entry_ts_ms-ts>MAX_AGE_MS:
        return "REJECT_INVENTORY_STALE"
    return "NEED_NATIVE_ALLOCATOR"  # preflight only; native allocator still mandatory

class Tests(unittest.TestCase):
    def test_prior_accepts_one_day_stale_synthetic_snapshot(self):
        f=prior.fixture()
        f=shift_inventory_asof(f,f[0].entry_ts_ms-86_400_000)
        self.assertEqual(prior.assess(f),"NEED_NATIVE_ALLOCATOR")
    def test_strict_rejects_one_day_stale(self):
        f=prior.fixture()
        self.assertEqual(assess_fresh(shift_inventory_asof(f,f[0].entry_ts_ms-86_400_000)),"REJECT_INVENTORY_STALE")
    def test_exact_five_minute_boundary(self):
        self.assertEqual(assess_fresh(prior.fixture()),"NEED_NATIVE_ALLOCATOR")
    def test_older_than_five_minute(self):
        f=prior.fixture()
        self.assertEqual(assess_fresh(shift_inventory_asof(f,f[0].entry_ts_ms-MAX_AGE_MS-1)),"REJECT_INVENTORY_STALE")
    def test_snapshot_before_signal(self):
        f=prior.fixture()
        self.assertEqual(assess_fresh(shift_inventory_asof(f,f[1]["signal_ts_ms"]-1)),"REJECT_INVENTORY_STALE")
    def test_future_snapshot_rejected_by_prior(self):
        f=prior.fixture()
        self.assertEqual(assess_fresh(shift_inventory_asof(f,f[0].entry_ts_ms+1)),"REJECT_INVENTORY_ASOF")
    def test_same_symbol_open_rejected(self):
        f=prior.fixture(positions=(prior.c.SYMBOL,))
        self.assertEqual(assess_fresh(f,(prior.c.SYMBOL,)),"REJECT")
    def test_pending_rejected(self):
        f=prior.fixture(pending=(prior.c.SYMBOL,))
        self.assertEqual(assess_fresh(f,(),(prior.c.SYMBOL,)),"REJECT")
    def test_cooldown_rejected(self):
        f=prior.fixture(cooldown=prior.c.example_candidate(1782176400000).entry_ts_ms+1)
        self.assertEqual(assess_fresh(f,(),(),f[0].entry_ts_ms+1),"REJECT")
    def test_unpinned_rejected(self):
        f=list(prior.fixture());f[-1]=None
        self.assertEqual(assess_fresh(tuple(f)),"REJECT_UNPINNED_INVENTORY")
    def test_manifest_proof_missing_rejected(self):
        f=list(prior.fixture());f[3]=None
        self.assertTrue(assess_fresh(tuple(f)).startswith("REJECT_PROOF:"))
    def test_context_mismatch_rejected(self):
        f=prior.fixture(positions=(prior.c.SYMBOL,))
        self.assertEqual(assess_fresh(f),"REJECT_CONTEXT_NOT_BOUND")
    def test_entry_price_mutation_rejected(self):
        f=list(prior.fixture());f[1]=dict(f[1],entry_price=99)
        self.assertEqual(assess_fresh(tuple(f)),"REJECT_INVENTORY_ENTRY_BINDING")
    def test_fresh_snapshot_at_entry_preflight_only(self):
        f=prior.fixture()
        self.assertEqual(assess_fresh(shift_inventory_asof(f,f[0].entry_ts_ms)),"NEED_NATIVE_ALLOCATOR")

def audit():
    f=prior.fixture()
    stale=shift_inventory_asof(f,f[0].entry_ts_ms-86_400_000)
    return dict(
        status="RESEARCH_ONLY_STALE_INVENTORY_ASOF_ACCEPTANCE_FOUND",
        prior_one_day_stale=prior.assess(stale),
        strict_one_day_stale=assess_fresh(stale),
        strict_five_minute=assess_fresh(f),
        strict_open_symbol=assess_fresh(prior.fixture(positions=(prior.c.SYMBOL,)),(prior.c.SYMBOL,)),
        inventory_age_policy_ms=MAX_AGE_MS,
        prior_asof_check_only="0<inventory_asof<=entry_ts",
        proof_bytes_and_pinned_digest_synthetic_only=True,
        actual_native_inventory_root_verified=False,
        actual_aster_fills_verified=False,
        native_owner_registered=False,
        native_order_authorized=False,
        economic_bt_performed=False,
        live_modified=False)
if __name__=="__main__":
    r=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    if not r.wasSuccessful():raise SystemExit(1)
    print(json.dumps(audit(),sort_keys=True,separators=(",",":"),ensure_ascii=False))
