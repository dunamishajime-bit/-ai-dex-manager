"""HYPE native Layer2/3 research shadow: strict as-of / no trading selection."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_hype_native_online_layer23_shadow import (
    past_closed_asof,trailing_prior_stats,wilson,MIN_OBSERVATIONS,
)
def trade(start,end,ret):
    return {"start":start,"end":end,"netWalletReturn":ret}
class HypeLayer23CausalityTests(unittest.TestCase):
 def test_strict_asof_excludes_same_timestamp_exit(self):
    t=[trade(1,3,.1),trade(4,6,-.05)]
    x=past_closed_asof(t,6)
    self.assertEqual(len(x),1)
    self.assertEqual(x[0]["end"],3)
 def test_future_outcome_changes_do_not_affect_past_signal_score(self):
    t=[trade(1,3,.1),trade(4,8,-.05)]
    before=trailing_prior_stats(past_closed_asof(t,7))
    t[1]["netWalletReturn"]=.90
    after=trailing_prior_stats(past_closed_asof(t,7))
    self.assertEqual(before,after)
 def test_future_exit_does_not_contaminate_bayesian_rate(self):
    x=trailing_prior_stats(past_closed_asof([trade(1,5,.1)],4))
    self.assertEqual(x["recentCount"],0)
    self.assertEqual(x["beta11PosteriorMeanWinRate"],.5)
    self.assertIsNone(x["historicalWilson95"])
 def test_all_prior_exits_only_includes_positive_and_negative(self):
    x=trailing_prior_stats([trade(i,i+1,.1 if i%2 else -.02) for i in range(5)])
    self.assertEqual(x["recentCount"],5)
    self.assertEqual(x["recentWins"],2)
    self.assertAlmostEqual(x["beta11PosteriorMeanWinRate"],3/7)
 def test_window_fixed_last20_does_not_overweight_old_wins(self):
    t=[trade(i,i+1,1.) for i in range(60)]
    for x in t[-20:]:x["netWalletReturn"]=-.04
    s=trailing_prior_stats(t)
    self.assertEqual(s["recentCount"],20)
    self.assertEqual(s["recentWins"],0)
    self.assertEqual(s["observedPastClosed"],60)
    self.assertFalse(s["candidateSelectionAuthorized"])
 def test_minimum_online_history_does_not_create_entry_authority(self):
    t=[trade(i,i+1,.1) for i in range(MIN_OBSERVATIONS)]
    s=trailing_prior_stats(t)
    self.assertEqual(s["confidenceStatus"],"EXPLORATORY_ONLY_NOT_CALIBRATED")
    self.assertFalse(s["candidateSelectionAuthorized"])
 def test_missing_trade_history_has_no_estimated_expected_value(self):
    s=trailing_prior_stats([])
    self.assertIsNone(s["recentMeanNetWalletPct"])
    self.assertEqual(s["confidenceStatus"],"INSUFFICIENT_PAST_CLOSED_TRADES")
 def test_invalid_duration_rejected(self):
    with self.assertRaisesRegex(ValueError,"MODEL_TRADE_INTERVAL_INVALID"):
      past_closed_asof([trade(8,8,.2)],10)
 def test_wilson_bounds_not_future_model_confidence(self):
    x=wilson(5,10)
    self.assertTrue(0<=x[0]<.5<x[1]<=1)
    self.assertIsNone(wilson(0,0))
if __name__=="__main__":unittest.main()
