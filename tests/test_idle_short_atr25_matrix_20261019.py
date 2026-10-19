"""Research-only ATR2.5 fixed stop budget and H1 ranking checks."""
import unittest
from pathlib import Path
from sys import path
path.insert(0,str(Path(__file__).resolve().parents[1]/"research"))
from idle_short_atr25_priority_matrix_20261019 import (
    run, fixed_intent_grid, protected_short_add_on, h1_rank, causal_score, ROOT
)
from idle_short_cluster_guard_frozen_replay_20261019 import load

class TestATR25(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.rows=load(ROOT)
 def test_atr_fixed(self):
  d=run()
  self.assertEqual(d["selection"]["atr_gate_pct"],2.5)
  self.assertIsNone(d["selection"]["blanket_gross_cap"])
  self.assertEqual(d["baseline_atr25"]["10bps"]["trades"],58)
  self.assertEqual(d["baseline_atr25"]["10bps"]["wins"],47)
 def test_matrix_counts(self):
  self.assertEqual(fixed_intent_grid(self.rows,15,0,ranking=False)["10bps"]["trades"],54)
  self.assertEqual(fixed_intent_grid(self.rows,20,0,ranking=False)["10bps"]["trades"],57)
  self.assertEqual(fixed_intent_grid(self.rows,20,2,ranking=False)["10bps"]["trades"],54)
 def test_risk_bounds(self):
  for b in (15,20):
   for g in (0,1,2):
    d=fixed_intent_grid(self.rows,b,g,ranking=False)
    self.assertLessEqual(d["max_nominal_at_stop_pct"],b+1e-8)
 def test_rank_has_no_future_outcome_input(self):
  future=[x for x in self.rows if x["entry_ts_ms"]==1776538800000]
  prior=[x for x in self.rows if x["exit_ts_ms"]<=1776538800000]
  order1,diag1=h1_rank(future,prior)
  altered=[dict(x,return_10bps=x["return_10bps"]*999) for x in future]
  order2,diag2=h1_rank(altered,prior)
  self.assertEqual([x["symbol"] for x in order1],[x["symbol"] for x in order2])
  self.assertEqual([(x["symbol"],x["preentry_score"]) for x in diag1],
                   [(x["symbol"],x["preentry_score"]) for x in diag2])
 def test_same_hour_only_prior_exited(self):
  future=[x for x in self.rows if x["entry_ts_ms"]==1776538800000]
  prior=[x for x in self.rows if x["exit_ts_ms"]<=1776538800000]
  _,diag=h1_rank(future,prior)
  self.assertEqual({x["symbol"] for x in diag},{"RENDERUSDT","TAOUSDT"})
  self.assertFalse(any(x["has_calibrated_forward_ev"] for x in diag))
 def test_protection_denied_no_signed_stop(self):
  self.assertEqual(protected_short_add_on([{"net_profit_at_stop_pct":2}])[0],False)
 def test_protection_denied_unprotected_loss(self):
  p={"venue_signed_stop_verified":True,"reduce_only":True,
      "stop_quantity_matches_position":True,"net_profit_at_stop_pct":-0.1}
  self.assertEqual(protected_short_add_on([p])[1],"NO_PROTECTED_NET_PROFIT_AT_STOP")
 def test_protection_allowed_only_verified_net_positive(self):
  p={"venue_signed_stop_verified":True,"reduce_only":True,
      "stop_quantity_matches_position":True,"net_profit_at_stop_pct":1.8}
  self.assertTrue(protected_short_add_on([p])[0])
 def test_latency_never_faked(self):
  d=run()
  self.assertEqual([x["delay_min"] for x in d["latency"]],[5,10,15,30])
  self.assertTrue(all(x["status"].startswith("UNCOMPUTABLE") for x in d["latency"]))
 def test_integrated_dd_not_faked(self):
  self.assertIsNone(run()["integrated_v4_q102_hype_pengu_v52_fet_asset_and_dd"])

if __name__=="__main__":unittest.main()
