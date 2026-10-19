#!/usr/bin/env python3
"""Causal research checks, no venue orders."""
import sys,unittest,json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))
import long_loss_causal_h1_filter_study_20261019 as causal
import long_q102_h1_profit_floor_study_20261019 as floors
import long_v12_causal_loss_cooldown_study_20261019 as v12

@unittest.skipUnless((causal.ARCHIVE/"BTCUSDT.jsonl").is_file(),"Archived signed-like H1 source unavailable")
class LongResearchTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.all,cls.target,cls.market=causal.read()
  cls.q=[x for x in cls.target if x["strategy_id"]=="Q102"]
  cls.high=[x for x in cls.q if x.get("family")=="HIGH_VOL"]
 def test_accepted_canonical_trade_counts(self):
  self.assertEqual(len(self.all),1358)
  self.assertEqual(len([x for x in self.target if x["strategy_id"]=="V12"]),379)
  self.assertEqual(len(self.q),29)
  self.assertEqual(len(self.high),6)
 def test_features_use_prior_fully_closed_h1(self):
  tr=next(x for x in self.target if x["strategy_id"]=="Q102")
  ts=tr["entry_ts_ms"];features=causal.features(tr,self.market)
  before=dict(self.market[tr["symbol"]].get(ts,{}))
  try:
   self.market[tr["symbol"]][ts]={"event_time_ms":ts,"open":1000000.,"high":1000000.,"low":1.,"close":10.,"quote_volume":1000000.}
   self.assertEqual(features,causal.features(tr,self.market))
  finally:
   if before:self.market[tr["symbol"]][ts]=before
   else:self.market[tr["symbol"]].pop(ts,None)
 def test_reversal_HV_profit_floor_5_3_2_has_both_window_positive(self):
  early=[x for x in self.high if x["entry_ts_ms"]<causal.SPLIT]
  late=[x for x in self.high if x["entry_ts_ms"]>=causal.SPLIT]
  self.assertEqual((len(early),len(late)),(3,3))
  a=floors.calculate(early,self.market,.05,.03,.02)
  b=floors.calculate(late,self.market,.05,.03,.02)
  self.assertGreater(a["delta_pp"],8)
  self.assertGreater(b["delta_pp"],4)
  self.assertEqual(a["winner_to_loser"]+b["winner_to_loser"],0)
  self.assertEqual(a["loser_to_winner"]+b["loser_to_winner"],2)
 def test_q102_floor_only_time_exit_changes(self):
  tr=next(x for x in self.q if x["exit_reason_actual"]!="Q102_TIME_EXIT")
  a=floors.floor_exit(tr,self.market,.05,.03,.02)
  self.assertEqual(a["reason"],"ORIGINAL_NON_TIME_EXIT_UNCHANGED")
  self.assertEqual(a["delta_fraction_of_equity"],0)
 def test_BTC12_threshold_Q102_split_not_win_only(self):
  first=[causal.features(x,self.market) for x in self.q if int(x["entry_ts_ms"])<causal.SPLIT]
  second=[causal.features(x,self.market) for x in self.q if int(x["entry_ts_ms"])>=causal.SPLIT]
  self.assertEqual(sum(x["BTC12"] is not None and x["BTC12"]<=-.025 for x in first),2)
  self.assertEqual(sum(x["BTC12"] is not None and x["BTC12"]<=-.025 for x in second),2)
 def test_loss_cooldown_does_not_miscount_filtered_outcomes(self):
  tr=v12.records()
  six=v12.simulate(tr,6,6)
  self.assertEqual(six["accepted_count"],len(tr))
  four=v12.simulate(tr,4,12)
  self.assertGreater(four["train"]["win_profit_lost_pp"],four["train"]["loss_avoided_pp"])
 def test_preexisting_Q102_floor_does_not_prove_new_live_improvement(self):
  # Intrabar original Q102 LIVE uses 5m; research uses H1 and cannot certify it.
  t=floors.calculate(self.q,self.market,.02,.005,.01)
  self.assertLess(t["delta_pp"],0)

if __name__=="__main__":unittest.main(verbosity=2)
