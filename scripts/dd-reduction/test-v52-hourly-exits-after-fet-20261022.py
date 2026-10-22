#!/usr/bin/env python3
"""Causal V52 H1 stock Yahoo/Aster as-of and scoped overlay tests."""
import importlib.util,collections,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("v52_h1_exit_research_tests",HERE/"run-v52-hourly-exits-after-fet-20261022.py")
assert spec and spec.loader
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
H=m.HOUR

class V52Tests(unittest.TestCase):
 def setUp(self):
  m.PRICES.clear();m.INDEX.clear();m.STATS.clear()
  self.entry=100.0
  self.row=dict(strategy_id="V52",symbol="TSLAUSDT",side="SHORT",
     entry_ts_ms=H,exit_ts_ms=4*H,entry_price=100.,exit_price=99.5,
     exit_reason="TIME_OR_SESSION_FLAT")
  self.make_source([100,99.5,99.6,99.5],[99,99.2,99.3,99.1])
  b0=10000*(100/99-1)
  m.INDEX[(H,"TSLAUSDT","SHORT")]=[{"v52_entry_basis_bps":b0,
                                     "v52_yahoo_entry_reference_usd":99.0}]
 def make_source(self,aa,yy):
  stamps=[i*H for i in range(4)]
  m.PRICES["TSLA"]={"a":(stamps,aa),"y":(stamps,yy)}
 def make_obs(self):return {"triggered":0,"by_reason":collections.Counter()}
 def test_completed_hour_asof_never_reads_current_bar(self):
  self.assertEqual(m.asof("TSLA","a",H),100)
  self.assertEqual(m.asof("TSLA","a",2*H),99.5)
  self.assertEqual(m.asof("TSLA","y",H),99)
  self.assertIsNone(m.asof("TSLA","a",H-1))
 def test_source_native_reason_and_entry_eligible(self):
  self.assertIsNotNone(m.matching_entry(self.row))
  self.assertEqual(m.native_basis_reason(19,100),"BASIS_CONVERGED")
  self.assertEqual(m.native_basis_reason(-20,100),"BASIS_CONVERGED")
  self.assertEqual(m.native_basis_reason(175,100),"BASIS_STOP")
  self.assertEqual(m.native_basis_reason(70,100),"TIME_OR_SESSION_FLAT")
 def test_short_partial_protection_acts_on_next_confirmed_checkpoint(self):
  obs=self.make_obs()
  o=m.apply(self.row,m.CASES["V52_SHORT_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(o["exit_ts_ms"],2*H)
  self.assertEqual(obs["triggered"],1)
  self.assertTrue(o["exit_reason"].startswith("RESEARCH_H1_V52"))
  self.assertAlmostEqual(o["exit_price"],99.5*1.001,places=6)
 def test_long_rule_must_not_affect_short(self):
  obs=self.make_obs()
  a=m.apply(self.row,m.CASES["V52_LONG_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(a,self.row)
  self.assertEqual(obs["triggered"],0)
 def test_beyond_native_basis_stop_no_new_exit(self):
  self.make_source([100,101.0,101.5,99.5],[99,99.3,99.3,99.1])
  obs=self.make_obs()
  out=m.apply(self.row,m.CASES["V52_SHORT_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(out,self.row)
 def test_missing_entry_basis_fail_closed(self):
  m.INDEX.clear()
  obs=self.make_obs()
  out=m.apply(self.row,m.CASES["V52_SHORT_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(out,self.row)
  self.assertEqual(obs["triggered"],0)
 def test_wrong_reference_price_fails_closed(self):
  m.INDEX[(H,"TSLAUSDT","SHORT")][0]["v52_entry_basis_bps"]=150.0
  obs=self.make_obs()
  out=m.apply(self.row,m.CASES["V52_SHORT_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(out,self.row)
 def test_duplicate_candidate_identity_fail_closed(self):
  m.INDEX[(H,"TSLAUSDT","SHORT")].append(dict(m.INDEX[(H,"TSLAUSDT","SHORT")][0]))
  obs=self.make_obs()
  out=m.apply(self.row,m.CASES["V52_SHORT_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(out,self.row)
 def test_long_partial_guard_separate(self):
  self.row.update(side="LONG",exit_price=101.1)
  self.make_source([100,101,101,101.1],[101,101.5,101.6,101.7])
  m.INDEX.clear()
  b0=10000*(100/101-1)
  m.INDEX[(H,"TSLAUSDT","LONG")]=[{"v52_entry_basis_bps":b0,
                                    "v52_yahoo_entry_reference_usd":101}]
  obs=self.make_obs()
  out=m.apply(self.row,m.CASES["V52_LONG_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(out["exit_ts_ms"],2*H)
  self.assertEqual(obs["triggered"],1)
  self.assertAlmostEqual(out["exit_price"],101*.999,places=6)
 def test_other_strategy_is_not_modified(self):
  obs=self.make_obs()
  row=dict(self.row,strategy_id="FET")
  out=m.apply(row,m.CASES["V52_SHORT_PARTIAL_CONV30_PNL0P2"],None,10,obs)
  self.assertEqual(out,row)

if __name__=="__main__":unittest.main()
