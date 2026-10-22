#!/usr/bin/env python3
"""Causal and scope regression for five-IDLE SHORT entry selection."""
import copy,importlib.util,pathlib,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("idle5_gate_full8_test_target",HERE/"run-idle-five-entry-full8-after-hype-20261022.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
M5=300000
class Stub:
 def __init__(self,n=301,vol=1.,target="RENDERUSDT"):
  self.bars={}
  for symbol in ("RENDERUSDT","TAOUSDT","DOTUSDT","JUPUSDT","TIAUSDT","BTCUSDT"):
   b=[]
   for i in range(n):
    volume=3. if symbol==target and 288<=i<300 else vol
    close=100.
    b.append((i*M5,100.,100.,100.,close,volume))
   self.bars[symbol]=b
 def getdata(self,symbol):
  rows=self.bars[symbol]
  return rows,[int(r[0]) for r in rows]
def row(sym,side="SHORT",strategy="IDLE",tag="x"):
 return {"candidate_id":tag,"strategy_id":strategy,"side":side,"symbol":sym,"entry_ts_ms":300*M5}
class TestGates(unittest.TestCase):
 def setUp(self):
  for key in ("passed","blocked","missing"):m.ACTIVE[key].clear()
  m.ACTIVE["checked"]=0
  m.screen.CACHE.clear()
 def test_completed_m5_excludes_entry_bar(self):
  s=Stub()
  f=m.screen.get_feat(s,"RENDERUSDT",300*M5)
  self.assertGreater(f["volratio"],1.2)
  s.bars["RENDERUSDT"][300]=(300*M5,100.,1000.,0.01,500.,100000)
  m.screen.CACHE.clear()
  f2=m.screen.get_feat(s,"RENDERUSDT",300*M5)
  self.assertEqual(f,f2)
 def test_unavailable_24h_fail_closed(self):
  s=Stub(90)
  self.assertIsNone(m.screen.get_feat(s,"RENDERUSDT",89*M5))
 def test_scope_short_only(self):
  s=Stub()
  items=[row("RENDERUSDT",tag="a"),row("RENDERUSDT",side="LONG",tag="b"),
         row("RENDERUSDT",strategy="V12",tag="c"),
         row("DOTUSDT",tag="d"),row("TAOUSDT",tag="e")]
  m.ACTIVE["policy"]=m.POLICIES["RENDER_VOL1P2"]
  with patch.object(m.entry,"candidate_transform",side_effect=lambda rows,*a,**k:rows):
   out=m.entry_filter(items,[],s,10,{},None)
  self.assertEqual(items,out)
  self.assertEqual(m.ACTIVE["checked"],1)
 def test_not_armed_for_unrelated_symbols(self):
  s=Stub()
  m.ACTIVE["policy"]=m.POLICIES["DOT_VOL1P2"]
  with patch.object(m.entry,"candidate_transform",side_effect=lambda rows,*a,**k:rows):
   out=m.entry_filter([row("RENDERUSDT"),row("DOTUSDT")],[],s,10,{},None)
  self.assertEqual(len(out),1)
  self.assertEqual(out[0]["symbol"],"RENDERUSDT")
 def test_fail_closed_with_missing_source(self):
  s=Stub(30)
  m.ACTIVE["policy"]=m.POLICIES["RENDER_VOL1P2"]
  target=row("RENDERUSDT");target["entry_ts_ms"]=30*M5
  with patch.object(m.entry,"candidate_transform",side_effect=lambda rows,*a,**k:rows):
   out=m.entry_filter([target],[],s,10,{},None)
  self.assertEqual(out,[])
  self.assertEqual(len(m.ACTIVE["missing"]),1)
 def test_original_hype_remains(self):
  self.assertEqual(m.idle.HYPE_RULE["arm_hours"],1)
  self.assertEqual(m.idle.HYPE_RULE["floor"],.015)
  self.assertEqual(m.hype.GATE["btc3hMaxPct"],.6)
  self.assertEqual(m.hype.GATE["hypeMinusBtc3hMinPct"],2)
 def test_rule_covers_five_symbols(self):
  self.assertEqual(set(m.screen.SYMS),set(("RENDERUSDT","TAOUSDT","DOTUSDT","JUPUSDT","TIAUSDT")))
  for name,policy in m.POLICIES.items():
   for symbol,terms in policy.items():
    self.assertIn(symbol,m.screen.SYMS)
    self.assertTrue(all(term in m.FEATURE_RULES for term in terms))
if __name__=="__main__":unittest.main()
