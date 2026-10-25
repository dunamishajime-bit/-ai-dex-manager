#!/usr/bin/env python3
"""RESEARCH ONLY: context inventory is not authenticated by GateProof manifest."""
import hashlib,importlib.util,json,sys,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("render4427_auth_context",HERE/"render_4427_native_proof_authenticity_20261025.py")
a=importlib.util.module_from_spec(s);sys.modules[s.name]=a;s.loader.exec_module(a)
c=a.contract
def enc(x): return json.dumps(x,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
def sha(x): return hashlib.sha256(x).hexdigest()
def fixture(positions=(),pending=(),cooldown=0,price=1.23):
 x=c.example_candidate(1782176400000)
 artifacts={};proofs={}
 for gate in c.REQUIRED_PROOFS:
  body=dict(gate=gate,candidate_key=x.key(),passed=True,asof_ts_ms=x.entry_ts_ms-300000,source="SYNTHETIC",requested_gross=x.requested_gross)
  raw=enc(body);artifacts[gate]=raw;proofs[gate]=dict(sha256=sha(raw),asof_ts_ms=body["asof_ts_ms"])
 m=enc(dict(version=1,candidate_key=x.key(),owner_id=x.owner_id,route=x.route,capital_owner=x.capital_owner,requested_gross=x.requested_gross,proofs=proofs))
 entry=dict(strategy_id=x.strategy_id,route=x.route,symbol=x.symbol,side=x.side,entry_ts_ms=x.entry_ts_ms,signal_ts_ms=x.entry_ts_ms-300000,entry_price=price,requested_gross=x.requested_gross,owner_id=x.owner_id,capital_owner=x.capital_owner)
 inventory=enc(dict(version=1,entry_projection_sha256=sha(enc(entry)),asof_ts_ms=x.entry_ts_ms-300000,open_symbols=list(positions),pending_symbols=list(pending),cooldown_until_ms=cooldown,source="SYNTHETIC_INVENTORY"))
 return x,entry,m,sha(m),artifacts,inventory,sha(inventory)
def assess(f,positions=(),pending=(),cooldown=0):
 x,entry,m,msha,artifacts,inventory,isha=f
 ok,reasons,_=a.check(x,m,msha,artifacts)
 if not ok: return "REJECT_PROOF:"+",".join(reasons)
 if not isinstance(entry,dict) or set(entry)!={"strategy_id","route","symbol","side","entry_ts_ms","signal_ts_ms","entry_price","requested_gross","owner_id","capital_owner"}: return "REJECT_ENTRY_SCHEMA"
 expected=dict(strategy_id=x.strategy_id,route=x.route,symbol=x.symbol,side=x.side,entry_ts_ms=x.entry_ts_ms,signal_ts_ms=entry["signal_ts_ms"],entry_price=entry["entry_price"],requested_gross=x.requested_gross,owner_id=x.owner_id,capital_owner=x.capital_owner)
 if entry!=expected or type(entry["signal_ts_ms"]) is not int or not 0<entry["signal_ts_ms"]<=x.entry_ts_ms or type(entry["entry_price"]) not in (int,float) or not 0<entry["entry_price"]<float("inf"): return "REJECT_ENTRY_BINDING"
 if not isinstance(isha,str) or len(isha)!=64 or not isinstance(inventory,bytes):return "REJECT_UNPINNED_INVENTORY"
 if sha(inventory)!=isha:return "REJECT_INVENTORY_DIGEST"
 try: obj=a.canonical(inventory)
 except (ValueError,UnicodeError):return "REJECT_NONCANONICAL_INVENTORY"
 if set(obj)!={"version","entry_projection_sha256","asof_ts_ms","open_symbols","pending_symbols","cooldown_until_ms","source"} or obj["version"]!=1 or obj["entry_projection_sha256"]!=sha(enc(entry)):return "REJECT_INVENTORY_ENTRY_BINDING"
 if type(obj["asof_ts_ms"]) is not int or not 0<obj["asof_ts_ms"]<=x.entry_ts_ms or type(obj["cooldown_until_ms"]) is not int or obj["cooldown_until_ms"]<0:return "REJECT_INVENTORY_ASOF"
 for field in ("open_symbols","pending_symbols"):
  v=obj[field]
  if not isinstance(v,list) or any(not isinstance(t,str) for t in v) or v!=sorted(set(v)):return "REJECT_INVENTORY_LIST"
 if not isinstance(obj["source"],str) or not obj["source"].strip():return "REJECT_INVENTORY_SOURCE"
 if positions is None or pending is None or cooldown is None:return "REJECT_CALLER_UNVERIFIED"
 if list(positions)!=obj["open_symbols"] or list(pending)!=obj["pending_symbols"] or cooldown!=obj["cooldown_until_ms"]:return "REJECT_CONTEXT_NOT_BOUND"
 return a.assess_with_trust(x,m,msha,artifacts,tuple(positions),tuple(pending),cooldown).verdict.value
class Tests(unittest.TestCase):
 def test_old_same_proofs_different_positions(self):
  x,e,m,h,art,_,_=fixture()
  self.assertEqual(a.assess_with_trust(x,m,h,art,(),(),0).verdict,c.Verdict.NEED_NATIVE_ALLOCATOR)
  self.assertEqual(a.assess_with_trust(x,m,h,art,(x.symbol,),(),0).verdict,c.Verdict.REJECT)
 def test_old_same_proofs_different_pending(self):
  x,e,m,h,art,_,_=fixture()
  self.assertNotEqual(a.assess_with_trust(x,m,h,art,(),(),0).verdict,a.assess_with_trust(x,m,h,art,(),(x.symbol,),0).verdict)
 def test_old_same_proofs_different_cooldown(self):
  x,e,m,h,art,_,_=fixture()
  self.assertNotEqual(a.assess_with_trust(x,m,h,art,(),(),0).verdict,a.assess_with_trust(x,m,h,art,(),(),x.entry_ts_ms+1).verdict)
 def test_clean_synthetic_preflight_only(self):self.assertEqual(assess(fixture()),"NEED_NATIVE_ALLOCATOR")
 def test_unpinned(self):
  f=list(fixture());f[-1]=None;self.assertEqual(assess(f),"REJECT_UNPINNED_INVENTORY")
 def test_digest_tamper(self):
  f=list(fixture());f[-2]=f[-2].replace(b"SYNTHETIC_INVENTORY",b"OTHER");self.assertEqual(assess(f),"REJECT_INVENTORY_DIGEST")
 def test_false_empty_context(self):self.assertEqual(assess(fixture(positions=(c.SYMBOL,))),"REJECT_CONTEXT_NOT_BOUND")
 def test_attested_open_position(self):self.assertEqual(assess(fixture(positions=(c.SYMBOL,)),(c.SYMBOL,)),"REJECT")
 def test_attested_pending(self):self.assertEqual(assess(fixture(pending=(c.SYMBOL,)),(),(c.SYMBOL,)),"REJECT")
 def test_attested_cooldown(self):self.assertEqual(assess(fixture(cooldown=1782176400001),(),(),1782176400001),"REJECT")
 def test_entry_price_change(self):
  f=list(fixture());f[1]=dict(f[1],entry_price=9.9);self.assertEqual(assess(f),"REJECT_INVENTORY_ENTRY_BINDING")
 def test_future_snapshot(self):
  f=list(fixture());o=a.canonical(f[-2]);o["asof_ts_ms"]=f[0].entry_ts_ms+1;f[-2]=enc(o);f[-1]=sha(f[-2]);self.assertEqual(assess(f),"REJECT_INVENTORY_ASOF")
 def test_missing_caller(self):self.assertEqual(assess(fixture(),None,(),0),"REJECT_CALLER_UNVERIFIED")
 def test_no_13_proof_root(self):
  f=list(fixture());f[3]=None;self.assertTrue(assess(f).startswith("REJECT_PROOF:"))
def audit():
 x,e,m,h,art,inv,ih=fixture()
 return dict(status="RESEARCH_ONLY_INVENTORY_CONTEXT_BINDING_GAP",old_same_proof_bytes=True,
 old_empty=a.assess_with_trust(x,m,h,art,(),(),0).verdict.value,
 old_open=a.assess_with_trust(x,m,h,art,(x.symbol,),(),0).verdict.value,
 new_false_empty=assess(fixture(positions=(x.symbol,))),
 new_attested_open=assess(fixture(positions=(x.symbol,)),(x.symbol,)),
 new_missing_root=assess((x,e,m,h,art,inv,None)),
 new_clean_synthetic=assess(fixture()),actual_native_proof_authenticated=False,
 native_order_authorized=False,economic_bt_performed=False,live_modified=False)
if __name__=="__main__":
 result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
 if not result.wasSuccessful():raise SystemExit(1)
 print(json.dumps(audit(),sort_keys=True,separators=(",",":"),ensure_ascii=False))
