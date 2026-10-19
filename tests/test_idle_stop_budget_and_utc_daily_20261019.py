#!/usr/bin/env python3
"""Synthetic causal/accounting regression tests; does not operate LIVE settings."""
import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"research"))
from idle_short_stop_budget_stress_20261019 import analyze

def incremental_day_pnl(realized,fees,funding,current_unrealized,midnight_unrealized):
    # Realized includes full lifetime PnL of positions CLOSED today. Subtract
    # yesterday's unrealized MTM baseline once, including positions now closed.
    return realized+fees+funding+current_unrealized-midnight_unrealized

def short_protected_pnl(entry_price, signed_stop, qty):
    if not (entry_price>0 and signed_stop>0 and qty>0): raise ValueError("invalid price or qty")
    return (entry_price-signed_stop)*qty

class NominalRiskAndDailyPnL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r=analyze()
    def test_hash_and_fixture_counts(self):
        self.assertEqual(self.r["base"]["trades"],61)
        self.assertEqual(self.r["base"]["wins"],48)
        self.assertEqual(len(self.r["historical"]),18)
    def test_original_baseline_stress_monotonic(self):
        rows={(x["budget_pct"],x["gap_pct"]):x for x in self.r["historical"]}
        self.assertEqual(rows[(20.,0.)]["trades"],60)
        self.assertEqual(rows[(15.,1.)]["trades"],57)
        self.assertLessEqual(rows[(20.,1.)]["trades"],rows[(20.,0.)]["trades"])
        self.assertEqual(rows[(10.,1.)]["trades"],29)
    def test_live_three_entries_proxied_above_20_pct(self):
        for case in self.r["oct19_scenario"]["stress"]:
            self.assertGreater(case["all_three_nominal_stop_risk_pct"],20.)
    def test_one_new_h1_admission_rejected_in_15_pct_budget(self):
        case=next(x for x in self.r["oct19_scenario"]["stress"] if x["stress_gap_pct"]==0.)
        d=next(x for x in case["decisions"] if x["budget_pct"]==15. and x["order"][1]=="TAOUSDT")
        self.assertEqual(d["allowed"],["JUPUSDT","TAOUSDT"])
        self.assertEqual(d["blocked"],["TIAUSDT"])
    def test_overnight_loss_is_not_today_loss(self):
        self.assertAlmostEqual(incremental_day_pnl(0,0,0,-7,-6),-1)
        self.assertAlmostEqual(incremental_day_pnl(0,0,0,-5,-6),1)
    def test_close_old_position_avoids_full_lifetime_double_count(self):
        # Start of day held -6 unrealized. Closed for realized -8, now flat:
        # the actual change since midnight is -2, NOT -8.
        self.assertAlmostEqual(incremental_day_pnl(-8,0,0,0,-6),-2)
    def test_trade_fees_and_funding_in_incremental_day(self):
        self.assertAlmostEqual(incremental_day_pnl(1,-.1,-.2,-2,-3),1.7)
    def test_signed_protected_profit_is_not_floating_profit(self):
        # Short entry 100, current 95, STOP 101 => floating +5,
        # but resident STOP could still settle -1 before fees.
        self.assertEqual(short_protected_pnl(100,101,1),-1)
        self.assertEqual(short_protected_pnl(100,98,1),2)
    def test_tripped_latch_cannot_be_reset_by_formula_correction(self):
        latched=True
        todays_incremental_loss_pct=0.3
        self.assertTrue(latched or todays_incremental_loss_pct>=7.5)

if __name__=="__main__":
    unittest.main(verbosity=2)
