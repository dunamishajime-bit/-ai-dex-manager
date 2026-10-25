#!/usr/bin/env python3
"""RESEARCH ONLY: inventory receipt replay/sequence boundary for RENDER #4427.

Synthetic contract demonstration, not Native8 integration, an Aster signature,
an actual inventory producer, or any authorization to trade.
"""
from __future__ import annotations
import hashlib, importlib.util, json, sys, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

fresh = load("render4427_prior_freshness", "audit_render_4427_inventory_freshness_20261025.py")
prior = fresh.prior
SOURCE_ID = "SYNTHETIC_RESEARCH_INVENTORY_ONLY"
OWNER = prior.c.OWNER
ROUTE = prior.c.ROUTE

def encoded(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
def sha(raw):
    return hashlib.sha256(raw).hexdigest()
def immutable_entry_hash(f):
    return sha(encoded(f[1]))

def make_receipt(f, sequence=41, event_id="SYNTHETIC_EVENT_41", source_id=SOURCE_ID):
    x, entry, manifest, proof_root, artifacts, inventory, inventory_root = f
    body = {
        "schema": "RESEARCH_INVENTORY_RECEIPT_V1",
        "source_id": source_id, "sequence": sequence, "event_id": event_id,
        "candidate_key": x.key(), "entry_projection_sha256": immutable_entry_hash(f),
        "owner_id": x.owner_id, "route": x.route,
        "inventory_sha256": inventory_root, "proof_manifest_sha256": proof_root,
        "asof_ts_ms": prior.a.canonical(inventory)["asof_ts_ms"],
    }
    raw = encoded(body)
    return raw, sha(raw)

class ResearchSequenceGuard:
    """Ephemeral synthetic anti-replay proof; not atomic/durable and never an order permit."""
    def __init__(self, trusted_source_id=SOURCE_ID):
        self.trusted_source_id = trusted_source_id
        self.highest_seq = {}
        self.used_event_ids = set()
        self.used_entry_keys = set()

    def assess(self, f, receipt_bytes, independently_pinned_receipt_sha,
               positions=(), pending=(), cooldown=0):
        base = fresh.assess_fresh(f, positions, pending, cooldown)
        if base != "NEED_NATIVE_ALLOCATOR":
            return base
        if not isinstance(receipt_bytes, bytes) or not isinstance(independently_pinned_receipt_sha, str):
            return "REJECT_RECEIPT_UNPINNED"
        if sha(receipt_bytes) != independently_pinned_receipt_sha:
            return "REJECT_RECEIPT_DIGEST"
        try:
            r = json.loads(receipt_bytes)
        except (ValueError, UnicodeError):
            return "REJECT_RECEIPT_FORMAT"
        if not isinstance(r, dict) or encoded(r) != receipt_bytes:
            return "REJECT_RECEIPT_NONCANONICAL"
        expected = {"schema", "source_id", "sequence", "event_id", "candidate_key",
                    "entry_projection_sha256", "owner_id", "route", "inventory_sha256",
                    "proof_manifest_sha256", "asof_ts_ms"}
        if set(r) != expected or r["schema"] != "RESEARCH_INVENTORY_RECEIPT_V1":
            return "REJECT_RECEIPT_SCHEMA"
        if r["source_id"] != self.trusted_source_id:
            return "REJECT_RECEIPT_SOURCE"
        if type(r["sequence"]) is not int or r["sequence"] <= 0 or not isinstance(r["event_id"], str) or not r["event_id"]:
            return "REJECT_RECEIPT_SEQUENCE"
        x, entry, manifest, proof_root, artifacts, inventory, inventory_root = f
        bindings = {
            "candidate_key": x.key(), "entry_projection_sha256": immutable_entry_hash(f),
            "owner_id": OWNER, "route": ROUTE, "inventory_sha256": inventory_root,
            "proof_manifest_sha256": proof_root,
            "asof_ts_ms": prior.a.canonical(inventory)["asof_ts_ms"],
        }
        if any(r[k] != v for k, v in bindings.items()):
            return "REJECT_RECEIPT_BINDING"
        event_key = (r["source_id"], r["event_id"])
        entry_key = (r["source_id"], r["entry_projection_sha256"])
        if event_key in self.used_event_ids or entry_key in self.used_entry_keys:
            return "REJECT_RECEIPT_REPLAY"
        if r["sequence"] <= self.highest_seq.get(r["source_id"], 0):
            return "REJECT_RECEIPT_OUT_OF_ORDER"
        self.highest_seq[r["source_id"]] = r["sequence"]
        self.used_event_ids.add(event_key)
        self.used_entry_keys.add(entry_key)
        return "NEED_NATIVE_ALLOCATOR"  # still NOT an order authorization

class Tests(unittest.TestCase):
    def setUp(self):
        self.f = prior.fixture()
        self.receipt, self.pin = make_receipt(self.f)
    def test_old_freshness_reuses_identical_snapshot(self):
        self.assertEqual(fresh.assess_fresh(self.f), "NEED_NATIVE_ALLOCATOR")
        self.assertEqual(fresh.assess_fresh(self.f), "NEED_NATIVE_ALLOCATOR")
    def test_first_receipt_preflight_only(self):
        self.assertEqual(ResearchSequenceGuard().assess(self.f, self.receipt, self.pin), "NEED_NATIVE_ALLOCATOR")
    def test_duplicate_receipt_rejected(self):
        guard=ResearchSequenceGuard()
        self.assertEqual(guard.assess(self.f,self.receipt,self.pin),"NEED_NATIVE_ALLOCATOR")
        self.assertEqual(guard.assess(self.f,self.receipt,self.pin),"REJECT_RECEIPT_REPLAY")
    def test_same_candidate_new_sequence_still_rejected(self):
        guard=ResearchSequenceGuard()
        self.assertEqual(guard.assess(self.f,self.receipt,self.pin),"NEED_NATIVE_ALLOCATOR")
        raw,pin=make_receipt(self.f,42,"SYNTHETIC_EVENT_42")
        self.assertEqual(guard.assess(self.f,raw,pin),"REJECT_RECEIPT_REPLAY")
    def test_missing_pin(self):
        self.assertEqual(ResearchSequenceGuard().assess(self.f,self.receipt,None),"REJECT_RECEIPT_UNPINNED")
    def test_tampered_bytes(self):
        self.assertEqual(ResearchSequenceGuard().assess(self.f,self.receipt+b" ",self.pin),"REJECT_RECEIPT_DIGEST")
    def test_untrusted_source(self):
        raw,pin=make_receipt(self.f,source_id="SELF_ASSERTED")
        self.assertEqual(ResearchSequenceGuard().assess(self.f,raw,pin),"REJECT_RECEIPT_SOURCE")
    def test_wrong_inventory_binding(self):
        r=json.loads(self.receipt);r["inventory_sha256"]="f"*64;raw=encoded(r)
        self.assertEqual(ResearchSequenceGuard().assess(self.f,raw,sha(raw)),"REJECT_RECEIPT_BINDING")
    def test_wrong_owner_binding(self):
        r=json.loads(self.receipt);r["owner_id"]="IDLE_OTHER";raw=encoded(r)
        self.assertEqual(ResearchSequenceGuard().assess(self.f,raw,sha(raw)),"REJECT_RECEIPT_BINDING")
    def test_wrong_entry_projection(self):
        r=json.loads(self.receipt);r["entry_projection_sha256"]="f"*64;raw=encoded(r)
        self.assertEqual(ResearchSequenceGuard().assess(self.f,raw,sha(raw)),"REJECT_RECEIPT_BINDING")
    def test_zero_sequence(self):
        raw,pin=make_receipt(self.f,0)
        self.assertEqual(ResearchSequenceGuard().assess(self.f,raw,pin),"REJECT_RECEIPT_SEQUENCE")
    def test_missing_receipt_field(self):
        r=json.loads(self.receipt);del r["route"];raw=encoded(r)
        self.assertEqual(ResearchSequenceGuard().assess(self.f,raw,sha(raw)),"REJECT_RECEIPT_SCHEMA")
    def test_stale_inventory_still_rejected(self):
        f=fresh.shift_inventory_asof(self.f,self.f[0].entry_ts_ms-86400000)
        raw,pin=make_receipt(f)
        self.assertEqual(ResearchSequenceGuard().assess(f,raw,pin),"REJECT_INVENTORY_STALE")
    def test_open_position_still_rejected(self):
        f=prior.fixture(positions=(prior.c.SYMBOL,));raw,pin=make_receipt(f)
        self.assertEqual(ResearchSequenceGuard().assess(f,raw,pin,(prior.c.SYMBOL,)),"REJECT")
    def test_pending_still_rejected(self):
        f=prior.fixture(pending=(prior.c.SYMBOL,));raw,pin=make_receipt(f)
        self.assertEqual(ResearchSequenceGuard().assess(f,raw,pin,(),(prior.c.SYMBOL,)),"REJECT")
    def test_cooldown_still_rejected(self):
        f=prior.fixture(cooldown=self.f[0].entry_ts_ms+1);raw,pin=make_receipt(f)
        self.assertEqual(ResearchSequenceGuard().assess(f,raw,pin,(),(),self.f[0].entry_ts_ms+1),"REJECT")
    def test_replay_guard_not_durable(self):
        self.assertEqual(ResearchSequenceGuard().assess(self.f,self.receipt,self.pin),"NEED_NATIVE_ALLOCATOR")
        self.assertEqual(ResearchSequenceGuard().assess(self.f,self.receipt,self.pin),"NEED_NATIVE_ALLOCATOR")
    def test_sequence_monotonicity_distinct_candidates(self):
        f2=list(self.f);f2[1]=dict(f2[1],entry_price=1.45)
        # Rebuild a fully bound synthetic candidate+manifest+inventory for a different key.
        # The original fixture helper fixes price while preserving its as-of and proof bytes.
        f2=prior.fixture(price=1.45)
        r2,p2=make_receipt(f2,40,"SYNTHETIC_EVENT_40")
        guard=ResearchSequenceGuard()
        self.assertEqual(guard.assess(self.f,self.receipt,self.pin),"NEED_NATIVE_ALLOCATOR")
        self.assertEqual(guard.assess(f2,r2,p2),"REJECT_RECEIPT_OUT_OF_ORDER")
    def test_higher_sequence_new_candidate_preflight(self):
        f2=prior.fixture(price=1.45);r2,p2=make_receipt(f2,42,"SYNTHETIC_EVENT_42")
        guard=ResearchSequenceGuard()
        self.assertEqual(guard.assess(self.f,self.receipt,self.pin),"NEED_NATIVE_ALLOCATOR")
        self.assertEqual(guard.assess(f2,r2,p2),"NEED_NATIVE_ALLOCATOR")

def audit():
    f=prior.fixture()
    raw,pin=make_receipt(f)
    guard=ResearchSequenceGuard()
    old_first=fresh.assess_fresh(f);old_second=fresh.assess_fresh(f)
    new_first=guard.assess(f,raw,pin);new_second=guard.assess(f,raw,pin)
    src=(HERE/"run-render-4427-independent-profit-sell55-native8-20261024.py").read_text("utf-8")
    assertions=("'generic_accepted':True", "'route_selected':True", "'overlay_source_current':True",
                "'priority':0", "'source_runtime_sha':'RESEARCH_ONLY_")
    # priority may be written without quotation around its key in another revision;
    # only source-pinned assertions are used in this audit.
    assert all(x in src for x in assertions), "SOURCE_ANCHOR_DRIFT"
    return {
        "status":"RESEARCH_ONLY_INVENTORY_RECEIPT_REPLAY_BOUNDARY_FOUND",
        "old_fresh_preflight_twice":[old_first,old_second],
        "research_guard_twice":[new_first,new_second],
        "source_code_sha256":sha(src.encode("utf-8")),
        "research_candidate_self_asserted_fields":["generic_accepted","route_selected","overlay_source_current","priority","source_runtime_sha"],
        "authoritative_native_inventory_producer_verified_in_audited_path":False,
        "real_trusted_root_available":False,
        "synthetic_receipt_only":True,
        "sequence_guard_atomic_or_durable":False,
        "native_owner_registered":False,
        "native_order_authorized":False,
        "economic_bt_performed":False,
        "live_modified":False,
    }

if __name__=="__main__":
    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    if not result.wasSuccessful():raise SystemExit(1)
    print(json.dumps(audit(),sort_keys=True,separators=(",",":"),ensure_ascii=False))
