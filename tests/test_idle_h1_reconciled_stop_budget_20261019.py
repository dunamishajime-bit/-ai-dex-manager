#!/usr/bin/env python3
"""Research-only H1 parity & risk-accounting tests (auto-skip without archive)."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"research"))
import idle_short_venue_h1_exit_research_20261019 as h1
import idle_short_canonical_h1_compound_budget_20261019 as sleeve

@unittest.skipUnless(all((h1.DATA/(x+"USDT.jsonl")).is_file() for x in ("DOT","RENDER","TAO","JUP","TIA")),"Canonical Aster H1 archive unavailable on this device; local proof only")
class CanonicalIdleH1Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.t=h1.load()
 def test_sixty_one_exact_archived_entry_exit_reconciliation(self):
  self.assertEqual(len(self.t),61)
  for t in self.t:
   exact=(t["entry"]-t["end"])/t["entry"]-.001
   self.assertAlmostEqual(exact,t["ret"],places=10)
 def test_original_nominal_ten_percent_h1_stop_never_fires(self):
  for t in self.t:
   if t["atr"]>.025:continue
   r=h1.simulate(t,{"initial_stop":.10,"activate":999})
   self.assertEqual(r["exit_reason"],"SCHEDULED_EXIT")
   self.assertAlmostEqual(r["net"],t["ret"],places=10)
 def test_no_lookahead_for_trailing_stop(self):
  t=next(t for t in self.t if t["symbol"]=="TAOUSDT" and t["ret"]>0)
  result=h1.simulate(t,{"activate":.03,"trail":.015})
  self.assertTrue(result["exit_ts_ms"]>=t["t"])
  self.assertTrue(result["exit_ts_ms"]<=t["exit_ts_ms"])
 def test_risk_cap_never_violated_after_entry_fee(self):
  for gap in (0.,1.,2.):
   for bps in (10.,20.,30.):
    for partial in (True,False):
     d=sleeve.replay(gap=gap,cost_bps=bps,partial=partial)
     self.assertLessEqual(d["peak_entry_nominal_stop_risk_pct"],20.000001)
 def test_partial_retains_more_winners_at_one_percent_stress(self):
  full=sleeve.replay(gap=1.,cost_bps=10.,partial=False)
  part=sleeve.replay(gap=1.,cost_bps=10.,partial=True)
  self.assertEqual((full["trades"],full["winners"]),(54,44))
  self.assertEqual((part["trades"],part["winners"]),(58,47))
  self.assertGreater(part["final_equity_multiple"],full["final_equity_multiple"])
 def test_research_baseline_unlimited_has_higher_stop_at_risk(self):
  a=sleeve.replay(no_budget=True,cost_bps=10.)
  b=sleeve.replay(gap=1.,partial=True,cost_bps=10.)
  self.assertGreater(a["peak_entry_nominal_stop_risk_pct"],20)
  self.assertLessEqual(b["peak_entry_nominal_stop_risk_pct"],20)
 def test_compound_base_anchored_and_dd_not_guaranteed_reduced(self):
  a=sleeve.replay(no_budget=True,cost_bps=10.)
  b=sleeve.replay(gap=1.,partial=True,cost_bps=10.)
  self.assertEqual(a["winners"],47)
  self.assertAlmostEqual(a["final_equity_multiple"],2.233463,places=4)
  self.assertAlmostEqual(b["max_h1_mtm_drawdown_pct"],a["max_h1_mtm_drawdown_pct"],places=3)

 def test_protected_stop_rescues_one_win_at_two_percent_stress(self):
  standard=sleeve.replay(gap=2.,partial=True,cost_bps=10.,risk_basis="mark")
  protected=sleeve.replay(gap=2.,partial=True,cost_bps=10.,risk_basis="mark",profit_lock=(.06,.025))
  self.assertEqual((standard["trades"],standard["winners"]),(56,45))
  self.assertEqual((protected["trades"],protected["winners"]),(57,46))
  self.assertGreater(protected["final_equity_multiple"],standard["final_equity_multiple"])
  self.assertEqual(protected["stop_amendments"],8)
  self.assertLessEqual(protected["peak_entry_nominal_stop_risk_pct"],20.000001)
 def test_profit_lock_no_historical_frozen_exits_changed(self):
  for t in self.t:
   if t["atr"]>.025:continue
   r=h1.simulate(t,{"activate":.06,"lock":.025})
   self.assertEqual(r["exit_ts_ms"],t["exit_ts_ms"])
   self.assertAlmostEqual(r["net"],t["ret"],places=10)
 def test_stricter_hard_stop_destroys_original_winners(self):
  wins=[t for t in self.t if t["atr"]<=.025 and t["ret"]>0]
  damaged=sum(h1.simulate(t,{"initial_stop":.02,"activate":999})["net"]<0 for t in wins)
  self.assertGreaterEqual(damaged,10)
 def test_profit_protection_is_not_sufficient_without_signed_stop(self):
  # A hypothetical H1 ratchet is not evidence of a live venue accepted STOP.
  self.assertTrue(all("venue_signed_stop_verified" not in t for t in self.t))

if __name__=="__main__":unittest.main(verbosity=2)
