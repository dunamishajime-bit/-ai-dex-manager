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

 def test_render_profit_1p5_protects_quarter_percent(self):
  bars=[(i*M5,100.,100.,100.,100.,1.) for i in range(22)]
  bars[2]=(2*M5,100.,100.1,97.5,98.,1.)
  bars[3]=(3*M5,98.,99.9,97.9,99.6,1.)
  class Source:
   def getdata(self,symbol):
    return bars,[int(r[0]) for r in bars]
  obs={"by_reason":__import__("collections").Counter()}
  obs=__import__("collections").defaultdict(int,obs)
  target={"strategy_id":"IDLE","side":"SHORT","symbol":"RENDERUSDT",
          "entry_ts_ms":0,"entry_price":100.,"exit_ts_ms":20*M5}
  new=m.apply(target,m.EXIT_RULES["RENDER_PROFIT_1P5_FLOOR0P25"],Source(),10,obs)
  self.assertEqual(new["exit_ts_ms"],4*M5)
  self.assertGreater(new["exit_price"],99.75)
  self.assertLess(new["exit_price"],100.1)
  self.assertIn("RESEARCH_IDLE_RENDER",new["exit_reason"])
 def test_render_profit_no_same_bar_lookahead(self):
  bars=[(i*M5,100.,100.,100.,100.,1.) for i in range(22)]
  bars[3]=(3*M5,100.,100.1,97.0,98.0,1.)
  for j in range(4,22):bars[j]=(j*M5,98.,99.,97.8,98.2,1.)
  class Source:
   def getdata(self,symbol):
    return bars,[int(r[0]) for r in bars]
  obs=__import__("collections").defaultdict(int)
  obs["by_reason"]=__import__("collections").Counter()
  target={"strategy_id":"IDLE","side":"SHORT","symbol":"RENDERUSDT",
          "entry_ts_ms":0,"entry_price":100.,"exit_ts_ms":20*M5}
  new=m.apply(target,m.EXIT_RULES["RENDER_PROFIT_1P5_FLOOR0P25"],Source(),10,obs)
  self.assertEqual(new["exit_ts_ms"],target["exit_ts_ms"])
 def test_render_profit_is_exclusive_to_short_render(self):
  rule=m.EXIT_RULES["RENDER_PROFIT_1P5_FLOOR0P25"]
  self.assertFalse(m.idle.matches({"strategy_id":"IDLE","side":"SHORT","symbol":"TAOUSDT"},rule))
  self.assertFalse(m.idle.matches({"strategy_id":"IDLE","side":"LONG","symbol":"RENDERUSDT"},rule))
  self.assertFalse(m.idle.matches({"strategy_id":"HYPE_LONG","side":"LONG","symbol":"HYPEUSDT"},rule))


 def test_render_btc_relative_bull_veto_exact(self):
  good={"btc6h":.3,"rel6h":-.01}
  bad={"btc6h":.3,"rel6h":.01}
  self.assertTrue(m.rule_accepts(good,"VETO_BTC6POS_REL6POS"))
  self.assertFalse(m.rule_accepts(bad,"VETO_BTC6POS_REL6POS"))
  self.assertTrue(m.rule_accepts({"btc6h":0.,"rel6h":1.},"VETO_BTC6POS_REL6POS"))
  self.assertTrue(m.rule_accepts({"btc6h":-1.,"rel6h":1.},"VETO_BTC6POS_REL6POS"))
  self.assertFalse(m.rule_accepts({"btc6h":None,"rel6h":1.},"VETO_BTC6POS_REL6POS"))
 def test_render_bull_veto_is_symbol_short_scoped(self):
  m.ACTIVE["policy"]=m.POLICIES["RENDER_SKIP_RISING_BTC_STRONG_REL"]
  rows=[row("RENDERUSDT",tag="a"),row("TAOUSDT",tag="b"),
        row("RENDERUSDT",side="LONG",tag="c")]
  s=Stub()
  with patch.object(m.entry,"candidate_transform",side_effect=lambda a,*args,**kw:a):
   with patch.object(m.screen,"get_feat",return_value={"btc6h":1.,"rel6h":1.}):
    out=m.entry_filter(rows,[],s,10,{},None)
  self.assertEqual([x["candidate_id"] for x in out],["b","c"])
  self.assertEqual(len(m.ACTIVE["blocked"]),1)

if __name__=="__main__":unittest.main()
