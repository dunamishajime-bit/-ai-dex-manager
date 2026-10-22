#!/usr/bin/env python3
"""Deterministic integrity tests for RESIDUAL entry redesign research only."""
from __future__ import annotations
import importlib.util,json,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/"docs/research/results/residual-entry-after-amzn-20261023"
def load(n,path):
 s=importlib.util.spec_from_file_location(n,HERE/path);assert s and s.loader
 o=importlib.util.module_from_spec(s);s.loader.exec_module(o);return o
long=load("residual_test_long","simulate-residual-new-multifactor-hourly-long-20261023.py")
short=load("residual_test_short","simulate-residual-bear-short-hourly-20261023.py")
prob=load("residual_test_prob","validate-residual-multifactor-predictive-entry-20261023.py")
def read(name):return json.loads((OUT/name).read_text("utf-8"))
class TestResidualEntryWinRate(unittest.TestCase):
 def test_25_gates_have_both_costs(self):
  d=read("RESIDUAL_CAUSAL_ENTRY_PRE_SCREEN_20261023.json")
  self.assertEqual(len(d["ruleDefinitions"]),25)
  self.assertEqual(set(d["costs"]),{"10","30"})
  self.assertEqual(d["costs"]["10"]["DOGEUSDT"]["baseline"]["n"],17)
  self.assertEqual(d["costs"]["30"]["DOGEUSDT"]["baseline"]["n"],16)
 def test_20_long_entry_candidates(self):
  d=read("RESIDUAL_INDEPENDENT_NEW_ENTRY_MODEL_20261023.json")
  self.assertEqual(len(d["cases"]),20)
  self.assertTrue(all(set(case)=={"DOGEUSDT","AVAXUSDT"} for case in d["cases"].values()))
  self.assertTrue(all(set(v)=={"10","30"} for case in d["cases"].values() for v in case.values()))
 def test_22_bear_short_entry_candidates(self):
  d=read("RESIDUAL_INDEPENDENT_BEAR_SHORT_DESIGN_20261023.json")
  self.assertEqual(len(d["cases"]),22)
  self.assertTrue(all(set(case)=={"DOGEUSDT","AVAXUSDT"} for case in d["cases"].values()))
  self.assertTrue(all(set(v)=={"10","30"} for case in d["cases"].values() for v in case.values()))
 def test_predictive_train_val_later_and_cost(self):
  d=read("RESIDUAL_ENTRY_PROBABILITY_TIME_SPLIT_20261023.json")
  self.assertEqual(len(d["features"]),18)
  for sym in ("DOGEUSDT","AVAXUSDT"):
   self.assertGreater(d["results"][sym]["train"]["rows"],500)
   for split in ("validation","later"):
    for q in ("q70","q80","q90","q95"):
     self.assertEqual(set(d["results"][sym][split]["cases"][q]),{"10","30"})
 def test_conservative_same_candle_long_stop_first(self):
  # First 5m candle moves through both STOP-10% and TAKE+25%, order unknown.
  bars=[(i*long.M5,100.,126.,89.,100.,1000.) for i in range(145)]
  times=[x[0] for x in bars]
  pnl,t,why=prob.trade_outcome(bars,times,0,"LONG",10)
  self.assertEqual(why,"STOP10")
  self.assertLess(pnl,-10)
 def test_conservative_same_candle_short_stop_first(self):
  bars=[(i*long.M5,100.,111.,74.,100.,1000.) for i in range(145)]
  times=[x[0] for x in bars]
  pnl,t,why=prob.trade_outcome(bars,times,0,"SHORT",10)
  self.assertEqual(why,"STOP10")
  self.assertLess(pnl,-10)
 def test_cost_30_more_than_10_round_trip(self):
  bars=[(i*long.M5,100.,100.1,99.9,100.,1000.) for i in range(145)]
  times=[x[0] for x in bars]
  for side in ("LONG","SHORT"):
   pnl10,*_=prob.trade_outcome(bars,times,0,side,10)
   pnl30,*_=prob.trade_outcome(bars,times,0,side,30)
   self.assertAlmostEqual(pnl10-pnl30,.2,places=8)
 def test_no_new_research_auto_adopted(self):
  d=read("RESIDUAL_ENTRY_REDIRECTION_DECISION_20261023.json")
  self.assertEqual(d["status"],"NO_ROBUST_70PCT_WR_ENTRY_MODEL_FROM_AVAILABLE_SCREEN_RESEARCH_NOT_LIVE")
  self.assertFalse(d["passedNewLong"])
  self.assertFalse(d["passedNewShort"])
  self.assertFalse(d["passedProbScoreValidationAndLater"])
 def test_legacy_doge_entry_is_not_new_short(self):
  self.assertIn("ORIGINAL_REL_VOL",long.CASES)
  self.assertNotIn("ORIGINAL_REL_VOL",short.SPECS)
  self.assertEqual(long.CASES["ORIGINAL_REL_VOL"],("base",))
 def test_new_signal_is_hourly_closed_m5_next_open(self):
  self.assertEqual(long.M5,300000)
  self.assertEqual(long.H,3600000)
  self.assertEqual(long.START,int(__import__("datetime").datetime(2025,8,10,tzinfo=__import__("datetime").timezone.utc).timestamp()*1000))
 def test_split_purged_12h_in_source(self):
  text=(HERE/"validate-residual-multifactor-predictive-entry-20261023.py").read_text("utf-8")
  self.assertIn('r["ts"]+12*H<TRAIN_END',text)
  self.assertIn('r["ts"]+12*H<VAL_END',text)
  self.assertIn('r["ts"]+12*H<base.END',text)
 def test_source_research_expressly_is_not_venue(self):
  d=read("RESIDUAL_ENTRY_REDIRECTION_DECISION_20261023.json")
  self.assertTrue(any("venue" in note for note in d["riskLimits"]))
  md=(OUT/"RESIDUAL_ENTRY_WINRATE_REDESIGN_REPORT_20261023.md").read_text("utf-8")
  self.assertIn("RESEARCH_ONLY",md)
if __name__=="__main__":unittest.main()
