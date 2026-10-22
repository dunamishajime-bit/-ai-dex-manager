#!/usr/bin/env python3
"""Test RESIDUAL causal M5 early stop and prior-adopted logic isolation."""
from __future__ import annotations
import collections,importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
def load(name,rel):
 spec=importlib.util.spec_from_file_location(name,HERE/rel);assert spec and spec.loader
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
scan=load("residual_exit_screen_unit", "screen-residual-next-m5-after-v52amzn-20261023.py")
bt=load("residual_exit_bt_unit","run-residual-doge-m5-full8-after-amzn-20261023.py")
B=scan.M5

class Source:
 def __init__(self,prices):
  self.bars=[(i*B,float(x),float(x)*1.005,float(x)*.995,float(x),100.) for i,x in enumerate(prices)]
  self.times=[r[0] for r in self.bars]
 def getdata(self,symbol):return self.bars,self.times

def trade(symbol="DOGEUSDT",exit_bars=16):
 return {"strategy_id":"RESIDUAL","symbol":symbol,"side":"LONG",
  "entry_price":100.0,"entry_ts_ms":0,"exit_ts_ms":B*exit_bars,
  "exit_price":95.,"candidate_id":"TEST_RESIDUAL","route":"DOGE_REL_VOL"}
def rule(hours=1,loss=2,mfe=1):
 return {"symbol":"DOGEUSDT","kind":"early_loss","hours":hours,"lossPct":loss,"mfeMaxPct":mfe}
class ResidualCausalM5Tests(unittest.TestCase):
 def test_residual_all_rules_only_doge_avx_symbols(self):
  self.assertEqual(len(scan.RULES),8)
  self.assertEqual(len(bt.CASES),4)
  self.assertTrue(all(v["symbol"] in ("DOGEUSDT","AVAXUSDT") for v in scan.RULES.values()))
  self.assertTrue(all(v["symbol"]=="DOGEUSDT" for c in bt.CASES for v in [scan.RULES[x] for x in bt.CASES[c]]))
 def test_next_open_after_completed_signal(self):
  prices=[100.]*12+[97.]*5
  x=scan.candidate(trade(exit_bars=17),rule(),Source(prices),10,collections.Counter())
  self.assertIsNotNone(x)
  self.assertEqual(x["ts"],13*B)
  self.assertLess(x["fill"],97)
 def test_no_trigger_before_one_hour(self):
  prices=[100.]*3+[97.]*8
  x=scan.candidate(trade(exit_bars=11),rule(),Source(prices),10,collections.Counter())
  self.assertIsNone(x)
 def test_skip_wrong_strategy_symbol_and_side(self):
  prices=[100.]*12+[97.]*6
  for item in (dict(trade(),symbol="AVAXUSDT"),dict(trade(),strategy_id="V12"),
               dict(trade(),side="SHORT")):
   self.assertIsNone(scan.candidate(item,rule(),Source(prices),10,collections.Counter()))
 def test_stop_avoids_prior_mfe_above_threshold(self):
  prices=[100.]*5+[102.]*5+[97.]*6
  self.assertIsNone(scan.candidate(trade(),rule(),Source(prices),10,collections.Counter()))
 def test_no_exit_if_original_exit_already_triggered(self):
  prices=[100.]*12+[97.,97.]
  self.assertIsNone(scan.candidate(trade(exit_bars=13),rule(),Source(prices),10,collections.Counter()))
 def test_more_cost_gets_more_conservative_fill(self):
  prices=[100.]*12+[97.]*5
  s=Source(prices)
  a=scan.candidate(trade(exit_bars=17),rule(),s,10,collections.Counter())
  b=scan.candidate(trade(exit_bars=17),rule(),s,30,collections.Counter())
  self.assertIsNotNone(a);self.assertIsNotNone(b)
  self.assertGreater(a["fill"],b["fill"])
 def test_gap_or_anchor_mismatch_blocks(self):
  s=Source([80.]*18)
  o=collections.Counter()
  x=scan.candidate(trade(exit_bars=16),rule(),s,10,o)
  self.assertIsNone(x)
  self.assertEqual(o["entry_mismatch"],1)
  s=Source([100.]*12+[97.]*6)
  s.bars[2]=(s.bars[2][0]+B,*s.bars[2][1:])
  s.times[2]=s.bars[2][0]
  xx=scan.candidate(trade(exit_bars=18),rule(),s,10,collections.Counter())
  self.assertIsNone(xx)
 def test_unique_custom_overlay_names(self):
  keys=[v["id"] for name in bt.CASES for v in bt.rules_for(name)]
  self.assertGreaterEqual(len(set(keys)),2)
  self.assertTrue(all(v["strategy"]=="RESIDUAL" for name in bt.CASES for v in bt.rules_for(name)))
 def test_original_baseline_amzn_study_is_found(self):
  import json
  p=bt.BASE
  self.assertTrue(p.is_file())
  x=json.loads(p.read_text("utf-8"))
  self.assertEqual(x["cases"][bt.AMZN_STUDY]["tape"]["amznVetoCount"],1)
  self.assertEqual(x["cases"][bt.AMZN_STUDY]["tape"]["amznVetoShort"],1)
if __name__=="__main__":unittest.main()
